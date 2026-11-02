#include <algorithm>
#include <cmath>
#include <vector>
#include <emscripten/emscripten.h>

#include <tgf.h>
#include <robottools.h>

#include "ai.h"
#include "game.h"
#include "session.h"
#include "stewards.h"
#include "race-control.h"

extern "C" int sdTrackLocal2Global(double toStart, double toMiddle, float *out);

namespace
{

enum State
{
    RC_GREEN,
    RC_FORMATION,
    RC_LIGHTS,
    RC_VSC,
    RC_VSC_ENDING,
    RC_SC,
    RC_SC_IN,
    RC_RESTART,
    RC_RED,
    RC_SUSPENDED
};

enum Level
{
    LEVEL_OFF,
    LEVEL_REDUCED,
    LEVEL_STANDARD,
    LEVEL_INCREASED
};

const int kindRace = 1;
const double unlimited = 1e9;
const double formationBudget = 400.0;
const double scShare = 1.55;
const double deltaShare = 1.4;
const double formationShare = 1.9;
const double lineStep = 5.0;
const double aiMargin = 0.97;
const double scTopSpeed = 50.0;
const double scAccel = 6.0;
const double scBraking = 12.0;
const double brakingLook = 1.5;
const double followGap = 20.0;
const double formationGap = 30.0;
const double restartGap = 10.0;
const double followGain = 0.6;
const double queueGap = 55.0;
const double caughtGap = 60.0;
const double queueShare = 0.75;
const double queueTimeout = 90.0;
const double deltaStart = 1.5;
const double scSpawnAhead = 150.0;
const double rollingAhead = 90.0;
const double pitBlend = 60.0;
const double pitShown = 200.0;
const double vscMinimum = 20.0;
const double vscEndingTime = 10.0;
const double clearHold = 5.0;
const double scMinimum = 75.0;
const double redSlowdown = 15.0;
const double suspendedTime = 10.0;
const double restartLights = 5.0;
const double restartHold = 1.4;
const double startGrace = 5.0;
const double stoppedSpeed = 2.0;
const double onTrackMargin = 0.5;
const double nearMargin = 4.0;
const double strandedTime = 1.0;
const double marshalRecovery = 50.0;
const double redPersist = 60.0;
const int redCars = 3;
const double passRange = 200.0;
const double giveBackTime = 15.0;
const double gapTimeLimit = 10.0;
const double lineupBefore = 300.0;
const double troubledShare = 0.5;
const int marshalSectors = 24;
const double scThreshold[] = {unlimited, 6.0, 3.0, 2.0};
const double vscThreshold[] = {unlimited, 15.0, 8.0, 5.0};
const int outFields = 16;

struct Pass
{
    int other;
    double at;
};

struct CarState
{
    double stopOn = 0;
    double stopNear = 0;
    double stopAny = 0;
    double delta = 0;
    int redSectors = 0;
    int sector = -1;
    bool caught = false;
    double gapClock = 0;
    bool gapPenalised = false;
    std::vector<Pass> passes;
    double scPassAt = -1;
    double scSide = 0;
    bool crossed = false;
    int laps = 0;
    double startProgress = 0;
    double aheadGap = unlimited;
    double aheadSpeed = 0;
};

struct Hazard
{
    int source = -1;
    bool sc = false;
    bool vsc = false;
    bool red = false;
    bool any = false;
};

int level = LEVEL_STANDARD;
bool redFlags = true;
bool formationLap = false;
bool rollingStart = false;
int kind = 0;
State state = RC_GREEN;
State period = RC_GREEN;
double since = 0;
double signalTime = 0;
double countdown = 0;
double length = 1;
double scProgress = 0;
double scPitDistance = -1;
bool scVisible = false;
bool scLightsOn = false;
double scSpeed = 0;
double clearSince = -1;
int lineups = 0;
int restarts = 0;
bool initialRolling = false;
std::vector<CarState> cars;
std::vector<std::vector<signed char>> order;
double now = 0;

double wrap(double d)
{
    double m = fmod(d, length);
    return m < 0 ? m + length : m;
}

double signedGap(double from, double to)
{
    double d = wrap(to - from);
    return d > length / 2 ? d - length : d;
}

double progress(tCarElt *car)
{
    return car->_distRaced;
}

bool present(tSituation *s, int i)
{
    return (s->cars[i]->_state & RM_CAR_STATE_NO_SIMU) == 0;
}

bool racingCar(tSituation *s, int i)
{
    return present(s, i) && sdSessionRacing(i) && !sdStewardsDisqualified(i);
}

bool inLane(tCarElt *car)
{
    return sdAiInPitLaneAt(car->_distFromStartLine, car->_trkPos.toMiddle);
}

bool aiDriven(int i)
{
    return i != 0 || sdPlayerAutopilot();
}

double lineLap = 1;

double pace(double distance, double lapFactor)
{
    double reference = std::max(1.0, sdSessionReferenceLap());
    return sdAiLineSpeed(wrap(distance)) * lineLap / (lapFactor * reference);
}

double lapOnLine()
{
    double total = 0;
    for (double d = 0; d < length; d += lineStep)
        total += lineStep / std::max(1.0, sdAiLineSpeed(d));
    return total;
}

double safetyCarPace(double distance)
{
    return std::min(scTopSpeed, pace(distance, scShare));
}

void enter(State next)
{
    state = next;
    since = now;
}

bool deltaPeriod()
{
    return state == RC_VSC || state == RC_VSC_ENDING || state == RC_SC || state == RC_SC_IN || state == RC_RED;
}

bool neutral()
{
    return deltaPeriod() || state == RC_FORMATION;
}

bool safetyCarOut()
{
    return state == RC_SC || state == RC_SC_IN;
}

void announce(int event, double value)
{
    sdStewardsAnnounce(event, value, scVisible ? wrap(scProgress) : 0.0);
}

Hazard scan(tSituation *s, double dt)
{
    Hazard h;
    int stranded = 0;
    bool persistent = false;
    bool watching = state != RC_FORMATION && state != RC_LIGHTS && state != RC_SUSPENDED && now - signalTime > startGrace;
    for (int i = 0; i < s->_ncars; i++)
    {
        CarState &c = cars[i];
        tCarElt *car = s->cars[i];
        bool watch = watching && present(s, i) && !inLane(car) && !sdSessionFinished(i);
        bool stopped = watch && fabs(car->_speed_x) < stoppedSpeed;
        double left = 0, right = 0;
        bool edges = sdAiTrackEdges(car->_distFromStartLine, &left, &right);
        double lat = car->_trkPos.toMiddle;
        bool onTrack = edges && lat < left + onTrackMargin && lat > right - onTrackMargin;
        bool near = edges && lat < left + nearMargin && lat > right - nearMargin;
        c.stopAny = stopped ? c.stopAny + dt : 0;
        c.stopOn = stopped && onTrack ? c.stopOn + dt : 0;
        c.stopNear = stopped && near ? c.stopNear + dt : 0;
        if (c.stopAny > marshalRecovery)
            continue;
        if (c.stopNear > 0.5 && h.source < 0)
            h.source = i;
        h.sc = h.sc || c.stopOn >= scThreshold[level];
        h.vsc = h.vsc || c.stopNear >= vscThreshold[level];
        h.any = h.any || c.stopNear > 0.5;
        if (c.stopOn >= strandedTime)
            stranded++;
        persistent = persistent || c.stopOn > redPersist;
    }
    h.sc = h.sc || (stranded >= 2 && level != LEVEL_OFF);
    h.red = redFlags && (stranded >= redCars || persistent);
    return h;
}

int leaderOnRoad(tSituation *s)
{
    int best = -1;
    for (int i = 0; i < s->_ncars; i++)
        if (racingCar(s, i) && !inLane(s->cars[i]) && (best < 0 || progress(s->cars[i]) > progress(s->cars[best])))
            best = i;
    return best;
}

void startPeriod(tSituation *s, bool keepDelta)
{
    for (int i = 0; i < s->_ncars; i++)
    {
        CarState &c = cars[i];
        if (!keepDelta)
        {
            c.delta = deltaStart;
            c.redSectors = 0;
            c.sector = -1;
            c.passes.clear();
        }
        c.caught = false;
        c.gapClock = 0;
        c.gapPenalised = false;
        c.scPassAt = -1;
        c.scSide = 0;
    }
    clearSince = -1;
}

int deltaPenalty(int red, int *points)
{
    *points = red >= 5 ? 3 : red == 4 ? 2 : 1;
    if (red >= 6)
        return P_STOP_GO;
    if (red == 5)
        return P_DRIVE_THROUGH;
    return red == 4 ? P_TIME10 : P_TIME5;
}

int passPenalty(int count, int *points)
{
    *points = count > 2 ? 3 : 2;
    if (count > 2)
        return P_STOP_GO;
    return count == 2 ? P_DRIVE_THROUGH : P_TIME10;
}

int standingPasses(tSituation *s, int i)
{
    int count = 0;
    for (const Pass &p : cars[i].passes)
        if (racingCar(s, p.other) && progress(s->cars[i]) > progress(s->cars[p.other]))
            count++;
    return count;
}

void endPeriod(tSituation *s)
{
    for (int i = 0; i < s->_ncars; i++)
    {
        CarState &c = cars[i];
        tCarElt *car = s->cars[i];
        double where = car->_distFromStartLine;
        if (!racingCar(s, i))
        {
            c.passes.clear();
            continue;
        }
        int points = 0;
        if (c.redSectors >= 2)
        {
            int offence = period == RC_SC ? O_SC_DELTA : period == RC_RED ? O_RED_FLAG : O_VSC_DELTA;
            int penalty = deltaPenalty(c.redSectors, &points);
            sdStewardsDecide(i, offence, penalty, c.redSectors, -1, where, 9.0, points);
        }
        int passes = standingPasses(s, i);
        if (passes > 0)
        {
            int penalty = period == RC_RED ? P_STOP_GO : passPenalty(passes, &points);
            sdStewardsDecide(i, period == RC_RED ? O_RED_FLAG : O_SC_OVERTAKE, penalty, passes, c.passes.front().other, where, 9.0, period == RC_RED ? 4 : points);
        }
        if (c.scPassAt >= 0)
            sdStewardsDecide(i, O_SAFETY_CAR_PASS, P_STOP_GO, 0, -1, where, 9.0, 3);
        c.redSectors = 0;
        c.passes.clear();
        c.scPassAt = -1;
    }
}

int hazardCar = -1;

void deployVsc(tSituation *s)
{
    period = RC_VSC;
    startPeriod(s, false);
    enter(RC_VSC);
    announce(EV_VSC, hazardCar);
}

void deploySafetyCar(tSituation *s)
{
    bool fromVsc = deltaPeriod();
    int leader = leaderOnRoad(s);
    scProgress = (leader >= 0 ? progress(s->cars[leader]) : 0.0) + scSpawnAhead;
    scSpeed = leader >= 0 ? std::min((double)s->cars[leader]->_speed_x, safetyCarPace(scProgress)) : 0.0;
    scPitDistance = -1;
    scVisible = true;
    scLightsOn = true;
    period = RC_SC;
    startPeriod(s, fromVsc);
    enter(RC_SC);
    announce(EV_SC, hazardCar);
}

void startRed(tSituation *s)
{
    bool fromNeutral = deltaPeriod();
    if (fromNeutral)
        endPeriod(s);
    scVisible = false;
    period = RC_RED;
    startPeriod(s, false);
    enter(RC_RED);
    announce(EV_RED, hazardCar);
}

bool moveSafetyCar(double dt)
{
    if (!scVisible)
        return false;
    double before = wrap(scProgress);
    double wanted = scPitDistance >= 0 ? std::min(safetyCarPace(scProgress), 22.0) : safetyCarPace(scProgress);
    double ahead = safetyCarPace(scProgress + scSpeed * brakingLook);
    wanted = std::min(wanted, ahead + scBraking * brakingLook);
    scSpeed = std::max(scSpeed - scBraking * dt, std::min(wanted, scSpeed + scAccel * dt));
    double travelled = scSpeed * dt;
    scProgress += travelled;
    if (scPitDistance >= 0)
    {
        scPitDistance += travelled;
        if (scPitDistance > pitShown)
            scVisible = false;
        return false;
    }
    if (state != RC_SC_IN)
        return false;
    bool reached = wrap(sdAiPitEntry() - before) <= travelled;
    if (reached)
        scPitDistance = 0;
    return reached;
}

void place(tSituation *s, const std::vector<int> &grid)
{
    for (int slot = 0; slot < (int)grid.size(); slot++)
    {
        int i = grid[slot];
        double distance = 0, lateral = 0;
        if (!sdAiGridSlot(slot, &distance, &lateral))
            continue;
        sdCarTeleport(i, distance, lateral);
        sdAiResetRunning(i);
        sdAiSetSpeedCap(i, unlimited);
        cars[i].passes.clear();
        cars[i].laps = s->cars[i]->_laps;
        cars[i].startProgress = progress(s->cars[i]);
    }
}

void formationLineup(tSituation *s)
{
    std::vector<int> grid, back;
    for (int i = 0; i < s->_ncars; i++)
        if (present(s, i))
            grid.push_back(i);
    std::stable_sort(grid.begin(), grid.end(), [](int a, int b) { return sdSessionStartSlot(a) < sdSessionStartSlot(b); });
    std::vector<int> ordered;
    for (int i : grid)
    {
        if (standingPasses(s, i) > 0)
        {
            back.push_back(i);
            sdStewardsDecide(i, O_FORMATION_OVERTAKE, P_BACK_OF_GRID, 0, cars[i].passes.front().other, s->cars[i]->_distFromStartLine, 0, 0);
        }
        else
            ordered.push_back(i);
    }
    ordered.insert(ordered.end(), back.begin(), back.end());
    s->currentTime = -countdown;
    now = s->currentTime;
    place(s, ordered);
    for (int i : ordered)
    {
        tCarElt *car = s->cars[i];
        car->_laps = 0;
        car->_lastLapTime = 0;
        car->_bestLapTime = 0;
        car->_curLapTime = 0;
        ReInfo->_reCarInfo[i].sTime = (tdble)now;
        ReInfo->_reCarInfo[i].lapFlag = 0;
        cars[i].laps = 0;
    }
    signalTime = 0;
    sdSessionRestartTiming(s);
    sdStewardsArmStart(s, signalTime, countdown);
    sdInputRelaunch();
    lineups++;
    announce(EV_LINEUP, 0);
    enter(RC_LIGHTS);
}

void redFlagLineup(tSituation *s)
{
    std::vector<int> grid;
    for (int i = 0; i < s->_ncars; i++)
        if (racingCar(s, i))
            grid.push_back(i);
    std::stable_sort(grid.begin(), grid.end(), [](int a, int b) { return sdSessionPositionOf(a) < sdSessionPositionOf(b); });
    place(s, grid);
    for (int i : grid)
        sdServiceCar(i, sdTyresCompound(i));
    sdSessionRestartTiming(s);
    lineups++;
    announce(EV_SUSPENDED, suspendedTime);
    enter(RC_SUSPENDED);
}

void resumeLights(tSituation *s)
{
    countdown = restartLights + restartHold;
    signalTime = now + countdown;
    sdStewardsArmStart(s, signalTime, countdown);
    sdInputRelaunch();
    restarts++;
    announce(EV_RESUME, countdown);
    enter(RC_LIGHTS);
}

void startRolling(tSituation *s)
{
    int pole = -1;
    for (int i = 0; i < s->_ncars; i++)
        if (racingCar(s, i) && (pole < 0 || sdSessionStartSlot(i) < sdSessionStartSlot(pole)))
            pole = i;
    scProgress = (pole >= 0 ? progress(s->cars[pole]) : 0.0) + rollingAhead;
    scSpeed = 0;
    scPitDistance = -1;
    scVisible = true;
    scLightsOn = false;
    period = RC_SC;
    startPeriod(s, false);
    for (CarState &c : cars)
        c.caught = true;
    initialRolling = false;
    enter(RC_SC_IN);
    announce(EV_ROLLING, 0);
}

void findAhead(tSituation *s, int i)
{
    CarState &c = cars[i];
    tCarElt *car = s->cars[i];
    c.aheadGap = unlimited;
    c.aheadSpeed = 0;
    for (int k = 0; k < s->_ncars; k++)
    {
        if (k == i || !racingCar(s, k) || inLane(s->cars[k]))
            continue;
        double gap = wrap(s->cars[k]->_distFromStartLine - car->_distFromStartLine);
        if (gap < c.aheadGap)
        {
            c.aheadGap = gap;
            c.aheadSpeed = s->cars[k]->_speed_x;
        }
    }
    if (!scVisible || scPitDistance >= 0)
        return;
    double gap = wrap(scProgress - car->_distFromStartLine);
    if (gap < c.aheadGap)
    {
        c.aheadGap = gap;
        c.aheadSpeed = scSpeed;
    }
}

double follow(const CarState &c, double target)
{
    if (c.aheadGap >= unlimited)
        return unlimited;
    return std::max(0.0, c.aheadSpeed + followGain * (c.aheadGap - target));
}

double capFor(tSituation *s, int i)
{
    const CarState &c = cars[i];
    double where = s->cars[i]->_distFromStartLine;
    switch (state)
    {
    case RC_FORMATION:
        return std::min(pace(where, formationShare), follow(c, formationGap));
    case RC_VSC:
    case RC_VSC_ENDING:
    case RC_RED:
        return std::min(pace(where, deltaShare) * aiMargin, follow(c, followGap));
    case RC_SC:
    case RC_SC_IN:
        return c.caught ? follow(c, followGap) : std::min(pace(where, deltaShare) * aiMargin, follow(c, followGap));
    case RC_RESTART:
        return c.crossed ? unlimited : follow(c, restartGap);
    default:
        return unlimited;
    }
}

void chainQueue(tSituation *s)
{
    if (!safetyCarOut() || !scVisible || scPitDistance >= 0)
        return;
    std::vector<std::pair<double, int>> behind;
    double head = wrap(scProgress);
    for (int i = 0; i < s->_ncars; i++)
        if (racingCar(s, i) && !inLane(s->cars[i]))
            behind.push_back({wrap(head - s->cars[i]->_distFromStartLine), i});
    std::sort(behind.begin(), behind.end());
    double previous = 0;
    bool chained = true;
    for (const auto &[back, i] : behind)
    {
        chained = chained && back - previous <= caughtGap;
        if (chained)
            cars[i].caught = true;
        previous = back;
    }
}

void updateCars(tSituation *s, double dt)
{
    chainQueue(s);
    for (int i = 0; i < s->_ncars; i++)
    {
        CarState &c = cars[i];
        tCarElt *car = s->cars[i];
        if (!racingCar(s, i))
            continue;
        findAhead(s, i);
        if (aiDriven(i))
            sdAiSetSpeedCap(i, capFor(s, i));
        if (car->_laps != c.laps)
        {
            c.laps = car->_laps;
            c.crossed = true;
        }
        if (!deltaPeriod())
            continue;
        if (inLane(car))
        {
            c.caught = false;
            continue;
        }
        if ((!c.caught || !safetyCarOut()) && !aiDriven(i))
        {
            double reference = std::max(1.0, pace(car->_distFromStartLine, deltaShare));
            c.delta += dt * (1.0 - fabs(car->_speed_x) / reference);
            int sector = std::min(marshalSectors - 1, (int)(wrap(car->_distFromStartLine) / length * marshalSectors));
            if (sector != c.sector && c.sector >= 0 && c.delta < 0)
                c.redSectors++;
            c.sector = sector;
        }
        bool strung = safetyCarOut() && c.caught && c.aheadGap > queueGap && !aiDriven(i);
        c.gapClock = strung ? c.gapClock + dt : 0;
        if (c.gapClock > gapTimeLimit && !c.gapPenalised)
        {
            c.gapPenalised = true;
            sdStewardsDecide(i, O_SC_GAP, P_TIME5, 0, -1, car->_distFromStartLine, 9.0, 0);
        }
    }
}

bool exemptPass(tSituation *s, int k)
{
    tCarElt *car = s->cars[k];
    double reference = pace(car->_distFromStartLine, deltaShare);
    return cars[k].stopAny > 0 || inLane(car) || fabs(car->_speed_x) < reference * troubledShare;
}

void notePass(tSituation *s, int i, int k)
{
    CarState &c = cars[i];
    std::vector<Pass> &back = cars[k].passes;
    auto returned = std::find_if(back.begin(), back.end(), [i](const Pass &p) { return p.other == i; });
    if (returned != back.end())
    {
        back.erase(returned);
        return;
    }
    if (exemptPass(s, k))
        return;
    if (state == RC_RESTART)
    {
        if (!c.crossed)
            sdStewardsDecide(i, O_RESTART_OVERTAKE, P_DRIVE_THROUGH, 1, k, s->cars[i]->_distFromStartLine, 9.0, 2);
        return;
    }
    c.passes.push_back({k, now});
}

void trackPasses(tSituation *s)
{
    bool watching = neutral() || state == RC_RESTART;
    for (int i = 0; i < s->_ncars; i++)
    {
        CarState &c = cars[i];
        tCarElt *car = s->cars[i];
        bool eligible = watching && racingCar(s, i) && !inLane(car);
        for (int k = 0; k < s->_ncars; k++)
        {
            if (k == i)
                continue;
            signed char &was = order[i][k];
            double gap = progress(s->cars[k]) - progress(car);
            if (!eligible || !racingCar(s, k) || inLane(s->cars[k]) || fabs(gap) > passRange)
            {
                was = 0;
                continue;
            }
            signed char ahead = gap > 0 ? 1 : -1;
            if (was == 1 && ahead == -1)
                notePass(s, i, k);
            was = ahead;
        }
        if (!eligible || !scVisible || scPitDistance >= 0)
        {
            c.scSide = 0;
            continue;
        }
        double side = signedGap(car->_distFromStartLine, wrap(scProgress));
        if (fabs(side) < passRange)
        {
            if (c.scSide > 0 && side < 0)
                c.scPassAt = now;
            if (c.scSide < 0 && side > 0)
                c.scPassAt = -1;
            c.scSide = side;
        }
        else
            c.scSide = 0;
    }
}

bool cleared(const Hazard &h)
{
    if (h.any)
    {
        clearSince = -1;
        return false;
    }
    if (clearSince < 0)
        clearSince = now;
    return now - clearSince > clearHold;
}

bool queueFormed(tSituation *s)
{
    int racing = 0, caught = 0;
    double head = wrap(scProgress);
    for (int i = 0; i < s->_ncars; i++)
    {
        if (!racingCar(s, i) || inLane(s->cars[i]))
            continue;
        if (wrap(head - s->cars[i]->_distFromStartLine) > length / 2)
            continue;
        racing++;
        if (cars[i].caught)
            caught++;
    }
    return racing == 0 || caught >= racing || (caught >= queueShare * racing && now - since > queueTimeout);
}

void advance(tSituation *s, const Hazard &h, bool pitted)
{
    switch (state)
    {
    case RC_FORMATION:
    {
        int leader = leaderOnRoad(s);
        double driven = leader >= 0 ? progress(s->cars[leader]) - cars[leader].startProgress : 0.0;
        if (driven > length - lineupBefore || now > -countdown - 1.0)
            formationLineup(s);
        break;
    }
    case RC_LIGHTS:
        if (now < signalTime)
            break;
        if (initialRolling)
            startRolling(s);
        else
        {
            enter(RC_GREEN);
            if (restarts > 0)
                announce(EV_GREEN, 0);
        }
        break;
    case RC_GREEN:
        if (sdSessionChequered())
            break;
        if (h.red)
            startRed(s);
        else if (h.sc)
            deploySafetyCar(s);
        else if (h.vsc)
            deployVsc(s);
        break;
    case RC_VSC:
        if (h.red)
            startRed(s);
        else if (h.sc)
            deploySafetyCar(s);
        else if (cleared(h) && now - since > vscMinimum)
        {
            enter(RC_VSC_ENDING);
            announce(EV_VSC_ENDING, vscEndingTime);
        }
        break;
    case RC_VSC_ENDING:
        if (now - since > vscEndingTime)
        {
            endPeriod(s);
            enter(RC_GREEN);
            announce(EV_GREEN, 0);
        }
        break;
    case RC_SC:
        if (h.red)
            startRed(s);
        else if (cleared(h) && now - since > scMinimum && queueFormed(s))
        {
            scLightsOn = false;
            enter(RC_SC_IN);
            announce(EV_SC_IN, 0);
        }
        break;
    case RC_SC_IN:
        if (pitted)
        {
            endPeriod(s);
            for (CarState &c : cars)
                c.crossed = false;
            enter(RC_RESTART);
        }
        break;
    case RC_RESTART:
    {
        int leader = leaderOnRoad(s);
        if (leader < 0 || cars[leader].crossed)
        {
            enter(RC_GREEN);
            announce(EV_GREEN, 0);
        }
        break;
    }
    case RC_RED:
        if (now - since > redSlowdown)
        {
            endPeriod(s);
            redFlagLineup(s);
        }
        break;
    case RC_SUSPENDED:
        if (now - since > suspendedTime)
            resumeLights(s);
        break;
    }
}

}

double sdRaceControlStartOffset(int sessionKind)
{
    return sessionKind == kindRace && formationLap ? formationBudget : 0.0;
}

void sdRaceControlBegin(tSituation *s, int sessionKind)
{
    kind = sessionKind;
    length = std::max(1.0, (double)ReInfo->track->length);
    lineLap = lapOnLine();
    now = s->currentTime;
    cars.assign(s->_ncars, CarState());
    order.assign(s->_ncars, std::vector<signed char>(s->_ncars, 0));
    scVisible = false;
    scLightsOn = false;
    scPitDistance = -1;
    lineups = 0;
    restarts = 0;
    signalTime = 0;
    countdown = -(s->currentTime + sdRaceControlStartOffset(kind));
    initialRolling = kind == kindRace && rollingStart;
    period = RC_GREEN;
    clearSince = -1;
    for (int i = 0; i < s->_ncars; i++)
    {
        cars[i].laps = s->cars[i]->_laps;
        cars[i].startProgress = progress(s->cars[i]);
    }
    if (kind != kindRace)
    {
        enter(RC_GREEN);
        return;
    }
    if (formationLap)
    {
        enter(RC_FORMATION);
        announce(EV_FORMATION, 0);
        return;
    }
    enter(RC_LIGHTS);
}

void sdRaceControlTick(tSituation *s, double dt)
{
    if (kind != kindRace || (int)cars.size() != s->_ncars)
        return;
    now = s->currentTime;
    Hazard h = scan(s, dt);
    hazardCar = h.source;
    bool pitted = moveSafetyCar(dt);
    advance(s, h, pitted);
    updateCars(s, dt);
    trackPasses(s);
}

bool sdRaceControlHolding(tSituation *s)
{
    if (kind != kindRace)
        return s->currentTime < 0;
    if (state == RC_FORMATION)
        return false;
    if (state == RC_SUSPENDED)
        return true;
    return s->currentTime < signalTime;
}

bool sdRaceControlFormation()
{
    return kind == kindRace && state == RC_FORMATION;
}

bool sdRaceControlNeutralised()
{
    return kind == kindRace && neutral();
}

double sdRaceControlSinceSignal(tSituation *s)
{
    return s->currentTime - (kind == kindRace ? signalTime : 0.0);
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdRaceControlConfigure(int safetyCar, int red, int formation, int rolling)
{
    level = std::max(0, std::min(3, safetyCar));
    redFlags = red != 0;
    formationLap = formation != 0;
    rollingStart = rolling != 0;
}

EMSCRIPTEN_KEEPALIVE int sdRaceControlDeploy(int which)
{
    tSituation *s = ReInfo->s;
    now = s->currentTime;
    if (kind != kindRace || state != RC_GREEN)
        return 0;
    if (which == 1)
        deployVsc(s);
    else if (which == 2)
        deploySafetyCar(s);
    else if (which == 3)
        startRed(s);
    else
        return 0;
    return 1;
}

EMSCRIPTEN_KEEPALIVE void sdRaceControlInfo(double *out)
{
    for (int k = 0; k < outFields; k++)
        out[k] = 0;
    out[0] = state;
    out[1] = scVisible ? 1 : 0;
    out[2] = wrap(scProgress);
    out[3] = scSpeed;
    out[4] = signalTime;
    out[5] = countdown;
    out[8] = now - since;
    out[9] = state == RC_SUSPENDED ? std::max(0.0, suspendedTime - (now - since)) : 0.0;
    out[10] = lineups;
    out[11] = scLightsOn ? 1 : 0;
    out[12] = state == RC_VSC_ENDING ? std::max(0.0, vscEndingTime - (now - since)) : 0.0;
    out[14] = restarts;
    if (cars.empty())
        return;
    out[6] = cars[0].delta;
    out[7] = cars[0].redSectors;
    out[13] = cars[0].aheadGap;
    out[15] = cars[0].caught ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int sdSafetyCarPose(double *out)
{
    for (int k = 0; k < 16; k++)
        out[k] = 0;
    if (!scVisible)
        return 0;
    double distance = wrap(scProgress);
    double race = sdAiRacingLine(distance);
    double lateral = race;
    if (scPitDistance >= 0)
    {
        double t = std::min(1.0, scPitDistance / pitBlend);
        lateral = race + (sdAiFastLane(distance) - race) * t * t * (3 - 2 * t);
    }
    float a[3], b[3];
    if (sdTrackLocal2Global(distance, lateral, a) != 0 || sdTrackLocal2Global(distance + 2.0, lateral, b) != 0)
        return 0;
    double yaw = atan2(b[1] - a[1], b[0] - a[0]);
    double c = cos(yaw), sn = sin(yaw);
    out[0] = c;
    out[1] = sn;
    out[4] = -sn;
    out[5] = c;
    out[10] = 1;
    out[12] = a[0];
    out[13] = a[1];
    out[14] = a[2];
    out[15] = 1;
    return 1;
}

}

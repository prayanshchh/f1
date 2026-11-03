#include <algorithm>
#include <cmath>
#include <deque>
#include <vector>
#include <emscripten/emscripten.h>

#include <tgf.h>
#include <robottools.h>

#include "sim.h"
#include "ai.h"
#include "game.h"
#include "session.h"
#include "stewards.h"
#include "race-control.h"

namespace
{

enum Kind
{
    KIND_SOLO,
    KIND_RACE,
    KIND_QUALIFYING,
    KIND_LAPPING
};

const int historySize = 256;
const int bins = 512;
const int lapsKept = 3;
const int marshalSectors = 24;
const int messageCapacity = 256;
const int messageFields = 12;
const int carFields = 16;
const double defaultLightInterval = 1.0;
const int thirdLight = 2;
const double jumpTolerance = 0.25;
const double gridBoxFront = 0.6;
const double rollingAtStart = 1.0;
const double clearJump = 10.0;
const double startNoteDelay = 2.0;
const double startDecisionDelay = 14.0;
const double tyreEdgeTolerance = 0.03;
const double offConfirm = 0.04;
const double onConfirm = 0.3;
const double settleTime = 3.0;
const double lostControlSlip = 0.35;
const double spinSlip = 0.5;
const double contactExempt = 2.0;
const double openingDistance = 1000.0;
const double openingCrowd = 10.0;
const double benefitShare = 0.06;
const double timeGainPenalty = 1.0;
const double giveBackWindow = 20.0;
const double giveBackGap = 0.04;
const double aheadWindow = 0.06;
const int strikesBeforeFlag = 3;
const double trackLimitDecisionDelay = 6.0;
const double rejoinWindow = 3.0;
const double rejoinBehind = 80.0;
const double rejoinSwerveBehind = 25.0;
const double rejoinSwerveLateral = 4.0;
const double contactRange = 6.5;
const double contactDebounce = 1.5;
const double consequenceWindow = 4.0;
const double decisionDelay = 9.0;
const double minorClosing = 1.5;
const double recklessClosing = 15.0;
const double divedClosing = 6.0;
const double strandedSpeed = 8.0;
const double damageConsequence = 0.03;
const double heavyWreckage = 1.0;
const double sideBySideLateral = 1.1;
const double rearEndGap = 3.0;
const double moveWindow = 0.6;
const double moveMargin = 0.2;
const double moveClear = 0.6;
const double moveUnderBraking = 0.8;
const double brakingCmd = 0.3;
const double cornerCurvature = 1.0 / 350.0;
const double mirrorOffset = 0.4;
const double entryLook = 0.8;
const double forcingOverlap = 5.0;
const double forcingLateral = 3.2;
const double forcingMove = 0.5;
const double blueGap = 1.0;
const double blueSectors = 3.0;
const double troubleSpeed = 3.0;
const double troubleShare = 0.5;
const double holdBehind = 0.7;
const double referenceSettle = 60.0;
const double stoppedSpeed = 2.0;
const double troubleConfirm = 1.0;
const double stoppedConfirm = 2.0;
const double flagLinger = 2.0;
const double playerContactWindow = 10.0;
const double startGrace = 3.0;
const double nearEdge = 4.0;
const double singleSlowdown = 1.05;
const double doubleSlowdown = 1.15;
const double cautionSingle = 0.9;
const double cautionDouble = 0.8;
const double cautionLook = 150.0;
const double passRange = 60.0;
const double impedeBehind = 30.0;
const double impedeTime = 1.0;
const double impedeLoss = 0.93;
const double impedeSlow = 0.9;
const double impedeCooldown = 30.0;
const double overspeedTolerance = 1.0 / 3.6;
const double speedLineOffset = 15.0;
const double releaseStop = 1.0;
const double releaseLane = 2.5;
const double releaseGap = 12.0;
const double releaseSpeed = 8.0;
const double overspeedDriveThrough = 6.0 / 3.6;
const double overspeedStopGo = 15.0 / 3.6;
const double defendBehind = 15.0;
const double defendSpeed = 50.0;
const double defendOffset = 1.0;
const double straightBehind = 100.0;
const double straightAhead = 150.0;
const double straightStep = 25.0;
const double straightCurvature = 1.0 / 500.0;
const double defendMove = 1.0;
const double brakingDefendBehind = 15.0;
const double stoppedService = 0.3;
const double stopCounted = 0.5;
const double stopGoSeconds = 10.0;
const double lateDriveThrough = 20.0;
const double lateStopGo = 30.0;
const int lateLaps = 3;
const int crossingsAllowed = 2;
const double serveTolerance = 0.05;
const int collisionPoints = 4;
const int forcingPoints = 3;
const int rejoinPoints = 2;
const int doubleYellowPoints = 3;
const int collisionGrid = 3;
const int impedingGrid = 3;
const int yellowGrid = 5;
const int doubleYellowGrid = 10;

struct Sample
{
    double t = -1e9;
    double s = 0;
    double lat = 0;
    double v = 0;
    double slip = 0;
    double brake = 0;
    bool off = false;
};

struct Excursion
{
    bool active = false;
    double start = 0;
    double end = 0;
    double distance = 0;
    double startProgress = 0;
    int lap = 0;
    double maxSlip = 0;
    double offClock = 0;
    double onClock = 0;
    bool forced = false;
    bool crowded = false;
    std::vector<int> ahead;
};

struct Serve
{
    int penalty;
    int offence;
    int crossingsLeft;
    double issued;
};

struct Visit
{
    bool inLane = false;
    double since = 0;
    double stopClock = 0;
    double maxStop = 0;
    double stopAtService = -1;
    bool serviced = false;
    bool inZone = false;
    double maxOver = 0;
};

struct Pass
{
    int other;
    int sector;
};

struct Car
{
    Sample history[historySize];
    int head = 0;
    int laps = 0;
    bool lapInvalid = false;
    bool nextInvalid = false;
    bool lastInvalid = false;
    int strikes = 0;
    int offTracks = 0;
    Excursion ex;
    bool settling = false;
    double settleAt = 0;
    Excursion done;
    double lastContact = -100;
    bool playerTrouble = false;
    double rejoinAt = -100;
    std::vector<int> rejoinBehindCars;
    double penalisedAt = -100;
    double owed = 0;
    double owedSince = 0;
    std::deque<Serve> queue;
    bool penaltyRequested = false;
    double timeAdded = 0;
    int points = 0;
    int reprimands = 0;
    int drivingReprimands = 0;
    int gridDrop = 0;
    bool disqualified = false;
    bool finishedSeen = false;
    float binTime[lapsKept][bins];
    unsigned char binClean[lapsKept][bins];
    float binSpeed[lapsKept][bins];
    int lastBin = -1;
    int lastBinLap = -1000;
    Visit visit;
    bool blue = false;
    int blueBy = -1;
    double blueDistance = 0;
    double lastDistance = 0;
    int giveBackTo = -1;
    double giveBackUntil = 0;
    double slowClock = 0;
    double stoppedClock = 0;
    int trouble = 0;
    int sector = -1;
    double sectorEnter = 0;
    int sectorFlag = 0;
    bool sectorClean = true;
    float sectorRef[marshalSectors];
    std::vector<Pass> passes;
    double impedeClock = 0;
    double impedeQuiet = 0;
    int defendBy = -1;
    int defendDir = 0;
    int defendMoves = 0;
    double defendFloor = 0;
    double defendFrom = 0;
    double brakeAnchor = 0;
    bool brakeDefending = false;
    int brakeWarnings = 0;
    double startX = 0;
    double startY = 0;
    double startDistance = 0;
    double thirdX = 0;
    double thirdY = 0;
};

struct Incident
{
    int blamed = -1;
    int victim = -1;
    int offence = O_COLLISION;
    double at = 0;
    double decideAt = 0;
    double distance = 0;
    double closing = 0;
    bool mitigating = false;
    bool reckless = false;
    bool consequence = false;
    double victimDamage = 0;
    double victimWreckage = 0;
    int victimPosition = 0;
    bool opening = false;
    bool rejoin = false;
    bool noted = false;
};

struct Message
{
    int id;
    double time;
    int lap;
    int car;
    int other;
    int offence;
    int stage;
    int penalty;
    double value;
    double distance;
    int count;
    int points;
};

struct Decision
{
    int car;
    int offence;
    int penalty;
    double value;
    int other;
    double distance;
    double at;
    int points;
    bool cleared = false;
};

Kind kind = KIND_SOLO;
int totalLaps = 0;
double lightInterval = defaultLightInterval;
bool trackLimitsOn = false;
double startClock = 0;
double signalTime = 0;
bool started = false;
bool thirdTaken = false;
double length = 1;
int carCount = 0;
std::vector<Car> cars;
std::vector<Incident> incidents;
std::vector<Decision> decisions;
std::vector<std::vector<double>> pairContact;
std::vector<std::vector<signed char>> pairOrder;
std::deque<Message> messages;
int nextMessage = 1;
int flags[marshalSectors];
double flagUntil[marshalSectors];
int flagLevel[marshalSectors];
int flagCar[marshalSectors];
int hazard[marshalSectors];
double hazardUntil[marshalSectors];
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

int binOf(double distance)
{
    int b = (int)(wrap(distance) / length * bins);
    return std::min(bins - 1, std::max(0, b));
}

int sectorOf(double distance)
{
    int k = (int)(wrap(distance) / length * marshalSectors);
    return std::min(marshalSectors - 1, std::max(0, k));
}

double progress(tCarElt *car)
{
    return car->_distRaced;
}

int leaderLap()
{
    int lap = 1;
    for (int i = 0; i < ReInfo->s->_ncars; i++)
        lap = std::max(lap, ReInfo->s->cars[i]->_laps);
    return lap;
}

void post(int car, int other, int offence, int stage, int penalty, double value, double distance, int count, int points)
{
    int lap = car >= 0 ? std::max(1, ReInfo->s->cars[car]->_laps) : leaderLap();
    messages.push_back({nextMessage++, now, lap, car, other, offence, stage, penalty, value, distance, count, points});
    if ((int)messages.size() > messageCapacity)
        messages.pop_front();
}

Sample &sampleAt(Car &c, double t)
{
    int best = c.head;
    for (int k = 0; k < historySize; k++)
    {
        int i = (c.head - k + historySize) % historySize;
        best = i;
        if (c.history[i].t <= t)
            break;
    }
    return c.history[best];
}

Sample &latest(Car &c)
{
    return c.history[c.head];
}

double maxSlipBetween(Car &c, double from, double to)
{
    double slip = 0;
    for (int k = 0; k < historySize; k++)
    {
        const Sample &x = c.history[(c.head - k + historySize) % historySize];
        if (x.t < from)
            break;
        if (x.t <= to)
            slip = std::max(slip, fabs(x.slip));
    }
    return slip;
}

double maxBrakeBetween(Car &c, double from, double to)
{
    double brake = 0;
    for (int k = 0; k < historySize; k++)
    {
        const Sample &x = c.history[(c.head - k + historySize) % historySize];
        if (x.t < from)
            break;
        if (x.t <= to)
            brake = std::max(brake, x.brake);
    }
    return brake;
}

bool racing(int i)
{
    tCarElt *car = ReInfo->s->cars[i];
    if ((car->_state & RM_CAR_STATE_NO_SIMU) != 0 || cars[i].disqualified)
        return false;
    return sdSessionRacing(i);
}

bool inLaneAt(tCarElt *car)
{
    return sdAiInPitLaneAt(car->_distFromStartLine, car->_trkPos.toMiddle);
}

bool wheelsOff(int i)
{
    tCarElt *car = ReInfo->s->cars[i];
    tCar *sim = &SimCarTable[i];
    for (int w = 0; w < 4; w++)
    {
        tTrkLocPos pos;
        RtTrackGlobal2Local(car->_trkPos.seg, sim->wheel[w].pos.x, sim->wheel[w].pos.y, &pos, TR_LPOS_MAIN);
        double along = pos.seg->lgfromstart + (pos.seg->type == TR_STR ? pos.toStart : pos.toStart * pos.seg->radius);
        double left = 0, right = 0;
        if (!sdAiTrackEdges(along, &left, &right))
            return false;
        double half = car->_tireWidth(w) / 2;
        double lateral = pos.toMiddle;
        bool beyondLeft = lateral - half > left + tyreEdgeTolerance;
        bool beyondRight = lateral + half < right - tyreEdgeTolerance;
        if (!beyondLeft && !beyondRight)
            return false;
    }
    return true;
}

bool lapOne(int i)
{
    return ReInfo->s->cars[i]->_laps <= 1;
}

void deleteLap(int i)
{
    cars[i].lapInvalid = true;
}

void addGrid(int i, int places)
{
    cars[i].gridDrop += places;
}

void reprimand(int i, bool driving)
{
    cars[i].reprimands++;
    if (driving)
        cars[i].drivingReprimands++;
}

void issueAfterFinish(int i, int penalty)
{
    Car &c = cars[i];
    if (penalty == P_TIME5)
        c.timeAdded += 5;
    else if (penalty == P_TIME10)
        c.timeAdded += 10;
    else if (penalty == P_DRIVE_THROUGH)
        c.timeAdded += lateDriveThrough;
    else if (penalty == P_STOP_GO)
        c.timeAdded += lateStopGo;
}

void disqualify(int i, int offence)
{
    Car &c = cars[i];
    if (c.disqualified)
        return;
    c.disqualified = true;
    c.queue.clear();
    c.owed = 0;
    post(i, -1, offence, STAGE_DECISION, P_DISQUALIFIED, 0, ReInfo->s->cars[i]->_distFromStartLine, 0, 0);
    sdSessionDisqualify(i);
}

void apply(const Decision &d)
{
    if (d.cleared)
    {
        post(d.car, d.other, d.offence, STAGE_NO_ACTION, P_NONE, 0, d.distance, 0, 0);
        return;
    }
    if (d.penalty == P_NONE)
    {
        post(d.car, d.other, d.offence, STAGE_NOTED, P_NONE, 0, d.distance, 0, 0);
        return;
    }
    Car &c = cars[d.car];
    tCarElt *car = ReInfo->s->cars[d.car];
    c.penalisedAt = d.at;
    c.points += d.points;
    bool finished = sdSessionFinished(d.car);
    int penalty = d.penalty;
    double value = d.value;
    bool late = car->_laps >= totalLaps - lateLaps + 1;
    if (finished && (penalty == P_TIME5 || penalty == P_TIME10 || penalty == P_DRIVE_THROUGH || penalty == P_STOP_GO))
    {
        double before = c.timeAdded;
        issueAfterFinish(d.car, penalty);
        value = c.timeAdded - before;
        penalty = P_TIME_ADDED;
    }
    else if (late && (penalty == P_DRIVE_THROUGH || penalty == P_STOP_GO))
    {
        value = penalty == P_DRIVE_THROUGH ? lateDriveThrough : lateStopGo;
        c.timeAdded += value;
        penalty = P_TIME_ADDED;
    }
    else if (penalty == P_TIME5 || penalty == P_TIME10)
    {
        c.owed += penalty == P_TIME5 ? 5 : 10;
        c.owedSince = now;
        if (d.car != 0 || sdPlayerAutopilot())
            sdAiExtendStop(d.car, penalty == P_TIME5 ? 5 : 10);
    }
    else if (penalty == P_DRIVE_THROUGH || penalty == P_STOP_GO)
        c.queue.push_back({penalty, d.offence, crossingsAllowed, now});
    else if (penalty == P_DISQUALIFIED)
    {
        disqualify(d.car, d.offence);
        return;
    }
    else if (penalty == P_REPRIMAND)
        reprimand(d.car, d.offence != O_PIT_SPEEDING);
    else if (penalty == P_GRID)
        addGrid(d.car, (int)value);
    post(d.car, d.other, d.offence, STAGE_DECISION, penalty, value, d.distance, 0, d.points);
}

void decide(int car, int offence, int penalty, double value, int other, double distance, double delay, int points)
{
    if (penalty == P_NONE)
        return;
    if (delay <= 0)
    {
        apply({car, offence, penalty, value, other, distance, now, points});
        return;
    }
    post(car, other, offence, STAGE_NOTED, P_NONE, 0, distance, 0, 0);
    decisions.push_back({car, offence, penalty, value, other, distance, now + delay, points});
}

void clear(int car, int offence, int other, double distance)
{
    post(car, other, offence, STAGE_NOTED, P_NONE, 0, distance, 0, 0);
    decisions.push_back({car, offence, P_NONE, 0, other, distance, now + decisionDelay, 0, true});
}

int incrementOf(int penalty)
{
    if (penalty == P_TIME5)
        return P_TIME10;
    if (penalty == P_TIME10)
        return P_DRIVE_THROUGH;
    if (penalty == P_DRIVE_THROUGH)
        return P_STOP_GO;
    return P_DISQUALIFIED;
}

int racePenalty(int penalty)
{
    return kind == KIND_RACE ? penalty : P_NONE;
}

int drivingPenalty(bool consequence, bool mitigating)
{
    if (kind == KIND_RACE)
        return consequence && !mitigating ? P_TIME10 : P_TIME5;
    if (kind == KIND_QUALIFYING)
        return consequence ? P_GRID : P_REPRIMAND;
    return P_REPRIMAND;
}

void record(tSituation *s, int i)
{
    Car &c = cars[i];
    tCarElt *car = s->cars[i];
    c.head = (c.head + 1) % historySize;
    Sample &x = c.history[c.head];
    x.t = now;
    x.s = progress(car);
    x.lat = car->_trkPos.toMiddle;
    x.v = car->_speed_x;
    x.slip = fabs(car->_speed_x) > 5.0 ? atan2(car->_speed_y, fabs(car->_speed_x)) : 0.0;
    x.brake = car->_brakeCmd;
    x.off = c.ex.active;
}

void rollLap(tSituation *s, int i)
{
    Car &c = cars[i];
    tCarElt *car = s->cars[i];
    if (car->_laps == c.laps)
        return;
    c.laps = car->_laps;
    if (now < 0)
        return;
    c.lastInvalid = c.lapInvalid;
    c.lapInvalid = c.nextInvalid;
    c.nextInvalid = false;
    for (Serve &serve : c.queue)
    {
        if (c.visit.inLane)
            continue;
        serve.crossingsLeft--;
    }
    if (!c.queue.empty() && c.queue.front().crossingsLeft < 0 && !sdSessionFinished(i))
        disqualify(i, O_PENALTY_NOT_SERVED);
}

void recordBins(tSituation *s, int i)
{
    Car &c = cars[i];
    tCarElt *car = s->cars[i];
    int b = binOf(car->_distFromStartLine);
    int lap = car->_laps;
    if (b == c.lastBin && lap == c.lastBinLap)
        return;
    int slot = ((lap % lapsKept) + lapsKept) % lapsKept;
    if (lap != c.lastBinLap)
        for (int k = 0; k < bins; k++)
        {
            c.binTime[slot][k] = -1;
            c.binClean[slot][k] = 0;
        }
    c.binTime[slot][b] = (float)now;
    c.binSpeed[slot][b] = (float)fabs(car->_speed_x);
    c.binClean[slot][b] = !c.ex.active && !c.visit.inLane && flags[sectorOf(car->_distFromStartLine)] == 0;
    c.lastBin = b;
    c.lastBinLap = lap;
}

double sectionTime(Car &c, int lap, int from, int to)
{
    int slot = ((lap % lapsKept) + lapsKept) % lapsKept;
    double a = c.binTime[slot][from];
    double b = c.binTime[slot][to];
    if (a < 0 || b < 0 || b <= a)
        return -1;
    for (int k = from; k != to; k = (k + 1) % bins)
        if (!c.binClean[slot][k] && c.binTime[slot][k] >= 0)
            return -1;
    return b - a;
}

double timeGained(int i, const Excursion &ex)
{
    Car &c = cars[i];
    tCarElt *car = ReInfo->s->cars[i];
    int from = (binOf(ex.distance) - 2 + bins) % bins;
    int to = binOf(car->_distFromStartLine);
    if (from == to)
        return 0;
    int lapNow = car->_laps;
    int lapFrom = binOf(ex.distance) - 2 < 0 || to < from ? lapNow - 1 : lapNow;
    if (lapFrom != lapNow)
        return 0;
    int slot = ((lapNow % lapsKept) + lapsKept) % lapsKept;
    double a = c.binTime[slot][from];
    double b = c.binTime[slot][to];
    if (a < 0 || b <= a)
        return 0;
    double before = sectionTime(c, lapNow - 1, from, to);
    if (before < 0)
        return 0;
    return before - (b - a);
}

std::vector<int> carsAhead(tSituation *s, int i)
{
    std::vector<int> ahead;
    double mine = progress(s->cars[i]);
    for (int k = 0; k < s->_ncars; k++)
    {
        if (k == i || !racing(k))
            continue;
        double gap = progress(s->cars[k]) - mine;
        if (gap > 0 && gap < aheadWindow * length)
            ahead.push_back(k);
    }
    return ahead;
}

double frontAxle(tCarElt *car)
{
    return (car->priv.wheel[FRNT_RGT].relPos.x + car->priv.wheel[FRNT_LFT].relPos.x) / 2.0;
}

double moveToward(Car &mover, Car &other, double t)
{
    const Sample &a0 = sampleAt(mover, t - moveWindow);
    const Sample &a1 = sampleAt(mover, t);
    const Sample &b1 = sampleAt(other, t);
    double side = b1.lat > a1.lat ? 1.0 : -1.0;
    return (a1.lat - a0.lat) * side;
}

struct Judgement
{
    int blamed = -1;
    int victim = -1;
    double closing = 0;
    bool dived = false;
};

Judgement judge(tSituation *s, int a, int b, double t)
{
    Judgement j;
    Car &ca = cars[a];
    Car &cb = cars[b];
    const Sample &a1 = sampleAt(ca, t - 1.0);
    const Sample &b1 = sampleAt(cb, t - 1.0);
    int att = a1.s < b1.s ? a : b;
    int def = att == a ? b : a;
    Car &A = cars[att];
    Car &D = cars[def];
    const Sample &an = sampleAt(A, t);
    const Sample &dn = sampleAt(D, t);
    const Sample &ae = sampleAt(A, t - entryLook);
    const Sample &de = sampleAt(D, t - entryLook);
    double xf = frontAxle(s->cars[att]);
    double dLat = an.lat - dn.lat;
    double dS = dn.s - an.s;
    j.closing = std::max(0.0, ae.v - de.v);
    double moveA = moveToward(A, D, t);
    double moveD = moveToward(D, A, t);
    bool lostA = maxSlipBetween(A, t - 1.5, t) > lostControlSlip;
    bool lostD = maxSlipBetween(D, t - 1.5, t) > lostControlSlip;
    j.dived = j.closing > divedClosing;
    if (fabs(dLat) <= sideBySideLateral && dS > rearEndGap)
    {
        bool stranded = D.trouble > 0 || de.v < strandedSpeed;
        if ((lostD && !lostA) || stranded)
            return j;
        bool brakingMove = moveD > moveUnderBraking && maxBrakeBetween(D, t - 1.0, t) > brakingCmd;
        j.blamed = brakingMove ? def : att;
        j.victim = brakingMove ? att : def;
        return j;
    }
    double curvature = sdAiCurvature(s->cars[def]->_distFromStartLine);
    bool corner = fabs(curvature) > cornerCurvature;
    bool inside = corner && (curvature > 0 ? dLat > 0 : dLat < 0);
    const auto alongsideMirror = [&](const Sample &x, const Sample &y) { return x.s + xf >= y.s + mirrorOffset; };
    const auto aheadFront = [&](const Sample &x, const Sample &y) { return x.s + xf > y.s + xf; };
    bool entitled;
    if (!corner)
        entitled = alongsideMirror(ae, de);
    else if (inside)
        entitled = alongsideMirror(ae, de) && alongsideMirror(an, dn) && !lostA && !j.dived;
    else
        entitled = aheadFront(an, dn) && !lostA;
    int mover = moveA > moveD + moveMargin ? att : moveD > moveA + moveMargin ? def : -1;
    if (mover == def && entitled)
    {
        j.blamed = def;
        j.victim = att;
    }
    else if (mover == att && (!entitled || moveA > moveClear))
    {
        j.blamed = att;
        j.victim = def;
    }
    else if (!entitled && j.dived)
    {
        j.blamed = att;
        j.victim = def;
    }
    return j;
}

void noteContact(tSituation *s, int a, int b)
{
    Car &ca = cars[a];
    Car &cb = cars[b];
    ca.lastContact = now;
    cb.lastContact = now;
    for (int r : {a, b})
    {
        int other = r == a ? b : a;
        Car &c = cars[r];
        if (now - c.rejoinAt < rejoinWindow && std::find(c.rejoinBehindCars.begin(), c.rejoinBehindCars.end(), other) != c.rejoinBehindCars.end())
        {
            c.rejoinAt = -100;
            Incident in;
            in.blamed = r;
            in.victim = other;
            in.offence = O_UNSAFE_REJOIN;
            in.at = now;
            in.decideAt = now + consequenceWindow;
            in.distance = s->cars[r]->_distFromStartLine;
            in.rejoin = true;
            incidents.push_back(in);
            return;
        }
    }
    Judgement j = judge(s, a, b, now);
    Incident in;
    in.blamed = j.blamed;
    in.victim = j.victim;
    in.at = now;
    in.decideAt = now + consequenceWindow;
    in.distance = s->cars[a]->_distFromStartLine;
    in.closing = j.closing;
    in.reckless = j.blamed >= 0 && j.closing > recklessClosing && j.dived;
    in.opening = lapOne(a) && s->cars[a]->_distFromStartLine < openingDistance;
    if (in.victim >= 0)
    {
        in.victimDamage = sdCarDamageShare(in.victim);
        in.victimWreckage = sdCarWreckage(in.victim);
        in.victimPosition = sdSessionPositionOf(in.victim);
    }
    in.mitigating = j.blamed >= 0 && maxSlipBetween(cars[j.blamed], now - 1.5, now) > lostControlSlip;
    incidents.push_back(in);
}

void contacts(tSituation *s)
{
    for (int a = 0; a < s->_ncars; a++)
    {
        if (!(SimCarTable[a].collision & SEM_COLLISION_CAR))
            continue;
        for (int b = a + 1; b < s->_ncars; b++)
        {
            if (!(SimCarTable[b].collision & SEM_COLLISION_CAR))
                continue;
            tCarElt *x = s->cars[a];
            tCarElt *y = s->cars[b];
            if (hypot(x->_pos_X - y->_pos_X, x->_pos_Y - y->_pos_Y) > contactRange)
                continue;
            double &last = pairContact[a][b];
            bool fresh = now - last > contactDebounce;
            last = now;
            if (!fresh || now < 0 || inLaneAt(x) || inLaneAt(y) || !racing(a) || !racing(b))
            {
                cars[a].lastContact = now;
                cars[b].lastContact = now;
                continue;
            }
            noteContact(s, a, b);
        }
    }
}

bool consequenceFor(tSituation *s, const Incident &in)
{
    if (in.victim < 0)
        return false;
    Car &v = cars[in.victim];
    if (maxSlipBetween(v, in.at, now) > spinSlip)
        return true;
    if (v.ex.active || (v.done.start >= in.at && v.done.start > 0) || (v.ex.start >= in.at && v.ex.start > 0))
        return true;
    if (sdCarDamageShare(in.victim) - in.victimDamage > damageConsequence)
        return true;
    if (!racing(in.victim))
        return true;
    return sdSessionPositionOf(in.victim) > in.victimPosition;
}

bool hurtAi(const Incident &in)
{
    if (in.blamed != 0 || in.victim <= 0)
        return true;
    if (maxSlipBetween(cars[in.victim], in.at, now) > spinSlip)
        return true;
    return !racing(in.victim) || sdCarWreckage(in.victim) - in.victimWreckage >= heavyWreckage;
}

void resolveIncidents(tSituation *s)
{
    for (Incident &in : incidents)
    {
        if (in.noted || now < in.decideAt)
            continue;
        in.noted = true;
        if (in.blamed < 0)
            continue;
        if (!racing(in.blamed) && !sdSessionFinished(in.blamed))
            continue;
        if (!hurtAi(in))
        {
            clear(in.blamed, in.rejoin ? O_UNSAFE_REJOIN : in.offence, in.victim, in.distance);
            continue;
        }
        if (in.rejoin)
        {
            int penalty = kind == KIND_RACE ? P_TIME5 : kind == KIND_QUALIFYING ? P_GRID : P_REPRIMAND;
            decide(in.blamed, O_UNSAFE_REJOIN, penalty, penalty == P_GRID ? collisionGrid : 0, in.victim, in.distance, decisionDelay, kind == KIND_RACE ? rejoinPoints : 0);
            continue;
        }
        bool consequence = consequenceFor(s, in);
        if (in.opening && !consequence)
            continue;
        if (!consequence && in.closing < minorClosing)
        {
            if (in.blamed == 0 || in.victim == 0)
                post(in.blamed, in.victim, in.offence, STAGE_NO_ACTION, P_NONE, 0, in.distance, 0, 0);
            continue;
        }
        if (in.reckless && kind == KIND_RACE)
        {
            decide(in.blamed, in.offence, P_STOP_GO, 0, in.victim, in.distance, decisionDelay, in.offence == O_FORCING_OFF ? forcingPoints : collisionPoints);
            continue;
        }
        int penalty = drivingPenalty(consequence, in.mitigating || in.opening);
        decide(in.blamed, in.offence, penalty, penalty == P_GRID ? collisionGrid : 0, in.victim, in.distance, decisionDelay, 0);
    }
    incidents.erase(std::remove_if(incidents.begin(), incidents.end(), [](const Incident &in) { return in.noted; }), incidents.end());
}

void resolveDecisions()
{
    std::vector<Decision> due;
    for (const Decision &d : decisions)
        if (now >= d.at)
            due.push_back(d);
    decisions.erase(std::remove_if(decisions.begin(), decisions.end(), [](const Decision &d) { return now >= d.at; }), decisions.end());
    for (Decision d : due)
    {
        if (cars[d.car].disqualified)
            continue;
        d.at = now;
        apply(d);
    }
}

void checkForcing(tSituation *s, int i)
{
    Car &v = cars[i];
    for (int k = 0; k < s->_ncars; k++)
    {
        if (k == i || !racing(k))
            continue;
        Car &o = cars[k];
        const Sample &vn = latest(v);
        const Sample &on = latest(o);
        if (fabs(on.s - vn.s) > forcingOverlap || fabs(on.lat - vn.lat) > forcingLateral)
            continue;
        if (now - v.lastContact < contactExempt)
            continue;
        if (moveToward(o, v, now) < forcingMove || moveToward(o, v, now) < moveToward(v, o, now))
            continue;
        Judgement j = judge(s, i, k, now);
        if (j.blamed != k)
            continue;
        v.ex.forced = true;
        Incident in;
        in.blamed = k;
        in.victim = i;
        in.offence = O_FORCING_OFF;
        in.at = now;
        in.decideAt = now + consequenceWindow;
        in.distance = s->cars[i]->_distFromStartLine;
        in.closing = minorClosing;
        in.victimDamage = sdCarDamageShare(i);
        in.victimWreckage = sdCarWreckage(i);
        in.victimPosition = sdSessionPositionOf(i);
        in.opening = lapOne(i) && s->cars[i]->_distFromStartLine < openingDistance;
        incidents.push_back(in);
        return;
    }
}

bool crowdedAt(tSituation *s, int i)
{
    tCarElt *car = s->cars[i];
    for (int k = 0; k < s->_ncars; k++)
    {
        if (k == i || !racing(k))
            continue;
        tCarElt *o = s->cars[k];
        if (hypot(o->_pos_X - car->_pos_X, o->_pos_Y - car->_pos_Y) < openingCrowd)
            return true;
    }
    return false;
}

void startExcursion(tSituation *s, int i)
{
    Car &c = cars[i];
    tCarElt *car = s->cars[i];
    c.ex.active = true;
    c.ex.start = now;
    c.ex.distance = car->_distFromStartLine;
    c.ex.startProgress = progress(car);
    c.ex.lap = car->_laps;
    c.ex.maxSlip = maxSlipBetween(c, now - 0.5, now);
    c.ex.forced = false;
    c.ex.crowded = lapOne(i) && car->_distFromStartLine < openingDistance && crowdedAt(s, i);
    c.ex.ahead = kind == KIND_RACE ? carsAhead(s, i) : std::vector<int>();
    c.offTracks++;
    if (trackLimitsOn)
    {
        if (!c.lapInvalid)
            post(i, -1, O_TRACK_LIMITS, STAGE_WARNING, P_LAP_DELETED, 0, c.ex.distance, 0, 0);
        deleteLap(i);
        if (kind == KIND_QUALIFYING && wrap(car->_distFromStartLine) > length * (1.0 - benefitShare))
            c.nextInvalid = true;
    }
    if (kind != KIND_SOLO)
        checkForcing(s, i);
}

void endExcursion(tSituation *s, int i)
{
    Car &c = cars[i];
    c.ex.active = false;
    c.ex.end = now;
    c.done = c.ex;
    c.settling = true;
    c.settleAt = now + settleTime;
    c.rejoinAt = now;
    c.rejoinBehindCars.clear();
    double mine = progress(s->cars[i]);
    for (int k = 0; k < s->_ncars; k++)
    {
        if (k == i || !racing(k) || cars[k].ex.active)
            continue;
        double gap = mine - progress(s->cars[k]);
        if (gap > 0 && gap < rejoinBehind)
            c.rejoinBehindCars.push_back(k);
    }
}

void watchRejoinSwerve(tSituation *s, int i)
{
    for (int r = 0; r < s->_ncars; r++)
    {
        if (r == i)
            continue;
        Car &c = cars[r];
        if (now - c.rejoinAt > rejoinWindow)
            continue;
        if (std::find(c.rejoinBehindCars.begin(), c.rejoinBehindCars.end(), i) == c.rejoinBehindCars.end())
            continue;
        const Sample &x = latest(c);
        const Sample &y = latest(cars[i]);
        if (x.s - y.s > rejoinSwerveBehind || fabs(x.lat - y.lat) > rejoinSwerveLateral)
            continue;
        cars[i].ex.forced = true;
        c.rejoinAt = -100;
        Incident in;
        in.blamed = r;
        in.victim = i;
        in.offence = O_UNSAFE_REJOIN;
        in.at = now;
        in.decideAt = now + consequenceWindow;
        in.distance = s->cars[r]->_distFromStartLine;
        in.rejoin = true;
        incidents.push_back(in);
        return;
    }
}

void settle(tSituation *s, int i)
{
    Car &c = cars[i];
    c.settling = false;
    const Excursion &ex = c.done;
    double slip = std::max(ex.maxSlip, maxSlipBetween(c, ex.start - 0.5, ex.end));
    bool lostControl = slip > lostControlSlip;
    bool contact = c.lastContact >= ex.start - contactExempt && c.lastContact <= ex.end + 0.5;
    bool penalised = c.penalisedAt >= ex.start - settleTime && c.penalisedAt <= now;
    if (kind != KIND_RACE || !trackLimitsOn)
        return;
    bool advantage = false;
    if (!ex.forced && !lostControl && !contact)
    {
        double mine = progress(s->cars[i]);
        for (int k : ex.ahead)
        {
            if (!racing(k) || inLaneAt(s->cars[k]) || cars[k].ex.active)
                continue;
            if (mine > progress(s->cars[k]))
            {
                advantage = true;
                c.giveBackTo = k;
                c.giveBackUntil = now + giveBackWindow;
                post(i, k, O_LEFT_TRACK_POSITION, STAGE_INSTRUCTION, P_NONE, giveBackWindow, ex.distance, 0, 0);
                break;
            }
        }
        if (!advantage && timeGained(i, ex) >= timeGainPenalty)
        {
            advantage = true;
            decide(i, O_LEFT_TRACK_TIME, P_TIME5, 0, -1, ex.distance, decisionDelay, 0);
        }
    }
    if (advantage || ex.forced || lostControl || contact || ex.crowded || penalised)
        return;
    c.strikes++;
    if (c.strikes < strikesBeforeFlag)
        post(i, -1, O_TRACK_LIMITS, STAGE_WARNING, P_WARNING, 0, ex.distance, c.strikes, 0);
    else if (c.strikes == strikesBeforeFlag)
        post(i, -1, O_TRACK_LIMITS, STAGE_WARNING, P_BLACK_WHITE, 0, ex.distance, c.strikes, 0);
    else
        decide(i, O_TRACK_LIMITS, P_TIME5, 0, -1, ex.distance, trackLimitDecisionDelay, 0);
}

void trackLimits(tSituation *s, int i, double dt)
{
    Car &c = cars[i];
    tCarElt *car = s->cars[i];
    bool eligible = now > 0 && racing(i) && !inLaneAt(car) && !c.visit.inLane;
    bool off = eligible && wheelsOff(i);
    if (c.ex.active)
        c.ex.maxSlip = std::max(c.ex.maxSlip, fabs(latest(c).slip));
    if (off)
    {
        c.ex.onClock = 0;
        c.ex.offClock += dt;
        if (!c.ex.active && c.ex.offClock >= offConfirm)
        {
            startExcursion(s, i);
            if (kind != KIND_SOLO)
                watchRejoinSwerve(s, i);
        }
    }
    else
    {
        c.ex.offClock = 0;
        if (c.ex.active)
        {
            c.ex.onClock += dt;
            if (c.ex.onClock >= onConfirm || !eligible)
                endExcursion(s, i);
        }
    }
    if (c.settling && now >= c.settleAt)
        settle(s, i);
}

void giveBack(tSituation *s, int i)
{
    Car &c = cars[i];
    if (c.giveBackTo < 0)
        return;
    int k = c.giveBackTo;
    if (!racing(k) || inLaneAt(s->cars[k]))
    {
        c.giveBackTo = -1;
        return;
    }
    if (progress(s->cars[i]) < progress(s->cars[k]) - giveBackGap)
    {
        post(i, k, O_LEFT_TRACK_POSITION, STAGE_RETURNED, P_NONE, 0, s->cars[i]->_distFromStartLine, 0, 0);
        c.giveBackTo = -1;
        return;
    }
    if (now < c.giveBackUntil)
        return;
    c.giveBackTo = -1;
    decide(i, O_LEFT_TRACK_POSITION, P_TIME10, 0, k, c.done.distance, decisionDelay, 0);
}

void startProcedure(tSituation *s)
{
    if (kind != KIND_RACE || started)
        return;
    double third = startClock + thirdLight * lightInterval;
    if (!thirdTaken && now >= third && now < signalTime)
    {
        thirdTaken = true;
        for (int i = 0; i < s->_ncars; i++)
        {
            cars[i].thirdX = s->cars[i]->_pos_X;
            cars[i].thirdY = s->cars[i]->_pos_Y;
        }
    }
    if (now < signalTime)
        return;
    started = true;
    for (int i = 0; i < s->_ncars; i++)
    {
        tCarElt *car = s->cars[i];
        Car &c = cars[i];
        if (!racing(i))
            continue;
        double moved = thirdTaken ? hypot(car->_pos_X - c.thirdX, car->_pos_Y - c.thirdY) : 0.0;
        double forward = signedGap(c.startDistance, car->_distFromStartLine);
        int penalty = P_NONE;
        int offence = O_JUMP_START;
        if (moved > jumpTolerance)
            penalty = fabs(car->_speed_x) < rollingAtStart ? P_TIME5 : moved < clearJump ? P_TIME10 : P_DRIVE_THROUGH;
        else if (forward > gridBoxFront)
        {
            penalty = P_TIME5;
            offence = O_GRID_POSITION;
        }
        if (penalty == P_NONE)
            continue;
        decisions.push_back({i, offence, penalty, moved, -1, car->_distFromStartLine, now + startDecisionDelay, 0});
        Decision note = {i, offence, P_NONE, moved, -1, car->_distFromStartLine, now + startNoteDelay, 0};
        decisions.push_back(note);
    }
}

void unsafeRelease(tSituation *s, int i)
{
    tCarElt *car = s->cars[i];
    for (int k = 0; k < s->_ncars; k++)
    {
        tCarElt *other = s->cars[k];
        if (k == i || !racing(k) || !inLaneAt(other))
            continue;
        double behind = signedGap(other->_distFromStartLine, car->_distFromStartLine);
        bool fastLane = fabs(other->_trkPos.toMiddle - sdAiFastLane(other->_distFromStartLine)) < releaseLane;
        if (!fastLane || behind <= 0 || behind > releaseGap || other->_speed_x < releaseSpeed)
            continue;
        int penalty = kind == KIND_RACE ? P_TIME5 : P_REPRIMAND;
        decide(i, O_UNSAFE_RELEASE, penalty, 0, k, car->_distFromStartLine, decisionDelay, 0);
        return;
    }
}

void updateVisit(tSituation *s, int i, double dt)
{
    Car &c = cars[i];
    tCarElt *car = s->cars[i];
    Visit &v = c.visit;
    bool lane = inLaneAt(car) && now > 0;
    if (lane && !v.inLane)
        v = Visit{true, now, 0, 0, -1, false, false, 0};
    if (lane)
    {
        bool released = v.stopClock > releaseStop && fabs(car->_speed_x) >= stoppedService;
        if (released)
            unsafeRelease(s, i);
        if (fabs(car->_speed_x) < stoppedService)
            v.stopClock += dt;
        else
            v.stopClock = 0;
        v.maxStop = std::max(v.maxStop, v.stopClock);
        double from = 0, to = 0, limit = 0;
        sdAiPitZone(&from, &to, &limit);
        double along = wrap(car->_distFromStartLine - from - speedLineOffset);
        bool zone = along <= wrap(to - from - speedLineOffset);
        if (zone)
            v.maxOver = std::max(v.maxOver, (double)fabs(car->_speed_x) - limit);
        if (v.inZone && !zone)
        {
            double over = v.maxOver;
            v.maxOver = 0;
            if (over > overspeedTolerance)
            {
                int penalty = kind != KIND_RACE ? P_WARNING : over > overspeedStopGo ? P_STOP_GO : over > overspeedDriveThrough ? P_DRIVE_THROUGH : P_TIME5;
                if (penalty == P_WARNING)
                    post(i, -1, O_PIT_SPEEDING, STAGE_WARNING, P_WARNING, over * 3.6, car->_distFromStartLine, 0, 0);
                else
                    decide(i, O_PIT_SPEEDING, penalty, over * 3.6, -1, car->_distFromStartLine, decisionDelay, 0);
            }
        }
        v.inZone = zone;
        return;
    }
    if (!v.inLane)
        return;
    v.inLane = false;
    if (kind != KIND_RACE)
        return;
    bool stopped = v.maxStop > stopCounted;
    if (!c.queue.empty() && c.queue.front().issued < v.since)
    {
        Serve serve = c.queue.front();
        bool ok = serve.penalty == P_DRIVE_THROUGH ? !stopped : v.maxStop >= stopGoSeconds - serveTolerance && !v.serviced;
        c.queue.pop_front();
        c.penaltyRequested = false;
        if (ok)
            post(i, -1, serve.offence, STAGE_SERVED, serve.penalty, 0, car->_distFromStartLine, 0, 0);
        else
            decide(i, O_PENALTY_IMPROPER, incrementOf(serve.penalty), 0, -1, car->_distFromStartLine, 0, 0);
        return;
    }
    if (c.owed > 0 && stopped && c.owedSince < v.since)
    {
        double needed = c.owed;
        bool ok = v.serviced ? v.stopAtService >= needed - serveTolerance : v.maxStop >= needed - serveTolerance;
        int owedPenalty = needed > 5.5 ? P_TIME10 : P_TIME5;
        c.owed = 0;
        if (ok)
            post(i, -1, -1, STAGE_SERVED, owedPenalty, needed, car->_distFromStartLine, 0, 0);
        else
            decide(i, O_PENALTY_IMPROPER, incrementOf(owedPenalty), 0, -1, car->_distFromStartLine, 0, 0);
    }
}

void requestAiPenalty(tSituation *s, int i)
{
    Car &c = cars[i];
    if (i == 0 && !sdPlayerAutopilot())
        return;
    if (c.queue.empty() || c.penaltyRequested || c.visit.inLane)
        return;
    const Serve &serve = c.queue.front();
    c.penaltyRequested = sdAiRequestPenalty(i, serve.penalty == P_DRIVE_THROUGH, serve.penalty == P_STOP_GO ? stopGoSeconds + 0.3 : 0.0);
}

void finishCar(int i)
{
    Car &c = cars[i];
    if (c.finishedSeen || !sdSessionFinished(i))
        return;
    c.finishedSeen = true;
    if (c.owed > 0)
    {
        c.timeAdded += c.owed;
        post(i, -1, O_PENALTY_NOT_SERVED, STAGE_DECISION, P_TIME_ADDED, c.owed, 0, 0, 0);
        c.owed = 0;
    }
}

int troubleOf(tSituation *s, int i, double dt)
{
    Car &c = cars[i];
    tCarElt *car = s->cars[i];
    bool settled = sdRaceControlSinceSignal(s) > startGrace && !sdRaceControlHolding(s);
    bool watched = settled && (racing(i) || (car->_state & RM_CAR_STATE_NO_SIMU) == 0) && !inLaneAt(car) && !c.visit.inLane && !sdSessionFinished(i);
    double v = fabs(car->_speed_x);
    int lap = car->_laps - 1;
    int slot = ((lap % lapsKept) + lapsKept) % lapsKept;
    int bin = binOf(car->_distFromStartLine);
    double normal = c.binTime[slot][bin] >= 0 ? c.binSpeed[slot][bin] : 0.0;
    bool slow = normal > 0 ? v < normal * troubleShare : v < troubleSpeed;
    c.slowClock = watched && slow ? c.slowClock + dt : 0;
    c.stoppedClock = watched && v < stoppedSpeed ? c.stoppedClock + dt : 0;
    if (!watched)
        return 0;
    double left = 0, right = 0;
    bool near = true;
    if (sdAiTrackEdges(car->_distFromStartLine, &left, &right))
        near = car->_trkPos.toMiddle < left + nearEdge && car->_trkPos.toMiddle > right - nearEdge;
    if (c.stoppedClock >= stoppedConfirm && near)
        return 2;
    double confirm = normal > 0 ? troubleConfirm : stoppedConfirm;
    if (c.slowClock >= confirm || (c.ex.active && fabs(latest(c).slip) > lostControlSlip))
        return 1;
    return 0;
}

void raise(int *levels, int k, int trouble)
{
    levels[k] = std::max(levels[k], trouble);
    if (trouble == 2)
    {
        int before = (k - 1 + marshalSectors) % marshalSectors;
        levels[before] = std::max(levels[before], 1);
    }
}

void updateHazards(const int *seen)
{
    for (int k = 0; k < marshalSectors; k++)
    {
        if (seen[k] > 0)
        {
            hazard[k] = std::max(seen[k], now < hazardUntil[k] ? hazard[k] : 0);
            hazardUntil[k] = now + flagLinger;
        }
        if (now >= hazardUntil[k])
            hazard[k] = 0;
    }
}

void updateFlags(tSituation *s, double dt)
{
    int level[marshalSectors] = {0};
    int seen[marshalSectors] = {0};
    int source[marshalSectors];
    for (int k = 0; k < marshalSectors; k++)
        source[k] = -1;
    for (int i = 0; i < s->_ncars; i++)
    {
        Car &c = cars[i];
        c.trouble = kind == KIND_SOLO ? 0 : troubleOf(s, i, dt);
        bool touchedPlayer = i == 0 || now - pairContact[0][i] < playerContactWindow;
        c.playerTrouble = c.trouble > 0 && (touchedPlayer || c.playerTrouble);
        int k = sectorOf(s->cars[i]->_distFromStartLine);
        if (c.trouble > 0)
            raise(seen, k, c.trouble);
        if (!c.playerTrouble)
            continue;
        if (cars[i].trouble > level[k])
            source[k] = i;
        level[k] = std::max(level[k], cars[i].trouble);
        if (cars[i].trouble == 2)
        {
            int before = (k - 1 + marshalSectors) % marshalSectors;
            if (level[before] == 0)
                source[before] = i;
            level[before] = std::max(level[before], 1);
        }
    }
    updateHazards(seen);
    for (int k = 0; k < marshalSectors; k++)
    {
        int was = flags[k];
        if (level[k] > 0)
        {
            flagLevel[k] = std::max(level[k], now < flagUntil[k] ? flagLevel[k] : 0);
            flagUntil[k] = now + flagLinger;
        }
        if (now >= flagUntil[k])
            flagLevel[k] = 0;
        flags[k] = flagLevel[k];
        double middle = (k + 0.5) * length / marshalSectors;
        if (flags[k] > was && source[k] >= 0)
        {
            flagCar[k] = source[k];
            post(source[k], -1, flags[k] == 2 ? O_YELLOW_DOUBLE : O_YELLOW_SINGLE, STAGE_FLAG, P_NONE, k, middle, flags[k], 0);
        }
        else if (flags[k] == 0 && was > 0)
            post(std::max(0, flagCar[k]), -1, O_YELLOW_SINGLE, STAGE_CLEAR, P_NONE, k, middle, 0, 0);
    }
}

void yellowCompliance(tSituation *s, int i)
{
    Car &c = cars[i];
    tCarElt *car = s->cars[i];
    int k = sectorOf(car->_distFromStartLine);
    if (!racing(i) || sdRaceControlNeutralised())
    {
        c.sector = -1;
        if (i != 0 || sdPlayerAutopilot())
            sdAiSetCaution(i, 1.0);
        return;
    }
    double ahead = car->_distFromStartLine + cautionLook;
    int there = sectorOf(ahead);
    int caution = std::max(std::max(flags[k], flags[there]), std::max(hazard[k], hazard[there]));
    double mine = progress(car);
    if (i != 0 || sdPlayerAutopilot())
    {
        double factor = c.trouble > 0 ? 1.0 : caution == 2 ? cautionDouble : caution == 1 ? cautionSingle : 1.0;
        for (int o = 0; o < s->_ncars && caution > 0 && c.trouble == 0; o++)
        {
            double gap = progress(s->cars[o]) - mine;
            if (o != i && gap > 0 && gap < passRange && cars[o].trouble == 0 && racing(o))
                factor = std::min(factor, holdBehind);
        }
        sdAiSetCaution(i, factor);
    }
    bool underYellow = c.sectorFlag > 0 || flags[k] > 0;
    for (int o = 0; o < s->_ncars; o++)
    {
        if (o == i)
            continue;
        signed char &was = pairOrder[i][o];
        double gap = progress(s->cars[o]) - mine;
        if (fabs(gap) >= passRange || !racing(o) || inLaneAt(s->cars[o]))
        {
            was = 0;
            continue;
        }
        signed char order = gap > 0 ? 1 : -1;
        bool culprit = o == flagCar[k] || o == flagCar[c.sector < 0 ? k : c.sector];
        if (was == 1 && order == -1 && underYellow && cars[o].trouble == 0 && !culprit)
            c.passes.push_back({o, k});
        was = order;
    }
    if (k == c.sector)
        return;
    int left = c.sector;
    int flag = c.sectorFlag;
    double time = now - c.sectorEnter;
    bool clean = c.sectorClean;
    c.sector = k;
    c.sectorEnter = now;
    c.sectorFlag = flags[k];
    c.sectorClean = !c.ex.active && !c.visit.inLane && c.trouble == 0;
    if (left < 0)
        return;
    bool launched = c.sectorEnter - signalTime > referenceSettle;
    if (flag == 0)
    {
        if (clean && launched && !c.ex.active && c.trouble == 0)
            c.sectorRef[left] = c.sectorRef[left] > 0 ? std::min(c.sectorRef[left], (float)time) : (float)time;
        c.passes.clear();
        return;
    }
    if (c.trouble > 0)
    {
        c.passes.clear();
        return;
    }
    double need = flag == 2 ? doubleSlowdown : singleSlowdown;
    bool slowed = c.sectorRef[left] <= 0 || time >= c.sectorRef[left] * need;
    bool overtook = false;
    for (const Pass &p : c.passes)
        if (racing(p.other) && progress(s->cars[p.other]) < mine)
            overtook = true;
    c.passes.clear();
    if (flag == 2 && kind == KIND_QUALIFYING)
        deleteLap(i);
    if (slowed && !overtook)
        return;
    int offence = overtook ? O_YELLOW_OVERTAKE : flag == 2 ? O_YELLOW_DOUBLE : O_YELLOW_SINGLE;
    double distance = (left + 0.5) * length / marshalSectors;
    if (kind == KIND_RACE)
        decide(i, offence, flag == 2 ? P_STOP_GO : P_TIME10, 0, -1, distance, decisionDelay, flag == 2 ? doubleYellowPoints : 0);
    else if (kind == KIND_QUALIFYING)
        decide(i, offence, P_GRID, flag == 2 ? doubleYellowGrid : yellowGrid, -1, distance, decisionDelay, 0);
}

void blueFlags(tSituation *s, double dt)
{
    Car &c = cars[0];
    tCarElt *car = s->cars[0];
    double travelled = wrap(car->_distFromStartLine - c.lastDistance);
    c.lastDistance = car->_distFromStartLine;
    if (kind != KIND_RACE || sdPlayerAutopilot() || !racing(0) || now <= 0 || sdRaceControlNeutralised())
    {
        c.blue = false;
        return;
    }
    int lapper = -1;
    for (int k = 1; k < s->_ncars; k++)
    {
        if (!racing(k) || inLaneAt(s->cars[k]))
            continue;
        double behind = wrap(car->_distFromStartLine - s->cars[k]->_distFromStartLine);
        double lead = progress(s->cars[k]) - progress(car);
        if (lead > length / 2 && behind < std::max(10.0, (double)s->cars[k]->_speed_x) * blueGap)
            lapper = k;
    }
    if (lapper < 0 || c.visit.inLane)
    {
        c.blue = false;
        c.blueBy = -1;
        c.blueDistance = 0;
        return;
    }
    if (lapper != c.blueBy)
        c.blueDistance = 0;
    c.blue = true;
    c.blueBy = lapper;
    c.blueDistance += travelled < length / 2 ? travelled : 0;
    if (c.blueDistance >= blueSectors * length / marshalSectors)
    {
        c.blueDistance = -1e9;
        decide(0, O_BLUE_FLAGS, P_TIME5, 0, lapper, car->_distFromStartLine, decisionDelay, 0);
    }
}

void impeding(tSituation *s, double dt)
{
    Car &c = cars[0];
    tCarElt *car = s->cars[0];
    c.impedeQuiet = std::max(0.0, c.impedeQuiet - dt);
    if (kind != KIND_QUALIFYING || sdPlayerAutopilot() || !racing(0) || c.visit.inLane || c.impedeQuiet > 0)
    {
        c.impedeClock = 0;
        return;
    }
    bool impeded = false;
    int victim = -1;
    for (int k = 1; k < s->_ncars; k++)
    {
        if (!racing(k) || sdAiTask(k) != AI_PUSH_LAP)
            continue;
        double behind = signedGap(s->cars[k]->_distFromStartLine, car->_distFromStartLine);
        if (behind <= 0 || behind > impedeBehind)
            continue;
        Car &o = cars[k];
        int lap = s->cars[k]->_laps - 1;
        int slot = ((lap % lapsKept) + lapsKept) % lapsKept;
        double normal = o.binSpeed[slot][binOf(s->cars[k]->_distFromStartLine)];
        if (o.binTime[slot][binOf(s->cars[k]->_distFromStartLine)] < 0 || normal <= 0)
            continue;
        if (s->cars[k]->_speed_x < normal * impedeLoss && car->_speed_x < normal * impedeSlow)
        {
            impeded = true;
            victim = k;
        }
    }
    c.impedeClock = impeded ? c.impedeClock + dt : 0;
    if (c.impedeClock < impedeTime)
        return;
    c.impedeClock = 0;
    c.impedeQuiet = impedeCooldown;
    decide(0, O_IMPEDING, P_GRID, impedingGrid, victim, car->_distFromStartLine, decisionDelay, 0);
}

int attackerOf(tSituation *s, int d, double range)
{
    tCarElt *car = s->cars[d];
    int best = -1;
    double nearest = range;
    for (int k = 0; k < s->_ncars; k++)
    {
        if (k == d || !racing(k) || inLaneAt(s->cars[k]))
            continue;
        double behind = progress(car) - progress(s->cars[k]);
        if (behind > 0 && behind < nearest)
        {
            nearest = behind;
            best = k;
        }
    }
    return best;
}

void defending(tSituation *s, int d)
{
    Car &c = cars[d];
    tCarElt *car = s->cars[d];
    if (kind != KIND_RACE || !racing(d) || now < startGrace || lapOne(d) || sdRaceControlNeutralised())
        return;
    int attacker = attackerOf(s, d, defendBehind);
    double here = car->_distFromStartLine;
    bool straight = car->_speed_x > defendSpeed;
    for (double look = -straightBehind; look <= straightAhead && straight; look += straightStep)
        straight = fabs(sdAiCurvature(here + look)) < straightCurvature;
    double lat = car->_trkPos.toMiddle;
    double offLine = fabs(lat - sdAiRacingLine(car->_distFromStartLine));
    if (attacker < 0 || !straight || attacker != c.defendBy)
    {
        c.defendBy = straight ? attacker : -1;
        c.defendMoves = 0;
        c.defendDir = 0;
        c.defendFloor = offLine;
        c.defendFrom = lat;
    }
    else if (fabs(lat - c.defendFrom) > defendMove)
    {
        double attackerLat = latest(cars[attacker]).lat;
        int dir = lat > c.defendFrom ? 1 : -1;
        bool covering = (attackerLat - c.defendFrom) * dir > defendOffset;
        bool offLineMove = offLine > c.defendFloor + defendMove / 2;
        if (covering && offLineMove && dir != c.defendDir)
        {
            if (c.defendDir != 0 && ++c.defendMoves == 1)
                decide(d, O_DIRECTION_CHANGES, P_TIME5, 0, attacker, car->_distFromStartLine, decisionDelay, 0);
            c.defendDir = dir;
        }
        c.defendFloor = std::min(c.defendFloor, offLine);
        c.defendFrom = lat;
    }
    int close = attackerOf(s, d, brakingDefendBehind);
    bool braking = car->_brakeCmd > brakingCmd && close >= 0;
    if (!braking)
    {
        c.brakeDefending = false;
        return;
    }
    if (!c.brakeDefending)
    {
        c.brakeDefending = true;
        c.brakeAnchor = lat;
        return;
    }
    double attackerLat = latest(cars[close]).lat;
    bool towardAttacker = fabs(attackerLat - lat) < fabs(attackerLat - c.brakeAnchor);
    if (!straight || !towardAttacker || fabs(lat - c.brakeAnchor) < moveUnderBraking)
        return;
    c.brakeAnchor = 1e9;
    c.brakeWarnings++;
    if (c.brakeWarnings == 1)
        post(d, close, O_MOVING_UNDER_BRAKING, STAGE_WARNING, P_BLACK_WHITE, 0, car->_distFromStartLine, 1, 0);
    else
        decide(d, O_MOVING_UNDER_BRAKING, P_TIME5, 0, close, car->_distFromStartLine, decisionDelay, 0);
}

}

void sdStewardsBegin(tSituation *s, int sessionKind, int laps)
{
    kind = (Kind)sessionKind;
    totalLaps = laps;
    carCount = s->_ncars;
    length = std::max(1.0, (double)ReInfo->track->length);
    startClock = s->currentTime;
    signalTime = 0;
    started = kind != KIND_RACE;
    thirdTaken = false;
    now = s->currentTime;
    cars.assign(carCount, Car());
    incidents.clear();
    decisions.clear();
    messages.clear();
    pairContact.assign(carCount, std::vector<double>(carCount, -100.0));
    pairOrder.assign(carCount, std::vector<signed char>(carCount, 0));
    for (int k = 0; k < marshalSectors; k++)
    {
        flags[k] = 0;
        flagUntil[k] = 0;
        flagLevel[k] = 0;
        flagCar[k] = -1;
        hazard[k] = 0;
        hazardUntil[k] = 0;
    }
    for (int i = 0; i < carCount; i++)
    {
        Car &c = cars[i];
        tCarElt *car = s->cars[i];
        c.laps = car->_laps;
        c.startX = car->_pos_X;
        c.startY = car->_pos_Y;
        const tTrkLocPos &at = car->_trkPos;
        double along = at.seg->lgfromstart + (at.seg->type == TR_STR ? at.toStart : at.toStart * at.seg->radius);
        c.startDistance = along;
        c.thirdX = car->_pos_X;
        c.thirdY = car->_pos_Y;
        c.lastDistance = along;
        for (int l = 0; l < lapsKept; l++)
            for (int b = 0; b < bins; b++)
            {
                c.binTime[l][b] = -1;
                c.binClean[l][b] = 0;
                c.binSpeed[l][b] = 0;
            }
        for (int k = 0; k < marshalSectors; k++)
            c.sectorRef[k] = 0;
        record(s, i);
    }
}

void sdStewardsStep(tSituation *s)
{
    if (cars.empty() || kind == KIND_SOLO)
        return;
    now = s->currentTime;
    contacts(s);
}

void sdStewardsTick(tSituation *s, double dt)
{
    if (cars.empty() || (int)cars.size() != s->_ncars)
        return;
    now = s->currentTime;
    for (int i = 0; i < s->_ncars; i++)
    {
        record(s, i);
        rollLap(s, i);
        recordBins(s, i);
    }
    startProcedure(s);
    if (kind != KIND_SOLO)
        updateFlags(s, dt);
    for (int i = 0; i < s->_ncars; i++)
    {
        trackLimits(s, i, dt);
        if (kind == KIND_SOLO)
            continue;
        updateVisit(s, i, dt);
        giveBack(s, i);
        yellowCompliance(s, i);
        defending(s, i);
        requestAiPenalty(s, i);
        finishCar(i);
    }
    if (kind == KIND_SOLO)
        return;
    blueFlags(s, dt);
    impeding(s, dt);
    resolveIncidents(s);
    resolveDecisions();
}

void sdStewardsNoteService(int index)
{
    if (index < 0 || index >= (int)cars.size())
        return;
    Visit &v = cars[index].visit;
    if (!v.inLane || v.serviced)
        return;
    v.serviced = true;
    v.stopAtService = v.stopClock;
}

void sdStewardsDecide(int car, int offence, int penalty, double value, int other, double distance, double delay, int points)
{
    if (car < 0 || car >= (int)cars.size() || cars[car].disqualified)
        return;
    now = ReInfo->s->currentTime;
    decide(car, offence, penalty, value, other, distance, delay, points);
}

void sdStewardsAnnounce(int event, double value, double distance)
{
    if (cars.empty())
        return;
    now = ReInfo->s->currentTime;
    post(-1, -1, event, STAGE_CONTROL, P_NONE, value, distance, 0, 0);
}

void sdStewardsArmStart(tSituation *s, double signal, double countdown)
{
    if (cars.empty())
        return;
    now = s->currentTime;
    signalTime = signal;
    startClock = signal - countdown;
    started = false;
    thirdTaken = false;
    for (int i = 0; i < s->_ncars; i++)
    {
        Car &c = cars[i];
        tCarElt *car = s->cars[i];
        const tTrkLocPos &at = car->_trkPos;
        double along = at.seg->lgfromstart + (at.seg->type == TR_STR ? at.toStart : at.toStart * at.seg->radius);
        c.startDistance = along;
        c.thirdX = car->_pos_X;
        c.thirdY = car->_pos_Y;
        c.lastDistance = along;
        c.laps = car->_laps;
        c.lapInvalid = car->_laps > 0;
        c.nextInvalid = false;
        c.visit = Visit();
        c.ex = Excursion();
        c.settling = false;
        c.giveBackTo = -1;
        c.sector = -1;
        c.passes.clear();
        c.slowClock = 0;
        c.stoppedClock = 0;
    }
    incidents.clear();
}

void sdStewardsLapCompleted(int index)
{
    if (index < 0 || index >= (int)cars.size())
        return;
    now = ReInfo->s->currentTime;
    rollLap(ReInfo->s, index);
}

bool sdStewardsPlayerTrouble(int index)
{
    return index >= 0 && index < (int)cars.size() && cars[index].playerTrouble;
}

bool sdStewardsSpun(int index, double seconds)
{
    return index >= 0 && index < (int)cars.size() && maxSlipBetween(cars[index], now - seconds, now) > spinSlip;
}

bool sdStewardsLapInvalid(int index)
{
    return index >= 0 && index < (int)cars.size() && cars[index].lapInvalid;
}

bool sdStewardsLastLapInvalid(int index)
{
    return index >= 0 && index < (int)cars.size() && cars[index].lastInvalid;
}

double sdStewardsOwedTime(int index)
{
    return index >= 0 && index < (int)cars.size() ? cars[index].owed : 0.0;
}

double sdStewardsTimeAdded(int index)
{
    return index >= 0 && index < (int)cars.size() ? cars[index].timeAdded : 0.0;
}

bool sdStewardsDisqualified(int index)
{
    return index >= 0 && index < (int)cars.size() && cars[index].disqualified;
}

bool sdStewardsYield(int index)
{
    return index >= 0 && index < (int)cars.size() && cars[index].giveBackTo >= 0;
}

int sdStewardsGridDrop(int index)
{
    return index >= 0 && index < (int)cars.size() ? cars[index].gridDrop : 0;
}

int sdStewardsOffTracks(int index)
{
    return index >= 0 && index < (int)cars.size() ? cars[index].offTracks : 0;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdStewardsLights(double interval)
{
    lightInterval = interval > 0 ? interval : defaultLightInterval;
}

EMSCRIPTEN_KEEPALIVE void sdStewardsTrackLimits(int on)
{
    trackLimitsOn = on != 0;
}

EMSCRIPTEN_KEEPALIVE int sdStewardsMessages(double *out, int max, int after)
{
    int count = 0;
    for (const Message &m : messages)
    {
        if (m.id <= after)
            continue;
        if (count >= max)
            break;
        double *row = &out[count * messageFields];
        row[0] = m.id;
        row[1] = m.time;
        row[2] = m.lap;
        row[3] = m.car;
        row[4] = m.other;
        row[5] = m.offence;
        row[6] = m.stage;
        row[7] = m.penalty;
        row[8] = m.value;
        row[9] = m.distance;
        row[10] = m.count;
        row[11] = m.points;
        count++;
    }
    return count;
}

EMSCRIPTEN_KEEPALIVE void sdStewardsCar(int index, double *out)
{
    for (int k = 0; k < carFields; k++)
        out[k] = 0;
    if (index < 0 || index >= (int)cars.size())
        return;
    const Car &c = cars[index];
    tCarElt *car = ReInfo->s->cars[index];
    out[0] = c.strikes;
    out[1] = c.owed;
    out[2] = c.queue.empty() ? 0 : c.queue.front().penalty == P_DRIVE_THROUGH ? 1 : 2;
    out[3] = c.queue.empty() ? 0 : c.queue.front().crossingsLeft;
    out[4] = c.points;
    out[5] = c.reprimands;
    out[6] = c.disqualified ? 1 : 0;
    out[7] = c.lapInvalid ? 1 : 0;
    out[8] = c.lastInvalid ? 1 : 0;
    out[9] = c.timeAdded;
    out[10] = c.blue ? 1 : 0;
    out[11] = flags[sectorOf(car->_distFromStartLine)];
    out[12] = c.gridDrop;
    out[13] = c.drivingReprimands;
    out[14] = c.offTracks;
    out[15] = c.giveBackTo + 1;
}

EMSCRIPTEN_KEEPALIVE int sdStewardsFlags(double *out, int max)
{
    int count = std::min(max, marshalSectors);
    for (int k = 0; k < count; k++)
        out[k] = flags[k];
    return count;
}

}

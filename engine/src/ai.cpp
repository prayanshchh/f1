#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include <emscripten/emscripten.h>

#include <tgf.h>
#include <robottools.h>

#include "sim.h"
#include "ai.h"
#include "race-control.h"
#include "game.h"

namespace
{

const double previewTime = 0.075;
const double headingGain = 1.5;
const double stanleyGain = 6.0;
const double stanleySoft = 8.0;
const double yawDamping = 0.11;
const double gripFloor = 17.0;
const double gripAero = 0.006;
const double brakeFloor = 19.0;
const double brakeAero = 0.0034;
const double raceManage = 0.93;
const double racePush = 0.98;
const double offLineCost = 0.9;
const double laneChangeCost = 1.0;
const double keepLaneMargin = 6.0;
const double commitTime = 0.6;
const double attackBonus = 28.0;
const double defendBonus = 8.0;
const double sampleStep = 2.0;
const double laneOffsets[] = {-9.0, -7.0, -5.0, -3.5, -2.0, 0.0, 2.0, 3.5, 5.0, 7.0, 9.0};
const int laneCount = sizeof(laneOffsets) / sizeof(laneOffsets[0]);
const int laneCentre = laneCount / 2;
const int laneSmoothing = 18;
const int laneWindow = 25;
const double edgeMargin = 1.15;
const double kerbUse = 0.8;
const double topSpeed = 105.0;
const int speedPasses = 3;
const int lineSmoothing = 3;
const double planPeriod = 0.06;
const int planSteps = 18;
const double planStep = 0.22;
const double accelModel = 9.0;
const double forecastAccel = 6.0;
const double offTrackSpeed = 26.0;
const double firstLapCaution = 0.94;
const double firstLapDistance = 1100.0;
const double rivalWindowBehind = 70.0;
const double rivalWindowAhead = 220.0;
const double followGapBase = 1.0;
const double lateralClearance = 0.8;
const double hardClearance = 0.4;
const double longClearance = 1.2;
const double conflictSteps = 12;
const double slowCornerSpeed = 32.0;
const double slowCornerClearance = 1.2;
const double laneChangeRate = 4.2;
const double dodgeRate = 7.0;
const double wheelbase = 3.5;
const double steerRateLimit = 4.0;
const double absSlip = 0.14;
const double tcSlip = 0.10;
const double pushRise = 0.5;
const double pushFall = 0.15;
const double defendPush = 0.6;
const double fightGapAhead = 1.6;
const double fightGapBehind = 0.9;
const double insideLateBrake = 1.02;
const double yieldLane = 5.0;
const double yieldLook = 220.0;
const double pushLapLineWeight = 3.0;
const double yieldSpeed = 0.965;
const double hotMargin = 6.0;
const double hotScale = 0.0035;
const double outLapSpeed = 0.84;
const double outLapFinalRun = 230.0;
const double outLapHoldFrom = 0.7;
const double outLapGapDistance = 320.0;
const double outLapHoldSpeed = 0.68;
const double pitPendingDistance = 160.0;
const double pitRampBefore = 60.0;
const double pitRampAfter = 25.0;
const double pitReleaseClear = 45.0;
const double turnInLead = 14.0;
const double stopRun = 34.0;
const double releaseRun = 13.0;
const double stopDecel = 7.0;
const double overlapRear = 0.3;
const double overlapBackOff = 0.94;
const double pitClearance = 0.15;
const double pitEntryGrace = 15.0;
const double fastLaneOffset = 1.2;
const double fastLaneRamp = 40.0;
const int garageBays = 25;
const double openingLapTime = 45.0;
const double crawlSpeed = 3.0;
const double crawlRivalSpeed = 1.5;
const double reverseClear = 9.0;
const double rejoinLook = 70.0;
const double rejoinWait = 2.5;
const double slideCatchFrom = 0.15;
const double slideCatchSpan = 0.15;
const double slideCatchGain = 1.2;
const double slideCatchSpeed = 5.0;
const double slowCornerFloor = 8.0;
const double launchRevs = 2.0;

struct PitLayout
{
    double entry, wallStart, wallEnd, exit, pitWall, shift, ramp, fastLane, speedLimit, boxLateral, garageStart, spacing, firstBay;
};

struct TrackModel
{
    tTrack *track = nullptr;
    double length = 0;
    int count = 0;
    std::vector<tTrackSeg *> segments;
    std::vector<double> line;
    std::vector<double> rawLine;
    std::vector<double> leftBound;
    std::vector<double> rightBound;
    std::vector<double> leftLimit;
    std::vector<double> rightLimit;
    std::vector<double> kappa;
    std::vector<double> centreKappa;
    std::vector<double> pitLateral;
    std::vector<double> gain;
    std::vector<float> laneLateral[laneCount];
    std::vector<float> laneSpeed[laneCount];
    std::vector<double> gridDistance;
    std::vector<double> gridLateral;
    PitLayout pit;
    bool ready = false;
};

TrackModel model;

enum PitPhase
{
    PIT_NONE,
    PIT_APPROACH,
    PIT_LANE,
    PIT_BOXING,
    PIT_STOPPED,
    PIT_RELEASE,
    PIT_EXIT
};

struct Driver
{
    double pace = 1.0;
    double racePace = 1.0;
    double racecraft = 1.0;
    int bay = 0;
    SdAiTask task = AI_RACE;
    double lane = 0;
    double laneTarget = 0;
    double planClock = 0;
    double steer = 0;
    double wheelBrake[4] = {1, 1, 1, 1};
    double tractionLimit = 1;
    double reaction = 0;
    int defendSide = 0;
    double defendTimer = 0;
    double commit = 0;
    int commitSide = 0;
    double push = 0;
    double lapNoise = 1.0;
    bool blueFlag = false;
    bool yielding = false;
    double yieldSide = 1.0;
    bool pitPending = false;
    int defendMoves = 0;
    double commitClock = 0;
    double defendLane = 0;
    double lastCornerClock = 0;
    PitPhase pit = PIT_NONE;
    int pitCompound = -1;
    double pitTime = 0;
    double pitClock = 0;
    bool pitDone = false;
    bool serviced = false;
    bool autoRelease = true;
    bool driveThrough = false;
    bool noService = false;
    bool deferredPit = false;
    int deferredCompound = 0;
    double deferredTime = 0;
    double caution = 1.0;
    double speedCap = 1e9;
    double holdClock = 0;
    double stuckClock = 0;
    double crawlClock = 0;
    double stuckTotal = 0;
    double reverseClock = 0;
    double rejoinClock = 0;
    double slide = 0;
    double outLapGap = 0;
    double grip = 1.0;
    double gripClock = 0;
    double weight = 1.0;
};

struct Forecast
{
    double s[planSteps + 1];
    double l[planSteps + 1];
    double v[planSteps + 1];
    double halfLat[planSteps + 1];
    double halfLong[planSteps + 1];
};

std::vector<Driver> drivers;
std::vector<Forecast> forecasts;
double forecastClock = -1;
double paceScale = 1.0;

double wrap(double d)
{
    double m = fmod(d, model.length);
    return m < 0 ? m + model.length : m;
}

double delta(double from, double to)
{
    double d = wrap(to - from);
    return d > model.length / 2 ? d - model.length : d;
}

int sampleIndex(double s)
{
    int i = (int)(wrap(s) / sampleStep);
    return i >= model.count ? i - model.count : i;
}

template <class Value>
double sampled(const std::vector<Value> &values, double s)
{
    double x = wrap(s) / sampleStep;
    int i = (int)x;
    double t = x - i;
    int a = i % model.count;
    int b = (i + 1) % model.count;
    return values[a] + (values[b] - values[a]) * t;
}

void laneSlot(double d, int *low, int *high, double *t)
{
    if (d <= laneOffsets[0])
    {
        *low = *high = 0;
        *t = 0;
        return;
    }
    if (d >= laneOffsets[laneCount - 1])
    {
        *low = *high = laneCount - 1;
        *t = 0;
        return;
    }
    int i = 0;
    while (i < laneCount - 2 && d > laneOffsets[i + 1])
        i++;
    *low = i;
    *high = i + 1;
    *t = (d - laneOffsets[i]) / (laneOffsets[i + 1] - laneOffsets[i]);
}

double laneSpeedAt(double s, double d)
{
    int a, b;
    double t;
    laneSlot(d, &a, &b, &t);
    double va = sampled(model.laneSpeed[a], s);
    if (a == b)
        return va;
    return va + (sampled(model.laneSpeed[b], s) - va) * t;
}

double laneLateralAt(double s, double d)
{
    int a, b;
    double t;
    laneSlot(d, &a, &b, &t);
    double la = sampled(model.laneLateral[a], s);
    if (a == b)
        return la;
    return la + (sampled(model.laneLateral[b], s) - la) * t;
}

tTrkLocPos locate(double s, double l)
{
    int index = sampleIndex(s);
    tTrackSeg *seg = model.segments[index];
    double d = wrap(s);
    for (int guard = 0; guard < 4 && d < seg->lgfromstart && seg->lgfromstart - d < model.length / 2; guard++)
        seg = seg->prev;
    for (int guard = 0; guard < 4 && d >= seg->lgfromstart + seg->length; guard++)
        seg = seg->next;
    tTrkLocPos pos;
    pos.seg = seg;
    pos.type = TR_LPOS_MAIN;
    double along = d - seg->lgfromstart;
    pos.toStart = (tdble)(seg->type == TR_STR ? along : along / seg->radius);
    pos.toMiddle = (tdble)l;
    pos.toRight = seg->width / 2 + pos.toMiddle;
    pos.toLeft = seg->width / 2 - pos.toMiddle;
    return pos;
}

void globalPoint(double s, double l, double *x, double *y)
{
    tTrkLocPos pos = locate(s, l);
    tdble gx, gy;
    RtTrackLocal2Global(&pos, &gx, &gy, TR_TOMIDDLE);
    *x = gx;
    *y = gy;
}

double curvatureOf(double ax, double ay, double bx, double by, double cx, double cy)
{
    double ux = bx - ax, uy = by - ay, vx = cx - bx, vy = cy - by;
    double cross = ux * vy - uy * vx;
    double lu = hypot(ux, uy), lv = hypot(vx, vy), lw = hypot(cx - ax, cy - ay);
    double denom = lu * lv * lw;
    return denom > 1e-6 ? 2.0 * cross / denom : 0.0;
}

double lateralLimit(double v)
{
    return gripFloor + gripAero * v * v;
}

double remainingGrip(double v, double k, double limit)
{
    double used = std::min(1.0, pow(k * v * v / lateralLimit(v), 2.0));
    return limit * sqrt(1.0 - used);
}

double brakeLimit(double v, double k)
{
    return remainingGrip(v, k, brakeFloor + brakeAero * v * v);
}

double cornerSpeed(double k)
{
    double size = std::max(fabs(k), 1e-6);
    double v = topSpeed;
    for (int i = 0; i < 30; i++)
        v = std::min(topSpeed, sqrt(lateralLimit(v) / size));
    return v;
}

void smooth(std::vector<double> &values, int width)
{
    int n = (int)values.size();
    std::vector<double> sum(n);
    double window = 0;
    for (int k = -width; k <= width; k++)
        window += values[((k % n) + n) % n];
    for (int i = 0; i < n; i++)
    {
        sum[i] = window / (2 * width + 1);
        window += values[(i + width + 1) % n] - values[((i - width) % n + n) % n];
    }
    values = sum;
}

void buildLanes()
{
    int n = model.count;
    model.line = model.rawLine;
    smooth(model.line, lineSmoothing);
    for (int i = 0; i < n; i++)
        model.line[i] = std::max(model.rightBound[i], std::min(model.leftBound[i], model.line[i]));
    for (int j = 0; j < laneCount; j++)
    {
        std::vector<double> lateral(n);
        std::vector<double> room(n);
        double sign = laneOffsets[j] >= 0 ? 1.0 : -1.0;
        for (int i = 0; i < n; i++)
        {
            double limit = sign > 0 ? model.leftBound[i] : model.rightBound[i];
            room[i] = std::max(0.0, std::min(fabs(laneOffsets[j]), (limit - model.line[i]) * sign));
        }
        std::vector<double> tight = room;
        for (int i = 0; i < n; i++)
            for (int k = -laneWindow; k <= laneWindow; k++)
                tight[i] = std::min(tight[i], room[((i + k) % n + n) % n]);
        smooth(tight, laneSmoothing);
        smooth(tight, laneSmoothing);
        for (int i = 0; i < n; i++)
            lateral[i] = model.line[i] + sign * tight[i];
        std::vector<double> px(n), py(n), k(n);
        for (int i = 0; i < n; i++)
            globalPoint(i * sampleStep, lateral[i], &px[i], &py[i]);
        for (int i = 0; i < n; i++)
        {
            int a = (i - 3 + n) % n, b = (i + 3) % n;
            k[i] = curvatureOf(px[a], py[a], px[i], py[i], px[b], py[b]);
        }
        smooth(k, 1);
        if (j == laneCentre)
            model.kappa = k;
        std::vector<double> limit(n);
        for (int i = 0; i < n; i++)
            limit[i] = cornerSpeed(k[i]) * model.gain[i];
        int start = (int)(std::min_element(limit.begin(), limit.end()) - limit.begin());
        std::vector<double> speed = limit;
        for (int pass = 0; pass < speedPasses; pass++)
            for (int m = n - 1; m >= 0; m--)
            {
                int i = (start + m) % n;
                int next = (i + 1) % n;
                double v = speed[next];
                double reach = sqrt(v * v + 2.0 * sampleStep * brakeLimit(v, k[next]));
                speed[i] = std::min(limit[i], reach);
            }
        model.laneLateral[j].resize(n);
        model.laneSpeed[j].resize(n);
        for (int i = 0; i < n; i++)
        {
            model.laneLateral[j][i] = (float)lateral[i];
            model.laneSpeed[j][i] = (float)speed[i];
        }
    }
}

struct Frame
{
    double ox, oy, oz, heading, sx, sy;
};

void toWorld(const Frame &frame, double x, double z, double *wx, double *wy)
{
    double ax = x - frame.ox;
    double ay = -z + frame.oz;
    double c = cos(-frame.heading), n = sin(-frame.heading);
    *wx = frame.sx + c * ax - n * ay;
    *wy = frame.sy + n * ax + c * ay;
}

struct Projected
{
    double s, l;
};

Projected project(tTrackSeg **hint, double wx, double wy)
{
    tTrkLocPos pos;
    RtTrackGlobal2Local(*hint, (tdble)wx, (tdble)wy, &pos, TR_LPOS_MAIN);
    *hint = pos.seg;
    double along = pos.seg->type == TR_STR ? pos.toStart : pos.toStart * pos.seg->radius;
    return {pos.seg->lgfromstart + along, pos.toMiddle};
}

std::map<std::string, std::vector<double>> readData(const char *path)
{
    std::map<std::string, std::vector<double>> result;
    FILE *file = fopen(path, "r");
    if (!file)
        return result;
    char name[64];
    int count;
    while (fscanf(file, "%63s %d", name, &count) == 2)
    {
        std::vector<double> values(count);
        for (int i = 0; i < count; i++)
            if (fscanf(file, "%lf", &values[i]) != 1)
                break;
        result[name] = values;
    }
    fclose(file);
    return result;
}

void resample(const std::vector<Projected> &points, std::vector<double> &out, int count)
{
    std::vector<double> sum(count, 0.0), weight(count, 0.0);
    for (const Projected &p : points)
    {
        int i = sampleIndex(p.s);
        sum[i] += p.l;
        weight[i] += 1.0;
    }
    out.assign(count, 0.0);
    int first = -1;
    for (int i = 0; i < count; i++)
        if (weight[i] > 0)
        {
            first = i;
            break;
        }
    if (first < 0)
        return;
    double previous = sum[first] / weight[first];
    int previousIndex = first;
    for (int m = 1; m <= count; m++)
    {
        int i = (first + m) % count;
        if (weight[i] <= 0)
            continue;
        double value = sum[i] / weight[i];
        int gap = (i - previousIndex + count) % count;
        if (gap == 0)
            gap = count;
        for (int g = 0; g < gap; g++)
        {
            int k = (previousIndex + g) % count;
            out[k] = previous + (value - previous) * g / gap;
        }
        previous = value;
        previousIndex = i;
    }
}

double pitShift(double s)
{
    const PitLayout &p = model.pit;
    double fromStart = wrap(s - p.wallStart);
    double span = wrap(p.wallEnd - p.wallStart);
    if (fromStart <= span)
        return p.shift;
    double before = wrap(p.wallStart - s);
    double after = wrap(s - p.wallEnd);
    double t = std::max({1.0 - before / p.ramp, 1.0 - after / p.ramp, 0.0});
    return p.shift * t * t * (3.0 - 2.0 * t);
}

bool onArc(double s, double from, double to)
{
    return wrap(s - from) <= wrap(to - from);
}


double ease(double t)
{
    double c = std::max(0.0, std::min(1.0, t));
    return c * c * (3.0 - 2.0 * c);
}

double boxDistance(int bay)
{
    return wrap(model.pit.garageStart + (bay + 0.5) * model.pit.spacing);
}

double approachPath(double at)
{
    const PitLayout &p = model.pit;
    if (onArc(at, p.entry + pitRampAfter, p.wallEnd))
        return sampled(model.pitLateral, at);
    if (!onArc(at, p.entry - pitRampBefore, p.entry + pitRampAfter))
        return sampled(model.line, at);
    double t = ease(1.0 - wrap(p.entry + pitRampAfter - at) / (pitRampAfter + pitRampBefore));
    double laneAt = sampled(model.pitLateral, std::max(wrap(at), p.entry + 2.0));
    return sampled(model.line, at) + (laneAt - sampled(model.line, at)) * t;
}

double clampLateral(double s, double l)
{
    return std::max(sampled(model.rightBound, s), std::min(sampled(model.leftBound, s), l));
}

double gripScale(const Driver &driver)
{
    return sqrt(std::max(0.4, driver.grip) * driver.weight);
}

double driverScale(const Driver &driver)
{
    if (driver.task == AI_RACE)
    {
        double manage = raceManage + (racePush - raceManage) * driver.push;
        return driver.racePace * manage * paceScale * gripScale(driver) * driver.lapNoise;
    }
    return driver.pace * paceScale * gripScale(driver) * driver.lapNoise;
}

double taskSpeedFactor(const Driver &driver, double s)
{
    if (driver.task == AI_OUT_LAP)
        return wrap(s) > model.length - outLapFinalRun ? 1.0 : outLapSpeed;
    if (driver.task == AI_IN_LAP || driver.task == AI_COOL_DOWN)
        return 0.8;
    return 1.0;
}

double targetSpeedAt(const Driver &driver, double s, double d)
{
    return laneSpeedAt(s, d) * driverScale(driver) * taskSpeedFactor(driver, s);
}

bool sdFieldPlayerOnAi()
{
    return sdPlayerAutopilot();
}

bool activeCar(tSituation *s, int i)
{
    return (s->cars[i]->_state & RM_CAR_STATE_NO_SIMU) == 0;
}

bool ghostCar(int i)
{
    return drivers[i].task == AI_PARKED || drivers[i].task == AI_GARAGE;
}

void bodyExtent(double angle, double length, double width, double *halfLat, double *halfLong)
{
    double c = fabs(cos(angle)), n = fabs(sin(angle));
    *halfLat = 0.5 * (length * n + width * c);
    *halfLong = 0.5 * (length * c + width * n);
}

double relativeYaw(tCarElt *car)
{
    double angle = car->_yaw - RtTrackSideTgAngleL(&car->_trkPos);
    NORM_PI_PI(angle);
    return angle;
}

double trackBeyond(tCarElt *car);

double pitSpeedCap(const Driver &driver, double s)
{
    if (driver.pit == PIT_NONE)
        return 1e9;
    const PitLayout &p = model.pit;
    double limit = p.speedLimit / 3.6;
    if (driver.pit == PIT_STOPPED)
        return 0;
    if (driver.pit == PIT_APPROACH)
        return sqrt(limit * limit + 2.0 * 26.0 * std::max(0.0, wrap(p.wallStart - 40.0 - s)));
    if (driver.pit == PIT_EXIT && !onArc(s, p.entry, p.wallEnd))
        return 60.0;
    return limit;
}

void updateForecasts(tSituation *s)
{
    if (forecastClock == s->currentTime)
        return;
    forecastClock = s->currentTime;
    for (int i = 0; i < s->_ncars; i++)
    {
        tCarElt *car = s->cars[i];
        Forecast &f = forecasts[i];
        const Driver &driver = drivers[i];
        double pos = car->_distFromStartLine;
        double v = std::max(0.0, (double)car->_speed_x);
        double lateral = car->_trkPos.toMiddle;
        double lineHere = sampled(model.line, pos);
        double d = lateral - lineHere;
        double angle = relativeYaw(car);
        bool lost = trackBeyond(car) > 1.5 && driver.pit == PIT_NONE;
        bool ai = (i > 0 || sdFieldPlayerOnAi()) && !lost && fabs(angle) < 1.0;
        double vl = v * sin(angle);
        double decelNow = std::min(0.0, (double)car->_accel_x);
        double startSpeed = v;
        double lengthCar = car->_dimension_x;
        double widthCar = car->_dimension_y;
        f.s[0] = pos;
        f.l[0] = lateral;
        f.v[0] = v;
        bodyExtent(angle, lengthCar, widthCar, &f.halfLat[0], &f.halfLong[0]);
        for (int k = 1; k <= planSteps; k++)
        {
            double limit = ai ? targetSpeedAt(driver, f.s[k - 1], d) : lost ? offTrackSpeed : laneSpeedAt(f.s[k - 1], d) * gripScale(driver);
            limit = std::min(limit, pitSpeedCap(driver, f.s[k - 1]));
            if (ai && (driver.task == AI_PARKED || driver.task == AI_GARAGE))
                limit = 0;
            double t = k * planStep;
            double next = std::min(limit, v + forecastAccel * planStep);
            next = std::max(next, v - 40.0 * planStep);
            next = std::min(next, std::max(0.0, startSpeed + decelNow * std::min(t, 0.5)) + forecastAccel * std::max(0.0, t - 0.5));
            v = std::max(0.0, next);
            f.s[k] = f.s[k - 1] + v * planStep;
            if (ai && driver.pit != PIT_NONE)
            {
                if (driver.pit == PIT_APPROACH)
                    f.l[k] = approachPath(f.s[k]);
                else
                    f.l[k] = driver.pit == PIT_EXIT ? sampled(model.pitLateral, f.s[k]) : lateral;
            }
            else if (ai)
            {
                double dPlanned = driver.lane + (driver.laneTarget - driver.lane) * std::min(1.0, t / 1.2);
                f.l[k] = laneLateralAt(f.s[k], dPlanned);
            }
            else
            {
                double fade = exp(-t / 1.1);
                f.l[k] = clampLateral(f.s[k], f.l[k - 1] + vl * fade * planStep);
            }
            f.v[k] = v;
            double run = std::max(0.5, f.s[k] - f.s[k - 1]);
            double pathAngle = atan2(f.l[k] - f.l[k - 1], run);
            double slipFade = exp(-t / 0.7);
            bodyExtent(pathAngle + (angle - pathAngle) * slipFade, lengthCar, widthCar, &f.halfLat[k], &f.halfLong[k]);
        }
    }
}

struct Rival
{
    int index;
    double gap;
};

int nextCornerSide(double s, double look)
{
    double total = 0;
    for (double d = 0; d < look; d += 8.0)
    {
        double k = sampled(model.kappa, s + d);
        if (fabs(k) > 1.0 / 180.0)
            total += k;
        else if (total != 0.0 && d > 30.0)
            break;
    }
    if (total > 0)
        return 1;
    return total < 0 ? -1 : 0;
}

double trackBeyond(tCarElt *car)
{
    double pos = car->_distFromStartLine;
    double lateral = car->_trkPos.toMiddle;
    return std::max(lateral - sampled(model.leftBound, pos), sampled(model.rightBound, pos) - lateral);
}

double alongScale(double s, double l)
{
    return std::max(0.45, 1.0 - sampled(model.centreKappa, s) * l);
}

double slowMargin(double v)
{
    return v < slowCornerSpeed && v > slowCornerFloor ? slowCornerClearance : 0.0;
}

double candidateCost(const Driver &driver, tCarElt *car, const std::vector<Rival> &rivals, double candidate, tSituation *s)
{
    double lengthCar = car->_dimension_x;
    double widthCar = car->_dimension_y;
    double pos = car->_distFromStartLine;
    double v = std::max(1.0, (double)car->_speed_x);
    double d = driver.lane;
    double start = pos;
    double kBefore = sampled(model.kappa, pos);
    double rate = laneChangeRate * (1.0 - std::min(0.75, fabs(kBefore) * v * v / lateralLimit(v)));
    double penalty = 0;
    double previousLateral = laneLateralAt(pos, d);
    for (int k = 1; k <= planSteps; k++)
    {
        double step = rate * planStep;
        d += std::max(-step, std::min(step, candidate - d));
        double limit = targetSpeedAt(driver, pos, d);
        double next = std::min(limit, v + accelModel * planStep);
        next = std::max(next, v - 42.0 * planStep);
        double lateral = laneLateralAt(pos, d);
        double run = std::max(0.5, v * planStep);
        double halfLat, halfLong;
        bodyExtent(atan2(lateral - previousLateral, run), lengthCar, widthCar, &halfLat, &halfLong);
        previousLateral = lateral;
        double early = 1.0 + 3.0 * (1.0 - (double)k / planSteps);
        for (const Rival &rival : rivals)
        {
            const Forecast &f = forecasts[rival.index];
            double gap = rival.gap + (f.s[k] - f.s[0]) - (pos - start);
            double lateralGap = fabs(f.l[k] - lateral);
            double side = halfLat + f.halfLat[k] + lateralClearance + slowMargin(next);
            double reach = (halfLong + f.halfLong[k] + longClearance) / alongScale(pos, lateral);
            if (lateralGap >= side)
                continue;
            if (fabs(gap) < reach)
            {
                penalty += 400.0 * early * (side - lateralGap) / side;
            }
            else if (gap > 0)
            {
                double follow = reach + next * 0.04;
                if (gap < follow + std::max(0.0, next - f.v[k]) * 0.35)
                    next = std::max(0.0, std::min(next, f.v[k] + std::max(0.0, gap - follow) * 0.6));
            }
        }
        v = next;
        double progress = v / std::max(0.5, 1.0 - sampled(model.centreKappa, pos) * lateral);
        pos += progress * planStep;
    }
    double travelled = pos - start;
    double offLine = fabs(candidate) * offLineCost * (driver.task == AI_PUSH_LAP ? pushLapLineWeight : 1.0);
    double firstLap = sdRaceControlSinceSignal(s) < 12.0 ? 3.0 : 1.0;
    double change = fabs(candidate - driver.laneTarget) * laneChangeCost * firstLap;
    return -travelled + offLine + change + penalty;
}

void gatherRivals(tCarElt *car, tSituation *s, int index, std::vector<Rival> &rivals)
{
    rivals.clear();
    for (int i = 0; i < s->_ncars; i++)
    {
        if (i == index || !activeCar(s, i) || ghostCar(i))
            continue;
        if (drivers[i].pit != PIT_NONE && drivers[i].pit != PIT_APPROACH && drivers[i].pit != PIT_EXIT)
            continue;
        double gap = delta(car->_distFromStartLine, s->cars[i]->_distFromStartLine);
        if (gap > -rivalWindowBehind && gap < rivalWindowAhead)
            rivals.push_back({i, gap});
    }
}

double yieldSideAt(double pos)
{
    double left = 1e9, right = 1e9;
    for (double d = 0; d < yieldLook; d += 8.0)
    {
        double line = sampled(model.line, pos + d);
        left = std::min(left, sampled(model.leftBound, pos + d) - line);
        right = std::min(right, line - sampled(model.rightBound, pos + d));
    }
    return left > right ? 1.0 : -1.0;
}

double fightBonus(int index, const Driver &driver, tCarElt *car, tSituation *s, const std::vector<Rival> &rivals, double candidate)
{
    if (driver.task != AI_RACE)
        return 0;
    double pos = car->_distFromStartLine;
    double v = std::max(5.0, (double)car->_speed_x);
    int side = nextCornerSide(pos, 320.0);
    if (side == 0)
        return 0;
    double candidateLateral = laneLateralAt(pos + v * 1.5, candidate);
    double lineLateral = sampled(model.line, pos + v * 1.5);
    double towardsInside = (candidateLateral - lineLateral) * side;
    double bonus = 0;
    for (const Rival &rival : rivals)
    {
        const Forecast &f = forecasts[rival.index];
        if (rival.gap > 0 && rival.gap / v < fightGapAhead)
        {
            double rivalInside = (f.l[6] - lineLateral) * side;
            double clearOfRival = towardsInside - rivalInside;
            if (clearOfRival > f.halfLat[6] * 2.0 + 0.4)
                bonus += attackBonus * driver.racecraft * std::min(1.0, fightGapAhead + 0.1 - rival.gap / v);
        }
        else if (rival.gap < 0 && -rival.gap / v < fightGapBehind)
        {
            double reach = forecasts[index].halfLong[0] + f.halfLong[0] + 0.8;
            bool overlapped = -rival.gap < reach;
            bool brakingNow = sampled(model.kappa, pos + v * 0.8) != 0.0 && targetSpeedAt(driver, pos + v * 0.8, 0.0) < v - 5.0;
            if (!overlapped && !brakingNow && driver.defendMoves == 0 && towardsInside > 1.0 && towardsInside < 4.5)
                bonus += defendBonus * driver.racecraft;
        }
    }
    return bonus;
}

void plan(int index, Driver &driver, tCarElt *car, tSituation *s)
{
    static std::vector<Rival> rivals;
    gatherRivals(car, s, index, rivals);
    double pos = car->_distFromStartLine;
    if (fabs(sampled(model.kappa, pos)) > 1.0 / 150.0)
        driver.defendMoves = 0;
    if (rivals.empty())
    {
        driver.laneTarget = 0;
        return;
    }
    if (driver.blueFlag)
    {
        if (!driver.yielding)
        {
            driver.yielding = true;
            driver.yieldSide = yieldSideAt(pos);
        }
        driver.laneTarget = driver.yieldSide * yieldLane;
        return;
    }
    driver.yielding = false;
    double previous = driver.laneTarget;
    double best = 1e18;
    double choice = driver.laneTarget;
    double keep = 1e18;
    for (int j = 0; j < laneCount; j++)
    {
        double cost = candidateCost(driver, car, rivals, laneOffsets[j], s) - fightBonus(index, driver, car, s, rivals, laneOffsets[j]);
        if (fabs(laneOffsets[j] - previous) < 0.01)
            keep = cost;
        if (cost < best)
        {
            best = cost;
            choice = laneOffsets[j];
        }
    }
    driver.commitClock -= planPeriod;
    if (driver.commitClock > 0 && keep < best + keepLaneMargin)
        return;
    if (fabs(choice - previous) > 0.01)
        driver.commitClock = commitTime;
    driver.laneTarget = choice;
    if (fabs(choice - previous) > 1.0)
        for (const Rival &rival : rivals)
            if (rival.gap < 0 && rival.gap > -60.0)
                driver.defendMoves = 1;
}

double lateralSafety(int index, tCarElt *car, tSituation *s, double wanted, double *speedFactor)
{
    double pos = car->_distFromStartLine;
    double mine = car->_trkPos.toMiddle;
    double low = sampled(model.rightBound, pos);
    double high = sampled(model.leftBound, pos);
    const Forecast &me = forecasts[index];
    for (int i = 0; i < s->_ncars; i++)
    {
        if (i == index || !activeCar(s, i) || ghostCar(i))
            continue;
        if (drivers[i].pit != PIT_NONE && drivers[i].pit != PIT_APPROACH && drivers[i].pit != PIT_EXIT)
            continue;
        tCarElt *other = s->cars[i];
        const Forecast &f = forecasts[i];
        double gap = delta(pos, other->_distFromStartLine);
        double reach = (me.halfLong[0] + f.halfLong[0] + 3.0) / alongScale(pos, mine);
        if (fabs(gap) > reach)
            continue;
        double side = me.halfLat[0] + f.halfLat[0] + hardClearance + slowMargin(me.v[0]);
        double lateral = other->_trkPos.toMiddle;
        if (lateral > mine)
            high = std::min(high, lateral - side);
        else
            low = std::max(low, lateral + side);
        *speedFactor = std::min(*speedFactor, 0.985);
    }
    if (low > high)
        return (low + high) * 0.5;
    return std::max(low, std::min(high, wanted));
}

bool holdsInside(int index, tCarElt *car, tSituation *s)
{
    double pos = car->_distFromStartLine;
    int corner = nextCornerSide(pos, 160.0);
    if (corner == 0)
        return false;
    const Forecast &me = forecasts[index];
    for (int i = 0; i < s->_ncars; i++)
    {
        if (i == index || !activeCar(s, i) || ghostCar(i) || drivers[i].pit != PIT_NONE)
            continue;
        const Forecast &f = forecasts[i];
        double gap = delta(pos, f.s[0]);
        double lateral = (f.l[0] - me.l[0]) * corner;
        if (fabs(gap) < me.halfLong[0] + f.halfLong[0] + 2.0 && lateral < -(me.halfLat[0] + f.halfLat[0] + hardClearance))
            return true;
    }
    return false;
}

double conflictSpeed(int index, tCarElt *car, tSituation *s, double target)
{
    const Forecast &me = forecasts[index];
    double v = me.v[0];
    double limit = target;
    bool inPit = drivers[index].pit != PIT_NONE;
    for (int i = 0; i < s->_ncars; i++)
    {
        if (i == index || !activeCar(s, i) || (ghostCar(i) && !inPit))
            continue;
        if (!inPit && drivers[i].pit != PIT_NONE && drivers[i].pit != PIT_APPROACH && drivers[i].pit != PIT_EXIT)
            continue;
        const Forecast &f = forecasts[i];
        double gap = delta(me.s[0], f.s[0]);
        bool rivalLeads = gap > 0.6 || (gap > -0.6 && i < index);
        if (!rivalLeads || gap > 200.0)
            continue;
        bool rivalGivesRoom = !inPit && (i > 0 || sdFieldPlayerOnAi()) && drivers[i].pit == PIT_NONE && sdRaceControlSinceSignal(s) > openingLapTime;
        double claimReach = (me.halfLong[0] + f.halfLong[0] + 3.0) / alongScale(f.s[0], f.l[0]);
        double claimSide = me.halfLat[0] + f.halfLat[0] + hardClearance + slowMargin(f.v[0]);
        if (rivalGivesRoom && gap < claimReach && fabs(f.l[0] - me.l[0]) >= claimSide)
            continue;
        for (int k = 0; k <= conflictSteps; k++)
        {
            double t = k * planStep;
            double ahead = gap + (f.s[k] - f.s[0]);
            double travelled = me.s[k] - me.s[0];
            double side = me.halfLat[k] + f.halfLat[k] + (inPit ? pitClearance : hardClearance + slowMargin(me.v[k]));
            if (fabs(f.l[k] - me.l[k]) >= side)
                continue;
            double reach = (me.halfLong[k] + f.halfLong[k] + 0.8 + v * 0.015) / alongScale(me.s[k], me.l[k]);
            if (ahead - travelled > reach && k > 0)
                continue;
            double room = ahead - reach;
            if (k == 0)
            {
                bool blocked = fabs(f.l[0] - me.l[0]) < me.halfLat[0] + f.halfLat[0] + 0.2 && f.v[0] <= crawlRivalSpeed;
                limit = std::min(limit, room <= 0 ? std::max(std::min(f.v[0] - 0.5, v * overlapBackOff), blocked ? 0.0 : crawlSpeed) : sqrt(std::max(0.0, f.v[0] * f.v[0] + 30.0 * room)));
                break;
            }
            double average = std::max(0.0, room) / t;
            if (average < v)
            {
                double decel = 2.0 * (v - average) / t;
                limit = std::min(limit, v - decel * 0.25);
            }
            break;
        }
    }
    return std::max(0.0, limit);
}

template <class Path>
double steerFor(Driver &driver, tCarElt *car, double targetLateral, Path pathAt, double dt)
{
    double v = std::max(2.0, (double)car->_speed_x);
    double pos = car->_distFromStartLine;
    double preview = pos + v * previewTime;
    double spread = std::max(2.0, v * 0.05);
    double ax, ay, bx, by, cx, cy;
    globalPoint(preview - spread, pathAt(preview - spread), &ax, &ay);
    globalPoint(preview, pathAt(preview), &bx, &by);
    globalPoint(preview + spread, pathAt(preview + spread), &cx, &cy);
    double pathHeading = atan2(cy - ay, cx - ax);
    double k = curvatureOf(ax, ay, bx, by, cx, cy);
    double beta = atan2((double)car->_speed_y, v);
    double error = pathHeading - (car->_yaw + beta);
    NORM_PI_PI(error);
    double lateralError = targetLateral - car->_trkPos.toMiddle;
    double feed = atan(wheelbase * k);
    double angle = feed + headingGain * error + atan(stanleyGain * lateralError / (v + stanleySoft)) - yawDamping * (car->_yaw_rate - v * k) / std::max(v, 10.0) * 10.0;
    double reach = atan(wheelbase * lateralLimit(v) * 1.3 / std::max(v * v, 1.0)) + 6.0 * PI / 180.0;
    angle = std::max(-reach, std::min(reach, angle));
    bool rotatingAway = car->_yaw_rate * beta < 0 && (double)car->_speed_x > slideCatchSpeed;
    driver.slide = rotatingAway ? std::max(0.0, std::min(1.0, (fabs(beta) - slideCatchFrom) / slideCatchSpan)) : 0.0;
    angle += (beta * slideCatchGain - angle) * driver.slide;
    double wanted = std::max(-1.0, std::min(1.0, angle / car->_steerLock));
    double step = steerRateLimit * dt;
    driver.steer += std::max(-step, std::min(step, wanted - driver.steer));
    return driver.steer;
}

int chooseGear(tCarElt *car)
{
    int gear = car->_gear;
    double radius = car->_wheelRadius(REAR_RGT);
    double v = std::max(0.0, (double)car->_speed_x);
    if (gear < 1)
        return 1;
    double red = car->_enginerpmRedLine;
    double now = v / radius * car->_gearRatio[gear + car->_gearOffset];
    if (now > red * 0.975 && gear + car->_gearOffset < car->_gearNb - 1)
        return gear + 1;
    if (gear > 1)
    {
        double below = v / radius * car->_gearRatio[gear - 1 + car->_gearOffset];
        if (below < red * 0.86)
            return gear - 1;
    }
    return gear;
}

double longSlip(tCarElt *car, int i)
{
    return car->_wheelSlipAccel(i) / std::max(1.0, (double)fabs(car->_speed_x));
}

void applyPedals(Driver &driver, tCarElt *car, double target, double upcoming, double dt)
{
    double v = (double)car->_speed_x;
    double error = target - v;
    double decelNeeded = std::max(0.0, (v * v - upcoming * upcoming) / (2.0 * std::max(4.0, v * 0.25)));
    double capacity = std::max(5.0, brakeLimit(std::max(v, 1.0), 0.0));
    double brake = 0;
    double accel = 0;
    if (error < -0.25 || decelNeeded > capacity * 0.2)
    {
        brake = std::max(0.0, std::min(1.0, std::max(decelNeeded / capacity, -error * 0.28)));
    }
    else
    {
        accel = std::max(0.0, std::min(1.0, 0.25 + error * 0.5));
    }
    car->ctrl.singleWheelBrakeMode = 1;
    double commands[4];
    for (int i = 0; i < 4; i++)
    {
        double excess = fabs(v) > 2.0 ? longSlip(car, i) - absSlip : -1.0;
        driver.wheelBrake[i] = excess > 0 ? std::max(0.05, driver.wheelBrake[i] - 30.0 * excess * dt / absSlip)
                                          : std::min(1.0, driver.wheelBrake[i] + 8.0 * dt);
        commands[i] = std::min(brake, driver.wheelBrake[i]);
    }
    car->ctrl.brakeFrontRightCmd = (tdble)commands[FRNT_RGT];
    car->ctrl.brakeFrontLeftCmd = (tdble)commands[FRNT_LFT];
    car->ctrl.brakeRearRightCmd = (tdble)commands[REAR_RGT];
    car->ctrl.brakeRearLeftCmd = (tdble)commands[REAR_LFT];
    double spin = std::max(-longSlip(car, REAR_RGT), -longSlip(car, REAR_LFT));
    double latSlip = std::max(fabs(car->_wheelSlipSide(REAR_RGT)), fabs(car->_wheelSlipSide(REAR_LFT))) / std::max(4.0, fabs(v));
    double slip = hypot(std::max(0.0, spin), latSlip);
    double spinExcess = fabs(v) > 3.0 ? slip - tcSlip : -1.0;
    driver.tractionLimit = spinExcess > 0 ? std::max(0.08, driver.tractionLimit - 26.0 * spinExcess * dt / tcSlip)
                                          : std::min(1.0, driver.tractionLimit + 2.0 * dt);
    car->_brakeCmd = (tdble)brake;
    car->_accelCmd = (tdble)(std::min(accel, driver.tractionLimit) * (1.0 - driver.slide));
}

template <class Path>
void steerAndGo(int index, Driver &driver, tCarElt *car, tSituation *s, Path pathAt, double speed, double soon, double dt)
{
    double limit = conflictSpeed(index, car, s, speed);
    car->_steerCmd = (tdble)steerFor(driver, car, pathAt(car->_distFromStartLine), pathAt, dt);
    applyPedals(driver, car, limit, std::min(limit, soon), dt);
    car->_gearCmd = chooseGear(car);
}

bool laneClearBehind(int index, tCarElt *car, tSituation *s)
{
    for (int i = 0; i < s->_ncars; i++)
    {
        if (i == index || !activeCar(s, i))
            continue;
        tCarElt *other = s->cars[i];
        double gap = delta(other->_distFromStartLine, car->_distFromStartLine);
        double fast = sampled(model.pitLateral, other->_distFromStartLine);
        bool inLane = fabs(other->_trkPos.toMiddle - fast) < 2.5;
        if (inLane && gap > -4.0 && gap < pitReleaseClear)
            return false;
    }
    return true;
}

void hold(tCarElt *car)
{
    car->ctrl.singleWheelBrakeMode = 0;
    car->_brakeCmd = 1.0f;
    car->_accelCmd = 0.0f;
    car->_clutchCmd = 0.0f;
    car->_gearCmd = 1;
    car->_steerCmd = 0.0f;
}

bool trafficComing(int index, tCarElt *car, tSituation *s)
{
    for (int i = 0; i < s->_ncars; i++)
    {
        if (i == index || !activeCar(s, i) || ghostCar(i) || drivers[i].pit != PIT_NONE)
            continue;
        tCarElt *other = s->cars[i];
        double behind = delta(other->_distFromStartLine, car->_distFromStartLine);
        if (behind > -3.0 && behind < rejoinLook && other->_speed_x > 8.0)
            return true;
    }
    return false;
}

bool carBehindTail(int index, tCarElt *car, tSituation *s)
{
    double hx = cos(car->_yaw), hy = sin(car->_yaw);
    for (int i = 0; i < s->_ncars; i++)
    {
        if (i == index || !activeCar(s, i) || ghostCar(i))
            continue;
        double dx = s->cars[i]->_pos_X - car->_pos_X;
        double dy = s->cars[i]->_pos_Y - car->_pos_Y;
        if (hypot(dx, dy) < reverseClear && dx * hx + dy * hy < 0)
            return true;
    }
    return false;
}

bool recover(int index, Driver &driver, tCarElt *car, tSituation *s, double dt, double beyond)
{
    double angle = relativeYaw(car);
    double v = (double)car->_speed_x;
    bool wrongWay = fabs(angle) > 1.2;
    bool stopped = fabs(v) < 2.0 && sdRaceControlSinceSignal(s) > 0;
    driver.stuckClock = stopped || wrongWay ? driver.stuckClock + dt : 0.0;
    bool lost = wrongWay || (driver.reverseClock > 0);
    driver.rejoinClock = lost ? driver.rejoinClock + dt : 0.0;
    if (lost && driver.rejoinClock < rejoinWait && fabs(v) < 6.0 && trafficComing(index, car, s))
    {
        hold(car);
        return true;
    }
    if (driver.reverseClock > 0)
    {
        driver.reverseClock -= dt;
        car->ctrl.singleWheelBrakeMode = 0;
        car->_gearCmd = -1;
        car->_accelCmd = 0.45f;
        car->_brakeCmd = 0.0f;
        car->_steerCmd = (tdble)std::max(-1.0, std::min(1.0, angle * 1.2));
        return true;
    }
    if (driver.stuckClock > 2.5 && (wrongWay || beyond > 0.5) && !carBehindTail(index, car, s))
    {
        driver.stuckClock = 0;
        driver.reverseClock = 2.2;
        return true;
    }
    if (wrongWay)
    {
        car->ctrl.singleWheelBrakeMode = 0;
        car->_gearCmd = 1;
        car->_accelCmd = 0.35f;
        car->_brakeCmd = 0.0f;
        car->_steerCmd = (tdble)(angle > 0 ? -1.0 : 1.0);
        return true;
    }
    return false;
}

double outLapHold(int index, tCarElt *car, tSituation *s)
{
    double pos = wrap(car->_distFromStartLine);
    if (pos < model.length * outLapHoldFrom || pos > model.length - outLapFinalRun)
        return 1.0;
    double closest = 1e9;
    for (int i = 0; i < s->_ncars; i++)
    {
        if (i == index || !activeCar(s, i) || ghostCar(i) || drivers[i].pit != PIT_NONE)
            continue;
        double gap = delta(pos, s->cars[i]->_distFromStartLine);
        if (gap > 0)
            closest = std::min(closest, gap);
    }
    if (closest > outLapGapDistance)
        return 1.0;
    return outLapHoldSpeed + (1.0 - outLapHoldSpeed) * closest / outLapGapDistance;
}

void drivePit(int index, Driver &driver, tCarElt *car, tSituation *s, double dt)
{
    const PitLayout &p = model.pit;
    double pos = car->_distFromStartLine;
    double v = std::max(0.0, (double)car->_speed_x);
    double limit = p.speedLimit / 3.6 - 0.4;
    double box = boxDistance(driver.bay);
    double boxLat = p.boxLateral - pitShift(box);
    double toBox = wrap(box - pos);
    const auto lanePath = [&](double at) { return sampled(model.pitLateral, at); };
    if (driver.pit == PIT_APPROACH)
    {
        double braking = sqrt(limit * limit + 2.0 * 26.0 * std::max(0.0, wrap(p.wallStart - 40.0 - pos)));
        double speed = std::min(targetSpeedAt(driver, pos, 0.0), braking);
        double soon = std::min(targetSpeedAt(driver, pos + std::max(4.0, v * 0.25), 0.0), sqrt(limit * limit + 2.0 * 26.0 * std::max(0.0, wrap(p.wallStart - 40.0 - pos - v * 0.25))));
        const auto path = [&](double at) { return approachPath(at); };
        steerAndGo(index, driver, car, s, path, speed, soon, dt);
        bool reached = car->_trkPos.toMiddle + pitShift(pos) > p.pitWall + 0.6;
        if (onArc(pos, p.wallStart - 18.0, p.wallEnd) && !reached)
        {
            driver.pit = PIT_NONE;
            driver.pitPending = true;
            driver.lane = car->_trkPos.toMiddle - sampled(model.line, pos);
            driver.laneTarget = 0;
            return;
        }
        if (onArc(pos, p.wallStart - 6.0, p.wallEnd))
            driver.pit = PIT_LANE;
        return;
    }
    if (driver.pit == PIT_LANE)
    {
        if (driver.driveThrough)
        {
            driver.pit = PIT_EXIT;
            return;
        }
        if (toBox < stopRun)
            driver.pit = PIT_BOXING;
        steerAndGo(index, driver, car, s, lanePath, limit, toBox < stopRun + 8.0 ? sqrt(2.0 * stopDecel * std::max(0.0, toBox)) : limit, dt);
        return;
    }
    if (driver.pit == PIT_BOXING)
    {
        const auto path = [&](double at) {
            double remaining = delta(at, box);
            double blend = remaining < 0 ? 1.0 : ease(1.0 - (remaining - 3.0) / (turnInLead - 3.0));
            double laneAt = sampled(model.pitLateral, at);
            return laneAt + (boxLat - laneAt) * blend;
        };
        double speed = std::min(limit, sqrt(2.0 * stopDecel * std::max(0.0, toBox)) + 0.4);
        steerAndGo(index, driver, car, s, path, speed, std::min(limit, sqrt(2.0 * stopDecel * std::max(0.0, toBox - v * 0.25))), dt);
        if (toBox > model.length / 2 || toBox < 0.6 || (toBox < 1.6 && v < 1.2))
        {
            driver.pit = PIT_STOPPED;
            driver.pitClock = driver.pitTime;
            driver.serviced = false;
            hold(car);
        }
        return;
    }
    if (driver.pit == PIT_STOPPED)
    {
        hold(car);
        driver.pitClock -= dt;
        if (driver.pitClock <= 0 && !driver.serviced)
        {
            driver.serviced = true;
            if (!driver.noService)
                sdServiceCar(index, driver.pitCompound);
            driver.pitDone = true;
            driver.holdClock = 0.25;
        }
        if (driver.serviced && driver.autoRelease)
        {
            driver.holdClock -= dt;
            if (driver.holdClock <= 0 && laneClearBehind(index, car, s))
                driver.pit = PIT_RELEASE;
        }
        return;
    }
    if (driver.pit == PIT_RELEASE)
    {
        const auto path = [&](double at) {
            double run = delta(box, at);
            double blend = run < 0 ? 0.0 : ease(run / releaseRun);
            double laneAt = sampled(model.pitLateral, at);
            return boxLat + (laneAt - boxLat) * blend;
        };
        steerAndGo(index, driver, car, s, path, limit, limit, dt);
        if (delta(box, pos) > releaseRun)
            driver.pit = PIT_EXIT;
        return;
    }
    if (driver.pit == PIT_EXIT)
    {
        bool inLimit = onArc(pos, p.entry, p.wallEnd);
        double speed = inLimit ? limit : std::min(45.0, targetSpeedAt(driver, pos, 0.0));
        double soon = inLimit ? limit : std::min(45.0, targetSpeedAt(driver, pos + std::max(4.0, v * 0.25), 0.0));
        steerAndGo(index, driver, car, s, lanePath, speed, soon, dt);
        if (wrap(pos - p.exit - 10.0) < 200.0)
        {
            driver.pit = PIT_NONE;
            driver.driveThrough = false;
            driver.noService = false;
            if (driver.deferredPit)
            {
                driver.deferredPit = false;
                sdAiRequestPit(index, driver.deferredCompound, driver.deferredTime);
            }
            driver.lane = car->_trkPos.toMiddle - sampled(model.line, pos);
            driver.laneTarget = driver.lane;
        }
    }
}

void updatePush(int index, Driver &driver, tCarElt *car, tSituation *s, double dt)
{
    double pos = car->_distFromStartLine;
    double v = std::max(5.0, (double)car->_speed_x);
    double wanted = 0;
    if (driver.task == AI_RACE)
    {
        for (int i = 0; i < s->_ncars; i++)
        {
            if (i == index || !activeCar(s, i) || ghostCar(i) || sdAiInPitLane(i))
                continue;
            double gap = delta(pos, s->cars[i]->_distFromStartLine);
            if (gap > 0 && gap / v < fightGapAhead)
                wanted = 1;
            if (gap < 0 && -gap / v < fightGapBehind)
                wanted = std::max(wanted, defendPush);
        }
        double heat = sdTyresHeat(index);
        if (heat > hotMargin)
            wanted = std::max(0.0, wanted - (heat - hotMargin) * 0.12);
    }
    double rate = wanted > driver.push ? pushRise : pushFall;
    double step = rate * dt;
    driver.push += std::max(-step, std::min(step, wanted - driver.push));
}

void updateEnergy(int index, Driver &driver, tCarElt *car, double fighting)
{
    int mode = 1;
    if (driver.task == AI_PUSH_LAP)
        mode = 2;
    if (driver.task == AI_OUT_LAP || driver.task == AI_IN_LAP || driver.task == AI_COOL_DOWN)
        mode = 0;
    if (driver.task == AI_RACE && fighting > defendPush + 0.1 && sdEnergyBatteryShare(index) > 0.25)
        mode = 3;
    sdEnergySetMode(index, mode);
}

}

double sdAiWrap(double distance)
{
    return wrap(distance);
}

double sdAiLength()
{
    return model.length;
}

bool sdAiLoadTrack(tTrack *track)
{
    std::string path = std::string(GfDataDir()) + "tracks/circuit/cota/ai.dat";
    auto data = readData(path.c_str());
    if (data.empty() || strcmp(track->internalname, "cota") != 0)
    {
        model.ready = false;
        return false;
    }
    model.track = track;
    model.length = track->length;
    model.count = (int)floor(model.length / sampleStep);
    model.segments.assign(model.count, nullptr);
    tTrackSeg *seg = track->seg->next;
    tTrackSeg *first = seg;
    do
    {
        int from = (int)ceil(seg->lgfromstart / sampleStep);
        int to = (int)ceil((seg->lgfromstart + seg->length) / sampleStep);
        for (int i = from; i < to && i < model.count; i++)
            model.segments[i] = seg;
        seg = seg->next;
    } while (seg != first);
    for (int i = 0; i < model.count; i++)
        if (!model.segments[i])
            model.segments[i] = first;

    const auto &frameData = data["frame"];
    tdble sx, sy;
    tTrkLocPos startPos;
    startPos.seg = first;
    startPos.type = TR_LPOS_MAIN;
    startPos.toStart = 0;
    startPos.toMiddle = 0;
    startPos.toRight = first->width / 2;
    startPos.toLeft = first->width / 2;
    RtTrackLocal2Global(&startPos, &sx, &sy, TR_TOMIDDLE);
    Frame frame = {frameData[0], frameData[1], frameData[2], frameData[3], sx, sy};

    tTrackSeg *hint = first;
    std::vector<Projected> points;
    const auto &lx = data["line_x"];
    const auto &lz = data["line_z"];
    points.reserve(lx.size());
    for (size_t i = 0; i < lx.size(); i++)
    {
        double wx, wy;
        toWorld(frame, lx[i], lz[i], &wx, &wy);
        points.push_back(project(&hint, wx, wy));
    }
    resample(points, model.rawLine, model.count);
    smooth(model.rawLine, 1);
    model.line = model.rawLine;

    const auto &cx = data["centre_x"];
    const auto &cz = data["centre_z"];
    const auto &cw = data["centre_width"];
    const auto &kl = data["kerb_left"];
    const auto &kr = data["kerb_right"];
    int centreCount = (int)cx.size();
    std::vector<Projected> leftEdge, rightEdge, leftLine, rightLine;
    hint = first;
    for (int i = 0; i < centreCount; i++)
    {
        int a = (i + 1) % centreCount, b = (i - 1 + centreCount) % centreCount;
        double fx = cx[a] - cx[b], fz = cz[a] - cz[b];
        double size = hypot(fx, fz);
        fx /= size;
        fz /= size;
        double leftX = fz, leftZ = -fx;
        double half = cw[i] / 2 - edgeMargin;
        double wx, wy;
        toWorld(frame, cx[i] + leftX * (half + kl[i] * kerbUse), cz[i] + leftZ * (half + kl[i] * kerbUse), &wx, &wy);
        leftEdge.push_back(project(&hint, wx, wy));
        toWorld(frame, cx[i] - leftX * (half + kr[i] * kerbUse), cz[i] - leftZ * (half + kr[i] * kerbUse), &wx, &wy);
        rightEdge.push_back(project(&hint, wx, wy));
        toWorld(frame, cx[i] + leftX * cw[i] / 2, cz[i] + leftZ * cw[i] / 2, &wx, &wy);
        leftLine.push_back(project(&hint, wx, wy));
        toWorld(frame, cx[i] - leftX * cw[i] / 2, cz[i] - leftZ * cw[i] / 2, &wx, &wy);
        rightLine.push_back(project(&hint, wx, wy));
    }
    resample(leftEdge, model.leftBound, model.count);
    resample(rightEdge, model.rightBound, model.count);
    resample(leftLine, model.leftLimit, model.count);
    resample(rightLine, model.rightLimit, model.count);

    const auto &gain = data["gain"];
    model.gain.assign(model.count, 1.0);
    if (!gain.empty())
        for (int i = 0; i < model.count; i++)
        {
            double x = (double)i / model.count * gain.size();
            int a = (int)x % gain.size();
            int b = (a + 1) % gain.size();
            model.gain[i] = gain[a] + (gain[b] - gain[a]) * (x - floor(x));
        }

    std::vector<double> px(model.count), py(model.count);
    model.centreKappa.assign(model.count, 0.0);
    for (int i = 0; i < model.count; i++)
        globalPoint(i * sampleStep, 0.0, &px[i], &py[i]);
    for (int i = 0; i < model.count; i++)
    {
        int a = (i - 3 + model.count) % model.count, b = (i + 3) % model.count;
        model.centreKappa[i] = curvatureOf(px[a], py[a], px[i], py[i], px[b], py[b]);
    }

    const auto &pitValues = data["pit"];
    model.pit = {pitValues[0], pitValues[1], pitValues[2], pitValues[3], pitValues[4], pitValues[5], pitValues[6], pitValues[7], pitValues[8], pitValues[9], pitValues[10], pitValues[11], pitValues[12]};

    const auto &gridDistance = data["grid_distance"];
    const auto &gridOffset = data["grid_offset"];
    model.gridDistance = gridDistance;
    model.gridLateral.resize(gridDistance.size());
    for (size_t i = 0; i < gridDistance.size(); i++)
        model.gridLateral[i] = gridOffset[i] - pitShift(gridDistance[i]);

    const auto &pitX = data["pit_x"];
    const auto &pitZ = data["pit_z"];
    std::vector<Projected> pitPoints;
    hint = first;
    for (size_t i = 0; i < pitX.size(); i++)
    {
        double wx, wy;
        toWorld(frame, pitX[i], pitZ[i], &wx, &wy);
        pitPoints.push_back(project(&hint, wx, wy));
    }
    model.pitLateral.assign(model.line.begin(), model.line.end());
    std::vector<double> pitSum(model.count, 0.0), pitWeight(model.count, 0.0);
    for (const Projected &p : pitPoints)
    {
        int i = sampleIndex(p.s);
        pitSum[i] += p.l;
        pitWeight[i] += 1.0;
    }
    int previous = -1;
    for (size_t k = 0; k < pitPoints.size(); k++)
    {
        int i = sampleIndex(pitPoints[k].s);
        if (pitWeight[i] <= 0)
            continue;
        double value = pitSum[i] / pitWeight[i];
        model.pitLateral[i] = value;
        if (previous >= 0)
        {
            int gap = (i - previous + model.count) % model.count;
            if (gap > 1 && gap < 40)
                for (int g = 1; g < gap; g++)
                {
                    int m = (previous + g) % model.count;
                    double t = (double)g / gap;
                    model.pitLateral[m] = model.pitLateral[previous] + (value - model.pitLateral[previous]) * t;
                }
        }
        previous = i;
    }
    for (int i = 0; i < model.count; i++)
    {
        double at = i * sampleStep;
        double span = garageBays * model.pit.spacing + 2.0 * fastLaneRamp;
        double along = wrap(at - model.pit.garageStart + fastLaneRamp);
        if (along < span)
            model.pitLateral[i] -= fastLaneOffset * std::min(ease(along / fastLaneRamp), ease((span - along) / fastLaneRamp));
    }

    buildLanes();
    model.ready = true;
    return true;
}

void sdAiReset(int cars)
{
    drivers.assign(cars, Driver());
    forecasts.assign(cars, Forecast());
    forecastClock = -1;
}

void sdAiConfigure(int index, double pace, double racePace, double racecraft, int bay)
{
    Driver &driver = drivers[index];
    driver.pace = pace;
    driver.racePace = racePace;
    driver.racecraft = racecraft;
    driver.bay = bay;
}

void sdAiSetTask(int index, SdAiTask task)
{
    drivers[index].task = task;
}

SdAiTask sdAiTask(int index)
{
    return drivers[index].task;
}

void sdAiSetPaceScale(double scale)
{
    paceScale = scale;
}

void sdAiRequestPit(int index, int compound, double stopTime)
{
    Driver &driver = drivers[index];
    if (driver.pit != PIT_NONE)
        return;
    driver.pitPending = true;
    driver.autoRelease = true;
    driver.pitCompound = compound;
    driver.pitTime = stopTime;
    driver.pitDone = false;
    driver.driveThrough = false;
    driver.noService = false;
}

bool sdAiRequestPenalty(int index, bool driveThrough, double stopTime)
{
    Driver &driver = drivers[index];
    if (driver.pit != PIT_NONE)
        return false;
    if (driver.pitPending && !driver.noService)
    {
        driver.deferredPit = true;
        driver.deferredCompound = driver.pitCompound;
        driver.deferredTime = driver.pitTime;
    }
    driver.pitPending = false;
    sdAiRequestPit(index, sdTyresCompound(index), stopTime);
    driver.driveThrough = driveThrough;
    driver.noService = true;
    return true;
}

void sdAiExtendStop(int index, double seconds)
{
    Driver &driver = drivers[index];
    if (driver.pitPending && !driver.noService)
        driver.pitTime += seconds;
}

void sdAiSetSpeedCap(int index, double metresPerSecond)
{
    drivers[index].speedCap = metresPerSecond;
}

double sdAiLineSpeed(double distance)
{
    return model.ready ? sampled(model.laneSpeed[laneCentre], distance) : 60.0;
}

double sdAiPitEntry()
{
    return model.pit.entry;
}

double sdAiFastLane(double distance)
{
    return model.ready ? sampled(model.pitLateral, distance) : 0.0;
}

void sdAiResetRunning(int index)
{
    Driver &driver = drivers[index];
    driver.pit = PIT_NONE;
    driver.pitPending = false;
    driver.deferredPit = false;
    driver.driveThrough = false;
    driver.noService = false;
    driver.lane = 0;
    driver.laneTarget = 0;
    driver.steer = 0;
    driver.stuckClock = 0;
    driver.crawlClock = 0;
    driver.stuckTotal = 0;
    driver.reverseClock = 0;
    driver.rejoinClock = 0;
    driver.slide = 0;
}

void sdAiSetCaution(int index, double factor)
{
    drivers[index].caution = factor;
}

bool sdAiTrackEdges(double distance, double *left, double *right)
{
    if (!model.ready || model.leftLimit.empty())
        return false;
    *left = sampled(model.leftLimit, distance);
    *right = sampled(model.rightLimit, distance);
    return true;
}

double sdAiRacingLine(double distance)
{
    return model.ready ? sampled(model.line, distance) : 0.0;
}

void sdAiPitZone(double *from, double *to, double *limit)
{
    *from = model.pit.wallStart;
    *to = model.pit.wallEnd;
    *limit = model.pit.speedLimit / 3.6;
}

double sdAiCurvature(double distance)
{
    if (!model.ready)
        return 0;
    return sampled(model.centreKappa, distance);
}

bool sdAiInPitLane(int index)
{
    return drivers[index].pit != PIT_NONE;
}

bool sdAiPitPending(int index)
{
    return drivers[index].pitPending;
}

void sdAiSetBlueFlag(int index, bool on)
{
    drivers[index].blueFlag = on;
}

void sdAiSetReaction(int index, double seconds)
{
    drivers[index].reaction = seconds;
}

void sdAiSetLapNoise(int index, double factor)
{
    drivers[index].lapNoise = factor;
}

void sdAiToGarage(int index, int compound, double service)
{
    Driver &driver = drivers[index];
    driver.pitPending = true;
    driver.autoRelease = false;
    driver.pitCompound = compound;
    driver.pitTime = service;
    driver.pitDone = false;
}

void sdAiLeaveGarage(int index)
{
    Driver &driver = drivers[index];
    driver.pit = PIT_STOPPED;
    driver.pitClock = 0;
    driver.holdClock = 0;
    driver.serviced = true;
    driver.pitDone = false;
    driver.pitPending = false;
    driver.autoRelease = true;
    driver.push = 0;
}

void sdAiTakeOver(int index)
{
    Driver &driver = drivers[index];
    driver.task = AI_COOL_DOWN;
    driver.pit = PIT_NONE;
    driver.pitPending = false;
    driver.laneTarget = 0;
}

void sdAiResetAtBox(int index)
{
    Driver &driver = drivers[index];
    driver.pit = PIT_STOPPED;
    driver.pitClock = 1e9;
    driver.pitDone = false;
    driver.serviced = true;
    driver.pitPending = false;
    driver.autoRelease = false;
    driver.steer = 0;
    driver.lane = 0;
    driver.laneTarget = 0;
    driver.stuckClock = 0;
    driver.reverseClock = 0;
}

bool sdAiPitDone(int index)
{
    return drivers[index].pitDone;
}

bool sdAiGridSlot(int slot, double *distance, double *lateral)
{
    if (slot < 0 || slot >= (int)model.gridDistance.size())
        return false;
    *distance = model.gridDistance[slot] * model.length / (model.gridDistance.empty() ? model.length : model.length);
    *lateral = model.gridLateral[slot];
    return true;
}

bool sdAiBoxOf(int bay, double *distance, double *lateral)
{
    *distance = boxDistance(bay);
    *lateral = model.pit.boxLateral - pitShift(*distance);
    return true;
}

double sdAiStuckTime(int index)
{
    return drivers[index].stuckTotal;
}

int sdAiBayOf(int index)
{
    return drivers[index].bay;
}

bool sdAiInPitLaneAt(double distance, double toMiddle)
{
    const PitLayout &p = model.pit;
    if (onArc(distance, p.entry - pitEntryGrace, p.wallStart) && toMiddle > 0)
        return true;
    return onArc(distance, p.entry, p.exit) && toMiddle + pitShift(distance) > p.pitWall;
}

void sdAiDrive(int index, tCarElt *car, tSituation *s)
{
    Driver &driver = drivers[index];
    double dt = s->deltaTime;
    car->_clutchCmd = 0.0f;
    car->_lightCmd = 0;
    driver.gripClock -= dt;
    if (driver.gripClock <= 0)
    {
        driver.gripClock = 1.0;
        driver.grip = sdTyresWeakestAxle(index);
        double fuelShare = (double)car->_fuel / std::max(1.0f, car->_tank);
        driver.weight = 1.0 - 0.09 * fuelShare;
    }
    updateForecasts(s);
    double sinceSignal = sdRaceControlSinceSignal(s);
    if (sdRaceControlHolding(s) || (!sdRaceControlFormation() && sinceSignal < driver.reaction))
    {
        hold(car);
        car->_accelCmd = sinceSignal > -launchRevs && sinceSignal < driver.reaction ? 0.7f : 0.0f;
        return;
    }
    if (driver.task == AI_PARKED || driver.task == AI_GARAGE)
    {
        hold(car);
        return;
    }
    double pos = car->_distFromStartLine;
    if (driver.pitPending && driver.pit == PIT_NONE && wrap(model.pit.entry - pos) < pitPendingDistance && trackBeyond(car) < 1.0 && fabs(relativeYaw(car)) < 0.5 && car->_speed_x > 5.0)
    {
        driver.pitPending = false;
        driver.pit = PIT_APPROACH;
    }
    if (driver.pitPending && driver.pit == PIT_NONE && wrap(model.pit.entry - pos) < pitPendingDistance + 250.0)
        driver.laneTarget = 0;
    if (driver.pit == PIT_NONE && onArc(pos, model.pit.wallStart, model.pit.wallEnd) && car->_trkPos.toMiddle + pitShift(pos) > model.pit.pitWall)
        driver.pit = PIT_EXIT;
    if (driver.pit != PIT_NONE)
    {
        sdEnergySetMode(index, 0);
        drivePit(index, driver, car, s, dt);
        return;
    }
    updatePush(index, driver, car, s, dt);
    driver.planClock -= dt;
    if (driver.planClock <= 0)
    {
        driver.planClock = planPeriod;
        plan(index, driver, car, s);
    }
    updateEnergy(index, driver, car, driver.push);
    double v = std::max(0.0, (double)car->_speed_x);
    double usage = std::min(0.8, fabs(sampled(model.kappa, pos)) * v * v / lateralLimit(std::max(v, 1.0)));
    double rate = laneChangeRate * (1.0 - usage);
    double step = rate * dt;
    driver.lane += std::max(-step, std::min(step, driver.laneTarget - driver.lane));
    double wanted = laneLateralAt(pos + v * 0.05, driver.lane);
    double speedFactor = (driver.blueFlag ? yieldSpeed : 1.0) * driver.caution;
    double lateral = lateralSafety(index, car, s, wanted, &speedFactor);
    if (driver.task == AI_RACE && targetSpeedAt(driver, pos + v * 2.0, driver.lane) > slowCornerSpeed && holdsInside(index, car, s))
        speedFactor = std::max(speedFactor, insideLateBrake);
    double beyond = std::max((double)car->_trkPos.toMiddle - sampled(model.leftBound, pos), sampled(model.rightBound, pos) - (double)car->_trkPos.toMiddle);
    if (pos < firstLapDistance && sdRaceControlSinceSignal(s) < 60.0)
        speedFactor = std::min(speedFactor, firstLapCaution);
    if (beyond > 1.0)
    {
        double back = beyond > 3.0 ? 3.0 : beyond;
        lateral = car->_trkPos.toMiddle > 0 ? (double)car->_trkPos.toMiddle - back : (double)car->_trkPos.toMiddle + back;
        driver.lane = lateral - sampled(model.line, pos);
        driver.laneTarget = driver.lane;
    }
    if (recover(index, driver, car, s, dt, beyond))
        return;
    double upcomingDistance = pos + std::max(4.0, v * 0.25);
    double target = targetSpeedAt(driver, pos + v * 0.04, driver.lane) * speedFactor;
    double upcoming = targetSpeedAt(driver, upcomingDistance, driver.lane) * speedFactor;
    if (beyond > 1.5)
    {
        target = std::min(target, offTrackSpeed);
        upcoming = std::min(upcoming, offTrackSpeed);
    }
    if (driver.task == AI_OUT_LAP)
    {
        double hurry = outLapHold(index, car, s);
        target *= hurry;
        upcoming *= hurry;
    }
    target = std::min(target, driver.speedCap);
    upcoming = std::min(upcoming, driver.speedCap);
    double safe = conflictSpeed(index, car, s, target);
    if (fabs(v) < 3.0 && sdRaceControlSinceSignal(s) > 2.0)
        driver.crawlClock += dt;
    else
        driver.crawlClock = 0;
    if (driver.crawlClock > 3.0)
        safe = std::max(safe, 7.0);
    driver.stuckTotal = fabs(v) < 4.0 && sdRaceControlSinceSignal(s) > 1.0 ? driver.stuckTotal + dt : std::max(0.0, driver.stuckTotal - dt);
    target = std::min(target, safe);
    upcoming = std::min(upcoming, safe);
    double offset = lateral - laneLateralAt(pos, driver.lane);
    const auto path = [&](double at) { return clampLateral(at, laneLateralAt(at, driver.lane) + offset); };
    car->_steerCmd = (tdble)steerFor(driver, car, lateral, path, dt);
    applyPedals(driver, car, target, upcoming, dt);
    car->_gearCmd = chooseGear(car);
}

extern "C" {

EMSCRIPTEN_KEEPALIVE int sdAiPlayerLaneClear()
{
    tSituation *s = ReInfo->s;
    return laneClearBehind(0, s->cars[0], s) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE void sdAiLine(int sample, double *out)
{
    out[0] = model.line[sample];
    out[1] = model.leftBound[sample];
    out[2] = model.rightBound[sample];
    out[3] = model.kappa[sample];
    out[4] = model.laneSpeed[laneCentre][sample];
    out[5] = model.pitLateral[sample];
}

EMSCRIPTEN_KEEPALIVE void sdAiFuel(int index, double litres)
{
    sdCarSetFuel(index, litres);
}

EMSCRIPTEN_KEEPALIVE void sdAiRebuild()
{
    buildLanes();
}

EMSCRIPTEN_KEEPALIVE void sdAiGainSet(int sample, double value)
{
    model.gain[sample] = value;
}

EMSCRIPTEN_KEEPALIVE int sdAiLineCount()
{
    return model.count;
}

}

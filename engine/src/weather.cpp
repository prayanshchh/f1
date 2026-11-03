#include <algorithm>
#include <cmath>
#include <random>
#include <vector>
#include <emscripten/emscripten.h>

#include "sim.h"
#include "ai.h"
#include "game.h"

namespace
{

const double wetRate = 1.0 / 90.0;
const double drainRate = 1.0 / 600.0;
const double clearPerPass = 0.0048;
const double minimumTraffic = 6.0;
const double lineHalfWidth = 1.0;
const double lineBlend = 1.2;
const double rainLevels = 3.0;
const double slickLimit = 0.16;
const double interLimit = 0.55;
const double changeMinutesLow = 4.0;
const double changeMinutesHigh = 11.0;
const double rampSeconds = 90.0;
const double timelineSeconds = 4.0 * 3600.0;
const double forecastStep = 300.0;
const int forecastPoints = 6;
const double futureStep = 5.0;
const double stayChance = 0.35;
const double dryBias = 0.55;
const double startWeights[4] = {0.45, 0.30, 0.18, 0.07};

struct Shift
{
    double at;
    double rain;
};

bool dynamicMode = false;
unsigned seed = 1;
std::vector<Shift> timeline;
double staticRain = 0;
double rain = 0;
double lineWater = 0;
double offWater = 0;
double weatherClock = 0;

double clamp01(double value)
{
    return std::max(0.0, std::min(1.0, value));
}

void buildTimeline()
{
    timeline.clear();
    std::mt19937 rng(seed);
    auto uniform = [&](double low, double high) { return std::uniform_real_distribution<double>(low, high)(rng); };
    int level = 0;
    double pick = uniform(0, 1);
    while (level < 3 && pick > startWeights[level])
        pick -= startWeights[level++];
    double at = 0;
    timeline.push_back({0, level / rainLevels});
    while (at < timelineSeconds)
    {
        at += uniform(changeMinutesLow, changeMinutesHigh) * 60.0;
        double roll = uniform(0, 1);
        if (roll >= stayChance)
        {
            bool drier = level == 3 || (level > 0 && uniform(0, 1) < dryBias);
            level += drier ? -1 : 1;
        }
        timeline.push_back({at, level / rainLevels});
    }
}

double rainAt(double t)
{
    if (!dynamicMode || timeline.empty())
        return staticRain;
    double value = timeline.front().rain;
    for (size_t i = 1; i < timeline.size(); i++)
    {
        const Shift &shift = timeline[i];
        if (t < shift.at)
            break;
        double blend = clamp01((t - shift.at) / rampSeconds);
        value = timeline[i - 1].rain + (shift.rain - timeline[i - 1].rain) * blend;
    }
    return value;
}

double settle(double water, double target, double dt)
{
    double rate = target > water ? wetRate : drainRate;
    return water + (target - water) * std::min(1.0, rate * dt);
}

double passRate(tSituation *s)
{
    double length = ReInfo->track->length;
    double passes = 0;
    for (int i = 0; i < s->_ncars; i++)
        if ((s->cars[i]->_state & RM_CAR_STATE_NO_SIMU) == 0)
            passes += std::max(0.0, (double)s->cars[i]->_speed_x) / length;
    double floor = minimumTraffic * 60.0 / length;
    return std::max(passes, floor);
}

double wheelDistance(const tTrkLocPos &pos)
{
    const tTrackSeg *seg = pos.seg;
    if (!seg)
        return 0;
    return seg->lgfromstart + (seg->type == TR_STR ? pos.toStart : pos.toStart * seg->radius);
}

}

double sdWeatherLineShare(double offset)
{
    return clamp01((lineHalfWidth + lineBlend - fabs(offset)) / lineBlend);
}

namespace
{

double lineShare(double distance, double toMiddle)
{
    double line = 0;
    if (!sdAiLineLateral(distance, &line))
        return 0;
    return sdWeatherLineShare(toMiddle - line);
}

}

void sdWeatherReset()
{
    tTrackLocalInfo &local = ReInfo->track->local;
    staticRain = clamp01(local.rain / rainLevels);
    if (dynamicMode)
        buildTimeline();
    weatherClock = 0;
    rain = rainAt(0);
    double start = dynamicMode ? rain : clamp01(local.water / rainLevels);
    lineWater = offWater = start;
}

void sdWeatherStep(tSituation *s, double dt)
{
    weatherClock += dt;
    rain = rainAt(weatherClock);
    double cleared = clearPerPass * passRate(s) * dt;
    lineWater = std::max(0.0, settle(lineWater, rain, dt) - cleared * lineWater);
    offWater = settle(offWater, rain, dt);
}

double sdWeatherWaterAt(double distance, double toMiddle)
{
    double share = lineShare(distance, toMiddle);
    return offWater + (lineWater - offWater) * share;
}

double sdWeatherWheelWater(tCarElt *car, int wheel)
{
    const tTrkLocPos &pos = SimCarTable[car->index].wheel[wheel].trkPos;
    return sdWeatherWaterAt(wheelDistance(pos), pos.toMiddle);
}

double sdWeatherCarWater(tCarElt *car)
{
    double total = 0;
    for (int i = 0; i < 4; i++)
        total += sdWeatherWheelWater(car, i);
    return total / 4.0;
}

double sdWeatherFutureLine(double seconds)
{
    double water = lineWater;
    for (double t = 0; t < seconds; t += futureStep)
        water = settle(water, rainAt(weatherClock + t), futureStep);
    return water;
}

bool sdWeatherWetCompound(int compound)
{
    return compound >= 3;
}

int sdWeatherIdealCompound(double water, int dryChoice)
{
    if (water >= interLimit)
        return 4;
    if (water >= slickLimit)
        return 3;
    return dryChoice;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdWeatherConfigure(int dynamic, int value)
{
    dynamicMode = dynamic != 0;
    seed = (unsigned)std::max(1, value);
}

EMSCRIPTEN_KEEPALIVE void sdWeatherSet(double rainNow, double line, double off)
{
    dynamicMode = false;
    staticRain = rain = clamp01(rainNow);
    lineWater = clamp01(line);
    offWater = clamp01(off);
}

EMSCRIPTEN_KEEPALIVE void sdWeatherInfo(double *out)
{
    out[0] = rain;
    out[1] = lineWater;
    out[2] = offWater;
    out[3] = sdWeatherCarWater(ReInfo->s->cars[0]);
    out[4] = weatherClock;
    out[5] = slickLimit;
    out[6] = interLimit;
    for (int i = 0; i < forecastPoints; i++)
        out[7 + i] = rainAt(weatherClock + (i + 1) * forecastStep);
}

}

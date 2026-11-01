#include <algorithm>
#include <cmath>
#include <emscripten/emscripten.h>

#include "sim.h"
#include "game.h"

namespace
{

struct Compound
{
    double grip[4];
    double low, high;
    double wearFresh, wearWorn, cliff;
    double heat;
    double blanket;
    double drain;
};

const Compound compounds[5] = {
    {{1.050, 0.660, 0.460, 0.340}, 82, 104, 1.15, 2.20, 1.20, 1.05, 70, 0.12},
    {{1.000, 0.640, 0.450, 0.330}, 85, 105, 1.00, 1.80, 1.00, 1.00, 70, 0.12},
    {{0.975, 0.620, 0.430, 0.320}, 88, 108, 0.88, 1.56, 0.85, 0.92, 70, 0.12},
    {{0.860, 0.800, 0.720, 0.500}, 60, 85, 2.20, 2.20, 1.00, 1.45, 60, 0.45},
    {{0.780, 0.740, 0.700, 0.640}, 45, 72, 3.00, 3.00, 1.00, 1.85, 60, 1.00},
};

const double wearPerJoule = 3.8e-8;
const double wornFrom = 0.10;
const double wornTo = 0.50;
const double psi = 6894.76;
const double kelvin = 273.15;
const double surfaceShare = 0.60;
const double coldLoss = 0.0055;
const double coldLossMax = 0.30;
const double hotLoss = 0.0060;
const double hotLossMax = 0.28;
const double hotWearGain = 0.035;
const double hotWearMax = 3.0;
const double surfaceMax = 170.0;
const double coldWearGain = 0.012;
const double pressureGripLoss = 0.0016;
const double pressureHeatGain = 0.03;
const double pressureWearGain = 0.02;
const double slipHeat = 2.6e-4;
const double frontHeatGain = 1.45;
const double frontWearGain = 1.30;
const double rearWearGain = 0.78;
const double flexHeat = 0.72;
const double airCool = 0.0020;
const double speedCool = 0.00040;
const double trackCool = 0.006;
const double surfaceToCarcass = 0.22;
const double carcassFromSurface = 0.035;
const double carcassFlex = 0.0;
const double carcassCool = 0.0040;
const double wetCoolGain = 5.0;
const double trackAboveAir = 9.0;
const double lockStart = 0.20;
const double lockSpan = 0.60;
const double spinStart = 0.25;
const double spinSpan = 1.00;
const double contactSpeed = 5.0;
const double contactLoad = 150.0;
const double slipEffectResponse = 25.0;
const double flatSpotRate = 4.5e-4;
const double flatGripLoss = 0.035;
const double puncturedGrip = 0.32;
const double frontPressure = 23.5;
const double rearPressure = 22.0;
const double aquaplaneSpeed = 83.0;
const double aquaplaneLoss = 1.1;
const double aquaplaneMax = 0.55;
const double maxSlip = 1.5;

struct WearPoint
{
    double wear, loss;
};

const WearPoint wearCurve[] = {
    {0.00, 0.000}, {0.20, 0.006}, {0.40, 0.015}, {0.60, 0.030},
    {0.75, 0.060}, {0.90, 0.140}, {1.00, 0.300},
};

struct Tyre
{
    double surface, carcass, wear, flat, lock, spin, grip, baseMu;
};

Tyre tyres[4];
int fitted = 1;
int startCompound = 1;
int age;
int lastLap;
double wearScale = 1.0;

double clamp01(double value)
{
    return std::max(0.0, std::min(1.0, value));
}

double wetness()
{
    return clamp01(ReInfo->track->local.water / 3.0);
}

double compoundGrip(const Compound &c, double water)
{
    double scaled = water * 3.0;
    int low = std::min(2, (int)scaled);
    return c.grip[low] + (c.grip[low + 1] - c.grip[low]) * (scaled - low);
}

double wearLoss(double wear, double cliff)
{
    int count = sizeof(wearCurve) / sizeof(wearCurve[0]);
    for (int i = 1; i < count; i++)
        if (wear <= wearCurve[i].wear)
        {
            const WearPoint &a = wearCurve[i - 1];
            const WearPoint &b = wearCurve[i];
            return (a.loss + (b.loss - a.loss) * (wear - a.wear) / (b.wear - a.wear)) * cliff;
        }
    return wearCurve[count - 1].loss * cliff;
}

double wearRate(const Compound &c, double wear)
{
    double t = clamp01((wear - wornFrom) / (wornTo - wornFrom));
    return c.wearFresh + (c.wearWorn - c.wearFresh) * t;
}

double thermalGrip(const Compound &c, double temperature)
{
    if (temperature < c.low)
        return 1.0 - std::min(coldLossMax, (c.low - temperature) * coldLoss);
    if (temperature > c.high)
        return 1.0 - std::min(hotLossMax, (temperature - c.high) * hotLoss);
    return 1.0;
}

double thermalWear(const Compound &c, double temperature)
{
    if (temperature > c.high)
        return std::min(hotWearMax, 1.0 + (temperature - c.high) * hotWearGain);
    if (temperature < c.low)
        return 1.0 + (c.low - temperature) * coldWearGain;
    return 1.0;
}

double optimalPressure(int wheel)
{
    return wheel < 2 ? frontPressure : rearPressure;
}

double hotPressure(const tWheel &wheel, const Tyre &tyre, const Compound &c)
{
    double cold = wheel.pressure / psi;
    double atmosphere = SimAirPressure / psi;
    return (cold + atmosphere) * (tyre.carcass + kelvin) / (c.blanket + kelvin) - atmosphere;
}

double aquaplaning(const Compound &c, double water, double speed)
{
    double excess = water * speed / aquaplaneSpeed - c.drain;
    return excess > 0 ? 1.0 - std::min(aquaplaneMax, excess * aquaplaneLoss) : 1.0;
}

void updateSlip(Tyre &tyre, const tWheel &wheel, double speed, double dt)
{
    bool contact = speed > contactSpeed && wheel.forces.z > contactLoad;
    double lock = contact ? clamp01((wheel.sx - lockStart) / lockSpan) : 0.0;
    double spin = contact ? clamp01((-wheel.sx - spinStart) / spinSpan) : 0.0;
    double blend = std::min(1.0, slipEffectResponse * dt);
    tyre.lock += (lock - tyre.lock) * blend;
    tyre.spin += (spin - tyre.spin) * blend;
}

double slipPower(const tWheel &wheel, double speed)
{
    double force = hypot(wheel.forces.x, wheel.forces.y);
    return force * std::min(maxSlip, (double)wheel.tireSlip) * speed;
}

void updateThermal(Tyre &tyre, const tWheel &wheel, const Compound &c, double axle, double power, double pressure, double target, double speed, double water, double dt)
{
    double air = Tair - kelvin;
    double track = air + trackAboveAir;
    double load = wheel.forces.z / 1000.0;
    double flex = load * speed / aquaplaneSpeed * c.heat * (1.0 + (pressure - target) * pressureHeatGain);
    double wet = 1.0 + wetCoolGain * water;
    double surfaceRate = slipHeat * power * c.heat * axle + flexHeat * flex * axle
        - (airCool + speedCool * speed) * wet * (tyre.surface - air)
        - (load > 0.05 ? trackCool * wet : 0.0) * (tyre.surface - track)
        - surfaceToCarcass * (tyre.surface - tyre.carcass);
    double carcassRate = carcassFromSurface * (tyre.surface - tyre.carcass) + carcassFlex * flex - carcassCool * (tyre.carcass - air);
    tyre.surface = std::min(surfaceMax, tyre.surface + surfaceRate * dt);
    tyre.carcass += carcassRate * dt;
}

void updateWear(Tyre &tyre, const Compound &c, double axle, double power, double temperature, double pressure, double target, double speed, double dt)
{
    double pressureFactor = std::max(0.5, 1.0 - (pressure - target) * pressureWearGain);
    double rate = wearPerJoule * wearRate(c, tyre.wear) * thermalWear(c, temperature) * pressureFactor;
    tyre.wear = std::min(1.0, tyre.wear + rate * axle * power * dt * wearScale);
    tyre.flat = std::min(1.0, tyre.flat + flatSpotRate * tyre.lock * tyre.lock * speed * dt);
}

double surfaceRatio(const tWheel &wheel)
{
    const tTrackSurface *surface = wheel.trkPos.seg ? wheel.trkPos.seg->surface : nullptr;
    return surface && surface->kFrictionDry > 0 ? surface->kFriction / surface->kFrictionDry : 1.0;
}

void applyGrip(Tyre &tyre, tWheel &wheel, const Compound &c, double temperature, double pressure, double target, double water, double speed)
{
    double delta = pressure - target;
    double pressureGrip = 1.0 - std::min(0.12, pressureGripLoss * delta * delta);
    double condition = thermalGrip(c, temperature) * (1.0 - wearLoss(tyre.wear, c.cliff)) * pressureGrip * (1.0 - flatGripLoss * tyre.flat);
    double chemistry = compoundGrip(c, water) * aquaplaning(c, water, speed);
    tyre.grip = tyre.wear >= 1.0 ? puncturedGrip : chemistry * condition;
    wheel.mu = (tdble)(tyre.baseMu * tyre.grip / surfaceRatio(wheel));
}

void fit(int compound, double temperature, double wear)
{
    fitted = std::max(0, std::min(4, compound));
    double start = temperature > 0 ? temperature : compounds[fitted].blanket;
    for (Tyre &tyre : tyres)
    {
        tyre.surface = tyre.carcass = start;
        tyre.wear = wear;
        tyre.flat = tyre.lock = tyre.spin = 0;
    }
    age = 0;
}

}

void sdTyresReset(tCarElt *car)
{
    for (int i = 0; i < 4; i++)
        tyres[i].baseMu = SimCarTable[car->index].wheel[i].mu;
    lastLap = car->_laps;
    fit(startCompound, 0, 0);
}

void sdTyresStep(tCarElt *elt, double dt)
{
    if (elt->_laps != lastLap)
    {
        if (elt->_laps > lastLap && lastLap >= 1)
            age++;
        lastLap = elt->_laps;
    }
    tCar *car = &SimCarTable[elt->index];
    const Compound &c = compounds[fitted];
    double water = wetness();
    for (int i = 0; i < 4; i++)
    {
        tWheel &wheel = car->wheel[i];
        Tyre &tyre = tyres[i];
        double speed = hypot(wheel.bodyVel.x, wheel.bodyVel.y);
        double power = slipPower(wheel, speed);
        double target = optimalPressure(i);
        double pressure = hotPressure(wheel, tyre, c);
        updateSlip(tyre, wheel, speed, dt);
        updateThermal(tyre, wheel, c, i < 2 ? frontHeatGain : 1.0, power, pressure, target, speed, water, dt);
        double temperature = surfaceShare * tyre.surface + (1.0 - surfaceShare) * tyre.carcass;
        updateWear(tyre, c, i < 2 ? frontWearGain : rearWearGain, power, temperature, pressure, target, speed, dt);
        applyGrip(tyre, wheel, c, temperature, pressure, target, water, speed);
    }
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdTyresConfigure(int compound, double scale)
{
    startCompound = std::max(0, std::min(4, compound));
    wearScale = scale;
}

EMSCRIPTEN_KEEPALIVE void sdTyresFit(int compound, double temperature, double wear)
{
    fit(compound, temperature, wear);
}

EMSCRIPTEN_KEEPALIVE void sdTyresInfo(double *out)
{
    tCar *car = &SimCarTable[0];
    const Compound &c = compounds[fitted];
    out[0] = fitted;
    out[1] = age;
    out[2] = c.low;
    out[3] = c.high;
    for (int i = 0; i < 4; i++)
    {
        const Tyre &tyre = tyres[i];
        double *w = &out[4 + i * 7];
        w[0] = tyre.surface;
        w[1] = tyre.carcass;
        w[2] = hotPressure(car->wheel[i], tyre, c);
        w[3] = tyre.wear;
        w[4] = tyre.lock;
        w[5] = tyre.spin;
        w[6] = tyre.grip;
    }
}

}

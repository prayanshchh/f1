#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>
#include <emscripten/emscripten.h>

#include "sim.h"
#include "game.h"

namespace
{

enum Mode
{
    MODE_NONE,
    MODE_MEDIUM,
    MODE_HOTLAP,
    MODE_BOOST
};

const double batteryCapacity = 4.0e6;
const double raceHarvestLimit = 8.5e6;
const double sessionHarvestLimit = 7.0e6;
const double overtakeHarvest = 0.5e6;
const double icePeak = 415.0e3;
const double liftHarvest = 250.0e3;
const double brakeHarvest = 350.0e3;
const double brakeShare = 0.55;
const double modeDeploy[4] = {0.0, 150.0e3, 250.0e3, 350.0e3};
const double modeClip[4] = {50.0e3, 50.0e3, 0.0, 0.0};
const double clipSpeed = 270.0;
const double harvestFullSpeed = 80.0;
const double harvestZeroSpeed = 40.0;
const double rampDown = 100.0e3;
const double rampUp = 2000.0e3;
const double startDeploySpeed = 50.0;
const double halfThrottle = 0.5;
const double minAlpha = 1e-3;
const double flowRate = 3000.0e6 / 3600.0;
const double fuelEnergy = 40.0e6;
const double idleFlow = 0.03;
const double mixPower[4] = {0.96, 1.00, 1.02, 1.04};
const double mixBurn[4] = {0.90, 1.00, 1.08, 1.14};
const double maxTorqueScale = 6.0;
const char *const hybridCategory = "22MP1";
const double straightAlpha = 0.97;
const double straightSteer = 0.05;
const double straightSpeed = 130.0;
const double straightOpenRate = 3.0;
const double straightCloseRate = 12.0;
const double straightRear = 0.25;
const double straightFront = 0.6;
const double straightDrag = 0.55;
const double differentialBase = 60.0;

std::vector<tEngineCurveElem> baseCurve;
double iceScale = 1.0;
double baseBrakeLin = 0.0;
tdble baseBrakeCoeff = 0.0;
double baseMass = 0.0;
double baseWing[2];
double straightOpen;
double baseDrag;
double baseDiffSlip;
double differential = differentialBase;
bool straightAssist = true;
bool straightArmed;

double battery = batteryCapacity;
double harvested;
double deployed;
double deployLevel;
double motorPower;
double icePower;
double lapFuelStart;
double lastLapFuel;
double lastLapDeployed;
double lastLapHarvested;
int mode = MODE_MEDIUM;
int startMode = MODE_MEDIUM;
int fuelMix = 1;
int startMix = 1;
int lastLap;
bool raceSession;
bool assist;
bool overtakeAlways;
bool overtakeArmed;
bool overtakeActive;
bool startGuard;
bool hybrid;

double clamp01(double value)
{
    return std::max(0.0, std::min(1.0, value));
}

double standardLimit(double kph)
{
    if (kph <= 290.0)
        return 350.0e3;
    if (kph < 340.0)
        return (1800.0 - 5.0 * kph) * 1e3;
    return std::max(0.0, (6900.0 - 20.0 * kph) * 1e3);
}

double overtakeLimit(double kph)
{
    return std::max(0.0, std::min(350.0e3, (7100.0 - 20.0 * kph) * 1e3));
}

double curveTorque(double rads)
{
    for (const tEngineCurveElem &point : baseCurve)
        if (rads < point.rads)
            return rads * point.a + point.b;
    return 0.0;
}

double harvestLimit()
{
    return (raceSession ? raceHarvestLimit : sessionHarvestLimit) + (overtakeActive ? overtakeHarvest : 0.0);
}

double harvestRoom(double dt)
{
    double room = std::min(batteryCapacity - battery, harvestLimit() - harvested);
    return std::max(0.0, room / std::max(dt, 1e-6));
}

double speedFade(double kph)
{
    return clamp01((kph - harvestZeroSpeed) / (harvestFullSpeed - harvestZeroSpeed));
}

int assistMode()
{
    double share = battery / batteryCapacity;
    if (share > 0.7)
        return MODE_HOTLAP;
    return share > 0.2 ? MODE_MEDIUM : MODE_NONE;
}

void updateDeployLevel(double kph, double dt)
{
    int active = assist ? assistMode() : mode;
    double limit = overtakeActive ? overtakeLimit(kph) : standardLimit(kph);
    double target = std::min(limit, modeDeploy[active]);
    if (active != MODE_BOOST && kph >= clipSpeed)
        target = -modeClip[active];
    if (startGuard)
        target = std::min(target, 0.0);
    if (target > deployLevel)
        deployLevel = std::min(target, deployLevel + rampUp * dt);
    else
        deployLevel = std::max(target, deployLevel - rampDown * dt);
    deployLevel = std::min(deployLevel, limit);
}

struct Split
{
    double net, battery;
};

Split pedalSplit(double alpha, double ice, double kph, double dt)
{
    double room = harvestRoom(dt);
    double fade = speedFade(kph);
    double full = std::min(room, liftHarvest * fade);
    double half = kph >= clipSpeed ? full : full * 0.5;
    if (alpha < halfThrottle)
    {
        double y = alpha / halfThrottle;
        double harvest = full + (half - full) * y;
        return {ice * y - harvest, harvest};
    }
    double x = (alpha - halfThrottle) / (1.0 - halfThrottle);
    double harvest = half * (1.0 - x);
    double level = deployLevel > 0 ? deployLevel * x : std::max(deployLevel, -room) * x;
    if (level > 0)
        level = std::min(level, battery / std::max(dt, 1e-6));
    return {ice - harvest + level, harvest - level};
}

double brakeRegen(tCarElt *elt, double kph, double dt)
{
    double decel = std::max(0.0, -(double)elt->_accel_x);
    double available = baseMass * decel * fabs(elt->_speed_x) * brakeShare;
    return std::min({brakeHarvest * speedFade(kph), available, harvestRoom(dt)});
}

void setTorque(tEngine &engine, double alpha, double torque, double rads)
{
    double base = curveTorque(rads);
    engine.brakeLinCoeff = (tdble)baseBrakeLin;
    engine.brakeCoeff = baseBrakeCoeff;
    double friction = baseBrakeLin * rads;
    if (alpha > minAlpha && base > 1.0)
    {
        double scale = ((torque + friction) / alpha - friction) / base;
        scale = std::max(-maxTorqueScale, std::min(maxTorqueScale, scale));
        for (size_t i = 0; i < baseCurve.size(); i++)
        {
            engine.curve.data[i].a = (tdble)(baseCurve[i].a * scale);
            engine.curve.data[i].b = (tdble)(baseCurve[i].b * scale);
        }
        return;
    }
    engine.brakeLinCoeff = (tdble)std::max(baseBrakeLin, -torque / std::max(rads, 1.0));
}

void updateAero(tCar *car, tCarElt *elt, double alpha, double brake, double kph, double dt)
{
    bool pedals = alpha >= straightAlpha && brake < 0.02;
    if (!straightAssist && !pedals)
        straightArmed = false;
    bool open = pedals && kph >= straightSpeed && (straightAssist ? fabs(elt->_steerCmd) < straightSteer : straightArmed);
    double rate = open ? straightOpenRate : -straightCloseRate;
    straightOpen = clamp01(straightOpen + rate * dt);
    elt->ctrl.wingControlMode = 2;
    car->aero.CdBody = (tdble)(baseDrag * (1.0 - (1.0 - straightDrag) * straightOpen) * sdDamageDrag());
    elt->ctrl.wingFrontCmd = (tdble)(baseWing[0] * (1.0 - (1.0 - straightFront) * straightOpen));
    elt->ctrl.wingRearCmd = (tdble)(baseWing[1] * (1.0 - (1.0 - straightRear) * straightOpen));
}

void burnFuel(tCar *car, double alpha, double dt)
{
    double flow = flowRate / fuelEnergy * mixBurn[fuelMix];
    double burn = flow * (idleFlow + (1.0 - idleFlow) * clamp01(alpha)) * dt;
    car->fuel = (tdble)std::max(0.0, (double)car->fuel - burn);
}

void closeLap(tCarElt *elt)
{
    if (elt->_laps <= lastLap)
    {
        lastLap = elt->_laps;
        return;
    }
    if (lastLap >= 1)
    {
        lastLapFuel = lapFuelStart - elt->_fuel;
        lastLapDeployed = deployed;
        lastLapHarvested = harvested;
    }
    lastLap = elt->_laps;
    lapFuelStart = elt->_fuel;
    harvested = 0;
    deployed = 0;
    overtakeActive = overtakeAlways || overtakeArmed;
    overtakeArmed = false;
}

}

void sdEnergyReset(tCarElt *elt)
{
    hybrid = strcmp(elt->_category, hybridCategory) == 0;
    if (!hybrid)
        return;
    tCar *car = &SimCarTable[elt->index];
    tEngine &engine = car->engine;
    baseCurve.assign(engine.curve.data, engine.curve.data + engine.curve.nbPts);
    baseBrakeLin = engine.brakeLinCoeff;
    baseBrakeCoeff = engine.brakeCoeff;
    baseMass = car->mass;
    baseWing[0] = car->wing[0].angle;
    baseWing[1] = car->wing[1].angle;
    straightOpen = 0;
    baseDrag = car->aero.CdBody;
    baseDiffSlip = car->transmission.differential[TRANS_REAR_DIFF].dSlipMax;
    differential = differentialBase;
    straightArmed = false;
    iceScale = icePeak / std::max(1.0, (double)engine.curve.maxPw);
    engine.fuelcons = 0;
    battery = batteryCapacity;
    harvested = deployed = 0;
    deployLevel = motorPower = icePower = 0;
    lastLapFuel = lastLapDeployed = lastLapHarvested = 0;
    lapFuelStart = elt->_fuel;
    mode = startMode;
    fuelMix = startMix;
    lastLap = elt->_laps;
    overtakeActive = overtakeAlways;
    overtakeArmed = false;
    startGuard = raceSession;
}

void sdEnergyStep(tCarElt *elt, double dt)
{
    if (!hybrid)
        return;
    tCar *car = &SimCarTable[elt->index];
    tEngine &engine = car->engine;
    closeLap(elt);
    double kph = fabs(elt->_speed_x) * 3.6;
    if (kph >= startDeploySpeed)
        startGuard = false;
    updateDeployLevel(kph, dt);
    double alpha = clamp01(car->ctrl->accelCmd);
    double brake = clamp01(car->ctrl->brakeCmd);
    double rads = std::max((double)engine.tickover, (double)engine.rads);
    bool driving = elt->_gear > 0 && (elt->_state & RM_CAR_STATE_NO_SIMU) == 0;
    double ice = curveTorque(rads) * rads * iceScale * mixPower[fuelMix];
    Split split = driving && brake < 0.05 ? pedalSplit(alpha, ice, kph, dt) : Split{alpha * ice, 0.0};
    if (driving && brake >= 0.05)
        split.battery = brakeRegen(elt, kph, dt);
    setTorque(engine, alpha, split.net / rads, rads);
    battery = std::max(0.0, std::min(batteryCapacity, battery + split.battery * dt));
    if (split.battery > 0)
        harvested += split.battery * dt;
    else
        deployed -= split.battery * dt;
    motorPower = -split.battery;
    icePower = alpha * ice;
    updateAero(car, elt, alpha, brake, kph, dt);
    burnFuel(car, alpha, dt);
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdEnergyConfigure(int race, int ersMode, int mix, int ersAssist)
{
    raceSession = race != 0;
    overtakeAlways = !raceSession;
    startMode = std::max(0, std::min(3, ersMode));
    startMix = std::max(0, std::min(3, mix));
    assist = ersAssist != 0;
}

EMSCRIPTEN_KEEPALIVE void sdEnergyMode(int value)
{
    mode = std::max(0, std::min(3, value));
}

EMSCRIPTEN_KEEPALIVE void sdEnergyFuelMix(int value)
{
    fuelMix = std::max(0, std::min(3, value));
}

EMSCRIPTEN_KEEPALIVE void sdEnergyOvertake(int armed)
{
    overtakeArmed = armed != 0;
}

EMSCRIPTEN_KEEPALIVE void sdEnergyBrakeBias(double share)
{
    SimCarTable[0].brkSyst.rep = (tdble)std::max(0.3, std::min(0.8, share));
}

EMSCRIPTEN_KEEPALIVE void sdEnergyDifferential(double percent)
{
    differential = std::max(10.0, std::min(100.0, percent));
    tDifferential &rear = SimCarTable[0].transmission.differential[TRANS_REAR_DIFF];
    rear.dSlipMax = (tdble)std::min(1.0, baseDiffSlip * differential / differentialBase);
}

EMSCRIPTEN_KEEPALIVE void sdEnergyStraight(int assisted, int armed)
{
    straightAssist = assisted != 0;
    straightArmed = armed != 0;
}

EMSCRIPTEN_KEEPALIVE void sdEnergyInfo(double *out)
{
    tCar *car = &SimCarTable[0];
    out[0] = battery;
    out[1] = batteryCapacity;
    out[2] = harvested;
    out[3] = harvestLimit();
    out[4] = deployed;
    out[5] = motorPower;
    out[6] = icePower;
    out[7] = assist ? assistMode() : mode;
    out[8] = fuelMix;
    out[9] = overtakeActive ? 1 : 0;
    out[10] = overtakeArmed ? 1 : 0;
    out[11] = lastLapFuel;
    out[12] = lastLapDeployed;
    out[13] = lastLapHarvested;
    out[14] = car->brkSyst.rep;
    out[15] = deployLevel;
    out[16] = straightOpen;
    out[17] = differential;
    out[18] = straightArmed ? 1 : 0;
}

}

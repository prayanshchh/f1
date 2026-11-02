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
const double coastThrottle = 0.03;
const double minAlpha = 1e-3;
const double flowRate = 3000.0e6 / 3600.0;
const double fuelEnergy = 40.0e6;
const double idleFlow = 0.03;
const double mixPower[4] = {0.96, 1.00, 1.02, 1.04};
const double mixBurn[4] = {0.90, 1.00, 1.08, 1.14};
const double maxTorqueScale = 6.0;
const char *const hybridCategory = "22MP1";
const double straightAlpha = 0.97;
const double straightLift = 0.5;
const double straightSteer = 0.05;
const double straightSpeed = 130.0;
const double straightOpenRate = 3.0;
const double straightCloseRate = 12.0;
const double straightRear = 0.25;
const double straightFront = 0.6;
const double straightDrag = 0.55;
const double differentialBase = 60.0;

struct CarEnergy
{
    std::vector<tEngineCurveElem> baseCurve;
    double iceScale = 1.0;
    double performance = 1.0;
    double baseBrakeLin = 0.0;
    tdble baseBrakeCoeff = 0.0;
    double baseMass = 0.0;
    double baseWing[2] = {0.0, 0.0};
    double straightOpen = 0.0;
    double baseDrag = 0.0;
    double baseDiffSlip = 0.0;
    double differential = differentialBase;
    bool straightAssist = true;
    bool straightArmed = false;
    double battery = batteryCapacity;
    double harvested = 0.0;
    double deployed = 0.0;
    double deployLevel = 0.0;
    double motorPower = 0.0;
    double icePower = 0.0;
    double lapFuelStart = 0.0;
    double lastLapFuel = 0.0;
    double lastLapDeployed = 0.0;
    double lastLapHarvested = 0.0;
    int mode = MODE_MEDIUM;
    int fuelMix = 1;
    int lastLap = 0;
    bool assist = false;
    bool overtakeAlways = false;
    bool overtakeArmed = false;
    bool overtakeActive = false;
    bool startGuard = false;
    bool hybrid = false;
};

std::vector<CarEnergy> field(1);
int startMode = MODE_MEDIUM;
int startMix = 1;
bool playerAssist;
bool raceSession;
bool playerStraightAssist = true;

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

double curveTorque(const CarEnergy &e, double rads)
{
    for (const tEngineCurveElem &point : e.baseCurve)
        if (rads < point.rads)
            return rads * point.a + point.b;
    return 0.0;
}

double harvestLimit(const CarEnergy &e)
{
    return (raceSession ? raceHarvestLimit : sessionHarvestLimit) + (e.overtakeActive ? overtakeHarvest : 0.0);
}

double harvestRoom(const CarEnergy &e, double dt)
{
    double room = std::min(batteryCapacity - e.battery, harvestLimit(e) - e.harvested);
    return std::max(0.0, room / std::max(dt, 1e-6));
}

double speedFade(double kph)
{
    return clamp01((kph - harvestZeroSpeed) / (harvestFullSpeed - harvestZeroSpeed));
}

int assistMode(const CarEnergy &e)
{
    double share = e.battery / batteryCapacity;
    if (share > 0.7)
        return MODE_HOTLAP;
    return share > 0.2 ? MODE_MEDIUM : MODE_NONE;
}

void updateDeployLevel(CarEnergy &e, double kph, double dt)
{
    int active = e.assist ? assistMode(e) : e.mode;
    double limit = e.overtakeActive ? overtakeLimit(kph) : standardLimit(kph);
    double target = std::min(limit, modeDeploy[active]);
    if (active != MODE_BOOST && kph >= clipSpeed)
        target = -modeClip[active];
    if (e.startGuard)
        target = std::min(target, 0.0);
    if (target > e.deployLevel)
        e.deployLevel = std::min(target, e.deployLevel + rampUp * dt);
    else
        e.deployLevel = std::max(target, e.deployLevel - rampDown * dt);
    e.deployLevel = std::min(e.deployLevel, limit);
}

struct Split
{
    double net, battery;
};

Split pedalSplit(const CarEnergy &e, double alpha, double ice, double kph, double dt)
{
    double room = harvestRoom(e, dt);
    double fade = speedFade(kph);
    double full = std::min(room, liftHarvest * fade);
    double half = kph >= clipSpeed ? full : full * 0.5;
    if (alpha < halfThrottle)
    {
        double reach = std::max(0.0, ice - half);
        double request = reach * alpha / halfThrottle;
        double harvest = std::min(half, ice - request);
        if (alpha < coastThrottle)
        {
            double y = alpha / coastThrottle;
            double coastRequest = reach * coastThrottle / halfThrottle;
            return {-full + (coastRequest + full) * y, full + (harvest - full) * y};
        }
        return {request, harvest};
    }
    double x = (alpha - halfThrottle) / (1.0 - halfThrottle);
    double harvest = half * (1.0 - x);
    double level = e.deployLevel > 0 ? e.deployLevel * x : std::max(e.deployLevel, -room) * x;
    if (level > 0)
        level = std::min(level, e.battery / std::max(dt, 1e-6));
    return {ice - harvest + level, harvest - level};
}

double brakeRegen(const CarEnergy &e, tCarElt *elt, double kph, double dt)
{
    double decel = std::max(0.0, -(double)elt->_accel_x);
    double available = e.baseMass * decel * fabs(elt->_speed_x) * brakeShare;
    return std::min({brakeHarvest * speedFade(kph), available, harvestRoom(e, dt)});
}

void setTorque(const CarEnergy &e, tEngine &engine, double alpha, double torque, double rads)
{
    double base = curveTorque(e, rads);
    engine.brakeLinCoeff = (tdble)e.baseBrakeLin;
    engine.brakeCoeff = e.baseBrakeCoeff;
    double friction = e.baseBrakeLin * rads;
    if (alpha > minAlpha && base > 1.0)
    {
        double scale = ((torque + friction) / alpha - friction) / base;
        scale = std::max(-maxTorqueScale, std::min(maxTorqueScale, scale));
        for (size_t i = 0; i < e.baseCurve.size(); i++)
        {
            engine.curve.data[i].a = (tdble)(e.baseCurve[i].a * scale);
            engine.curve.data[i].b = (tdble)(e.baseCurve[i].b * scale);
        }
        return;
    }
    engine.brakeLinCoeff = (tdble)std::max(e.baseBrakeLin, -torque / std::max(rads, 1.0));
}

void updateAero(CarEnergy &e, tCar *car, tCarElt *elt, double alpha, double brake, double kph, double dt)
{
    bool pedals = alpha >= straightAlpha && brake < 0.02;
    if (!e.straightAssist && (alpha < straightLift || brake >= 0.02))
        e.straightArmed = false;
    bool open = pedals && sdDamageStraightAllowed(elt->index) && kph >= straightSpeed && (e.straightAssist ? fabs(elt->_steerCmd) < straightSteer : e.straightArmed);
    double rate = open ? straightOpenRate : -straightCloseRate;
    e.straightOpen = clamp01(e.straightOpen + rate * dt);
    elt->ctrl.wingControlMode = 2;
    car->aero.CdBody = (tdble)(e.baseDrag * (1.0 - (1.0 - straightDrag) * e.straightOpen) * sdDamageDrag(elt->index));
    elt->ctrl.wingFrontCmd = (tdble)(e.baseWing[0] * (1.0 - (1.0 - straightFront) * e.straightOpen));
    elt->ctrl.wingRearCmd = (tdble)(e.baseWing[1] * (1.0 - (1.0 - straightRear) * e.straightOpen));
}

void burnFuel(const CarEnergy &e, tCar *car, double alpha, double dt)
{
    double flow = flowRate / fuelEnergy * mixBurn[e.fuelMix];
    double burn = flow * (idleFlow + (1.0 - idleFlow) * clamp01(alpha)) * dt;
    car->fuel = (tdble)std::max(0.0, (double)car->fuel - burn);
}

void closeLap(CarEnergy &e, tCarElt *elt)
{
    if (elt->_laps <= e.lastLap)
    {
        e.lastLap = elt->_laps;
        return;
    }
    if (e.lastLap >= 1)
    {
        e.lastLapFuel = e.lapFuelStart - elt->_fuel;
        e.lastLapDeployed = e.deployed;
        e.lastLapHarvested = e.harvested;
    }
    e.lastLap = elt->_laps;
    e.lapFuelStart = elt->_fuel;
    e.harvested = 0;
    e.deployed = 0;
    e.overtakeActive = e.overtakeAlways || e.overtakeArmed;
    e.overtakeArmed = false;
}

}

void sdEnergyReset(tCarElt *elt)
{
    if ((int)field.size() <= elt->index)
        field.resize(elt->index + 1);
    CarEnergy &e = field[elt->index];
    e.hybrid = strcmp(elt->_category, hybridCategory) == 0;
    if (!e.hybrid)
        return;
    tCar *car = &SimCarTable[elt->index];
    tEngine &engine = car->engine;
    bool player = elt->index == 0;
    e.baseCurve.assign(engine.curve.data, engine.curve.data + engine.curve.nbPts);
    e.baseBrakeLin = engine.brakeLinCoeff;
    e.baseBrakeCoeff = engine.brakeCoeff;
    e.baseMass = car->mass;
    e.baseWing[0] = car->wing[0].angle;
    e.baseWing[1] = car->wing[1].angle;
    e.straightOpen = 0;
    e.baseDrag = car->aero.CdBody;
    e.baseDiffSlip = car->transmission.differential[TRANS_REAR_DIFF].dSlipMax;
    e.differential = differentialBase;
    e.straightAssist = player ? playerStraightAssist : true;
    e.straightArmed = false;
    e.iceScale = icePeak / std::max(1.0, (double)engine.curve.maxPw);
    engine.fuelcons = 0;
    e.battery = batteryCapacity;
    e.harvested = e.deployed = 0;
    e.deployLevel = e.motorPower = e.icePower = 0;
    e.lastLapFuel = e.lastLapDeployed = e.lastLapHarvested = 0;
    e.lapFuelStart = elt->_fuel;
    e.mode = startMode;
    e.fuelMix = startMix;
    e.assist = player ? playerAssist : true;
    e.lastLap = elt->_laps;
    e.overtakeAlways = !raceSession;
    e.overtakeActive = e.overtakeAlways;
    e.overtakeArmed = false;
    e.startGuard = raceSession;
}

void sdEnergyRestore(int index)
{
    CarEnergy &e = field[index];
    e.battery = batteryCapacity;
    e.harvested = e.deployed = 0;
    e.deployLevel = 0;
}

void sdEnergySetPerformance(int index, double factor)
{
    field[index].performance = factor;
}

void sdEnergySetMode(int index, int value)
{
    CarEnergy &e = field[index];
    e.assist = false;
    e.mode = value;
}

double sdEnergyBatteryShare(int index)
{
    return field[index].battery / batteryCapacity;
}

void sdEnergyArmOvertake(int index)
{
    field[index].overtakeArmed = true;
}

bool sdEnergyOvertakeActive(int index)
{
    return field[index].overtakeActive;
}

double sdEnergyLastLapFuel(int index)
{
    return field[index].lastLapFuel;
}

void sdEnergyStep(tCarElt *elt, double dt)
{
    CarEnergy &e = field[elt->index];
    if (!e.hybrid)
        return;
    tCar *car = &SimCarTable[elt->index];
    tEngine &engine = car->engine;
    closeLap(e, elt);
    double kph = fabs(elt->_speed_x) * 3.6;
    if (kph >= startDeploySpeed)
        e.startGuard = false;
    updateDeployLevel(e, kph, dt);
    double alpha = clamp01(car->ctrl->accelCmd);
    double brake = clamp01(car->ctrl->brakeCmd);
    double rads = std::max((double)engine.tickover, (double)engine.rads);
    bool driving = elt->_gear > 0 && (elt->_state & RM_CAR_STATE_NO_SIMU) == 0;
    double ice = curveTorque(e, rads) * rads * e.iceScale * e.performance * mixPower[e.fuelMix] * sdDamagePower(elt->index);
    Split split = driving && brake < 0.05 ? pedalSplit(e, alpha, ice, kph, dt) : Split{alpha * ice, 0.0};
    if (driving && brake >= 0.05)
        split.battery = brakeRegen(e, elt, kph, dt);
    setTorque(e, engine, alpha, split.net / rads, rads);
    e.battery = std::max(0.0, std::min(batteryCapacity, e.battery + split.battery * dt));
    if (split.battery > 0)
        e.harvested += split.battery * dt;
    else
        e.deployed -= split.battery * dt;
    e.motorPower = -split.battery;
    e.icePower = alpha * ice;
    updateAero(e, car, elt, alpha, brake, kph, dt);
    burnFuel(e, car, alpha, dt);
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdEnergyConfigure(int race, int ersMode, int mix, int ersAssist)
{
    raceSession = race != 0;
    startMode = std::max(0, std::min(3, ersMode));
    startMix = std::max(0, std::min(3, mix));
    playerAssist = ersAssist != 0;
}

EMSCRIPTEN_KEEPALIVE void sdEnergyMode(int value)
{
    field[0].mode = std::max(0, std::min(3, value));
}

EMSCRIPTEN_KEEPALIVE void sdEnergyFuelMix(int value)
{
    field[0].fuelMix = std::max(0, std::min(3, value));
}

EMSCRIPTEN_KEEPALIVE void sdEnergyOvertake(int armed)
{
    field[0].overtakeArmed = armed != 0;
}

EMSCRIPTEN_KEEPALIVE void sdEnergyBrakeBias(double share)
{
    SimCarTable[0].brkSyst.rep = (tdble)std::max(0.3, std::min(0.8, share));
}

EMSCRIPTEN_KEEPALIVE void sdEnergyDifferential(double percent)
{
    CarEnergy &e = field[0];
    e.differential = std::max(10.0, std::min(100.0, percent));
    tDifferential &rear = SimCarTable[0].transmission.differential[TRANS_REAR_DIFF];
    rear.dSlipMax = (tdble)std::min(1.0, e.baseDiffSlip * e.differential / differentialBase);
}

EMSCRIPTEN_KEEPALIVE void sdEnergyStraight(int assisted, int armed)
{
    playerStraightAssist = assisted != 0;
    field[0].straightAssist = playerStraightAssist;
    field[0].straightArmed = armed != 0;
}

EMSCRIPTEN_KEEPALIVE void sdEnergyInfo(double *out)
{
    const CarEnergy &e = field[0];
    tCar *car = &SimCarTable[0];
    out[0] = e.battery;
    out[1] = batteryCapacity;
    out[2] = e.harvested;
    out[3] = harvestLimit(e);
    out[4] = e.deployed;
    out[5] = e.motorPower;
    out[6] = e.icePower;
    out[7] = e.assist ? assistMode(e) : e.mode;
    out[8] = e.fuelMix;
    out[9] = e.overtakeActive ? 1 : 0;
    out[10] = e.overtakeArmed ? 1 : 0;
    out[11] = e.lastLapFuel;
    out[12] = e.lastLapDeployed;
    out[13] = e.lastLapHarvested;
    out[14] = car->brkSyst.rep;
    out[15] = e.deployLevel;
    out[16] = e.straightOpen;
    out[17] = e.differential;
    out[18] = e.straightArmed ? 1 : 0;
}

}

#include <algorithm>
#include <cmath>
#include <emscripten/emscripten.h>

#include "sim.h"
#include "game.h"

namespace
{

enum Part
{
    WING_LEFT,
    WING_RIGHT,
    SIDEPOD_LEFT,
    SIDEPOD_RIGHT,
    FLOOR,
    DIFFUSER,
    REAR_WING,
    PART_COUNT
};

struct WingLift
{
    double kz, kz1, kz2, kz3;
};

const double partFull = 900.0;
const double impactShare = 0.7;
const double sidepodShare = 0.3;
const double rearDiffuserShare = 0.35;
const double wingLiftLoss = 0.55;
const double floorLiftLoss = 0.40;
const double diffuserLiftLoss = 0.25;
const double sidepodDragGain = 0.12;
const double kelvin = 273.15;
const double brakeStart = 150.0;
const double brakeCapacity = 1000.0;
const double brakeStill = 0.010;
const double brakeSpeed = 0.0008;
const double engineStart = 110.0;
const double engineHeat = 6.3;
const double engineIdle = 0.15;
const double engineCool = 0.042;
const double engineCoolBase = 0.25;
const double engineCoolSpeed = 80.0;

double parts[PART_COUNT];
WingLift baseWing[2];
double baseLift[2];
double brakes[4];
double engineTemp;
int lastDamage;

void addBarrierHit(tCar *car, double amount)
{
    double dx = car->collpos.x - car->DynGCg.pos.x;
    double dy = car->collpos.y - car->DynGCg.pos.y;
    double forward = dx * cos(car->DynGCg.pos.az) + dy * sin(car->DynGCg.pos.az);
    double left = -dx * sin(car->DynGCg.pos.az) + dy * cos(car->DynGCg.pos.az);
    parts[left > 0 ? SIDEPOD_LEFT : SIDEPOD_RIGHT] += amount * sidepodShare;
    if (forward > 0)
    {
        parts[left > 0 ? WING_LEFT : WING_RIGHT] += amount * impactShare;
        return;
    }
    parts[REAR_WING] += amount * impactShare;
    parts[DIFFUSER] += amount * rearDiffuserShare;
}

double share(int part)
{
    return std::min(1.0, parts[part] / partFull);
}

void scaleWing(tWing &wing, const WingLift &base, double factor)
{
    wing.Kz = (tdble)(base.kz * factor);
    wing.Kz1 = (tdble)(base.kz1 * factor);
    wing.Kz2 = (tdble)(base.kz2 * factor);
    wing.Kz3 = (tdble)(base.kz3 * factor);
}

void applyDamage(tCar *car)
{
    double front = (share(WING_LEFT) + share(WING_RIGHT)) / 2.0;
    double floorLoss = floorLiftLoss * share(FLOOR);
    scaleWing(car->wing[0], baseWing[0], 1.0 - wingLiftLoss * front);
    scaleWing(car->wing[1], baseWing[1], 1.0 - wingLiftLoss * share(REAR_WING));
    car->aero.Clift[0] = (tdble)(baseLift[0] * (1.0 - floorLoss));
    car->aero.Clift[1] = (tdble)(baseLift[1] * (1.0 - floorLoss - diffuserLiftLoss * share(DIFFUSER)));
}

void updateBrakes(tCar *car, double dt)
{
    double air = Tair - kelvin;
    for (int i = 0; i < 4; i++)
    {
        const tWheel &wheel = car->wheel[i];
        double speed = fabs(wheel.spinVel * wheel.radius);
        double power = wheel.brake.Tq * fabs(wheel.spinVel);
        double cooling = (brakeStill + brakeSpeed * speed) * (brakes[i] - air);
        brakes[i] += (power / brakeCapacity - cooling) * dt;
    }
}

void updateEngine(tCar *car, double dt)
{
    double load = engineIdle + (1.0 - engineIdle) * std::max(0.0, std::min(1.0, (double)car->ctrl->accelCmd));
    double airflow = engineCoolBase + fabs(car->DynGC.vel.x) / engineCoolSpeed;
    engineTemp += (engineHeat * load - engineCool * airflow * (engineTemp - (Tair - kelvin))) * dt;
}

}

double sdDamageDrag()
{
    return 1.0 + sidepodDragGain * (share(SIDEPOD_LEFT) + share(SIDEPOD_RIGHT));
}

void sdCarStatusReset(tCarElt *elt)
{
    tCar *car = &SimCarTable[elt->index];
    std::fill(parts, parts + PART_COUNT, 0.0);
    lastDamage = car->dammage;
    for (int i = 0; i < 2; i++)
    {
        baseWing[i] = {car->wing[i].Kz, car->wing[i].Kz1, car->wing[i].Kz2, car->wing[i].Kz3};
        baseLift[i] = car->aero.Clift[i];
    }
    for (double &brake : brakes)
        brake = brakeStart;
    engineTemp = engineStart;
}

void sdCarStatusStep(tCarElt *elt, double dt)
{
    tCar *car = &SimCarTable[elt->index];
    int delta = car->dammage - lastDamage;
    lastDamage = car->dammage;
    if (delta > 0)
    {
        if (car->collision & SEM_COLLISION_XYSCENE)
            addBarrierHit(car, delta);
        else
            parts[FLOOR] += delta;
    }
    applyDamage(car);
    updateBrakes(car, dt);
    updateEngine(car, dt);
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdCarStatus(double *out)
{
    out[0] = engineTemp;
    for (int i = 0; i < PART_COUNT; i++)
        out[1 + i] = share(i);
    for (int i = 0; i < 4; i++)
        out[1 + PART_COUNT + i] = brakes[i];
}

EMSCRIPTEN_KEEPALIVE void sdCarDamageSet(int part, double value)
{
    if (part >= 0 && part < PART_COUNT)
        parts[part] = std::max(0.0, std::min(1.0, value)) * partFull;
}

}

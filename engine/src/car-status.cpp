#include <algorithm>
#include <cmath>
#include <vector>
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

struct CarStatus
{
    double parts[PART_COUNT];
    WingLift baseWing[2];
    double baseLift[2];
    double brakes[4];
    double engineTemp;
    int lastDamage;
};

std::vector<CarStatus> field(1);

void addBarrierHit(CarStatus &state, tCar *car, double amount)
{
    double *parts = state.parts;
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

double share(const CarStatus &state, int part)
{
    return std::min(1.0, state.parts[part] / partFull);
}

void scaleWing(tWing &wing, const WingLift &base, double factor)
{
    wing.Kz = (tdble)(base.kz * factor);
    wing.Kz1 = (tdble)(base.kz1 * factor);
    wing.Kz2 = (tdble)(base.kz2 * factor);
    wing.Kz3 = (tdble)(base.kz3 * factor);
}

void applyDamage(const CarStatus &state, tCar *car)
{
    double front = (share(state, WING_LEFT) + share(state, WING_RIGHT)) / 2.0;
    double floorLoss = floorLiftLoss * share(state, FLOOR);
    scaleWing(car->wing[0], state.baseWing[0], 1.0 - wingLiftLoss * front);
    scaleWing(car->wing[1], state.baseWing[1], 1.0 - wingLiftLoss * share(state, REAR_WING));
    car->aero.Clift[0] = (tdble)(state.baseLift[0] * (1.0 - floorLoss));
    car->aero.Clift[1] = (tdble)(state.baseLift[1] * (1.0 - floorLoss - diffuserLiftLoss * share(state, DIFFUSER)));
}

void updateBrakes(CarStatus &state, tCar *car, double dt)
{
    double *brakes = state.brakes;
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

void updateEngine(CarStatus &state, tCar *car, double dt)
{
    double load = engineIdle + (1.0 - engineIdle) * std::max(0.0, std::min(1.0, (double)car->ctrl->accelCmd));
    double airflow = engineCoolBase + fabs(car->DynGC.vel.x) / engineCoolSpeed;
    state.engineTemp += (engineHeat * load - engineCool * airflow * (state.engineTemp - (Tair - kelvin))) * dt;
}

}

double sdDamageDrag(int index)
{
    const CarStatus &state = field[index];
    return 1.0 + sidepodDragGain * (share(state, SIDEPOD_LEFT) + share(state, SIDEPOD_RIGHT));
}

double sdCarDamageShare(int index)
{
    const CarStatus &state = field[index];
    double worst = 0;
    for (int i = 0; i < PART_COUNT; i++)
        worst = std::max(worst, share(state, i));
    return worst;
}

void sdCarStatusReset(tCarElt *elt)
{
    if ((int)field.size() <= elt->index)
        field.resize(elt->index + 1);
    CarStatus &state = field[elt->index];
    tCar *car = &SimCarTable[elt->index];
    std::fill(state.parts, state.parts + PART_COUNT, 0.0);
    state.lastDamage = car->dammage;
    for (int i = 0; i < 2; i++)
    {
        state.baseWing[i] = {car->wing[i].Kz, car->wing[i].Kz1, car->wing[i].Kz2, car->wing[i].Kz3};
        state.baseLift[i] = car->aero.Clift[i];
    }
    for (double &brake : state.brakes)
        brake = brakeStart;
    state.engineTemp = engineStart;
}

void sdCarStatusRepair(int index)
{
    CarStatus &state = field[index];
    std::fill(state.parts, state.parts + PART_COUNT, 0.0);
}

void sdCarStatusStep(tCarElt *elt, double dt)
{
    CarStatus &state = field[elt->index];
    tCar *car = &SimCarTable[elt->index];
    int delta = car->dammage - state.lastDamage;
    state.lastDamage = car->dammage;
    if (delta > 0)
    {
        if (car->collision & SEM_COLLISION_XYSCENE)
            addBarrierHit(state, car, delta);
        else
            state.parts[FLOOR] += delta;
    }
    applyDamage(state, car);
    updateBrakes(state, car, dt);
    updateEngine(state, car, dt);
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdCarStatus(double *out)
{
    const CarStatus &state = field[0];
    out[0] = state.engineTemp;
    for (int i = 0; i < PART_COUNT; i++)
        out[1 + i] = share(state, i);
    for (int i = 0; i < 4; i++)
        out[1 + PART_COUNT + i] = state.brakes[i];
}

EMSCRIPTEN_KEEPALIVE void sdCarDamageSet(int part, double value)
{
    if (part >= 0 && part < PART_COUNT)
        field[0].parts[part] = std::max(0.0, std::min(1.0, value)) * partFull;
}

}

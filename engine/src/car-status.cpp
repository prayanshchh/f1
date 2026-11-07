#include <algorithm>
#include <cmath>
#include <vector>
#include <emscripten/emscripten.h>

#include "sim.h"
#include "game.h"
#include "car-damage.h"

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
    SUSPENSION,
    PART_COUNT = SUSPENSION + 4
};

enum Retirement
{
    RUNNING,
    RETIRED_ACCIDENT,
    RETIRED_SUSPENSION,
    RETIRED_ENGINE,
    RETIRED_FUEL
};

struct WingLift
{
    double kz, kz1, kz2, kz3;
};

struct Ramp
{
    double from, span;
};

struct Share
{
    double frontal, rear, lateral;
};

const Ramp wingRamp = {2.5, 21.5};
const Ramp sidepodRamp = {5.0, 30.0};
const Ramp floorRamp = {10.0, 45.0};
const Ramp diffuserRamp = {5.0, 27.0};
const Ramp rearWingRamp = {4.0, 24.0};
const Ramp suspensionRamp = {9.0, 31.0};
const Ramp tyreRamp = {5.0, 13.0};
const Ramp crushRamp = {15.0, 20.0};
const double detachImpact = 44.0;
const double fullRoll = 6.283185307179586;
const double sideLift = 0.5;
const double invertedLift = 0.4;
const double rollPitch = 0.6;
const double hopRoll = 0.55;
const double hopPitch = 0.3;
const double tumbleLongest = 4.0;
const double tumbleSettle = 0.15;
const double hopUp = 2.0;
const double hopUpGain = 0.1;
const double hopUpMost = 4.0;
const double rollEnergy = 20.0;
const double rollUp = 6.5;
const double rollUpGain = 0.05;
const double rollUpMost = 7.5;
const double launchClosing = 18.0;
const double wheelLaunchGain = 2.0;
const double wheelTouchAcross = 0.5;
const double wheelTouchBehind = 2.6;
const double wheelTouchAhead = 0.3;
const double pairReach = 6.0;
const double wallLaunchImpact = 25.0;
const double wallLaunchSpeed = 45.0;
const double wallLaunchShare = 0.55;
const double groundRollSpeed = 20.0;
const double rollSlack = 0.05;
const double groundRollHop = 2.5;
const double groundRollPace = 18.0;
const double groundRollShortest = 0.9;
const double groundRollLongest = 1.6;
const double landingSideImpact = 46.0;
const double landingTailImpact = 30.0;
const double settleTilt = 0.1;
const double settleDone = 0.02;
const double settleTime = 0.25;
const double tumbleLevelTime = 0.15;
const double settleReach = 2.5;
const double bodyFriction = 0.7;
const double detachShare = 0.5;
const double lostWheel = 2.0;
const double rampPower = 1.3;
const double impactFloor = 0.4;
const double contactGap = 0.2;
const double destroyedImpact = 65.0;
const double wreckedCar = 3.0;
const double wheelZone = 0.6;
const double otherWingShare = 0.6;
const double sideWingShare = 0.7;
const double frontalTyreShare = 0.4;
const double rearTyreShare = 0.3;
const double frontalSuspensionShare = 0.5;
const double glancingPodShare = 0.4;
const double endFloorShare = 0.6;
const double midFloorShare = 0.8;
const double midTyreShare = 0.6;
const double rearLateralWingShare = 0.5;
const double rearLateralDiffuserShare = 0.3;
const double verticalCrashCut = 0.1;
const double partFull = 900.0;
const double frontWingFrontLoss = 0.61;
const double rearWingRearLoss = 0.34;
const double floorFrontLoss = 0.38;
const double floorRearLoss = 0.33;
const double diffuserRearLoss = 0.25;
const double sidepodAxleLoss = 0.06;
const double minimumLift = 0.05;
const double wingDrag = 0.06;
const double sidepodDrag = 0.08;
const double floorDrag = 0.06;
const double rearWingDragDrop = 0.10;
const double wingYawDrag = 0.18;
const double sidepodYawDrag = 0.12;
const double yawArm = 0.7;
const double bentToeFront = 0.035;
const double bentToeRear = 0.02;
const double wingGripSkew = 0.6;
const double bentCamber = 0.04;
const double bentGripLoss = 0.25;
const double wheelGripLow = 0.6;
const double wheelGripHigh = 1.3;
const double wheelLoadFloor = 200.0;
const double straightWingLimit = 0.5;
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
const double sidepodCoolingLoss = 0.12;
const double derateFrom = 140.0;
const double derateSpan = 30.0;
const double derateMax = 0.40;
const double engineFailure = 180.0;
const double fuelReserve = 0.001;
const double retiredBrake = 0.5;
const double stoppedSpeed = 1.0;
const double stopTimeout = 12.0;

struct CarStatus
{
    double parts[PART_COUNT];
    double detached[4];
    double wheelBlow[4];
    WingLift baseWing[2];
    double baseLift[2];
    double baseToe[4];
    double baseCamber[4];
    double brakes[4];
    double engineTemp;
    int lastDamage;
    double previousVelX, previousVelY;
    double contactTotal;
    double contactQuiet;
    double contactSpeed;
    double wallLateral;
    int retirement;
    double retiredFor;
    bool stopped;
    bool brokenDown;
    double roll, rollStart, rollEnd, rollPeak, pitch, tumbleAge, flight, landedSide;
    bool tumbling, rolling, onGround, settling, landing;
};

std::vector<CarStatus> field(1);

double clamp01(double value)
{
    return std::max(0.0, std::min(1.0, value));
}

double rampAt(const Ramp &ramp, double impact)
{
    return pow(clamp01((impact - ramp.from) / ramp.span), rampPower);
}

double share(const CarStatus &state, int part)
{
    return std::min(1.0, state.parts[part]);
}

void retire(CarStatus &state, int reason)
{
    if (state.retirement == RUNNING)
        state.retirement = reason;
}

void hurt(CarStatus &state, int part, const Ramp &ramp, double before, double after, double amount)
{
    state.parts[part] = std::min(1.0, state.parts[part] + (rampAt(ramp, after) - rampAt(ramp, before)) * amount);
}

int cornerWheel(bool front, bool left)
{
    return (front ? FRNT_RGT : REAR_RGT) + (left ? 1 : 0);
}

void hitWheel(CarStatus &state, int index, int wheel, double before, double after, double tyreAmount, double suspensionAmount)
{
    sdTyreContact(index, wheel, (rampAt(tyreRamp, after) - rampAt(tyreRamp, before)) * tyreAmount);
    sdTyreCrush(index, wheel, (rampAt(crushRamp, after) - rampAt(crushRamp, before)) * tyreAmount);
    hurt(state, SUSPENSION + wheel, suspensionRamp, before, after, suspensionAmount);
    if (state.landing)
        return;
    state.wheelBlow[wheel] += (after - before) * suspensionAmount;
    if (state.wheelBlow[wheel] < detachImpact || suspensionAmount < detachShare || state.detached[wheel] > 0)
        return;
    state.detached[wheel] = 1.0;
    state.parts[SUSPENSION + wheel] = 1.0;
    sdTyreDetach(index, wheel);
}

void hitNose(CarStatus &state, int index, bool left, const Share &s, double before, double after)
{
    int near = left ? WING_LEFT : WING_RIGHT;
    int far = left ? WING_RIGHT : WING_LEFT;
    hurt(state, near, wingRamp, before, after, s.frontal + sideWingShare * s.lateral);
    hurt(state, far, wingRamp, before, after, otherWingShare * s.frontal);
    hitWheel(state, index, cornerWheel(true, left), before, after, s.lateral + frontalTyreShare * s.frontal, s.lateral + frontalSuspensionShare * s.frontal);
    hurt(state, left ? SIDEPOD_LEFT : SIDEPOD_RIGHT, sidepodRamp, before, after, glancingPodShare * s.lateral);
    hurt(state, FLOOR, floorRamp, before, after, endFloorShare);
}

void hitTail(CarStatus &state, int index, bool left, const Share &s, double before, double after)
{
    hurt(state, REAR_WING, rearWingRamp, before, after, s.rear + rearLateralWingShare * s.lateral);
    hurt(state, DIFFUSER, diffuserRamp, before, after, s.rear + rearLateralDiffuserShare * s.lateral);
    hitWheel(state, index, cornerWheel(false, left), before, after, s.lateral + rearTyreShare * s.rear, s.lateral + frontalSuspensionShare * s.rear);
    hurt(state, left ? SIDEPOD_LEFT : SIDEPOD_RIGHT, sidepodRamp, before, after, glancingPodShare * s.lateral);
    hurt(state, FLOOR, floorRamp, before, after, endFloorShare);
}

void hitFlank(CarStatus &state, int index, bool front, bool left, const Share &s, double before, double after)
{
    hurt(state, left ? SIDEPOD_LEFT : SIDEPOD_RIGHT, sidepodRamp, before, after, s.lateral);
    hurt(state, FLOOR, floorRamp, before, after, midFloorShare);
    hitWheel(state, index, cornerWheel(front, left), before, after, midTyreShare * s.lateral, midTyreShare * s.lateral);
}

void addImpact(CarStatus &state, int index, double forward, double left, double dvForward, double dvLeft)
{
    double size = hypot(dvForward, dvLeft);
    if (size <= 0.0)
        return;
    double before = state.contactTotal;
    state.contactTotal += size;
    state.contactQuiet = 0.0;
    Share s = {std::max(0.0, -dvForward) / size, std::max(0.0, dvForward) / size, fabs(dvLeft) / size};
    bool onLeft = left > 0.0;
    if (forward > wheelZone)
        hitNose(state, index, onLeft, s, before, state.contactTotal);
    else if (forward < -wheelZone)
        hitTail(state, index, onLeft, s, before, state.contactTotal);
    else
        hitFlank(state, index, forward >= 0.0, onLeft, s, before, state.contactTotal);
    if (state.contactTotal >= destroyedImpact)
        retire(state, RETIRED_ACCIDENT);
}

void launch(CarStatus &state, tCar *car, double side, double energy)
{
    if (state.tumbling)
        return;
    bool rolling = energy >= rollEnergy;
    double up = rolling ? std::min(rollUpMost, rollUp + rollUpGain * (energy - rollEnergy)) : std::min(hopUpMost, hopUp + hopUpGain * energy);
    car->DynGCg.vel.z = (tdble)std::max((double)car->DynGCg.vel.z, up);
    state.tumbling = true;
    state.rolling = rolling;
    state.onGround = false;
    state.tumbleAge = 0.0;
    state.flight = 2.0 * up / G;
    state.roll = 0.0;
    state.rollStart = 0.0;
    state.rollEnd = state.rolling ? side * fullRoll : 0.0;
    state.rollPeak = state.rolling ? 0.0 : side * hopRoll * up / hopUpMost;
    state.pitch = state.rolling ? rollPitch : hopPitch * up / hopUpMost;
    state.landedSide = side;
}

void detectImpact(CarStatus &state, int index, tCar *car, double dt, bool counted)
{
    double speedBefore = hypot(state.previousVelX, state.previousVelY);
    double dvx = car->DynGCg.vel.x - state.previousVelX;
    double dvy = car->DynGCg.vel.y - state.previousVelY;
    state.previousVelX = car->DynGCg.vel.x;
    state.previousVelY = car->DynGCg.vel.y;
    state.contactQuiet += dt;
    if (state.contactQuiet > contactGap)
    {
        state.contactTotal = 0.0;
        state.wallLateral = 0.0;
        std::fill(state.wheelBlow, state.wheelBlow + 4, 0.0);
    }
    if (!counted || hypot(dvx, dvy) < impactFloor)
        return;
    double c = cos(car->DynGCg.pos.az);
    double s = sin(car->DynGCg.pos.az);
    double dvForward = dvx * c + dvy * s;
    double dvLeft = -dvx * s + dvy * c;
    double size = hypot(dvForward, dvLeft);
    double forward = -dvForward / size * car->dimension.x / 2.0;
    double left = -dvLeft / size * car->dimension.y / 2.0;
    if (state.contactTotal <= 0.0)
        state.contactSpeed = speedBefore;
    bool wall = (car->collision & SEM_COLLISION_XYSCENE) != 0;
    if (wall)
    {
        double dx = car->collpos.x - car->DynGCg.pos.x;
        double dy = car->collpos.y - car->DynGCg.pos.y;
        forward = dx * c + dy * s;
        left = -dx * s + dy * c;
        state.wallLateral += fabs(dvLeft);
    }
    addImpact(state, index, forward, left, dvForward, dvLeft);
    if (wall && state.contactTotal >= wallLaunchImpact && state.contactSpeed >= wallLaunchSpeed && state.wallLateral >= wallLaunchShare * state.contactTotal)
        launch(state, car, left > 0.0 ? 1.0 : -1.0, state.wallLateral);
}

void scaleWing(tWing &wing, const WingLift &base, double factor)
{
    wing.Kz = (tdble)(base.kz * factor);
    wing.Kz1 = (tdble)(base.kz1 * factor);
    wing.Kz2 = (tdble)(base.kz2 * factor);
    wing.Kz3 = (tdble)(base.kz3 * factor);
}

double frontLift(const CarStatus &state, int index)
{
    double wings = (share(state, WING_LEFT) + share(state, WING_RIGHT)) / 2.0;
    double pods = (share(state, SIDEPOD_LEFT) + share(state, SIDEPOD_RIGHT)) / 2.0;
    return std::max(minimumLift, sdTyresFrontLift(index) - frontWingFrontLoss * wings - floorFrontLoss * share(state, FLOOR) - sidepodAxleLoss * pods);
}

double rearLift(const CarStatus &state, int index)
{
    double pods = (share(state, SIDEPOD_LEFT) + share(state, SIDEPOD_RIGHT)) / 2.0;
    return std::max(minimumLift, sdTyresRearLift(index) - rearWingRearLoss * share(state, REAR_WING) - floorRearLoss * share(state, FLOOR) - diffuserRearLoss * share(state, DIFFUSER) - sidepodAxleLoss * pods);
}

void applyAero(const CarStatus &state, int index, tCar *car)
{
    double front = frontLift(state, index);
    double rear = rearLift(state, index);
    scaleWing(car->wing[0], state.baseWing[0], front);
    scaleWing(car->wing[1], state.baseWing[1], rear);
    car->aero.Clift[0] = (tdble)(state.baseLift[0] * front);
    car->aero.Clift[1] = (tdble)(state.baseLift[1] * rear);
}

double wreckage(const CarStatus &state)
{
    double wings = (share(state, WING_LEFT) + share(state, WING_RIGHT)) / 2.0;
    double pods = (share(state, SIDEPOD_LEFT) + share(state, SIDEPOD_RIGHT)) / 2.0;
    double suspension = 0.0;
    for (int i = 0; i < 4; i++)
        suspension = std::max(suspension, share(state, SUSPENSION + i));
    return wings + pods + suspension + share(state, FLOOR) + share(state, DIFFUSER) + share(state, REAR_WING);
}

void applySuspension(CarStatus &state, tCar *car)
{
    for (int i = 0; i < 4; i++)
    {
        double bent = share(state, SUSPENSION + i);
        double outward = i == FRNT_LFT || i == REAR_LFT ? 1.0 : -1.0;
        car->wheel[i].staticPos.az = (tdble)(state.baseToe[i] + outward * (i < 2 ? bentToeFront : bentToeRear) * bent);
        car->wheel[i].staticPos.ax = (tdble)(state.baseCamber[i] + bentCamber * bent);
        if (bent >= 1.0)
            retire(state, RETIRED_SUSPENSION);
    }
}

void applyYawPull(const CarStatus &state, tCar *car, double dt)
{
    double wings = wingYawDrag * (share(state, WING_LEFT) - share(state, WING_RIGHT));
    double pods = sidepodYawDrag * (share(state, SIDEPOD_LEFT) - share(state, SIDEPOD_RIGHT));
    double drag = car->aero.CdBody * car->airSpeed2 * (wings + pods);
    sdCarPush(car, -fabs(drag), 0.0, 0.0, drag > 0 ? yawArm : -yawArm, dt);
}

void updateBrakes(CarStatus &state, tCar *car, double dt)
{
    double air = Tair - kelvin;
    for (int i = 0; i < 4; i++)
    {
        const tWheel &wheel = car->wheel[i];
        double speed = fabs(wheel.spinVel * wheel.radius);
        double power = wheel.brake.Tq * fabs(wheel.spinVel);
        double cooling = (brakeStill + brakeSpeed * speed) * (state.brakes[i] - air);
        state.brakes[i] += (power / brakeCapacity - cooling) * dt;
    }
}

void updateEngine(CarStatus &state, tCar *car, double dt)
{
    double load = engineIdle + (1.0 - engineIdle) * clamp01(car->ctrl->accelCmd);
    double airflow = engineCoolBase + fabs(car->DynGC.vel.x) / engineCoolSpeed;
    double radiators = 1.0 - sidepodCoolingLoss * (share(state, SIDEPOD_LEFT) + share(state, SIDEPOD_RIGHT));
    state.engineTemp += (engineHeat * load - engineCool * airflow * radiators * (state.engineTemp - (Tair - kelvin))) * dt;
    if (state.engineTemp >= engineFailure)
        retire(state, RETIRED_ENGINE);
}

void updateRetirement(CarStatus &state, tCarElt *elt, double dt)
{
    if (state.retirement == RUNNING)
        return;
    state.retiredFor += dt;
    if (elt->_speed_xy >= stoppedSpeed && state.retiredFor < stopTimeout)
        return;
    state.stopped = true;
    elt->_state |= state.retirement == RETIRED_FUEL ? RM_CAR_STATE_OUTOFGAS : RM_CAR_STATE_BROKEN;
}

void playerDamage(CarStatus &state, tCar *car, int delta, double dt)
{
    if (delta > 0 && (car->collision & SEM_COLLISION_Z))
        state.parts[FLOOR] = std::min(1.0, state.parts[FLOOR] + delta / partFull);
    if (car->dammage > sdDamageLimit() || wreckage(state) >= wreckedCar)
        retire(state, RETIRED_ACCIDENT);
    if (car->collision & SEM_COLLISION_Z_CRASH)
        for (int i = 0; i < 4; i++)
            if (car->wheel[i].susp.state & SIM_SUSP_COMP)
                sdTyreContact(0, i, verticalCrashCut);
    detectImpact(state, 0, car, dt, true);
}

void fieldDamage(CarStatus &state, int index, tCar *car, int delta, double dt)
{
    if (delta > 0 && (car->collision & SEM_COLLISION_Z))
        state.parts[FLOOR] = std::min(1.0, state.parts[FLOOR] + delta / partFull);
    if (wreckage(state) >= wreckedCar)
        retire(state, RETIRED_ACCIDENT);
    detectImpact(state, index, car, dt, (car->collision & (SEM_COLLISION_XYSCENE | SEM_COLLISION_CAR)) != 0);
    if (state.retirement == RETIRED_ACCIDENT || state.retirement == RETIRED_SUSPENSION)
        state.brokenDown = true;
}

bool airborne(const tCar *car)
{
    for (int i = 0; i < 4; i++)
        if (!(car->wheel[i].state & SIM_WH_INAIR))
            return false;
    return true;
}

void landHard(CarStatus &state, int index)
{
    double side = state.landedSide;
    state.landing = true;
    addImpact(state, index, 1.9, side * 0.8, -0.2 * landingSideImpact, -side * landingSideImpact);
    addImpact(state, index, -2.3, side * 0.5, landingTailImpact, -side * 0.3 * landingTailImpact);
    state.landing = false;
    retire(state, RETIRED_ACCIDENT);
}

void rollAlongGround(CarStatus &state, tCar *car)
{
    double speed = hypot(car->DynGCg.vel.x, car->DynGCg.vel.y);
    double turns = speed >= groundRollSpeed ? 1.0 : 0.0;
    double done = ceil(fabs(state.roll) / fullRoll - rollSlack);
    state.onGround = true;
    state.tumbleAge = 0.0;
    state.pitch = 0.0;
    state.rollStart = state.roll;
    state.rollEnd = state.landedSide * fullRoll * (done + turns);
    double left = fabs(state.rollEnd - state.rollStart) / fullRoll;
    if (left < rollSlack)
    {
        state.tumbling = false;
        state.roll = 0.0;
        return;
    }
    if (turns > 0.0)
        car->DynGCg.vel.z = (tdble)std::max((double)car->DynGCg.vel.z, groundRollHop);
    state.flight = left * std::max(groundRollShortest, std::min(groundRollLongest, speed / groundRollPace));
}

void tumbleStep(CarStatus &state, int index, tCar *car, double dt)
{
    if (!state.tumbling)
        return;
    state.tumbleAge += dt;
    double progress = std::min(1.0, state.tumbleAge / state.flight);
    state.roll = state.rolling ? state.rollStart + (state.rollEnd - state.rollStart) * progress : state.rollPeak * sin(M_PI * progress);
    bool landed = state.tumbleAge > tumbleSettle && !airborne(car);
    if (state.rolling && !state.onGround && landed)
    {
        landHard(state, index);
        rollAlongGround(state, car);
        return;
    }
    if (state.rolling && state.onGround && progress >= 1.0)
        state.tumbling = false;
    if (!state.rolling && (landed || progress >= 1.0))
        state.tumbling = false;
    if (state.tumbleAge >= tumbleLongest)
        state.tumbling = false;
    if (!state.tumbling)
        state.roll = 0.0;
}

void groundAngles(tCar *car, double &roll, double &pitch)
{
    t3Dd normal;
    RtTrackSurfaceNormalL(&car->trkPos, &normal);
    double c = cos(car->DynGCg.pos.az);
    double s = sin(car->DynGCg.pos.az);
    roll = atan2(-(normal.x * -s + normal.y * c), normal.z);
    pitch = atan2(normal.x * c + normal.y * s, normal.z);
}

void level(tCar *car, double roll, double pitch, double time)
{
    car->DynGCg.vel.ax = (tdble)((roll - car->DynGCg.pos.ax) / time);
    car->DynGCg.vel.ay = (tdble)((pitch - car->DynGCg.pos.ay) / time);
}

void settleBody(CarStatus &state, tCar *car, double dt)
{
    if (car->carElt->_state & RM_CAR_STATE_NO_SIMU)
        return;
    double roll = 0.0, pitch = 0.0;
    groundAngles(car, roll, pitch);
    if (state.tumbling)
    {
        level(car, roll, pitch, tumbleLevelTime);
        return;
    }
    double tilt = std::max(fabs(car->DynGCg.pos.ax - roll), fabs(car->DynGCg.pos.ay - pitch));
    bool lost = std::any_of(state.detached, state.detached + 4, [](double d) { return d > 0.0; });
    if (car->DynGCg.pos.z - car->statGC.z - RtTrackHeightL(&car->trkPos) > settleReach)
        state.settling = false;
    else if (tilt >= settleTilt || (lost && !airborne(car)))
        state.settling = true;
    if (!state.settling)
        return;
    if (tilt < settleDone && !lost)
    {
        state.settling = false;
        car->DynGCg.vel.ax = car->DynGCg.vel.ay = 0.0f;
        return;
    }
    level(car, roll, pitch, settleTime);
    if (airborne(car) || tilt < settleTilt)
        return;
    double speed = hypot(car->DynGCg.vel.x, car->DynGCg.vel.y);
    if (speed <= 0.0)
        return;
    double keep = std::max(0.0, speed - bodyFriction * G * dt) / speed;
    car->DynGCg.vel.x *= (tdble)keep;
    car->DynGCg.vel.y *= (tdble)keep;
}

bool wheelsTouch(const tCar *a, const tCar *b, int &wheel, double &closing)
{
    double fx = cos(b->DynGCg.pos.az);
    double fy = sin(b->DynGCg.pos.az);
    double nearest = wheelTouchAcross;
    for (int wa = FRNT_RGT; wa <= FRNT_LFT; wa++)
        for (int wb = REAR_RGT; wb <= REAR_LFT; wb++)
        {
            double dx = a->wheel[wa].pos.x - b->wheel[wb].pos.x;
            double dy = a->wheel[wa].pos.y - b->wheel[wb].pos.y;
            double along = dx * fx + dy * fy;
            double across = fabs(-dx * fy + dy * fx);
            if (along < -wheelTouchBehind || along > wheelTouchAhead || across > nearest)
                continue;
            nearest = across;
            wheel = wa;
        }
    if (nearest >= wheelTouchAcross)
        return false;
    closing = (a->DynGCg.vel.x - b->DynGCg.vel.x) * fx + (a->DynGCg.vel.y - b->DynGCg.vel.y) * fy;
    return closing >= launchClosing;
}

void checkWheelLaunch(int i, int j)
{
    tCar *a = &SimCarTable[i];
    tCar *b = &SimCarTable[j];
    int wheel = 0;
    double closing = 0.0;
    if (wheelsTouch(a, b, wheel, closing))
        launch(field[i], a, wheel == FRNT_RGT ? -1.0 : 1.0, wheelLaunchGain * (closing - launchClosing));
}

}

void sdCarsTumbleStep(tSituation *s, double dt)
{
    int cars = std::min(s->_ncars, (int)field.size());
    for (int i = 0; i < cars; i++)
    {
        tCar *a = &SimCarTable[i];
        if (!(a->collision & SEM_COLLISION_CAR))
            continue;
        for (int j = 0; j < cars; j++)
        {
            tCar *b = &SimCarTable[j];
            if (i == j || !(b->collision & SEM_COLLISION_CAR))
                continue;
            if (hypot(a->DynGCg.pos.x - b->DynGCg.pos.x, a->DynGCg.pos.y - b->DynGCg.pos.y) > pairReach)
                continue;
            checkWheelLaunch(i, j);
        }
    }
    for (int i = 0; i < cars; i++)
    {
        tumbleStep(field[i], i, &SimCarTable[i], dt);
        settleBody(field[i], &SimCarTable[i], dt);
    }
}

void sdCarTumblePose(int index, tCarElt *elt, double *out)
{
    for (int a = 0; a < 4; a++)
        for (int b = 0; b < 4; b++)
            out[a * 4 + b] = elt->_posMat[a][b];
    if (index < 0 || index >= (int)field.size() || !field[index].tumbling)
        return;
    const CarStatus &state = field[index];
    double roll = state.roll;
    double progress = std::min(1.0, state.tumbleAge / state.flight);
    double pitch = state.pitch * sin(M_PI * progress);
    double cr = cos(roll), sr = sin(roll), cp = cos(pitch), sp = sin(pitch);
    double local[3][3] = {
        {cp, 0.0, sp},
        {-sr * sp, cr, sr * cp},
        {-cr * sp, -sr, cr * cp},
    };
    double axes[3][3];
    for (int k = 0; k < 3; k++)
        for (int r = 0; r < 3; r++)
            axes[k][r] = elt->_posMat[0][r] * local[k][0] + elt->_posMat[1][r] * local[k][1] + elt->_posMat[2][r] * local[k][2];
    double pivot = elt->_statGC_z;
    double shift[3];
    for (int r = 0; r < 3; r++)
        shift[r] = elt->_posMat[2][r] * pivot - axes[2][r] * pivot;
    for (int k = 0; k < 3; k++)
        for (int r = 0; r < 3; r++)
            out[k * 4 + r] = axes[k][r];
    for (int r = 0; r < 3; r++)
        out[12 + r] = elt->_posMat[3][r] + shift[r];
    out[14] += invertedLift * 0.5 * (1.0 - cr) + sideLift * sr * sr;
}

void sdCarPush(tCar *car, double forward, double left, double armForward, double armLeft, double dt)
{
    double c = cos(car->DynGCg.pos.az);
    double s = sin(car->DynGCg.pos.az);
    double impulse = car->Minv * dt;
    car->DynGCg.vel.x += (tdble)((forward * c - left * s) * impulse);
    car->DynGCg.vel.y += (tdble)((forward * s + left * c) * impulse);
    car->DynGCg.vel.az += (tdble)((armForward * left - armLeft * forward) * car->Iinv.z * dt);
}

double sdDamageDrag(int index)
{
    const CarStatus &state = field[index];
    double wings = wingDrag * (share(state, WING_LEFT) + share(state, WING_RIGHT));
    double pods = sidepodDrag * (share(state, SIDEPOD_LEFT) + share(state, SIDEPOD_RIGHT));
    return 1.0 + wings + pods + floorDrag * share(state, FLOOR) - rearWingDragDrop * share(state, REAR_WING);
}

double sdCarWreckage(int index)
{
    return index >= 0 && index < (int)field.size() ? wreckage(field[index]) : 0.0;
}

double sdCarAeroShare(int index)
{
    if (index < 0 || index >= (int)field.size())
        return 1.0;
    const CarStatus &state = field[index];
    return std::min(frontLift(state, index), rearLift(state, index));
}

double sdCarDamageGrip(int index)
{
    if (index < 0 || index >= (int)field.size())
        return 1.0;
    const CarStatus &state = field[index];
    double worst = 1.0;
    for (int i = 0; i < 4; i++)
        worst = std::min(worst, 1.0 - bentGripLoss * share(state, SUSPENSION + i));
    return worst;
}

double sdCarDamageShare(int index)
{
    const CarStatus &state = field[index];
    double worst = 0;
    for (int i = 0; i < PART_COUNT; i++)
        worst = std::max(worst, share(state, i));
    return worst;
}

double sdDamagePower(int index)
{
    return 1.0 - derateMax * clamp01((field[index].engineTemp - derateFrom) / derateSpan);
}

bool sdDamageStraightAllowed(int index)
{
    return share(field[index], REAR_WING) < straightWingLimit;
}

double sdDamageWheelGrip(int index, int wheel)
{
    const CarStatus &state = field[index];
    tCar *car = &SimCarTable[index];
    double load = std::max(wheelLoadFloor, (double)car->wheel[wheel].forces.z);
    bool front = wheel == FRNT_RGT || wheel == FRNT_LFT;
    bool leftSide = wheel == FRNT_LFT || wheel == REAR_LFT;
    double axle = -(car->wing[front ? 0 : 1].forces.z + car->aero.lift[front ? 0 : 1]);
    double base = std::max(0.0, axle) / (front ? frontLift(state, index) : rearLift(state, index));
    double skew = sidepodAxleLoss * (share(state, SIDEPOD_LEFT) - share(state, SIDEPOD_RIGHT)) / 2.0;
    if (front)
        skew += wingGripSkew * frontWingFrontLoss * (share(state, WING_LEFT) - share(state, WING_RIGHT)) / 2.0;
    double shift = (leftSide ? -1.0 : 1.0) * base * skew / 2.0;
    double bent = 1.0 - bentGripLoss * share(state, SUSPENSION + wheel);
    return std::max(wheelGripLow, std::min(wheelGripHigh, (load + shift) / load)) * bent;
}

void sdDamageScrape(int index, double amount)
{
    double &floor = field[index].parts[FLOOR];
    floor = std::min(1.0, floor + amount);
}

void sdCarStatusReset(tCarElt *elt)
{
    if ((int)field.size() <= elt->index)
        field.resize(elt->index + 1);
    CarStatus &state = field[elt->index];
    tCar *car = &SimCarTable[elt->index];
    std::fill(state.parts, state.parts + PART_COUNT, 0.0);
    std::fill(state.detached, state.detached + 4, 0.0);
    state.lastDamage = car->dammage;
    for (int i = 0; i < 2; i++)
    {
        state.baseWing[i] = {car->wing[i].Kz, car->wing[i].Kz1, car->wing[i].Kz2, car->wing[i].Kz3};
        state.baseLift[i] = car->aero.Clift[i];
    }
    for (int i = 0; i < 4; i++)
    {
        state.baseToe[i] = car->wheel[i].staticPos.az;
        state.baseCamber[i] = car->wheel[i].staticPos.ax;
    }
    for (double &brake : state.brakes)
        brake = brakeStart;
    state.engineTemp = engineStart;
    state.previousVelX = car->DynGCg.vel.x;
    state.previousVelY = car->DynGCg.vel.y;
    state.contactTotal = 0.0;
    state.contactQuiet = 0.0;
    state.contactSpeed = 0.0;
    state.wallLateral = 0.0;
    state.retirement = RUNNING;
    state.retiredFor = 0.0;
    state.stopped = false;
    state.brokenDown = false;
    state.roll = state.rollStart = state.rollEnd = state.rollPeak = state.pitch = state.tumbleAge = state.flight = state.landedSide = 0.0;
    state.tumbling = state.rolling = state.onGround = state.settling = state.landing = false;
    std::fill(state.wheelBlow, state.wheelBlow + 4, 0.0);
}

void sdCarStatusTeleported(int index)
{
    if (index < 0 || index >= (int)field.size())
        return;
    CarStatus &state = field[index];
    state.previousVelX = SimCarTable[index].DynGCg.vel.x;
    state.previousVelY = SimCarTable[index].DynGCg.vel.y;
    state.contactTotal = 0.0;
    state.wallLateral = 0.0;
    state.roll = 0.0;
    state.tumbling = state.settling = false;
    std::fill(state.wheelBlow, state.wheelBlow + 4, 0.0);
}

void sdCarStatusRepair(int index)
{
    CarStatus &state = field[index];
    std::fill(state.parts, state.parts + PART_COUNT, 0.0);
    std::fill(state.detached, state.detached + 4, 0.0);
}

double sdCarStatusReplaceWing()
{
    double *parts = field[0].parts;
    double total = 0.0;
    for (int i = 0; i < PART_COUNT; i++)
        total += parts[i];
    double removed = parts[WING_LEFT] + parts[WING_RIGHT];
    parts[WING_LEFT] = parts[WING_RIGHT] = 0.0;
    return total > 0.0 ? removed / total : 0.0;
}

void sdCarStatusDriveLimit(tCarElt *elt)
{
    const CarStatus &state = field[elt->index];
    if (state.retirement == RUNNING || (elt->index != 0 && !state.brokenDown))
        return;
    elt->_accelCmd = 0.0f;
    elt->_gearCmd = 0;
    elt->ctrl.singleWheelBrakeMode = 0;
    elt->_brakeCmd = std::max(elt->_brakeCmd, (tdble)retiredBrake);
}

void sdCarStatusPrepare(tCarElt *elt)
{
    tCar *car = &SimCarTable[elt->index];
    if (car->fuel > fuelReserve)
        return;
    car->fuel = (tdble)fuelReserve;
    retire(field[elt->index], RETIRED_FUEL);
}

void sdCarStatusStep(tCarElt *elt, double dt)
{
    CarStatus &state = field[elt->index];
    tCar *car = &SimCarTable[elt->index];
    int delta = car->dammage - state.lastDamage;
    state.lastDamage = car->dammage;
    bool player = elt->index == 0;
    if (player)
        playerDamage(state, car, delta, dt);
    else
        fieldDamage(state, elt->index, car, delta, dt);
    applyAero(state, elt->index, car);
    applySuspension(state, car);
    applyYawPull(state, car, dt);
    updateBrakes(state, car, dt);
    updateEngine(state, car, dt);
    if (player)
        updateRetirement(state, elt, dt);
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
    out[5 + PART_COUNT] = state.retirement;
    out[6 + PART_COUNT] = state.stopped ? 1 : 0;
    out[7 + PART_COUNT] = sdDamagePower(0);
}

EMSCRIPTEN_KEEPALIVE int sdCarsDamage(double *out)
{
    int cars = ReInfo->s->_ncars;
    for (int c = 0; c < cars && c < (int)field.size(); c++)
    {
        for (int i = 0; i < PART_COUNT; i++)
            out[c * PART_COUNT + i] = share(field[c], i);
        for (int i = 0; i < 4; i++)
            if (field[c].detached[i] > 0)
                out[c * PART_COUNT + SUSPENSION + i] = lostWheel;
    }
    return PART_COUNT;
}

EMSCRIPTEN_KEEPALIVE void sdCarDamageSet(int part, double value)
{
    if (part >= 0 && part < PART_COUNT)
        field[0].parts[part] = clamp01(value);
}

EMSCRIPTEN_KEEPALIVE void sdCarBreakDown(int index)
{
    if (index < 0 || index >= (int)field.size())
        return;
    retire(field[index], RETIRED_ENGINE);
    field[index].brokenDown = true;
}

EMSCRIPTEN_KEEPALIVE void sdCarImpact(double forward, double left, double dvForward, double dvLeft)
{
    addImpact(field[0], 0, forward, left, dvForward, dvLeft);
}

}

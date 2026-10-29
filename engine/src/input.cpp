#include <cmath>
#include <algorithm>
#include <emscripten/emscripten.h>

#include <tgf.h>
#include <tgfclient.h>
#include <car.h>
#include <playerpref.h>

#include "game.h"

static const double axisScale = 1000.0;
static const double frontSlipLimit = 8.0 * PI / 180.0;
static const double steerInTime = 0.3;
static const double steerOutTime = 0.15;
static const double steerMinStep = 0.05;
static const double throttleRiseTime = 0.35;
static const double throttleFallTime = 0.06;
static const double brakeRiseTime = 0.1;
static const double brakeFallTime = 0.05;
static const double slipCapMinSpeed = 8.0;
static const double rearSlipLimit = 0.14;
static const double tractionCut = 30.0;
static const double tractionRecover = 1.5;
static const double tractionMinSpeed = 3.0;
static const double rearLockLimit = 0.05;
static const double blipGain = 6.0;
static const double blipMax = 0.5;
static const double wheelLockLimit = 0.17;
static const double absCut = 30.0;
static const double absRecover = 3.0;
static const double analogSteerTime = 0.05;
static const double analogThrottleTime = 0.08;

static bool assist = true;
static bool analog;
static double analogSteer, analogThrottle, analogBrake;
static bool left, right, up, down;
static double steer, throttle, brake, traction = 1.0, braking = 1.0;

static double approach(double value, double target, double rate, double dt)
{
    if (value < target)
        return std::min(target, value + rate * dt);
    return std::max(target, value - rate * dt);
}

static double frontAxleAngle(tCarElt *car)
{
    double xf = (car->priv.wheel[FRNT_RGT].relPos.x + car->priv.wheel[FRNT_LFT].relPos.x) / 2.0;
    double vx = std::max(1.0, (double)fabs(car->_speed_x));
    return atan2(car->_speed_y + car->_yaw_rate * xf, vx);
}

static double steerLimit(tCarElt *car, int dir)
{
    double lock = car->_steerLock;
    if (fabs(car->_speed_x) < slipCapMinSpeed)
        return dir;
    double angle = frontAxleAngle(car) + dir * frontSlipLimit;
    return std::max(-1.0, std::min(1.0, angle / lock));
}

static double keyTarget(tCarElt *car)
{
    int dir = (left ? 1 : 0) - (right ? 1 : 0);
    return dir == 0 ? 0.0 : steerLimit(car, dir);
}

static void updateKeys(tCarElt *car, double dt)
{
    double target = keyTarget(car);
    bool turningIn = fabs(target) > fabs(steer) && target * steer >= 0;
    double span = std::max(steerMinStep, turningIn ? fabs(target) : fabs(steer));
    steer = approach(steer, target, span / (turningIn ? steerInTime : steerOutTime), dt);
    throttle = approach(throttle, up && !down ? 1.0 : 0.0, 1.0 / (up && !down ? throttleRiseTime : throttleFallTime), dt);
    brake = approach(brake, down ? 1.0 : 0.0, 1.0 / (down ? brakeRiseTime : brakeFallTime), dt);
}

static void updateAnalog(tCarElt *car, double dt)
{
    int dir = analogSteer >= 0 ? 1 : -1;
    double target = fabs(analogSteer) * steerLimit(car, dir);
    steer = approach(steer, target, std::max(steerMinStep, fabs(target - steer)) / analogSteerTime, dt);
    throttle = approach(throttle, analogThrottle, 1.0 / analogThrottleTime, dt);
    brake = analogBrake;
}

static double longSlip(tCarElt *car, int i)
{
    return car->_wheelSlipAccel(i) / std::max(1.0, (double)fabs(car->_speed_x));
}

static double latSlip(tCarElt *car, int i)
{
    return car->_wheelSlipSide(i) / std::max(1.0, (double)fabs(car->_speed_x));
}

static double rearSlip(tCarElt *car, double sign)
{
    double slip = 0;
    for (int i = REAR_RGT; i <= REAR_LFT; i++)
        slip = std::max(slip, hypot(std::max(0.0, sign * longSlip(car, i)), latSlip(car, i)));
    return slip;
}

static double engineBrakeBlip(tCarElt *car)
{
    if (fabs(car->_speed_x) < tractionMinSpeed)
        return 0;
    double lock = std::max(longSlip(car, REAR_RGT), longSlip(car, REAR_LFT));
    return std::min(blipMax, std::max(0.0, (lock - rearLockLimit) * blipGain));
}

static double limiter(double value, double excess, double limit, double cut, double recover, double dt)
{
    if (excess > 0)
        return std::max(0.0, value - cut * excess * dt / limit);
    return std::min(1.0, value + recover * dt);
}

static void updateTraction(tCarElt *car, double dt)
{
    double excess = fabs(car->_speed_x) > tractionMinSpeed ? rearSlip(car, -1.0) - rearSlipLimit : -1.0;
    traction = limiter(traction, excess, rearSlipLimit, tractionCut, tractionRecover, dt);
}

static void updateBraking(tCarElt *car, double dt)
{
    double excess = -1.0;
    if (fabs(car->_speed_x) > tractionMinSpeed)
    {
        excess = rearSlip(car, 1.0) - wheelLockLimit;
        for (int i = FRNT_RGT; i <= FRNT_LFT; i++)
            excess = std::max(excess, longSlip(car, i) - wheelLockLimit);
    }
    braking = limiter(braking, excess, wheelLockLimit, absCut, absRecover, dt);
}

void sdInputConfigure()
{
    if (!assist)
        return;
    void *prefs = GfParmReadFileLocal(HM_PREF_FILE, GFPARM_RMODE_STD | GFPARM_RMODE_CREAT);
    const char *drv = HM_SECT_PREF "/" HM_LIST_DRV "/1";
    GfParmSetStr(prefs, drv, HM_ATT_LEFTSTEER, "MOUSE_LEFT");
    GfParmSetStr(prefs, drv, HM_ATT_RIGHTSTEER, "MOUSE_RIGHT");
    GfParmSetStr(prefs, drv, HM_ATT_THROTTLE, "MOUSE_UP");
    GfParmSetStr(prefs, drv, HM_ATT_BRAKE, "MOUSE_DOWN");
    const char *mins[] = {HM_ATT_LEFTSTEER_MIN, HM_ATT_RIGHTSTEER_MIN, HM_ATT_THROTTLE_MIN, HM_ATT_BRAKE_MIN};
    const char *maxs[] = {HM_ATT_LEFTSTEER_MAX, HM_ATT_RIGHTSTEER_MAX, HM_ATT_THROTTLE_MAX, HM_ATT_BRAKE_MAX};
    const char *pows[] = {HM_ATT_LEFTSTEER_POW, HM_ATT_RIGHTSTEER_POW, HM_ATT_THROTTLE_POW, HM_ATT_BRAKE_POW};
    for (int i = 0; i < 4; i++)
    {
        GfParmSetNum(prefs, drv, mins[i], NULL, 0);
        GfParmSetNum(prefs, drv, maxs[i], NULL, axisScale);
        GfParmSetNum(prefs, drv, pows[i], NULL, 1.0 / axisScale);
    }
    GfParmSetStr(prefs, drv, HM_ATT_ABS, "no");
    GfParmSetStr(prefs, drv, HM_ATT_ASR, "no");
    GfParmSetNum(prefs, drv, HM_ATT_STEER_SENS, NULL, 1);
    GfParmSetNum(prefs, drv, HM_ATT_STEER_SPD, NULL, 0);
    GfParmSetNum(prefs, drv, HM_ATT_STEER_DEAD, NULL, 0);
    GfParmSetNum(prefs, drv, HM_ATT_THROTTLE_SENS, NULL, 1);
    GfParmSetNum(prefs, drv, HM_ATT_BRAKE_SENS, NULL, 1);
    GfParmWriteFile(NULL, prefs, "preferences");
    GfParmReleaseHandle(prefs);
    left = right = up = down = false;
    steer = throttle = brake = 0;
    traction = 1.0;
    braking = 1.0;
}

void sdInputState(double *out)
{
    out[0] = steer;
    out[1] = throttle;
    out[2] = brake;
    out[3] = traction;
    out[4] = braking;
}

void sdInputKey(int key, int state)
{
    bool pressed = state == GFUI_KEY_DOWN;
    if (key == GFUIK_LEFT)
        left = pressed;
    else if (key == GFUIK_RIGHT)
        right = pressed;
    else if (key == GFUIK_UP)
        up = pressed;
    else if (key == GFUIK_DOWN)
        down = pressed;
}

void sdInputUpdate(tCarElt *car, double dt)
{
    if (!assist)
        return;
    if (analog)
        updateAnalog(car, dt);
    else
        updateKeys(car, dt);
    updateTraction(car, dt);
    throttle = std::min(throttle, traction);
    double accel = std::max(throttle, engineBrakeBlip(car));
    updateBraking(car, dt);
    int sw, sh, vw, vh;
    GfScrGetSize(&sw, &sh, &vw, &vh);
    double pedal = std::min(brake, braking);
    double y = pedal > 0 ? -pedal : accel;
    GfuiMouseSetPos((int)lround(sw / 2 + steer * -axisScale), (int)lround(sh / 2 + y * axisScale));
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdInputAnalog(int active, double steerValue, double throttleValue, double brakeValue)
{
    analog = active != 0;
    analogSteer = std::max(-1.0, std::min(1.0, steerValue));
    analogThrottle = std::max(0.0, std::min(1.0, throttleValue));
    analogBrake = std::max(0.0, std::min(1.0, brakeValue));
}

EMSCRIPTEN_KEEPALIVE void sdInputAssist(int on)
{
    assist = on != 0;
}

}

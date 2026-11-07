#ifndef SD_WEB_GAME_H
#define SD_WEB_GAME_H

#include <car.h>
#include <raceman.h>

struct SdPhysicsEngine
{
    void configureCar(tCarElt *car);
};

SdPhysicsEngine &RePhysicsEngine();

extern tRmInfo *ReInfo;

void sdInitWeather();
void sdInitStartingGrid();
void sdCameraReset();
void sdCameraUpdate(tCarElt *car, tSituation *s, double *out);
void sdKeyEvent(int key, int state);
void sdInputConfigure();
void sdInputKey(int key, int state);
void sdInputApplyHold(tCarElt *car);
void sdInputLaunch(tCarElt *car, tSituation *s);
void sdInputRelaunch();
bool sdInputFresh();
void sdInputUpdate(tCarElt *car, double dt);
void sdInputState(double *out);
void sdCarStatusReset(tCarElt *car);
void sdCarStatusStep(tCarElt *car, double dt);
bool sdPlayerAutopilot();
double sdDamageDrag(int index);
double sdCarDamageShare(int index);
double sdCarWreckage(int index);
void sdCarStatusRepair(int index);
void sdCarStatusTeleported(int index);
double sdDamagePower(int index);
bool sdDamageStraightAllowed(int index);
void sdDamageScrape(int index, double amount);
int sdDamageLimit();
double sdCarStatusReplaceWing();
void sdCarStatusDriveLimit(tCarElt *car);
void sdCarStatusPrepare(tCarElt *car);
int sdSurfaceClass(const tTrackSeg *seg);
void sdTyresReset(tCarElt *car);
void sdTyresStep(tCarElt *car, double dt);
void sdTyresService(int index, int compound);
void sdTyresSetTrackGrip(double grip);
double sdTyresGrip(int index);
double sdTyresWeakestAxle(int index);
double sdTyresWetShare(int index);
double sdTyresWetShareAt(int index, double water);
double sdWeatherLineShare(double offset);
double sdTyresHeat(int index);
double sdTyresWorstWear(int index);
int sdTyresCompound(int index);
int sdTyresAge(int index);
void sdTyreContact(int index, int wheel, double amount);
bool sdTyreFlat(int wheel);
double sdTyresFrontLift(int index);
double sdTyresRearLift(int index);
void sdEnergyReset(tCarElt *car);
void sdEnergyStep(tCarElt *car, double dt);
void sdEnergyRestore(int index);
void sdEnergySetMode(int index, int value);
double sdEnergyBatteryShare(int index);
void sdEnergyArmOvertake(int index);
bool sdEnergyOvertakeActive(int index);
double sdEnergyLastLapFuel(int index);
void sdServiceCar(int index, int compound);
void sdCarTeleport(int index, double distance, double lateral);
void sdCarSlowTo(int index, double speed);
int sdCarToGrid(int index, int slot);
void sdCarSetFuel(int index, double litres);
void sdEnergySetPerformance(int index, double factor);
void sdWeatherReset();
void sdWeatherStep(tSituation *s, double dt);
double sdWeatherWaterAt(double distance, double toMiddle);
double sdWeatherWheelWater(tCarElt *car, int wheel);
double sdWeatherCarWater(tCarElt *car);
double sdWeatherFutureLine(double seconds);
bool sdWeatherWetCompound(int compound);
int sdWeatherIdealCompound(double water, int dryChoice);

const int SD_CAR_STRIDE = 49;

enum SdFrameIndex
{
    SD_TIME = 0,
    SD_POSMAT = 1,
    SD_WHEELS = 17,
    SD_SPEED = 45,
    SD_RPM,
    SD_RPM_REDLINE,
    SD_GEAR,
    SD_LAPS,
    SD_CUR_LAP_TIME,
    SD_LAST_LAP_TIME,
    SD_BEST_LAP_TIME,
    SD_DIST_FROM_START,
    SD_TO_MIDDLE,
    SD_STEER,
    SD_ACCEL,
    SD_BRAKE,
    SD_RACE_STATE,
    SD_DAMMAGE,
    SD_CAMERA,
    SD_BRAKE_TEMP = SD_CAMERA + 24,
    SD_FRAME_SIZE = SD_BRAKE_TEMP + 4
};

#endif

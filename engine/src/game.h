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
void sdInputUpdate(tCarElt *car, double dt);
void sdInputState(double *out);

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

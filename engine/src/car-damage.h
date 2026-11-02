#ifndef SD_WEB_CAR_DAMAGE_H
#define SD_WEB_CAR_DAMAGE_H

#include "sim.h"

double sdDamageWheelGrip(tCar *car, int wheel);
void sdCarPush(tCar *car, double forward, double left, double armForward, double armLeft, double dt);

#endif

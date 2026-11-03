#ifndef SD_WEB_RACE_CONTROL_H
#define SD_WEB_RACE_CONTROL_H

#include <raceman.h>

void sdRaceControlBegin(tSituation *s, int kind);
void sdRaceControlTick(tSituation *s, double dt);
bool sdRaceControlHolding(tSituation *s);
bool sdRaceControlNeutralised();
double sdRaceControlSinceSignal(tSituation *s);

#endif

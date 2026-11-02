#ifndef SD_WEB_RACE_CONTROL_H
#define SD_WEB_RACE_CONTROL_H

#include <raceman.h>

double sdRaceControlStartOffset(int kind);
void sdRaceControlBegin(tSituation *s, int kind);
void sdRaceControlTick(tSituation *s, double dt);
bool sdRaceControlHolding(tSituation *s);
bool sdRaceControlFormation();
bool sdRaceControlNeutralised();
double sdRaceControlSinceSignal(tSituation *s);

#endif

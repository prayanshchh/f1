#ifndef SD_WEB_SESSION_H
#define SD_WEB_SESSION_H

#include <raceman.h>

bool sdFieldActive();
int sdFieldBay(int teamIndex, int seat);
int sdPitCompound();
double sdSessionStartClock();
void sdSessionStartPlace(int index, int slot, int bay, double *distance, double *lateral);
void sdSessionBegin(tSituation *s);
void sdSessionTick(tSituation *s, double dt);
void sdSessionAfterStep(tSituation *s);
bool sdSessionCarVisible(int index);
void sdSessionClearPlans();

#endif

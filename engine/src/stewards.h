#ifndef SD_WEB_STEWARDS_H
#define SD_WEB_STEWARDS_H

#include <raceman.h>

void sdStewardsBegin(tSituation *s, int kind, int totalLaps);
void sdStewardsTick(tSituation *s, double dt);
void sdStewardsStep(tSituation *s);
void sdStewardsNoteService(int index);
void sdStewardsLapCompleted(int index);
bool sdStewardsLapInvalid(int index);
bool sdStewardsLastLapInvalid(int index);
double sdStewardsOwedTime(int index);
double sdStewardsTimeAdded(int index);
bool sdStewardsDisqualified(int index);
bool sdStewardsYield(int index);
int sdStewardsGridDrop(int index);
int sdStewardsOffTracks(int index);

#endif

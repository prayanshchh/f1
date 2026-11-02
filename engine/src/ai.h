#ifndef SD_WEB_AI_H
#define SD_WEB_AI_H

#include <car.h>
#include <raceman.h>
#include <track.h>

enum SdAiTask
{
    AI_RACE,
    AI_OUT_LAP,
    AI_PUSH_LAP,
    AI_IN_LAP,
    AI_GARAGE,
    AI_PARKED,
    AI_COOL_DOWN
};

bool sdAiLoadTrack(tTrack *track);
void sdAiReset(int cars);
void sdAiConfigure(int index, double pace, double racePace, double racecraft, int bay);
void sdAiDrive(int index, tCarElt *car, tSituation *s);
void sdAiSetTask(int index, SdAiTask task);
SdAiTask sdAiTask(int index);
void sdAiRequestPit(int index, int compound, double stopTime);
bool sdAiPitPending(int index);
void sdAiSetBlueFlag(int index, bool on);
void sdAiSetReaction(int index, double seconds);
void sdAiSetLapNoise(int index, double factor);
void sdAiToGarage(int index, int compound, double service);
void sdAiLeaveGarage(int index);
void sdAiTakeOver(int index);
void sdAiResetAtBox(int index);
int sdAiBayOf(int index);
double sdAiStuckTime(int index);
bool sdAiInPitLaneAt(double distance, double toMiddle);
bool sdAiInPitLane(int index);
bool sdAiPitDone(int index);
void sdAiSetPaceScale(double scale);
bool sdAiGridSlot(int slot, double *distance, double *lateral);
bool sdAiBoxOf(int bay, double *distance, double *lateral);
double sdAiWrap(double distance);
double sdAiLength();

#endif

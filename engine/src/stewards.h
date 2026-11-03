#ifndef SD_WEB_STEWARDS_H
#define SD_WEB_STEWARDS_H

#include <raceman.h>

enum Offence
{
    O_JUMP_START,
    O_GRID_POSITION,
    O_TRACK_LIMITS,
    O_LEFT_TRACK_POSITION,
    O_LEFT_TRACK_TIME,
    O_UNSAFE_REJOIN,
    O_COLLISION,
    O_FORCING_OFF,
    O_BLUE_FLAGS,
    O_YELLOW_SINGLE,
    O_YELLOW_DOUBLE,
    O_YELLOW_OVERTAKE,
    O_IMPEDING,
    O_PIT_SPEEDING,
    O_DIRECTION_CHANGES,
    O_MOVING_UNDER_BRAKING,
    O_PENALTY_NOT_SERVED,
    O_PENALTY_IMPROPER,
    O_VSC_DELTA,
    O_SC_DELTA,
    O_SC_OVERTAKE,
    O_SAFETY_CAR_PASS,
    O_SC_GAP,
    O_RESTART_OVERTAKE,
    O_RED_FLAG,
    O_UNSAFE_RELEASE
};

enum Stage
{
    STAGE_NOTED,
    STAGE_DECISION,
    STAGE_NO_ACTION,
    STAGE_WARNING,
    STAGE_INSTRUCTION,
    STAGE_SERVED,
    STAGE_RETURNED,
    STAGE_FLAG,
    STAGE_CLEAR,
    STAGE_CONTROL
};

enum Penalty
{
    P_NONE,
    P_WARNING,
    P_BLACK_WHITE,
    P_REPRIMAND,
    P_TIME5,
    P_TIME10,
    P_DRIVE_THROUGH,
    P_STOP_GO,
    P_TIME_ADDED,
    P_GRID,
    P_DISQUALIFIED,
    P_LAP_DELETED
};

enum ControlEvent
{
    EV_VSC,
    EV_VSC_ENDING,
    EV_SC,
    EV_SC_IN,
    EV_GREEN,
    EV_RED,
    EV_SUSPENDED,
    EV_RESUME,
    EV_ROLLING,
    EV_LINEUP
};


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
bool sdStewardsPlayerTrouble(int index);
bool sdStewardsSpun(int index, double seconds);
void sdStewardsDecide(int car, int offence, int penalty, double value, int other, double distance, double delay, int points);
void sdStewardsAnnounce(int event, double value, double distance);
void sdStewardsArmStart(tSituation *s, double signal, double countdown);

#endif

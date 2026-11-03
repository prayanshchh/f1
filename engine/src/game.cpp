#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unistd.h>
#include <vector>
#include <emscripten/emscripten.h>

#include <tgf.h>
#include <tgfclient.h>
#include <track.h>
#include <car.h>
#include <raceman.h>
#include <robot.h>
#include <robottools.h>

#include "ai.h"
#include "game.h"
#include "session.h"
#include "stewards.h"
#include "race-control.h"
#include "sim.h"

tRmInfo *ReInfo = nullptr;

extern tTrack *TrackBuildv1(const char *trackfile);
extern void SimInit(int nbcars, tTrack *track);
extern void SimConfig(tCarElt *carElt);
extern void SimUpdate(tSituation *s, double deltaTime);
extern void SimReConfig(tCarElt *carElt);

extern "C" int moduleWelcome(const tModWelcomeIn *welcomeIn, tModWelcomeOut *welcomeOut);
extern "C" int moduleInitialize(tModInfo *modInfo);

SdPhysicsEngine &RePhysicsEngine()
{
    static SdPhysicsEngine engine;
    return engine;
}

void SdPhysicsEngine::configureCar(tCarElt *car)
{
    SimConfig(car);
}


struct FieldEntry
{
    std::string name, code, team;
    int teamIndex, seat, slot;
    double pace, racePace, racecraft;
};

static tSituation situation;
static std::vector<tReCarInfo> carInfo;
static tModInfo humanModInfo[10];
static std::vector<FieldEntry> fieldEntries;
static FieldEntry playerEntry = {"You", "YOU", "", 0, 1, 0, 1.0, 1.0, 1.0};
static bool playerAutopilot = false;

bool sdPlayerAutopilot()
{
    return playerAutopilot;
}
static double frame[SD_FRAME_SIZE];
static double simuTick = RCM_MAX_DT_SIMU;
static double clockNow = 0.0;
static double playerDriveTime = 0.0;
static int damageLimit = 0;

int sdDamageLimit()
{
    return damageLimit;
}

static void *carParams(const char *carName, tCarElt *elt)
{
    char buf[256];
    snprintf(buf, sizeof(buf), "cars/models/%s/%s.xml", carName, carName);
    void *carhdle = GfParmReadFileBoth(buf, GFPARM_RMODE_STD);
    const char *category = GfParmGetStr(carhdle, SECT_CAR, PRM_CATEGORY, NULL);
    strncpy(elt->_category, category, MAX_NAME_LEN - 1);
    snprintf(buf, sizeof(buf), "cars/categories/%s.xml", elt->_category);
    void *cathdle = GfParmReadFile(buf, GFPARM_RMODE_STD | GFPARM_RMODE_CREAT);
    if (GfParmCheckHandle(cathdle, carhdle))
    {
        GfLogError("Car %s NOT in category %s\n", elt->_carName, category);
        return nullptr;
    }
    return GfParmMergeHandles(cathdle, carhdle,
                              GFPARM_MMODE_SRC | GFPARM_MMODE_DST | GFPARM_MMODE_RELSRC | GFPARM_MMODE_RELDST);
}

static void prepareTiming(tCarElt *elt)
{
    elt->_currentSector = 0;
    elt->_nbSectors = ReInfo->track->numberOfSectors;
    elt->_curSplitTime = (double *)malloc(sizeof(double) * (elt->_nbSectors > 1 ? elt->_nbSectors - 1 : 1));
    elt->_bestSplitTime = (double *)malloc(sizeof(double) * (elt->_nbSectors > 1 ? elt->_nbSectors - 1 : 1));
    for (int xx = 0; xx < elt->_nbSectors - 1; ++xx)
    {
        elt->_curSplitTime[xx] = -1.0f;
        elt->_bestSplitTime[xx] = -1.0f;
    }
    elt->_trackPositionCount = (int)(ReInfo->track->length + 1);
    elt->_currLapTimeAtTrackPosition = (float *)malloc(elt->_trackPositionCount * sizeof(float));
    elt->_bestLapTimeAtTrackPosition = (float *)malloc(elt->_trackPositionCount * sizeof(float));
}

static tCarElt *loadHumanCar(const char *carName)
{
    const int robotIdx = humanModInfo[0].index;
    tRobotItf *curRobot = (tRobotItf *)calloc(1, sizeof(tRobotItf));
    humanModInfo[0].fctInit(robotIdx, (void *)curRobot);

    char path[256];
    void *robhdle = GfParmReadFileLocal("drivers/human/human.xml", GFPARM_RMODE_STD);
    snprintf(path, sizeof(path), "%s/%s/%d", ROB_SECT_ROBOTS, ROB_LIST_INDEX, robotIdx);

    tCarElt *elt = &(ReInfo->carList[0]);
    GF_TAILQ_INIT(&(elt->_penaltyList));
    elt->_driverType = RM_DRV_HUMAN;
    elt->_networkPlayer = 0;
    elt->index = 0;
    elt->robot = curRobot;
    elt->_paramsHandle = robhdle;
    elt->_driverIndex = robotIdx;
    elt->_moduleIndex = robotIdx;
    strncpy(elt->_modName, "human", MAX_NAME_LEN - 1);
    strncpy(elt->_name, GfParmGetStr(robhdle, path, ROB_ATTR_NAME, "none"), MAX_NAME_LEN - 1);
    strncpy(elt->_sname, GfParmGetStr(robhdle, path, ROB_ATTR_SNAME, "none"), MAX_NAME_LEN - 1);
    strncpy(elt->_cname, GfParmGetStr(robhdle, path, ROB_ATTR_CODE, "---"), 3);
    strncpy(elt->_teamname, GfParmGetStr(robhdle, path, ROB_ATTR_TEAM, "none"), MAX_NAME_LEN - 1);
    elt->_driveSkill = -1.0f;
    strncpy(elt->_carName, carName, MAX_NAME_LEN - 1);
    elt->_raceNumber = (int)GfParmGetNum(robhdle, path, ROB_ATTR_RACENUM, (char *)NULL, 0);
    elt->_skillLevel = ROOKIE;
    elt->_startRank = 0;
    elt->_pos = 1;
    elt->_remainingLaps = ReInfo->s->_totLaps;

    void *carhdle = carParams(carName, elt);
    if (!carhdle)
        return nullptr;

    void *handle = GfParmReadFileLocal("drivers/curcarnames.xml", GFPARM_RMODE_CREAT);
    snprintf(path, sizeof(path), "drivers/%s/%d", "human", elt->_driverIndex);
    GfParmSetStr(handle, path, RM_ATTR_CARNAME, elt->_carName);
    GfParmWriteFile(0, handle, "Car names");
    GfParmReleaseHandle(handle);
    handle = NULL;

    curRobot->rbNewTrack(elt->_driverIndex, ReInfo->track, carhdle, &handle, ReInfo->s);
    if (handle && handle != carhdle)
    {
        if (GfParmCheckHandle(carhdle, handle))
        {
            GfLogError("Bad Car parameters for driver %s\n", elt->_name);
            return nullptr;
        }
        handle = GfParmMergeHandles(carhdle, handle,
                                    GFPARM_MMODE_SRC | GFPARM_MMODE_DST | GFPARM_MMODE_RELSRC | GFPARM_MMODE_RELDST);
    }
    else
    {
        handle = carhdle;
    }
    elt->_carHandle = handle;
    prepareTiming(elt);
    return elt;
}

static void aiNewRace(int, tCarElt *, tSituation *)
{
}

static tCarElt *loadAiCar(int index, const FieldEntry &entry, const char *carName)
{
    tRobotItf *robot = (tRobotItf *)calloc(1, sizeof(tRobotItf));
    robot->index = index;
    robot->rbNewRace = aiNewRace;
    tCarElt *elt = &(ReInfo->carList[index]);
    GF_TAILQ_INIT(&(elt->_penaltyList));
    elt->_driverType = RM_DRV_ROBOT;
    elt->_networkPlayer = 0;
    elt->index = index;
    elt->robot = robot;
    elt->_driverIndex = index;
    elt->_moduleIndex = index;
    strncpy(elt->_modName, "ai", MAX_NAME_LEN - 1);
    strncpy(elt->_name, entry.name.c_str(), MAX_NAME_LEN - 1);
    strncpy(elt->_sname, entry.name.c_str(), MAX_NAME_LEN - 1);
    strncpy(elt->_cname, entry.code.c_str(), 3);
    strncpy(elt->_teamname, entry.team.c_str(), MAX_NAME_LEN - 1);
    elt->_driveSkill = -1.0f;
    strncpy(elt->_carName, carName, MAX_NAME_LEN - 1);
    elt->_skillLevel = ROOKIE;
    elt->_startRank = index;
    elt->_pos = index + 1;
    elt->_remainingLaps = ReInfo->s->_totLaps;
    void *carhdle = carParams(carName, elt);
    if (!carhdle)
        return nullptr;
    char path[256];
    snprintf(path, sizeof(path), "aisetup/%s/default.xml", carName);
    void *setup = GfParmReadFile(path, GFPARM_RMODE_STD | GFPARM_RMODE_PRIVATE);
    elt->_carHandle = setup ? GfParmMergeHandles(carhdle, setup, GFPARM_MMODE_SRC | GFPARM_MMODE_DST | GFPARM_MMODE_RELSRC | GFPARM_MMODE_RELDST) : carhdle;
    prepareTiming(elt);
    return elt;
}

static void placeCar(tCarElt *car, double distance, double lateral, double height)
{
    double along = sdAiWrap(distance);
    tTrackSeg *seg = ReInfo->track->seg->next;
    while (!(along >= seg->lgfromstart && along < seg->lgfromstart + seg->length))
        seg = seg->next;
    tTrkLocPos pos;
    pos.seg = seg;
    pos.type = TR_LPOS_MAIN;
    double local = along - seg->lgfromstart;
    pos.toStart = (tdble)(seg->type == TR_STR ? local : local / seg->radius);
    pos.toMiddle = (tdble)lateral;
    pos.toRight = seg->width / 2 + pos.toMiddle;
    pos.toLeft = seg->width / 2 - pos.toMiddle;
    car->_trkPos = pos;
    RtTrackLocal2Global(&pos, &(car->_pos_X), &(car->_pos_Y), TR_TOMIDDLE);
    car->_yaw = RtTrackSideTgAngleL(&pos);
    car->_pos_Z = RtTrackHeightL(&pos) + height;
    FLOAT_NORM0_2PI(car->_yaw);
    car->_speed_x = 0;
}

static int practiceSlot = -1;

static void placeCarAt(tCarElt *car, double x, double y, double yaw, double height)
{
    tTrkLocPos pos;
    RtTrackGlobal2Local(ReInfo->track->seg->next, (tdble)x, (tdble)y, &pos, TR_LPOS_MAIN);
    car->_trkPos = pos;
    car->_pos_X = (tdble)x;
    car->_pos_Y = (tdble)y;
    car->_yaw = (tdble)yaw;
    car->_pos_Z = RtTrackHeightL(&pos) + height;
    FLOAT_NORM0_2PI(car->_yaw);
    car->_speed_x = 0;
    if (RtGetDistFromStart(car) < ReInfo->track->length / 2)
        car->_laps = 1;
}

static void syncTeleported(int index)
{
    tCarElt *elt = ReInfo->s->cars[index];
    tCar *car = &SimCarTable[index];
    car->DynGCg.pos.x = elt->_pos_X;
    car->DynGCg.pos.y = elt->_pos_Y;
    car->DynGCg.pos.z = elt->_pos_Z;
    car->DynGCg.pos.az = elt->_yaw;
    car->DynGCg.pos.ax = 0;
    car->DynGCg.pos.ay = 0;
    memset(&car->DynGCg.vel, 0, sizeof(car->DynGCg.vel));
    memset(&car->DynGCg.acc, 0, sizeof(car->DynGCg.acc));
    car->DynGC.pos = car->DynGCg.pos;
    memset(&car->DynGC.vel, 0, sizeof(car->DynGC.vel));
    memset(&car->DynGC.acc, 0, sizeof(car->DynGC.acc));
    car->trkPos = elt->_trkPos;
    for (int i = 0; i < 4; i++)
        car->wheel[i].spinVel = 0;
    ReInfo->_reCarInfo[index].prevTrkPos = elt->_trkPos;
    ReInfo->_reCarInfo[index].sTime = (tdble)ReInfo->s->currentTime;
    ReInfo->_reCarInfo[index].lapFlag = 0;
    sdCarStatusTeleported(index);
}

void sdCarTeleport(int index, double distance, double lateral)
{
    placeCar(ReInfo->s->cars[index], distance, lateral, 0.05);
    syncTeleported(index);
}

int sdCarToGrid(int index, int slot)
{
    double x = 0, y = 0, yaw = 0;
    if (!sdAiGridPose(slot, &x, &y, &yaw))
        return -1;
    tCarElt *elt = ReInfo->s->cars[index];
    int laps = elt->_laps;
    elt->_laps = 0;
    placeCarAt(elt, x, y, yaw, 0.05);
    int startLaps = elt->_laps;
    elt->_laps = laps;
    syncTeleported(index);
    return startLaps;
}

void sdServiceCar(int index, int compound)
{
    tCarElt *car = ReInfo->s->cars[index];
    car->pitcmd.fuel = 0;
    car->pitcmd.repair = car->_dammage;
    car->pitcmd.tireChange = tCarPitCmd::ALL;
    car->pitcmd.tiresetChange = tCarPitCmd::NON_CHANGE;
    SimReConfig(car);
    sdStewardsNoteService(index);
    sdTyresService(index, compound);
    sdCarStatusRepair(index);
    sdEnergyRestore(index);
    car->pitcmd.repair = 0;
    car->pitcmd.tireChange = tCarPitCmd::NONE;
}

void sdCarSetFuel(int index, double litres)
{
    SimCarTable[index].fuel = (tdble)std::min((double)SimCarTable[index].tank, litres);
}

static void manageCar(tCarElt *car)
{
    tSituation *s = ReInfo->s;
    tReCarInfo *info = &(ReInfo->_reCarInfo[car->index]);

    if (car->_speed_x > car->_topSpeed)
        car->_topSpeed = car->_speed_x;

    if (info->prevTrkPos.seg != car->_trkPos.seg)
    {
        if ((info->prevTrkPos.seg->raceInfo & TR_LAST) && (car->_trkPos.seg->raceInfo & TR_START))
        {
            if (info->lapFlag == 0)
            {
                car->_laps++;
                sdStewardsLapCompleted(car->index);
                if (car->_laps > 1)
                {
                    car->_lastLapTime = s->currentTime - info->sTime;
                    if (!sdStewardsLastLapInvalid(car->index) && (car->_bestLapTime == 0 || car->_lastLapTime < car->_bestLapTime))
                        car->_bestLapTime = car->_lastLapTime;
                }
                info->sTime = (tdble)s->currentTime;
            }
            else
            {
                info->lapFlag--;
            }
        }
        if ((info->prevTrkPos.seg->raceInfo & TR_START) && (car->_trkPos.seg->raceInfo & TR_LAST))
        {
            info->lapFlag++;
        }
    }
    info->prevTrkPos = car->_trkPos;
    car->_curLapTime = s->currentTime - info->sTime;
    car->_distFromStartLine = car->_trkPos.seg->lgfromstart + (car->_trkPos.seg->type == TR_STR ? car->_trkPos.toStart : car->_trkPos.toStart * car->_trkPos.seg->radius);
    car->_distRaced = (car->_laps - 1) * ReInfo->track->length + car->_distFromStartLine;
}

static void drivePlayer(tSituation *s, double limit)
{
    tCarElt *car = s->cars[0];
    double tick = s->deltaTime;
    double since = s->currentTime - playerDriveTime;
    s->deltaTime = since > 0 && since < limit ? since : limit;
    sdInputUpdate(car, s->deltaTime);
    if ((car->_state & RM_CAR_STATE_NO_SIMU) == 0)
        car->robot->rbDrive(car->robot->index, car, s);
    sdInputLaunch(car, s);
    sdInputApplyHold(car);
    sdCarStatusDriveLimit(car);
    s->deltaTime = tick;
    playerDriveTime = s->currentTime;
}

static void runOneStep(double deltaTimeIncrement)
{
    tRmInfo *pCurrReInfo = ReInfo;
    tSituation *s = pCurrReInfo->s;

    pCurrReInfo->_reCurTime += deltaTimeIncrement * fabs(pCurrReInfo->_reTimeMult);

    if (pCurrReInfo->_reTimeMult > 0)
        s->currentTime += deltaTimeIncrement;
    else
        s->currentTime -= deltaTimeIncrement;

    if (s->currentTime < 0)
    {
        if (pCurrReInfo->_reTimeMult < 0)
            pCurrReInfo->_reTimeMult = 1;
        else
            pCurrReInfo->s->_raceState = RM_RACE_STARTING;
    }
    else if (pCurrReInfo->s->_raceState == RM_RACE_STARTING)
    {
        pCurrReInfo->s->_raceState = RM_RACE_RUNNING;
        s->currentTime = 0.0;
        pCurrReInfo->_reLastRobTime = 0.0;
    }

    s->accelTime = s->currentTime;

    bool freshInput = sdInputFresh();
    if ((s->currentTime - pCurrReInfo->_reLastRobTime) >= RCM_MAX_DT_ROBOTS)
    {
        s->deltaTime = s->currentTime - pCurrReInfo->_reLastRobTime;
        sdStewardsTick(s, s->deltaTime);
        sdRaceControlTick(s, s->deltaTime);
        sdSessionTick(s);
        bool playerOnAi = playerAutopilot && sdFieldActive();
        if (!playerOnAi)
            drivePlayer(s, s->deltaTime);
        for (int i = playerOnAi ? 0 : 1; i < s->_ncars; i++)
        {
            if ((s->cars[i]->_state & RM_CAR_STATE_NO_SIMU) != 0)
                continue;
            sdAiDrive(i, s->cars[i], s);
        }
        if (sdRaceControlHolding(s))
            for (int i = playerOnAi ? 0 : 1; i < s->_ncars; i++)
            {
                s->cars[i]->_brakeCmd = 1.0f;
                s->cars[i]->_clutchCmd = 1.0f;
            }
        for (int i = 0; i < s->_ncars; i++)
            sdCarStatusDriveLimit(s->cars[i]);
        pCurrReInfo->_reLastRobTime = s->currentTime;
    }
    else if (freshInput && !(playerAutopilot && sdFieldActive()))
    {
        drivePlayer(s, RCM_MAX_DT_ROBOTS);
    }

    sdWeatherStep(s, deltaTimeIncrement);
    for (int i = 0; i < s->_ncars; i++)
    {
        sdTyresStep(s->cars[i], deltaTimeIncrement);
        sdEnergyStep(s->cars[i], deltaTimeIncrement);
        sdCarStatusPrepare(s->cars[i]);
    }
    SimUpdate(s, deltaTimeIncrement);
    for (int i = 0; i < s->_ncars; i++)
    {
        sdCarStatusStep(s->cars[i], deltaTimeIncrement);
        manageCar(s->cars[i]);
    }
    sdStewardsStep(s);
    sdSessionAfterStep(s);
}

static double raceCountdown = 0.0;

static void startRace()
{
    tSituation *s = ReInfo->s;
    for (int i = 0; i < s->_ncars; i++)
    {
        tRobotItf *robot = s->cars[i]->robot;
        robot->rbNewRace(robot->index, s->cars[i], s);
    }

    SimUpdate(s, RCM_MAX_DT_SIMU);
    for (int i = 0; i < s->_ncars; i++)
        ReInfo->_reCarInfo[i].prevTrkPos = s->cars[i]->_trkPos;

    for (int i = 0; i < s->_ncars; i++)
    {
        memset(&(s->cars[i]->ctrl), 0, sizeof(tCarCtrl));
        s->cars[i]->ctrl.brakeCmd = 1.0;
        s->cars[i]->_commitBestLapTime = true;
    }

    for (int j = 0; j < (int)(1.0 / RCM_MAX_DT_SIMU); j++)
        SimUpdate(s, RCM_MAX_DT_SIMU);

    ReInfo->_reTimeMult = 1.0;
    s->currentTime = (raceCountdown > 0.0 ? -raceCountdown : sdSessionStartClock());
    ReInfo->_reLastRobTime = s->currentTime - RCM_MAX_DT_ROBOTS;
    s->deltaTime = RCM_MAX_DT_SIMU;
    s->_raceState = RM_RACE_STARTING;
    ReInfo->_reRunning = 1;
    ReInfo->_reCurTime = clockNow - RCM_MAX_DT_SIMU;
}

static void fillFrame()
{
    tCarElt *car = ReInfo->s->cars[0];
    frame[SD_TIME] = ReInfo->s->currentTime;
    for (int i = 0; i < 4; i++)
        for (int j = 0; j < 4; j++)
            frame[SD_POSMAT + i * 4 + j] = car->_posMat[i][j];
    for (int i = 0; i < 4; i++)
    {
        double *w = &frame[SD_WHEELS + i * 7];
        w[0] = car->priv.wheel[i].relPos.x;
        w[1] = car->priv.wheel[i].relPos.y;
        w[2] = car->priv.wheel[i].relPos.z;
        w[3] = car->priv.wheel[i].relPos.ax;
        w[4] = car->priv.wheel[i].relPos.ay;
        w[5] = car->priv.wheel[i].relPos.az;
        w[6] = car->_wheelSpinVel(i);
    }
    frame[SD_SPEED] = car->_speed_x;
    frame[SD_RPM] = car->_enginerpm;
    frame[SD_RPM_REDLINE] = car->_enginerpmRedLine;
    frame[SD_GEAR] = car->_gear;
    frame[SD_LAPS] = car->_laps;
    frame[SD_CUR_LAP_TIME] = car->_curLapTime;
    frame[SD_LAST_LAP_TIME] = car->_lastLapTime;
    frame[SD_BEST_LAP_TIME] = car->_bestLapTime;
    frame[SD_DIST_FROM_START] = car->_distFromStartLine;
    frame[SD_TO_MIDDLE] = car->_trkPos.toMiddle;
    frame[SD_STEER] = car->_steerCmd;
    frame[SD_ACCEL] = car->_accelCmd;
    frame[SD_BRAKE] = car->_brakeCmd;
    frame[SD_RACE_STATE] = ReInfo->s->_raceState;
    frame[SD_DAMMAGE] = car->_dammage;
    sdCameraUpdate(car, ReInfo->s, &frame[SD_CAMERA]);
    for (int i = 0; i < 4; i++)
        frame[SD_BRAKE_TEMP + i] = car->_brakeTemp(i);
}

static bool initGf()
{
    static bool ready = false;
    if (ready)
        return true;
    GfInit(true);
    GfLogSetLevelThreshold(GfLogger::eWarning);
    GfSetDataDir("/sd/data/");
    GfSetLocalDir("/sd/local/");
    GfSetLibDir("/sd/lib/");
    GfSetBinDir("/sd/bin/");
    if (chdir(GfDataDir()))
        return false;
    ready = true;
    return true;
}

static void *mergedCarHandle(const char *carName)
{
    char buf[256];
    snprintf(buf, sizeof(buf), "cars/models/%s/%s.xml", carName, carName);
    void *carhdle = GfParmReadFileBoth(buf, GFPARM_RMODE_STD);
    if (!carhdle)
        return nullptr;
    const char *category = GfParmGetStr(carhdle, SECT_CAR, PRM_CATEGORY, NULL);
    snprintf(buf, sizeof(buf), "cars/categories/%s.xml", category);
    void *cathdle = GfParmReadFile(buf, GFPARM_RMODE_STD | GFPARM_RMODE_CREAT);
    return GfParmMergeHandles(cathdle, carhdle, GFPARM_MMODE_SRC | GFPARM_MMODE_DST | GFPARM_MMODE_RELSRC | GFPARM_MMODE_RELDST);
}

int sdSurfaceClass(const tTrackSeg *seg)
{
    const char *material = seg && seg->surface ? seg->surface->material : nullptr;
    if (!material)
        return 0;
    if (strstr(material, "kerb") || strstr(material, "curb"))
        return 1;
    if (strstr(material, "grass"))
        return 2;
    if (strstr(material, "sand") || strstr(material, "gravel") || strstr(material, "dirt"))
        return 3;
    return 0;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void sdFieldClear()
{
    fieldEntries.clear();
    playerAutopilot = false;
    sdSessionClearPlans();
}

EMSCRIPTEN_KEEPALIVE void sdFieldAdd(const char *name, const char *code, const char *team, int teamIndex, int seat, int slot, double pace, double racePace, double racecraft)
{
    fieldEntries.push_back({name, code, team, teamIndex, seat, slot, pace, racePace, racecraft});
}

EMSCRIPTEN_KEEPALIVE void sdFieldPlayer(int teamIndex, int seat, int slot)
{
    playerEntry.teamIndex = teamIndex;
    playerEntry.seat = seat;
    playerEntry.slot = slot;
}

EMSCRIPTEN_KEEPALIVE void sdFieldAutopilot(int on)
{
    playerAutopilot = on != 0;
    if (playerAutopilot && ReInfo && sdFieldActive() && ReInfo->s->currentTime > 0)
        sdAiTakeOver(0);
}

EMSCRIPTEN_KEEPALIVE double sdFieldPlayerBox()
{
    double distance = 0, lateral = 0;
    sdAiBoxOf(sdFieldBay(playerEntry.teamIndex, playerEntry.seat), &distance, &lateral);
    return distance;
}

EMSCRIPTEN_KEEPALIVE int sdFieldCount()
{
    return (int)fieldEntries.size() + 1;
}

EMSCRIPTEN_KEEPALIVE void sdCars(double *out)
{
    tSituation *s = ReInfo->s;
    for (int i = 0; i < s->_ncars; i++)
    {
        tCarElt *car = s->cars[i];
        double *c = &out[i * SD_CAR_STRIDE];
        for (int a = 0; a < 4; a++)
            for (int b = 0; b < 4; b++)
                c[a * 4 + b] = car->_posMat[a][b];
        for (int w = 0; w < 4; w++)
        {
            double *wheel = &c[16 + w * 6];
            wheel[0] = car->priv.wheel[w].relPos.x;
            wheel[1] = car->priv.wheel[w].relPos.y;
            wheel[2] = car->priv.wheel[w].relPos.z;
            wheel[3] = car->priv.wheel[w].relPos.ax;
            wheel[4] = car->priv.wheel[w].relPos.ay;
            wheel[5] = car->priv.wheel[w].relPos.az;
        }
        c[40] = car->_speed_x;
        c[41] = car->_steerCmd;
        c[42] = car->_brakeCmd;
        c[43] = car->_enginerpm;
        c[44] = car->_gear;
        c[45] = sdTyresCompound(i);
        c[46] = sdSessionCarVisible(i) ? 1 : 0;
        c[47] = car->_trkPos.toMiddle;
        c[48] = car->_distFromStartLine;
    }
}

EMSCRIPTEN_KEEPALIVE void sdTimeScale(double scale)
{
    ReInfo->_reTimeMult = 1.0 / std::max(1.0, scale);
}

EMSCRIPTEN_KEEPALIVE void sdRaceCountdown(double seconds)
{
    raceCountdown = seconds;
}

EMSCRIPTEN_KEEPALIVE int sdInit(const char *trackCategory, const char *trackName, const char *raceFile, const char *carOverride, double now)
{
    clockNow = now;
    if (!initGf())
        return -10;

    int carCount = 1 + (int)fieldEntries.size();
    carInfo.assign(carCount, tReCarInfo());
    ReInfo = (tRmInfo *)calloc(1, sizeof(tRmInfo));
    ReInfo->s = &situation;
    ReInfo->carList = (tCarElt *)calloc(carCount, sizeof(tCarElt));
    ReInfo->_reCarInfo = carInfo.data();
    ReInfo->params = GfParmReadFileBoth(raceFile, GFPARM_RMODE_STD);
    ReInfo->mainParams = ReInfo->params;
    ReInfo->_reRaceName = "Quick Race";
    ReInfo->_displayMode = RM_DISP_MODE_NORMAL;

    char buf[256];
    snprintf(buf, sizeof(buf), "tracks/%s/%s/%s.%s", trackCategory, trackName, trackName, TRKEXT);
    ReInfo->track = TrackBuildv1(buf);
    if (!ReInfo->track)
        return -1;
    sdInitWeather();

    tSituation *s = ReInfo->s;
    s->_ncars = carCount;
    s->cars = (tCarElt **)calloc(carCount, sizeof(tCarElt *));
    for (int i = 0; i < carCount; i++)
        s->cars[i] = &ReInfo->carList[i];
    damageLimit = (int)GfParmGetNum(ReInfo->params, ReInfo->_reRaceName, RM_ATTR_MAX_DMG, NULL, 10000);
    s->_maxDammage = 0;
    s->_raceType = RM_TYPE_RACE;
    s->_totLaps = (int)GfParmGetNum(ReInfo->params, ReInfo->_reRaceName, RM_ATTR_LAPS, NULL, 3);
    s->_totTime = -60.0f;
    s->_raceState = 0;

    tModWelcomeIn welcomeIn;
    tModWelcomeOut welcomeOut;
    memset(&welcomeIn, 0, sizeof(welcomeIn));
    memset(&welcomeOut, 0, sizeof(welcomeOut));
    welcomeIn.itfVerMajor = 1;
    welcomeIn.itfVerMinor = 0;
    welcomeIn.name = "human";
    sdInputConfigure();
    moduleWelcome(&welcomeIn, &welcomeOut);
    if (moduleInitialize(humanModInfo))
        return -2;

    void *robhdle = GfParmReadFileLocal("drivers/human/human.xml", GFPARM_RMODE_STD);
    snprintf(buf, sizeof(buf), "%s/%s/%d", ROB_SECT_ROBOTS, ROB_LIST_INDEX, humanModInfo[0].index);
    if (carOverride[0])
    {
        GfParmSetStr(robhdle, buf, ROB_ATTR_CAR, carOverride);
        GfParmWriteFile(NULL, robhdle, "human");
    }
    std::string carName = GfParmGetStr(robhdle, buf, ROB_ATTR_CAR, "22mp1-sector-mcl36");
    if (!loadHumanCar(carName.c_str()))
        return -3;
    for (int i = 1; i < carCount; i++)
        if (!loadAiCar(i, fieldEntries[i - 1], carName.c_str()))
            return -4;

    SimInit(s->_ncars, ReInfo->track);
    bool hasModel = sdAiLoadTrack(ReInfo->track);
    if (carCount > 1 && !hasModel)
        return -5;
    if (hasModel)
        sdAiReset(carCount);
    if (carCount > 1)
    {
        sdAiConfigure(0, 1.0, 1.0, 1.0, sdFieldBay(playerEntry.teamIndex, playerEntry.seat));
        for (int i = 1; i < carCount; i++)
        {
            const FieldEntry &entry = fieldEntries[i - 1];
            sdAiConfigure(i, entry.pace, entry.racePace, entry.racecraft, sdFieldBay(entry.teamIndex, entry.seat));
        }
        for (int i = 0; i < carCount; i++)
        {
            const FieldEntry &entry = i == 0 ? playerEntry : fieldEntries[i - 1];
            double distance = 0, lateral = 0, x = 0, y = 0, yaw = 0;
            bool grid = sdSessionStartPlace(i, entry.slot, sdFieldBay(entry.teamIndex, entry.seat), &distance, &lateral);
            if (grid && sdAiGridPose(entry.slot, &x, &y, &yaw))
                placeCarAt(s->cars[i], x, y, yaw, 0.2);
            else
                placeCar(s->cars[i], distance, lateral, 0.2);
            RePhysicsEngine().configureCar(s->cars[i]);
        }
    }
    else
    {
        double x = 0, y = 0, yaw = 0;
        if (hasModel && sdAiGridPose(practiceSlot, &x, &y, &yaw))
        {
            placeCarAt(s->cars[0], x, y, yaw, 0.2);
            RePhysicsEngine().configureCar(s->cars[0]);
        }
        else
            sdInitStartingGrid();
    }
    startRace();
    sdWeatherReset();
    for (int i = 0; i < carCount; i++)
    {
        sdTyresReset(s->cars[i]);
        sdEnergyReset(s->cars[i]);
        sdCarStatusReset(s->cars[i]);
    }
    sdSessionBegin(s);
    sdStewardsBegin(s, sdSessionKindOf(), sdSessionTotalLaps());
    sdRaceControlBegin(s, sdSessionKindOf());
    sdCameraReset();
    fillFrame();
    return 0;
}

EMSCRIPTEN_KEEPALIVE void sdPracticeGridSlot(int slot)
{
    practiceSlot = slot;
}

EMSCRIPTEN_KEEPALIVE void sdKey(int key, int state)
{
    sdKeyEvent(key, state);
}

EMSCRIPTEN_KEEPALIVE int sdUpdate(double now)
{
    clockNow = now;
    tRmInfo *pCurrReInfo = ReInfo;
    int steps = 0;
    if (now - pCurrReInfo->_reCurTime > RCM_MAX_DT_FRAME * 5)
        pCurrReInfo->_reCurTime = now - RCM_MAX_DT_FRAME * 5;
    while (pCurrReInfo->_reRunning && ((now - pCurrReInfo->_reCurTime) > RCM_MAX_DT_SIMU))
    {
        runOneStep(simuTick);
        steps++;
    }
    fillFrame();
    return steps;
}

EMSCRIPTEN_KEEPALIVE void sdResync(double now)
{
    clockNow = now;
    ReInfo->_reCurTime = now;
}

EMSCRIPTEN_KEEPALIVE int sdStep(int count)
{
    for (int i = 0; i < count; i++)
        runOneStep(simuTick);
    fillFrame();
    return count;
}

EMSCRIPTEN_KEEPALIVE double *sdFrame()
{
    return frame;
}

EMSCRIPTEN_KEEPALIVE void sdTelemetry(double *out)
{
    tCarElt *car = ReInfo->s->cars[0];
    out[0] = car->_speed_x;
    out[1] = car->_speed_y;
    out[2] = car->_yaw_rate;
    out[3] = car->_accel_x;
    out[4] = car->_accel_y;
    out[5] = car->_steerCmd;
    out[6] = car->_accelCmd;
    out[7] = car->_brakeCmd;
    for (int i = 0; i < 4; i++)
    {
        double *w = &out[8 + i * 6];
        w[0] = car->_wheelSlipSide(i);
        w[1] = car->_wheelSlipAccel(i);
        w[2] = car->_wheelFx(i);
        w[3] = car->_wheelFy(i);
        w[4] = car->_wheelFz(i);
        w[5] = car->priv.wheel[i].relPos.az;
    }
    sdInputState(&out[32]);
}

EMSCRIPTEN_KEEPALIVE void sdPitService(double fuel, int frontWing)
{
    tCarElt *car = ReInfo->s->cars[0];
    double repaired = frontWing ? sdCarStatusReplaceWing() : 0.0;
    car->pitcmd.fuel = (tdble)std::max(0.0, fuel - car->_fuel);
    car->pitcmd.repair = (tdble)(car->_dammage * repaired);
    car->pitcmd.tireChange = tCarPitCmd::ALL;
    car->pitcmd.tiresetChange = tCarPitCmd::NON_CHANGE;
    SimReConfig(car);
    sdStewardsNoteService(0);
    sdTyresService(0, sdPitCompound());
    car->pitcmd.fuel = 0;
    car->pitcmd.repair = 0;
    car->pitcmd.tireChange = tCarPitCmd::NONE;
}

EMSCRIPTEN_KEEPALIVE void sdAudio(double *out)
{
    tCarElt *car = ReInfo->s->cars[0];
    for (int i = 0; i < 4; i++)
    {
        double *w = &out[i * 5];
        w[0] = car->_skid[i];
        w[1] = car->_wheelSpinVel(i);
        w[2] = car->_wheelRadius(i);
        w[3] = sdSurfaceClass(car->_wheelSeg(i));
        w[4] = car->_wheelFz(i);
    }
    out[20] = car->_speed_xy;
    out[21] = car->priv.simcollision;
}

EMSCRIPTEN_KEEPALIVE double sdTrackLength()
{
    return ReInfo->track->length;
}

EMSCRIPTEN_KEEPALIVE void sdTrackInfo(double *out)
{
    tTrack *track = ReInfo->track;
    out[0] = track->local.timeofday;
    out[1] = track->local.sunascension;
    out[2] = track->local.rain;
    out[3] = track->local.visibility;
    out[4] = track->min.x;
    out[5] = track->min.y;
    out[6] = track->min.z;
    out[7] = track->max.x;
    out[8] = track->max.y;
    out[9] = track->max.z;
}

EMSCRIPTEN_KEEPALIVE void sdCarInfo(double *out)
{
    tCarElt *car = ReInfo->s->cars[0];
    for (int i = 0; i < 4; i++)
    {
        out[i * 3] = car->_rimRadius(i) + car->_tireHeight(i);
        out[i * 3 + 1] = car->_tireWidth(i);
        out[i * 3 + 2] = car->_brakeDiskRadius(i);
    }
    void *handle = car->_carHandle;
    char path[256];
    out[12] = GfParmGetNum(handle, SECT_STEER, PRM_STEERROT, NULL, 2.0) / 2.0;
    snprintf(path, sizeof(path), "%s/%s", SECT_GROBJECTS, SECT_STEERWHEEL);
    out[13] = GfParmGetNum(handle, path, PRM_XPOS, NULL, 0.0);
    out[14] = GfParmGetNum(handle, path, PRM_YPOS, NULL, 0.0);
    out[15] = GfParmGetNum(handle, path, PRM_ZPOS, NULL, 0.0);
    out[16] = GfParmGetNum(handle, path, PRM_SW_ANGLE, NULL, 0.0);
    snprintf(path, sizeof(path), "%s/%s/%d", SECT_GROBJECTS, LST_DRIVER, 1);
    out[17] = GfParmGetNum(handle, path, PRM_XPOS, NULL, 0.0);
    out[18] = GfParmGetNum(handle, path, PRM_YPOS, NULL, 0.0);
    out[19] = GfParmGetNum(handle, path, PRM_ZPOS, NULL, 0.0);

    snprintf(path, sizeof(path), "%s/%s", SECT_GROBJECTS, SECT_SPEEDOMETERNEEDLE);
    tdble speedometerMinAngle = -GfParmGetNum(handle, path, PRM_SMN_MIN_ANGLE, "deg",
                                              GfParmGetNum(handle, SECT_GROBJECTS, PRM_SPEEDO_MINANG, "deg", 225.f * 180.f / PI)) * PI / 180.f;
    tdble speedometerMaxAngle = -GfParmGetNum(handle, path, PRM_SMN_MAX_ANGLE, "deg",
                                              GfParmGetNum(handle, SECT_GROBJECTS, PRM_SPEEDO_MAXANG, "deg", -45.f * 180.f / PI)) * PI / 180.f;
    tdble speedometerMinValue = GfParmGetNum(handle, SECT_GROBJECTS, PRM_SPEEDO_MINVAL, (char*)NULL, 0);
    tdble speedometerMaxValue = GfParmGetNum(handle, SECT_GROBJECTS, PRM_SPEEDO_MAXVAL, (char*)NULL, 100);
    out[20] = GfParmGetNum(handle, path, PRM_XPOS, NULL, 0.0);
    out[21] = GfParmGetNum(handle, path, PRM_YPOS, NULL, 0.0);
    out[22] = GfParmGetNum(handle, path, PRM_ZPOS, NULL, 0.0);
    out[23] = GfParmGetNum(handle, path, PRM_SMN_ANGLE, NULL, 0.0);
    out[24] = speedometerMinAngle;
    out[25] = (speedometerMaxAngle - speedometerMinAngle) / (speedometerMaxValue - speedometerMinValue);

    snprintf(path, sizeof(path), "%s/%s", SECT_GROBJECTS, SECT_TACHOMETERNEEDLE);
    tdble tachometerMinAngle = -GfParmGetNum(handle, path, PRM_TMN_MIN_ANGLE, "deg",
                                             GfParmGetNum(handle, SECT_GROBJECTS, PRM_TACHO_MINANG, "deg", 225.f * 180.f / PI)) * PI / 180.f;
    tdble tachometerMaxAngle = -GfParmGetNum(handle, path, PRM_TMN_MAX_ANGLE, "deg",
                                             GfParmGetNum(handle, SECT_GROBJECTS, PRM_TACHO_MAXANG, "deg", -45.f * 180.f / PI)) * PI / 180.f;
    tdble tachometerMinValue = GfParmGetNum(handle, SECT_GROBJECTS, PRM_TACHO_MINVAL, (char*)NULL, 0);
    tdble tachometerMaxValue = GfParmGetNum(handle, SECT_GROBJECTS, PRM_TACHO_MAXVAL, (char*)NULL, RPM2RADS(10000));
    out[26] = GfParmGetNum(handle, path, PRM_XPOS, NULL, 0.0);
    out[27] = GfParmGetNum(handle, path, PRM_YPOS, NULL, 0.0);
    out[28] = GfParmGetNum(handle, path, PRM_ZPOS, NULL, 0.0);
    out[29] = GfParmGetNum(handle, path, PRM_TMN_ANGLE, NULL, 0.0);
    out[30] = tachometerMinAngle;
    out[31] = (tachometerMaxAngle - tachometerMinAngle) / (tachometerMaxValue - tachometerMinValue);
}

EMSCRIPTEN_KEEPALIVE const char *sdCarParamStr(const char *path, const char *key)
{
    return GfParmGetStr(ReInfo->s->cars[0]->_carHandle, path, key, "");
}

EMSCRIPTEN_KEEPALIVE double sdCarParamNum(const char *path, const char *key, double def)
{
    return GfParmGetNum(ReInfo->s->cars[0]->_carHandle, path, key, NULL, (tdble)def);
}

EMSCRIPTEN_KEEPALIVE int sdCarParamCount(const char *path)
{
    return GfParmGetEltNb(ReInfo->s->cars[0]->_carHandle, path);
}

EMSCRIPTEN_KEEPALIVE const char *sdCarName()
{
    return ReInfo->s->cars[0]->_carName;
}

EMSCRIPTEN_KEEPALIVE int sdCarLimits(const char *carName, const char *path, const char *key, const char *unit, double *out)
{
    static char cached[256] = "";
    static void *handle = nullptr;
    if (!initGf())
        return 0;
    if (strcmp(cached, carName) != 0)
    {
        if (handle)
            GfParmReleaseHandle(handle);
        handle = mergedCarHandle(carName);
        strncpy(cached, carName, sizeof(cached) - 1);
    }
    if (!handle || !GfParmExistsParam(handle, path, key))
        return 0;
    tdble value = 0, min = 0, max = 0;
    GfParmGetNumWithLimits(handle, path, key, unit[0] ? unit : NULL, &value, &min, &max);
    out[0] = value;
    out[1] = min;
    out[2] = max;
    return 1;
}

EMSCRIPTEN_KEEPALIVE void sdHudInfo(double *out)
{
    tCarElt *car = ReInfo->s->cars[0];
    out[0] = car->_fuel;
    out[1] = car->_tank;
    out[2] = car->_dammage;
    out[3] = damageLimit;
    out[4] = car->_state;
    out[5] = ReInfo->s->_totLaps;
    for (int i = 0; i < 4; i++)
    {
        out[6 + i] = car->_tyreT_mid(i);
        out[10 + i] = car->_tyreT_opt(i);
        out[14 + i] = car->_tyreCondition(i);
        out[18 + i] = car->_tyreTreadDepth(i);
    }
}

EMSCRIPTEN_KEEPALIVE int sdTrackSectors(double *out, int max)
{
    tTrack *track = ReInfo->track;
    int boundaries = track->numberOfSectors - 1;
    int count = boundaries < max ? boundaries : max;
    for (int i = 0; i < count; i++)
        out[i] = track->sectors[i];
    return count;
}

EMSCRIPTEN_KEEPALIVE int sdTrackLocal2Global(double toStart, double toMiddle, float *out)
{
    tTrackSeg *seg = ReInfo->track->seg->next;
    double d = fmod(toStart, ReInfo->track->length);
    if (d < 0)
        d += ReInfo->track->length;
    while (!(d >= seg->lgfromstart && d < seg->lgfromstart + seg->length))
    {
        seg = seg->next;
        if (seg == ReInfo->track->seg->next)
            return -1;
    }
    tTrkLocPos pos;
    pos.seg = seg;
    pos.type = TR_LPOS_MAIN;
    pos.toStart = (tdble)(d - seg->lgfromstart);
    if (seg->type != TR_STR)
        pos.toStart /= seg->radius;
    pos.toMiddle = (tdble)toMiddle;
    pos.toRight = seg->width / 2 + pos.toMiddle;
    pos.toLeft = seg->width / 2 - pos.toMiddle;
    tdble x, y;
    RtTrackLocal2Global(&pos, &x, &y, TR_TOMIDDLE);
    out[0] = x;
    out[1] = y;
    out[2] = RtTrackHeightL(&pos);
    return 0;
}

}

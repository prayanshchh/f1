#include <cmath>
#include <cstdlib>
#include <cstring>
#include <unistd.h>
#include <emscripten/emscripten.h>

#include <tgf.h>
#include <tgfclient.h>
#include <track.h>
#include <car.h>
#include <raceman.h>
#include <robot.h>
#include <robottools.h>

#include "game.h"

tRmInfo *ReInfo = nullptr;

extern tTrack *TrackBuildv1(const char *trackfile);
extern void SimInit(int nbcars, tTrack *track);
extern void SimConfig(tCarElt *carElt);
extern void SimUpdate(tSituation *s, double deltaTime);

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

static const char *aPszSkillLevelNames[] = ROB_VALS_LEVEL;
static const int NSkillLevels = (int)(sizeof(aPszSkillLevelNames) / sizeof(char *));

static tSituation situation;
static tReCarInfo carInfo[1];
static tModInfo humanModInfo[10];
static double frame[SD_FRAME_SIZE];
static double simuTick = RCM_MAX_DT_SIMU;
static double clockNow = 0.0;

static tCarElt *loadHumanCar(const char *carName)
{
    const int robotIdx = humanModInfo[0].index;
    tRobotItf *curRobot = (tRobotItf *)calloc(1, sizeof(tRobotItf));
    humanModInfo[0].fctInit(robotIdx, (void *)curRobot);

    char path[256];
    char buf[256];
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
    elt->_skillLevel = ARCADE;
    const char *str = GfParmGetStr(robhdle, path, ROB_ATTR_LEVEL, ROB_VAL_SEMI_PRO);
    for (int k = 0; k < NSkillLevels; k++)
    {
        if (strcmp(aPszSkillLevelNames[k], str) == 0)
        {
            elt->_skillLevel = static_cast<tSkillLevel>(k);
            break;
        }
    }
    elt->_startRank = 0;
    elt->_pos = 1;
    elt->_remainingLaps = ReInfo->s->_totLaps;

    snprintf(buf, sizeof(buf), "cars/models/%s/%s.xml", elt->_carName, elt->_carName);
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
    carhdle = GfParmMergeHandles(cathdle, carhdle,
                                 GFPARM_MMODE_SRC | GFPARM_MMODE_DST | GFPARM_MMODE_RELSRC | GFPARM_MMODE_RELDST);

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
    return elt;
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
                if (car->_laps > 1)
                {
                    car->_lastLapTime = s->currentTime - info->sTime;
                    if (car->_bestLapTime == 0 || car->_lastLapTime < car->_bestLapTime)
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
            pCurrReInfo->s->_raceState = RM_RACE_PRESTART;
    }
    else if (pCurrReInfo->s->_raceState == RM_RACE_PRESTART)
    {
        pCurrReInfo->s->_raceState = RM_RACE_RUNNING;
        s->currentTime = 0.0;
        pCurrReInfo->_reLastRobTime = 0.0;
    }

    s->accelTime = s->currentTime;

    if ((s->currentTime - pCurrReInfo->_reLastRobTime) >= RCM_MAX_DT_ROBOTS)
    {
        s->deltaTime = s->currentTime - pCurrReInfo->_reLastRobTime;
        sdInputUpdate(s->cars[0], s->deltaTime);
        for (int i = 0; i < s->_ncars; i++)
        {
            if ((s->cars[i]->_state & RM_CAR_STATE_NO_SIMU) == 0)
            {
                tRobotItf *robot = s->cars[i]->robot;
                robot->rbDrive(robot->index, s->cars[i], s);
            }
        }
        pCurrReInfo->_reLastRobTime = s->currentTime;
    }

    SimUpdate(s, deltaTimeIncrement);
    for (int i = 0; i < s->_ncars; i++)
        manageCar(s->cars[i]);
}

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
    ReInfo->_reLastRobTime = -1.0;
    s->currentTime = -2.0;
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

extern "C" {

EMSCRIPTEN_KEEPALIVE int sdInit(const char *trackCategory, const char *trackName, const char *raceFile, const char *carOverride, double now)
{
    clockNow = now;
    if (!initGf())
        return -10;

    ReInfo = (tRmInfo *)calloc(1, sizeof(tRmInfo));
    ReInfo->s = &situation;
    ReInfo->carList = (tCarElt *)calloc(1, sizeof(tCarElt));
    ReInfo->_reCarInfo = carInfo;
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
    s->_ncars = 1;
    s->cars = (tCarElt **)calloc(1, sizeof(tCarElt *));
    s->cars[0] = &ReInfo->carList[0];
    s->_maxDammage = (int)GfParmGetNum(ReInfo->params, ReInfo->_reRaceName, RM_ATTR_MAX_DMG, NULL, 10000);
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
    const char *carName = GfParmGetStr(robhdle, buf, ROB_ATTR_CAR, "sc-cavallo-360");
    if (!loadHumanCar(carName))
        return -3;

    SimInit(s->_ncars, ReInfo->track);
    sdInitStartingGrid();
    startRace();
    sdCameraReset();
    fillFrame();
    return 0;
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
    out[3] = ReInfo->s->_maxDammage;
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
    pos.toRight = seg->width / 2 - pos.toMiddle;
    pos.toLeft = seg->width / 2 + pos.toMiddle;
    tdble x, y;
    RtTrackLocal2Global(&pos, &x, &y, TR_TOMIDDLE);
    out[0] = x;
    out[1] = y;
    out[2] = RtTrackHeightL(&pos);
    return 0;
}

}

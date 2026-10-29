/***************************************************************************

    file        : racesituation.cpp
    copyright   : (C) 2010 by Jean-Philippe Meuret
    web         : www.speed-dreams.org

 ***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/

/** @file
            The central raceman data structure (situation + other race infos)
    @author	    Jean-Philippe Meuret
*/

#include <cstdlib>
#include <sstream>
#include <iomanip>

#ifdef THIRD_PARTY_SQLITE3
#include <sqlite3.h>
#endif

#include <portability.h>
#include <translation.h>
#ifdef CLIENT_SERVER
#include <csnetwork.h>
#else
#include <network.h>
#endif
#include <robot.h>
#include <raceman.h>
#include <replay.h>
#include <webserver.h>

#include "standardgame.h"

#include "racecars.h"
#include "racesituation.h"

#include "raceresults.h"
#include "racemessage.h"
#include "racenetwork.h"



// The singleton.
ReSituation* ReSituation::_pSelf = 0;

ReSituation& ReSituation::self()
{
    if (!_pSelf)
        _pSelf = new ReSituation;

    return *_pSelf;
}

ReSituation::ReSituation()
: _pMutex(0)
{
    // Allocate race engine info structures.
    _pReInfo = (tRmInfo*)calloc(1, sizeof(tRmInfo));
    _pReInfo->s = (tSituation*)calloc(1, sizeof(tSituation));

    // Singleton initialized.
    _pSelf = this;
}

ReSituation::~ReSituation()
{
    // Free ReInfo memory.
    if (_pReInfo->results)
    {
        if (_pReInfo->mainResults != _pReInfo->results)
            GfParmReleaseHandle(_pReInfo->mainResults);
        GfParmReleaseHandle(_pReInfo->results);
    }
    if (_pReInfo->_reParam)
        GfParmReleaseHandle(_pReInfo->_reParam);
    if (_pReInfo->params != _pReInfo->mainParams)
    {
        GfParmReleaseHandle(_pReInfo->params);
        _pReInfo->params = _pReInfo->mainParams;
    }
    // if (_pReInfo->movieCapture.outputBase)
    // 	free(_pReInfo->movieCapture.outputBase);
    free(_pReInfo->s);
    free(_pReInfo->carList);
    free(_pReInfo->rules);

    FREEZ(_pReInfo);

    // Prepare the singleton for next use.
    _pSelf = 0;
}

void ReSituation::terminate()
{
    delete _pSelf;
}

// TODO: Remove when safe accessors ready.
tRmInfo* ReSituation::data()
{
    return _pReInfo;
}

// Safe accessors.
void ReSituation::setDisplayMode(unsigned bfDispMode)
{
    _pReInfo->_displayMode = bfDispMode;
}

void ReSituation::accelerateTime(double fMultFactor)
{
    if (_pReInfo->_reTimeMult > 0.0)
        _pReInfo->_reTimeMult *= fMultFactor;
    else
        _pReInfo->_reTimeMult /= fMultFactor;

    if (fMultFactor == 0.0)
        _pReInfo->_reTimeMult = 1.0;
    else if (replayReplay) {
            // allow for the reversal of time on replays (note this is divider not multipler)
            if (_pReInfo->_reTimeMult > 4.0) {
                GfLogInfo("Reversing Time %f\n", _pReInfo->_reCurTime);
                _pReInfo->_reTimeMult = -4.0;
            } else if (_pReInfo->_reTimeMult < -4.0) {
                GfLogInfo("Correcting Time at %f\n", _pReInfo->_reCurTime);
                _pReInfo->_reTimeMult = 4.0;
            } else if (_pReInfo->_reTimeMult > -0.0625 && _pReInfo->_reTimeMult < 0.0)
                _pReInfo->_reTimeMult = -0.0625;
            else if (_pReInfo->_reTimeMult < 0.0625 && _pReInfo->_reTimeMult > 0.0)
                _pReInfo->_reTimeMult = 0.0625;
    } else if (_pReInfo->_reTimeMult > 64.0)
        _pReInfo->_reTimeMult = 64.0;
    else if (_pReInfo->_reTimeMult < 0.0625)
        _pReInfo->_reTimeMult = 0.0625;

    std::ostringstream ossTimeMult;
    const char *text = ReSituation::self().tr("time");
    ossTimeMult << text << " x" << std::setprecision(2) << 1.0 / _pReInfo->_reTimeMult;
    ReRaceMsgSet(_pReInfo, ossTimeMult.str().c_str(), 5);
}

const char *ReSituation::tr(const char *key) const
{
    std::string s = std::string("Translatable/") + key;

    return GfuiGetTranslatedText(_pReInfo->_reParam, s.c_str(), "text", "");
}

void ReSituation::setRaceMessage(const std::string& strMsg, double fLifeTime, bool bBig)
{
    if (bBig)
        ReRaceMsgSetBig(_pReInfo, strMsg.c_str(), fLifeTime);
    else
        ReRaceMsgSet(_pReInfo, strMsg.c_str(), fLifeTime);
}

void ReSituation::setPitCommand(int nCarIndex, const tCarPitCmd *pPitCmd)
{
    // Retrieve the car in situation with 'nCarIndex' index.
    //GfLogDebug("ReSituation::updateCarPitCmd(i=%d)\n", nCarIndex);
    tCarElt* pCurrCar = 0;
    for (int nCarInd = 0; nCarInd < _pReInfo->s->_ncars; nCarInd++)
    {
        if (_pReInfo->s->cars[nCarInd]->index == nCarIndex)
        {
            // Found : update its pit command information from pit menu data.
            pCurrCar = _pReInfo->s->cars[nCarInd];
            pCurrCar->_pitFuel = pPitCmd->fuel;
            pCurrCar->_pitRepair = pPitCmd->repair;
            pCurrCar->_pitStopType = pPitCmd->stopType;
            break;
        }
    }

    // Compute and set pit time.
    if (pCurrCar)
        ReCarsUpdateCarPitTime(pCurrCar);
    else
        GfLogError("Failed to retrieve car with index %d when computing pit time\n", nCarIndex);
}

// The race situation updater class ==================================================

// Index of the CPU to use for thread affinity if any and if there are at least 2 ones.
static const int NUserInterfaceCPUId = 0;
static const int NSituationUpdaterCPUId = 1;

void ReSituationUpdater::runOneStep(double deltaTimeIncrement)
{
    tRmInfo* pCurrReInfo = ReSituation::self().data();
    tSituation *s = pCurrReInfo->s;

    // Race messages life cycle management.
    ReRaceMsgManage(pCurrReInfo);

    if (NetGetNetwork())
    {
        // Resync clock in case computer falls behind
        if (s->currentTime < 0.0)
        {
            s->currentTime = GfTimeClock() - NetGetNetwork()->GetRaceStartTime();
        }
    }

    if (s->currentTime < -2.0)
    {
        std::ostringstream ossMsg;
        ossMsg << ReSituation::self().tr("racestart");
        ossMsg << ' ' << -(int)s->currentTime << ' ';
        ossMsg << ReSituation::self().tr("seconds");
        ReRaceMsgSetBig(pCurrReInfo, ossMsg.str().c_str());
    }

    //GfLogDebug("ReSituationUpdater::runOneStep: currTime=%.3f\n", s->currentTime);
    if (s->currentTime >= -2.0 && s->currentTime < deltaTimeIncrement - 2.0) {
        const char *text = ReSituation::self().tr("ready");
        ReRaceMsgSetBig(pCurrReInfo, text, 1.0);
        GfLogInfo("Ready.\n");
    } else if (s->currentTime >= -1.0 && s->currentTime < deltaTimeIncrement - 1.0) {
        const char *text = ReSituation::self().tr("set");
        ReRaceMsgSetBig(pCurrReInfo, text, 1.0);
        GfLogInfo("Set.\n");
    } else if (s->currentTime >= 0.0 && s->currentTime < deltaTimeIncrement) {
        const char *text = ReSituation::self().tr("go");
        ReRaceMsgSetBig(pCurrReInfo, text, 1.0);
        GfLogInfo("Go.\n");
    }

    // Update times.
    pCurrReInfo->_reCurTime += deltaTimeIncrement * fabs(pCurrReInfo->_reTimeMult); /* "Real" time */

    if (pCurrReInfo->_reTimeMult > 0)
        s->currentTime += deltaTimeIncrement;
    else
        s->currentTime -= deltaTimeIncrement;

    if (s->currentTime < 0) {
        if (pCurrReInfo->_reTimeMult < 0)
            /* Revert to forward time x1 */
            pCurrReInfo->_reTimeMult = 1;
        else
            /* no simu yet */
            pCurrReInfo->s->_raceState = RM_RACE_PRESTART;
    } else if (pCurrReInfo->s->_raceState == RM_RACE_PRESTART) {
        pCurrReInfo->s->_raceState = RM_RACE_RUNNING;
        s->currentTime = 0.0; /* resynchronize */
        pCurrReInfo->_reLastRobTime = 0.0;
    }

    tTrackLocalInfo *trackLocal = &ReInfo->track->local;
    if (s->currentTime > 0 && trackLocal->timeofdayindex == 9) { //RM_VAL_TIME_24HR
        if (s->_totTime > 0) {
            // Scaled on Total Time
            s->accelTime = 24 * 3600 * s->currentTime / s->_totTime;
        } else {
            // Scaled on Number of Laps that the lead driver has completed
            if (s->cars[0]->_laps > 0 && s->cars[0]->_laps <= s->_totLaps) {
                // prevent issues if lead driver crosses line the wrong way
                if (pCurrReInfo->raceEngineInfo.carInfo->lapFlag)
                    s->accelTime = s->cars[0]->_laps - 1;
                else
                    s->accelTime = s->cars[0]->_laps - 1 + (s->cars[0]->_distFromStartLine / pCurrReInfo->track->length);

                s->accelTime = 24 * 3600 * s->accelTime / s->_totLaps;
            } else
                s->accelTime = 0;
        }
    } else
        s->accelTime = s->currentTime;

    GfProfStartProfile("rbDrive*");
    GfSchedBeginEvent("raceupdate", "robots");
    if ((s->currentTime - pCurrReInfo->_reLastRobTime) >= RCM_MAX_DT_ROBOTS) {
        s->deltaTime = s->currentTime - pCurrReInfo->_reLastRobTime;
        tRobotItf *robot;
        for (int i = 0; i < s->_ncars; i++) {
            if ((s->cars[i]->_state & RM_CAR_STATE_NO_SIMU) == 0) {
                robot = s->cars[i]->robot;
                if (replayReplay == 0)
                    robot->rbDrive(robot->index, s->cars[i], s);
            }
            else if (! (s->cars[i]->_state & RM_CAR_STATE_ENDRACE_CALLED ) && ( s->cars[i]->_state & RM_CAR_STATE_OUT ) == RM_CAR_STATE_OUT )
            { // No simu, look if it is out
                robot = s->cars[i]->robot;
                if (robot->rbEndRace)
                    robot->rbEndRace(robot->index, s->cars[i], s);
                s->cars[i]->_state |= RM_CAR_STATE_ENDRACE_CALLED;
            }
        }
        pCurrReInfo->_reLastRobTime = s->currentTime;
    }
    GfSchedEndEvent("raceupdate", "robots");
    GfProfStopProfile("rbDrive*");


    if (NetGetNetwork())
        ReNetworkOneStep();

    GfProfStartProfile("physicsEngine.update*");
    GfSchedBeginEvent("raceupdate", "physics");
    RePhysicsEngine().updateSituation(s, deltaTimeIncrement);
    bool bestLapChanged = false;
    for (int i = 0; i < s->_ncars; i++)
        ReCarsManageCar(s->cars[i], bestLapChanged, deltaTimeIncrement);

    GfSchedEndEvent("raceupdate", "physics");
    GfProfStopProfile("physicsEngine.update*");

    ReCarsSortCars();

    // Update results if a best lap changed
    if (pCurrReInfo->_displayMode == RM_DISP_MODE_NONE && s->_ncars > 1 && bestLapChanged)
    {
        if (pCurrReInfo->s->_raceType == RM_TYPE_PRACTICE)
            ReUpdatePracticeCurRes(pCurrReInfo->s->cars[0]);
        else if (pCurrReInfo->s->_raceType == RM_TYPE_QUALIF)
            ReUpdateQualifCurRes(pCurrReInfo->s->cars[0]);
    }

    if (replayRecord && pCurrReInfo->s->currentTime >= replayTimestamp) {
        replaySituation(pCurrReInfo);
    }

    webServer().updateAsyncStatus();
}

void ReSituationUpdater::onCfgApply(void *args)
{
    ReSituationUpdater *u = static_cast<ReSituationUpdater *>(args);
    tRmInfo* pCurrReInfo = ReSituation::self().data();
    tSituation *s = pCurrReInfo->s;

    for (tCarElt *car : u->_humans)
        RePhysicsEngine().reconfigureCar(car);

    RePhysicsEngine().updateSituation(s, RCM_MAX_DT_SIMU);
}

ReSituationUpdater::ReSituationUpdater()
:
    _pPrevReInfo(0),
    _fSimuTick(RCM_MAX_DT_SIMU),
    _fOutputTick(0),
    _fLastOutputTime(0),
    _applyHook(GfuiHookCreate(this, onCfgApply))
{
    // Save the race engine info (state + situation) pointer for the current step.
    tRmInfo* pCurrReInfo = ReSituation::self().data();
    _nInitDrivers = pCurrReInfo->s->_ncars;
}

ReSituationUpdater::~ReSituationUpdater()
{
    terminate(); // In case not already done.
}

void ReSituationUpdater::start()
{
    tSituation *s = ReInfo->s;
    std::vector<tCarElt *> humans;

    GfLogInfo("Starting race engine.\n");

    // Allow robots to run their start function
    for (int i = 0; i < s->_ncars; i++) {
        tRobotItf *robot = s->cars[i]->robot;
        if (robot->rbResumeRace)
            robot->rbResumeRace(robot->index, s->cars[i], s);

        if (s->cars[i]->_driverType == RM_DRV_HUMAN)
            humans.push_back(s->cars[i]);
    }

    // This function is called twice on a race start, so avoid addHumanCfg
    // from being called twice.
    if (!humans.empty() && _humans.empty())
    {
        ReUI().addHumanCfg(humans, _applyHook);
        _humans = humans;
    }

    // Set the running flags.
    ReSituation::self().data()->_reRunning = 1;
    ReSituation::self().data()->s->_raceState &= ~RM_RACE_PAUSED;
    ReSituation::self().data()->_reState = RE_STATE_RACE;

    // Resynchronize simulation time.
    ReSituation::self().data()->_reCurTime = GfTimeClock() - RCM_MAX_DT_SIMU;
}

void ReSituationUpdater::stop()
{
    tSituation *s = ReInfo->s;

    GfLogInfo("Stopping race engine.\n");

    // Allow robots to run their stop function
    for (int i = 0; i < s->_ncars; i++) {
        tRobotItf *robot = s->cars[i]->robot;
        if (robot->rbPauseRace)
            robot->rbPauseRace(robot->index, s->cars[i], s);
    }

    // Reset the running flags.
    ReSituation::self().data()->_reRunning = 0;
    ReSituation::self().data()->s->_raceState |= RM_RACE_PAUSED;
}

int ReSituationUpdater::terminate()
{
    int status = 0;

    GfLogInfo("Terminating situation updater.\n");

    /* need to ensure the last record gets writeen */
    tRmInfo* pCurrReInfo = ReSituation::self().data();
    if (replayRecord) {
        replaySituation(pCurrReInfo);
        GfLogInfo("Last replay entry done.\n");
    }

    GfuiHookRelease(_applyHook);
    return status;
}

void ReSituationUpdater::replaySituation(tRmInfo*& pSource)
{
#ifdef THIRD_PARTY_SQLITE3
    char command[200];
    int result;

    tReplayElt dummyTarget;
    tReplayElt* pTgtCar;
    tCarElt* pSrcCar;

    if (!replayDB) return;

    // Do everything in 1 transaction for speed
    sqlite3_exec(replayDB, "BEGIN TRANSACTION", NULL, NULL, NULL);

    for (int nCarInd = 0; nCarInd < _nInitDrivers; nCarInd++)
    {
        pTgtCar = &dummyTarget;
        pSrcCar = &pSource->carList[nCarInd];

        // Assemble the data we record
        pTgtCar->currentTime = pSource->s->currentTime;

        memcpy(&pTgtCar->info, &pSrcCar->info, sizeof(tInitCar));
        memcpy(&pTgtCar->pub, &pSrcCar->pub, sizeof(tPublicCar));
        memcpy(&pTgtCar->race, &pSrcCar->race, sizeof(tCarRaceInfo));
        memcpy(&pTgtCar->priv, &pSrcCar->priv, sizeof(tPrivCar));
        memcpy(&pTgtCar->ctrl, &pSrcCar->ctrl, sizeof(tCarCtrl));
        memcpy(&pTgtCar->pitcmd, &pSrcCar->pitcmd, sizeof(tCarPitCmd));

        // and write to database
        snprintf(command, sizeof(command), "INSERT INTO car%d (timestamp, lap, datablob) VALUES (%f, %d, ?)", nCarInd,
            pSource->s->currentTime, pSrcCar->_laps);

        result = sqlite3_prepare_v2(replayDB, command, -1, &replayBlobs[nCarInd], 0);
        if (result) {
            GfLogInfo("Replay: Unable to instert into table car%d: %s\n", nCarInd, sqlite3_errmsg(replayDB));
        } else {
            /* push binary blob into database */
            result = sqlite3_bind_blob(replayBlobs[nCarInd], 1, (void *) &dummyTarget, sizeof(dummyTarget), SQLITE_STATIC);
            result = sqlite3_step(replayBlobs[nCarInd]);
        }
        //GfLogInfo("Replay wrote car%d = time %f, lap %d\n", nCarInd, pSource->s->currentTime, pSrcCar->_laps);
    }

    sqlite3_exec(replayDB, "END TRANSACTION", NULL, NULL, NULL);
    replayTimestamp = pSource->s->currentTime + (1/(float)replayRecord);
#endif
}

void ReSituationUpdater::ghostcarSituation(tRmInfo*& pTarget)
{
#ifdef THIRD_PARTY_SQLITE3
    tCarElt *pTgtCar;
    tReplayElt *pSrcCar, *pSrc2Car;
    int result;

    if (!replayDB) return;

    if (ghostcarActive) {
        if (pTarget->s->currentTime - ghostcarTimeOffset >= nextGhostcarData.currentTime) {
            result = sqlite3_step(ghostcarBlob);
            if (result == SQLITE_ROW) {
                curGhostcarData = nextGhostcarData;
                memcpy(&nextGhostcarData, sqlite3_column_blob(ghostcarBlob, 0), sizeof(tReplayElt));
            } else {
                // don't do anything untill next lap is started
                // GfLogInfo("Ghostcar completed lap\n");
                ghostcarActive = 0;
                return;
            }

            // Ghostcar uses the last carElt
            pTgtCar = &pTarget->carList[_nInitDrivers];
            pSrcCar = &curGhostcarData;

            // GfLogInfo("Read ghostcar data: time %f %f, lap %d\n", pTarget->s->currentTime, pSrcCar->currentTime, pSrcCar->_laps);

            // Really this should only be read once at start of race
            memcpy(&pTgtCar->race, &pSrcCar->race, sizeof(tCarRaceInfo));
            pTgtCar->race.pit = NULL;

            // hack to fix trkpos
            pSrcCar->pub.trkPos = pTgtCar->pub.trkPos;

            memcpy(&pTgtCar->pub, &pSrcCar->pub, sizeof(tPublicCar));
            memcpy(&pTgtCar->info, &pSrcCar->info, sizeof(tInitCar));

            for(int i=0; i < 4; i++) {
                pTgtCar->priv.wheel[i] = pSrcCar->priv.wheel[i];
                pTgtCar->priv.wheel[i].seg = NULL;
            }
            pTgtCar->priv.gear = pSrcCar->priv.gear;
            pTgtCar->priv.fuel = pSrcCar->priv.fuel;
            pTgtCar->priv.enginerpm = pSrcCar->priv.enginerpm;
            pTgtCar->priv.dammage = pSrcCar->priv.dammage;
        }

        if (pTarget->s->currentTime - ghostcarTimeOffset < nextGhostcarData.currentTime) {
            // Interpolate position in between records
            double timeFrac;
            double yaw, roll, pitch;

            pTgtCar = &pTarget->carList[_nInitDrivers];
            pSrcCar = &curGhostcarData;
            pSrc2Car = &nextGhostcarData;

            timeFrac = (pTarget->s->currentTime - ghostcarTimeOffset - curGhostcarData.currentTime) /
                    (nextGhostcarData.currentTime - curGhostcarData.currentTime);

            pTgtCar->_pos_X = pSrcCar->_pos_X + (pSrc2Car->_pos_X - pSrcCar->_pos_X) * timeFrac;
            pTgtCar->_pos_Y = pSrcCar->_pos_Y + (pSrc2Car->_pos_Y - pSrcCar->_pos_Y) * timeFrac;
            pTgtCar->_pos_Z = pSrcCar->_pos_Z + (pSrc2Car->_pos_Z - pSrcCar->_pos_Z) * timeFrac - pTgtCar->_statGC_z;

            yaw = pSrc2Car->_yaw;
            roll = pSrc2Car->_roll;
            pitch = pSrc2Car->_pitch;

            // assumes that these can't change at high rate
            if (yaw < pSrcCar->_yaw - PI)
                yaw += 2 * PI;
            else if (yaw > pSrcCar->_yaw + PI)
                yaw -= 2 * PI;

            if (roll < pSrcCar->_roll - PI)
                roll += 2 * PI;
            else if (roll > pSrcCar->_roll + PI)
                roll -= 2 * PI;

            if (pitch < pSrcCar->_pitch - PI)
                pitch += 2 * PI;
            else if (pitch > pSrcCar->_pitch + PI)
                pitch -= 2 * PI;

            pTgtCar->_yaw = pSrcCar->_yaw + (yaw - pSrcCar->_yaw) * timeFrac;
            pTgtCar->_roll = pSrcCar->_roll + (roll - pSrcCar->_roll) * timeFrac;
            pTgtCar->_pitch = pSrcCar->_pitch + (pitch - pSrcCar->_pitch) * timeFrac;

            sgMakeCoordMat4(pTgtCar->pub.posMat, pTgtCar->_pos_X, pTgtCar->_pos_Y, pTgtCar->_pos_Z,
                    (tdble) RAD2DEG(pTgtCar->_yaw), (tdble) RAD2DEG(pTgtCar->_roll),
                    (tdble) RAD2DEG(pTgtCar->_pitch));
        }
    }
#endif
}

void ReSituationUpdater::freezSituation(tRmInfo*& pSituation)
{
    if (pSituation)
    {
        // carList
        if (pSituation->carList)
        {
            for (int nCarInd = 0; nCarInd < _nInitDrivers; nCarInd++)
            {
                tCarElt* pTgtCar = &pSituation->carList[nCarInd];

                tCarPenalty *penalty;
                while ((penalty = GF_TAILQ_FIRST(&(pTgtCar->_penaltyList)))
                       != GF_TAILQ_END(&(pTgtCar->_penaltyList)))
                {
                    GF_TAILQ_REMOVE (&(pTgtCar->_penaltyList), penalty, link);
                    free(penalty);
                }
                free(pTgtCar->_curSplitTime);
                free(pTgtCar->_bestSplitTime);
            }

            free(pSituation->carList);
        }

        // s
        if (pSituation->s)
        {
            if (pSituation->s->cars)
                free(pSituation->s->cars);
            free(pSituation->s);
        }

        // rules
        if (pSituation->rules)
            free(pSituation->rules);

        // raceEngineInfo
        if (pSituation->_reMessage)
            free(pSituation->_reMessage);
        if (pSituation->_reBigMessage)
            free(pSituation->_reBigMessage);
        if (pSituation->_reCarInfo)
            free(pSituation->_reCarInfo);

        free(pSituation);
        pSituation = 0;
    }
}

void ReSituationUpdater::acknowledgeEvents()
{
    tRmInfo* pCurrReInfo = ReSituation::self().data();

    // Acknowlegde collision events for each car.
    for (int nCarInd = 0; nCarInd < pCurrReInfo->s->_ncars; nCarInd++)
    {
        tCarElt* pCar = pCurrReInfo->s->cars[nCarInd];

        //if (pCar->priv.collision)
        //	GfLogDebug("Reset collision state of car #%d (was 0x%X)\n",
        //			   nCarInd, pCar->priv.collision);
        pCar->priv.collision = 0;

        // Note: This one is only for SimuV3, and not yet used actually
        // (WIP on collision code issues ; see simuv3/collide.cpp).
        pCar->priv.collision_state.collision_count = 0;
    }

    // Acknowlegde human pit event if any (update the car pit command in current situation
    // with the one modified by the Pit menu in previous situation).
    if (_pPrevReInfo && _pPrevReInfo->_rePitRequester)
    {
        //GfLogDebug("ReSituationAcknowlegdeEvents: Pit menu request cleared.\n");
        pCurrReInfo->_rePitRequester = 0;
    }
}

tRmInfo* ReSituationUpdater::getPreviousStep()
{
    // No multi-threading : no need to really copy.
    _pPrevReInfo = ReSituation::self().data();

    // Acknowledge the collision and human pit events occurred
    // since the last graphics update : we know now that they all have been processed
    // or at least being processed by the graphics engine / menu system
    // (the main thread's job).
    acknowledgeEvents();

    if (replayRecord && _pPrevReInfo->s->currentTime >= replayTimestamp) {
        replaySituation(_pPrevReInfo);
    }

    if (replayRecord)
        ghostcarSituation(_pPrevReInfo);

    return _pPrevReInfo;
}

// This member function decorates the situation updater as a normal function,
// thus hiding the possible separate thread behind to the main updater.
void ReSituationUpdater::computeCurrentStep()
{
    GfProfStartProfile("reOneStep*");

    tRmInfo* pCurrReInfo = ReSituation::self().data();

    // Stable but slowed-down frame rate mode.
    if (_fOutputTick > 0)
    {
        while ((pCurrReInfo->_reCurTime - _fLastOutputTime) < _fOutputTick)

            runOneStep(_fSimuTick);

        _fLastOutputTime = pCurrReInfo->_reCurTime;
    }

    // Real-time but variable frame rate mode.
    else
    {
        const double t = GfTimeClock();

        while (pCurrReInfo->_reRunning && ((t - pCurrReInfo->_reCurTime) > RCM_MAX_DT_SIMU))
            runOneStep(_fSimuTick);
    }

    GfProfStopProfile("reOneStep*");

    // Send car physics to network if needed
    if (NetGetNetwork())
        NetGetNetwork()->SendCarControlsPacket(pCurrReInfo->s);
}

bool ReSituationUpdater::setSchedulingSpecs(double fSimuRate, double fOutputRate)
{
    // Can't output faster than the simu, even in non-real time !
    if (fOutputRate > fSimuRate)
        fOutputRate = fSimuRate;

    if (fOutputRate > 0)
    {
        _fOutputTick = 1.0 / fOutputRate;
        _fLastOutputTime = GfTimeClock() - _fOutputTick;
    }
    else
        _fOutputTick = 0;

    _fSimuTick = 1.0 / fSimuRate;

    return true;
}

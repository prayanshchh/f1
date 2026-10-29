/***************************************************************************

    file                 : engine.cpp
    created              : Sun Mar 19 00:06:55 CET 2000
    copyright            : (C) 2000 by Eric Espie
    email                : torcs@free.fr

***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/

#include "sim.h"

float enginePressure;
double engineCoefficient;

void
SimEngineConfig(tCar *car)
{
    void	*hdle = car->params;
    int		i;
    tdble	maxTq;
    tdble	rpmMaxTq = 0;
    char	idx[64];
    tEngineCurveElem *data;
    tCarSetupItem *setupRevLimit = &(car->carElt->setup.revsLimiter);
    struct tEdesc
    {
        tdble rpm;
        tdble tq;
    } *edesc;

    setupRevLimit->desired_value = setupRevLimit->min = setupRevLimit->max = 800;
    GfParmGetNumWithLimits(hdle, SECT_ENGINE, PRM_REVSLIM, (char*)NULL, &(setupRevLimit->desired_value), &(setupRevLimit->min), &(setupRevLimit->max));
    setupRevLimit->changed = true;
    setupRevLimit->stepsize = (tdble) RPM2RADS(100.0);
    car->engine.revsLimiter = setupRevLimit->desired_value;
    car->carElt->_enginerpmRedLine = car->engine.revsLimiter;
    car->engine.revsMax     = GfParmGetNum(hdle, SECT_ENGINE, PRM_REVSMAX, (char*)NULL, 1000);
    car->carElt->_enginerpmMax = car->engine.revsMax;
    car->engine.tickover    = GfParmGetNum(hdle, SECT_ENGINE, PRM_TICKOVER, (char*)NULL, 150);
    car->engine.I           = GfParmGetNum(hdle, SECT_ENGINE, PRM_INERTIA, (char*)NULL, 0.2423f);
    car->engine.fuelcons    = GfParmGetNum(hdle, SECT_ENGINE, PRM_FUELCONS, (char*)NULL, 0.0622f);
    car->engine.brakeCoeff  = GfParmGetNum(hdle, SECT_ENGINE, PRM_ENGBRKCOEFF, (char*)NULL, 0.03f);
    car->engine.brakeLinCoeff= GfParmGetNum(hdle, SECT_ENGINE, PRM_ENGBRKLINCOEFF, (char*)NULL, 0.03f);
    car->engine.exhaust_pressure = 0.0f;
    car->engine.exhaust_refract = 0.1f;
    car->engine.Tq_response = 0.0f;
    car->engine.I_joint = car->engine.I;
    car->engine.timeInLimiter = 0.0f;
    car->engine.max_temp_water = GfParmGetNum(hdle, SECT_ENGINE, PRM_ENGINEMAXTEMPWATER, (char*)NULL, 95.0f);
    engineCoefficient = GfParmGetNum(hdle, SECT_ENGINE, PRM_ENGINETEMPCOEFF, (char*)NULL, 0.0000047f);
    car->carElt->_engineMaxTempWater = car->engine.max_temp_water;

    if(car->options->engine_temperature)
        car->engine.temp_water = 50.0f;
    else
        car->engine.temp_water = car->engine.max_temp_water - 5.0f;

    enginePressure = SimAirPressure / 100000;
    GfLogInfo("Engine air Pressure = %.8f\n", enginePressure);

    // Option TCL ...
    if (car->features & FEAT_TCLINSIMU)
    {
        car->engine.TCL        = 1.0f;
        car->engine.EnableTCL  = GfParmGetNum(hdle, SECT_ENGINE, PRM_TCLINSIMU, (char*)NULL, 0.0f) > 0;
        /*
        if (car->engine.EnableTCL)
            fprintf(stderr,"TCL: Enabled\n");
        else
            fprintf(stderr,"TCL: Disabled\n");
*/
    }
    // ... Option TCL

    sprintf(idx, "%s/%s", SECT_ENGINE, ARR_DATAPTS);
    car->engine.curve.nbPts = GfParmGetEltNb(hdle, idx);
    edesc = (struct tEdesc*)malloc((car->engine.curve.nbPts + 1) * sizeof(struct tEdesc));

    for (i = 0; i < car->engine.curve.nbPts; i++)
    {
        sprintf(idx, "%s/%s/%d", SECT_ENGINE, ARR_DATAPTS, i+1);
        edesc[i].rpm = GfParmGetNum(hdle, idx, PRM_RPM, (char*)NULL, car->engine.revsMax);
        edesc[i].tq  = GfParmGetNum(hdle, idx, PRM_TQ, (char*)NULL, 0);
    }

    if (i > 0)
    {
        edesc[i].rpm = edesc[i - 1].rpm;
        edesc[i].tq  = edesc[i - 1].tq;
    }

    maxTq = 0;
    car->engine.curve.maxPw = 0;
    car->engine.curve.data = (tEngineCurveElem *)malloc(car->engine.curve.nbPts * sizeof(tEngineCurveElem));

    for(i = 0; i < car->engine.curve.nbPts; i++)
    {
        data = &(car->engine.curve.data[i]);

        data->rads = edesc[i+1].rpm;

        if ((data->rads>=car->engine.tickover)
                && (edesc[i+1].tq > maxTq)
                && (data->rads < car->engine.revsLimiter))
        {
            maxTq = edesc[i+1].tq;
            rpmMaxTq = data->rads;
        }

        if ((data->rads>=car->engine.tickover)
                && (data->rads * edesc[i+1].tq > car->engine.curve.maxPw)
                && (data->rads < car->engine.revsLimiter))
        {
            car->engine.curve.TqAtMaxPw = edesc[i+1].tq;
            car->engine.curve.maxPw = data->rads * edesc[i+1].tq;
            car->engine.curve.rpmMaxPw = data->rads;
        }

        data->a = (edesc[i+1].tq - edesc[i].tq) / (edesc[i+1].rpm - edesc[i].rpm);
        data->b = edesc[i].tq - data->a * edesc[i].rpm;
    }

    car->engine.curve.maxTq = maxTq;
    car->carElt->_engineMaxTq = maxTq;
    car->carElt->_enginerpmMaxTq = rpmMaxTq;
    car->carElt->_engineMaxPw = car->engine.curve.maxPw;
    car->carElt->_enginerpmMaxPw = car->engine.curve.rpmMaxPw;

    car->engine.rads = car->engine.tickover;

    free(edesc);

    /* check engine brake */
    if ( car->engine.brakeCoeff < 0.0 )
    {
        car->engine.brakeCoeff = 0.0;
    }
    car->engine.brakeCoeff *= maxTq;
    /*sanity check of rev limits*/
    if (car->engine.curve.nbPts > 0 && car->engine.revsMax > car->engine.curve.data[car->engine.curve.nbPts-1].rads)
    {
        car->engine.revsMax = car->engine.curve.data[car->engine.curve.nbPts-1].rads;
        GfLogWarning("Revs maxi bigger than the maximum RPM in the curve data.\nIt is set to %g.\n",car->engine.revsMax);
    }

    if (car->engine.revsLimiter > car->engine.revsMax)
    {
        car->engine.revsLimiter = car->engine.revsMax;
        GfLogWarning("Revs limiter is bigger than revs maxi.\nIt is set to %g.\n",car->engine.revsLimiter);
    }

    if (setupRevLimit->max > car->engine.revsMax)
    {
        setupRevLimit->max = car->engine.revsMax;
        if (setupRevLimit->min > setupRevLimit->max)
        {
            setupRevLimit->min = setupRevLimit->max;
        }
    }
}

void
SimEngineReConfig(tCar *car)
{/* called by SimCarReConfig in car.cpp */
    tCarSetupItem *setupRevLimit = &(car->carElt->setup.revsLimiter);

    if (setupRevLimit->changed)
    {
        car->engine.revsLimiter = MIN(setupRevLimit->max, MAX(setupRevLimit->min, setupRevLimit->desired_value));
        car->carElt->_enginerpmRedLine = car->engine.revsLimiter;
        setupRevLimit->value = car->engine.revsLimiter;
        setupRevLimit->changed = FALSE;
        car->carElt->_engineTempWater = car->engine.temp_water;
    }
}

/* Update torque output with engine rpm and accelerator command */
void
SimEngineUpdateTq(tCar *car)
{
    int i;
    tEngine	*engine = &(car->engine);
    tEngineCurve *curve = &(engine->curve);
    tTransmission	*trans = &(car->transmission);
    tClutch		*clutch = &(trans->clutch);

    if ((car->fuel <= 0.0f) || (car->carElt->_state & (RM_CAR_STATE_BROKEN | RM_CAR_STATE_ELIMINATED)))
    {
        engine->rads = 0;
        engine->Tq = 0;
        return;
    }

    // set clutch on when engine revs too low
    if (engine->rads < engine->tickover)
    {
        clutch->state = CLUTCH_APPLIED;
        clutch->transferValue = 0.0f;
        //		engine->rads = engine->tickover;
    }

    engine->rads = MIN(engine->rads, engine->revsMax);
    tdble EngBrkK = engine->brakeLinCoeff * engine->rads;

    if ( (engine->rads < engine->tickover) ||
         ( (engine->rads == engine->tickover) && (car->ctrl->accelCmd <= 1e-6) ) )
    {
        engine->Tq = 0.0f;
        engine->rads = engine->tickover;
    }
    else
    {
        tdble Tq_max = 0.0;
        for (i = 0; i < car->engine.curve.nbPts; i++)
        {
            if (engine->rads < curve->data[i].rads)
            {
                Tq_max = engine->rads * curve->data[i].a + curve->data[i].b;
                break;
            }
        }

        tdble alpha = car->ctrl->accelCmd;

        if (engine->rads > engine->revsLimiter)
        {
            alpha = 0.0;
            if (car->features & FEAT_REVLIMIT)
            {
                engine->timeInLimiter = 0.1f;
            }
        }

        // Option TCL ...
        if (car->features & FEAT_TCLINSIMU)
        {
            if (engine->EnableTCL)
                Tq_max *= (tdble) MAX(0.0,MIN(1.0, engine->TCL));
            /*
        if (engine->EnableTCL)
            fprintf(stderr,"TCL: %.1f %%\n", engine->TCL * 100);
*/
        }
        // ... Option TCL

        if ( (car->features & FEAT_REVLIMIT) && (engine->timeInLimiter > 0.0f) )
        {
            alpha = 0.0;
            engine->timeInLimiter -= SimDeltaTime;
        }

        tdble Tq_cur = (Tq_max + EngBrkK) * alpha;
        engine->Tq = Tq_cur;
        engine->Tq -= EngBrkK;

        if (alpha <= 1e-6)
        {
            engine->Tq -= engine->brakeCoeff;
        }

        tdble cons = Tq_cur * 0.75f;
        if (cons > 0)
        {
            car->fuel -= (tdble) (cons * engine->rads * engine->fuelcons * 0.0000001 * SimDeltaTime);
        }

        car->fuel = (tdble) MAX(car->fuel, 0.0);
    }
}

/*
 * Function
 *	SimEngineUpdateRpm
 *
 * Description
 *	update engine RPM with wheels RPM
 *
 * Parameters
 *	car and axle RPM
 *
 * Return
 *	axle rpm for wheel update
 *	0 if no wheel update
 */
tdble
SimEngineUpdateRpm(tCar *car, tdble axleRpm)
{
    tTransmission *trans = &(car->transmission);
    tClutch *clutch = &(trans->clutch);
    tEngine *engine = &(car->engine);
    float freerads;
    float transfer;

    if(car->options->engine_temperature)
        SimEngineUpdateWater(car);

    if (car->fuel <= 0.0)
    {
        engine->rads = 0;
        clutch->state = CLUTCH_APPLIED;
        clutch->transferValue = 0.0;
        return 0.0;
    }

    freerads = engine->rads;
    freerads += engine->Tq / engine->I * SimDeltaTime;
    {
        tdble dp = engine->pressure;
        engine->pressure = engine->pressure*0.9f + 0.1f*engine->Tq;
        dp = (0.001f*fabs(engine->pressure - dp));
        dp = fabs(dp);
        tdble rth = urandom();

        if (dp > rth)
        {
            engine->exhaust_pressure += rth;
        }

        engine->exhaust_pressure *= 0.9f;
        car->carElt->priv.smoke += 5.0f*engine->exhaust_pressure;
        car->carElt->priv.smoke *= 0.99f;
    }

    // This is a method for the joint torque that the engine experiences
    // to be changed smoothly and not instantaneously.
    // The closest alpha is to 1, the faster the transition is.
    transfer = 0.0;
    float ttq = 0.0;
    float I_response = trans->differential[0].feedBack.I + trans->differential[1].feedBack.I;
    engine->Tq_response = 0.0;
    tdble dI = fabs(trans->curI - engine->I_joint);
    tdble sdI = dI;

    // limit the difference to avoid model instability
    if (sdI>1.0)
    {
        sdI = 1.0;
    }

    float alpha = 0.1f; // transition coefficient
    engine->I_joint = (tdble) (engine->I_joint*(1.0-alpha) +  alpha*trans->curI);

    // only use these values when the clutch is engaged or the gear
    // has changed.
    if ((clutch->transferValue > 0.01) && (trans->gearbox.gear))
    {
        transfer = clutch->transferValue * clutch->transferValue * clutch->transferValue * clutch->transferValue;

        ttq = (float) (dI* tanh(0.01*(axleRpm * trans->curOverallRatio * transfer + freerads * (1.0-transfer) -engine->rads))*100.0);
        engine->rads = (tdble) ((1.0-sdI) * (axleRpm * trans->curOverallRatio * transfer + freerads * (1.0-transfer)) + sdI *(engine->rads + ((ttq)*SimDeltaTime)/(engine->I)));
        if (engine->rads < 0.0)
        {
            engine->rads = 0;
            engine->Tq = 0.0;
        }
    }
    else
    {
        engine->rads = freerads;
    }

    if (engine->rads < engine->tickover)
    {
        engine->rads = engine->tickover;
        engine->Tq = 0.0;
    }
    else if (engine->rads > engine->revsMax)
    {
        engine->rads = engine->revsMax;
        if ( (clutch->transferValue > 0.01) &&
             ((trans->curOverallRatio > 0.01) || (trans->curOverallRatio < -0.01)) )
            return engine->revsMax / trans->curOverallRatio;
        else
        {
            return 0.0;
        }
    }

    if ((trans->curOverallRatio!=0.0) && (I_response > 0))
    {
        return axleRpm - sdI * ttq * trans->curOverallRatio   * SimDeltaTime / ( I_response);
    }
    else
    {
        return 0.0;
    }
}

tdble SimEngineUpdateWater(tCar *car)
{
    tEngine *engine = &(car->engine);
    tdble water = engine->temp_water;
    tdble gain, loss, damage;
    tdble air = 101400.0 / SimAirPressure;
    tdble temp2 = 35.0;

    if (Tair <= 0.0)
        temp2 = 0.0;
    else
        temp2 = Tair;

    tdble temp = 32.0 / K2C(temp2);

    if (water < engine->max_temp_water - 20.0f)
        water = engine->temp_water + (1.0f / (engine->rads * Tair * SimDeltaTime));
    else
    {
        if (engine->rads < (engine->revsLimiter * 0.78f))
        {
            gain = (engine->rads * air * SimDeltaTime) * 0.0000047f;
            GfLogDebug("Engine RPM 1 = %.2f - Reverse Limiter = %.2f - air speed = %.5f - Air Pressure = %.5f - Pressure = %.5f - gain = %.8f\n", engine->rads, engine->revsLimiter,
                      car->airSpeed2, SimAirPressure, air,gain);
        }
        else
        {
            gain = (engine->rads * air * SimDeltaTime) * 0.0000081f;
            GfLogDebug("Engine RPM 2 = %.2f - Reverse Limiter = %.2f - air speed = %.5f - Air Pressure = %.5f - Pressure = %.5f - gain = %.8f\n", engine->rads, engine->revsLimiter,
                      car->airSpeed2, SimAirPressure, air,gain);
        }

        if(car->options->engine_damage)
            damage = tdble(car->dammage) / 10000.0;
        else
            damage = 0.0;

        if (car->airSpeed2 < 1200)
        {
            loss = (car->airSpeed2 * temp * (1.0 - damage) * SimDeltaTime) * 0.00000188f;
            GfLogDebug("Loss 1 = %.8f - air temperature = %.2f - Damage = %.5f\n", loss, temp, damage);
        }
        else
        {
            loss = (car->airSpeed2 * temp * (1.0 - damage) * SimDeltaTime) * 0.00000074f;
            GfLogDebug("Loss 2 = %.8f - temperature = %.2f - Damage = %.5f\n", loss, temp, damage);
        }

        GfLogDebug(" Gain = %.8f - Loss = %.8f - Added = %.8f - car dammage = %i - damage = %.8f\n", gain, loss, gain - loss, car->dammage, damage);
        water = engine->temp_water + (gain - loss);
        GfLogDebug("Engine water Temp = %0.8f\n", water);
    }

    engine->temp_water = water;

    if(engine->temp_water > engine->max_temp_water + 6.0f)
        car->carElt->_state |= RM_CAR_STATE_BROKEN;

    return 0.0;
}

void
SimEngineShutdown(tCar *car)
{
    free(car->engine.curve.data);
}

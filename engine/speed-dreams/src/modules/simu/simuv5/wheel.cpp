/***************************************************************************

    file                 : wheel.cpp
    created              : Sun Mar 19 00:09:06 CET 2000
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

#include <tgf.h>
#include "sim.h"

static const char *WheelSect[4] = {SECT_FRNTRGTWHEEL, SECT_FRNTLFTWHEEL, SECT_REARRGTWHEEL, SECT_REARLFTWHEEL};
static const char *SuspSect[4] = {SECT_FRNTRGTSUSP, SECT_FRNTLFTSUSP, SECT_REARRGTSUSP, SECT_REARLFTSUSP};
static const char *BrkSect[4] = {SECT_FRNTRGTBRAKE, SECT_FRNTLFTBRAKE, SECT_REARRGTBRAKE, SECT_REARLFTBRAKE};

static bool tyredeg_enabled(const tCar *car)
{
    return car->options->tyre_temperature && car->features & FEAT_TIRETEMPDEG;
}

void SimWheelConfig(tCar *car, int index)
{
    void *hdle = car->params;
    char		path[256];
    tCarElt *carElt = car->carElt;
    tWheel *wheel = &(car->wheel[index]);
    tdble rimdiam, tirewidth, tireratio, tireheight, patchLen;
    tdble Ca, RFactor, EFactor;
    tCarSetupItem *setupToe = &(car->carElt->setup.toe[index]);
    tCarSetupItem *setupCamber = &(car->carElt->setup.camber[index]);
    tCarSetupItem *setupPressure = &(car->carElt->setup.tirePressure[index]);
    tCarSetupItem *setupOpLoad = &(car->carElt->setup.tireOpLoad[index]);
    tCarSetupItem *setupCompound = &(car->carElt->setup.tireCompound);

    /* Note: ride height is already read in SimAxleConfig() */

    setupToe->desired_value = setupToe->min = setupToe->max = 0.0f;
    GfParmGetNumWithLimits(hdle, WheelSect[index], PRM_TOE, (char*)NULL, &(setupToe->desired_value), &(setupToe->min), &(setupToe->max));
    setupToe->changed = true;
    setupToe->stepsize = (tdble) DEG2RAD(0.1);

    setupCamber->desired_value = setupCamber->min = setupCamber->max = 0.0f;
    GfParmGetNumWithLimits(hdle, WheelSect[index], PRM_CAMBER, (char*)NULL, &(setupCamber->desired_value), &(setupCamber->min), &(setupCamber->max));
    setupCamber->changed = true;
    setupCamber->stepsize = (tdble) DEG2RAD(0.1);

    setupPressure->desired_value = setupPressure->min = setupPressure->max = 138000;
    GfParmGetNumWithLimits(hdle, WheelSect[index], PRM_PRESSURE, (char*)NULL, &(setupPressure->desired_value), &(setupPressure->min), &(setupPressure->max));
    setupPressure->changed = true;
    setupPressure->stepsize = 10000;
    GfLogInfo(" # Car pressure tire simu = %.2f\n", setupPressure->desired_value);

    setupOpLoad->desired_value = setupOpLoad->min = setupOpLoad->max = wheel->weight0 * 1.2f;
    GfParmGetNumWithLimits(hdle, WheelSect[index], PRM_OPLOAD, (char*)NULL, &(setupOpLoad->desired_value), &(setupOpLoad->min), &(setupOpLoad->max));
    setupOpLoad->changed = true;
    setupOpLoad->stepsize = 100;

    setupCompound->desired_value = setupCompound->min = setupCompound->max = 5;
    GfParmGetNumWithLimits(hdle, SECT_TIRESET, PRM_COMPOUNDS_SET, (char*)NULL, &(setupCompound->desired_value), &(setupCompound->min), &(setupCompound->max));
    setupCompound->changed = true;
    setupCompound->stepsize = 1;

    // Additional parameters for the tire wear model
    wheel->treadThinkness	= GfParmGetNum(hdle, WheelSect[index], PRM_TREADTHICKNESS, (char*)NULL, 0.005f);		// default 5 [mm]
    tdble rimmass = GfParmGetNum(hdle, WheelSect[index], PRM_RIMMASS, (char*)NULL, 7.0f);							// default 7 [kg]
    wheel->hysteresisFactor = GfParmGetNum(hdle, WheelSect[index], PRM_HYSTERESIS, (char*)NULL, 1.0f);				// default 1.0 [-]
	wheel->coolingFactor = GfParmGetNum(hdle, WheelSect[index], PRM_TIRECOOLING, (char*)NULL, 0.0f);				// default 0.0 [-] maintain compatibility with older cars
	wheel->latHeatFactor = GfParmGetNum(hdle, WheelSect[index], PRM_LATMUHEATING, (char*)NULL, 0.0f);				// default 0.0 [-]
	wheel->longHeatFactor = GfParmGetNum(hdle, WheelSect[index], PRM_LONGMUHEATING, (char*)NULL, 0.0f);				// default 0.0 [-]
	wheel->tireSpeedCoolFactor = GfParmGetNum(hdle, WheelSect[index], PRM_TIRESPDCOOLING, (char*)NULL, 0.0f);		// default 0.0 [-] but recommend 0.5-1.25 for most cars
	wheel->tireTreadDrainFactor = GfParmGetNum(hdle, WheelSect[index], PRM_TREADDRAINSPD, (char*)NULL, 0.0);		// default 0
    wheel->wearFactor = GfParmGetNum(hdle, WheelSect[index], PRM_WEAR, (char*)NULL, 1.0f);

	if (car->features & FEAT_COMPOUNDS)
	{
		sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_SOFT);
		wheel->hysteresisFactorC[1] = GfParmGetNum(hdle, path, PRM_HYSTERESIS, (char*)NULL, wheel->hysteresisFactor);
		wheel->coolingFactorC[1] = GfParmGetNum(hdle, path, PRM_TIRECOOLING, (char*)NULL, wheel->coolingFactor);
		wheel->latHeatFactorC[1] = GfParmGetNum(hdle, path, PRM_LATMUHEATING, (char*)NULL, wheel->latHeatFactor);
		wheel->longHeatFactorC[1] = GfParmGetNum(hdle, path, PRM_LONGMUHEATING, (char*)NULL, wheel->longHeatFactor);
		wheel->tireSpeedCoolFactorC[1] = GfParmGetNum(hdle, path, PRM_TIRESPDCOOLING, (char*)NULL, wheel->tireSpeedCoolFactor);
		wheel->tireTreadDrainFactorC[1] = GfParmGetNum(hdle, path, PRM_TREADDRAINSPD, (char*)NULL, wheel->tireTreadDrainFactor);
		wheel->wearFactorC[1] = GfParmGetNum(hdle, path, PRM_WEAR, (char*)NULL, wheel->wearFactor);

		sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_MEDIUM);
		wheel->hysteresisFactorC[2] = GfParmGetNum(hdle, path, PRM_HYSTERESIS, (char*)NULL, wheel->hysteresisFactor);
		wheel->coolingFactorC[2] = GfParmGetNum(hdle, path, PRM_TIRECOOLING, (char*)NULL, wheel->coolingFactor);
		wheel->latHeatFactorC[2] = GfParmGetNum(hdle, path, PRM_LATMUHEATING, (char*)NULL, wheel->latHeatFactor);
		wheel->longHeatFactorC[2] = GfParmGetNum(hdle, path, PRM_LONGMUHEATING, (char*)NULL, wheel->longHeatFactor);
		wheel->tireSpeedCoolFactorC[2] = GfParmGetNum(hdle, path, PRM_TIRESPDCOOLING, (char*)NULL, wheel->tireSpeedCoolFactor);
		wheel->tireTreadDrainFactorC[2] = GfParmGetNum(hdle, path, PRM_TREADDRAINSPD, (char*)NULL, wheel->tireTreadDrainFactor);
		wheel->wearFactorC[2] = GfParmGetNum(hdle, path, PRM_WEAR, (char*)NULL, wheel->wearFactor);

		sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_HARD);
		wheel->hysteresisFactorC[3] = GfParmGetNum(hdle, path, PRM_HYSTERESIS, (char*)NULL, wheel->hysteresisFactor);
		wheel->coolingFactorC[3] = GfParmGetNum(hdle, path, PRM_TIRECOOLING, (char*)NULL, wheel->coolingFactor);
		wheel->latHeatFactorC[3] = GfParmGetNum(hdle, path, PRM_LATMUHEATING, (char*)NULL, wheel->latHeatFactor);
		wheel->longHeatFactorC[3] = GfParmGetNum(hdle, path, PRM_LONGMUHEATING, (char*)NULL, wheel->longHeatFactor);
		wheel->tireSpeedCoolFactorC[3] = GfParmGetNum(hdle, path, PRM_TIRESPDCOOLING, (char*)NULL, wheel->tireSpeedCoolFactor);
		wheel->tireTreadDrainFactorC[3] = GfParmGetNum(hdle, path, PRM_TREADDRAINSPD, (char*)NULL, wheel->tireTreadDrainFactor);
		wheel->wearFactorC[3] = GfParmGetNum(hdle, path, PRM_WEAR, (char*)NULL, wheel->wearFactor);

		sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_WET);
		wheel->hysteresisFactorC[4] = GfParmGetNum(hdle, path, PRM_HYSTERESIS, (char*)NULL, wheel->hysteresisFactor);
		wheel->coolingFactorC[4] = GfParmGetNum(hdle, path, PRM_TIRECOOLING, (char*)NULL, wheel->coolingFactor);
		wheel->latHeatFactorC[4] = GfParmGetNum(hdle, path, PRM_LATMUHEATING, (char*)NULL, wheel->latHeatFactor);
		wheel->longHeatFactorC[4] = GfParmGetNum(hdle, path, PRM_LONGMUHEATING, (char*)NULL, wheel->longHeatFactor);
		wheel->tireSpeedCoolFactorC[4] = GfParmGetNum(hdle, path, PRM_TIRESPDCOOLING, (char*)NULL, wheel->tireSpeedCoolFactor);
		wheel->tireTreadDrainFactorC[4] = GfParmGetNum(hdle, path, PRM_TREADDRAINSPD, (char*)NULL, 1.5f);
		wheel->wearFactorC[4] = GfParmGetNum(hdle, path, PRM_WEAR, (char*)NULL, wheel->wearFactor);

		sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_EXTREM_WET);
		wheel->hysteresisFactorC[5] = GfParmGetNum(hdle, path, PRM_HYSTERESIS, (char*)NULL, wheel->hysteresisFactor);
		wheel->coolingFactorC[5] = GfParmGetNum(hdle, path, PRM_TIRECOOLING, (char*)NULL, wheel->coolingFactor);
		wheel->latHeatFactorC[5] = GfParmGetNum(hdle, path, PRM_LATMUHEATING, (char*)NULL, wheel->latHeatFactor);
		wheel->longHeatFactorC[5] = GfParmGetNum(hdle, path, PRM_LONGMUHEATING, (char*)NULL, wheel->longHeatFactor);
		wheel->tireSpeedCoolFactorC[5] = GfParmGetNum(hdle, path, PRM_TIRESPDCOOLING, (char*)NULL, wheel->tireSpeedCoolFactor);
		wheel->tireTreadDrainFactorC[5] = GfParmGetNum(hdle, path, PRM_TREADDRAINSPD, (char*)NULL, 3.0f);
		wheel->wearFactorC[5] = GfParmGetNum(hdle, path, PRM_WEAR, (char*)NULL, wheel->wearFactor);

		/*if (SimRain < 1)
		{
			wheel->hysteresisFactorC[4] *= 1.5;
			wheel->hysteresisFactorC[5] *= 2.0;
			wheel->wearFactorC[4] *= 3.5;
			wheel->wearFactorC[5] *= 3.5;
			GfLogInfo("# Simu wear factor compound with no rain wet = %.4f - extreme wet = %.4f\n",
								  wheel->wearFactorC[4], wheel->wearFactorC[5]);
		}*/
	}

    rimdiam               = GfParmGetNum(hdle, WheelSect[index], PRM_RIMDIAM, (char*)NULL, 0.33f);
    tirewidth             = GfParmGetNum(hdle, WheelSect[index], PRM_TIREWIDTH, (char*)NULL, 0.145f);
    tireheight            = GfParmGetNum(hdle, WheelSect[index], PRM_TIREHEIGHT, (char*)NULL, -1.0f);
    tireratio             = GfParmGetNum(hdle, WheelSect[index], PRM_TIRERATIO, (char*)NULL, 0.75f);
    wheel->mu             = GfParmGetNum(hdle, WheelSect[index], PRM_MU, (char*)NULL, 1.0f);
	wheel->muWet = GfParmGetNum(hdle, WheelSect[index], PRM_MUWET, (char*)NULL, 1.0f);

	if (car->features & FEAT_COMPOUNDS && car->options->compounds)
	{
		sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_SOFT);
		wheel->muC[1] = GfParmGetNum(hdle, path, PRM_MU, (char*)NULL, wheel->mu);
		wheel->muWetC[1] = GfParmGetNum(hdle, path, PRM_MUWET, (char*)NULL, wheel->muC[1]);

		sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_MEDIUM);
		wheel->muC[2] = GfParmGetNum(hdle, path, PRM_MU, (char*)NULL, wheel->mu);
		wheel->muWetC[2] = GfParmGetNum(hdle, path, PRM_MUWET, (char*)NULL, wheel->muC[2]);

		sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_HARD);
		wheel->muC[3] = GfParmGetNum(hdle, path, PRM_MU, (char*)NULL, wheel->mu);
		wheel->muWetC[3] = GfParmGetNum(hdle, path, PRM_MUWET, (char*)NULL, wheel->muC[3]);

		sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_WET);
		wheel->muC[4] = GfParmGetNum(hdle, path, PRM_MU, (char*)NULL, wheel->mu);
		wheel->muWetC[4] = GfParmGetNum(hdle, path, PRM_MUWET, (char*)NULL, wheel->muC[4] * 1.05);

		sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_EXTREM_WET);
		wheel->muC[5] = GfParmGetNum(hdle, path, PRM_MU, (char*)NULL, wheel->mu);
		wheel->muWetC[5] = GfParmGetNum(hdle, path, PRM_MUWET, (char*)NULL, wheel->muC[5] * 1.05);
		GfLogInfo("# Simu MU compound soft = %.3f - medium = %.3f - hard = %.3f - wet = %.3f - extreme wet = %.3f\n",
			wheel->muC[1], wheel->muC[2], wheel->muC[3], wheel->muC[4], wheel->muC[5]);
		GfLogInfo("# Simu MU WET compound soft = %.3f - medium = %.3f - hard = %.3f - wet = %.3f - extreme wet = %.3f\n",
			wheel->muWetC[1], wheel->muWetC[2], wheel->muWetC[3], wheel->muWetC[4], wheel->muWetC[5]);

		/*if(SimRain < 1)
		{
			wheel->muC[4] -= 0.2;
			wheel->muC[5] -= 0.3;
			GfLogInfo("# Simu MU compound with no rain wet = %.3f - extreme wet = %.3f\n",
					  wheel->muC[4], wheel->muC[5]);
		}*/
	}

    wheel->I              = GfParmGetNum(hdle, WheelSect[index], PRM_INERTIA, (char*)NULL, 1.5f);
    //BUG: the next line should go after SimBrakeConfig to have an effect
    wheel->I += wheel->brake.I; // add brake inertia
    wheel->staticPos.y    = GfParmGetNum(hdle, WheelSect[index], PRM_YPOS, (char*)NULL, 0.0f);
    Ca                    = GfParmGetNum(hdle, WheelSect[index], PRM_CA, (char*)NULL, 30.0f);
    RFactor               = GfParmGetNum(hdle, WheelSect[index], PRM_RFACTOR, (char*)NULL, 0.8f);
    EFactor               = GfParmGetNum(hdle, WheelSect[index], PRM_EFACTOR, (char*)NULL, 0.7f);
    wheel->lfMax          = GfParmGetNum(hdle, WheelSect[index], PRM_LOADFMAX, (char*)NULL, 1.6f);
    wheel->lfMin          = GfParmGetNum(hdle, WheelSect[index], PRM_LOADFMIN, (char*)NULL, 0.8f);
    wheel->AlignTqFactor  = GfParmGetNum(hdle, WheelSect[index], PRM_ALIGNTQFACTOR, (char*)NULL, 0.6f);
	wheel->LatMuFactor    = GfParmGetNum(hdle, WheelSect[index], PRM_LATMUFACTOR, (char*)NULL, 1.0f);
	wheel->LongMuFactor   = GfParmGetNum(hdle, WheelSect[index], PRM_LONGMUFACTOR, (char*)NULL, 1.0f);
    wheel->mass           = GfParmGetNum(hdle, WheelSect[index], PRM_MASS, (char*)NULL, 20.0f);

    wheel->lfMin = MIN(0.9f, wheel->lfMin);
    wheel->lfMax = MAX(1.1f, wheel->lfMax);

    if (wheel->AlignTqFactor < 0.1f )
    {
        wheel->AlignTqFactor = 0.1f;
    }

    // Absolute pressure of cold tire.
    wheel->pressure = MIN(setupPressure->max, MAX(setupPressure->min, setupPressure->desired_value));
    wheel->currentPressure	= wheel->pressure; //MIN(setupPressure->max, MAX(setupPressure->min, setupPressure->desired_value));

    if (car->features & FEAT_COMPOUNDS && car->options->compounds)
    {
        wheel->tireSet = MIN(setupCompound->max, MAX(setupCompound->min, setupCompound->desired_value));
        wheel->mu = wheel->muC[wheel->tireSet];
        wheel->hysteresisFactor = wheel->hysteresisFactorC[wheel->tireSet];
        wheel->wearFactor = wheel->wearFactorC[wheel->tireSet];
    }

    RFactor = MIN(1.0f, RFactor);
    RFactor = MAX(0.1f, RFactor);
    EFactor = MIN(1.0f, EFactor);

    if (tireheight > 0.0)
        wheel->radius = rimdiam / 2.0f + tireheight;
    else
        wheel->radius = rimdiam / 2.0f + tirewidth * tireratio;

    patchLen = wheel->weight0 / (tirewidth * wheel->pressure);
    wheel->tireSpringRate = wheel->weight0 / (wheel->radius * (1.0f - cos(asin(patchLen / (2.0f * wheel->radius)))));
    wheel->relPos.x = wheel->staticPos.x = car->axle[index/2].xpos;
    wheel->relPos.y = wheel->staticPos.y;
    /* BUG? susp.spring.x0 is still 0 here, maybe move after SimSuspReConfig in SimWheelReConfig? */
    wheel->relPos.z = wheel->radius - wheel->susp.spring.x0;
    wheel->relPos.ay = wheel->relPos.az = 0.0f;
    wheel->steer = 0.0f;

    /* temperature and degradation */
    wheel->Tinit = GfParmGetNum(hdle, WheelSect[index], PRM_INITTEMP, (char*)NULL, Tair);
    wheel->treadDepth = 1.0;
    wheel->Topt = GfParmGetNum(hdle, WheelSect[index], PRM_OPTTEMP, (char*)NULL, 350.0f);

    if ((car->features & FEAT_COMPOUNDS) && car->options->compounds)
    {
        sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_SOFT);
        wheel->TinitC[1] = GfParmGetNum(hdle, path, PRM_INITTEMP, (char*)NULL, wheel->Tinit);
        wheel->ToptC[1] = GfParmGetNum(hdle, path, PRM_OPTTEMP, (char*)NULL, wheel->Topt);

        sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_MEDIUM);
        wheel->TinitC[2] = GfParmGetNum(hdle, path, PRM_INITTEMP, (char*)NULL, wheel->Tinit);
        wheel->ToptC[2] = GfParmGetNum(hdle, path, PRM_OPTTEMP, (char*)NULL, wheel->Topt);

        sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_HARD);
        wheel->TinitC[3] = GfParmGetNum(hdle, path, PRM_INITTEMP, (char*)NULL, wheel->Tinit);
        wheel->ToptC[3] = GfParmGetNum(hdle, path, PRM_OPTTEMP, (char*)NULL, wheel->Topt);

        sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_WET);
        wheel->TinitC[4] = GfParmGetNum(hdle, path, PRM_INITTEMP, (char*)NULL, wheel->Tinit);
        wheel->ToptC[4] = GfParmGetNum(hdle, path, PRM_OPTTEMP, (char*)NULL, wheel->Topt);

        sprintf(path, "%s/%s/%s", WheelSect[index], SECT_COMPOUNDS, SECT_EXTREM_WET);
        wheel->TinitC[5] = GfParmGetNum(hdle, path, PRM_INITTEMP, (char*)NULL, wheel->Tinit);
        wheel->ToptC[5] = GfParmGetNum(hdle, path, PRM_OPTTEMP, (char*)NULL, wheel->Topt);
        GfLogInfo("# Simu Optimal temperature compound soft = %.3f - medium = %.3f - hard = %.3f - wet = %.3f - extreme wet = %.3f\n",
                  wheel->ToptC[1] -273.15, wheel->ToptC[2] - 273.15, wheel->ToptC[3] - 273.15, wheel->ToptC[4] - 273.15, wheel->ToptC[5] - 273.15);

        wheel->Tinit = wheel->TinitC[wheel->tireSet];
        wheel->Topt = wheel->ToptC[wheel->tireSet];
    }

    if (tyredeg_enabled(car))
    {
        wheel->Ttire = wheel->Tinit;
    }
    else
    {
        wheel->Ttire = wheel->Topt;
    }

    //wheel->heatingm -=SimRain;
    const tdble rubberDensity = 930.0f;	// Density of Rubber (NR) in [kg/m^3].
    wheel->treadMass = (2.0f*wheel->radius - wheel->treadThinkness)*PI*tirewidth*wheel->treadThinkness*rubberDensity;
    wheel->baseMass = wheel->mass - wheel->treadMass - rimmass;

    if (wheel->baseMass < 0.0f)
    {
        wheel->baseMass = 3.0f;
        GfError("Wheel mass minus tire tread mass minus rim mass is smaller than 0.0kg, setting it to 3.0 kg");
    }

    // Surface area for convection model
    tdble innerRadius = rimdiam / 2.0f;
    tdble tireSideArea = PI*(wheel->radius*wheel->radius - innerRadius*innerRadius);
    wheel->tireConvectionSurface = 2.0f*(PI*tirewidth*wheel->radius + tireSideArea);

    // Mass of gas in the tire m=P*V/(R*T)
    tdble temperature = Tair;		// Kelvin
    tdble volume = tireSideArea*tirewidth;		// meter*meter*meter
    tdble nitrogenR = 296.8f;					// Joule/(kg*Kelvin), N2

    wheel->tireGasMass = (wheel->pressure * volume) / (nitrogenR * temperature);	// kg

    /* components */
    SimSuspConfig(car, hdle, SuspSect[index], &(wheel->susp), index);
    SimBrakeConfig(hdle, BrkSect[index], &(wheel->brake));

    carElt->_rimRadius(index) = rimdiam / 2.0f;

    if (tireheight > 0.0)
        carElt->_tireHeight(index) = tireheight;
    else
        carElt->_tireHeight(index) = tirewidth * tireratio;

    carElt->_tireWidth(index) = tirewidth;
    carElt->_brakeDiskRadius(index) = wheel->brake.radius;
    carElt->_wheelRadius(index) = wheel->radius;

    /* initialize carElt values even if tire temperature and wear feature is not enabled */
    carElt->_tyreT_opt(index) = wheel->Topt;
    carElt->_tyreT_in(index) = wheel->Ttire;
    carElt->_tyreT_mid(index) = wheel->Ttire;
    carElt->_tyreT_out(index) = wheel->Ttire;
    carElt->_tyreCondition(index) = 1.0;
    carElt->_tyreTreadDepth(index) = wheel->treadDepth;
    carElt->_tyreCurrentPressure(index) = wheel->pressure;
    carElt->_tyreCompound(index) = wheel->tireSet;

    wheel->mfC = (tdble)(2.0 - asin(RFactor) * 2.0 / PI);
    wheel->mfE = EFactor;

	// increase stiffness factor when temperature and pressure increases
	// but only if temperature feature is enabled.
	if (car->features & FEAT_TIRETEMPDEG)
	{
		//wheel->mfB = ((Ca*0.50) + (wheel->currentPressure * 0.0001)) / wheel->mfC;

		wheel->mfB = Ca / wheel->mfC;
	}
	else
	{
		wheel->mfB = Ca / wheel->mfC;
	}

    wheel->lfK = log((1.0f - wheel->lfMin) / (wheel->lfMax - wheel->lfMin));

    wheel->feedBack.I += wheel->I;
    wheel->feedBack.spinVel = 0.0f;
    wheel->feedBack.Tq = 0.0f;
    wheel->feedBack.brkTq = 0.0f;
    wheel->torques.x = wheel->torques.y = wheel->torques.z = 0.0f;

    /* calculate optimal slip value */
    tdble s, Bx, low, high;
    int i;
    //wheel->mfC * atan(Bx * (1.0f - wheel->mfE) + wheel->mfE * atan(Bx)) == PI/2
    low = 0.0;
    high = wheel->mfB;

    if (wheel->mfC * atan(high * (1.0f - wheel->mfE) + wheel->mfE * atan(high)) < PI_2)
    {
        /* tire parameters are unphysical*/
        s = 1.0;
        GfLogWarning("Tire magic curve parameters are unphysical!");
    }
    else
    {
        for (i = 0; i < 32; i++)
        {
            Bx = (tdble)(0.5 * (low + high));
            if (wheel->mfC * atan(Bx * (1.0f - wheel->mfE) + wheel->mfE * atan(Bx)) < PI_2)
            {
                low = Bx;
            }
            else
            {
                high = Bx;
            }
        }

        s = (tdble)(0.5 * (low + high) / wheel->mfB);
    }

    car->carElt->_wheelSlipOpt(index) = s;
    GfLogInfo("SimuV4 MU = %.3f - Topt = %.2f - Tinit = %.2f - wear = %.2f\n",
              wheel->mu, wheel->Topt - 273.15, wheel->Tinit -273.15, wheel->wearFactor);
}

void SimWheelReConfig(tCar *car, int index)
{/* called by SimCarReConfig in car.cpp */
    tCarElt *carElt = car->carElt;
    tWheel *wheel = &(car->wheel[index]);
    tdble x0;

    tCarSetupItem *setupRideHeight = &(car->carElt->setup.rideHeight[index]);
    tCarSetupItem *setupToe = &(car->carElt->setup.toe[index]);
    tCarSetupItem *setupCamber = &(car->carElt->setup.camber[index]);
    tCarSetupItem *setupPressure = &(car->carElt->setup.tirePressure[index]);
    tCarSetupItem *setupOpLoad = &(car->carElt->setup.tireOpLoad[index]);
    tCarSetupItem *setupCompound = &(car->carElt->setup.tireCompound);
    tdble patchLen;

    if (setupToe->changed)
    {
        wheel->staticPos.az = MIN(setupToe->max, MAX(setupToe->min, setupToe->desired_value));
        setupToe->value = wheel->staticPos.az;
        setupToe->changed = false;
    }

    if (setupCamber->changed)
    {
        wheel->staticPos.ax = MIN(setupCamber->max, MAX(setupCamber->min, setupCamber->desired_value));
        if (index % 2)
        {
            wheel->relPos.ax = -wheel->staticPos.ax;
        }
        else
        {
            wheel->relPos.ax = wheel->staticPos.ax;
        }

        wheel->cosax = cos(wheel->relPos.ax);
        wheel->sinax = sin(wheel->relPos.ax);
        setupCamber->value = wheel->staticPos.ax;
        setupCamber -> changed = false;
    }

    if ( setupPressure->changed ||car->carElt->setup.FRWeightRep.changed )
    {
        wheel->pressure = MIN(setupPressure->max, MAX(setupPressure->min, setupPressure->desired_value));
        patchLen = wheel->weight0 / (carElt->_tireWidth(index) * wheel->pressure);
        wheel->tireSpringRate = wheel->weight0 / (wheel->radius * (1.0f - cos(asin(patchLen / (2.0f * wheel->radius)))));
        setupPressure->value = wheel->pressure;
        setupPressure->changed = false;
        GfLogInfo(" # Car simu setup Pressure simuReWheelReConfig = %.2f\n", wheel->pressure);
    }

    if (setupOpLoad->changed)
    {
        wheel->opLoad = MIN(setupOpLoad->max, MAX(setupOpLoad->min, setupOpLoad->desired_value));
        setupOpLoad->value = wheel->opLoad;
        setupOpLoad->changed = false;
    }

    if (car->features & FEAT_COMPOUNDS && car->options->compounds)
    {
        wheel->tireSet = MIN(setupCompound->max, MAX(setupCompound->min, setupCompound->desired_value));
        GfLogInfo("# Tireset value = %d\n", wheel->tireSet);
        setupCompound->value = wheel->tireSet;
        setupCompound->changed = false;
        wheel->mu = wheel->muC[wheel->tireSet];
		wheel->muWet = wheel->muWetC[wheel->tireSet];
		wheel->Tinit = wheel->TinitC[wheel->tireSet];
		wheel->Topt = wheel->ToptC[wheel->tireSet];
		wheel->hysteresisFactor = wheel->hysteresisFactorC[wheel->tireSet];
		wheel->coolingFactor = wheel->coolingFactorC[wheel->tireSet];
		wheel->latHeatFactor = wheel->latHeatFactorC[wheel->tireSet];
		wheel->longHeatFactor = wheel->longHeatFactorC[wheel->tireSet];
		wheel->tireSpeedCoolFactor = wheel->tireSpeedCoolFactorC[wheel->tireSet];
		wheel->tireTreadDrainFactor = wheel->tireTreadDrainFactorC[wheel->tireSet];
        wheel->wearFactor = wheel->wearFactorC[wheel->tireSet];
        GfLogInfo("# SimuV4 tire compound changed mu = %.3f - hysteresis = %.2f - wear factor = %.7f\n", wheel->mu, wheel->hysteresisFactor,
                  wheel->wearFactor);
    }

    x0 = setupRideHeight->value;
    SimSuspReConfig(car, &(wheel->susp), index, wheel->weight0, x0);
    GfLogInfo("SimuV4 MU = %.3f - Topt = %.2f - Tinit = %.2f - wear = %.2f\n",
              wheel->mu, wheel->Topt - 273.15, wheel->Tinit - 273.15, wheel->wearFactor);
}

void SimWheelDamage(tWheel* wheel, tdble dmg)
{
	// total wheel damage
	tdble wheelDamage = 0.0;
	double impactDamage = 0;

	impactDamage = (dmg * 0.025 * SimDeltaTime);

	if (wheelDamage < 1.0)
	{
		wheelDamage += impactDamage;
		//wheel->bent_damage_x -= impactDamage;
		//wheel->bent_damage_z -= impactDamage;
		wheel->rotational_damage_x -= wheelDamage;
		wheel->rotational_damage_z -= impactDamage;
	}
	else
	{
		wheelDamage = 1.0;
	}
	//printf ("Bent: %f -> %f\n", exp(dmg), impactDamage);
}

double GetWheelDamage(tWheel* wheel)
{
	return wheel->rotational_damage_x;
}

void SimWheelUpdateRide(tCar *car, int index)
{
    tWheel *wheel = &(car->wheel[index]);
    tdble Zroad;

    // compute suspension travel
    RtTrackGlobal2Local(car->trkPos.seg, wheel->pos.x, wheel->pos.y, &(wheel->trkPos), TR_LPOS_SEGMENT);
    wheel->zRoad = Zroad = RtTrackHeightL(&(wheel->trkPos));

    // Wheel susp.x is not the wheel movement, look at SimSuspCheckIn, it becomes there scaled with
    // susp->spring.bellcrank, so we invert this here.

    tdble new_susp_x = (wheel->susp.x - wheel->susp.v * SimDeltaTime) / wheel->susp.spring.bellcrank;
    tdble max_extend =  wheel->pos.z - Zroad;
    wheel->rideHeight = max_extend;

    if (max_extend > new_susp_x + 0.01)
    {
        wheel->susp.state = SIM_WH_INAIR;
    }
    else
    {
        wheel->susp.state = 0;
    }

    if (max_extend < new_susp_x)
    {
        new_susp_x = max_extend;
    }

    tdble prex = wheel->susp.x;
    tdble prev = wheel->susp.v;
    wheel->susp.x = new_susp_x;

    if (car->options->alignment_damage && wheel->rotational_damage_x > 0.0)
    {
		/*if (index % 2)
		{
			wheel->staticPos.az = sin(wheel->staticPos.az - GetWheelDamage(wheel));
		}
		else
		{
			wheel->staticPos.az = sin(wheel->staticPos.az - GetWheelDamage(wheel));
		}

		if (wheel->rotational_damage_x >= 1.0)
		{
			wheel->rotational_damage_x = 1.0;
		}*/
    }

    // verify the suspension travel, beware, wheel->susp.x will be scaled by SimSuspCheckIn
    SimSuspCheckIn(&(wheel->susp));
    wheel->susp.v = (prex - wheel->susp.x) / SimDeltaTime;
    wheel->susp.a = (prev - wheel->susp.v) / SimDeltaTime;

    // update wheel brake
    SimBrakeUpdate(car, wheel, &(wheel->brake));

    // Option TCL ...
    if (car->features & FEAT_TCLINSIMU)
    {
        if (index == 3)
        {	// After using the values for the last wheel
            tEngine	*engine = &(car->engine);
            engine->TCL = 1.0;			// Reset the TCL accel command
        }
    }
    // ... Option TCL
}

void SimWheelUpdateForce(tCar *car, int index)
{
    tWheel *wheel = &(car->wheel[index]);
    tdble axleFz = wheel->axleFz;
    tdble vt, v, v2, wrl; // wheel related velocity
    tdble Fn, Ft;
    tdble waz;
    tdble CosA, SinA;
    tdble s, sa, sx, sy; // slip vector
    tdble stmp, F, Bx;
    tdble mu;
    tdble MaxTorqueSlipAngle;
    tdble tireCond = 1.0;
    tdble reaction_force = 0.0f;
    wheel->state = 0;

    // VERTICAL STUFF CONSIDERING SMALL PITCH AND ROLL ANGLES
    // update suspension force
    SimSuspUpdate(&(wheel->susp));
    // check suspension state
    wheel->state |= wheel->susp.state;

    if ( ((wheel->state & SIM_SUSP_EXT) == 0) && ((wheel->state & SIM_WH_INAIR) == 0) )
    {
        wheel->forces.z = axleFz + wheel->susp.force + wheel->axleFz3rd;

        if (car->features & FEAT_FIXEDWHEELFORCE)
        {
            wheel->susp.v -= wheel->susp.spring.bellcrank * SimDeltaTime * wheel->forces.z / wheel->mass;
        }
        else
        {
            wheel->susp.v -= wheel->susp.spring.bellcrank * SimDeltaTime * wheel->susp.force / wheel->mass;
        }

        if (wheel->forces.z < 0.0f)
        {
            wheel->forces.z = 0.0f;
        }
    }
    else
    {
        if (wheel->state & SIM_SUSP_EXT)
        {
            /* calculate the force needed to reach susp->spring.xMax
             * it becomes 0 from the 2. time step being extended
             * works even if both SIM_SUSP_EXT and SIM_WH_INAIR is set */
            wheel->forces.z = -wheel->susp.a * wheel->mass / wheel->susp.spring.bellcrank;
            wheel->susp.v = 0.0f;
        }
        else
        { //SIM_WH_INAIR is set, but SIM_SUSP_EXT is not
            wheel->forces.z = axleFz + wheel->susp.force + wheel->axleFz3rd;

            if (car->features & FEAT_FIXEDWHEELFORCE)
            {
                wheel->susp.v -= wheel->susp.spring.bellcrank * SimDeltaTime * wheel->forces.z / wheel->mass;
            }
            else
            {
                wheel->susp.v -= wheel->susp.spring.bellcrank * SimDeltaTime * wheel->susp.force / wheel->mass;
            }

            wheel->forces.z = 0.0f; /* zero for zero grip and prevent getting into the air */
        }
    }

    reaction_force = wheel->forces.z;

    // update wheel coord, center relative to GC
    wheel->relPos.z = - wheel->susp.x / wheel->susp.spring.bellcrank + wheel->radius;

    // HORIZONTAL FORCES
    waz = wheel->steer + wheel->staticPos.az;
    CosA = cos(waz);
    SinA = sin(waz);

    // tangent velocity.
    vt = wheel->bodyVel.x * CosA + wheel->bodyVel.y * SinA;
    v2 = wheel->bodyVel.x * wheel->bodyVel.x + wheel->bodyVel.y * wheel->bodyVel.y;
    v = sqrt(v2);

    // slip angle ? from [0 =  means the tire is going straight ahead (no slip)]
    //              to   [3-6 = there is slip]
    if (v < 0.000001f)
    {
        sa = 0.0f;
    }
    else
    {
        sa = atan2(wheel->bodyVel.y, wheel->bodyVel.x) - waz;
    }

    FLOAT_NORM_PI_PI(sa);

    // slip ratio = the spin velocity divided by its actual world velocity. A slip ratio of -1 means full braking lock; a ratio of 0 means the tire is spinning at the exact same rate as the road is disappearing below it. A slip ratio of 1 means it's spinning.
    wrl = wheel->spinVel * wheel->radius;

    if ((wheel->state & SIM_SUSP_EXT) != 0)
    {
        sx = sy = 0.0f;
    }
    else if (v < 0.000001f)
    {
        if (car->features & FEAT_SLOWGRIP)
        {
            sx = -wrl;
        }
        else
        {
            sx = wrl;
        }

        sy = 0.0f;
    }
    else
    {
        if (car->features & FEAT_SLOWGRIP)
        {
            sx = (vt - wrl) / MAX(fabs(vt), 1.0f); //avoid divergence
            sy = sin(sa);
        }
        else
        {
            sx = (vt - wrl) / fabs(vt);
            sy = sin(sa);
        }
    }

    Ft = 0.0f;
    Fn = 0.0f;
    s = sqrt(sx*sx+sy*sy);

    {
        // calculate _skid and _reaction for sound.
        if (v < 2.0f)
        {
            car->carElt->_skid[index] = 0.0f;
        }
        else
        {
            car->carElt->_skid[index] =  MIN(1.0f, (s*reaction_force*0.0002f));
        }

        car->carElt->_reaction[index] = reaction_force;
    }

    tdble casterCamber = sin(wheel->staticPos.ay) * wheel->steer;
    tdble camberDelta;

    if (index % 2)
    {
        wheel->relPos.ax = -wheel->staticPos.ax - casterCamber;
        camberDelta = -casterCamber;
    }
    else
    {
        wheel->relPos.ax = wheel->staticPos.ax - casterCamber;
        camberDelta = casterCamber;
    }

    stmp = MIN(s, 150.0f);

    // MAGIC FORMULA
    Bx = wheel->mfB * stmp;
    F = sin(wheel->mfC * atan(Bx * (1.0f - wheel->mfE) + wheel->mfE * atan(Bx))) * (1.0f + stmp * simSkidFactor[car->carElt->_skillLevel]);

    // load sensitivity
    mu = wheel->mu * (wheel->lfMin + (wheel->lfMax - wheel->lfMin) * exp(wheel->lfK * wheel->forces.z / wheel->opLoad));

    //temperature and degradation
    if (tyredeg_enabled(car))
	{
		tireCond = wheel->currentGripFactor;
		mu *= tireCond;
	}
	/*else
	{
		tireCond = 1;
		mu *= tireCond;
	}*/

	// wet weather mu modifier
	// using SimRain is incorrect for surface wetness, so this should be changed
	if (car->features & FEAT_COMPOUNDS)
	{
		mu += ((SimRain / 3)*(wheel->muWet - wheel->mu));
	}

    F *= wheel->forces.z * mu * wheel->trkPos.seg->surface->kFriction * (1.0f + 0.05f * sin((-wheel->staticPos.ax + camberDelta) * 18.0f));	/* coeff */

    /* aligning torque for force feedback */
    if ( (s > 0.000001f) && (v>1.5f) )
    {
        //maximal torque at wheel slip angle = TorqueRatio * wheel slip angle at maximal side force
        MaxTorqueSlipAngle = wheel->AlignTqFactor * asin(car->carElt->_wheelSlipOpt(index));
        wheel->torqueAlign = 0.025 * wheel->forces.z * mu * wheel->trkPos.seg->surface->kFriction * sin(2.0f * atan(sa / MaxTorqueSlipAngle));
    }
    else
        wheel->torqueAlign = 0.0f;

    // For debugging weather simultation on some tracks
#ifdef SD_DEBUG
    //GfLogDebug("Simu v2.1 kFriction : %f   ", wheel->trkPos.seg->surface->kFriction);
#endif

    wheel->rollRes = wheel->forces.z * wheel->trkPos.seg->surface->kRollRes;
    car->carElt->priv.wheel[index].rollRes = wheel->rollRes;

    if (s > 0.000001f)
    {
        // wheel axis based
		// MuFactor modifies grip based on axis - sx for longitudinal, sy for lateral
		Ft -= F * (sx * wheel->LongMuFactor) / s;
		Fn -= F * (sy * wheel->LatMuFactor) / s;
    }
    else
    {
        Ft -=F;
    }

    if ( !(car->features & FEAT_SLOWGRIP) )
    {
        FLOAT_RELAXATION2(Fn, wheel->preFn, 50.0f);
        FLOAT_RELAXATION2(Ft, wheel->preFt, 50.0f);
    }

    wheel->relPos.az = waz;

    wheel->forces.x = Ft * CosA - Fn * SinA;
    wheel->forces.y = Ft * SinA + Fn * CosA;
    wheel->spinTq = Ft * wheel->radius;
    wheel->sa = sa;
    wheel->sx = sx;
    wheel->tireSlip = stmp;

    wheel->feedBack.spinVel = wheel->spinVel;
    wheel->feedBack.Tq = wheel->spinTq;
    wheel->feedBack.brkTq = wheel->brake.Tq;

    car->carElt->_wheelFx(index) = wheel->forces.x;
    car->carElt->_wheelFy(index) = wheel->forces.y;
    car->carElt->_wheelFz(index) = wheel->forces.z;
    car->carElt->_wheelSlipNorm(index) = stmp;
    car->carElt->_wheelSlipSide(index) = sy*v;
    car->carElt->_wheelSlipAccel(index) = sx*v;
    car->carElt->_reaction[index] = reaction_force;
    car->carElt->_tyreEffMu(index) = mu;

    //tdble Work = 0.0;

    /* update tire temperature and degradation */
    if (tyredeg_enabled(car))
    {
        SimWheelUpdateTire(car, index);
    }

    // Option TCL ...
    if (car->features & FEAT_TCLINSIMU)
    {
        //tdble TCL_SlipScale = 1.00f;	// Make it be a parameter later
        //tdble TCL_AccelScale = 0.9f;	// Make it be a parameter later

        tEngine	*engine = &(car->engine); // Get engine

        if (sx < -car->TCL_SlipScale)          // Slip is over our limit
        {	// Store the TCL_Brake command for this wheel
            wheel->brake.TCL = -sx;
            // Store the minimum TCL_Accel command for the engine
            engine->TCL = (tdble) MIN(car->TCL_AccelScale * wheel->brake.TCL,engine->TCL);
            // fprintf(stderr,"sx: %.1f TCL: %.3f %%\n",sx,wheel->brake.TCL);
        };
    }
    // ... Option TCL

    // Option ABS ...
    if (car->features & FEAT_ABSINSIMU)
    {
        //tdble ABS_SlipScale = 0.1f;		// Make it be a parameter later
        //tdble ABS_BrakeScale = 1.0f;	// Make it be a parameter later

        // If slip is over the limit, reduce brake command for this wheel
        if (sx > car->ABS_SlipScale)
            wheel->brake.ABS = (tdble) MAX(0.0,MIN(1.0,1 - car->ABS_BrakeScale * sx));
        else
            wheel->brake.ABS = 1.0f;
    }
    // ... Option ABS
}

void SimWheelUpdateRotation(tCar *car)
{
    int i;
    tWheel *wheel;
    tdble deltan;
    tdble cosaz, sinaz;

    tdble maxslip = 0.0;

    for (i = 0; i < 4; i++)
    {
        wheel = &(car->wheel[i]);
        /*calculate gyroscopic forces*/
        cosaz = cos(wheel->relPos.az);
        sinaz = sin(wheel->relPos.az);

        if( (i == 0) || (i == 1) )
        {
            wheel->torques.y = wheel->torques.x * sinaz;
            wheel->torques.x = wheel->torques.x * cosaz;
        }
        else
        {
            wheel->torques.x = wheel->torques.y =0.0;
        }

        deltan = -(wheel->in.spinVel - wheel->prespinVel) * wheel->I / SimDeltaTime;
        wheel->torques.x -= deltan * wheel->cosax *sinaz;
        wheel->torques.y += deltan * wheel->cosax *cosaz;
        wheel->torques.z = deltan * wheel->sinax;
        /*update rotation*/
        wheel->spinVel = wheel->in.spinVel;

        if ( (car->features & FEAT_SLOWGRIP) && (wheel->brake.Tq <= 1.0) && (car->ctrl->accelCmd * car->transmission.clutch.transferValue < 0.05) )
        {
            /* prevent wheelspin value oscillating around wheel tangential velocity */
            tdble waz = wheel->steer + wheel->staticPos.az;
            tdble vt = wheel->bodyVel.x * cos(waz) + wheel->bodyVel.y * sin(waz);
            tdble wrl = wheel->spinVel * wheel->radius;
            tdble oldwrl = wheel->prespinVel * wheel->radius;
            if( (vt-wrl)*(vt-oldwrl) < 0.0 ) {
                wheel->spinVel = vt / wheel->radius;
            }

            wheel->prespinVel = wheel->spinVel;
        }
        else
        {
            FLOAT_RELAXATION2(wheel->spinVel, wheel->prespinVel, 50.0f);
        }

        wheel->relPos.ay += wheel->spinVel * SimDeltaTime;
        FLOAT_NORM_PI_PI(wheel->relPos.ay);
        car->carElt->_wheelSpinVel(i) = wheel->spinVel;

        // Option TCL ...
        if (car->features & FEAT_TCLINSIMU)
        {
            if (maxslip < wheel->brake.TCL)
                maxslip = wheel->brake.TCL;
        }
        // ... Option TCL
    }

    // Option TCL ...
    if (maxslip > 0.0)
    {
        for (i = 0; i < 4; i++)
        {
            wheel = &(car->wheel[i]);
            if (wheel->brake.TCL != maxslip)
                wheel->brake.TCL = 0.0;
        }
    }
    // ... Option TCL
}

void SimUpdateFreeWheels(tCar *car, int axlenb)
{
    int i;
    tWheel *wheel;
    tdble BrTq;		// brake torque
    tdble ndot;		// rotation acceleration
    tdble I;

    for (i = axlenb * 2; i < axlenb * 2 + 2; i++)
    {
        wheel = &(car->wheel[i]);

        I = wheel->I + car->axle[axlenb].I / 2.0f;

        ndot = SimDeltaTime * wheel->spinTq / I;
        wheel->spinVel -= ndot;

        BrTq = (tdble)(- SIGN(wheel->spinVel) * wheel->brake.Tq);
        ndot = SimDeltaTime * BrTq / I;

        if (fabs(ndot) > fabs(wheel->spinVel))
        {
            ndot = -wheel->spinVel;
        }

        wheel->spinVel += ndot;
        wheel->in.spinVel = wheel->spinVel;
    }
}

void SimWheelUpdateTire(tCar *car, int index)
{
    if (car->carElt->info.skillLevel <= 3)
    {
        return;
    }

    tWheel *wheel = &(car->wheel[index]);

    tdble normalForce = wheel->forces.z;
    tdble slip = wheel->tireSlip;
	tdble lateralForce = fabs(wheel->forces.y);
	tdble longForce = fabs(wheel->forces.x);
	tdble absForce2 = fabs(normalForce * 0.5);
	//tdble slipRatio = wheel->spinVel * wheel->radius;
	tdble latMod = 0;
	tdble longMod = 0;
	tdble minOptTemp = wheel->Topt - 20;
	tdble wheelSpeed = fabs(wheel->spinVel * wheel->radius);
	tdble deltaTemperature = wheel->Ttire - Tair;
	tdble drainRate;
	tdble drainCooling;
	double gripLoss50 = 0.99;
	double gripLoss75 = 0.95;
	double gripLoss100 = 0.80;
	bool isPunctured = false;

	// Tire Tread Drain Factor is a very simple/abstract approximation of a tire's ability
	// to drain water from the tire as it passes through a wet surface.
	if (SimRain > 0)
	{
		drainRate = wheel->tireTreadDrainFactor / SimRain;
		drainCooling = SimRain / (wheel->tireTreadDrainFactor + 1);
	}
	else
	{
		drainRate = 1;
		drainCooling = 0;
	}

    if (normalForce > wheel->opLoad)
    {
        normalForce -= (wheel->pressure / 5894.6) * fabs(wheel->camber * M_PI * 360.0);
    }
    else
    {
        normalForce += (wheel->pressure / 3894.6) * fabs(wheel->camber * M_PI * 360.0);
    }

	// Normalize slip. Not realistic, but prevents extreme spiking when high wheelspin occurs
	// when trying to recover from bumpy surfaces such as gravel traps.
	if (slip >= 1)
	{
		slip = 1;
	}
	else if (slip <= -1)
	{
		slip = -1;
	}
	else
	{
		slip = slip;
	}

    // Calculate factor for energy which is turned into heat, according papers this seems to be pretty constant
    // for a specific construction and constant slip (empiric value with model validation, called hysteresis).
    // A value of 0.1 is available in papers, so for 10% slip I head for 0.1, where 0.05 come from rolling and
    // the other 0.05 from slip. Additionaly the hysteresis goes down with wear.
    tdble elasticity = (wheel->pressure - SimAirPressure)/(wheel->currentPressure - SimAirPressure);
    tdble hysteresis = (0.05f * (sqrt(1.0f - (wheel->currentWear * 0.25))) * elasticity + 0.5f * (slip * 2)) * wheel->hysteresisFactor;

    // Calculate energy input for the tire
    tdble energyGain = normalForce * wheelSpeed * SimDeltaTime * hysteresis;

	// Modifiers for energy input from lateral and longitudinal forces.
	latMod = ((lateralForce * absForce2) * wheel->latHeatFactor) * SimDeltaTime * 0.0004;
	longMod = ((longForce * absForce2) * wheel->longHeatFactor) * SimDeltaTime * 0.0004;

	tdble energyMod = (latMod + longMod);

	tdble lockMod = 0;

    // Calculate energy loss of the tire (convection, convection model approximation from papers,
    // 5.9f + airspeed*3.7f [W/(meter*meter*Kelvin)]). Because the model is linear it is reasonable to apply
    // it to the whole tire at once (no subdivision in elements).
	tdble energyLoss = (5.9f + wheelSpeed * 3.7f) * deltaTemperature * wheel->tireConvectionSurface * SimDeltaTime * (1 + (wheel->tireSpeedCoolFactor * 1.5) + (drainCooling * 4));

	tdble deltaEnergy = (lockMod + energyMod + energyGain) - energyLoss;

    // Calculate heat capacity. Basically the heat capacity of the gas in the tire accounts for a "normal" TORCS tire
    // around 2 percent of the whole tire heat capacity, so one could neglect this. I put it into the model because it:
    // - is more than 1 percent
    // - you could think of some tire build where this ratio is significantly higher (e.g. 4 percent)
    //
    // Because the tire is a sufficiently rigid volume we assume for the isochoric process (constant volume, variable
    // pressure and temperature).
    //
    // Material properties: The heat capacity of nitorgen N2 is "almost" constant over our temperature ranges:
    // 29.1 (at 25°C) vs 29.3 (at 100°C) [J/(mol*Kelvin)]. So this is assumed constant, error less than 1 percent.
    // But this does not apply for Rubber (NR):
    // 1.982 (at 20°C) [J/(g*Kelvin)] vs 2.121 (at 100°C), so this is more than 6 percent.
    tdble tireCelsius = wheel->Ttire - 273.15f;
    tdble cpRubber = 2009.0f - 1.962f * tireCelsius + 3.077f * tireCelsius * tireCelsius / 100.0f;

    // Calculate the actual rubber mass. This is some base mass (constant) plus the mass of the tread (dynamic,
    // wears down).
    tdble actualRubberMass = wheel->treadMass*(1.0f - wheel->currentWear) + wheel->baseMass;

    // Calculate actual heat capacity
    const tdble cvNitrogen = 1041.0f - 296.8f;	// cv = cp - R, [J/(kg*Kelvin)]
    tdble heatCapacity = cpRubber * actualRubberMass + cvNitrogen * wheel->tireGasMass;

    // Energy transfer into the tire
    wheel->Ttire += deltaEnergy / heatCapacity;

	// Base cooling from lack of force
	// static cooling, slowly cool tire down with low loads
	wheel->Ttire -= ((wheel->coolingFactor) * (fabs(wheel->Ttire - Tair) * SimDeltaTime));

    if (wheel->Ttire > 473.15f)
        wheel->Ttire = 473.15f;

	// Effect of temperature on live tire pressure.
	// Note that we compare the live temperature and the current ambient temperature together.
	// This is because some series/car types use tire warmers, which would make the initial
	// tire temperature much closer to optimal.
	// According to tire data from a leading GT tire manufacturer, tire pressure goes up by ~0.7 PSI for every 10 F (~5.56 C).
    //wheel->currentPressure = ((wheel->Ttire + ((Tair - 273.15) * 1.50)) * wheel->pressure) / Tair;
	wheel->currentPressure = wheel->Ttire / wheel->Tinit * wheel->pressure;

    // Wear
    double deltaWear = (wheel->currentPressure - SimAirPressure) * slip * wheelSpeed * SimDeltaTime * (energyMod + normalForce)
            * wheel->wearFactor * 0.00000000000009;

    wheel->currentWear += deltaWear;
    if (wheel->currentWear > 1.0f)
        wheel->currentWear = 1.0f;

    // Graining
	tdble grainTemperature = (wheel->Topt - wheel->Ttire) * 3.0f / 4.0f + wheel->Ttire;
    tdble deltaGraining = (grainTemperature - wheel->Ttire) * deltaWear;
    if (deltaGraining > 0.0f)
    {
        deltaGraining *= wheel->currentWear;
    }

    wheel->currentGraining += deltaGraining;
    if (wheel->currentGraining > 1.0f)
    {
        wheel->currentGraining = 1.0f;
    }
    else if(wheel->currentGraining < 0.0f)
    {
        wheel->currentGraining = 0.0f;
    }

	// Temperature window.
	tdble di;

	// Ratio modifier for when temp is under minimal optimal
	// operating temp (f.e. below 70 C for a 90 deg optimal)
	tdble diRatio;
	diRatio = (wheel->Ttire - Tair) / (Tair - minOptTemp) * 0.125;

	// Racing tires typically have a roughly 10-20C window
	// where they achieve most of their optimal grip.
	// When within this "ideal window", grip changes are less extreme.
	if (wheel->Ttire < (wheel->Topt - 20))
	{
		di = ((wheel->Ttire - minOptTemp) / (minOptTemp - Tair)) + diRatio;
	}
	else if (wheel->Ttire <= wheel->Topt)
	{
		di = (wheel->Ttire - wheel->Topt) / (wheel->Topt - minOptTemp) * 0.125;
	}
	else
	{
		di = (wheel->Ttire - wheel->Topt) / (wheel->Topt - Tair);
	}

	wheel->currentGripFactor = ((1.0f - (MIN((di*di), 1.0f))) / 4.0f + 3.0f / 4.0f) * (1.0f - wheel->currentGraining / 10.0f);

	// Tire grip drop-off from wear
	if (isPunctured == false)
	{
		if (wheel->currentWear < 0.25)
		{
			wheel->currentGripFactor *= 1;
		}
		else if ((wheel->currentWear >= 0.25) && (wheel->currentWear < 0.5))
		{
			wheel->currentGripFactor *= 1 - (((wheel->currentWear - 0.25) / 0.5) * (1 - gripLoss50));
		}
		else if ((wheel->currentWear >= 0.5) && (wheel->currentWear < 0.75))
		{
			wheel->currentGripFactor *= gripLoss50 - (((wheel->currentWear - 0.5) / 0.25) * (1 - gripLoss75));
		}
		else
		{
			wheel->currentGripFactor *= gripLoss75 - (((wheel->currentWear - 0.75) / 0.25) * (1 - gripLoss100));
		}
	}

	// Simulate tire punctures. Drop the grip to a low %
	// because metal-on-ground (ie. rim on road) contact
	// still generates some traction, just not a lot.
	if (wheel->currentWear >= 1.0 || (wheel->Ttire >= 473.14))
	{
		if (isPunctured == false)
		{
			wheel->relPos.z += (wheel->radius)*(-0.25);
		}
        wheel->currentWear = 1.0;
		wheel->currentGripFactor = 0.25;
		wheel->currentPressure = 0.0;
		isPunctured = true;
	}
	else
	{
		isPunctured = false;
	}

    car->carElt->_tyreCondition(index) = wheel->currentGripFactor;
    car->carElt->_tyreT_in(index) = wheel->Ttire;
    car->carElt->_tyreT_mid(index) = wheel->Ttire;
    car->carElt->_tyreT_out(index) = wheel->Ttire;
    car->carElt->_tyreTreadDepth(index) =  1.0 - wheel->currentWear;
    car->carElt->_tyreCurrentPressure(index) = wheel->currentPressure;
    car->carElt->_tyreCompound(index) = wheel->tireSet;
    GfLogDebug("SimuV4 wheel tyre updated Grip = %.2f - Temperature = %.3f - Graining = %.5f - Wear = %.5f - Optimal = %3.2f\n",
                  wheel->currentGripFactor, wheel->Ttire, wheel->currentGraining, wheel->currentWear, car->carElt->_tyreT_opt(index));
}

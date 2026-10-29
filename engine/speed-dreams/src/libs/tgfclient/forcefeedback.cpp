/***************************************************************************
                    webserver.h -- Interface file for The Gaming Framework
                             -------------------
    created              : 04/11/2015
    copyright            : (C) 2015 by MadBad
    email                : madbad82@gmail.com
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
        The Gaming Framework API (client part).
    @author     <a href=mailto:madbad82@gmail.com>MadBad</a>
*/

#include <playerpref.h>
#include <tgf.h>
#include "tgfclient.h"
#include "forcefeedback.h"

bool timeLogged = false;
clock_t effectStart = std::clock();
clock_t effectCurTime = std::clock();

float prevSteerCmd;
int prevDirection = 1;

int filterPositiveNumbers (int number){
    if (number > 0){
        return number;
    }else{
        return 0;
    }
}


ForceFeedbackManager::ForceFeedbackManager(){

    this->initialized = false;

}
ForceFeedbackManager::~ForceFeedbackManager(){
    // iterate on the first map
    typedef std::map<std::string, std::map<std::string, int> >::iterator it_type;
    for(it_type iterator = this->effectsConfig.begin(); iterator != this->effectsConfig.end(); ++iterator) {
        // iterator->first = key (effect type name)
        // iterator->second = value (second map)

        //clear the sub-map
        iterator->second.clear();
    }

    //clear the map
    effectsConfig.clear();

}
void ForceFeedbackManager::readConfiguration(const std::string &carName){
    //use the user specified configuration for the specified car
    //or use the user specified global configuration
    //or use the default configuration for the car
    //or use the default global configuration
    this->carName = carName;

    std::string configFileUrl = GfLocalDir();
    configFileUrl.append(HM_PREF_FILE);

    std::string effectsSectionPathDefault = "forceFeedback/default/effectsConfig";

    std::string effectsSectionPathSpecific = "forceFeedback/";
    effectsSectionPathSpecific.append(carName);
    effectsSectionPathSpecific.append("/effectsConfig");

    //remove the previous stored configuration (if any)
    this->effectsConfig.clear();

    //add some needed default configuration
    this->effectsConfig["autocenterEffect"]["_previousValue"] = 1;
    this->effectsConfig["bumpsEffect"]["_initialized"] = 0;

    //read the default configuration (this should always exist)
    this->readConfigurationFromFileSection(configFileUrl, effectsSectionPathDefault);

    //keep a copy of the default config
    this->effectsConfigDefault = this->effectsConfig;

    //merge the current configuration with the read car specific configuration
    //if there is one
    void *paramHandle = GfParmReadFile(configFileUrl, GFPARM_RMODE_STD);
    if(GfParmExistsSection(paramHandle, effectsSectionPathSpecific.c_str())){
        this->readConfigurationFromFileSection(configFileUrl, effectsSectionPathSpecific);
    }
    GfParmReleaseHandle(paramHandle);

    //now we are correctly initialized
    this->initialized = true;
}
void ForceFeedbackManager::readConfigurationFromFileSection(const std::string &configFileUrl, const std::string &effectsSectionPath){

    std::vector<std::string> effectSectionsPath;
    std::string subSectionPath;
    std::string subSectionName;
    int paramValue = 0;

    //open the file
    void *paramHandle = GfParmReadFile(configFileUrl, GFPARM_RMODE_STD);

    //for each section on the effectConfig section
    if (GfParmListSeekFirst(paramHandle, effectsSectionPath.c_str()) == 0) {
        do {
            subSectionName = GfParmListGetCurEltName(paramHandle, effectsSectionPath.c_str());
            subSectionPath = effectsSectionPath + "/" + subSectionName;

            //get a list of the params in this section
             std::vector<std::string> paramsInSection = GfParmListGetParamsNamesList(paramHandle, subSectionPath.c_str());

            GfLogInfo ("=== (%s) ===\n", subSectionPath.c_str());

            //for each param
            for (unsigned int i = 0; i < paramsInSection.size(); i++)
            {
                paramValue = (int)GfParmGetNum(paramHandle, subSectionPath.c_str(), paramsInSection[i].c_str(), "null", 0);
                GfLogInfo ("(%s): (%i)\n", paramsInSection[i].c_str(), paramValue);
                this->effectsConfig[subSectionName.c_str()][paramsInSection[i]] = paramValue;
             }

        } while (GfParmListSeekNext(paramHandle, effectsSectionPath.c_str()) == 0);
    }
    GfParmReleaseHandle(paramHandle);


}
void ForceFeedbackManager::saveConfiguration(){
    std::string effectsSectionPathSpecific = "/forceFeedback/";
    effectsSectionPathSpecific.append(carName);

    //open the file
    void *paramHandle = GfParmReadFileLocal(HM_PREF_FILE, GFPARM_RMODE_STD);

    //delette the current car specific section if it exist
    if(GfParmExistsSection(paramHandle, effectsSectionPathSpecific.c_str())){
        //delette the section
        //GfParmListRemoveElt (void *handle, const char *path, const char *key)
        GfParmListClean(paramHandle, effectsSectionPathSpecific.c_str());
    }

    effectsSectionPathSpecific.append("/effectsConfig");
    //now recreate the whole car section

    // iterate on the first map
    typedef std::map<std::string, std::map<std::string, int> >::iterator it_type;
    for(it_type iterator = this->effectsConfig.begin(); iterator != this->effectsConfig.end(); ++iterator) {
        // iterator->first = key (effect type name)
        // iterator->second = value (second map)

        // now iterate on the second map
        typedef std::map<std::string, int>::iterator it_type2;
        for(it_type2 iterator2 = iterator->second.begin(); iterator2 != iterator->second.end(); ++iterator2) {
            // iterator2->first = key (effect parameter name)
            // iterator2->second = value (effect value)

            std::string effectPath;

            //if the param name start with a "_" it is an internal one and so should not be saved on the pref file
            if ( iterator2->first.compare(0,1,"_") == 0){
                continue;
            }

            //are we saving car specific settings o global ones?
            if ( iterator->first == "globalEffect"){
                //global settings
                //save global setting in the default section
                effectPath.append("/forceFeedback/default/effectsConfig/");
                effectPath.append(iterator->first);
            }else{
                //car specific settings

                //is the value the same as the global default config?
                //if yes do not save in the car specific (it is already stored in the gloabl config)
                //so if in the future we change the global value the change will be used by all cars that has no (different) specific value
                if(	this->effectsConfigDefault[iterator->first][iterator2->first] == iterator2->second){
                    continue;
                }

                //save other settings in car specific section
                effectPath.append(effectsSectionPathSpecific);
                effectPath.append("/");
                effectPath.append(iterator->first);
            }


            //remove the first slash
            effectPath.erase(0,1);

            GfParmSetNum(paramHandle, effectPath.c_str(), iterator2->first.c_str(), "", iterator2->second);

        }
    }

    //write changes
    GfParmWriteFile(NULL,paramHandle,"preferences");
    GfParmReleaseHandle(paramHandle);

}
int ForceFeedbackManager::updateForce(tCarElt* car, tSituation *s){

    this->force = 0;

    //calculate autocenter if enabled
    if (this->effectsConfig["autocenterEffect"]["enabled"]){
        this->force = this->autocenterEffect(car, s);
        GfLogDebug("After autocenter: (%i)\n", this->force);
    }

    //calculate engine revving if enabled
    if (this->effectsConfig["engineRevvingEffect"]["enabled"]){
        this->force += this->engineRevvingEffect(car, s);
        GfLogDebug("After engineRevving: (%i)\n", this->force);
    }

    //calculate low speed constant force if enabled
    if (this->effectsConfig["lowSpeedConstantForceEffect"]["enabled"]){
        this->force += this->lowSpeedConstantForceEffect(car, s);
        GfLogDebug("After lowSpeedConstantForce: (%i)\n", this->force);
    }

    //calculate bump
    //this->force += this->bumpsEffect(car, s);
    //GfLogDebug("After bump: (%i)\n", this->force);

    //apply global effect multiplier
    //multiply
    int multiplier = this->effectsConfig["globalEffect"]["multiplier"];
    this->force = (this->force * multiplier) / 100;

    //apply global minimum effect
    // minimum force will be percentage of maximum force
    int minimum = ((multiplier * this->effectsConfig["globalEffect"]["minimum"]) / 100) * 32760 / 100;

    if (this->force > 0)
        this->force += minimum;
    else if (this->force < 0)
        this->force -= minimum;

    //reverse if needed
    if(this->effectsConfig["globalEffect"]["reverse"] == 1){
        this->force = -1 * this->force;
    }

    //check that force is in correct range
    if (this->force > 32760) this->force = 32760;
    if (this->force < -32760) this->force = -32760;

    GfLogDebug("Final force: (%i)\n", this->force);

    return this->force;

}

int ForceFeedbackManager::autocenterEffect(tCarElt *car, tSituation *s)
{
    if (car->_speed_xy < 4)
        return 0;

    /*
     * car->steerLock
     * */

    //force acting on the front wheels
    const tdble H = 450.0;
    tdble TqAlign = car->_steerTqAlign;
    TqAlign = H * TqAlign / (fabs(TqAlign) + H);
    const int frontwheelsmultiplier = this->effectsConfig["autocenterEffect"]["frontwheelsmultiplier"];
    int effectForce = TqAlign * frontwheelsmultiplier / 100;

    //force action on the back wheels
    int rearwheelsmultiplier = this->effectsConfig["autocenterEffect"]["rearwheelsmultiplier"];
    effectForce += car->_wheelFy(REAR_RGT) * rearwheelsmultiplier / 100;
    effectForce += car->_wheelFy(REAR_LFT) * rearwheelsmultiplier / 100;

    //smooth
    const int previousValue = this->effectsConfig["autocenterEffect"]["_previousValue"];
    const int smoothing = this->effectsConfig["autocenterEffect"]["smoothing"];
    effectForce = (effectForce + (previousValue * smoothing / 100)) / ((smoothing / 100) + 1);

    //remember the current value for the next run
    this->effectsConfig["autocenterEffect"]["_previousValue"] = effectForce;

#if 0
    //we need to store the sign of the force
    int sign = (effectForce > 0) - (effectForce < 0); //not used for the moment (by Xavier 11/11/2017

    //be sure this is a positive number
    effectForce = effectForce * sign;

    //we use an inverse exponential function to have a stronger force at low values and a lighetr one a bigger values
    effectForce = (int)((pow((double) effectForce, (double) 1/2) * 120) * sign);
#endif

    return effectForce;
}

int ForceFeedbackManager::bumpsEffect(tCarElt* car, tSituation *s)
{
    /*
     * wheel
     *
     * */
    int effectForce = 0;
/*
    GfLogDebug("\n\n");
    GfLogDebug("(%f)\n",car->_wheelFz(0));
    GfLogDebug("(%f)\n",car->_wheelFz(1));
    GfLogDebug("(%f)\n",car->_wheelFz(2));
    GfLogDebug("(%f)\n",car->_wheelFz(3));
*/
    if(this->effectsConfig["bumpsEffect"]["initialized"] == 0)
    {
        this->effectsConfig["bumpsEffect"]["_previousWheelZForce0"] = car->_wheelFz(0);
        this->effectsConfig["bumpsEffect"]["_previousWheelZForce1"] = car->_wheelFz(1);
        this->effectsConfig["bumpsEffect"]["_previousWheelZForce2"] = car->_wheelFz(2);
        this->effectsConfig["bumpsEffect"]["_previousWheelZForce3"] = car->_wheelFz(3);
        this->effectsConfig["bumpsEffect"]["initialized"] = 1;
    }

    //fl/fr/rl/rr
/*
    int left = filterPositiveNumbers(this->effectsConfig["bumpsEffect"]["previousWheelZForce0"] - car->_wheelFz(0)) +
                filterPositiveNumbers(this->effectsConfig["bumpsEffect"]["previousWheelZForce2"] - car->_wheelFz(2));

    int right = filterPositiveNumbers(this->effectsConfig["bumpsEffect"]["previousWheelZForce1"] - car->_wheelFz(1)) +
                filterPositiveNumbers(this->effectsConfig["bumpsEffect"]["previousWheelZForce3"] - car->_wheelFz(3));
*/

    int left = filterPositiveNumbers(this->effectsConfig["bumpsEffect"]["previousWheelZForce0"] - car->_wheelFz(0));
    int right = filterPositiveNumbers(this->effectsConfig["bumpsEffect"]["previousWheelZForce1"] - car->_wheelFz(1));



    this->effectsConfig["bumpsEffect"]["_previousWheelZForce0"] = car->_wheelFz(0);
    this->effectsConfig["bumpsEffect"]["_previousWheelZForce1"] = car->_wheelFz(1);
    this->effectsConfig["bumpsEffect"]["_previousWheelZForce2"] = car->_wheelFz(2);
    this->effectsConfig["bumpsEffect"]["_previousWheelZForce3"] = car->_wheelFz(3);


    GfLogDebug("\n\n");
    GfLogDebug("(%i)\n",left);
    GfLogDebug("(%i)\n",right);

    if( left > 4000)
    {
        effectForce = -10000;
    }
    else if (right > 4000)
    {
        effectForce = 10000;
    }

/*
    GfLogDebug("\n\n");
    GfLogDebug("(%f)\n",car->_ride(0));
    GfLogDebug("(%f)\n",car->_ride(1));
    GfLogDebug("(%f)\n",car->_ride(2));
    GfLogInfo("(%f)\n",car->_ride(3));
*/
/*
    if(this->effectsConfig["bumpsEffect"]["initialized"] == 0){
        this->effectsConfig["bumpsEffect"]["previousWheelRide0"] = (int) (car->_ride(0)*1000);
        this->effectsConfig["bumpsEffect"]["previousWheelRide1"] = (int) (car->_ride(1)*1000);
        this->effectsConfig["bumpsEffect"]["previousWheelRide2"] = (int) (car->_ride(2)*1000);
        this->effectsConfig["bumpsEffect"]["previousWheelRide3"] = (int) (car->_ride(3)*1000);
        this->effectsConfig["bumpsEffect"]["initialized"] = 1;
    }

    //fl/fr/rl/rr

    int left = this->effectsConfig["bumpsEffect"]["previousWheelRide0"] - (car->_ride(0)*1000) +
                this->effectsConfig["bumpsEffect"]["previousWheelRide2"] - (car->_ride(2)*1000);

    int right = this->effectsConfig["bumpsEffect"]["previousWheelRide1"] - (car->_ride(1)*1000) +
                this->effectsConfig["bumpsEffect"]["previousWheelRide3"] - (car->_ride(3)*1000);

    this->effectsConfig["bumpsEffect"]["previousWheelRide0"] = (int) (car->_ride(0)*1000);
    this->effectsConfig["bumpsEffect"]["previousWheelRide1"] = (int) (car->_ride(1)*1000);
    this->effectsConfig["bumpsEffect"]["previousWheelRide2"] = (int) (car->_ride(2)*1000);
    this->effectsConfig["bumpsEffect"]["previousWheelRide3"] = (int) (car->_ride(3)*1000);


    GfLogDebug("\n\n");
    GfLogDebug("(%i)\n",left);
    GfLogDebug("(%i)\n",right);
*/
    return effectForce;

}

int ForceFeedbackManager::engineRevvingEffect(tCarElt* car, tSituation *s)
{
    int effectForce;
    //double changeTimeInterval = 20; Not used for the moment (by Xavier 11/11/2017)

    if(timeLogged != true)
    {
        effectStart = std::clock();
        timeLogged = true;

        GfLogDebug("StartTime: (%f)\n",(double)effectStart);
        GfLogDebug("###############new time\n");
        GfLogDebug("StartTime: (%f)\n",(double)effectStart);
    }

    effectCurTime = std::clock();

    double timeDiff = (((double)effectCurTime - (double)effectStart )) / CLOCKS_PER_SEC * 1000;

    GfLogDebug("CurTime: (%f)\n", (double)effectCurTime);
    GfLogDebug("StartTime: (%f)\n",(double)effectStart);
    GfLogDebug("TimeDiff: (%f)\n", timeDiff);

    int &prevsign = this->effectsConfig["engineRevvingEffect"]["_previousSign"];

    if (timeDiff > 40)
    {
        prevsign = prevsign > 0 ? -1 : 1;
        effectStart = std::clock();
    }

    GfLogDebug("Sign: (%i)\n", prevsign);

    int rpm = car->_enginerpm,
        mult = this->effectsConfig["engineRevvingEffect"]["multiplier"],
        div = rpm * 2 * prevsign * mult;

    //force acting on the front wheels
    effectForce = div ? 50000 / div / 100 : 0;

    GfLogDebug("RPM: (%i)\n", (int)car->_enginerpm);
    GfLogDebug("Efect: (%i)\n", effectForce);

    return effectForce;

}

int ForceFeedbackManager::lowSpeedConstantForceEffect(tCarElt *car, tSituation *s)
{
    //we need to store the sign of the force
    int sign = ((car->_steerTqCenter - prevSteerCmd) > 0) - ((car->_steerTqCenter - prevSteerCmd) < 0);

    GfLogDebug("steerTqCenter: (%f)\n", car->_steerTqCenter);
    GfLogDebug("prevSteerCmd: (%f)\n", prevSteerCmd);

    int prevDirectionSign = (prevDirection > 0) - (prevDirection < 0);

    GfLogDebug("Sign: (%d)\n", sign);
    GfLogDebug("Direction sign: (%d)\n", prevDirectionSign);

    prevDirection = prevDirection + sign;
    if (prevDirection > 7) prevDirection = 7;
    if (prevDirection < -7) prevDirection = -7;

    GfLogDebug("Direction score: (%d)\n", prevDirection);

    int effectForce = 0;

    //force calculation
    if (car->_speed_xy < this->effectsConfig["lowSpeedConstantForceEffect"]["maxSpeedAtWhichForceIsApplied"])
    {
        effectForce = this->effectsConfig["lowSpeedConstantForceEffect"]["maxForce"] / 8 * abs(prevDirection) /
                (pow(car->_speed_xy, 0.5f) + 1) * prevDirectionSign;
    }

    prevSteerCmd = car->_steerTqCenter;

    GfLogDebug("SPEED: (%i)\n", (int)car->_speed_xy);
    GfLogDebug("Efect: (%i)\n", effectForce);

    return effectForce;
}

//initialize the force feedback
TGFCLIENT_API ForceFeedbackManager forceFeedback;

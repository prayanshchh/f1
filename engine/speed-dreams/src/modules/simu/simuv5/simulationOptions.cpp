/* -*- Mode: C++; -*- */
// copyright (c) 2005 by Christos Dimitrakakis <dimitrak@idiap.ch>
/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/

#include "simulationOptions.h"
#include "options.h"
#include "car.h"

SimulationOptions::SimulationOptions()
{
    option_list.AddOption (PRM_DAMAGE_TYRES, &tyre_damage, false);
    option_list.AddOption (PRM_DAMAGE_SUSPENSION, &suspension_damage, false);
    option_list.AddOption (PRM_DAMAGE_ALIGNMENT, &alignment_damage, false);
    option_list.AddOption (PRM_DAMAGE_AERO, &aero_damage, false);
    option_list.AddOption (PRM_DAMAGE_ENGINE, &engine_damage, false);
    option_list.AddOption (PRM_MODEL_AEROFLOW, &aeroflow_model, SIMPLE);
    option_list.AddOption (PRM_MODEL_TYRE_TEMPERATURE, &tyre_temperature, false);
    option_list.AddOption (PRM_MODEL_TYRE_COMPOUNDS, &compounds, false);
    option_list.AddOption (PRM_MODEL_ENGINE_TEMPERATURE, &engine_temperature, false);
    option_list.AddOption (PRM_MODEL_AERO_FACTOR, &aero_factor, 4.0f);
}

void SimulationOptions::SetFromSkill (tSkillLevel skill)
{
    switch (skill) {
    case ARCADE:
        option_list.Set(PRM_DAMAGE_TYRES, false);
        option_list.Set(PRM_DAMAGE_SUSPENSION, false);
        option_list.Set(PRM_DAMAGE_ALIGNMENT, false);
        option_list.Set(PRM_DAMAGE_AERO, false);
        option_list.Set(PRM_DAMAGE_ENGINE, false);
        option_list.Set(PRM_MODEL_TYRE_TEMPERATURE, false);
        option_list.Set(PRM_MODEL_TYRE_COMPOUNDS, true);
        option_list.Set(PRM_MODEL_ENGINE_TEMPERATURE, false);
        option_list.Set(PRM_MODEL_AERO_FACTOR, 4.0f);
        break;
    case SEMI_ROOKIE:
        option_list.Set(PRM_DAMAGE_TYRES, false);
        option_list.Set(PRM_DAMAGE_SUSPENSION, false);
        option_list.Set(PRM_DAMAGE_ALIGNMENT, false);
        option_list.Set(PRM_DAMAGE_AERO, true);
        option_list.Set(PRM_DAMAGE_ENGINE, false);
        option_list.Set(PRM_MODEL_TYRE_TEMPERATURE, false);
        option_list.Set(PRM_MODEL_TYRE_COMPOUNDS, true);
        option_list.Set(PRM_MODEL_ENGINE_TEMPERATURE, false);
        option_list.Set(PRM_MODEL_AERO_FACTOR, 4.0f);
        break;
    case ROOKIE:
        option_list.Set(PRM_DAMAGE_TYRES, false);
        option_list.Set(PRM_DAMAGE_SUSPENSION, true);
        option_list.Set(PRM_DAMAGE_ALIGNMENT, false);
        option_list.Set(PRM_DAMAGE_AERO, true);
        option_list.Set(PRM_DAMAGE_ENGINE, false);
        option_list.Set(PRM_MODEL_AEROFLOW, SIMPLE);
        option_list.Set(PRM_MODEL_TYRE_TEMPERATURE, false);
        option_list.Set(PRM_MODEL_TYRE_COMPOUNDS, true);
        option_list.Set(PRM_MODEL_ENGINE_TEMPERATURE, false);
        option_list.Set(PRM_MODEL_AERO_FACTOR, 3.0f);
        break;
    case AMATEUR:
        option_list.Set(PRM_DAMAGE_TYRES, false);
        option_list.Set(PRM_DAMAGE_SUSPENSION, true);
        option_list.Set(PRM_DAMAGE_ALIGNMENT, false);
        option_list.Set(PRM_DAMAGE_AERO, true);
        option_list.Set(PRM_DAMAGE_ENGINE, true);
        option_list.Set(PRM_MODEL_AEROFLOW, SIMPLE);
        option_list.Set(PRM_MODEL_TYRE_TEMPERATURE, false);
        option_list.Set(PRM_MODEL_TYRE_COMPOUNDS, true);
        option_list.Set(PRM_MODEL_ENGINE_TEMPERATURE, true);
        option_list.Set(PRM_MODEL_AERO_FACTOR, 2.0f);
        break;
    case SEMI_PRO:
    case PRO:
        option_list.Set(PRM_DAMAGE_TYRES, true);
        option_list.Set(PRM_DAMAGE_SUSPENSION, true);
        option_list.Set(PRM_DAMAGE_ALIGNMENT, true);
        option_list.Set(PRM_DAMAGE_AERO, true);
        option_list.Set(PRM_DAMAGE_ENGINE, true);
        option_list.Set(PRM_MODEL_TYRE_TEMPERATURE, true);
        option_list.Set(PRM_MODEL_TYRE_COMPOUNDS, true);
        option_list.Set(PRM_MODEL_ENGINE_TEMPERATURE, true);
        option_list.Set(PRM_MODEL_AERO_FACTOR, 1.0f);
        option_list.Set(PRM_MODEL_AEROFLOW, OPTIMAL);
        break;
    }
}

/**
   After setting defaults, you can customise by loading values from a file.
   If values are not contained in the file then we just use the previously
   defined values.
*/
void SimulationOptions::LoadFromFile(void* handle)
{
    GfParmGetStr(handle, SECT_SIMU_SETTINGS, PRM_DAMAGE_TYRES, "none");
    SetFloatFromGfParm (handle, PRM_DAMAGE_TYRES);
    SetBoolFromGfParm (handle, PRM_DAMAGE_SUSPENSION);
    SetBoolFromGfParm (handle, PRM_DAMAGE_ALIGNMENT);
    SetBoolFromGfParm (handle, PRM_DAMAGE_AERO);
    SetBoolFromGfParm (handle, PRM_MODEL_TYRE_TEMPERATURE);
    SetFloatFromGfParm (handle, PRM_MODEL_AERO_FACTOR);
}

void SimulationOptions::SetFloatFromGfParm(void* handle, const char* name)
{
    float v = 0.0f;
    option_list.Get(name, v);
    v = GfParmGetNum (handle, SECT_SIMU_SETTINGS, name, (char*) NULL, v);
    option_list.Set(name, v);
}

void SimulationOptions::SetBoolFromGfParm(void* handle, const char* name)
{
    bool v = false;
    option_list.Get(name, v);
    const char* s = GfParmGetStr (handle, SECT_SIMU_SETTINGS, name, "none");
    v = StrToBool (s, v);
    option_list.Set(name, v);
}

bool SimulationOptions::StrToBool (const char* s, bool dontcare)
{
    if (!strcasecmp(s,"true"))
    {
        return true;
    }

    if (!strcasecmp(s,"false"))
    {
        return false;
    }

    return dontcare;
}

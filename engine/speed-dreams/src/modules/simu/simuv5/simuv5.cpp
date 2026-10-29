/***************************************************************************

    file                 : simuv5.cpp
    created              : Sun Mar 19 00:08:04 CET 2000
    copyright            : (C) 2023 Xavier Bertaux
    email                : bertauxx@gmail.com

 ***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/

#include "simuv5.h"

#include "sim.h"


// The Simuv4: singleton.
Simuv5* Simuv5::_pSelf = 0;

int openGfModule(const char* pszShLibName, void* hShLibHandle)
{
    // Instanciate the (only) module instance.
    Simuv5::_pSelf = new Simuv5(pszShLibName, hShLibHandle);

    // Register it to the GfModule module manager if OK.
    if (Simuv5::_pSelf)
        GfModule::register_(Simuv5::_pSelf);

    // Report about success or error.
    return Simuv5::_pSelf ? 0 : 1;
}

int closeGfModule()
{
    // Unregister it from the GfModule module manager.
    if (Simuv5::_pSelf)
        Simuv5::unregister(Simuv5::_pSelf);

    // Delete the (only) module instance.
    delete Simuv5::_pSelf;
    Simuv5::_pSelf = 0;

    // Report about success or error.
    return 0;
}

Simuv5& Simuv5::self()
{
    // Pre-condition : 1 successfull openGfModule call.
    return *_pSelf;
}

Simuv5::Simuv5(const std::string& strShLibName, void* hShLibHandle)
: GfModule(strShLibName, hShLibHandle)
{
}

Simuv5::~Simuv5()
{
}

// Implementation of IPhysicsEngine.
void Simuv5::initialize(int nCars, struct Track* pTrack)
{
    ::SimInit(nCars, pTrack);
}

void Simuv5::configureCar(struct CarElt* pCar)
{
    ::SimConfig(pCar);
}

void Simuv5::reconfigureCar(struct CarElt* pCar)
{
    ::SimReConfig(pCar);
}

void Simuv5::toggleCarTelemetry(int nCarIndex, bool bOn)
{
    ::SimCarTelemetry(nCarIndex, bOn);
}

void Simuv5::updateSituation(struct Situation *pSituation, double fDeltaTime)
{
    ::SimUpdate(pSituation, fDeltaTime);
}

void Simuv5::updateCar(struct Situation *pSituation, double fDeltaTime, int nCarIndex)
{
    ::SimUpdateSingleCar(nCarIndex, fDeltaTime, pSituation);
}

void Simuv5::setCar(const struct DynPt& dynGCG, int nCarIndex)
{
    ::UpdateSimCarTable(dynGCG, nCarIndex);
}

tDynPt* Simuv5::getCar(int nCarIndex)
{
    return ::GetSimCarTable(nCarIndex);
}

void Simuv5::shutdown()
{
    ::SimShutdown();
}

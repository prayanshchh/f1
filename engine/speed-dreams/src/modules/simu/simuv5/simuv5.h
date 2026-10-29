/***************************************************************************

    file        : simuv5.h
    copyright   : (C) 2011 by Jean-Philippe Meuret
                  (C) 2023 by Xavier Bertaux
    email       : pouillot@users.sourceforge.net

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
    		The "Simu V5" physics engine module
*/

#ifndef _SIMUV5_H_
#define _SIMUV5_H_

#include <iphysicsengine.h>

#include <tgf.hpp>


// DLL exported symbols declarator for Windows.
#ifdef _WIN32
# ifdef SIMUV5_DLL
#  define SIMUV5_API __declspec(dllexport)
# else
#  define SIMUV5_API __declspec(dllimport)
# endif
#else
# define SIMUV5_API
#endif


// The C interface of the module.
extern "C" int SIMUV5_API openGfModule(const char* pszShLibName, void* hShLibHandle);
extern "C" int SIMUV5_API closeGfModule();

// The module main class (Singleton, inherits GfModule, and implements IPhysicsEngine).
class SIMUV5_API Simuv5 : public GfModule, public IPhysicsEngine
{
 public:

	// Implementation of IPhysicsEngine.
	virtual void initialize(int nCars, struct Track* pTrack);
	virtual void configureCar(struct CarElt* pCar);
	virtual void reconfigureCar(struct CarElt* pCar);
	virtual void toggleCarTelemetry(int nCarIndex, bool bOn = true);
	virtual void updateSituation(struct Situation *pSituation, double fDeltaTime);
	virtual void updateCar(struct Situation *pSituation, double fDeltaTime, int nCarIndex);
	virtual void setCar(const struct DynPt& dynGCG, int nCarIndex);
	virtual struct DynPt* getCar(int nCarIndex);
	virtual void shutdown();

	// Accessor to the singleton.
	static Simuv5& self();

	// Destructor.
	virtual ~Simuv5();

 protected:

	// Protected constructor to avoid instanciation outside (but friends).
    Simuv5(const std::string& strShLibName, void* hShLibHandle);

	// Make the C interface functions nearly member functions.
	friend int openGfModule(const char* pszShLibName, void* hShLibHandle);
	friend int closeGfModule();

 protected:

	// The singleton.
	static Simuv5* _pSelf;
};

#endif /* _SIMUV5_H_ */

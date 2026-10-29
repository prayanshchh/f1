/***************************************************************************

    file                 : osspec.h
    created              : Sat Mar 18 23:54:47 CET 2000
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


#ifndef __OSSPEC__H__
#define __OSSPEC__H__

// Common file name extensions
#define TRKEXT	 "xml"
#define PARAMEXT ".xml"
#define PARAMEXTLEN 4
#define RESULTEXT ".xml"

// Windows -----------------------------------------------------------------
#ifdef _WIN32

// File name extensions
#define DLLEXT	".dll"
#define DLLEXTLEN 4

// Linux -------------------------------------------------------------------
#else // _WIN32

// File name extensions
#define DLLEXT	 ".so"
#define DLLEXTLEN 3

#endif // _WIN32

#endif /* __OSSPEC__H__ */

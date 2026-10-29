/***************************************************************************

    file                     : OsgMath.h
    created                  : Fri Aug 18 00:00:41 CEST 2012
    copyright                : (C) 2012 by Xavier Bertaux
    email                    : bertauxx@yahoo.fr

 ***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/

#ifndef _OSGMATH_H_
#define _OSGMATH_H_

#include <portability.h>
#include <cstdlib>
#include <math.h>

#include <osg/Vec2f>
#include <osg/Vec2d>
#include <osg/Vec3>
#include <osg/Vec3f>
#include <osg/Vec3d>
#include <osg/Vec4f>
#include <osg/Vec4d>
#include <osg/Quat>
#include <osg/Matrix>

namespace osggraph {

#define SD_ZERO  0.0
#define SD_HALF  0.5
#define SD_ONE   1.0
#define SD_TWO   2.0
#define SD_THREE 3.0
#define SD_FOUR  4.0
#define SD_45    45.0
#define SD_60    60.0
#define SD_90    90.0
#define SD_180   180.0
#define SD_MAX   DBL_MAX

#ifdef M_PI
#define SD_PI  3.1415926535f
#else
#define SD_PI  ((float) SD_PI)
#endif

/** PI / 2 */
#ifdef M_PI_2
#  define  SD_PI_2  M_PI_2
#else
#  define  SD_PI_2  1.57079632679489661923
#endif

#define SD_2PI (float)SD_PI * (float)SD_PI

#define SD_DEGREES_TO_RADIANS   (SD_PI/SD_180)
#define SD_RADIANS_TO_DEGREES   (SD_180/SD_PI)
#define SD_EARTH_RAD            6378.155
#define SD_FEET_TO_METER        0.3048


typedef float osgMat3[3][3];
typedef float osgMat4[4][4];

struct osgCoord
{
	osg::Vec3 xyz ;
	osg::Vec3 hpr ;
};

inline osg::Vec3d toOsg(const osg::Vec3d& v)
{
    return osg::Vec3d(v[0], v[1], v[2]);
}

inline osg::Vec3f toOsg(const osg::Vec3f& v)
{
    return osg::Vec3f(v[0], v[1], v[2]);
}

// Linear interpolation between two arbitrary typed values
/*template<typename S>
static S lerp(const S& val0, const S& val1, const T& t)
{
    return val0*(T(1) - t) + val1*t;
}*/

inline float sdASin ( float s )
                { return (float) asin (s) * SD_RADIANS_TO_DEGREES ; }
inline float sdACos ( float s )
                { return (float) acos (s) * SD_RADIANS_TO_DEGREES ; }
inline float sdATan ( float s )
                { return (float) atan (s) * SD_RADIANS_TO_DEGREES ; }
inline float sdATan2 ( float y, float x )
                { return (float) atan2 ( y,x ) * SD_RADIANS_TO_DEGREES ; }
inline float sdSin ( float s )
                { return (float)sin (s * SD_DEGREES_TO_RADIANS) ; }
inline float sdCos ( float s )
                { return (float)cos (s * SD_DEGREES_TO_RADIANS) ; }
inline float sdTan ( float s )
                { return (float)tan (s * SD_DEGREES_TO_RADIANS) ; }

// return a random number between [0.0, 1.0)
inline double SDRandom(void)
{
  return(rand() / (double)RAND_MAX);
}

/* Original functions adapted from PLib's sg library. */

/*
     PLIB - A Suite of Portable Game Libraries
     Copyright (C) 1998,2002  Steve Baker

     This library is free software; you can redistribute it and/or
     modify it under the terms of the GNU Library General Public
     License as published by the Free Software Foundation; either
     version 2 of the License, or (at your option) any later version.

     This library is distributed in the hope that it will be useful,
     but WITHOUT ANY WARRANTY; without even the implied warranty of
     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
     Library General Public License for more details.

     You should have received a copy of the GNU Library General Public
     License along with this library; if not, write to the Free Software
     Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307 USA

     For further information visit http://plib.sourceforge.net

     $Id: sg.cxx 1944 2004-08-05 01:07:09Z puggles $
*/


inline void osgXformPnt3(osg::Vec3 dst, const osg::Vec3 src, const osgMat4 mat)
{
	float t0 = src[0];
	float t1 = src[1];
	float t2 = src[2];

	dst[0] = t0*mat[0][0] + t1*mat[1][0] + t2*mat[2][0] + mat[3][0];
	dst[1] = t0*mat[0][1] + t1*mat[1][1] + t2*mat[2][1] + mat[3][1];
	dst[2] = t0*mat[0][2] + t1*mat[1][2] + t2*mat[2][2] + mat[3][2];
}

inline void osgMakeCoordMat4 ( osgMat4 m, const float x, const float y, const float z, const float h, const float p, const float r )
{
  float ch, sh, cp, sp, cr, sr, srsp, crsp, srcp ;

  if ( h == SD_ZERO )
  {
    ch = SD_ONE ;
    sh = SD_ZERO ;
  }
  else
  {
    sh = sdSin ( h ) ;
    ch = sdCos ( h ) ;
  }

  if ( p == SD_ZERO )
  {
    cp = SD_ONE ;
    sp = SD_ZERO ;
  }
  else
  {
    sp = sdSin ( p ) ;
    cp = sdCos ( p ) ;
  }

  if ( r == SD_ZERO )
  {
    cr   = SD_ONE ;
    sr   = SD_ZERO ;
    srsp = SD_ZERO ;
    srcp = SD_ZERO ;
    crsp = sp ;
  }
  else
  {
    sr   = sdSin ( r ) ;
    cr   = sdCos ( r ) ;
    srsp = sr * sp ;
    crsp = cr * sp ;
    srcp = sr * cp ;
  }

  m[0][0] = (float)(  ch * cr - sh * srsp ) ;
  m[1][0] = (float)( -sh * cp ) ;
  m[2][0] = (float)(  sr * ch + sh * crsp ) ;
  m[3][0] =  x ;

  m[0][1] = (float)( cr * sh + srsp * ch ) ;
  m[1][1] = (float)( ch * cp ) ;
  m[2][1] = (float)( sr * sh - crsp * ch ) ;
  m[3][1] =  y ;

  m[0][2] = (float)( -srcp ) ;
  m[1][2] = (float)(  sp ) ;
  m[2][2] = (float)(  cr * cp ) ;
  m[3][2] =  z ;

  m[0][3] =  SD_ZERO ;
  m[1][3] =  SD_ZERO ;
  m[2][3] =  SD_ZERO ;
  m[3][3] =  SD_ONE ;
}

inline void osgXformPnt3( osg::Vec3 dst, const osgMat4 mat ) { osgXformPnt3 ( dst, dst, mat ); }

} // namespace osggraph

#endif /* _OSGMATH_H_ */

/*
 * Speed Dreams, a free and open source motorsport simulator.
 * Copyright (C) 2026 Xavier Del Campo Romero
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

#ifndef SGCOMPAT_H
#define SGCOMPAT_H

#include <config.h>

#if HAVE_LIBPLIBSG
#include <plib/sg.h>
#else
/* Implicit dependencies included by plib/sg.h */
#include <cassert>
#include <climits>
#include <math.h>

#include <OsgMath.h>

typedef float SGfloat;
typedef osggraph::osgMat3 sgMat3;
typedef osggraph::osgMat4 sgMat4;
typedef SGfloat sgVec2[2];
typedef SGfloat sgVec3[3];
typedef SGfloat sgVec4[4];

#ifndef TRUE
#define TRUE  1
#endif

#ifndef FALSE
#define FALSE 0
#endif

#ifndef SG_ZERO
#define SG_ZERO 0.0f
#endif

#ifndef SG_ONE
#define SG_ONE 1.0f
#endif

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

inline void sgSubVec2 ( sgVec2 dst, const sgVec2 src )
{
  dst [ 0 ] -= src [ 0 ] ;
  dst [ 1 ] -= src [ 1 ] ;
}

inline void sgSubVec3 ( sgVec3 dst, const sgVec3 src )
{
  dst [ 0 ] -= src [ 0 ] ;
  dst [ 1 ] -= src [ 1 ] ;
  dst [ 2 ] -= src [ 2 ] ;
}

inline void sgSubVec4 ( sgVec4 dst, const sgVec4 src )
{
  dst [ 0 ] -= src [ 0 ] ;
  dst [ 1 ] -= src [ 1 ] ;
  dst [ 2 ] -= src [ 2 ] ;
  dst [ 3 ] -= src [ 3 ] ;
}

inline void sgSubVec2 ( sgVec2 dst, const sgVec2 src1, const sgVec2 src2 )
{
  dst [ 0 ] = src1 [ 0 ] - src2 [ 0 ] ;
  dst [ 1 ] = src1 [ 1 ] - src2 [ 1 ] ;
}

inline void sgSubVec3 ( sgVec3 dst, const sgVec3 src1, const sgVec3 src2 )
{
  dst [ 0 ] = src1 [ 0 ] - src2 [ 0 ] ;
  dst [ 1 ] = src1 [ 1 ] - src2 [ 1 ] ;
  dst [ 2 ] = src1 [ 2 ] - src2 [ 2 ] ;
}

inline void sgSubVec4 ( sgVec4 dst, const sgVec4 src1, const sgVec4 src2 )
{
  dst [ 0 ] = src1 [ 0 ] - src2 [ 0 ] ;
  dst [ 1 ] = src1 [ 1 ] - src2 [ 1 ] ;
  dst [ 2 ] = src1 [ 2 ] - src2 [ 2 ] ;
  dst [ 3 ] = src1 [ 3 ] - src2 [ 3 ] ;
}

inline void sgAddVec2 ( sgVec2 dst, const sgVec2 src )
{
  dst [ 0 ] += src [ 0 ] ;
  dst [ 1 ] += src [ 1 ] ;
}

inline void sgAddVec3 ( sgVec3 dst, const sgVec3 src )
{
  dst [ 0 ] += src [ 0 ] ;
  dst [ 1 ] += src [ 1 ] ;
  dst [ 2 ] += src [ 2 ] ;
}

inline void sgAddVec4 ( sgVec4 dst, const sgVec4 src )
{
  dst [ 0 ] += src [ 0 ] ;
  dst [ 1 ] += src [ 1 ] ;
  dst [ 2 ] += src [ 2 ] ;
  dst [ 3 ] += src [ 3 ] ;
}


inline void sgAddVec2 ( sgVec2 dst, const sgVec2 src1, const sgVec2 src2 )
{
  dst [ 0 ] = src1 [ 0 ] + src2 [ 0 ] ;
  dst [ 1 ] = src1 [ 1 ] + src2 [ 1 ] ;
}

inline void sgAddVec3 ( sgVec3 dst, const sgVec3 src1, const sgVec3 src2 )
{
  dst [ 0 ] = src1 [ 0 ] + src2 [ 0 ] ;
  dst [ 1 ] = src1 [ 1 ] + src2 [ 1 ] ;
  dst [ 2 ] = src1 [ 2 ] + src2 [ 2 ] ;
}

inline void sgAddVec4 ( sgVec4 dst, const sgVec4 src1, const sgVec4 src2 )
{
  dst [ 0 ] = src1 [ 0 ] + src2 [ 0 ] ;
  dst [ 1 ] = src1 [ 1 ] + src2 [ 1 ] ;
  dst [ 2 ] = src1 [ 2 ] + src2 [ 2 ] ;
  dst [ 3 ] = src1 [ 3 ] + src2 [ 3 ] ;
}

inline void sgScaleVec2 ( sgVec2 dst, const SGfloat s )
{
  dst [ 0 ] *= s ;
  dst [ 1 ] *= s ;
}

inline void sgScaleVec3 ( sgVec3 dst, const SGfloat s )
{
  dst [ 0 ] *= s ;
  dst [ 1 ] *= s ;
  dst [ 2 ] *= s ;
}

inline void sgScaleVec4 ( sgVec4 dst, const SGfloat s )
{
  dst [ 0 ] *= s ;
  dst [ 1 ] *= s ;
  dst [ 2 ] *= s ;
  dst [ 3 ] *= s ;
}

inline void sgScaleVec2 ( sgVec2 dst, const sgVec2 src, const SGfloat s )
{
  dst [ 0 ] = src [ 0 ] * s ;
  dst [ 1 ] = src [ 1 ] * s ;
}

inline void sgScaleVec3 ( sgVec3 dst, const sgVec3 src, const SGfloat s )
{
  dst [ 0 ] = src [ 0 ] * s ;
  dst [ 1 ] = src [ 1 ] * s ;
  dst [ 2 ] = src [ 2 ] * s ;
}

inline void sgScaleVec4 ( sgVec4 dst, const sgVec4 src, const SGfloat s )
{
  dst [ 0 ] = src [ 0 ] * s ;
  dst [ 1 ] = src [ 1 ] * s ;
  dst [ 2 ] = src [ 2 ] * s ;
  dst [ 3 ] = src [ 3 ] * s ;
}

extern void sgXformVec3     ( sgVec3 dst, const sgVec3 src, const sgMat4 mat ) ;
extern void sgXformPnt3     ( sgVec3 dst, const sgVec3 src, const sgMat4 mat ) ;
extern void sgXformVec4     ( sgVec4 dst, const sgVec4 src, const sgMat4 mat ) ;
extern void sgXformPnt4     ( sgVec4 dst, const sgVec4 src, const sgMat4 mat ) ;
extern void sgFullXformPnt3 ( sgVec3 dst, const sgVec3 src, const sgMat4 mat ) ;
extern void sgFullXformPnt4 ( sgVec4 dst, const sgVec4 src, const sgMat4 mat ) ;

inline void sgXformPnt3 ( sgVec3 dst, const sgVec3 src, const sgMat4 mat )
{
  SGfloat t0 = src[ 0 ] ;
  SGfloat t1 = src[ 1 ] ;
  SGfloat t2 = src[ 2 ] ;

  dst[0] = t0 * mat[ 0 ][ 0 ] +
           t1 * mat[ 1 ][ 0 ] +
           t2 * mat[ 2 ][ 0 ] +
                mat[ 3 ][ 0 ] ;

  dst[1] = t0 * mat[ 0 ][ 1 ] +
           t1 * mat[ 1 ][ 1 ] +
           t2 * mat[ 2 ][ 1 ] +
                mat[ 3 ][ 1 ] ;

  dst[2] = t0 * mat[ 0 ][ 2 ] +
           t1 * mat[ 1 ][ 2 ] +
           t2 * mat[ 2 ][ 2 ] +
                mat[ 3 ][ 2 ] ;
}

inline void sgXformVec3 ( sgVec3 dst, const sgVec3 src, const sgMat4 mat )
{
  SGfloat t0 = src[ 0 ] ;
  SGfloat t1 = src[ 1 ] ;
  SGfloat t2 = src[ 2 ] ;

  dst[0] = t0 * mat[ 0 ][ 0 ] +
           t1 * mat[ 1 ][ 0 ] +
           t2 * mat[ 2 ][ 0 ] ;

  dst[1] = t0 * mat[ 0 ][ 1 ] +
           t1 * mat[ 1 ][ 1 ] +
           t2 * mat[ 2 ][ 1 ] ;

  dst[2] = t0 * mat[ 0 ][ 2 ] +
           t1 * mat[ 1 ][ 2 ] +
           t2 * mat[ 2 ][ 2 ] ;
}

inline void sgFullXformPnt3 ( sgVec3 dst, const sgVec3 src, const sgMat4 mat )
{
  sgVec4 tmp ;

  tmp [ 0 ] = src [ 0 ] ;
  tmp [ 1 ] = src [ 1 ] ;
  tmp [ 2 ] = src [ 2 ] ;
  tmp [ 3 ] =   SG_ONE  ;

  sgXformPnt4 ( tmp, tmp, mat ) ;
  sgScaleVec3 ( dst, tmp, SG_ONE / tmp [ 3 ] ) ;
}

inline void sgXformPnt4 ( sgVec4 dst, const sgVec4 src, const sgMat4 mat )
{
  SGfloat t0 = src[ 0 ] ;
  SGfloat t1 = src[ 1 ] ;
  SGfloat t2 = src[ 2 ] ;
  SGfloat t3 = src[ 3 ] ;

  dst[0] = t0 * mat[ 0 ][ 0 ] +
           t1 * mat[ 1 ][ 0 ] +
           t2 * mat[ 2 ][ 0 ] +
           t3 * mat[ 3 ][ 0 ] ;

  dst[1] = t0 * mat[ 0 ][ 1 ] +
           t1 * mat[ 1 ][ 1 ] +
           t2 * mat[ 2 ][ 1 ] +
           t3 * mat[ 3 ][ 1 ] ;

  dst[2] = t0 * mat[ 0 ][ 2 ] +
           t1 * mat[ 1 ][ 2 ] +
           t2 * mat[ 2 ][ 2 ] +
           t3 * mat[ 3 ][ 2 ] ;

  dst[3] = t0 * mat[ 0 ][ 3 ] +
           t1 * mat[ 1 ][ 3 ] +
           t2 * mat[ 2 ][ 3 ] +
           t3 * mat[ 3 ][ 3 ] ;
}

inline void sgXformVec3     ( sgVec3 dst, const sgMat4 mat ) { sgXformVec3 ( dst, dst, mat ) ; }
inline void sgXformPnt3     ( sgVec3 dst, const sgMat4 mat ) { sgXformPnt3 ( dst, dst, mat ) ; }
inline void sgXformVec4     ( sgVec4 dst, const sgMat4 mat ) { sgXformVec4 ( dst, dst, mat ) ; }
inline void sgXformPnt4     ( sgVec4 dst, const sgMat4 mat ) { sgXformPnt4 ( dst, dst, mat ) ; }
inline void sgFullXformPnt3 ( sgVec3 dst, const sgMat4 mat ) { sgFullXformPnt3 ( dst, dst, mat ) ; }
inline void sgFullXformPnt4 ( sgVec4 dst, const sgMat4 mat ) { sgFullXformPnt4 ( dst, dst, mat ) ; }

inline SGfloat sgScalarProductVec2 ( const sgVec2 a, const sgVec2 b )
{
  return a[0]*b[0] + a[1]*b[1] ;
}

inline SGfloat sgScalarProductVec3 ( const sgVec3 a, const sgVec3 b )
{
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] ;
}

inline SGfloat sgScalarProductVec4 ( const sgVec4 a, const sgVec4 b )
{
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3] ;
}

/*
  These are just convenient redefinitions of standard
  math library functions to stop float/double warnings.
*/

inline SGfloat sgSqrt   ( const SGfloat x ) { return (SGfloat) sqrt ( x ) ; }
inline SGfloat sgSquare ( const SGfloat x ) { return x * x ; }
inline SGfloat sgAbs    ( const SGfloat a ) { return (a<SG_ZERO) ? -a : a ; }
inline SGfloat sgHypot  ( const SGfloat x, const SGfloat y ) { return sgSqrt( sgSquare(x) + sgSquare(y) ); }

inline SGfloat sgLengthVec2 ( const sgVec2 src )
{
  return sgSqrt ( sgScalarProductVec2 ( src, src ) ) ;
}

inline SGfloat sgLengthVec3 ( const sgVec3 src )
{
  return sgSqrt ( sgScalarProductVec3 ( src, src ) ) ;
}

inline SGfloat sgLengthVec4 ( const sgVec4 src )
{
  return sgSqrt ( sgScalarProductVec4 ( src, src ) ) ;
}

inline SGfloat sgLengthSquaredVec2 ( sgVec2 const src )
{
  return sgScalarProductVec2 ( src, src ) ;
}

inline SGfloat sgLengthSquaredVec3 ( sgVec3 const src )
{
  return sgScalarProductVec3 ( src, src ) ;
}

inline SGfloat sgLengthSquaredVec4 ( sgVec4 const src )
{
  return sgScalarProductVec4 ( src, src ) ;
}

/* Anglo-US spelling issues.  <sigh> */
#define sgNormalizeVec2 sgNormaliseVec2
#define sgNormalizeVec3 sgNormaliseVec3
#define sgNormalizeVec4 sgNormaliseVec4
#define sgNormalizeQuat sgNormaliseQuat

inline void sgNormaliseVec2 ( sgVec2 dst )
{
  sgScaleVec2 ( dst, SG_ONE / sgLengthVec2 ( dst ) ) ;
}

inline void sgNormaliseVec3 ( sgVec3 dst )
{
  sgScaleVec3 ( dst, SG_ONE / sgLengthVec3 ( dst ) ) ;
}

inline void sgNormaliseVec4 ( sgVec4 dst )
{
  sgScaleVec4 ( dst, SG_ONE / sgLengthVec4 ( dst ) ) ;
}

inline void sgNormaliseVec2 ( sgVec2 dst, const sgVec2 src )
{
  sgScaleVec2 ( dst, src, SG_ONE / sgLengthVec2 ( src ) ) ;
}

inline void sgNormaliseVec3 ( sgVec3 dst, const sgVec3 src )
{
  sgScaleVec3 ( dst, src, SG_ONE / sgLengthVec3 ( src ) ) ;
}

inline void sgNormaliseVec4 ( sgVec4 dst, const sgVec4 src )
{
  sgScaleVec4 ( dst, src, SG_ONE / sgLengthVec4 ( src ) ) ;
}

inline void sgCopyVec2 ( sgVec2 dst, const sgVec2 src )
{
  dst [ 0 ] = src [ 0 ] ;
  dst [ 1 ] = src [ 1 ] ;
}

inline void sgCopyVec3 ( sgVec3 dst, const sgVec3 src )
{
  dst [ 0 ] = src [ 0 ] ;
  dst [ 1 ] = src [ 1 ] ;
  dst [ 2 ] = src [ 2 ] ;
}

inline void sgCopyVec4 ( sgVec4 dst, const sgVec4 src )
{
  dst [ 0 ] = src [ 0 ] ;
  dst [ 1 ] = src [ 1 ] ;
  dst [ 2 ] = src [ 2 ] ;
  dst [ 3 ] = src [ 3 ] ;
}

inline void sgMakeCoordMat4 ( sgMat4 m, const float x, const float y, const float z, const float h, const float p, const float r )
{
  osggraph::osgMakeCoordMat4 ( m, x, y, z, h, p, r );
}

#endif /* HAVE_LIBPLIBSG */
#endif /* SGCOMPAT_H */

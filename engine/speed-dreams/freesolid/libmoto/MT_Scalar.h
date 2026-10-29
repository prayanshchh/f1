/*
 * Copyright (c) 2001 Dtecta <gino@dtecta.com>
 *
 * Permission to use, copy, modify, distribute and sell this software
 * and its documentation for any purpose is hereby granted without fee,
 * provided that the above copyright notice appear in all copies and
 * that both that copyright notice and this permission notice appear
 * in supporting documentation.  Dtecta makes no representations about
 * the suitability of this software for any purpose.  It is provided
 * "as is" without express or implied warranty.
 */

#ifndef MT_SCALAR_H
#define MT_SCALAR_H

#include <math.h>
#include <float.h>

#include "GEN_random.h"

typedef float MT_Scalar;

const unsigned int MT_COMP_MASK = 0xffffff00; // allow 8 bits of noise for float compares

const MT_Scalar  MT_2_PI        (6.283185307179586232f);
const MT_Scalar  MT_PI          (MT_2_PI * 0.5f);
const MT_Scalar  MT_HALF_PI		(MT_2_PI * 0.25f);
const MT_Scalar  MT_RADS_PER_DEG(MT_2_PI / 360.0f);
const MT_Scalar  MT_DEGS_PER_RAD(360.0f / MT_2_PI);
const MT_Scalar  MT_EPSILON     (FLT_EPSILON);
const MT_Scalar  MT_INFINITY    (FLT_MAX);

inline int MT_sign(MT_Scalar x) {
    return x < MT_Scalar(0.0) ? -1 : x > MT_Scalar(0.0) ? 1 : 0;
}

inline MT_Scalar MT_abs(MT_Scalar x) { return fabsf(x); }
inline MT_Scalar MT_sqrt(MT_Scalar x) { return sqrtf(x); }

inline MT_Scalar MT_random() {
    return MT_Scalar(GEN_rand()) / MT_Scalar(GEN_RAND_MAX);
}

inline MT_Scalar MT_radians(MT_Scalar x) { return x * MT_RADS_PER_DEG; }
inline MT_Scalar MT_degrees(MT_Scalar x) { return x * MT_DEGS_PER_RAD; }

#endif

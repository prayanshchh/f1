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

#ifndef MT_POINT2_H
#define MT_POINT2_H

#include "MT_Vector2.h"

class MT_Point2 : public MT_Vector2 {
public:
    MT_Point2() {}
    explicit MT_Point2(const float *v) : MT_Vector2(v) {}
    explicit MT_Point2(const double *v) : MT_Vector2(v) {}
    MT_Point2(MT_Scalar x, MT_Scalar y) : MT_Vector2(x, y) {}

    MT_Point2& operator+=(const MT_Vector2& v);
    MT_Point2& operator-=(const MT_Vector2& v);
    MT_Point2& operator=(const MT_Vector2& v);

    MT_Scalar  distance(const MT_Point2& p) const;
    MT_Scalar  distance2(const MT_Point2& p) const;

    MT_Point2  lerp(const MT_Point2& p, MT_Scalar t) const;
};

MT_Point2  operator+(const MT_Point2& p, const MT_Vector2& v);
MT_Point2  operator-(const MT_Point2& p, const MT_Vector2& v);
MT_Vector2 operator-(const MT_Point2& p1, const MT_Point2& p2);

MT_Scalar MT_distance(const MT_Point2& p1, const MT_Point2& p2);
MT_Scalar MT_distance2(const MT_Point2& p1, const MT_Point2& p2);

MT_Point2 MT_lerp(const MT_Point2& p1, const MT_Point2& p2, MT_Scalar t);

#ifdef GEN_INLINED
#include "MT_Point2.inl"
#endif

#endif

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

#ifndef MT_VECTOR2_H
#define MT_VECTOR2_H

#include <assert.h>
#include "MT_Tuple2.h"

class MT_Vector2 : public MT_Tuple2 {
public:
    MT_Vector2() {}
    explicit MT_Vector2(const float *v) : MT_Tuple2(v) {}
    explicit MT_Vector2(const double *v) : MT_Tuple2(v) {}
    MT_Vector2(MT_Scalar x, MT_Scalar y) : MT_Tuple2(x, y) {}

    MT_Vector2& operator+=(const MT_Vector2& v);
    MT_Vector2& operator-=(const MT_Vector2& v);
    MT_Vector2& operator*=(MT_Scalar s);
    MT_Vector2& operator/=(MT_Scalar s);

    MT_Scalar   dot(const MT_Vector2& v) const;

    MT_Scalar   length2() const;
    MT_Scalar   length() const;

    MT_Vector2  absolute() const;

    void        normalize();
    MT_Vector2  normalized() const;

    void        scale(MT_Scalar x, MT_Scalar y);
    MT_Vector2  scaled(MT_Scalar x, MT_Scalar y) const;

    MT_Scalar   angle(const MT_Vector2& v) const;
};

MT_Vector2 operator+(const MT_Vector2& v1, const MT_Vector2& v2);
MT_Vector2 operator-(const MT_Vector2& v1, const MT_Vector2& v2);
MT_Vector2 operator-(const MT_Vector2& v);
MT_Vector2 operator*(const MT_Vector2& v, MT_Scalar s);
MT_Vector2 operator*(MT_Scalar s, const MT_Vector2& v);
MT_Vector2 operator/(const MT_Vector2& v, MT_Scalar s);

MT_Scalar  MT_dot(const MT_Vector2& v1, const MT_Vector2& v2);

MT_Scalar  MT_length2(const MT_Vector2& v);
MT_Scalar  MT_length(const MT_Vector2& v);

MT_Scalar  MT_angle(const MT_Vector2& v1, const MT_Vector2& v2);

#ifdef GEN_INLINED
#include "MT_Vector2.inl"
#endif

#endif

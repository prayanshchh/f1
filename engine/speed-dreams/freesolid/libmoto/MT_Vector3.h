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

#ifndef MT_VECTOR3_H
#define MT_VECTOR3_H

#include <assert.h>

#include "MT_Tuple3.h"

class MT_Vector3 : public MT_Tuple3 {
public:
	static const MT_Vector3 ZERO;

    MT_Vector3() {}
    explicit MT_Vector3(const float *v) : MT_Tuple3(v) {}
    explicit MT_Vector3(const double *v) : MT_Tuple3(v) {}
    MT_Vector3(MT_Scalar x, MT_Scalar y, MT_Scalar z) : MT_Tuple3(x, y, z) {}

    MT_Vector3& operator+=(const MT_Vector3& v);
    MT_Vector3& operator-=(const MT_Vector3& v);
    MT_Vector3& operator*=(MT_Scalar s);
    MT_Vector3& operator/=(MT_Scalar s);

    MT_Scalar   dot(const MT_Vector3& v) const;

    MT_Scalar   length2() const;
    MT_Scalar   length() const;

    void        normalize();
    MT_Vector3  normalized() const;

	MT_Scalar   angle(const MT_Vector3& v) const;

	MT_Vector3  absolute() const;

    void        scale(MT_Scalar x, MT_Scalar y, MT_Scalar z);
    MT_Vector3  scaled(MT_Scalar x, MT_Scalar y, MT_Scalar z) const;


    MT_Vector3  cross(const MT_Vector3& v) const;
    MT_Scalar   triple(const MT_Vector3& v1, const MT_Vector3& v2) const;

    int         closestAxis() const;
    int         furthestAxis() const;

	MT_Vector3  lerp(const MT_Vector3& v, MT_Scalar t) const;

	static MT_Vector3 random();
};

MT_Vector3 operator+(const MT_Vector3& v1, const MT_Vector3& v2);
MT_Vector3 operator-(const MT_Vector3& v1, const MT_Vector3& v2);
MT_Vector3 operator-(const MT_Vector3& v);
MT_Vector3 operator*(const MT_Vector3& v, MT_Scalar s);
MT_Vector3 operator*(MT_Scalar s, const MT_Vector3& v);
MT_Vector3 operator/(const MT_Vector3& v, MT_Scalar s);

MT_Vector3 operator*(const MT_Vector3& v1, const MT_Vector3& v2);

MT_Scalar  MT_dot(const MT_Vector3& v1, const MT_Vector3& v2);

MT_Scalar  MT_length2(const MT_Vector3& v);
MT_Scalar  MT_length(const MT_Vector3& v);

MT_Scalar  MT_angle(const MT_Vector3& v1, const MT_Vector3& v2);

MT_Vector3 MT_cross(const MT_Vector3& v1, const MT_Vector3& v2);
MT_Scalar  MT_triple(const MT_Vector3& v1, const MT_Vector3& v2,
                     const MT_Vector3& v3);

MT_Vector3 MT_lerp(const MT_Vector3& v1, const MT_Vector3& v2, MT_Scalar t);

#ifdef GEN_INLINED
#include "MT_Vector3.inl"
#endif

#endif

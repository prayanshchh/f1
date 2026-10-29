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

#ifndef MT_VECTOR4_H
#define MT_VECTOR4_H

#include <assert.h>

#include "MT_Tuple4.h"

class MT_Vector4 : public MT_Tuple4 {
public:
    MT_Vector4() {}
    explicit MT_Vector4(const float *v) : MT_Tuple4(v) {}
    explicit MT_Vector4(const double *v) : MT_Tuple4(v) {}
    MT_Vector4(MT_Scalar x, MT_Scalar y, MT_Scalar z, MT_Scalar w) : MT_Tuple4(x, y, z, w) {}

    MT_Vector4& operator+=(const MT_Vector4& v);
    MT_Vector4& operator-=(const MT_Vector4& v);
    MT_Vector4& operator*=(MT_Scalar s);
    MT_Vector4& operator/=(MT_Scalar s);

    MT_Scalar   dot(const MT_Vector4& v) const;

    MT_Scalar   length2() const;
    MT_Scalar   length() const;

    void        normalize();
    MT_Vector4  normalized() const;

 	MT_Scalar   angle(const MT_Vector4& v) const;

   	MT_Vector4  absolute() const;

	void        scale(MT_Scalar x, MT_Scalar y, MT_Scalar z, MT_Scalar w);
    MT_Vector4  scaled(MT_Scalar x, MT_Scalar y, MT_Scalar z, MT_Scalar w) const;
};

MT_Vector4 operator+(const MT_Vector4& v1, const MT_Vector4& v2);
MT_Vector4 operator-(const MT_Vector4& v1, const MT_Vector4& v2);
MT_Vector4 operator-(const MT_Vector4& v);
MT_Vector4 operator*(const MT_Vector4& v, MT_Scalar s);
MT_Vector4 operator*(MT_Scalar s, const MT_Vector4& v);
MT_Vector4 operator/(const MT_Vector4& v, MT_Scalar s);

MT_Scalar  MT_dot(const MT_Vector4& v1, const MT_Vector4& v2);

MT_Scalar  MT_length2(const MT_Vector4& v);
MT_Scalar  MT_length(const MT_Vector4& v);

MT_Scalar  MT_angle(const MT_Vector4& v1, const MT_Vector4& v2);

#ifdef GEN_INLINED
#include "MT_Vector4.inl"
#endif

#endif

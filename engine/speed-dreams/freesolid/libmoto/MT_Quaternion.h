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

#ifndef MT_QUATERNION_H
#define MT_QUATERNION_H

#include <assert.h>

#include "MT_Vector3.h"
#include "MT_Vector4.h"

class MT_Quaternion : public MT_Vector4 {
public:
	static const MT_Quaternion IDENTITY;

    MT_Quaternion() {}
    explicit MT_Quaternion(const float *v) : MT_Vector4(v) {}
    explicit MT_Quaternion(const double *v) : MT_Vector4(v) {}
    MT_Quaternion(MT_Scalar x, MT_Scalar y, MT_Scalar z, MT_Scalar w) :
        MT_Vector4(x, y, z, w) {}
    MT_Quaternion(const MT_Vector3& axis, MT_Scalar angle) {
        setRotation(axis, angle);
    }
    MT_Quaternion(MT_Scalar yaw, MT_Scalar pitch, MT_Scalar roll) {
        setEuler(yaw, pitch, roll);
    }

    void setRotation(const MT_Vector3& axis, MT_Scalar angle) {
        MT_Scalar d = axis.length();
        assert(d != MT_Scalar(0.0));
        MT_Scalar s = sin(angle * MT_Scalar(0.5)) / d;
        setValue(axis[0] * s, axis[1] * s, axis[2] * s,
                 cos(angle * MT_Scalar(0.5)));
    }

    void setEuler(MT_Scalar yaw, MT_Scalar pitch, MT_Scalar roll) {
        MT_Scalar cosYaw = cos(yaw * MT_Scalar(0.5));
        MT_Scalar sinYaw = sin(yaw * MT_Scalar(0.5));
        MT_Scalar cosPitch = cos(pitch * MT_Scalar(0.5));
        MT_Scalar sinPitch = sin(pitch * MT_Scalar(0.5));
        MT_Scalar cosRoll = cos(roll * MT_Scalar(0.5));
        MT_Scalar sinRoll = sin(roll * MT_Scalar(0.5));
        setValue(cosRoll * sinPitch * cosYaw + sinRoll * cosPitch * sinYaw,
                 cosRoll * cosPitch * sinYaw - sinRoll * sinPitch * cosYaw,
                 sinRoll * cosPitch * cosYaw - cosRoll * sinPitch * sinYaw,
                 cosRoll * cosPitch * cosYaw + sinRoll * sinPitch * sinYaw);
    }

    MT_Quaternion& operator*=(const MT_Quaternion& q);

    void conjugate();
    MT_Quaternion conjugate() const;

    void invert();
    MT_Quaternion inverse() const;

 	MT_Quaternion slerp(const MT_Quaternion& q, MT_Scalar t) const;
	MT_Quaternion power(MT_Scalar s) const;
	MT_Quaternion log() const;

	static MT_Quaternion random();
};

MT_Quaternion operator+(const MT_Quaternion& q1, const MT_Quaternion& q2);
MT_Quaternion operator-(const MT_Quaternion& q1, const MT_Quaternion& q2);
MT_Quaternion operator-(const MT_Quaternion& q);
MT_Quaternion operator*(const MT_Quaternion& q, MT_Scalar s);
MT_Quaternion operator*(MT_Scalar s, const MT_Quaternion& q);
MT_Quaternion operator/(const MT_Quaternion& q, MT_Scalar s);

MT_Quaternion operator*(const MT_Quaternion& q1, const MT_Quaternion& q2);
MT_Quaternion operator*(const MT_Quaternion& q, const MT_Vector3& w);
MT_Quaternion operator*(const MT_Vector3& w, const MT_Quaternion& q);

MT_Quaternion MT_slerp(const MT_Quaternion& q1, const MT_Quaternion& q2, MT_Scalar t);
MT_Quaternion MT_power(const MT_Quaternion& q, MT_Scalar s);
MT_Quaternion MT_log(const MT_Quaternion& q);

#ifdef GEN_INLINED
#include "MT_Quaternion.inl"
#endif

#endif

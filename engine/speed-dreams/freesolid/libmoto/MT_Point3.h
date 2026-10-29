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

#ifndef MT_POINT_H
#define MT_POINT_H

#include "MT_Vector3.h"

class MT_Point3 : public MT_Vector3 {
public:
	static const MT_Point3 ORIGIN;

    MT_Point3() {}
    explicit MT_Point3(const float *v) : MT_Vector3(v) {}
    explicit MT_Point3(const double *v) : MT_Vector3(v) {}
    MT_Point3(MT_Scalar x, MT_Scalar y, MT_Scalar z) : MT_Vector3(x, y, z) {}

    MT_Point3& operator+=(const MT_Vector3& v);
    MT_Point3& operator-=(const MT_Vector3& v);
    MT_Point3& operator=(const MT_Vector3& v);

	MT_Point3 min(const MT_Point3& p) const;
	MT_Point3 max(const MT_Point3& p) const;

	void set_min(const MT_Point3& p);
	void set_max(const MT_Point3& p);

    MT_Scalar  distance(const MT_Point3& p) const;
    MT_Scalar  distance2(const MT_Point3& p) const;

    MT_Point3  lerp(const MT_Point3& p, MT_Scalar t) const;
};

MT_Point3  operator+(const MT_Point3& p, const MT_Vector3& v);
MT_Point3  operator-(const MT_Point3& p, const MT_Vector3& v);
MT_Vector3 operator-(const MT_Point3& p1, const MT_Point3& p2);

bool operator<=(const MT_Point3& p, const MT_Point3& v);

MT_Point3 MT_min(const MT_Point3& p1, const MT_Point3& p2);
MT_Point3 MT_max(const MT_Point3& p1, const MT_Point3& p2);

MT_Scalar MT_distance(const MT_Point3& p1, const MT_Point3& p2);
MT_Scalar MT_distance2(const MT_Point3& p1, const MT_Point3& p2);

MT_Point3 MT_lerp(const MT_Point3& p1, const MT_Point3& p2, MT_Scalar t);

#ifdef GEN_INLINED
#include "MT_Point3.inl"
#endif

#endif

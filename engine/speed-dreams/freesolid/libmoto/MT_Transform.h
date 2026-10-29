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

#ifndef MT_TRANSFORM_H
#define MT_TRANSFORM_H

#include "MT_Point3.h"
#include "MT_Matrix3x3.h"

class MT_Transform {
public:
	static const MT_Transform IDENTITY;

    MT_Transform() {}
    explicit MT_Transform(const float *m) { setValue(m); }
    explicit MT_Transform(const double *m) { setValue(m); }
    MT_Transform(const MT_Point3& p, const MT_Quaternion& q) {
		setOrigin(p);
		setRotation(q);
	}

    MT_Transform(const MT_Point3& p, const MT_Matrix3x3& m) {
		setOrigin(p);
		setBasis(m);
	}



    MT_Point3 operator()(const MT_Point3& p) const {
        return MT_Point3(MT_dot(m_basis[0], p) + m_origin[0],
                         MT_dot(m_basis[1], p) + m_origin[1],
                         MT_dot(m_basis[2], p) + m_origin[2]);
    }

    MT_Point3 operator*(const MT_Point3& p) const {
        return (*this)(p);
    }

    MT_Matrix3x3&         getBasis()          { return m_basis; }
    const MT_Matrix3x3&   getBasis()    const { return m_basis; }
    MT_Point3&            getOrigin()         { return m_origin; }
    const MT_Point3&      getOrigin()   const { return m_origin; }
    MT_Quaternion         getRotation() const { return m_basis.getRotation(); }

    void setValue(const float *m);
    void setValue(const double *m);

    void setOrigin(const MT_Point3& origin) {
        m_origin = origin;
		m_type |= TRANSLATION;
    }

    void setBasis(const MT_Matrix3x3& basis) {
        m_basis = basis;
		m_type |= LINEAR;
    }

    void setRotation(const MT_Quaternion& q) {
        m_basis.setRotation(q);
		m_type &= ~SCALING;
		m_type |= ROTATION;
    }

    void getValue(float *m) const;
    void getValue(double *m) const;

    void setIdentity();
	bool isIdentity() const { return m_type == 0x0; }

    MT_Transform& operator*=(const MT_Transform& t);

    void translate(const MT_Vector3& v);
    void rotate(const MT_Quaternion& q);
    void scale(MT_Scalar x, MT_Scalar y, MT_Scalar z);

    void invert(const MT_Transform& t);
    void mult(const MT_Transform& t1, const MT_Transform& t2);
    void multInverseLeft(const MT_Transform& t1, const MT_Transform& t2);

private:
    enum {
        TRANSLATION = 0x01,
        ROTATION    = 0x02,
        RIGID       = TRANSLATION | ROTATION,
        SCALING     = 0x04,
        LINEAR      = ROTATION | SCALING,
        AFFINE      = TRANSLATION | LINEAR
    };

    MT_Transform(const MT_Matrix3x3& basis, const MT_Point3& origin,
                 unsigned int type) {
        setValue(basis, origin, type);
    }

    void setValue(const MT_Matrix3x3& basis, const MT_Point3& origin,
                  unsigned int type) {
        m_basis  = basis;
        m_origin = origin;
        m_type   = type;
    }

    friend MT_Transform operator*(const MT_Transform& t1, const MT_Transform& t2);

    MT_Matrix3x3 m_basis;
    MT_Point3    m_origin;
    unsigned int m_type;
};

inline MT_Transform operator*(const MT_Transform& t1, const MT_Transform& t2) {
    return MT_Transform(t1.m_basis * t2.m_basis,
                        t1(t2.m_origin),
                        t1.m_type | t2.m_type);
}

#endif

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

#ifndef MT_TUPLE3_H
#define MT_TUPLE3_H

#include "GEN_Stream.h"
#include "MT_Scalar.h"

class MT_Tuple3 {
public:
    MT_Tuple3() {}
    explicit MT_Tuple3(const float *v) { setValue(v); }
    explicit MT_Tuple3(const double *v) { setValue(v); }
    MT_Tuple3(MT_Scalar x, MT_Scalar y, MT_Scalar z) { setValue(x, y, z); }

    MT_Scalar&       operator[](int i)       { return m_co[i]; }
    const MT_Scalar& operator[](int i) const { return m_co[i]; }

    MT_Scalar&       x()       { return m_co[0]; }
    const MT_Scalar& x() const { return m_co[0]; }

    MT_Scalar&       y()       { return m_co[1]; }
    const MT_Scalar& y() const { return m_co[1]; }

    MT_Scalar&       z()       { return m_co[2]; }
    const MT_Scalar& z() const { return m_co[2]; }

    operator       MT_Scalar *()       { return m_co; }
	operator const MT_Scalar *() const { return m_co; }

    void getValue(float *v) const {
        v[0] = m_co[0]; v[1] = m_co[1]; v[2] = m_co[2];
    }

    void getValue(double *v) const {
        v[0] = m_co[0]; v[1] = m_co[1]; v[2] = m_co[2];
    }

    void setValue(const float *v) {
        m_co[0] = MT_Scalar(v[0]);
        m_co[1] = MT_Scalar(v[1]);
        m_co[2] = MT_Scalar(v[2]);
    }

    void setValue(const double *v) {
        m_co[0] = MT_Scalar(v[0]);
        m_co[1] = MT_Scalar(v[1]);
        m_co[2] = MT_Scalar(v[2]);
    }

    void setValue(MT_Scalar x, MT_Scalar y, MT_Scalar z) {
        m_co[0] = x; m_co[1] = y; m_co[2] = z;
    }

protected:
    MT_Scalar m_co[3];
};

inline bool operator==(const MT_Tuple3& t1, const MT_Tuple3& t2) {
	const unsigned int *it1 = (const unsigned int *)&t1;
	const unsigned int *it2 = (const unsigned int *)&t2;
    return (it1[0] & MT_COMP_MASK) == (it2[0] & MT_COMP_MASK) &&
		   (it1[1] & MT_COMP_MASK) == (it2[1] & MT_COMP_MASK) &&
		   (it1[2] & MT_COMP_MASK) == (it2[2] & MT_COMP_MASK);
}

inline GEN_OStream& operator<<(GEN_OStream& os, const MT_Tuple3& t) {
    return os << t[0] << ' ' << t[1] << ' ' << t[2];
}

#endif

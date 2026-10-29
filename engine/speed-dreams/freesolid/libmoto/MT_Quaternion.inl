#include "GEN_Optimize.h"

GEN_INLINE MT_Quaternion& MT_Quaternion::operator*=(const MT_Quaternion& q) {
    setValue(m_co[3] * q[0] + m_co[0] * q[3] + m_co[1] * q[2] - m_co[2] * q[1],
             m_co[3] * q[1] + m_co[1] * q[3] + m_co[2] * q[0] - m_co[0] * q[2],
             m_co[3] * q[2] + m_co[2] * q[3] + m_co[0] * q[1] - m_co[1] * q[0],
             m_co[3] * q[3] - m_co[0] * q[0] - m_co[1] * q[1] - m_co[2] * q[2]);
    return *this;
}

GEN_INLINE void MT_Quaternion::conjugate() {
    m_co[0] = -m_co[0]; m_co[1] = -m_co[1]; m_co[2] = -m_co[2];
}

GEN_INLINE MT_Quaternion MT_Quaternion::conjugate() const {
    return MT_Quaternion(-m_co[0], -m_co[1], -m_co[2], m_co[3]);
}
  
GEN_INLINE void MT_Quaternion::invert() {
    conjugate();
    *this /= length2();
}

GEN_INLINE MT_Quaternion MT_Quaternion::inverse() const {
	MT_Scalar s = MT_Scalar(1.0) / length2();
	assert(s != MT_Scalar(0.0));
	return MT_Quaternion(-m_co[0] * s, -m_co[1] * s, -m_co[2] * s, m_co[3] * s);
}

GEN_INLINE MT_Quaternion MT_Quaternion::slerp(const MT_Quaternion& q, MT_Scalar t) const
{
	MT_Scalar theta = angle(q);
	MT_Scalar d = MT_Scalar(1.0) / sin(theta);
	MT_Scalar s0 = sin((MT_Scalar(1.0) - t) * theta);
	MT_Scalar s1 = sin(t * theta);   
    return MT_Quaternion((m_co[0] * s0 + q[0] * s1) * d,
						 (m_co[1] * s0 + q[1] * s1) * d,
						 (m_co[2] * s0 + q[2] * s1) * d,
						 (m_co[3] * s0 + q[3] * s1) * d);
}

GEN_INLINE MT_Quaternion MT_Quaternion::power(MT_Scalar s) const 
{
	MT_Scalar iv = acos(m_co[3]);
	assert(iv != MT_Scalar(0.0));
	MT_Scalar si = s * iv;
	MT_Scalar ss = sin(si) / sin(iv);
	return MT_Quaternion(m_co[0] * ss, m_co[1] * ss, m_co[2] * ss, cos(si));
}

GEN_INLINE MT_Quaternion MT_Quaternion::log() const
{
	MT_Scalar s = length();
	MT_Scalar theta = atan2(s, m_co[3]);
	if (s > MT_Scalar(0.0)) {
		s = theta / s;
	}
	return MT_Quaternion(m_co[0] * s, m_co[1] * s, m_co[2] * s, MT_Scalar(0.0));
}
// From: "Uniform Random Rotations", Ken Shoemake, Graphics Gems III, 
//       pg. 124-132
GEN_INLINE MT_Quaternion MT_Quaternion::random() {
    MT_Scalar x0 = MT_random();
    MT_Scalar r1 = MT_sqrt(MT_Scalar(1.0) - x0), r2 = sqrt(x0);
    MT_Scalar t1 = MT_2_PI * MT_random(), t2 = MT_2_PI * MT_random();
    MT_Scalar c1 = cos(t1), s1 = sin(t1);
    MT_Scalar c2 = cos(t2), s2 = sin(t2);
    return MT_Quaternion(s1 * r1, c1 * r1, s2 * r2, c2 * r2);
}

GEN_INLINE MT_Quaternion operator+(const MT_Quaternion& q1, const MT_Quaternion& q2)
{
	return MT_Quaternion(q1[0] + q2[0], q1[1] + q2[1], q1[2] + q2[2], q1[3] + q2[3]);
}

GEN_INLINE MT_Quaternion operator-(const MT_Quaternion& q1, const MT_Quaternion& q2)
{
	return MT_Quaternion(q1[0] - q2[0], q1[1] - q2[1], q1[2] - q2[2], q1[3] - q2[3]);
}

GEN_INLINE MT_Quaternion operator-(const MT_Quaternion& q)
{
	return MT_Quaternion(-q[0], -q[1], -q[2], -q[3]);
}

GEN_INLINE MT_Quaternion operator*(const MT_Quaternion& q, MT_Scalar s)
{
	return MT_Quaternion(q[0] * s, q[1] * s, q[2] * s, q[3] * s);
}

GEN_INLINE MT_Quaternion operator*(MT_Scalar s, const MT_Quaternion& q)
{
	return q * s;
}

GEN_INLINE MT_Quaternion operator*(const MT_Quaternion& q1, 
                                   const MT_Quaternion& q2) {
    return MT_Quaternion(q1[3] * q2[0] + q1[0] * q2[3] + q1[1] * q2[2] - q1[2] * q2[1],
                         q1[3] * q2[1] + q1[1] * q2[3] + q1[2] * q2[0] - q1[0] * q2[2],
                         q1[3] * q2[2] + q1[2] * q2[3] + q1[0] * q2[1] - q1[1] * q2[0],
                         q1[3] * q2[3] - q1[0] * q2[0] - q1[1] * q2[1] - q1[2] * q2[2]); 
}

GEN_INLINE MT_Quaternion operator*(const MT_Quaternion& q, const MT_Vector3& w)
{
    return MT_Quaternion( q[3] * w[0] + q[1] * w[2] - q[2] * w[1],
                          q[3] * w[1] + q[2] * w[0] - q[0] * w[2],
                          q[3] * w[2] + q[0] * w[1] - q[1] * w[0],
                         -q[0] * w[0] - q[1] * w[1] - q[2] * w[2]); 
}

GEN_INLINE MT_Quaternion operator*(const MT_Vector3& w, const MT_Quaternion& q)
{
    return MT_Quaternion( w[0] * q[3] + w[1] * q[2] - w[2] * q[1],
                          w[1] * q[3] + w[2] * q[0] - w[0] * q[2],
                          w[2] * q[3] + w[0] * q[1] - w[1] * q[0],
                         -w[0] * q[0] - w[1] * q[1] - w[2] * q[2]); 
}

GEN_INLINE MT_Quaternion MT_slerp(const MT_Quaternion& q1, const MT_Quaternion& q2, MT_Scalar t) 
{
	return q1.slerp(q2, t);
}

GEN_INLINE MT_Quaternion MT_power(const MT_Quaternion& q, MT_Scalar s)
{
	return q.power(s);
}

GEN_INLINE MT_Quaternion MT_log(const MT_Quaternion& q)
{
	return q.log();
}

/*
 * SOLID - Software Library for Interference Detection
 * Copyright (c) 2001 Dtecta <gino@dtecta.com>
 *
 * All rights reserved.
 */

#ifndef BP_ENDPOINT_H
#define BP_ENDPOINT_H

#include "GEN_List.h"
#include "MT_Scalar.h"

class BP_Scene;
class BP_Proxy;

typedef bool (*T_Overlap)(const BP_Proxy&, const BP_Proxy&);

class BP_Endpoint : public GEN_Link {
public:
    enum Type { MINIMUM, MAXIMUM };

    BP_Endpoint() : m_proxy(0) {}
    BP_Endpoint(MT_Scalar pos, Type type, BP_Proxy *proxy,
				   GEN_List& endpointList);
    ~BP_Endpoint();

	MT_Scalar getPos() const { return m_pos; }
	void setPos(MT_Scalar pos) { m_pos = pos; }

    void move(MT_Scalar x, BP_Scene& scene, T_Overlap);

    friend void encounters(const BP_Endpoint& a, const BP_Endpoint& b,
						   BP_Scene& scene, T_Overlap overlap);

    friend bool operator<(const BP_Endpoint& a, const BP_Endpoint& b);

private:
    MT_Scalar    m_pos;
    Type         m_type;
    BP_Proxy *m_proxy;
};

inline bool operator<(const BP_Endpoint& a, const BP_Endpoint& b) {
    return a.m_pos < b.m_pos || (a.m_pos == b.m_pos && a.m_type < b.m_type);
}

#endif

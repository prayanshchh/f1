/*
  SOLID - Software Library for Interference Detection
  Copyright (C) 1997-1998  Gino van den Bergen

  This library is free software; you can redistribute it and/or
  modify it under the terms of the GNU Library General Public
  License as published by the Free Software Foundation; either
  version 2 of the License, or (at your option) any later version.

  This library is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
  Library General Public License for more details.

  You should have received a copy of the GNU Library General Public
  License along with this library; if not, write to the Free
  Software Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.

  Please send remarks, questions and bug reports to gino@win.tue.nl,
  or write to:
                  Gino van den Bergen
		  Department of Mathematics and Computing Science
		  Eindhoven University of Technology
		  P.O. Box 513, 5600 MB Eindhoven, The Netherlands
*/

#include "Object.h"
#include "AlgoTable.h"
#include "Convex.h"
#include "Complex.h"

#include "MT_Point3.h"

#include <new>

Object::Object(DtObjectRef obj, ShapePtr shape, BP_SceneHandle broadphase) :
	ref(obj),
	shapePtr(shape),
	m_dirty(true),
	m_broadphase(broadphase),
	m_proxy(0)
{
	curr.setIdentity();
	proceed();
}

Object::~Object() {
	if (m_proxy) {
		BP_DeleteProxy(m_broadphase, m_proxy);
	}
}

void Object::do_broadphase() {
	if (m_dirty) {
		m_dirty = false;
		bbox = shapePtr->bbox(curr);
		Scalar *lower_point = new Scalar[3];
		Scalar *upper_point = new Scalar[3];
		lower_point = (bbox.getLower()).getValue();
		upper_point = (bbox.getUpper()).getValue();
		MT_Point3 lower(lower_point[0], lower_point[1], lower_point[2]);
		MT_Point3 upper(upper_point[0], upper_point[1], upper_point[2]);
		if (m_proxy) {
			BP_SetBBox(m_proxy, lower, upper);
		}
		else {
			m_proxy = BP_CreateProxy(m_broadphase, this, lower, upper);
		}
	}
}

void Object::proceed() {
  prev = curr;
}

typedef AlgoTable<Intersect> IntersectTable;
typedef AlgoTable<Common_point> Common_pointTable;


bool intersectConvexConvex(const Shape& a, const Shape& b,
			   const Transform& a2w, const Transform& b2w,
			   Vector& v) {
  return intersect((const Convex&)a, (const Convex&)b, a2w, b2w, v);
}

bool intersectComplexConvex(const Shape& a, const Shape& b,
			    const Transform& a2w, const Transform& b2w,
			    Vector& v) {
  return intersect((const Complex&)a, (const Convex&)b, a2w, b2w, v);
}

bool intersectComplexComplex(const Shape& a, const Shape& b,
			     const Transform& a2w, const Transform& b2w,
			     Vector& v) {
  return intersect((const Complex&)a, (const Complex&)b, a2w, b2w, v);
}

IntersectTable *intersectInitialize() {
  static IntersectTable p;
  p.addEntry(CONVEX, CONVEX, intersectConvexConvex);
  p.addEntry(COMPLEX, CONVEX, intersectComplexConvex);
  p.addEntry(COMPLEX, COMPLEX, intersectComplexComplex);
  return &p;
}

bool intersect(const Object& a, const Object& b, Vector& v) {
  static IntersectTable *intersectTable = intersectInitialize();
  Intersect i = intersectTable->lookup(a.shapePtr->getType(),b.shapePtr->getType());
  return i(*a.shapePtr,*b.shapePtr,a.curr,b.curr,v);
}

bool common_pointConvexConvex(const Shape& a, const Shape& b,
			      const Transform& a2w, const Transform& b2w,
			      Vector& v, Point& pa, Point& pb) {
  return common_point((const Convex&)a, (const Convex&)b, a2w, b2w, v, pa, pb);
}

bool common_pointComplexConvex(const Shape& a, const Shape& b,
			       const Transform& a2w, const Transform& b2w,
			       Vector& v, Point& pa, Point& pb) {
  return common_point((const Complex&)a, (const Convex&)b, a2w, b2w, v, pa, pb);
}

bool common_pointComplexComplex(const Shape& a, const Shape& b,
				const Transform& a2w, const Transform& b2w,
				Vector& v, Point& pa, Point& pb) {
  return common_point((const Complex&)a, (const Complex&)b, a2w, b2w, v, pa, pb);
}

Common_pointTable *common_pointInitialize() {
  static Common_pointTable p;
  p.addEntry(CONVEX, CONVEX, common_pointConvexConvex);
  p.addEntry(COMPLEX, CONVEX, common_pointComplexConvex);
  p.addEntry(COMPLEX, COMPLEX, common_pointComplexComplex);
  return &p;
}

bool common_point(const Object& a, const Object& b, Vector& v, Point& pa, Point& pb) {
  static Common_pointTable *common_pointTable = common_pointInitialize();
  Common_point cp = common_pointTable->lookup(a.shapePtr->getType(), b.shapePtr->getType());
  return cp(*a.shapePtr, *b.shapePtr, a.curr, b.curr, v, pa, pb);
}

bool prev_closest_points(const Object& a, const Object& b,
			 Vector& v, Point& pa, Point& pb) {
  ShapePtr sa, sb;
  if (a.shapePtr->getType() == COMPLEX) {
    if (b.shapePtr->getType() == COMPLEX) {
      if (!find_prim((const Complex&)*a.shapePtr, (const Complex&)*b.shapePtr,
		     a.curr, b.curr, v, sa, sb)) return false;
      ((Complex *)a.shapePtr)->swapBase();
      if (b.shapePtr != a.shapePtr) ((Complex *)b.shapePtr)->swapBase();
      closest_points((const Convex&)*sa, (const Convex&)*sb, a.prev, b.prev, pa, pb);
      ((Complex *)a.shapePtr)->swapBase();
      if (b.shapePtr != a.shapePtr) ((Complex *)b.shapePtr)->swapBase();
    }
    else {
      if (!find_prim((const Complex&)*a.shapePtr, (const Convex&)*b.shapePtr,
		a.curr, b.curr, v, sa)) return false;
      ((Complex *)a.shapePtr)->swapBase();
      closest_points((const Convex&)*sa, (const Convex&)*b.shapePtr, a.prev, b.prev, pa, pb);
      ((Complex *)a.shapePtr)->swapBase();
    }
  }
  else {
    if (!intersect(a, b, v)) return false;
    closest_points((const Convex&)*a.shapePtr, (const Convex&)*b.shapePtr, a.prev, b.prev, pa, pb);
  }

  return true;
}

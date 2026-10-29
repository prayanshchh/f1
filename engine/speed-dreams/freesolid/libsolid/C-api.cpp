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

#include <SOLID/solid.h>
#include <SOLID/broad.h>

#include <algorithm>

#include "Box.h"
#include "Cone.h"
#include "Cylinder.h"
#include "Sphere.h"
#include "Complex.h"
#include "Encounter.h"
#include "Object.h"
#include "Simplex.h"
#include "Polygon.h"
#include "Polyhedron.h"
#include "Response.h"
#include "RespTable.h"

#include <map>
#include <set>
#include <vector>

#include <stdio.h>

typedef vector<Point> PointBuf;
typedef vector<unsigned int> IndexBuf;
typedef vector<const Polytope *> PolyList;
typedef vector<Complex *> ComplexList;
typedef map<DtObjectRef, Object *> ObjectList;
typedef set<Encounter> ProxList;

static PointBuf pointBuf;
static IndexBuf indexBuf;
static PolyList polyList;
static ComplexList complexList;
static ObjectList objectList;
static RespTable respTable;
static ProxList proxList;

static DtPolyType currentType;
static Complex *currentComplex = NULL;
static Object *currentObject = NULL;
static bool caching = true;



void addPair(void *client_data, void *object1, void *object2) {
  ((ProxList *)client_data)->insert(Encounter((Object *)object1, (Object *)object2));
}

void removePair(void *client_data, void *object1, void *object2) {
  ((ProxList *)client_data)->erase(Encounter((Object *)object1, (Object *)object2));
}


static BP_SceneHandle broadphase = BP_CreateScene(&proxList, addPair, removePair);


extern Scalar rel_error;


DtShapeRef dtBox(DT_Scalar x,DT_Scalar y,DT_Scalar z) {
  return (DtShapeRef)new Box(x,y,z);
}

DtShapeRef dtCone(DT_Scalar radius,DT_Scalar height) {
  return (DtShapeRef)new Cone(radius,height);
}

DtShapeRef dtCylinder(DT_Scalar radius,DT_Scalar height) {
  return (DtShapeRef)new Cylinder(radius, height);
}

DtShapeRef dtSphere(DT_Scalar radius) {
  return (DtShapeRef)new Sphere(radius);
}

DtShapeRef dtNewComplexShape() {
  if (!currentComplex) currentComplex = new Complex;
  return (DtShapeRef)currentComplex;
}

void dtEndComplexShape() {
  if (currentComplex->getBase().getPointer() == 0) {
    Point *ptr = new Point[pointBuf.size()];
    copy(pointBuf.begin(),pointBuf.end(),ptr);
    currentComplex->setBase(ptr,true);
    pointBuf.erase(pointBuf.begin(),pointBuf.end());
  }
  currentComplex->finish(polyList.size(),&polyList[0]);
  polyList.erase(polyList.begin(), polyList.end());
  complexList.push_back(currentComplex);
  currentComplex = 0;
}

void dtBegin(DtPolyType type) {
  currentType = type;
}

void dtEnd() {
  dtVertexIndices(currentType,indexBuf.size(),&indexBuf[0]);
  indexBuf.erase(indexBuf.begin(),indexBuf.end());
}

void dtVertex(DT_Scalar x,DT_Scalar y,DT_Scalar z) {
  Point p(x,y,z);
  int i = pointBuf.size()-20;
  if (i < 0) i = 0;
  while (i < (int)pointBuf.size() && !(pointBuf[i] == p)) ++i;
  if (i == (int)pointBuf.size()) pointBuf.push_back(p);
  indexBuf.push_back(i);
}

void dtVertexBase(const void *base) {
  currentComplex->setBase(base);
}

void dtVertexIndex(DT_Index idx) {
  indexBuf.push_back(idx);
}

void dtVertexIndices(DtPolyType type,DT_Count cnt,const DT_Index *indices) {
  if (currentComplex) {
    const Polytope *poly;
    switch (type) {
    case DT_SIMPLEX:
      poly = new Simplex(currentComplex->getBase(), cnt, indices);
      break;
    case DT_POLYGON:
      poly = new Polygon(currentComplex->getBase(), cnt, indices);
      break;
    case DT_POLYHEDRON:
      if (currentComplex->getBase().getPointer()==0) {
	currentComplex->setBase(&pointBuf[0]);
	poly = new Polyhedron(currentComplex->getBase(),cnt,indices);
	currentComplex->setBase(0);
      }
      else poly = new Polyhedron(currentComplex->getBase(),cnt,indices);
      break;
    }
    polyList.push_back(poly);
  }
}

void dtVertexRange(DtPolyType type, DT_Index first, DT_Count cnt) {
  DT_Index *indices = new DT_Index[cnt];
  for (unsigned int i = 0; i < cnt;++i) indices[i] = first + i;
  dtVertexIndices(type,cnt,indices);
  delete [] indices;
}

void dtDeleteShape(DtShapeRef shape) {
  if (((Shape *)shape)->getType() == COMPLEX) {
    ComplexList::iterator i =
      find(complexList.begin(), complexList.end(), (Complex *)shape);
    if (i != complexList.end()) complexList.erase(i);
  }
  delete (Shape *)shape;
}

void dtChangeVertexBase(DtShapeRef shape, const void *base) {
  if (((Shape *)shape)->getType() == COMPLEX)
    ((Complex *)shape)->changeBase(base);
  for (ObjectList::const_iterator i = objectList.begin();
       i != objectList.end(); ++i) {
    if ((*i).second->shapePtr == (Shape *)shape) {
      (*i).second->do_broadphase();
    }
  }
}


// Object instantiation

void dtCreateObject(DtObjectRef object, DtShapeRef shape) {
 currentObject = objectList[object] = new Object(object,(Shape *)shape, broadphase);
}

void dtSelectObject(DtObjectRef object) {
  ObjectList::iterator i = objectList.find(object);
  if (i != objectList.end()) {
    currentObject = (*i).second;
  }
}

void dtDeleteObject(DtObjectRef object) {
  ObjectList::iterator i = objectList.find(object);
  if (i != objectList.end()) { // found
    if (currentObject == (*i).second) currentObject = NULL;
    delete (*i).second;
    objectList.erase(i);
  }
  else std::cout << "not found !" << std::endl;
  respTable.cleanObject(object);
}

void dtTranslate(DT_Scalar x, DT_Scalar y, DT_Scalar z) {
  if (currentObject) currentObject->translate(Vector(x, y, z));
}

void dtRotate(DT_Scalar x, DT_Scalar y, DT_Scalar z, DT_Scalar w) {
  if (currentObject) currentObject->rotate(Quaternion(x, y, z, w));
}

void dtScale(DT_Scalar x, DT_Scalar y, DT_Scalar z) {
  if (currentObject) currentObject->scale(x, y, z);
}

void dtLoadIdentity() {
  if (currentObject) currentObject->setIdentity();
}

void dtLoadMatrixf(const float *m) {
  if (currentObject) currentObject->setMatrix(m);
}

void dtLoadMatrixd(const double *m) {
  if (currentObject) currentObject->setMatrix(m);
}

void dtMultMatrixf(const float *m) {
  if (currentObject) currentObject->multMatrix(m);
}

void dtMultMatrixd(const double *m) {
  if (currentObject) currentObject->multMatrix(m);
}

// Response

void dtSetDefaultResponse(DtResponse response, DtResponseType type,
				  void *client_data) {
  respTable.setDefault(Response(response, type, client_data));
}

void dtClearDefaultResponse() {
  respTable.setDefault(Response());
}

void dtSetObjectResponse(DtObjectRef object, DtResponse response,
				 DtResponseType type, void *client_data) {
  respTable.setSingle(object, Response(response, type, client_data));
}

void dtClearObjectResponse(DtObjectRef object) {
  respTable.setSingle(object, Response());
}

void dtResetObjectResponse(DtObjectRef object) {
  respTable.resetSingle(object);
}

void dtSetPairResponse(DtObjectRef object1, DtObjectRef object2,
			       DtResponse response, DtResponseType type,
			       void * client_data) {
  respTable.setPair(object1, object2, Response(response, type, client_data));
}

void dtClearPairResponse(DtObjectRef object1, DtObjectRef object2) {
  respTable.setPair(object1, object2, Response());
}

void dtResetPairResponse(DtObjectRef object1, DtObjectRef object2) {
  respTable.resetPair(object1, object2);
}

// Runtime

void dtProceed() {
  for (ComplexList::iterator i = complexList.begin();
       i != complexList.end(); ++i)
    (*i)->proceed();
  for (ObjectList::const_iterator j = objectList.begin();
       j != objectList.end(); ++j)
    (*j).second->proceed();
}

void dtEnableCaching() {
  for (ObjectList::const_iterator i=objectList.begin();i!=objectList.end();++i)
    (*i).second->do_broadphase();
  caching = true;
}

void dtDisableCaching() { caching = false; }

void dtSetTolerance(DT_Scalar tol) { rel_error = tol; }

bool object_test(Encounter& e) {
  static Point p1, p2;
  const Response& resp = respTable.find(e.obj1->ref, e.obj2->ref);
  switch (resp.type) {
  case DT_SIMPLE_RESPONSE:
    if (intersect(*e.obj1, *e.obj2, e.sep_axis)) {
      resp(e.obj1->ref, e.obj2->ref);
      return true;
    }
    break;
  case DT_SMART_RESPONSE:
    if (prev_closest_points(*e.obj1, *e.obj2, e.sep_axis, p1, p2)) {
      Vector v = e.obj1->prev(p1) - e.obj2->prev(p2);
      resp(e.obj1->ref, e.obj2->ref, p1, p2, v);
      return true;
    }
    break;
  case DT_WITNESSED_RESPONSE:
    if (common_point(*e.obj1, *e.obj2, e.sep_axis, p1, p2)) {
      resp(e.obj1->ref, e.obj2->ref, p1, p2, Vector(0, 0, 0));
      return true;
    }
    break;
  default:
    return false;
  }
  return false;
}

DT_Count dtTest() {
   DT_Count cnt = 0;
   if (caching) {
      for (ObjectList::const_iterator j = objectList.begin();
			j != objectList.end(); ++j) {
	      (*j).second->do_broadphase();
      }
    for (ProxList::iterator i = proxList.begin(); i != proxList.end(); ++i)
      if (object_test((Encounter &)*i)) ++cnt;
  }
  else {
    int c=0;
    for (ObjectList::const_iterator j = objectList.begin();
	 j != objectList.end(); ++j)
      for (ObjectList::const_iterator i = objectList.begin();
	   i != j; ++i) {
	Encounter e((*i).second, (*j).second);
	c++;
	if (object_test(e)) ++cnt;
      }
  }
  return cnt;
}

void dtTestObjects(DtObjectRef object1, DtObjectRef object2) {
  // Programmed by Alok Menghrajani.
  // alok.menghrajani@epfl.ch
  static Object *obj1, *obj2;
  static Object *o1, *o2;
  static Vector sep_axis;
  static Point p1, p2;

  o1=(*objectList.find(object1)).second;
  o2=(*objectList.find(object2)).second;

  //  Encounter e(o1, o2);
  //  object_test(e);

  if (o2->shapePtr->getType() < o1->shapePtr->getType() ||
      (o2->shapePtr->getType() == o1->shapePtr->getType() && o2 < o1)) {
    obj1 = o2;
    obj2 = o1;
  }
  else {
    obj1 = o1;
    obj2 = o2;
  }
  sep_axis.setValue(0,0,0);

  const Response& resp = respTable.find(obj1->ref, obj2->ref);
  switch (resp.type) {
  case DT_NO_RESPONSE:
	  break;
  case DT_SIMPLE_RESPONSE:
    if (intersect(*obj1, *obj2, sep_axis))
      resp(obj1->ref, obj2->ref);
    break;
  case DT_SMART_RESPONSE:
    if (prev_closest_points(*obj1, *obj2, sep_axis, p1, p2)) {
      Vector v = obj1->prev(p1) - obj2->prev(p2);
      resp(obj1->ref, obj2->ref, p1, p2, v);
    }
    break;
  case DT_WITNESSED_RESPONSE:
    if (common_point(*obj1, *obj2, sep_axis, p1, p2))
      resp(obj1->ref, obj2->ref, p1, p2, Vector(0, 0, 0));
    break;
  }
}

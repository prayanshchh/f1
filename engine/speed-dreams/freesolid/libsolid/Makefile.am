lib_LTLIBRARIES = libFreeSOLID.la

libFreeSOLID_la_SOURCES = \
	Transform.cpp Convex.cpp Box.cpp Cone.cpp Cylinder.cpp Sphere.cpp \
	Simplex.cpp Polygon.cpp Polyhedron.cpp Complex.cpp \
	BBoxTree.cpp Object.cpp Response.cpp RespTable.cpp \
	C-api.cpp 	\
	../libbroad/BP_C-api.cpp \
	../libbroad/BP_Endpoint.cpp \
	../libbroad/BP_Proxy.cpp \
	../libbroad/BP_Scene.cpp \
	../libmoto/GEN_random.cpp \
	../libmoto/MT_Matrix3x3.cpp \
	../libmoto/MT_Point2.cpp \
	../libmoto/MT_Point3.cpp \
	../libmoto/MT_Quaternion.cpp \
	../libmoto/MT_Transform.cpp \
	../libmoto/MT_Vector2.cpp \
	../libmoto/MT_Vector3.cpp \
	../libmoto/MT_Vector4.cpp


libFreeSOLID_la_LDFLAGS = -no-undefined -version-info @FREESOLID_CURRENT@:@FREESOLID_REVISION@:@FREESOLID_AGE@ -release @VERSION@

CPPFLAGS = @CPPFLAGS@
LIBS = @QHULL_LIBS@ -lm

pkginclude_HEADERS = \
	AlgoTable.h \
	BBox.h \
	BBoxTree.h \
	Box.h \
	Complex.h \
	Cone.h \
	Convex.h \
	Cylinder.h \
	Encounter.h \
	IndexArray.h \
	Object.h \
	Polygon.h \
	Polyhedron.h \
	Polytope.h \
	RespTable.h \
	Response.h \
	Shape.h \
	Simplex.h \
	Sphere.h \
	Transform.h \
	VertexBase.h \
	../libbroad/BP_Endpoint.h \
	../libbroad/BP_Proxy.h \
	../libbroad/BP_Scene.h \
	../libmoto/GEN_List.h \
	../libmoto/GEN_MinMax.h \
	../libmoto/GEN_Optimize.h \
	../libmoto/GEN_random.h \
	../libmoto/GEN_Stream.h \
	../libmoto/MT_Matrix3x3.h \
	../libmoto/MT_Point2.h \
	../libmoto/MT_Point3.h \
	../libmoto/MT_Point.h \
	../libmoto/MT_Quaternion.h \
	../libmoto/MT_Scalar.h \
	../libmoto/MT_Transform.h \
	../libmoto/MT_Tuple2.h \
	../libmoto/MT_Tuple3.h \
	../libmoto/MT_Tuple4.h \
	../libmoto/MT_Vector2.h \
	../libmoto/MT_Vector3.h \
	../libmoto/MT_Vector4.h



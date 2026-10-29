# FreeSOLID - Interference Detection Library.
# Copyright (C) 2025 Xavier Del Campo Romero
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.

add_library(solid
    BBoxTree.cpp
    Box.cpp
    C-api.cpp
    Complex.cpp
    Cone.cpp
    Convex.cpp
    Cylinder.cpp
    Ellipsoid.cpp
    Object.cpp
    Polygon.cpp
    Polyhedron.cpp
    Response.cpp
    RespTable.cpp
    Simplex.cpp
    Sphere.cpp
    Transform.cpp
)

target_include_directories(solid PRIVATE ${CMAKE_CURRENT_LIST_DIR})
target_compile_options(solid PRIVATE -Wall)
target_link_libraries(solid INTERFACE ${PROJECT_NAME} PRIVATE moto broad)
install(TARGETS solid)

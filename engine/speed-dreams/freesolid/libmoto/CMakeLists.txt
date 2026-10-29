# FreeSOLID - Interference Detection Library.
# Copyright (C) 2025 Xavier Del Campo Romero
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.

add_library(moto
    GEN_random.cpp
    MT_Matrix3x3.cpp
    MT_Point2.cpp
    MT_Point3.cpp
    MT_Quaternion.cpp
    MT_Transform.cpp
    MT_Vector2.cpp
    MT_Vector3.cpp
    MT_Vector4.cpp
)

target_link_libraries(moto INTERFACE ${PROJECT_NAME} PRIVATE)
target_include_directories(moto PUBLIC ${CMAKE_CURRENT_LIST_DIR})
target_compile_options(moto PRIVATE -Wall)

install(TARGETS moto)

# FreeSOLID - Interference Detection Library.
# Copyright (C) 2025 Xavier Del Campo Romero
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.

add_library(broad
    BP_C-api.cpp
    BP_Endpoint.cpp
    BP_Proxy.cpp
    BP_Scene.cpp
)

target_link_libraries(broad INTERFACE ${PROJECT_NAME} PRIVATE moto)
target_include_directories(broad PRIVATE ${CMAKE_CURRENT_LIST_DIR})
target_compile_options(broad PRIVATE -Wall)
install(TARGETS broad)

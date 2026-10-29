INCLUDE(../../cmake/macros.cmake)

SET(INTERFACES_HEADERS car.h graphic.h playerpref.h raceman.h
                       replay.h robot.h telemetry.h track.h
                       iraceengine.h iuserinterface.h igraphicsengine.h
                       iphysicsengine.h itrackloader.h isoundengine.h
                       camera.h sound.h sgcompat.h)

# Fictive = no-output target, for having source files available in IDEs.
SD_ADD_LIBRARY(interfaces INTERFACE ${INTERFACES_HEADERS})

target_include_directories(interfaces INTERFACE ${CMAKE_CURRENT_LIST_DIR})
target_link_libraries(interfaces INTERFACE math)

SD_INSTALL_FILES(INCLUDE FILES ${INTERFACES_HEADERS})

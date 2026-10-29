INCLUDE(../../../../cmake/macros.cmake)

ADD_SDLIB_INCLUDEDIR(portability)

IF(WIN32)
	# DLL export stuff under Windows (to avoid .def file)
    ADD_DEFINITIONS(-DSIMUV5_DLL)
ENDIF(WIN32)

IF(MSVC)
    # Ignore some run-time libs to avoid link time warnings and sometimes even crashes.
    SET(CMAKE_MODULE_LINKER_FLAGS_DEBUG "${CMAKE_MODULE_LINKER_FLAGS_DEBUG} /NODEFAULTLIB:msvcrt.lib")
ENDIF(MSVC)

SET(SIMU_SOURCES aero.cpp atmosphere.cpp axle.cpp brake.cpp car.cpp categories.cpp
                 collide.cpp differential.cpp engine.cpp simu.cpp simulationOptions.cpp
                 steer.cpp susp.cpp transmission.cpp wheel.cpp
                 simuv5.cpp)
SET(SIMU_HEADERS aero.h axle.h brake.h carstruct.h differential.h engine.h
                 options.h sim.h simulationOptions.h steer.h susp.h transmission.h
				 wheel.h simuv5.h)

ADD_PLIB_INCLUDEDIR()

ADD_INTERFACE_INCLUDEDIR()
ADD_SDLIB_INCLUDEDIR(math tgf robottools)

# Note: Headers needed for having them available in IDEs.
SD_ADD_LIBRARY(simuv5 MODULE ${SIMU_SOURCES} ${SIMU_HEADERS})
ADD_PLIB_LIBRARY(simuv5 sg)

# Might not work with GCC 4.5 or + (non-robot modules crash at 1st reload = after 1 dlclose)
#SET_TARGET_PROPERTIES(simuv2.1 PROPERTIES VERSION ${VERSION} SOVERSION 0.0.0)

ADD_SDLIB_LIBRARY(simuv5 portability tgf robottools solid math)

SD_INSTALL_FILES(LIB modules/simu TARGETS simuv5)

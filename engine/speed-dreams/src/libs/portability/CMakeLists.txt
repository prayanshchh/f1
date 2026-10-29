INCLUDE(../../../cmake/macros.cmake)

#PROJECT(portability)

SET(PORTABILITY_HEADERS portability.h)
SET(PORTABILITY_SOURCES portability.cpp ${PORTABILITY_HEADERS})

# Disable developer warning
IF(COMMAND CMAKE_POLICY)
	CMAKE_POLICY(SET CMP0003 NEW)
ENDIF(COMMAND CMAKE_POLICY)

IF(WIN32)
	# DLL export stuff under Windows (to avoid .def file)
	ADD_DEFINITIONS(-DPORTABILITY_DLL)
	set(PORTABILITY_SOURCES ${PORTABILITY_SOURCES}
		win32/rand.cpp
		win32/rmdir_r.cpp)
ELSEIF(UNIX)
	set(PORTABILITY_SOURCES ${PORTABILITY_SOURCES}
		posix/rand.cpp
		posix/rmdir_r.cpp)
ENDIF(WIN32)

# Note: Headers needed for having them available in IDEs.
SD_ADD_LIBRARY(portability SHARED ${PORTABILITY_SOURCES} ${PORTABILITY_HEADERS})

IF(WIN32)
	TARGET_LINK_LIBRARIES(portability shlwapi)
ENDIF()

target_include_directories(portability PUBLIC
	${CMAKE_BINARY_DIR}
	${CMAKE_CURRENT_LIST_DIR}
)

# Might not work with GCC 4.5 or + (non-robot modules crash at 1st reload = after 1 dlclose)
#SET_TARGET_PROPERTIES(portability PROPERTIES VERSION ${VERSION} SOVERSION 0.0.0)

IF(WIN32)
	SD_INSTALL_FILES(BIN TARGETS portability)
ELSE(WIN32)
	SD_INSTALL_FILES(LIB lib TARGETS portability)
ENDIF(WIN32)

SD_INSTALL_FILES(INCLUDE FILES ${PORTABILITY_HEADERS})

# Microsoft Developer Studio Project File - Name="moto" - Package Owner=<4>
# Microsoft Developer Studio Generated Build File, Format Version 6.00
# ** DO NOT EDIT **

# TARGTYPE "Win32 (x86) Static Library" 0x0104

CFG=moto - Win32 Debug
!MESSAGE This is not a valid makefile. To build this project using NMAKE,
!MESSAGE use the Export Makefile command and run
!MESSAGE 
!MESSAGE NMAKE /f "moto.mak".
!MESSAGE 
!MESSAGE You can specify a configuration when running NMAKE
!MESSAGE by defining the macro CFG on the command line. For example:
!MESSAGE 
!MESSAGE NMAKE /f "moto.mak" CFG="moto - Win32 Debug"
!MESSAGE 
!MESSAGE Possible choices for configuration are:
!MESSAGE 
!MESSAGE "moto - Win32 Release" (based on "Win32 (x86) Static Library")
!MESSAGE "moto - Win32 Debug" (based on "Win32 (x86) Static Library")
!MESSAGE 

# Begin Project
# PROP AllowPerConfigDependencies 0
# PROP Scc_ProjName ""
# PROP Scc_LocalPath ""
CPP=cl.exe
RSC=rc.exe

!IF  "$(CFG)" == "moto - Win32 Release"

# PROP BASE Use_MFC 0
# PROP BASE Use_Debug_Libraries 0
# PROP BASE Output_Dir "Release"
# PROP BASE Intermediate_Dir "Release"
# PROP BASE Target_Dir ""
# PROP Use_MFC 0
# PROP Use_Debug_Libraries 0
# PROP Output_Dir "../lib"
# PROP Intermediate_Dir "Release"
# PROP Target_Dir ""
# ADD BASE CPP /nologo /W3 /GX /O2 /D "WIN32" /D "NDEBUG" /D "_MBCS" /D "_LIB" /YX /FD /c
# ADD CPP /nologo /MD /W3 /GX /O2 /I "../include" /D "WIN32" /D "NDEBUG" /D "_MBCS" /D "_LIB" /D "GEN_INLINED" /YX /FD /c
# ADD BASE RSC /l 0x413 /d "NDEBUG"
# ADD RSC /l 0x413 /d "NDEBUG"
BSC32=bscmake.exe
# ADD BASE BSC32 /nologo
# ADD BSC32 /nologo
LIB32=link.exe -lib
# ADD BASE LIB32 /nologo
# ADD LIB32 /nologo

!ELSEIF  "$(CFG)" == "moto - Win32 Debug"

# PROP BASE Use_MFC 0
# PROP BASE Use_Debug_Libraries 1
# PROP BASE Output_Dir "Debug"
# PROP BASE Intermediate_Dir "Debug"
# PROP BASE Target_Dir ""
# PROP Use_MFC 0
# PROP Use_Debug_Libraries 1
# PROP Output_Dir "../lib"
# PROP Intermediate_Dir "Debug"
# PROP Target_Dir ""
# ADD BASE CPP /nologo /W3 /Gm /GX /ZI /Od /D "WIN32" /D "_DEBUG" /D "_MBCS" /D "_LIB" /YX /FD /GZ /c
# ADD CPP /nologo /MD /W3 /Gm /GX /ZI /Od /I "../include" /D "WIN32" /D "_DEBUG" /D "_MBCS" /D "_LIB" /YX /FD /GZ /c
# ADD BASE RSC /l 0x413 /d "_DEBUG"
# ADD RSC /l 0x413 /d "_DEBUG"
BSC32=bscmake.exe
# ADD BASE BSC32 /nologo
# ADD BSC32 /nologo
LIB32=link.exe -lib
# ADD BASE LIB32 /nologo
# ADD LIB32 /nologo /out:"../lib/motod.lib"

!ENDIF 

# Begin Target

# Name "moto - Win32 Release"
# Name "moto - Win32 Debug"
# Begin Group "Source Files"

# PROP Default_Filter "cpp;c;cxx;rc;def;r;odl;idl;hpj;bat"
# Begin Source File

SOURCE=.\GEN_random.cpp
# End Source File
# Begin Source File

SOURCE=.\MT_Matrix3x3.cpp
# End Source File
# Begin Source File

SOURCE=.\MT_Point2.cpp
# End Source File
# Begin Source File

SOURCE=.\MT_Point3.cpp
# End Source File
# Begin Source File

SOURCE=.\MT_Quaternion.cpp
# End Source File
# Begin Source File

SOURCE=.\MT_Transform.cpp
# End Source File
# Begin Source File

SOURCE=.\MT_Vector2.cpp
# End Source File
# Begin Source File

SOURCE=.\MT_Vector3.cpp
# End Source File
# Begin Source File

SOURCE=.\MT_Vector4.cpp
# End Source File
# End Group
# Begin Group "Header Files"

# PROP Default_Filter "h;hpp;hxx;hm;inl"
# Begin Source File

SOURCE=..\include\GEN_List.h
# End Source File
# Begin Source File

SOURCE=..\include\GEN_MinMax.h
# End Source File
# Begin Source File

SOURCE=..\include\GEN_Optimize.h
# End Source File
# Begin Source File

SOURCE=..\include\GEN_random.h
# End Source File
# Begin Source File

SOURCE=..\include\GEN_Stream.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Matrix3x3.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Matrix3x3.inl
# End Source File
# Begin Source File

SOURCE=..\include\MT_Point.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Point2.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Point2.inl
# End Source File
# Begin Source File

SOURCE=..\include\MT_Point3.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Point3.inl
# End Source File
# Begin Source File

SOURCE=..\include\MT_Quaternion.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Quaternion.inl
# End Source File
# Begin Source File

SOURCE=..\include\MT_Scalar.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Transform.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Tuple2.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Tuple3.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Tuple4.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Vector2.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Vector2.inl
# End Source File
# Begin Source File

SOURCE=..\include\MT_Vector3.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Vector3.inl
# End Source File
# Begin Source File

SOURCE=..\include\MT_Vector4.h
# End Source File
# Begin Source File

SOURCE=..\include\MT_Vector4.inl
# End Source File
# Begin Source File

SOURCE=..\include\NM_Scalar.h
# End Source File
# End Group
# End Target
# End Project

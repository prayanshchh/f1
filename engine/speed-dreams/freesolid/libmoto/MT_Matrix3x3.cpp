#include "MT_Matrix3x3.h"

const MT_Matrix3x3 MT_Matrix3x3::IDENTITY(
	MT_Scalar(1.0), MT_Scalar(0.0), MT_Scalar(0.0),
	MT_Scalar(0.0), MT_Scalar(1.0), MT_Scalar(0.0),
	MT_Scalar(0.0), MT_Scalar(0.0), MT_Scalar(1.0)
);


#ifndef GEN_INLINED
#include "MT_Matrix3x3.inl"
#endif

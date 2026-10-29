#ifndef GEN_STREAM_H
#define GEN_STREAM_H

#ifdef __CUSTOM_STREAM

class GEN_OStream
{
public:
    inline  GEN_OStream& operator<<(double);
    inline  GEN_OStream& operator<<(int);
    inline  GEN_OStream& operator<<(char*);
};

const char GEN_endl = '\n';

#else

#include <iostream>

typedef std::ostream GEN_OStream;

inline GEN_OStream& GEN_endl(GEN_OStream& os) { return std::endl(os); }

#endif

#endif

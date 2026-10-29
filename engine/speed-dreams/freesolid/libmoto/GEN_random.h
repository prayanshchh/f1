#ifndef GEN_RANDOM_H
#define GEN_RANDOM_H

#include <limits.h>

#define GEN_RAND_MAX ULONG_MAX

extern void          GEN_srand(unsigned long);
extern unsigned long GEN_rand();

#endif

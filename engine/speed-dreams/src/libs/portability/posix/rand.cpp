/*
 * Speed Dreams, a free and open source motorsport simulator.
 * Copyright (C) 2024 Xavier Del Campo Romero
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

#define _POSIX_C_SOURCE 200809L

#include "portability.h"
#include <cstddef>
#include <cstdio>
#include <fstream>

int portability::rand(void *buf, size_t n)
{
    std::ifstream f("/dev/urandom", std::ios::binary);

    try
    {
        f.read(static_cast<char *>(buf), n);
    }
    catch (const std::ios_base::failure &failure)
    {
        fprintf(stderr, "Failed to read %zu random bytes\n", n);
        return -1;
    }

    return 0;
}

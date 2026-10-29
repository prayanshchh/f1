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
#include <ftw.h>
#include <cerrno>
#include <cstdio>
#include <cstring>

static int do_rm(const char *path, const struct stat *, int, struct FTW *)
{
    if (remove(path))
    {
        fprintf(stderr, "%s: remove(3) %s: %s\n", __func__, path,
            strerror(errno));
        return -1;
    }

    return 0;
}

int portability::rmdir_r(const char *path)
{
    if (nftw(path, do_rm, 8, FTW_DEPTH)
        && errno != ENOTDIR && errno != ENOENT)
    {
        fprintf(stderr, "%s: nftw(3) %s: %s\n", __func__, path,
            strerror(errno));
        return -1;
    }

    return 0;
}

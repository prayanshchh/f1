/*
 * Speed Dreams, a free and open source motorsport simulator.
 * Copyright (C) 2024-2025 Xavier Del Campo Romero
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 */

#include <tgf.h>
#include <string>

int GfTmpPath(std::string &path)
{
    const char *dir = GfLocalDir();

    if (!dir)
    {
        GfLogError("unexpected null GfLocalDir\n");
        return -1;
    }

    const std::string tmpdir = std::string(dir) + "/tmp/";

    if (GfDirCreate(tmpdir.c_str()) != GF_DIR_CREATED)
    {
        GfLogError("Failed to create directory %s\n", tmpdir.c_str());
        return -1;
    }

    std::string r;

    if (GfRandName(r))
    {
        GfLogError("Failed to generate random file name\n");
        return -1;
    }

    path = tmpdir + r;
    return 0;
}

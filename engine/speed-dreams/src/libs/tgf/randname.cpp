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
#include <portability.h>
#include <string>

int GfRandName(std::string &name)
{
    static const size_t len = 32;

    for (size_t i = 0; i < len; i++)
    {
        unsigned char b;

        if (portability::rand(&b, sizeof b))
        {
            GfLogError("%s: portability::rand failed\n", __func__);
            return -1;
        }

        char hex[sizeof "00"];
        int n = snprintf(hex, sizeof hex, "%02hhx", b);

        if (n < 0 || n >= static_cast<int>(sizeof hex))
        {
            GfLogError("snprintf(3) failed with %d\n", n);
            return -1;
        }

        name += hex;
    }

    return 0;
}

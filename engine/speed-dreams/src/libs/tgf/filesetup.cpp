/***************************************************************************
                 filesetup.cpp -- Versioned settings XML files installation
                             -------------------
    created              : 2009
    author               : Mart Kelder
    web                  : http://speed-dreams.sourceforge.net
 ***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/

/** @file
            Versioned settings XML files installation at run-time
    @author	Mart Kelder
    @ingroup	tgf
*/

#include "portability.h"
#include <sys/stat.h>
#include "tgf.h"
#include <fstream>
#include <string>

struct version
{
    int major, minor;
};

static int getversion(void *h, struct version &v)
{
    if ((v.major = GfParmGetMajorVersion(h)) < 0)
    {
        GfLogError("GfParmGetMajorVersion failed\n");
        return -1;
    }
    else if ((v.minor = GfParmGetMinorVersion(h)) < 0)
    {
        GfLogError("GfParmGetMinorVersion failed\n");
        return -1;
    }

    return 0;
}

static bool needs_update(const struct version &src, const struct version &dst)
{
    return src.major > dst.major || src.minor > dst.minor;
}

static int update(const std::string &file)
{
    int ret = -1;
    char *dstdir = nullptr;
    std::string srcpath = std::string(GfDataDir()) + file,
        dstpath = std::string(GfLocalDir()) + file;
    const char *sp = srcpath.c_str(), *dp = dstpath.c_str();
    std::ifstream src(srcpath, std::ios::binary);
    std::ofstream dst;

    if (!src.is_open())
    {
        GfLogError("Failed to open file for reading: %s\n", sp);
        goto end;
    }
    else if (!(dstdir = GfFileGetDirName(dp)))
    {
        GfLogError("GfFileGetDirName %s failed\n", dp);
        goto end;
    }
    else if (GfDirCreate(dstdir) != GF_DIR_CREATED)
    {
        GfLogError("Failed to created directory: %s\n", dstdir);
        goto end;
    }

    dst.open(dstpath, std::ios::binary);

    if (!dst.is_open())
    {
        GfLogError("Failed to open file for writing: %s\n", dp);
        goto end;
    }

    dst << src.rdbuf();

    if (!dst.good())
    {
        GfLogError("Failed to write from %s to %s\n", sp, dp);
        goto end;
    }

    ret = 0;

end:
    free(dstdir);
    return ret;
}

static int process(const std::string &file)
{
    int ret = -1;
    const char *path = file.c_str();
    void *src = GfParmReadFile(path, GFPARM_RMODE_STD),
        *dst = GfParmReadFileLocal(path, GFPARM_RMODE_STD);
    struct version srcv, dstv;

    if (!src)
    {
        GfLogError("GfParmReadFile failed: %s\n", path);
        goto end;
    }
    else if (!dst)
    {
        GfLogInfo("%s not found on user settings, forcing update\n", path);

        if (update(file))
        {
            GfLogError("Failed to update file: %s\n", path);
            goto end;
        }
    }
    else if (getversion(src, srcv))
    {
        GfLogError("Failed to extract source version: %s\n", path);
        goto end;
    }
    else if (getversion(dst, dstv))
    {
        GfLogError("Failed to extract user version: %s\n", path);
        goto end;
    }
    else if (needs_update(srcv, dstv) )
    {
        if (update(path))
        {
            GfLogError("Failed to update file: %s\n", path);
            goto end;
        }

        GfLogInfo("Updated %s from %d.%d to %d.%d\n", path,
            dstv.major, dstv.minor, srcv.major, srcv.minor);
    }

    ret = 0;

end:

    if (src)
        GfParmReleaseHandle(src);

    if (dst)
        GfParmReleaseHandle(dst);

    return ret;
}

int GfFileSetup()
{
    const char *datadir = GfDataDir();

    if (!datadir)
    {
        GfLogError("GfDataDir failed\n");
        return -1;
    }

    std::string path = std::string(datadir) + "user-files";
    std::ifstream f(path, std::ios::binary);

    if (!f.is_open())
    {
        GfLogError("Failed to open %s\n", path.c_str());
        return -1;
    }

    std::string line;

    while (std::getline(f, line))
        if (!line.empty() && process(line))
        {
            GfLogError("Failed to process line: %s\n", line.c_str());
            return -1;
        }

    return 0;
}

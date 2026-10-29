#include <tgfclient.h>

#include "game.h"

static tfuiKeyCallback keyCallback = nullptr;

void GfuiKeyEventRegisterCurrent(tfuiKeyCallback onKeyAction)
{
    keyCallback = onKeyAction;
}

int GfuiScreenIsActive(void *screen)
{
    return 0;
}

void GfuiMouseShow(void)
{
}

void GfScrGetSize(int *scrW, int *scrH, int *viewW, int *viewH)
{
    *scrW = 1280;
    *scrH = 720;
    *viewW = 1280;
    *viewH = 720;
}

void sdKeyEvent(int key, int state)
{
    sdInputKey(key, state);
    if (keyCallback)
        keyCallback(key, 0, state);
}

static tMouseInfo mouseInfo = {640, 360, {0}};

tMouseInfo *GfuiMouseInfo(void)
{
    return &mouseInfo;
}

void GfuiMouseSetPos(int x, int y)
{
    mouseInfo.X = x;
    mouseInfo.Y = y;
}

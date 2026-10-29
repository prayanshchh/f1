/***************************************************************************
                        guifont.h -- Interface file for guifont
                             -------------------
    created              : Fri Aug 13 22:20:04 CEST 1999
    copyright            : (C) 1999 by Eric Espie
    email                : torcs@free.fr
 ***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/

#ifndef _GUIFONT_H_
#define _GUIFONT_H_

#include <SDL2/SDL.h>
#include <SDL2/SDL_ttf.h>

class GfuiFontClass
{
protected:
  TTF_Font *font;

public:
  GfuiFontClass(const char *font, int size);
  ~GfuiFontClass();
  int drawString(int x, int y, const char* text, const float *color = nullptr)
    const;
  int getHeight() const;
  int getWidth(const char* text) const;
};

extern GfuiFontClass	*gfuiFont[];

#endif /* _GUIFONT_H_ */

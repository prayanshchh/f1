/***************************************************************************

    file                 : sound.h
    created              : Sun Jan 13 10:58:45 CET 2013
    copyright            : (C) 2013 by Jean-Philippe
    web                  : www.speed-dreams.org

 ***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/


#ifndef _SOUND_H_
#define _SOUND_H_

#define SND_PARAM_FILE                "config/sound.xml"

#define SND_SCT_SOUND                 "Sound Settings"

#define SND_ATT_SOUND_STATE           "state"
#define SND_ATT_SOUND_STATE_PLIB      "plib"
#define SND_ATT_SOUND_STATE_OPENAL	  "openal"
#define SND_ATT_SOUND_STATE_DISABLED  "disabled"
#define SND_ATT_SOUND_VOLUME          "volume"

#define SND_SCT_MUSIC                 "Music Settings"
#define SND_SCT_TRACKS                "Tracks"

//#define MM_ATT_SOUND_ENABLE             "enable"
//#define MM_VAL_SOUND_ENABLED            "enabled"
//#define MM_VAL_SOUND_DISABLED           "disabled"

#define SND_ATT_MUSIC_VOLUME           "music volume"
#define SND_ATT_MUSIC_STATE            "music state"
#define SND_VAL_MUSIC_STATE_ENABLED    "enabled"
#define SND_VAL_MUSIC_STATE_DISABLED   "disabled"
#define SND_ATT_MUSIC_DEFAULT_MUSIC    "default music"
#define SND_ATT_MUSIC_NAME             "name"
#define SND_ATT_MUSIC_AUTHOR           "author"
#define SND_ATT_MUSIC_LICENSE          "license"
#define SND_ATT_MUSIC_PATH             "path"

#define SND_SCT_MENUSFX                "Menu SFX Settings"

#define SND_ATT_MENUSFX_VOLUME         "menusfx volume"
#define SND_ATT_MENUSFX_STATE          "menusfx state"
#define SND_VAL_MENUSFX_STATE_ENABLED  "enabled"
#define SND_VAL_MENUSFX_STATE_DISABLED "disabled"

#endif /* _SOUND_H_ */

/***************************************************************************

    file        : OsgViewer.h
    created     : Sat Jan 2013 22:11:19 CEST 2013
    copyright   : (C) 2013 by Xavier Bertaux
    email       : bertauxx@yahoo.fr
 ***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/

#ifndef _OSGVIEWER_H_
#define _OSGVIEWER_H_

#include <camera.h>

#include "OsgCamera.h"		//SDCameras

#include <osg/FrontFace>

struct Situation;
struct CarElt;
typedef struct CarElt tCarElt;
typedef struct Situation tSituation;

namespace osggraph {

class SDFrameInfo;

class SDView
{
protected:
    osg::Camera *cam;
    osg::Camera *mirrorCam;
    osg::FrontFace *camFrontFace;
    osg::FrontFace *mirrorCamFrontFace;

    int id;
    int x, y, width, height;
    float viewOffset;

    tCarElt	*curCar;		// Current car viewed.
    tCarElt	**cars;			// List of cars.

    bool selectNextFlag;
    bool selectPrevFlag;
    bool mirrorFlag;
    bool hasChangedMirrorFlag;

    SDCameras *cameras;
    SDCarCamMirror * mirror;

    //class cGrPerspCamera *curCam;			// The current camera.
    //class cGrCarCamMirror *mirrorCam;		// The mirror camera.
    //class cGrPerspCamera *dispCam;			// The display camera.
    //class cGrOrthoCamera *boardCam;			// The board camera.
    //class cGrBackgroundCam *bgCam;			// The background camera.

    //class cGrBoard *board;					// The board.

    void loadParams(tSituation *s);			// Load from parameters files.

public:
    SDView(int id, osg::Camera * c, int x , int y, int width , int height, osg::Camera * mc);
    ~SDView();

    void Init(tSituation *s);
    void update(tSituation *s, const SDFrameInfo* frameInfo);

    void setCurrentCar(tCarElt *newCurCar);

    inline int getId() const { return id; }
    inline void selectNextCar(void) { selectNextFlag = true; }
    inline void selectPrevCar(void) { selectPrevFlag = true; }

    void switchMirror(void);
    void de_activateMirror();

    inline tCarElt *getCurrentCar(void) { return curCar; }
    inline SDCameras *getCameras() { return cameras; }

    inline tdble getViewRatio() const { return width/(tdble)height; }
    //used for sound
    Camera* getCamera();

    inline osg::Camera *  getOsgCam(void) { return cam; }
    inline osg::Camera *  getOsgMirrorCam(void) { return mirrorCam; }

    inline osg::FrontFace *  getOsgCamFrontFace(void) { return camFrontFace; }
    inline osg::FrontFace *  getOsgMirrorCamFrontFace(void) { return mirrorCamFrontFace; }

    inline int  getScreenXPos(void) const { return x; }
    inline int  getScreenYPos(void) const { return y; }

    inline int  getScreenWidth(void) const { return width; }
    inline int  getScreenHeight(void) const { return height; }

    inline float getViewOffset() const { return viewOffset; }

    void saveCamera();

    void activate(int x, int y, int width, int height,float v);
    void deactivate();
};

} // namespace osggraph

#endif //_OSGVIEWER_H_

#ifndef SD_WEB_VIEW_H
#define SD_WEB_VIEW_H

#include <string>
#include <osg/Vec3>
#include <osg/Vec4>
#include <osg/Matrixd>
#include <osg/Node>
#include <osg/FrontFace>
#include <tgf.h>
#include <track.h>
#include <car.h>
#include <raceman.h>

#include "OsgCamera.h"

namespace osggraph {

class WebFrontFace
{
public:
    int mode = osg::FrontFace::COUNTER_CLOCKWISE;
    void setMode(osg::FrontFace::Mode m) { mode = m; }
};

class WebOsgCamera
{
public:
    osg::Matrixd view;
    double fovy = 67.5, aspect = 1, znear = 1, zfar = 41000;
    double left = 0, right = 0, bottom = 0, top = 0;

    void setProjectionMatrixAsPerspective(double f, double a, double n, double fa);
    bool getProjectionMatrixAsFrustum(double &l, double &r, double &b, double &t, double &n, double &f) const;
    void setProjectionMatrixAsFrustum(double l, double r, double b, double t, double n, double f);
    void setViewMatrixAsLookAt(const osg::Vec3d &eye, const osg::Vec3d &center, const osg::Vec3d &up);
    void setViewMatrix(const osg::Matrixd &m) { view = m; }
    template <typename T> void setUserValue(const std::string &, const T &) {}
};

class SDView
{
    int id;
    int x, y, width, height;
    float viewOffset;
    tCarElt *curCar;
    SDCameras *cameras;
    int mirrorFlag;
    WebOsgCamera cam;
    WebOsgCamera mirrorCam;
    WebFrontFace camFrontFace;
    WebFrontFace mirrorCamFrontFace;

public:
    SDView(int id, int x, int y, int width, int height);
    ~SDView();
    void Init(tSituation *s);
    void loadParams(tSituation *s);
    void saveCamera();
    void de_activateMirror() {}

    inline int getId() const { return id; }
    inline tCarElt *getCurrentCar(void) { return curCar; }
    inline void setCurrentCar(tCarElt *newCurCar) { curCar = newCurCar; }
    inline SDCameras *getCameras() { return cameras; }
    inline tdble getViewRatio() const { return width / (tdble)height; }
    inline WebOsgCamera *getOsgCam(void) { return &cam; }
    inline WebOsgCamera *getOsgMirrorCam(void) { return &mirrorCam; }
    inline WebFrontFace *getOsgCamFrontFace(void) { return &camFrontFace; }
    inline WebFrontFace *getOsgMirrorCamFrontFace(void) { return &mirrorCamFrontFace; }
    inline int getScreenXPos(void) const { return x; }
    inline int getScreenYPos(void) const { return y; }
    inline int getScreenWidth(void) const { return width; }
    inline int getScreenHeight(void) const { return height; }
    inline int getBoardWidth(void) const { return 100; }
    inline float getViewOffset() const { return viewOffset; }
    inline void setSize(int w, int h) { width = w; height = h; }
};

class SDScenery
{
public:
    static int getWorldX();
    static int getWorldY();
    static int getWorldZ();
    static int getWorldMaxSize();
};

extern void *grHandle;
extern void *grTrackHandle;

}

#endif

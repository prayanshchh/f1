#include <cmath>
#include <algorithm>
#include <emscripten/emscripten.h>

#include <tgfclient.h>
#include <graphic.h>

#include "sdview.h"
#include "game.h"

namespace osggraph {

void *grHandle = nullptr;
void *grTrackHandle = nullptr;

static int worldDim(tdble max, tdble min)
{
    return (int)(max - min + 1);
}

int SDScenery::getWorldX() { return worldDim(ReInfo->track->max.x, ReInfo->track->min.x); }
int SDScenery::getWorldY() { return worldDim(ReInfo->track->max.y, ReInfo->track->min.y); }
int SDScenery::getWorldZ() { return worldDim(ReInfo->track->max.z, ReInfo->track->min.z); }
int SDScenery::getWorldMaxSize() { return std::max(std::max(getWorldX(), getWorldY()), getWorldZ()); }

void WebOsgCamera::setProjectionMatrixAsPerspective(double f, double a, double n, double fa)
{
    fovy = f;
    aspect = a;
    znear = n;
    zfar = fa;
    top = n * tan(osg::DegreesToRadians(f * 0.5));
    bottom = -top;
    right = top * a;
    left = -right;
}

bool WebOsgCamera::getProjectionMatrixAsFrustum(double &l, double &r, double &b, double &t, double &n, double &f) const
{
    l = left;
    r = right;
    b = bottom;
    t = top;
    n = znear;
    f = zfar;
    return true;
}

void WebOsgCamera::setProjectionMatrixAsFrustum(double l, double r, double b, double t, double n, double f)
{
    left = l;
    right = r;
    bottom = b;
    top = t;
    znear = n;
    zfar = f;
}

void WebOsgCamera::setViewMatrixAsLookAt(const osg::Vec3d &eye, const osg::Vec3d &center, const osg::Vec3d &up)
{
    view.makeLookAt(eye, center, up);
}

SDView::SDView(int myid, int myx, int myy, int mywidth, int myheight)
    : id(myid), x(myx), y(myy), width(mywidth), height(myheight), viewOffset(0),
      curCar(nullptr), cameras(nullptr), mirrorFlag(1)
{
}

SDView::~SDView()
{
    delete cameras;
}

void SDView::Init(tSituation *s)
{
    cameras = new SDCameras(this, s->_ncars);
    loadParams(s);
}

}

using namespace osggraph;

static SDView *view = nullptr;

static const double chaseDist = 6.6;
static const double chaseHeight = 1.45;
static const double chaseAhead = 3.0;
static const double chaseAim = 0.85;
static const double chaseFovy = 52.0;
static const double chaseYawTime = 0.06;
static const double chaseZTime = 0.15;
static bool chase = true;
static bool chaseReady = false;
static double chaseYaw, chaseZ, chaseTime;

static double relax(double prev, double target, double tau, double dt)
{
    return prev + (target - prev) * (1.0 - exp(-dt / tau));
}

static void chaseUpdate(tCarElt *car, tSituation *s, double *out)
{
    double yaw = atan2(car->_posMat[0][1], car->_posMat[0][0]);
    double z = car->_pos_Z;
    if (!chaseReady || s->currentTime < chaseTime)
    {
        chaseYaw = yaw;
        chaseZ = z;
        chaseReady = true;
    }
    double dt = s->currentTime - chaseTime;
    chaseTime = s->currentTime;
    chaseYaw += remainder(yaw - chaseYaw, 2 * PI) * (1.0 - exp(-std::max(0.0, dt) / chaseYawTime));
    chaseZ = relax(chaseZ, z, chaseZTime, std::max(0.0, dt));
    double cx = cos(chaseYaw), cy = sin(chaseYaw);
    osg::Vec3d eye(car->_pos_X - cx * chaseDist, car->_pos_Y - cy * chaseDist, chaseZ + chaseHeight);
    osg::Vec3d center(car->_pos_X + cx * chaseAhead, car->_pos_Y + cy * chaseAhead, chaseZ + chaseAim);
    osg::Matrixd m;
    m.makeLookAt(eye, center, osg::Vec3d(0, 0, 1));
    for (int r = 0; r < 4; r++)
        for (int c = 0; c < 4; c++)
            out[r * 4 + c] = m(r, c);
    out[16] = chaseFovy;
    out[17] = 0.3;
    out[18] = view->getOsgCam()->zfar;
    out[19] = 1;
    out[20] = 1;
    out[21] = -1;
    out[22] = 0;
    out[23] = 0;
}

void sdCameraReset()
{
    if (!grHandle)
        grHandle = GfParmReadFileLocal(GR_PARAM_FILE, GFPARM_RMODE_STD | GFPARM_RMODE_CREAT);
    grTrackHandle = ReInfo->track->params;
    delete view;
    view = new SDView(0, 0, 0, 1280, 720);
    view->Init(ReInfo->s);
    chaseReady = false;
}

void sdCameraUpdate(tCarElt *car, tSituation *s, double *out)
{
    SDCameras *cameras = view->getCameras();
    cameras->update(car, s);
    if (chase)
    {
        chaseUpdate(car, s, out);
        return;
    }
    SDCamera *cam = cameras->getSelectedCamera();
    const WebOsgCamera *osgCam = view->getOsgCam();
    for (int r = 0; r < 4; r++)
        for (int c = 0; c < 4; c++)
            out[r * 4 + c] = osgCam->view(r, c);
    out[16] = osgCam->fovy;
    out[17] = osgCam->znear;
    out[18] = osgCam->zfar;
    out[19] = cam->getDrawCurrent();
    out[20] = cam->getDrawDriver();
    out[21] = cameras->getIntSelectedList();
    out[22] = cameras->getIntSelectedCamera();
    out[23] = view->getOsgCamFrontFace()->mode == osg::FrontFace::CLOCKWISE;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE int sdViewKey(int key, int ctrl)
{
    if (!view)
        return 0;
    SDCameras *cameras = view->getCameras();
    if (key == 'c' && !ctrl)
    {
        chase = true;
        chaseReady = false;
        return 1;
    }
    if (key >= GFUIK_F2 && key <= GFUIK_F11)
    {
        int list = key - GFUIK_F2;
        if (chase && list == cameras->getIntSelectedList())
            cameras->selectCamera(list, cameras->getIntSelectedCamera());
        else
            cameras->nextCamera(list);
        chase = false;
        return 1;
    }
    int zoom = -1;
    if (!ctrl && key == GFUIK_END)
        zoom = GR_ZOOM_MIN;
    else if (!ctrl && key == GFUIK_HOME)
        zoom = GR_ZOOM_MAX;
    else if (!ctrl && key == '*')
        zoom = GR_ZOOM_DFLT;
    else if (ctrl && (key == '+' || key == '='))
        zoom = GR_ZOOM_IN;
    else if (ctrl && key == '-')
        zoom = GR_ZOOM_OUT;
    if (zoom < 0 || chase)
        return 0;
    cameras->getSelectedCamera()->setZoom(zoom);
    return 1;
}

EMSCRIPTEN_KEEPALIVE void sdViewResize(int width, int height)
{
    if (!view || width <= 0 || height <= 0)
        return;
    view->setSize(width, height);
    view->getCameras()->getSelectedCamera()->setProjection();
}

}

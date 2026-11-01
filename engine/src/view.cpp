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

struct ChaseCam
{
    double dist, height, ahead, aim, fovy;
};

struct Onboard
{
    double x, y, z, pitch, fovy;
    bool driver;
};

static const ChaseCam chases[] = {
    {4.7, 1.30, 3.0, 0.72, 52.0},
    {6.6, 1.45, 3.0, 0.85, 52.0},
};
static const int chaseCount = sizeof(chases) / sizeof(chases[0]);
static const Onboard onboards[] = {
    {-0.224, 0.0, 1.022, -11.27, 48.6, true},
    {-0.353, 0.0, 1.108, -7.66, 42.9, false},
    {0.15, 0.0, 0.755, -5.8, 43.0, false},
    {0.62, 0.0, 0.96, -6.7, 60.0, true},
};
static const int onboardCount = sizeof(onboards) / sizeof(onboards[0]);
static const double chaseYawTime = 0.06;
static const double chaseZTime = 0.15;
static const double onboardNear = 0.15;
static int carCamera = 0;
static bool chaseReady = false;
static double chaseYaw, chaseZ, chaseTime;
static bool onboardReady = false;
static double onboardAxle, onboardGround;

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
    const ChaseCam &cam = chases[carCamera];
    osg::Vec3d eye(car->_pos_X - cx * cam.dist, car->_pos_Y - cy * cam.dist, chaseZ + cam.height);
    osg::Vec3d center(car->_pos_X + cx * cam.ahead, car->_pos_Y + cy * cam.ahead, chaseZ + cam.aim);
    osg::Matrixd m;
    m.makeLookAt(eye, center, osg::Vec3d(0, 0, 1));
    for (int r = 0; r < 4; r++)
        for (int c = 0; c < 4; c++)
            out[r * 4 + c] = m(r, c);
    out[16] = cam.fovy;
    out[17] = 0.3;
    out[18] = view->getOsgCam()->zfar;
    out[19] = 1;
    out[20] = 1;
    out[21] = -1;
    out[22] = 0;
    out[23] = 0;
}

static void onboardUpdate(tCarElt *car, double *out)
{
    const Onboard &cam = onboards[carCamera - chaseCount];
    if (!onboardReady)
    {
        onboardAxle = onboardGround = 0;
        for (int i = 0; i < 4; i++)
        {
            onboardAxle += car->priv.wheel[i].relPos.x / 4;
            onboardGround += (car->priv.wheel[i].relPos.z - car->_rimRadius(i) - car->_tireHeight(i)) / 4;
        }
        onboardReady = true;
    }
    const double lx = cam.x + onboardAxle, ly = cam.y, lz = cam.z + onboardGround;
    osg::Vec3d p(car->_posMat[3][0], car->_posMat[3][1], car->_posMat[3][2]);
    osg::Vec3d forward(car->_posMat[0][0], car->_posMat[0][1], car->_posMat[0][2]);
    osg::Vec3d left(car->_posMat[1][0], car->_posMat[1][1], car->_posMat[1][2]);
    osg::Vec3d up(car->_posMat[2][0], car->_posMat[2][1], car->_posMat[2][2]);
    osg::Vec3d eye = p + forward * lx + left * ly + up * lz;
    double pitch = osg::DegreesToRadians(cam.pitch);
    osg::Vec3d center = eye + forward * cos(pitch) + up * sin(pitch);
    osg::Matrixd m;
    m.makeLookAt(eye, center, up);
    for (int r = 0; r < 4; r++)
        for (int c = 0; c < 4; c++)
            out[r * 4 + c] = m(r, c);
    out[16] = cam.fovy;
    out[17] = onboardNear;
    out[18] = view->getOsgCam()->zfar;
    out[19] = 1;
    out[20] = cam.driver;
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
    onboardReady = false;
}

void sdCameraUpdate(tCarElt *car, tSituation *s, double *out)
{
    SDCameras *cameras = view->getCameras();
    cameras->update(car, s);
    if (carCamera >= chaseCount)
    {
        onboardUpdate(car, out);
        return;
    }
    if (carCamera >= 0)
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
        carCamera = (carCamera + 1) % (chaseCount + onboardCount);
        chaseReady = false;
        return 1;
    }
    if (key >= GFUIK_F2 && key <= GFUIK_F11)
    {
        int list = key - GFUIK_F2;
        if (carCamera >= 0 && list == cameras->getIntSelectedList())
            cameras->selectCamera(list, cameras->getIntSelectedCamera());
        else
            cameras->nextCamera(list);
        carCamera = -1;
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
    if (zoom < 0 || carCamera >= 0)
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

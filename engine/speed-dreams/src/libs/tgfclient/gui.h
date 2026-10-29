/***************************************************************************
                         gui.h -- Interface file for GUI
                             -------------------
    created              : Fri Aug 13 22:15:46 CEST 1999
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

#ifndef _GUI_H__
#define _GUI_H__

#include "tgfclient.h"
#include "glfeatures.h"
#include "guifont.h"
#include <string>

// Predefined colors (array and indexes).
#define GFUI_COLORNB	24
extern float	gfuiColors[GFUI_COLORNB][4];

#define GFUI_BGCOLOR			 0
#define GFUI_BGBTNFOCUS		 	 1
#define GFUI_BGBTNCLICK			 2
#define GFUI_BGBTNENABLED	 	 3
#define GFUI_BGBTNDISABLED		 4
#define GFUI_BTNFOCUS			 5
#define GFUI_BTNCLICK			 6
#define GFUI_BTNENABLED			 7
#define GFUI_BTNDISABLED		 8
#define GFUI_LABELCOLOR			 9
#define GFUI_TIPCOLOR			10
#define GFUI_BGSCROLLIST		11
#define GFUI_FGSCROLLIST		12
#define GFUI_BGSELSCROLLIST		13
#define GFUI_FGSELSCROLLIST		14
#define GFUI_BGEDITFOCUS		15
#define GFUI_BGEDITENABLED		16
#define GFUI_BGEDITDISABLED		17
#define GFUI_EDITFOCUS			18
#define GFUI_EDITENABLED		19
#define GFUI_EDITDISABLED		20
#define GFUI_EDITCURSORCLR		21
#define GFUI_BASECOLORBGIMAGE	22 /* obsolete */
#define GFUI_PROGRESSCOLOR		23

#define GFUI_IMAGE		200

#define GFUI_MAXSTATICIMAGES	5

/* Label */
typedef struct
{
    char	*text;		// text
    GfuiColor	bgColor;	// RGBA
    GfuiColor	fgColor;
    GfuiColor	bgFocusColor;
    GfuiColor	fgFocusColor;
    GfuiFontClass	*font;		// ttf font (is this really true ?)

    int	x, y;		// position of the left bottom corner
    int	width;		// with of the "bounding box for alignment (text may overlap)
    int	align;
    int	maxlen;

    bool masked;    // show asterisks instead of text

    //background image properies
    GLuint bgImg;
    int bgImgPaddingTop;
    int bgImgPaddingBottom;
    int bgImgPaddingLeft;
    int bgImgPaddingRight;

    void		*userDataOnFocus;
    tfuiCallback	onFocus;
    tfuiCallback	onFocusLost;
} tGfuiLabel;

/* Button state */
#define GFUI_BTN_DISABLE	0
#define GFUI_BTN_RELEASED	1
#define GFUI_BTN_PUSHED		2

/* Button type */
#define GFUI_BTN_PUSH		0
#define GFUI_BTN_STATE		1

typedef struct
{
    tGfuiLabel	label;
    GfuiColor bgColor[3];
    GfuiColor fgColor[3];
    GfuiColor bgFocusColor[3];
    GfuiColor fgFocusColor[3];

    unsigned int	state;
    bool			is_focused;
    int			buttonType;
    int			mouseBehaviour;
    void		*userDataOnPush;
    tfuiCallback	onPush;
    void		*userDataOnFocus;
    tfuiCallback	onFocus;
    tfuiCallback	onFocusLost;

    int imgX, imgY;
    int imgWidth, imgHeight;
    int tipLabel;

    // if skin used
    GLuint disabled;
    GLuint enabled;
    GLuint focused;
    GLuint pushed;

    bool bShowBox;
} tGfuiButton;

typedef struct
{
    unsigned int	state;
    bool is_focused;

    // Texture handles
    GLuint disabled;
    GLuint enabled;
    GLuint focused;
    GLuint pushed;

    int			x, y;		// Image position
    int			width, height; // Image size
    int			mirror; // Horizontal / Vertical symetry to apply to image
    int			buttonType;
    int			mouseBehaviour;
    int			tipLabel;
    void		*userDataOnPush;
    tfuiCallback	onPush;
    void		*userDataOnFocus;
    tfuiCallback	onFocus;
    tfuiCallback	onFocusLost;
} tGfuiGrButton;


#define GFUI_FOCUS_NONE		0
#define GFUI_FOCUS_MOUSE_MOVE	1
#define GFUI_FOCUS_MOUSE_CLICK	2


typedef struct GfuiListElement
{
    char		*name;
    const char		*label;
    void			*userData;
    int				selected;
    int				index;
    struct GfuiListElement	*next;
    struct GfuiListElement	*prev;
} tGfuiListElement;

typedef struct
{
    int			sbPos;
    GfuiColor	bgColor[3];
    GfuiColor	fgColor[3];
    GfuiColor	bgSelectColor[3];
    GfuiColor	fgSelectColor[3];

    GfuiFontClass	*font;
    tGfuiListElement	*elts;
    int			nbElts;
    int			firstVisible;
    int			nbVisible;
    int			selectedElt;
    int			scrollBar;
    tfuiCallback	onSelect;
    void		*userDataOnSelect;
} tGfuiScrollList;

typedef struct
{
    tScrollBarInfo	info;
    int			min, max, len, pos;
    int			orientation;
    void		*userData;
    tfuiSBCallback	onScroll;
} tGfuiScrollBar;

typedef struct
{
    tGfuiLabel	label;
    GfuiColor    cursorColor[3];
    GfuiColor    bgColor[3];
    GfuiColor    fgColor[3];
    GfuiColor    bgFocusColor[3];
    GfuiColor    fgFocusColor[3];
    int			state;
    int			cursorx;
    int			cursory1;
    int			cursory2;
    int			cursorIdx;
    void		*userDataOnFocus;
    tfuiCallback	onFocus;
    tfuiCallback	onFocusLost;
} tGfuiEditbox;

typedef struct
{
    tGfuiLabel	label;
    tGfuiGrButton	leftButton;
    tGfuiGrButton	rightButton;
    tGfuiGrButton	backgroundButton;
    void *scr;
    tComboBoxInfo *pInfo;

    GfuiColor fgColor[3];
    bool is_focused;
    int	comboType;
    int	tipLabel;
    void		*userDataOnFocus;
    tfuiCallback	onFocus;
    tfuiCallback	onFocusLost;
    tfuiComboboxCallback onChange;
} tGfuiCombobox;

typedef struct
{
    int labelId;
    void *scr;
    tCheckBoxInfo *pInfo;

    GfuiColor fgColor[3];
    int checkId;
    int uncheckId;

    tfuiCheckboxCallback onChange;
} tGfuiCheckbox;

typedef struct
{
    void *scr;
    GLuint fgImage;
    GLuint bgImage;
    GfuiColor outlineColor;

    float min;
    float max;
    float value;

    void		*userDataOnFocus;
    tfuiCallback	onFocus;
    tfuiCallback	onFocusLost;
} tGfuiProgressbar;



typedef struct
{
    int srcWidth, srcHeight; // Dimensions of the source image file (pixels).
    bool canDeform;
    unsigned int activeimage;
    GLuint	texture[GFUI_MAXSTATICIMAGES];
} tGfuiImage;

typedef struct GfuiObject
{
    int		widget;
    int		id;
    int		visible;
    int		focusMode;
    int		focus;
    int		state;		/* enable / disable */
    int		xmin, ymin;	/* bounding box for focus */
    int		xmax, ymax;
    union
    {
        tGfuiLabel	label;
        tGfuiButton	button;
        tGfuiGrButton	grbutton;
        tGfuiScrollList scrollist;
        tGfuiScrollBar	scrollbar;
        tGfuiEditbox	editbox;
        tGfuiImage	image;
        tGfuiCombobox combobox;
        tGfuiCheckbox checkbox;
        tGfuiProgressbar progressbar;
    } u;
    struct GfuiObject	*next;
    struct GfuiObject	*prev;
} tGfuiObject;

/* Keyboard key assignment */
typedef struct GfuiKey
{
    int			key; // SDL key sym code
    char		*name;
    char		*descr;
    int			modifier;
    void		*userData;
    tfuiCallback	onPress;
    tfuiCallback	onRelease;
    tGuiHelpColumn  helpColumn;
    struct GfuiKey	*next;
} tGfuiKey;

typedef struct tGfBgImg
{
    float colors[4];
    float overscan, xoffset, yoffset; /* For moving backgrounds */
    GLuint image; /* Should always be 2^N x 2^P  (for low-end graphic hardwares) */
    int width, height; /* Original bg image size (may be not 2^N x 2^P) */
} tGfBgImg;

typedef class TGFCLIENT_API tGfuiGalleryElm
{
public:
    tGfuiGalleryElm(const char *dirname);
    const std::string &dir() const;
    const std::string &file() const;
    const tGfBgImg &getbg() const;
    int open();
    int update();
    int start(const std::string &prev = "");
    enum {WAIT, INIT, FADEIN, SHOW, FADEOUT} state;

private:
    int wait();
    int init();
    int init_direction();
    int fadein();
    int show();
    int fadeout();
    void move();
    tGfBgImg bg;
    enum {DIR_LEFT, DIR_RIGHT, DIR_UP, DIR_DOWN, N_DIRECTIONS};
    std::string imagePath; /* Path to current background image. */
    unsigned direction;
    std::string dirname, fullpath, prev;
    std::vector<std::string> files;
    const float overscan;
    float alpha;
    float xoffset, yoffset;
    double time;
} tGfuiGalleryElm;

typedef class TGFCLIENT_API tGfuiGallery
{
public:
    tGfuiGallery(const char *dirname);
    const std::string &dir() const;
    const std::string &file() const;
    std::vector<const tGfBgImg *> bgs() const;
    int update();
    int open();
    int active_idx() const;

private:
    tGfuiGalleryElm elms[2];
    int idx;
} tGfuiGallery;

/* screen definition */
typedef struct
{
    int			ScreenID; /* Identify screen in registration */
    float		width, height; /* in menu/screen objects coordinate system */
    float		xmargin; /* used for centering menu on the screen horizontally */
    GfuiColor		bgColor; /* RGBA */
    tGfBgImg	bg; /* Background images */

    /* sub-objects */
    tGfuiObject		*objects;
    tGfuiObject		*hasFocus;	/* in order to speed up focus management */
    int			curId;

    /* users keys definition */
    tGfuiKey		*userKeys;
    void		*userActData;
    tfuiCallback	onActivate;
    void		*userDeactData;
    tfuiCallback	onDeactivate;

    /* key callback function */
    tfuiKeyCallback	onKeyAction;

    /* key auto-repeat mode */
    int			keyAutoRepeat;

    /* mouse handling */
    int			mouse;
    int			mouseAllowed;

    /* menu specific */
    int			nbItems;

    /* Screen type */
    int			onlyCallback;

    /* Ogg music file to play while screen is displayed */
    char		*musicFilename;

    /* A valid pointer if the screen cointains an animated gallery,
     * null otherwise. */
    tGfuiGallery *gallery;
} tGfuiScreen;

extern tGfuiScreen	*GfuiScreen;
extern tMouseInfo	 GfuiMouse;
extern int		 GfuiMouseHW;

extern void gfuiInit(void);
extern void gfuiInitButton(void);
extern void gfuiInitHelp(void);
extern void gfuiInitLabel(void);
extern void gfuiInitObject(void);
extern void gfuiInitEditbox(void);
extern void gfuiInitCombobox(void);
extern void gfuiInitScrollBar(void);
extern void gfuiInitScrollList(void);
extern void gfctrlJoyInit(void);

extern void gfuiShutdown(void);
extern void gfctrlJoyShutdown(void);

extern void gfuiReleaseObject(tGfuiObject *curObject);

extern void GfuiDrawCursor();
extern void GfuiDraw(tGfuiObject *obj);;
extern void gfuiUpdateFocus();
extern void gfuiDrawString(int x, int y, GfuiFontClass *font, const char *string);
extern void gfuiMouseAction(int action);
extern void gfuiMouseWheelAction(int x, int y, unsigned int direction);
extern void gfuiSelectNext(void *);
extern void gfuiSelectPrev(void *);
extern void gfuiSelectId(void *scr, int id);
extern void gfuiAddObject(tGfuiScreen *screen, tGfuiObject *object);
extern tGfuiObject *gfuiGetObject(void *scr, int id);

extern bool gfuiGrButtonMouseIn(tGfuiGrButton *button);

extern void gfuiButtonAction(int action);
extern void gfuiEditboxAction(int action);
extern void gfuiGrButtonAction(int action);
extern void gfuiScrollListAction(int mouse);
extern void gfuiScrollListWheelAction(int x, int y, unsigned int direction);
extern void gfuiComboboxAction(int mouse);

extern void gfuiDrawLabel(tGfuiObject *obj);
extern void gfuiDrawButton(tGfuiObject *obj);
extern void gfuiDrawCombobox(tGfuiObject *obj);
extern void gfuiDrawCheckbox(tGfuiObject *obj);
extern void gfuiDrawGrButton(tGfuiObject *obj);
extern void gfuiDrawScrollist(tGfuiObject *obj);
extern void gfuiDrawEditbox(tGfuiObject *obj);
extern void gfuiDrawProgressbar(tGfuiObject *obj);

extern void gfuiLabelSetText(tGfuiLabel *label, const char *text);
extern void gfuiLabelSetColor(tGfuiLabel *label, const float *color);
extern void gfuiLabelSetPos(tGfuiObject *obj, int x, int y);
extern int gfuiLabelGetTextX(const tGfuiLabel *label);
std::string gfuiLabelGetText(const tGfuiLabel *label);

extern void gfuiLabelDraw(tGfuiLabel *label, const GfuiColor& color);
extern void gfuiGrButtonDraw(tGfuiGrButton *button, int state, int focus);

extern void gfuiLabelInit(tGfuiLabel *label, const char *text, int maxlen,
                          int x, int y, int width, int align, int font,
                          const float *bgColor, const float *fgColor,
                          const float *bgFocusColor, const float *fgFocusColor,
                          std::string  bgImgUrl,
                          void *userDataOnFocus, tfuiCallback onFocus, tfuiCallback onFocusLost);
extern void gfuiGrButtonInit(tGfuiGrButton* button, const char *disabled, const char *enabled,
                             const char *focused, const char *pushed,
                             int x, int y, int width, int height, int mirror, int mouse,
                             void *userDataOnPush, tfuiCallback onPush,
                             void *userDataOnFocus, tfuiCallback onFocus, tfuiCallback onFocusLost,
                             int tipLabel);

extern void gfuiReleaseLabel(tGfuiObject *obj);
extern void gfuiReleaseButton(tGfuiObject *obj);
extern void gfuiReleaseGrButton(tGfuiObject *obj);
extern void gfuiReleaseScrollist(tGfuiObject *curObject);
extern void gfuiReleaseScrollbar(tGfuiObject *curObject);
extern void gfuiReleaseEditbox(tGfuiObject *curObject);
extern void gfuiReleaseCombobox(tGfuiObject *obj);
extern void gfuiReleaseCheckbox(tGfuiObject *obj);
extern void gfuiReleaseProgressbar(tGfuiObject *obj);

extern void gfuiLoadFonts(void);
extern void gfuiFreeFonts(void);

extern void gfuiEditboxKey(tGfuiObject *obj, int key, int modifier);

extern void gfuiScrollListNextElt (tGfuiObject *object);
extern void gfuiScrollListPrevElt (tGfuiObject *object);

extern void gfuiScrollBarPlus(tGfuiObject *object);
extern void gfuiScrollBarMinus(tGfuiObject *object);

extern void gfuiReleaseImage(tGfuiObject *obj);
extern void gfuiDrawImage(tGfuiObject *obj);

#endif /* _GUI_H__ */

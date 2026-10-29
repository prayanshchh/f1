/***************************************************************************

    file        : racetrack.cpp
    copyright   : (C) 2010 by Xavier Bertaux
    web         : www.speed-dreams.org

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
            Track related functions
    @author	    Xavier Bertaux
*/

#include <cstdlib>
#include <cstdio>
#include <ctime>
#include <algorithm>

#include <tgf.h>

#include <raceman.h>
#include <track.h>
#include <tracks.h>
#include <translation.h>

#include "standardgame.h"
#include "racesituation.h"
#include "raceinit.h"
#include "racetrack.h"

#include <iomanip>
#include <fstream>
#include <sstream>
#include "racewebmetar.h"

static ReWebMetarCloud      webMetarCloud;
static ReWebMetarRunway     webMetarRunway;
static ReWebMetarVisibility webMetarVisibility;
static ReWebMetar           *webMetar = NULL;

// portability.h must be after curl.h (included by racewebmetar.h)
#include <portability.h>

// Local functions.
static void   reTrackDump(const tTrack *track, int verbose);
static void   reTrackInitTimeOfDay(void);
static void   reTrackInitWeather(void);
static void   reTrackInitWeatherValues(void);

static void   reTrackInitRealWeather(void);

static void   reTrackUpdatePhysics(void);
static void   reTrackUpdatePrecipitation(void);
static void   reTrackUpdateWind(void);
static void   reTrackUpdatePressure(void);
static void   reTrackSetOcean(void);
static void   reTrackSetTropical(void);
static void   reTrackSetDry(void);
static void   reTrackSetTemperate(void);
static void   reTrackSetContinetal(void);
static void   reTrackSetPolar(void);

static double reTrackLinear(double val, double min, double max);
static double reTrackTriangular(double val, double min, double max);
static double reTrackSinusoidal(double val, double min, double max);
static double reTrackEven(double val, double min, double max);
static double reTrackLongLow(double val, double min, double max);
static double reTrackLongHigh(double val, double min, double max);
static double reTrackMonsoonal(double val, double min, double max);

static int    code   = 0;
static int    rain   = 0;
static int    season = 0;
static int    month  = 0;
static int    yday   = 0;
static int    north  = 0;
static int    timeofday = 0;
static int    hour = 0;
static int    clouds = 0;

static double latitude = 0.0;
static double longitude = 0.0;
static double temperature = 0.0;
static double temperature_mean = 0.0;
static double temperature_water = 0.0;
static double humidity = 0.0;
static double precipitation_annual = 0.0;
static double precipitation = 0.0;
static double elevation = 0.0;
static double wind_dir = 0.0;
static double wind_speed = 0.0;
static double pressure = 0.0;

//static double clouds1 = 0.0;
//static double clouds2 = 0.0;

/** Initialize the track for a race manager.
    @return <tt>0 ... </tt>Ok<br>
    <tt>-1 .. </tt>Error
*/
int
ReTrackInit(void)
{
    char buf[1024];

    const char  *trackName;
    const char  *catName;

    const int curTrkIdx =
        (int)GfParmGetNum(ReInfo->results, RE_SECT_CURRENT, RE_ATTR_CUR_TRACK, NULL, 1);
    snprintf(buf, sizeof(buf), "%s/%d", RM_SECT_TRACKS, curTrkIdx);
    trackName = GfParmGetStr(ReInfo->params, buf, RM_ATTR_NAME, 0);
    if (!trackName)
        return -1;

    catName = GfParmGetStr(ReInfo->params, buf, RM_ATTR_CATEGORY, 0);
    if (!catName)
        return -1;

    snprintf(buf, sizeof(buf), "tracks/%s/%s/%s.%s", catName, trackName, trackName, TRKEXT);
    ReInfo->track = ReTrackLoader().load(buf);

    const char *fmt = ReTr("loading/track");

    snprintf(buf, sizeof(buf), fmt, ReInfo->track->name);
    ReUI().addLoadingMessage(buf);

    reTrackInitTimeOfDay();

    const char* pszWeather =
        GfParmGetStr(ReInfo->params, ReInfo->_reRaceName, RM_ATTR_WEATHER, 0);

    if (!pszWeather)
         pszWeather = GfParmGetStr(ReInfo->params, RM_VAL_ANYRACE, RM_ATTR_WEATHER, RM_VAL_WEATHER_CONFIG);

    if (!strcmp(pszWeather, RM_VAL_WEATHER_REAL))
        reTrackInitRealWeather();
    else
        reTrackInitWeather();

    reTrackDump(ReInfo->track, 0);

    return 0;
}//ReTrackInit

/** Dump the track segments on screen
    @param  track track to dump
    @param  verbose if set to 1 all the segments are described (long)
    @ingroup  racemantools
 */
static void
reTrackDump(const tTrack *track, int verbose)
{
    char buf[128];
    const char *fmt = ReTr("loading/trackinfo");

    snprintf(buf, sizeof(buf), fmt,
             track->authors, track->length, track->width);
    ReUI().addLoadingMessage(buf);

    GfLogInfo("++++++++++++ Track ++++++++++++\n");
    GfLogInfo("Name     = %s\n", track->name);
    GfLogInfo("Authors  = %s\n", track->authors);
    GfLogInfo("Filename = %s\n", track->filename);
    GfLogInfo("Model3D  = %s\n", track->graphic.model3d);
    GfLogInfo("NSeg     = %d\n", track->nseg);
    GfLogInfo("Version  = %d\n", track->version);
    GfLogInfo("Length   = %f m\n", track->length);
    GfLogInfo("Width    = %f m\n", track->width);
    GfLogInfo("XSize    = %f m\n", track->max.x);
    GfLogInfo("YSize    = %f m\n", track->max.y);
    GfLogInfo("ZSize    = %f m\n", track->max.z);
    GfLogInfo("Max Pits = %i\n", track->pits.nMaxPits);

    switch (track->pits.type)
    {
        case TR_PIT_NONE:
            GfLogInfo("Pits     = none\n");
            break;

        case TR_PIT_ON_TRACK_SIDE:
            GfLogInfo("Pits     = present on track side\n");
            break;

        case TR_PIT_ON_SEPARATE_PATH:
            GfLogInfo("Pits     = present on separate path\n");
            break;

        case TR_PIT_NO_BUILDING:
            GfLogInfo("Pits     = present, no building style\n");
            break;
    }//switch pits.type

    const int seconds = (int)track->local.timeofday;
    GfLogInfo("TimeOfDay= %02d:%02d:%02d\n", seconds / 3600, (seconds % 3600) / 60, seconds % 60);
    GfLogInfo("Sun asc. = %.1f d\n", RAD2DEG(track->local.sunascension));
    GfLogInfo("Clouds   = %d (0=none, 1=cirrus, 2=few, 3=many, 7=full)\n", track->local.clouds);
    GfLogInfo("Rain     = %d (0=none, 1=little, 2=medium, 3=heavy)\n", track->local.rain);
    GfLogInfo("Water    = %d (0=none, 1=some, 2=more, 3=swampy)\n", track->local.water);

    if (verbose)
    {
        int i;
        tTrackSeg *seg;
#ifdef SD_DEBUG
        const char  *stype[4] = { "", "RGT", "LFT", "STR" };
#endif

        for (i = 0, seg = track->seg->next; i < track->nseg; i++, seg = seg->next)
        {
            GfLogTrace("  segment %d -------------- \n", seg->id);
#ifdef SD_DEBUG
            GfLogTrace("        type    %s\n", stype[seg->type]);
#endif
            GfLogTrace("        length  %f m\n", seg->length);
            GfLogTrace("  radius  %f m\n", seg->radius);
            GfLogTrace("  arc %f d Zs %f d Ze %f d Zcs %f d\n", RAD2DEG(seg->arc),
                       RAD2DEG(seg->angle[TR_ZS]),
                       RAD2DEG(seg->angle[TR_ZE]),
                       RAD2DEG(seg->angle[TR_CS]));
            GfLogTrace(" Za  %f d\n", RAD2DEG(seg->angle[TR_ZS]));
            GfLogTrace("  vertices: %-8.8f %-8.8f %-8.8f ++++ ",
                       seg->vertex[TR_SR].x,
                       seg->vertex[TR_SR].y,
                       seg->vertex[TR_SR].z);
            GfLogTrace("%-8.8f %-8.8f %-8.8f\n",
                       seg->vertex[TR_SL].x,
                       seg->vertex[TR_SL].y,
                       seg->vertex[TR_SL].z);
            GfLogTrace("  vertices: %-8.8f %-8.8f %-8.8f ++++ ",
                       seg->vertex[TR_ER].x,
                       seg->vertex[TR_ER].y,
                       seg->vertex[TR_ER].z);
            GfLogTrace("%-8.8f %-8.8f %-8.8f\n",
                       seg->vertex[TR_EL].x,
                       seg->vertex[TR_EL].y,
                       seg->vertex[TR_EL].z);
            GfLogTrace("  prev    %d\n", seg->prev->id);
            GfLogTrace("  next    %d\n", seg->next->id);
        }//for i

        GfLogTrace("From Last To First\n");
        GfLogTrace("Dx = %-8.8f  Dy = %-8.8f Dz = %-8.8f\n",
                   track->seg->next->vertex[TR_SR].x - track->seg->vertex[TR_ER].x,
                   track->seg->next->vertex[TR_SR].y - track->seg->vertex[TR_ER].y,
                   track->seg->next->vertex[TR_SR].z - track->seg->vertex[TR_ER].z);
    }//if verbose
}//reTrackDump

// Initialize track time of day from race settings
void
reTrackInitTimeOfDay(void)
{
    static const char *TimeOfDayValues[] = RM_VALS_TIME;
    static const int NTimeOfDayValues = sizeof(TimeOfDayValues) / sizeof(const char*);

    tTrackLocalInfo *trackLocal = &ReInfo->track->local;

    // Load time of day settings for the session
    // (defaults to  "All sesions" one, or else "afternoon").
    timeofday = RM_IND_TIME_AFTERNOON;
    const char* pszTimeOfDay =
        GfParmGetStr(ReInfo->params, ReInfo->_reRaceName, RM_ATTR_TIME_OF_DAY, 0);
    if (!pszTimeOfDay)
         pszTimeOfDay =
             GfParmGetStr(ReInfo->params, RM_VAL_ANYRACE, RM_ATTR_TIME_OF_DAY, RM_VAL_TIME_AFTERNOON);
    for (int i = 0; i < NTimeOfDayValues; i++)
        if (!strcmp(pszTimeOfDay, TimeOfDayValues[i]))
        {
            timeofday = i;
            break;
        }

    trackLocal->timeofdayindex = timeofday;
    switch (timeofday)
    {
        case RM_IND_TIME_DAWN:
            trackLocal->timeofday = 6 * 3600 + 13 * 60 + 20; // 06:13:20
            hour = 6;
            break;

        case RM_IND_TIME_MORNING:
            trackLocal->timeofday = 10 * 3600 + 0 * 60 + 0; // 10:00:00
            hour = 10;
            break;

        case RM_IND_TIME_NOON:
        case RM_IND_TIME_24HR:
            trackLocal->timeofday = 12 * 3600 + 0 * 60 + 0; // 12:00:00
            hour = 12;
            break;

        case RM_IND_TIME_AFTERNOON:
            trackLocal->timeofday = 15 * 3600 + 0 * 60 + 0; // 15:00:00
            hour = 15;
            break;

        case RM_IND_TIME_DUSK:
            trackLocal->timeofday = 17 * 3600 + 46 * 60 + 40; // 17:46:40
            hour = 18;
            break;

        case RM_IND_TIME_NIGHT:
            trackLocal->timeofday = 0 * 3600 + 0 * 60 + 0; // Midnight = 00:00:00
            hour = 0;
            break;
        case RM_IND_TIME_REAL:
        case RM_IND_TIME_NOW:
        {
            time_t t = time(0);
            struct tm *ptm = localtime(&t);
            trackLocal->timeofday = ptm->tm_hour * 3600.0f + ptm->tm_min * 60.0f + ptm->tm_sec;
            hour = ptm->tm_hour;
            GfLogDebug("  Now time of day\n");
            break;
        }

        case RM_IND_TIME_TRACK:
            // Already loaded by the track loader (or else default value).
            GfLogDebug("  Track-defined time of day\n");
            break;

        case RM_IND_TIME_RANDOM:
            trackLocal->timeofday = (tdble)(rand() % (24*60*60));
            hour = 12;
            break;

        default:
            trackLocal->timeofday = 15 * 3600 + 0 * 60 + 0; // 15:00:00
            trackLocal->timeofdayindex = RM_IND_TIME_AFTERNOON;
            hour = 15;
            GfLogError("Unsupported value %d for user timeofday (assuming 15:00)\n",
                       timeofday);
            break;
    }//switch timeofday

    //hour = (hour / 24) *2.5;
}

// Initialize track weather info from race settings
void
reTrackInitWeather(void)
{
    static const char* CloudsValues[] = RM_VALS_CLOUDS;
    static const int NCloudsValues = sizeof(CloudsValues) / sizeof(const char*);

    static const char *RainValues[] = RM_VALS_RAIN;
    static const int NRainValues = sizeof(RainValues) / sizeof(const char*);

    static const char* SeasonsValues[] = RM_VALS_SEASONS;
    static const int NSeasonsValues = sizeof(SeasonsValues) / sizeof (const char*);

    tTrackLocalInfo *trackLocal = &ReInfo->track->local;

    // Load season for the session
    // (defaults to  "All sesions" one, or else "none").
    season = TR_SEASON_NOW;

    const char* pszSeasons =
        GfParmGetStr(ReInfo->params, ReInfo->_reRaceName, RM_ATTR_SEASON, 0);

    if (!pszSeasons)
        pszSeasons =
            GfParmGetStr(ReInfo->params, RM_VAL_ANYRACE, RM_ATTR_SEASON, RM_VAL_NOW);

    for (int i = 0; i < NSeasonsValues; i++)
        if (!strcmp(pszSeasons, SeasonsValues[i]))
        {
            season = i;
            break;
        }

    // Load cloud cover settings for the session
    // (defaults to  "All sesions" one, or else "none").
    int clouds = TR_CLOUDS_NONE;
    const char* pszClouds =
        GfParmGetStr(ReInfo->params, ReInfo->_reRaceName, RM_ATTR_CLOUDS, 0);
    if (!pszClouds)
        pszClouds =
            GfParmGetStr(ReInfo->params, RM_VAL_ANYRACE, RM_ATTR_CLOUDS, RM_VAL_CLOUDS_NONE);

    for (int i = 0; i < NCloudsValues; i++)
        if (!strcmp(pszClouds, CloudsValues[i]))
        {
            clouds = i;
            break;
        }

    // Load rain fall (and track dry/wet conditions) settings for the session
    // if feature supported (defaults to  "All sesions" one, or else "none").
    rain = TR_RAIN_NONE;

    const char* pszRain =
        GfParmGetStr(ReInfo->params, ReInfo->_reRaceName, RM_ATTR_RAIN, 0);
    if (!pszRain)
        pszRain =
            GfParmGetStr(ReInfo->params, RM_VAL_ANYRACE, RM_ATTR_RAIN, RM_VAL_RAIN_NONE);
    for (int i = 0; i < NRainValues; i++)
        if (!strcmp(pszRain, RainValues[i]))
        {
            rain = i;
            break;
        }

    // Take care of the random case for rain falls and ground water.
    const bool bRandomRain = (rain == TR_RAIN_RANDOM);

    if (bRandomRain)
    {
        // Force random clouds, in case there is no rain at the end.
        clouds = TR_CLOUDS_RANDOM;
    }

     // Ground water = rain for the moment (might change in the future).

    if (strcmp(ReInfo->track->category, "speedway") == 0)
    {
        rain = TR_RAIN_NONE;
    }

    const int water = rain;

    // Update track local info.
    trackLocal->rain = rain;
    trackLocal->hail = 0;
    trackLocal->snow = 0;
    trackLocal->clouds = clouds;
    trackLocal->cloud_altitude = 5500.0 * 0.3048;
    trackLocal->water = water;
    trackLocal->airtemperature = 15.0f;
    trackLocal->dewp = 5.0f;
    trackLocal->airpressure = 101300;
    trackLocal->airdensity = 1.219f;
    trackLocal->windspeed = (tdble)(rand() % 100);
    trackLocal->winddir = (tdble)(rand() % 359);
    trackLocal->relativehumidity = 65.0f;
    trackLocal->visibility = 10000.0;
    trackLocal->season = season;
    trackLocal->config = 2;

    reTrackInitWeatherValues();

    if ((trackLocal->visibility < 300) && (rain < 1))
        trackLocal->visibility = 300;

    GfLogInfo("Visibility = %.3f\n", trackLocal->visibility);
    GfLogInfo("Wind Speed = %.3f\n", trackLocal->windspeed);
    GfLogInfo("Wind direction = %.3f\n", trackLocal->winddir);
    GfLogInfo("Air Temperature = %.3f\n", trackLocal->airtemperature);
    GfLogInfo("Dew point = %.3f\n", trackLocal->dewp);
    GfLogInfo("Air pressure = %.3f\n", trackLocal->airpressure);
    GfLogInfo("Rain = %i\n", trackLocal->rain);
    GfLogInfo("Snow = %i\n", trackLocal->snow);
    GfLogInfo("Hail = %i\n", trackLocal->hail);
    GfLogInfo("Relative Humidity = %.3f\n", trackLocal->relativehumidity);

    // Update track physics from computed local info.
    ReTrackUpdate();
}

// Initialize weather simu
void
reTrackInitWeatherValues(void)
{
    tTrackLocalInfo *trackLocal = &ReInfo->track->local;
    GfLogDebug("Start use current date ...\n");
    struct tm now;
    time_t now_sec = time(0);
#ifdef _WIN32
    now = *gmtime(&now_sec);
#else
    gmtime_r(&now_sec, &now);
#endif
    month = now.tm_mon + 1;
    yday = now.tm_yday;

    int season = trackLocal->season;
    latitude = trackLocal->latitude;
    longitude = trackLocal->longitude;
    code = trackLocal->climat;
    precipitation_annual = trackLocal->precipitation;

    temperature = trackLocal->airtemperature;
    clouds = trackLocal->clouds;

    GfLogInfo("# RaceTrack Init Weather latitude = %.2f - longitude = %.2f\n", latitude, longitude);

    north = latitude >= 0.0 ? 1.0 : -1.0; // hemisphere

    if (north > 0.0)
    {
        if (season < 4)
        {
            switch (season)
            {
            case 0:
                month = 5;
                yday = 130;
                break;
            default:
            case 1:
                month = 8;
                yday = 222;
                break;
            case 2:
                month = 11;
                yday = 314;
                break;
            case 3:
                month = 2;
                yday = 41;
                break;
            }
        }
    }
    else
    {
        if (season < 4)
        {
            switch (season)
            {
            case 0:
                month = 11;
                yday = 314;
                break;
            default:
            case 1:
                month = 2;
                yday = 41;
                break;
            case 2:
                month = 5;
                yday = 130;
                break;
            case 3:
                month = 8;
                yday = 222;
                break;
            }
        }
    }

    GfLogInfo(" # Track Init Config weather month = %i - day = %i\n",month, yday);

    // convert from color shades to koppen-classicfication
     precipitation_annual = precipitation_annual + 9000.0;
     elevation = 9700 * trackLocal->altitude;

     if (code == 0)
         reTrackSetOcean();
     else if (code < 5)
         reTrackSetTropical();
     else if (code < 9)
         reTrackSetDry();
     else if (code < 18)
         reTrackSetTemperate();
     else if (code < 30)
         reTrackSetContinetal();
     else if (code < 32)
         reTrackSetPolar();
     else
         reTrackSetOcean();

     reTrackUpdatePrecipitation();
     reTrackUpdateWind();
     reTrackUpdatePressure();

     // Update track local info.
     if (strcmp(ReInfo->track->category, "speedway") == 0)
        trackLocal->rain = TR_RAIN_NONE;
     else
         trackLocal->rain = rain;

     trackLocal->hail = 0;
     trackLocal->snow = 0;
     trackLocal->clouds = (int)clouds;
     trackLocal->cloud_altitude = 5500.0 * 0.3048;
     trackLocal->water = rain;
     trackLocal->airtemperature = temperature;
     trackLocal->dewp = 5.0f;
     //trackLocal->airpressure = pressure;
     trackLocal->airpressure = 101300;
     trackLocal->airdensity = 1.219f;
     trackLocal->windspeed = wind_speed;
     trackLocal->winddir = wind_dir;
     trackLocal->relativehumidity = humidity;
     trackLocal->visibility = 10000.0;
     trackLocal->season = season;
     trackLocal->config = 2;
}

// Initialize track weather info from race settings
void
reTrackInitRealWeather(void)
{
    std::string url = "ftp://tgftp.nws.noaa.gov/data/observations/metar/stations/";
    webMetar = new ReWebMetar;
    tTrackLocalInfo *trackLocal = &ReInfo->track->local;

    url += trackLocal->station;
    url += ".TXT";

    GfLogInfo("URL WEATHER : %s\n", url.c_str());
    bool w = webMetar->ReWebMetarFtp(url);

    if (w == false)
        reTrackInitWeatherValues();
    else
    {
        char buffer[1024];
        snprintf(buffer, sizeof(buffer), "%sconfig/weather.txt", GfLocalDir());

        std::string data = buffer;
        GfLogDebug("Path weather.txt : %s\n", data.c_str());

        std::ifstream file(data.c_str());

        if (!file.is_open()) {
            GfLogError("Failed to open %s\n", data.c_str());
            return;
        }

        // compter le nombre de lignes
        int count = 0;
        std::string line;
        std::string weather;
        while (true)
        {
            getline(file, line);
            //GfLogInfo("Line = %s\n", line.c_str());

            if (file.eof())
            {
                break;
            }

            weather += line;
            ++count;
        }

        file.close();

        GfLogDebug("Contenu weather.txt = %s\n", weather.c_str());

        webMetar->ReWebMetarLoad(weather);

        if (webMetar->getCAVOK())
        {
            if (webMetar->getVisibility_m() == WebMetarNaN || webMetar->getVisibility_m() < 0)
                webMetarVisibility.set(12000.0);

            if (webMetar->getCloudNumber() > 0)
            {
                trackLocal->clouds = 0;
                trackLocal->altitude = (tdble)(1676.40);
                //_clouds.push_back(cl);
            }
        }

        // visibility
        tdble _wind_range_from = 0.0;
        tdble _wind_range_to = 0.0;
        tdble d = (tdble)(webMetar->getVisibility_m());

        if (d < 0.0)
            d = 12000.0;

        GfLogDebug("WebMetar Visibility in racetrack = %.3f\n", webMetar->getVisibility_m());

        if (d == WebMetarNaN )
            d = 10000.0;

        if (webMetarVisibility.getModifier() == ReWebMetarVisibility::GREATER_THAN)
            d += 2000.0;

        if(d > 15000)
            d = 12000.0;

        if (d < 350)
            d = 350.0;

        trackLocal->visibility = d;

        // wind
        if (webMetar->getWindDir() == -1)
        {
            if (webMetar->getWindRangeTo() == -1)
            {
                trackLocal->winddir = 0;
                _wind_range_from = 0;
                _wind_range_to = 359;
            }
            else
            {
                trackLocal->winddir = (_wind_range_from + _wind_range_to) / 2;
            }
        }
        else
            trackLocal->winddir = webMetar->getWindDir();

        if (webMetar->getWindRangeFrom() == -1)
        {
            _wind_range_from = _wind_range_to = trackLocal->winddir;
        }

        if (webMetar->getWindSpeed_kmh() == WebMetarNaN)
            trackLocal->windspeed = 0.0;
        else
            trackLocal->windspeed = (tdble)(webMetar->getWindSpeed_kmh());

        // clouds
        int cn = webMetar->getCloudNumber();

        if(cn > 0)
        {
            for (int i = 0; i < cn; i++)
            {
                switch (i)
                {
                case 0:
                    trackLocal->clouds = webMetar->getCloud1();
                    trackLocal->cloud_altitude = webMetar->getAltitude1();
                    GfLogDebug("Clouds 1 = %i - Alitude cloud 1 = %.3f\n", trackLocal->clouds, trackLocal->cloud_altitude);
                    break;
                case 1:
                    trackLocal->clouds2 = webMetar->getCloud2();
                    trackLocal->cloud_altitude2 = webMetar->getAltitude2();
                    GfLogDebug("Clouds 2 = %i - Alitude cloud 2 = %.3f\n", trackLocal->clouds2, trackLocal->cloud_altitude2);
                    break;
                case 3:
                    trackLocal->clouds3 = webMetar->getCloud3();
                    trackLocal->cloud_altitude3 = webMetar->getAltitude3();
                    GfLogDebug("Clouds 3 = %i - Alitude cloud 3 = %.3f\n", trackLocal->clouds3, trackLocal->cloud_altitude3);
                    break;
                }
            }
        }

        // temperature/pressure/density
        if (webMetar->getTemperature_C() == WebMetarNaN)
            trackLocal->airtemperature = 15.0;
        else
            trackLocal->airtemperature = (tdble)(webMetar->getTemperature_C());

        if (webMetar->getDewpoint_C() == WebMetarNaN)
            trackLocal->dewp = 0.0;
        else
            trackLocal->dewp = (tdble)(webMetar->getDewpoint_C());

        if (webMetar->getPressure_hPa() == WebMetarNaN )
            trackLocal->airpressure = (tdble)(101300.0);
        else
            trackLocal->airpressure = (tdble)(webMetar->getPressure_hPa());

        trackLocal->airpressure = (tdble)(trackLocal->airpressure);

        if (webMetar->getDensity_C() == WebMetarNaN)
            trackLocal->airdensity = 1.219f;
        else
            trackLocal->airdensity = (tdble)(webMetar->getDensity_C());

        trackLocal->relativehumidity = (tdble)(webMetar->getRelativeHumidity());

        if (ReInfo->s->_features & RM_FEATURE_WETTRACK && (!strcmp(ReInfo->track->category, "speedway")) == 0)
        {
            trackLocal->rain = webMetar->getRain();
            trackLocal->water = trackLocal->rain;

            trackLocal->snow = webMetar->getSnow();

            if (trackLocal->snow > 0)
                trackLocal->water = trackLocal->snow;

            trackLocal->hail = webMetar->getHail();

            if (trackLocal->hail > 0)
                trackLocal->water = trackLocal->hail;
        }
        else
        {
            trackLocal->rain = TR_RAIN_NONE;
            trackLocal->snow = TR_RAIN_NONE;
            trackLocal->hail = TR_RAIN_NONE;
            trackLocal->water = TR_RAIN_NONE;
        }

        trackLocal->config = 0;

        GfLogInfo("Visibility = %.2f\n", trackLocal->visibility);
        GfLogInfo("Wind Speed = %.2f\n", trackLocal->windspeed);
        GfLogInfo("Wind direction = %.2f\n", trackLocal->winddir);
        GfLogInfo("Air Temperature = %.2f\n", trackLocal->airtemperature);
        GfLogInfo("Dew point = %.2f\n", trackLocal->dewp);
        GfLogInfo("Air pressure = %.2f\n", trackLocal->airpressure);
        GfLogInfo("Air Density = %.3f\n", trackLocal->airdensity);
        GfLogInfo("Rain = %i\n", trackLocal->rain);
        GfLogInfo("Snow = %i\n", trackLocal->snow);
        GfLogInfo("Hail = %i\n", trackLocal->hail);
        GfLogInfo("Water track = %d\n", trackLocal->water);
        GfLogInfo("Relative Humidity = %.2f\n", trackLocal->relativehumidity);

        ReTrackUpdate();
        //delete webMetar;
        //webMetar = NULL;
    }
}

// Update track info ...
void
ReTrackUpdate(void)
{
    // TODO: New weather conditions when starting a new event ?

    reTrackUpdatePhysics();
}

// Update Track Physics (compute kFriction from current "water level" on ground).
void
reTrackUpdatePhysics(void)
{
    tTrackLocalInfo *trackLocal = &ReInfo->track->local;

    // Get the wet / dry friction coefficients ratio.
    void* hparmTrackConsts =
        GfParmReadFile(TRK_PHYSICS_FILE, GFPARM_RMODE_STD | GFPARM_RMODE_CREAT);
    const tdble kFrictionWetDryRatio =
        GfParmGetNum(hparmTrackConsts, TRKP_SECT_SURFACES, TRKP_VAL_FRICTIONWDRATIO, (char*)NULL, 0.5f);
    GfParmReleaseHandle(hparmTrackConsts);

    // Determine the "wetness" of the track (inside  [0, 1]).
    const tdble wetness = (tdble)trackLocal->water / TR_WATER_MUCH;

    GfLogDebug("ReTrackUpdate : water = %d, wetness = %.2f, wet/dry mu = %.4f\n",
               trackLocal->water, wetness, kFrictionWetDryRatio);

    // Set the actual friction for each _ground_ surface of the track.
    GfLogDebug("ReTrackUpdate : kFriction | kRollRes | Surface :\n");
    tTrackSurface *curSurf;
    curSurf = ReInfo->track->surfaces;
    do
    {
        // Linear interpolation of kFriction from dry to wet according to wetness.
        curSurf->kFriction =
            curSurf->kFrictionDry * (1 - wetness)
            + curSurf->kFrictionDry * kFrictionWetDryRatio * wetness;

        // For the moment, we don't change curSurf->kRollRes (might change in the future).

        GfLogDebug("                   %.4f |   %.4f | %s\n",
                   curSurf->kFriction, curSurf->kRollRes, curSurf->material);

        curSurf = curSurf->next;

    } while ( curSurf );
}

double reTrackLinear(double val, double min, double max)
{
    double diff = max - min;
    GfLogInfo("### val = %.2f - min = %.2f - max = %.2f - diff = %.2f - Return Linear = %.2f\n",
              val, min, max, diff, min+(val*diff));
    return min + (val*diff);

}

double reTrackTriangular(double val, double min, double max)
{
    double diff = max-min;
    val = 1.0 - fabs(-1.0 + (2.0*val / 180.0));

    GfLogInfo("### val = %.2f - min = %.2f - max = %.2f - diff = %.2f - Return Triangular = %.2f\n",
        val, min, max, diff, min + (val * diff));
    return min + (val*diff);
}

double reTrackSinusoidal(double val, double min, double max)
{
    double diff = max-min;
    GfLogInfo(" val = %.2f - min = %.2f - max = %.2f - return sinusoidal = %.5f\n",
              val, min, max, min + (diff *(0.5 - (0.5 * cos(3.14159265359 * (val / 180 ))))));

    return min + (diff *(0.5 - (0.5 * cos(3.14159265359 * (val / 180 )))));
}

double reTrackEven(double val, double min, double max)
{
    double diff = max-min;
    GfLogInfo(" val = %.2f - min = %.2f - max = %.2f - return Even  = %.5f\n",
        val, min, max, min + diff * (0.5 - 0.6366 * atan(cos(val / 180.0))));
    return min + diff*(0.5 - 0.6366*atan(cos(val / 180.0)));
}

double reTrackLongLow(double val, double min, double max)
{
    double diff = max-min;
    GfLogInfo(" val = %.2f - min = %.2f - max = %.2f - return Long Low  = %.5f\n",
        val, min, max, min + diff * (0.5 - 0.5 * cos(2.145 * val / 180.0)));

    return min + diff*(0.5 - 0.5*cos(2.145*val / 180.0));
}

double reTrackLongHigh(double val, double min, double max)
{
    double diff = max-min;
    GfLogInfo(" val = %.2f - min = %.2f - max = %.2f - Diff = %.2f - return Long High  = %.5f\n",
        val, min, max, diff, max - diff * (0.5 - 0.5 * cos(2.14503 - (2.14503 * (val / 180.0)))));
    return max - diff*(0.5 - 0.5*cos(2.14503 - (2.14503*(val / 180.0))));
}

double reTrackMonsoonal(double val, double min, double max)
{
    double diff = max-min;
    val = 2.0* PI2 * (1.0 - val);
    GfLogInfo(" val = %.2f - min = %.2f - max = %.2f - return Monsoonal = %.5f\n",
        val, min, max, min + diff * cos(atan((val * val) / 180.0)));
    return min + diff * cos(atan(val * val));
}

void  reTrackUpdatePrecipitation(void)
{
    double h = humidity + (yday / 20);
    if (clouds != TR_CLOUDS_RANDOM)
        return;

    if (h <= 65.00)
        clouds = TR_CLOUDS_NONE;
    else if (h >65.00 && h < 75.00)
        clouds = TR_CLOUDS_CIRRUS;
    else if (h > 75.00 && h <= 80.00)
        clouds = TR_CLOUDS_FEW;
    else if (h > 80.00 && h <= 85.00)
        clouds = TR_CLOUDS_MANY;
    else if (h > 85.00 && h <= 90.00)
        clouds = TR_CLOUDS_CUMULUS;
    else if (h > 90.00 && h <= 95.00)
        clouds = TR_CLOUDS_BROKEN;
    else
        clouds = TR_CLOUDS_FULL;

    if (precipitation < 60.0)
    {
         precipitation = 0.0;
    }
    else
     {
         precipitation -= 60.0;

         if (precipitation < 60.0)
         {
             precipitation = 0.0;
         }
         else if (precipitation > 80.0 && precipitation <= 100)
         {
             precipitation = 1.0;
         }
         else if (precipitation > 100.00 && precipitation <= 120.00)
         {
             precipitation = 2.0;
             clouds = TR_CLOUDS_FULL;
         }
         else
         {
             precipitation = 3.0;
             clouds = TR_CLOUDS_FULL;
         }
     }

    if (rain > 3)
        rain = (int)precipitation;

    GfLogInfo(" ### Update precipitation : Precipitation =%.2f - Rain = %i - Clouds = %d - H = %.2f - Humidity = %.2f\n",
              precipitation, rain, clouds, h, humidity);

}

void reTrackUpdateWind(void)
{
    if (latitude > 60.0)
    {
       double val = 1.0 - (latitude - 60.0) / 30.0;
       wind_dir = reTrackLinear(val, 0.0, 90.0);
       GfLogInfo("Wind direction > 60 = %.2f\n", wind_dir);

       if (code == 0)
           wind_speed = reTrackLinear(val, 6.0, 10.0);
       else
           wind_speed = 0.0;
    }
    else if (latitude > 30.0)
    {
       double val = (latitude - 30.0) / 30.0;
       wind_dir = reTrackLinear(val, 180.0, 270.0);
       GfLogInfo("Wind direction > 30 = %.2f\n", wind_dir);

       if (code == 0)
           wind_speed = reTrackLinear(val, 5.0, 10.0);

       else
       {
           wind_speed = reTrackLinear(1.0 - val, 3.0, 120.0);
           wind_speed = reTrackSinusoidal((month-1) * 30, 3.0, wind_speed);
           GfLogInfo("Wind Speed > 30 = %.2f\n", wind_speed);
       }
    }
    else if (latitude > 0)
    {
      double val = 1.0 - latitude / 30.0;
      wind_dir = reTrackLinear(val, 0.0, 90.0);
      GfLogInfo("Wind direction > 0 = %.2f - Code = %i\n", wind_dir, code);

      if (code == 0)
          wind_speed = reTrackTriangular(val, 5.0, 7.0);
      else
      {
          wind_speed = reTrackTriangular(fabs(val - 0.5), 3.0, 5.0);
          wind_speed = reTrackSinusoidal((month-1) *30, 3.0, wind_speed);
          GfLogInfo("Wind direction > 0 = %.2f\n", wind_dir);
      }
    }
    else if (latitude > -30.0)
    {
      double val = -latitude / 30.0;
      wind_dir = reTrackLinear(val, 90.0, 180.0);
      GfLogInfo("Wind direction = %.2fn", wind_dir);

      if (code == 0)
              wind_speed = reTrackTriangular(val, 5.0, 7.0);
      else
          wind_speed = reTrackTriangular(fabs(val - 0.5), 3.0, 5.0);
    }
    else if (latitude > -60.0)
    {
       double val = 1.0 - (latitude + 30.0) / 30.0;
       wind_dir =  reTrackLinear(val, -90.0, 0.0);
       GfLogInfo("Wind direction = %.2fn", wind_dir);

       if (code == 0)
           wind_speed = reTrackLinear(val, 5.0, 10.0);
       else
           wind_speed = reTrackLinear(1.0 - val, 3.0, 6.0);
    }
    else
    {
       double val = (latitude + 60.0) / 30.0;
       wind_dir = reTrackLinear(val, 90.0, 180.0);
       GfLogInfo("Wind direction = %.2fn", wind_dir);

       if (code == 0)
           wind_speed = reTrackLinear(1.0 - val, 5.0, 120.0);
       else
           wind_speed = 0.0;
    }

    if (wind_dir < 0.0)
        wind_dir += 360.0;
}

void reTrackUpdatePressure(void)
{
    // saturation vapor pressure for water, Jianhua Huang:
    double Tc = temperature ? temperature : 1e-9;
    double Psat = exp(34.494 - 4924.99 / (Tc + 237.1)) / pow(Tc + 105.0, 1.57);

    // vapor pressure of water
    double Pv = 0.01 * humidity * Psat;

    // pressure at elevation
    static const double R0 = 8.314462618;
    static const double P0 = 101325.0;
    static const double T0 = 288.15;
    static const double L = 0.0065;
    static const double M = 0.0289654;

    double h = elevation / 1000.0;
    double g = 9.80665;
    double P = P0 * pow(1.0 - L * h / T0, g * M / (L * R0));

    // partial pressure of dry air
    double Pd = P - Pv;

    // air pressure
    pressure = (0.01 * (Pd + Psat) * 10);
}

void reTrackSetOcean(void)
{
    // temperature based on latitude, season and time of day
    // the equator
    double temp_equator_night = reTrackTriangular(month, 17.5, 22.5);
    double temp_equator_day = reTrackTriangular(month, 27.5, 32.5);
    double temp_equator_mean = reTrackLinear(hour, temp_equator_night, temp_equator_day);
    double temp_equator = reTrackLinear(3.0 * hour, temp_equator_night, temp_equator_day);
    double temp_sw_Am = reTrackTriangular(yday, 22.0, 27.5);

    // the poles
    double temp_pole_night = reTrackSinusoidal(month, -30.0, 0.0);
    double temp_pole_day = reTrackSinusoidal(month, -22.5, 4.0);
    double temp_pole_mean = reTrackLinear(hour, temp_pole_night, temp_pole_day);
    double temp_pole = reTrackLinear(3.0 * hour, temp_pole_night, temp_pole_day);
    double temp_sw_ET = reTrackLongLow(2.0 * month, -27.5, -3.5);

    // interpolate based on the viewers latitude
    double fact_lat = pow(fabs(latitude) / 90.0, 2.5);
    double ifact_lat = 1.0 - fact_lat;

    temperature =  reTrackLinear(ifact_lat, temp_pole, temp_equator);
    temperature_mean = reTrackLinear(ifact_lat, temp_pole_mean, temp_equator_mean);
    temperature_water =  reTrackLinear(ifact_lat, temp_sw_ET, temp_sw_Am);

    // high relative humidity around the equator and poles
    humidity =  reTrackTriangular(fabs(fact_lat-0.5), 70.0, 87.0);

    precipitation_annual = 990.0;
    precipitation = 100.0 - (precipitation_annual / 25.0);

    GfLogInfo("## OCEAN temperature = %.2f - humidity = %.2f - Precipitation = %.2f\n", temperature, humidity, precipitation);
}

// https://en.wikipedia.org/wiki/Tropical_rainforest_climate
// https://en.wikipedia.org/wiki/Tropical_monsoon_climate
void reTrackSetTropical(void)
{
    double m = (month - 1) * 30;
    double m2 = fmod(fabs(((month * 2) + 52) * (0.5 /24) - 0.1875), 1.0);
    double h = fmod(fabs(((hour + 18) * (0.5 / 24)) - 0.1875), 1.0);
    h = (h > 0.5) ? 2.0 - (2.0 * h) : 2.0 * h;

    double hmin = reTrackSinusoidal(m, 0.0, 0.36);
    double hmax = reTrackSinusoidal(m, 0.86, 1.0);
    humidity = reTrackLinear(h, hmin, hmax);

    // wind speed based on latitude (0.0 - 15 degrees)
    double fact_lat = std::max(fabs(latitude), 15.0) / 15.0;
    wind_speed = 3.0 * fact_lat * fact_lat;

    double temp_water = temperature_water;
    double temp_night = temperature;
    double temp_day = temperature;

    switch(code)
    {
    case 1: // Af: equatorial, fully humid
        temp_night = reTrackTriangular(m2, 20.0, 22.5);
        temp_day = reTrackTriangular(m2, 29.5, 32.5);
        temp_water = reTrackTriangular(m2, 25.0, 27.5);
        precipitation = reTrackSinusoidal(m, 150.0, 280.0);
        humidity = reTrackTriangular(humidity, 75.0, 85.0);
        break;
    case 2: // Am: equatorial, monsoonal
        temp_night = reTrackTriangular(m2, 17.5, 22.5);
        temp_day = reTrackTriangular(m2, 27.5, 32.5);
        temp_water = reTrackTriangular(m2, 22.0, 27.5);
        precipitation = reTrackLinear(m2, 45.0, 340.0);
        humidity = reTrackTriangular(humidity, 75.0, 85.0);
        wind_speed *= 2.0* precipitation / 340.0;
        break;
    case 3: // As: equatorial, summer dry
        temp_night = reTrackLongHigh(m2, 15.0, 22.5);
        temp_day = reTrackTriangular(m2, 27.5, 35.0);
        temp_water = reTrackTriangular(m2, 21.5, 26.5);
        precipitation = reTrackSinusoidal(m, 35.0, 150.0);
        humidity = reTrackTriangular(humidity, 60.0, 80.0);
        wind_speed *= 2.0 * precipitation / 150.0;
        break;
    case 4: // Aw: equatorial, winter dry
        temp_night = reTrackLongHigh(m2, 15.0, 22.5);
        temp_day = reTrackTriangular(m2, 27.5, 35.0);
        temp_water = reTrackTriangular(m2, 21.5, 28.5);
        precipitation = reTrackSinusoidal(m, 10.0, 230.0);
        humidity = reTrackTriangular(humidity, 60.0, 80.0);
        wind_speed *= 2.0 * precipitation / 230.0;
        break;
    default:
        break;
    }

    temperature = reTrackLinear(h, temp_night, temp_day);
    temperature_mean =  reTrackLinear(h, temp_night, temp_day);
    temperature_water = temp_water;

    GfLogInfo("## TROPICAL Temperature = %.2f - Humidity = %.2f - Precipitation = %.2f\n", temperature, humidity, precipitation);
}

// https://en.wikipedia.org/wiki/Desert_climate
// https://en.wikipedia.org/wiki/Semi-arid_climate
void reTrackSetDry(void)
{
    double m = (month - 1) * 30;
    double m2 = fmod(fabs(((month * 2) + 52) * (0.5 /24) - 0.1875), 1.0);
    double h = fmod(fabs(((hour + 18) *(0.5/24)) - 0.1875), 1.0);
    h = (h > 0.5)  ? 2.0 - (2.0 * h) : 2.0 * h;

    double hmin = reTrackSinusoidal(m, 0.0, 0.36);
    double hmax = reTrackSinusoidal(m, 0.86, 1.0);
    humidity = reTrackLinear(h, hmin, hmax);

    double temp_water = temperature_water;
    double temp_night = temperature;
    double temp_day = temperature;
    //double precipitation = precipitation;
    double relative_humidity = humidity;

    switch(code)
    {
    case 5: // BSh: arid, steppe, hot arid
        temp_night = reTrackLongHigh(m2, 10.0, 22.0);
        temp_day = reTrackTriangular(m2, 27.5, 35.0);
        temp_water = reTrackTriangular(m2, 18.5, 28.5);
        precipitation = reTrackLongLow(m2, 8.0, 117.0);
        relative_humidity = reTrackTriangular(humidity, 20.0, 30.0);
        break;
    case 6: // BSk: arid, steppe, cold arid
        temp_night = reTrackSinusoidal(m, -14.0, 12.0);
        temp_day = reTrackSinusoidal(m, 0.0, 30.0);
        temp_water = reTrackSinusoidal(2.0 * m, 5.0, 25.5);
        precipitation = reTrackSinusoidal(m, 15.0, 34.0);
        relative_humidity = reTrackSinusoidal(humidity, 48.0, 67.0);
        break;
    case 7: // BWh: arid, desert, hot arid
        temp_night = reTrackSinusoidal(m, 7.5, 22.0);
        temp_day = reTrackEven(m2, 22.5, 37.5);
        temp_water = reTrackEven(m2, 15.5, 33.5);
        precipitation = reTrackMonsoonal(m2, 3.0, 18.0);
        relative_humidity = reTrackMonsoonal(humidity, 25.0, 55.0);
        break;
    case 8: // BWk: arid, desert, cold arid
        temp_night = reTrackSinusoidal(m, -15.0, 15.0);
        temp_day = reTrackSinusoidal(m, -2.0, 30.0);
        temp_water = reTrackSinusoidal(2.0 * m, 4.0, 26.5);
        precipitation = reTrackLinear(m2, 4.0, 14.0);
        relative_humidity = reTrackLinear(humidity, 45.0, 61.0);
        break;
    default:
        break;
    }

    temperature = reTrackLinear(h, temp_night, temp_day);
    temperature_mean = reTrackLinear(h, temp_night, temp_day);
    temperature_water = temp_water;

    humidity = relative_humidity;

    GfLogInfo("## DRY Temperature = %.2f - Humidity = %.2f - Precipitation = %.2f\n", temperature, humidity, precipitation);
}

void reTrackSetTemperate(void)
{
    double m = (month - 1) * 30;
    double m2 = fmod(fabs(((month * 2) + 52) * (0.5 /24) - 0.1875), 1.0);
    double h = fmod(fabs(((hour + 18) *(0.5/24)) - 0.1875), 1.0);
    h = (h > 0.5)  ? 2.0 - (2.0 * h) : 2.0 * h;

    double hmin = reTrackSinusoidal(m, 0.0, 0.36);
    double hmax = reTrackSinusoidal(m, 0.86, 1.0);
    humidity = reTrackLinear(h, hmin, hmax);
    GfLogInfo("# Month = %i - hour = %i - raceTrack config humidity = %.2f - hmin = %.2f - hmax = %.2f\n",
              month, hour, humidity, hmin, hmax);

    double temp_water = temperature_water;
    double temp_night = temperature;
    double temp_day = temperature;
    double relative_humidity = humidity;

    switch(code)
    {
    case 9: // Cfa: warm temperature, fully humid hot summer
        temp_night = reTrackSinusoidal(m, -8.0, 22.0);
        temp_day = reTrackSinusoidal(m, 3.0, 35.0);
        temp_water = reTrackSinusoidal(m, 8.0, 28.5);
        precipitation = reTrackSinusoidal(m + 210, 50.0, 140.0);
        relative_humidity = reTrackSinusoidal(humidity, 65.0, 95.0);
        GfLogInfo("# temperature night = %.2f - temperature day = %.2f\n", temp_night, temp_day);
        break;
    case 10: // Cfb: warm temperature, fully humid, warm summer
        temp_night = reTrackSinusoidal(m, -3.0, 10.0);
        temp_day = reTrackSinusoidal(m, 5.0, 25.0);
        temp_water = reTrackSinusoidal(m, 3.0, 20.5);
        precipitation = reTrackLinear(m2, 65.0, 140.0);
        relative_humidity = reTrackSinusoidal(humidity, 68.0, 90.0);
        break;
    case 11: // Cfc: warm temperature, fully humid, cool summer
        temp_night = reTrackLongLow(m, -3.0, 8.0);
        temp_day = reTrackLongLow(m, 2.0, 14.0);
        temp_water = reTrackLongLow(m, 3.0, 11.5);
        precipitation = reTrackLinear(m / 180, 90.0, 200.0);
        relative_humidity = reTrackLongLow(humidity, 70.0, 85.0);
        break;
    case 12: // Csa: warm temperature, summer dry, hot summer
        temp_night = reTrackSinusoidal(m, 2.0, 16.0);
        temp_day = reTrackSinusoidal(m, 12.0, 33.0);
        temp_water = reTrackSinusoidal(m, 10.0, 27.5);
        precipitation = reTrackLinear(m2 + 0.60, 25.0, 70.0);
        relative_humidity = reTrackSinusoidal(humidity, 58.0, 72.0);
        break;
    case 13: // Csb: warm temperature, summer dry, warm summer
        temp_night = reTrackSinusoidal( m, -4.0, 10.0);
        temp_day = reTrackSinusoidal(m, 6.0, 27.0);
        temp_water = reTrackSinusoidal(m, 4.0, 21.5);
        precipitation = reTrackLinear(m2 + 0.60 , 25.0, 120.0);
        relative_humidity = reTrackLinear(humidity, 50.0, 72.0);
        break;
    case 14: // Csc: warm temperature, summer dry, cool summer
        temp_night = reTrackSinusoidal(m, -4.0, 5.0);
        temp_day = reTrackSinusoidal(m, 5.0, 16.0);
        temp_water = reTrackSinusoidal(m, 3.0, 14.5);
        precipitation = reTrackSinusoidal(m, 60.0, 95.0);
        relative_humidity = reTrackSinusoidal(humidity, 55.0, 75.0);
        break;
    case 15: // Cwa: warm temperature, winter dry, hot summer
        temp_night = reTrackEven(m, 4.0, 20.0);
        temp_day = reTrackLongLow(m, 15.0, 30.0);
        temp_water = reTrackLongLow(2.0 * m, 7.0, 24.5);
        precipitation = reTrackLongLow(m, 10.0, 320.0);
        relative_humidity = reTrackSinusoidal(humidity, 60.0, 79.0);
        break;
    case 16: // Cwb: warm temperature, winter dry, warm summer
        temp_night = reTrackEven(m, 1.0, 13.0);
        temp_day = reTrackLongLow(m, 15.0, 27.0);
        temp_water = reTrackEven(m, 5.0, 22.5);
        precipitation = reTrackLongLow(m, 10.0, 250.0);
        relative_humidity = reTrackSinusoidal(humidity, 58.0, 72.0);
        break;
    case 17: // Cwc: warm temperature, winter dry, cool summer
        temp_night = reTrackLongLow(m, -9.0, 6.0);
        temp_day = reTrackLongHigh(m, 6.0, 17.0);
        temp_water = reTrackLongHigh(m, 8.0, 15.5);
        precipitation = reTrackLongLow(m, 5.0, 200.0);
        relative_humidity = reTrackLongHigh(humidity, 50.0, 58.0);
        break;
    default:
        break;
    }

    temperature = reTrackLinear( h, temp_night, temp_day);
    temperature_mean = reTrackLinear(h, temp_night, temp_day);
    temperature_water = temp_water;
    humidity =  relative_humidity;

    GfLogInfo("## TEMPERATE Temperature = %.2f - Humidity = %.2f - Precipitation = %.2f\n", temperature, humidity, precipitation);
}

// https://en.wikipedia.org/wiki/Continental_climate
void reTrackSetContinetal(void)
{
    double m = (month - 1) * 30;
    double m2 = fmod(fabs(((month * 2) + 52) * (0.5 /24) - 0.1875), 1.0);
    double h = fmod(fabs(((hour + 18) *(0.5/24)) - 0.1875), 1.0);
    h = (h > 0.5)  ? 2.0 - (2.0 * h) : 2.0 * h;

    double hmin = reTrackSinusoidal(m, 0.0, 0.36);
    double hmax = reTrackSinusoidal(m, 0.86, 1.0);
    humidity = reTrackLinear(h, hmin, hmax);

    double temp_water = temperature_water;
    double temp_day = temperature;
    double temp_night = temperature;
    double relative_humidity = humidity;

    switch(code)
    {
    case 18: // Dfa: snow, fully humid, hot summer
        temp_night = reTrackSinusoidal(m, 0, 13.0);
        temp_day = reTrackSinusoidal(m, -5.0, 30.0);
        temp_water = reTrackSinusoidal(m, 0.0, 26.5);
        precipitation = reTrackLinear(m2, 30.0, 70.0);
        relative_humidity = reTrackSinusoidal(humidity, 68.0, 72.0);
        break;
    case 19: // Dfb: snow, fully humid, warm summer, warm summer
        temp_night = reTrackSinusoidal(m, -17.5, 10.0);
        temp_day = reTrackSinusoidal(m, -7.5, 25.0);
        temp_water = reTrackSinusoidal(m, -2.0, 22.5);
        precipitation = reTrackLinear(m2, 30.0, 70.0);
        relative_humidity = reTrackSinusoidal(humidity, 69.0, 81.0);
        break;
    case 20: // Dfc: snow, fully humid, cool summer, cool summer
        temp_night = reTrackSinusoidal(m, -30.0, 4.0);
        temp_day = reTrackSinusoidal(m, -20.0, 15.0);
        temp_water = reTrackSinusoidal(m, -10.0, 12.5);
        precipitation = reTrackLinear(m2, 22.0, 68.0);
        relative_humidity = reTrackSinusoidal(humidity, 70.0, 88.0);
        wind_speed = 3.0;
        break;
    case 21: // Dfd: snow, fully humid, extremely continetal
        temp_night = reTrackSinusoidal(m, -45.0, 4.0);
        temp_day = reTrackSinusoidal(m, -35.0, 10.0);
        temp_water = reTrackSinusoidal(m, -15.0, 8.5);
        precipitation = reTrackLongLow(m2, 7.5, 45.0);
        relative_humidity = reTrackSinusoidal(humidity, 80.0, 90.0);
        break;
    case 22: // Dsa: snow, summer dry, hot summer
        temp_night = reTrackSinusoidal(m, -10.0, 10.0);
        temp_day = reTrackSinusoidal(m, 0.0, 30.0);
        temp_water = reTrackSinusoidal(m, 4.0, 24.5);
        precipitation = reTrackLongHigh(m2, 5.0, 65.0);
        relative_humidity = reTrackSinusoidal(humidity, 48.0, 58.08);
        break;
    case 23: // Dsb: snow, summer dry, warm summer
        temp_night = reTrackSinusoidal(m, -15.0, 6.0);
        temp_day = reTrackSinusoidal(m, -4.0, 25.0);
        temp_water = reTrackSinusoidal(m, 0.0, 19.5);
        precipitation = reTrackLongHigh(m2, 12.0, 65.0);
        relative_humidity = reTrackSinusoidal(humidity, 50.0, 68.0);
        break;
    case 24: // Dsc: snow, summer dry, cool summer
        temp_night = reTrackSinusoidal(m, -27.5, 2.0);
        temp_day = reTrackSinusoidal(m, -4.0, 15.0);
        temp_water = reTrackSinusoidal(m, 0.0, 12.5);
        precipitation = reTrackLongLow(m2, 32.5, 45.0);
        relative_humidity = reTrackSinusoidal(humidity, 50.0, 60.0);
        break;
    case 25: // Dsd: snow, summer dry, extremely continetal
        temp_night = reTrackSinusoidal(m, -11.5, -6.5);
        temp_day = reTrackSinusoidal(m, 14.0, 27.0);
        temp_water = reTrackSinusoidal(m, 8.0, 20.5);
        precipitation = reTrackLongLow(m2, 5.0, 90.0);
        relative_humidity = reTrackSinusoidal(humidity, 48.0, 62.0);
        break;
    case 26: // Dwa: snow, winter dry, hot summer
        temp_night = reTrackSinusoidal(m, -18.0, 16.5);
        temp_day = reTrackSinusoidal(m, -5.0, 25.0);
        temp_water = reTrackSinusoidal(m, 0.0, 23.5);
        precipitation = reTrackLongLow(m2, 5.0, 180.0);
        relative_humidity = reTrackSinusoidal(humidity, 60.0, 68.0);
        break;
    case 27: // Dwb: snow, winter dry, warm summer
        temp_night = reTrackSinusoidal(m, -28.0, 10.0);
        temp_day = reTrackSinusoidal(m, -12.5, 22.5);
        temp_water = reTrackSinusoidal(m, -5.0, 18.5);
        precipitation = reTrackLongLow(m2, 10.0, 140.0);
        relative_humidity = reTrackSinusoidal(humidity, 60.0, 72.0);
        break;
    case 28: // Dwc: snow, winter dry, cool summer
        temp_night = reTrackSinusoidal(m, -33.0, 5.0);
        temp_day = reTrackSinusoidal(m, -20.0, 20.0);
        temp_water = reTrackSinusoidal(m, -10.0, 16.5);
        precipitation = reTrackLongLow(m2, 10.0, 110.0);
        relative_humidity = reTrackSinusoidal(humidity, 60.0, 78.0);
        break;
    case 29: // Dwd: snow, winter dry, extremely continetal
        temp_night = reTrackSinusoidal(m, -57.5, 0.0);
        temp_day = reTrackSinusoidal(m, -43.0, 15.0);
        temp_water = reTrackSinusoidal(m, -28.0, 11.5);
        precipitation = reTrackSinusoidal(m, 8.0, 63.0);
        relative_humidity = 80.0;
        break;
    default:
        break;
    }

    temperature = reTrackLinear(h, temp_night, temp_day);
    temperature_mean = reTrackLinear(h, temp_night, temp_day);
    temperature_water = temp_water;

    humidity = relative_humidity;
    GfLogInfo("## CONTINENTAL Temperature = %.2f - Humidity = %.2f - Precipitation = %.2f\n", temperature, humidity, precipitation);
}

void reTrackSetPolar(void)
{
    double m = (month - 1) * 30;
    double m2 = fmod(fabs(((month * 2) + 52) * (0.5 /24) - 0.1875), 1.0);
    double h = fmod(fabs(((hour + 18) *(0.5/24)) - 0.1875), 1.0);
    h = (h > 0.5)  ? 2.0 - (2.0 * h) : 2.0 * h;

    double hmin = reTrackSinusoidal(m, 0.0, 0.36);
    double hmax = reTrackSinusoidal(m, 0.86, 1.0);
    humidity = reTrackLinear(h, hmin, hmax);
    GfLogInfo("# Month = %i - hour = %i - raceTrack config humidity = %.2f - hmin = %.2f - hmax = %.2f\n",
              month, hour, humidity, hmin, hmax);

    // polar climate also occurs high in the mountains
    double temp_water = temperature_water;
    double temp_day = temperature;
    double temp_night = temperature;
    //double precipitation = precipitation;
    double relative_humidity = humidity;

    switch(code)
    {
    case 30: // EF: polar frost
        temp_night = reTrackLongLow(m2, -35.0, -6.0);
        temp_day = reTrackLongLow(m2, -32.5, 0.0);
        temp_water = reTrackLongLow(m2, -27.5, -3.5);
        precipitation = reTrackLinear(m2, 50.0, 80.0);
        relative_humidity = reTrackLongLow(humidity, 65.0, 75.0);
        wind_speed = 5.5;
        break;
    case 31: // ET: polar tundra
        temp_night = reTrackSinusoidal(m, -30.0, 0.0);
        temp_day = reTrackSinusoidal(m, -22.5, 8.0);
        temp_water = reTrackSinusoidal(m, -15.0, 5.0);
        precipitation = reTrackSinusoidal(m, 15.0, 45.0);
        relative_humidity = reTrackSinusoidal(humidity, 60.0, 88.0);
        wind_speed = 4.0;
        break;
    default:
        break;
    }

    temperature = reTrackLinear(h, temp_night, temp_day);
    temperature_mean = reTrackLinear(h, temp_night, temp_day);
    temperature_water = temp_water;

    humidity = relative_humidity;
    GfLogInfo("## POLAR Temperature = %.2f - Humidity = %.2f - Precipitation = %.2f\n", temperature, humidity, precipitation);
}

/** Shutdown the track for a race manager.
    @return <tt>0 ... </tt>Ok<br>
    <tt>-1 .. </tt>Error
*/
int
ReTrackShutdown(void)
{
    if(webMetar)
    {
        delete webMetar;
        webMetar = 0;
    }

    return 0;
}

/*
 * SOLID - Software Library for Interference Detection
 * Copyright (c) 2001 Dtecta <gino@dtecta.com>
 *
 * All rights reserved.
 */

#include "SOLID/broad.h"

#include "MT_Point3.h"
#include "BP_Scene.h"
#include "BP_Proxy.h"

BP_SceneHandle BP_CreateScene(void *client_data,
							  BP_Callback beginOverlap,
							  BP_Callback endOverlap)
{
	return (BP_SceneHandle)new BP_Scene(client_data,
										beginOverlap,
										endOverlap);
}


void BP_DeleteScene(BP_SceneHandle scene)
{
	delete (BP_Scene *)scene;
}


BP_ProxyHandle BP_CreateProxy(BP_SceneHandle scene, void *object,
							  const DT_Vector3 min, const DT_Vector3 max)
{
	return (BP_ProxyHandle)
		((BP_Scene *)scene)->createProxy(object, MT_Point3(min), MT_Point3(max));
}


void BP_DeleteProxy(BP_SceneHandle scene, BP_ProxyHandle proxy)
{
	((BP_Scene *)scene)->deleteProxy((BP_Proxy *)proxy);
}



void BP_SetBBox(BP_ProxyHandle proxy, const DT_Vector3 min, const DT_Vector3 max)
{
	((BP_Proxy *)proxy)->setBBox(MT_Point3(min), MT_Point3(max));
}

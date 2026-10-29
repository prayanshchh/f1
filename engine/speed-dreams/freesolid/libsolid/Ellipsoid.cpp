/*
  FreeSOLID - Software Library for Interference Detection
  Copyright (C) 1997-1998  Gino van den Bergen

  This library is free software; you can redistribute it and/or
  modify it under the terms of the GNU Library General Public
  License as published by the Free Software Foundation; either
  version 2 of the License, or (at your option) any later version.

  This library is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
  Library General Public License for more details.

  You should have received a copy of the GNU Library General Public
  License along with this library; if not, write to the Free
  Software Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.

  Please send remarks, questions and bug reports to gino@win.tue.nl,
  or write to:
                  Gino van den Bergen
		  Department of Mathematics and Computing Science
		  Eindhoven University of Technology
		  P.O. Box 513, 5600 MB Eindhoven, The Netherlands
*/
/*
  This File (C) 2005 Rodrigo Hernandez.
*/

#include "Ellipsoid.h"

Point Ellipsoid::support(const Vector& v) const
{
  Vector vt;
  vt[X] = v[X]/radii[X];
  vt[Y] = v[Y]/radii[Y];
  vt[Z] = v[Z]/radii[Z];
  Scalar s = vt.length();
  if (s > EPSILON)
    {
      Scalar r = 1/s;
      return Point((vt[X] * r)*radii[X],
		   (vt[Y] * r)*radii[Y],
		   (vt[Z] * r)*radii[Z]);
    }
  else return Point(0, 0, 0);
}

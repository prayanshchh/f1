/*
 * Copyright (c) 2001 Dtecta <gino@dtecta.com>
 *
 * Permission to use, copy, modify, distribute and sell this software
 * and its documentation for any purpose is hereby granted without fee,
 * provided that the above copyright notice appear in all copies and
 * that both that copyright notice and this permission notice appear
 * in supporting documentation.  Dtecta makes no representations about
 * the suitability of this software for any purpose.  It is provided
 * "as is" without express or implied warranty.
 */

#ifndef GEN_MINMAX_H
#define GEN_MINMAX_H

template <class T>
inline const T& GEN_min(const T& a, const T& b) {
  return b < a ? b : a;
}

template <class T>
inline const T& GEN_max(const T& a, const T& b) {
  return  a < b ? b : a;
}

template <class T>
inline void GEN_set_min(T& a, const T& b) {
    if (a > b) a = b;
}

template <class T>
inline void GEN_set_max(T& a, const T& b) {
    if (a < b) a = b;
}

template <class T>
inline void GEN_clamp(T& a, const T& b, const T& c) {
	if (a < b) a = b;
	else if (a > c) a = c;
}

#endif

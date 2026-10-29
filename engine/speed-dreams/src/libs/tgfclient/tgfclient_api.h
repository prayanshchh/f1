#ifndef TGFCLIENT_API_H
#define TGFCLIENT_API_H

// DLL exported symbols declarator for Windows.
#ifdef _WIN32
# ifdef TGFCLIENT_DLL
#  define TGFCLIENT_API __declspec(dllexport)
# else
#  define TGFCLIENT_API __declspec(dllimport)
# endif
#else
# define TGFCLIENT_API
#endif

#endif

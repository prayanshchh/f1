#!/bin/sh
set -e
root=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$root/apps/client/wasm"
em++ -O3 -msimd128 -std=c++20 -pthread \
  -sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency+2 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sMAXIMUM_MEMORY=4294967296 \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker \
  -sEXPORTED_RUNTIME_METHODS=wasmMemory -sEXPORTED_FUNCTIONS=_malloc,_free \
  -Wno-pthreads-mem-growth \
  -o "$root/apps/client/wasm/corridor.js" "$root/tools/corridor/wasm.cpp"

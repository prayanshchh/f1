import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  existsSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sd = path.join(root, "engine/speed-dreams");
const glue = path.join(root, "engine/src");
const build = path.join(root, "build/engine");
const out = path.join(root, "apps/client/wasm");
const generated = path.join(build, "generated");
const objects = path.join(build, "obj");
mkdirSync(generated, { recursive: true });
mkdirSync(objects, { recursive: true });
mkdirSync(out, { recursive: true });

const list = (dir, ext = /\.(c|cpp)$/) =>
  readdirSync(path.join(sd, dir))
    .filter((f) => ext.test(f))
    .map((f) => path.join(sd, dir, f));

const sources = [
  ...list("src/modules/simu/simuv5").filter((f) => !f.endsWith("simuv5.cpp")),
  ...[
    "track.cpp",
    "track3.cpp",
    "track4.cpp",
    "track5.cpp",
    "trackutil.cpp",
  ].map((f) => path.join(sd, "src/modules/track/trackv1", f)),
  ...[
    "application",
    "eventloop",
    "directory",
    "file",
    "filesetup",
    "formula",
    "hash",
    "module",
    "legacymodule",
    "modinfo",
    "os",
    "params",
    "profiler",
    "randname",
    "schedulespy",
    "tmppath",
    "tgf",
    "trace",
    "memmanager",
    "linuxspec",
  ].map((f) => path.join(sd, "src/libs/tgf", `${f}.cpp`)),
  ...["xmlparse.c", "xmltok.c", "xmlrole.c", "xml.cpp"].map((f) =>
    path.join(sd, "src/libs/txml", f),
  ),
  ...list("src/libs/robottools"),
  path.join(sd, "src/libs/portability/portability.cpp"),
  path.join(sd, "src/libs/tgfclient/control.cpp"),
  path.join(sd, "src/libs/tgfclient/forcefeedback.cpp"),
  path.join(sd, "src/drivers/human/human.cpp"),
  ...list("freesolid/libsolid"),
  ...list("freesolid/libbroad"),
  ...list("freesolid/libmoto"),
  path.join(glue, "game.cpp"),
  path.join(glue, "client.cpp"),
  path.join(glue, "view.cpp"),
  path.join(glue, "input.cpp"),
  path.join(root, "engine/third_party/OpenSceneGraph/src/osg/Matrixd.cpp"),
  path.join(root, "engine/third_party/OpenSceneGraph/src/osg/Quat.cpp"),
];

function lines(file) {
  return readFileSync(path.join(sd, file), "utf8").split("\n");
}

function extractFunction(source, signature) {
  const index = source.findIndex((line) => line.startsWith(signature));
  if (index < 0) throw new Error(`missing ${signature}`);
  const startLine = /^(static\s+)?(void|int|double)\s*$/.test(source[index - 1])
    ? index - 1
    : index;
  const end = source.findIndex((line, i) => i > index && line.startsWith("}"));
  return source.slice(startLine, end + 1).join("\n");
}

function extractBetween(source, startPattern, endPattern) {
  const start = source.findIndex((line) => startPattern.test(line));
  const end = source.findIndex((line, i) => i > start && endPattern.test(line));
  if (start < 0 || end < 0) throw new Error(`missing block ${startPattern}`);
  return source.slice(start, end + 1).join("\n");
}

const racetrack = lines("src/modules/racing/standardgame/racetrack.cpp");
const raceinit = lines("src/modules/racing/standardgame/raceinit.cpp");
const camera = lines("src/modules/graphic/osggraph/Viewer/OsgCamera.cpp");

const raceTrackFunctions = [
  "reTrackInitTimeOfDay(void)",
  "reTrackInitWeather(void)",
  "reTrackInitWeatherValues(void)",
  "ReTrackUpdate(void)",
  "reTrackUpdatePhysics(void)",
  "double reTrackLinear(",
  "double reTrackTriangular(",
  "double reTrackSinusoidal(",
  "double reTrackEven(",
  "double reTrackLongLow(",
  "double reTrackLongHigh(",
  "double reTrackMonsoonal(",
  "void  reTrackUpdatePrecipitation(",
  "void reTrackUpdateWind(",
  "void reTrackUpdatePressure(",
  "void reTrackSetOcean(",
  "void reTrackSetTropical(",
  "void reTrackSetDry(",
  "void reTrackSetTemperate(",
  "void reTrackSetContinetal(",
  "void reTrackSetPolar(",
];

writeFileSync(
  path.join(generated, "race-extract.cpp"),
  [
    "#include <cstdlib>",
    "#include <cstdio>",
    "#include <ctime>",
    "#include <cmath>",
    "#include <cstring>",
    "#include <algorithm>",
    "#include <tgf.h>",
    "#include <raceman.h>",
    "#include <track.h>",
    "#include <robottools.h>",
    "#include <portability.h>",
    '#include "game.h"',
    "void ReTrackUpdate(void);",
    "static void reTrackInitRealWeather(void) {}",
    extractBetween(
      racetrack,
      /^\/\/ Local functions\./,
      /^static double pressure = 0\.0;/,
    ),
    ...raceTrackFunctions.map((signature) =>
      extractFunction(racetrack, signature),
    ),
    extractFunction(raceinit, "initStartingGrid(void)"),
    "void sdInitWeather() { reTrackInitTimeOfDay(); reTrackInitWeather(); }",
    "void sdInitStartingGrid() { initStartingGrid(); }",
    "",
  ].join("\n"),
);

const view = lines("src/modules/graphic/osggraph/Viewer/OsgView.cpp");
const replacedIncludes = new Set([
  '#include "OsgView.h"',
  '#include "OsgScenery.h"',
  '#include "OsgMain.h"',
]);
const mirrorStart = camera.findIndex((line) =>
  line.startsWith("// cGrCarCamMirror ==="),
);
const mirrorEnd = camera.findIndex((line) =>
  line.startsWith("// SDCarCamRoadZoomTVD ==="),
);
if (mirrorStart < 0 || mirrorEnd < mirrorStart)
  throw new Error("missing SDCarCamMirror section");
writeFileSync(
  path.join(generated, "camera-extract.cpp"),
  [
    ...camera
      .slice(0, mirrorStart)
      .map((line) =>
        replacedIncludes.has(line.trim())
          ? line.includes("OsgView.h")
            ? '#include "sdview.h"'
            : ""
          : line,
      ),
    ...camera.slice(mirrorEnd),
    "",
  ].join("\n"),
);

writeFileSync(
  path.join(generated, "view-extract.cpp"),
  [
    "#include <cstdio>",
    "#include <cstring>",
    "#include <graphic.h>",
    '#include "sdview.h"',
    "namespace osggraph {",
    "static char buf[1024];",
    "static char path[1024];",
    "static char path2[1024];",
    extractFunction(view, "void SDView::loadParams(tSituation *s)"),
    extractFunction(view, "void SDView::saveCamera()"),
    "}",
    "",
  ].join("\n"),
);

sources.push(
  path.join(generated, "race-extract.cpp"),
  path.join(generated, "camera-extract.cpp"),
  path.join(generated, "view-extract.cpp"),
);

const includes = [
  "engine/src",
  "engine/src/include",
  "engine/third_party/OpenSceneGraph/include",
  "engine/speed-dreams/src/interfaces",
  "engine/speed-dreams/src/libs/tgf",
  "engine/speed-dreams/src/libs/txml",
  "engine/speed-dreams/src/libs/math",
  "engine/speed-dreams/src/libs/robottools",
  "engine/speed-dreams/src/libs/portability",
  "engine/speed-dreams/src/libs/tgfclient",
  "engine/speed-dreams/src/modules/track/trackv1",
  "engine/speed-dreams/src/modules/graphic/osggraph/Viewer",
  "engine/speed-dreams/src/modules/graphic/osggraph/Utils",
  "engine/speed-dreams/freesolid/include",
  "engine/speed-dreams/freesolid/include/FreeSOLID",
  "engine/speed-dreams/freesolid/libsolid",
  "engine/speed-dreams/freesolid/libbroad",
  "engine/speed-dreams/freesolid/libmoto",
].map((dir) => `-I${path.join(root, dir)}`);

const defines = [
  "-DHAVE_CONFIG_H",
  "-DSHM",
  "-DSPEED_DREAMS",
  "-DTRACE_LEVEL=5",
  "-DTRACE_OUT",
  "-D_DEFAULT_SOURCE",
  "-DNDEBUG",
];
const flags = ["-O3", "-sUSE_SDL=2", "-Wno-everything"];

const headerStamp = Math.max(
  ...[glue, path.join(glue, "include")].flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".h"))
      .map((f) => statSync(path.join(dir, f)).mtimeMs),
  ),
);

const objectFiles = [];
for (const source of sources) {
  const object = path.join(
    objects,
    `${path.relative(root, source).replaceAll(/[\\/]/g, "_")}.o`,
  );
  objectFiles.push(object);
  const fresh =
    existsSync(object) &&
    statSync(object).mtimeMs > statSync(source).mtimeMs &&
    statSync(object).mtimeMs > headerStamp;
  if (fresh) continue;
  const compiler = source.endsWith(".c") ? "emcc" : "em++";
  const std = source.endsWith(".c") ? [] : ["-std=c++17"];
  process.stdout.write(`compile ${path.relative(root, source)}\n`);
  execFileSync(
    compiler,
    [...std, ...flags, ...defines, ...includes, "-c", source, "-o", object],
    {
      stdio: "inherit",
    },
  );
}

const data = path.join(build, "data");
const files = [
  [path.join(sd, "speed-dreams-data/data/cars"), "/sd/data/cars"],
  [path.join(sd, "speed-dreams-data/data/data/tracks"), "/sd/data/data/tracks"],
  [path.join(sd, "speed-dreams-data/data/tracks"), "/sd/data/tracks"],
  [path.join(sd, "speed-dreams-data/data/config"), "/sd/data/config"],
  [path.join(root, "engine/data/local"), "/sd/local"],
  [
    path.join(root, "content/tracks/cota/cota.xml"),
    "/sd/data/tracks/circuit/cota/cota.xml",
  ],
];
rmSync(data, { recursive: true, force: true });
function stage(from, to) {
  if (!statSync(from).isDirectory()) {
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    return;
  }
  for (const entry of readdirSync(from)) {
    if (/\.(acc|ac|png|jpg|wav|txt)$/.test(entry)) continue;
    stage(path.join(from, entry), path.join(to, entry));
  }
}
for (const [from, to] of files) stage(from, path.join(data, to));

const exported = [
  "_sdInit",
  "_sdKey",
  "_sdUpdate",
  "_sdStep",
  "_sdFrame",
  "_sdTrackLength",
  "_sdTrackLocal2Global",
  "_sdTrackInfo",
  "_sdCarInfo",
  "_sdTelemetry",
  "_sdHudInfo",
  "_sdCarLimits",
  "_sdTrackSectors",
  "_sdInputAssist",
  "_sdInputAnalog",
  "_sdCarName",
  "_sdCarParamStr",
  "_sdCarParamNum",
  "_sdCarParamCount",
  "_sdViewKey",
  "_sdViewResize",
  "_malloc",
  "_free",
];

process.stdout.write("link apps/client/wasm/speed-dreams.js\n");
execFileSync(
  "em++",
  [
    ...flags,
    ...objectFiles,
    "-o",
    path.join(out, "speed-dreams.js"),
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sEXPORT_NAME=createSpeedDreams",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sENVIRONMENT=web,worker,node",
    "-sFORCE_FILESYSTEM=1",
    `-sEXPORTED_FUNCTIONS=${exported.join(",")}`,
    "-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,HEAPF64,HEAPF32,FS",
    "--embed-file",
    `${path.join(data, "sd")}@/sd`,
  ],
  { stdio: "inherit" },
);
copyFileSync(
  path.join(root, "content/tracks/cota/sd-frame.json"),
  path.join(out, "sd-frame.json"),
);

const sdData = path.join(sd, "speed-dreams-data/data");
const renderOut = path.join(out, "sd");
rmSync(renderOut, { recursive: true, force: true });
const manifest = [];
for (const [dir, pattern] of [
  ["tracks/circuit/jarama", /\.(acc|png)$/],
  ["cars/models/sc-cavallo-360", /\.(acc|png)$/],
  ["cars/models/22mp1-sector-mcl36", /\.(acc|png)$/],
  ["data/objects", /\.(ac|acc|png)$/],
  ["data/textures", /\.png$/],
]) {
  mkdirSync(path.join(renderOut, dir), { recursive: true });
  for (const file of readdirSync(path.join(sdData, dir)).filter((f) =>
    pattern.test(f),
  )) {
    copyFileSync(path.join(sdData, dir, file), path.join(renderOut, dir, file));
    manifest.push(`${dir}/${file}`);
  }
}
writeFileSync(path.join(renderOut, "manifest.json"), JSON.stringify(manifest));
process.stdout.write(`render data: ${manifest.length} files\n`);

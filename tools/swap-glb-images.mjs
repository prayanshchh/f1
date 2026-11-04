import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";

const [glbPath, ...imagePaths] = process.argv.slice(2);
if (!glbPath || imagePaths.length === 0)
  throw new Error("usage: swap-glb-images.mjs <file.glb> <image>...");

const jsonChunk = 0x4e4f534a;
const binChunk = 0x004e4942;
const align = (n) => (n + 3) & ~3;

const file = readFileSync(glbPath);
const jsonLength = file.readUInt32LE(12);
if (file.readUInt32LE(16) !== jsonChunk) throw new Error("no JSON chunk");
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8"));
const binHeader = 20 + jsonLength;
if (file.readUInt32LE(binHeader + 4) !== binChunk)
  throw new Error("no BIN chunk");
const bin = file.subarray(
  binHeader + 8,
  binHeader + 8 + file.readUInt32LE(binHeader),
);

const replacements = new Map();
for (const path of imagePaths) {
  const name = basename(path, extname(path));
  const index = gltf.images.findIndex((image) => image.name === name);
  if (index < 0) throw new Error(`${glbPath} has no image named ${name}`);
  replacements.set(gltf.images[index].bufferView, readFileSync(path));
}

const pieces = [];
let offset = 0;
gltf.bufferViews.forEach((view, index) => {
  const start = view.byteOffset ?? 0;
  const data =
    replacements.get(index) ?? bin.subarray(start, start + view.byteLength);
  const padded = align(offset);
  if (padded > offset) pieces.push(Buffer.alloc(padded - offset));
  view.byteOffset = padded;
  view.byteLength = data.length;
  pieces.push(data);
  offset = padded + data.length;
});
const total = align(offset);
if (total > offset) pieces.push(Buffer.alloc(total - offset));
gltf.buffers[0].byteLength = total;

const json = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPadded = Buffer.concat([
  json,
  Buffer.alloc(align(json.length) - json.length, 0x20),
]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + total, 8);
const chunk = (length, type) => {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(length, 0);
  head.writeUInt32LE(type, 4);
  return head;
};
writeFileSync(
  glbPath,
  Buffer.concat([
    header,
    chunk(jsonPadded.length, jsonChunk),
    jsonPadded,
    chunk(total, binChunk),
    ...pieces,
  ]),
);
process.stdout.write(`swapped ${replacements.size} image(s) in ${glbPath}\n`);

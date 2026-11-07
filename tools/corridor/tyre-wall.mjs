import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const say = (...parts) => process.stdout.write(`${parts.join(" ")}\n`);

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "content/cars/shared/tyre.png");
const out = path.join(root, "content/tracks/hill-country/low/tyre-wall.json");
const blocks = 3;
const samples = 64;
const columnStep = 4;

const image = PNG.sync.read(readFileSync(source));
const rows = Math.floor(image.height / blocks);
const paint = [];
const white = [];
for (let i = 0; i < samples; i++) {
  const from = Math.floor((i * rows) / samples);
  const to = Math.floor(((i + 1) * rows) / samples);
  let r = 0;
  let g = 0;
  let n = 0;
  for (let y = from; y < to; y++)
    for (let x = 0; x < image.width; x += columnStep) {
      const at = (y * image.width + x) * 4;
      r += image.data[at];
      g += image.data[at + 1];
      n++;
    }
  paint.push(Number((r / n / 255).toFixed(3)));
  white.push(Number((g / n / 255).toFixed(3)));
}
writeFileSync(out, JSON.stringify({ paint, white }));
say(`tyre wall profile: ${samples} rings from ${rows} rows`);

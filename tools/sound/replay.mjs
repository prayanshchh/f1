import { readFileSync, writeFileSync } from "node:fs";
import { CarSynth, idleState } from "../../apps/client/src/game/sound/synth.ts";

const [tablesPath, replayPath, outputPath] = process.argv.slice(2);
if (!tablesPath || !replayPath || !outputPath)
  throw new Error("usage: replay.mjs tables.json replay.json out.f32");
const tables = JSON.parse(readFileSync(tablesPath, "utf8"));
const replay = JSON.parse(readFileSync(replayPath, "utf8"));
const sampleRate = 48000;
const blockSize = 128;
const synth = new CarSynth(tables, sampleRate, blockSize);
const frames = replay.channels.rpm.length;
const total = Math.floor((frames * replay.hop * sampleRate) / blockSize);
const output = new Float32Array(total * blockSize * 2);
const left = new Float32Array(blockSize);
const right = new Float32Array(blockSize);
for (let block = 0; block < total; block++) {
  const index = Math.min(
    frames - 1,
    Math.floor((block * blockSize) / sampleRate / replay.hop),
  );
  const state = { ...idleState, master: 1 };
  for (const [name, values] of Object.entries(replay.channels))
    state[name] = values[index];
  synth.set(state);
  synth.process({ left, right });
  for (let i = 0; i < blockSize; i++) {
    output[(block * blockSize + i) * 2] = left[i];
    output[(block * blockSize + i) * 2 + 1] = right[i];
  }
}
writeFileSync(outputPath, Buffer.from(output.buffer));

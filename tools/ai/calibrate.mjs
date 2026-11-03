import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

globalThis.navigator ??= {};
const root = path.resolve(import.meta.dirname, "../..");
const target = path.join(root, "content/tracks/cota/ai-calibration.json");
const knotSamples = 20;
const steps = [0.04, 0.02, 0.01];
const passes = Number(process.argv[2] ?? 4);
const edgeMargin = 1.4;
const fuelReference = 15;

const loaded = await import(
  path.join(root, "apps/client/wasm/speed-dreams.js")
);
const m = await loaded.default({ print: () => {}, printErr: () => {} });
m._sdFieldClear();
m._sdSessionConfigure(3, 0, 1, 1);
m._sdFieldAutopilot(1);
m._sdTyresConfigure(1, 0);
const status = m.cwrap("sdInit", "number", [
  "string",
  "string",
  "string",
  "string",
  "number",
])("circuit", "cota", "config/raceman/quickrace.xml", "22mp1-sector-mcl36", 0);
if (status !== 0) throw new Error(`engine failed to start: ${String(status)}`);
const count = m._sdAiLineCount();
const left = new Float64Array(count);
const right = new Float64Array(count);
const refresh = () => {
  const out = m._malloc(48);
  for (let i = 0; i < count; i++) {
    m._sdAiLine(i, out);
    const v = new Float64Array(m.HEAPF64.buffer, out, 6);
    left[i] = v[1];
    right[i] = v[2];
  }
  m._free(out);
};
const knots = Math.ceil(count / knotSamples);
const stored = JSON.parse(readFileSync(target, "utf8")).gain;
const gain = Array.from({ length: knots }, (_, k) => {
  const x = (k / knots) * stored.length;
  return stored[Math.floor(x) % stored.length] ?? 1;
});
const apply = () => {
  for (let i = 0; i < count; i++) {
    const x = i / knotSamples;
    const a = Math.floor(x) % knots;
    const b = (a + 1) % knots;
    m._sdAiGainSet(i, gain[a] + (gain[b] - gain[a]) * (x - Math.floor(x)));
  }
  m._sdAiRebuild();
};
const frame = () => new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
const statsAt = m._malloc(80);
const walls = () => {
  m._sdSessionStats(statsAt);
  return new Float64Array(m.HEAPF64.buffer, statsAt, 6)[2];
};
const toLine = () => {
  const lap = frame()[49];
  for (let tick = 0; tick < 200000 && frame()[49] === lap; tick++) m._sdStep(2);
};
apply();
refresh();
toLine();
toLine();
m._sdAiFuel(0, fuelReference);
const snapshot = new Uint8Array(m.HEAPF64.buffer).slice();
const lapTime = () => {
  new Uint8Array(m.HEAPF64.buffer).set(snapshot);
  apply();
  const wallsBefore = walls();
  const lap = frame()[49];
  let excursion = 0;
  for (let tick = 0; tick < 100000; tick++) {
    m._sdStep(2);
    const f = frame();
    if (f[49] !== lap) break;
    const i = Math.floor(f[53] / 2) % count;
    excursion = Math.max(excursion, f[54] - left[i], right[i] - f[54]);
  }
  const f = frame();
  const bad = walls() > wallsBefore || excursion > edgeMargin || f[49] === lap;
  return bad ? Infinity : f[51];
};
let best = lapTime();
process.stdout.write(`start ${best.toFixed(3)}\n`);
const save = () => {
  writeFileSync(
    target,
    `${JSON.stringify({ gain: gain.map((g) => Number(g.toFixed(4))) })}\n`,
  );
};
for (const step of steps) {
  for (let pass = 0; pass < passes; pass++) {
    let accepted = 0;
    for (let span = 0; span < knots; span++) {
      for (const direction of [1, -1]) {
        const a = span;
        const b = (span + 1) % knots;
        const saved = [gain[a], gain[b]];
        gain[a] = (gain[a] ?? 1) * (1 + direction * step);
        gain[b] = (gain[b] ?? 1) * (1 + direction * step);
        const trial = lapTime();
        if (trial < best - 0.002) {
          best = trial;
          accepted++;
          break;
        }
        gain[a] = saved[0];
        gain[b] = saved[1];
      }
    }
    save();
    process.stdout.write(
      `step ${String(step)} pass ${String(pass)} accepted ${String(accepted)} lap ${best.toFixed(3)}\n`,
    );
    if (accepted === 0) break;
  }
}

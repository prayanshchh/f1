import * as THREE from "three/webgpu";
import type { Scene } from "../scene.ts";
import type { CorridorView, Placed } from "./corridor-view.ts";

const tileLength = 1.6;
const tileWidth = 1.15;
const feather = 0.04;
const opacity = 0.78;
const maskSize = 32;
const blendFlag = 8;
const fadeSteps = 4;
const palette = [
  "#4fb85a",
  "#f2c230",
  "#f0832a",
  "#ec6c2a",
  "#e8552a",
  "#e3302a",
].map((hex) => new THREE.Color(hex));
const acesScale = 1 / 0.6;

function fitted(v: number): number {
  return (
    (v * (v + 0.0245786) - 0.000090537) /
    (v * (0.983729 * v + 0.432951) + 0.238081)
  );
}

function toneMapped(colour: THREE.Color, exposure: number): number[] {
  const k = exposure * acesScale;
  const r = colour.r * k;
  const g = colour.g * k;
  const b = colour.b * k;
  const a = fitted(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const c = fitted(0.076 * r + 0.90834 * g + 0.01566 * b);
  const d = fitted(0.0284 * r + 0.13383 * g + 0.83777 * b);
  const out = new THREE.Color(
    THREE.MathUtils.clamp(1.60475 * a - 0.53108 * c - 0.07367 * d, 0, 1),
    THREE.MathUtils.clamp(-0.10208 * a + 1.10813 * c - 0.00605 * d, 0, 1),
    THREE.MathUtils.clamp(-0.00327 * a - 0.07276 * c + 1.07602 * d, 0, 1),
  ).convertLinearToSRGB();
  return [out.r, out.g, out.b];
}

function maskPixels(strength: number): Uint8Array {
  const pixels = new Uint8Array(maskSize * maskSize * 4);
  for (let y = 0; y < maskSize; y++)
    for (let x = 0; x < maskSize; x++) {
      const u = (x + 0.5) / maskSize;
      const v = (y + 0.5) / maskSize;
      const edge = Math.min(0.5 - Math.abs(u - 0.5), 0.5 - Math.abs(v - 0.5));
      const soft = THREE.MathUtils.smoothstep(edge, 0, feather);
      pixels.set(
        [255, 255, 255, Math.round(255 * opacity * strength * soft)],
        (y * maskSize + x) * 4,
      );
    }
  return pixels;
}

function nearest(colour: THREE.Color): number {
  let best = 0;
  let bestDistance = Infinity;
  palette.forEach((entry, i) => {
    const distance =
      (entry.r - colour.r) ** 2 +
      (entry.g - colour.g) ** 2 +
      (entry.b - colour.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  return best;
}

export class CorridorLine {
  private readonly meshes: number[][];
  private readonly pool: THREE.Matrix4[] = [];
  private readonly placed: Placed[] = [];

  constructor(view: CorridorView, exposure: number) {
    const geometry = new THREE.PlaneGeometry(tileLength, tileWidth);
    geometry.rotateX(-Math.PI / 2);
    const index = geometry.index;
    const data = {
      positions: Float32Array.from(geometry.getAttribute("position").array),
      uvs: Float32Array.from(geometry.getAttribute("uv").array),
      indices: Uint32Array.from(index ? index.array : []),
    };
    this.meshes = Array.from({ length: fadeSteps }, (_, step) => {
      const mask = view.rawTexture(
        maskPixels((step + 1) / fadeSteps),
        maskSize,
        maskSize,
        blendFlag,
      );
      return palette.map((colour) => {
        const id = view.mesh(data, mask, null, toneMapped(colour, exposure));
        view.layer(id, "decal");
        return id;
      });
    });
  }

  update(scene: Scene): Placed[] {
    this.placed.length = 0;
    scene.forEachRacingTile((matrix, colour, alpha) => {
      const step = Math.round((alpha / opacity) * fadeSteps) - 1;
      const meshes = this.meshes[Math.min(step, fadeSteps - 1)];
      if (!meshes) return;
      const slot = this.placed.length;
      const held = this.pool[slot] ?? new THREE.Matrix4();
      this.pool[slot] = held;
      held.copy(matrix);
      this.placed.push({
        mesh: meshes[nearest(colour)] ?? 0,
        matrix: held,
        last: true,
      });
    });
    return this.placed;
  }
}

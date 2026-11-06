import * as THREE from "three/webgpu";

export interface TrackManifest {
  millimetre: number;
  materials: { texture: string | null; layer: string | null }[];
  textures: Record<
    string,
    {
      file: string;
      alpha: string | null;
      width: number;
      height: number;
      flags: number;
    }
  >;
  patterns: Record<string, { colours: number[][]; flags: number }>;
  sky: { zenith: number[]; horizon: number[] };
  ground: number[];
  chunks: { chunk: number; lo: number[]; hi: number[] }[];
  groups: { chunk: number; material: number }[];
}

export interface TrackPart {
  near: number;
  far: number;
}

interface Block {
  box: THREE.Box3;
  parts: TrackPart[];
  distance: number;
}

const lodReach = 250;

export class TrackSet {
  private readonly blocks: Block[] = [];
  private readonly always: TrackPart[] = [];
  private readonly seen: Block[] = [];

  constructor(manifest: TrackManifest, parts: TrackPart[]) {
    const byChunk = new Map<number, Block>();
    for (const chunk of manifest.chunks) {
      if (chunk.chunk < 0) continue;
      const block: Block = {
        box: new THREE.Box3(
          new THREE.Vector3().fromArray(chunk.lo),
          new THREE.Vector3().fromArray(chunk.hi),
        ),
        parts: [],
        distance: 0,
      };
      byChunk.set(chunk.chunk, block);
      this.blocks.push(block);
    }
    manifest.groups.forEach((group, index) => {
      const part = parts[index];
      if (!part) return;
      if (group.chunk < 0) this.always.push(part);
      else byChunk.get(group.chunk)?.parts.push(part);
    });
  }

  visible(frustum: THREE.Frustum, eye: THREE.Vector3, out: number[]): void {
    this.seen.length = 0;
    for (const block of this.blocks) {
      if (!frustum.intersectsBox(block.box)) continue;
      block.distance = block.box.distanceToPoint(eye);
      this.seen.push(block);
    }
    this.seen.sort((a, b) => a.distance - b.distance);
    for (const block of this.seen)
      for (const part of block.parts)
        out.push(block.distance > lodReach ? part.far : part.near);
    for (const part of this.always) out.push(part.near);
  }
}

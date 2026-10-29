import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { acToSd, parseAcc, type AccGeode } from "./acc.ts";
import type { SurfaceOptions } from "./materials.ts";

interface LoadedTexture {
  texture: THREE.Texture;
  translucent: boolean;
}

export interface ModelOptions {
  car: boolean;
  skin?: string;
  searchPath: string[];
  material: (options: SurfaceOptions) => THREE.Material;
}

function isImageTranslucent(bitmap: ImageBitmap): boolean {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  for (let i = 3; i < data.length; i += 4)
    if ((data[i] ?? 255) !== 255) return true;
  return false;
}

export class SdAssets {
  private readonly textures = new Map<string, Promise<LoadedTexture | null>>();
  private constructor(
    private readonly base: string,
    private readonly files: Set<string>,
  ) {}

  static async open(base: string): Promise<SdAssets> {
    const response = await fetch(`${base}manifest.json`);
    if (!response.ok)
      throw new Error(
        "Speed Dreams render data is missing; run pnpm build:engine",
      );
    return new SdAssets(base, new Set((await response.json()) as string[]));
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }

  find(name: string, searchPath: string[]): string | null {
    if (!name) return null;
    for (const dir of searchPath)
      if (this.files.has(dir + name)) return dir + name;
    return null;
  }

  async text(path: string): Promise<string> {
    const response = await fetch(this.base + path);
    if (!response.ok) throw new Error(`cannot load ${path}`);
    return new TextDecoder("latin1").decode(await response.arrayBuffer());
  }

  texture(path: string): Promise<LoadedTexture | null> {
    let entry = this.textures.get(path);
    if (!entry) {
      entry = (async () => {
        const response = await fetch(this.base + path);
        if (!response.ok) return null;
        const bitmap = await createImageBitmap(await response.blob(), {
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        });
        const texture = new THREE.Texture(bitmap);
        texture.colorSpace = THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = true;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        return { texture, translucent: isImageTranslucent(bitmap) };
      })();
      this.textures.set(path, entry);
    }
    return entry;
  }

  async model(path: string, options: ModelOptions): Promise<THREE.Group> {
    const geodes = parseAcc(await this.text(path), {
      car: options.car,
      skin: options.skin ?? "",
      textureExists: (name) => this.find(name, options.searchPath) !== null,
    });
    const states = await Promise.all(
      geodes.map((geode) => this.surface(geode, options.searchPath)),
    );
    const opaque = new Map<
      string,
      { options: SurfaceOptions; geometries: THREE.BufferGeometry[] }
    >();
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    root.matrix.copy(acToSd);
    geodes.forEach((geode, i) => {
      const state = states[i];
      if (!state) return;
      const geometry = toGeometry(geode, state.map !== null);
      if (state.translucent) {
        const mesh = new THREE.Mesh(geometry, options.material(state));
        mesh.name = geode.name;
        root.add(mesh);
        return;
      }
      const key = [state.map?.id ?? -1, state.alphaClamp, state.twoSided].join(
        "|",
      );
      const bucket = opaque.get(key) ?? { options: state, geometries: [] };
      bucket.geometries.push(geometry);
      opaque.set(key, bucket);
    });
    for (const { options: state, geometries } of opaque.values()) {
      const merged =
        geometries.length === 1
          ? geometries[0]
          : mergeGeometries(geometries, false);
      if (!merged) continue;
      root.add(new THREE.Mesh(merged, options.material(state)));
    }
    const group = new THREE.Group();
    group.add(root);
    return group;
  }

  private async surface(
    geode: AccGeode,
    searchPath: string[],
  ): Promise<SurfaceOptions | null> {
    const name = geode.texture.names[0];
    const path = this.find(name, searchPath);
    const loaded = path ? await this.texture(path) : null;
    const textureTranslucent = loaded
      ? loaded.translucent && !geode.texture.blockTransparent
      : false;
    const alphaClamp = loaded !== null && /tree|trans-|arbor/.test(name);
    return {
      map: loaded?.texture ?? null,
      translucent: geode.material.translucent || textureTranslucent,
      alphaClamp,
      twoSided: geode.twoSided,
    };
  }
}

function toGeometry(geode: AccGeode, textured: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(geode.positions, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(geode.normals, 3));
  const uv = textured
    ? geode.uvs
    : new Float32Array((geode.positions.length / 3) * 2);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(geode.indices, 1));
  return geometry;
}

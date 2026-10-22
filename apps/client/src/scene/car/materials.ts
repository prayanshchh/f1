import {
  DataTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from "three/webgpu";
import {
  cos,
  floor,
  fwidth,
  max,
  mod,
  select,
  sin,
  smoothstep,
  uv,
  vec2,
} from "three/tsl";
import {
  paintLivery,
  type Livery,
  type LiveryMask,
} from "../../livery/index.ts";

function environmentRow(t: number): number[] {
  const sky = t < 0.5;
  const start = sky ? [79, 127, 179] : [107, 112, 102];
  const end = sky ? [214, 236, 255] : [43, 51, 46];
  const k = sky ? (t * 2) ** 2 : Math.sqrt((t - 0.5) * 2);
  return start.map((value, channel) =>
    Math.round(value + ((end[channel] ?? 0) - value) * k),
  );
}

export function createEnvironment(): DataTexture {
  const data = new Uint8Array(64 * 32 * 4);
  for (let row = 0; row < 32; row += 1) {
    const rgb = environmentRow((row + 0.5) / 32);
    for (let column = 0; column < 64; column += 1) {
      data.set([...rgb, 255], (row * 64 + column) * 4);
    }
  }
  const texture = new DataTexture(data, 64, 32);
  texture.mapping = EquirectangularReflectionMapping;
  texture.flipY = true;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createPaint(
  mask: LiveryMask,
  livery: Livery,
  environment: Texture,
) {
  const pixels = paintLivery(mask, livery);
  const texture = new DataTexture(
    pixels,
    mask.width,
    mask.height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const material = new MeshPhysicalNodeMaterial({
    name: "paint",
    map: texture,
    color: 0xffffff,
    metalness: 0.5,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMap: environment,
  });
  return {
    material,
    setLivery(next: Livery): void {
      pixels.set(paintLivery(mask, next));
      texture.needsUpdate = true;
    },
  };
}

export function createCarbon(
  environment: Texture,
  repeats = 256,
): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial({
    name: "carbon",
    color: 0x303034,
    metalness: 0,
    roughness: 0.32,
    envMap: environment,
  });
  const cell = uv().mul(repeats);
  const ij = floor(cell);
  const warp = mod(ij.x.add(ij.y), 4).lessThan(2);
  const angle = select(warp, 0, Math.PI / 2);
  const size = max(fwidth(cell.x), fwidth(cell.y));
  const fade = smoothstep(0.35, 0.7, size).oneMinus();
  material.anisotropyNode = vec2(cos(angle), sin(angle)).mul(fade.mul(0.8));
  return material;
}

function standard(
  environment: Texture,
  name: string,
  color: number,
  roughness: number,
): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial({
    name,
    color,
    roughness,
    metalness: 0,
    envMap: environment,
  });
}

export function createRubber(environment: Texture): MeshStandardNodeMaterial {
  return standard(environment, "rubber", 0x272727, 0.9);
}

export function createMetal(environment: Texture): MeshStandardNodeMaterial {
  const material = standard(environment, "metal", 0xffffff, 0.28);
  material.metalness = 1;
  material.color.setRGB(0.542, 0.497, 0.449);
  return material;
}

export function createInterior(environment: Texture): MeshStandardNodeMaterial {
  return standard(environment, "interior", 0x3f3f44, 0.85);
}

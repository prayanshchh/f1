import * as THREE from "three/webgpu";
import {
  abs,
  bumpMap,
  cameraViewMatrix,
  color,
  float,
  floor,
  fract,
  fwidth,
  hash,
  luminance,
  max,
  mix,
  normalGeometry,
  normalViewGeometry,
  positionGeometry,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import { carFile } from "./teams.ts";
import { releaseOnceUploaded } from "./preload.ts";

const envWidth = 512;
const envHeight = 256;
const studioEnvRotation = new THREE.Euler(Math.PI / 2, 0, 0);
const envIntensity = 1;
const mirrorDim = 0.86;
const bumpStrength = 0.5;
const knitPitch = 1 / 0.0012;
const screenLift = 1.15;
const knitBump = 0.35;
const weavePitch = 1 / 0.0021;
const weaveDepth = 0.55;
const coatRoughness = 0.035;
const beadPitch = 1 / 0.011;
const beadShare = 0.3;
const beadSmall = 0.12;
const beadLarge = 0.3;
const beadGrey = 0.1;
const beadLift = 1.2;
const wetSheen = 0.7;
const screenWidth = 1024;
const screenHeight = 644;
const ledCount = 15;
const ledPitch = 0.00792;
const ledOutput = 1.6;
const brakeColour = new THREE.Color(1.5, 0.3, 0.02);
const atlasMaterials = new Set(["body", "cockpit", "helmet"]);
const carbonMaterials = new Set(["carbon-part", "wheel-carbon"]);
const shadedReflection: Record<string, number> = {
  "carbon-part": 0.2,
  "wheel-carbon": 0.22,
  "wheel-face": 0.18,
  "wheel-bezel": 0.3,
  "wheel-metal": 0.5,
  "wheel-rotary": 0.4,
  "btn-white": 0.35,
  "btn-yellow": 0.35,
  "btn-green": 0.35,
  "btn-blue": 0.35,
  "btn-red": 0.35,
  brake: 0.15,
  rim: 0.45,
  "rim-dark": 0.45,
  glove: 0.3,
  suit: 0.3,
  grip: 0.3,
  headrest: 0.25,
};
const satinParts = /^(wheel-carbon|btn-)/;
const satinRoughness = 0.68;
export const mirrorLayout = {
  "mirror-l": { across: 0.525, up: 0.684, width: 0.25, tall: 0.078 },
  "mirror-r": { across: -0.525, up: 0.684, width: 0.25, tall: 0.078 },
} as const;
export type MirrorName = keyof typeof mirrorLayout;

export interface CarEnvironment {
  texture: THREE.Texture;
  rotation: THREE.Euler;
}

function smoothPulse(x: number, centre: number, width: number): number {
  return Math.exp(-(((x - centre) / width) ** 2));
}

function environmentPixels(): Uint16Array {
  const pixels = new Uint16Array(envWidth * envHeight * 4);
  const half = (value: number) => THREE.DataUtils.toHalfFloat(value);
  for (let row = 0; row < envHeight; row++) {
    const up = 1 - (row + 0.5) / (envHeight / 2);
    for (let column = 0; column < envWidth; column++) {
      const around = (column / envWidth) * Math.PI * 2;
      const cloud =
        Math.sin(around * 3 + up * 7) * 0.5 +
        Math.sin(around * 7 - up * 11 + 1.3) * 0.3 +
        Math.sin(around * 13 + up * 19 + 2.1) * 0.2;
      const clouds = Math.max(0, cloud - 0.15) * 2.4;
      const sky = Math.max(up, 0);
      const wash = (1 - sky) ** 2.4;
      const cover = clouds * (1 - sky) * 0.55;
      let r = 0.26 + 0.34 * wash + cover;
      let g = 0.36 + 0.32 * wash + cover;
      let b = 0.58 + 0.25 * wash + cover;
      if (up < 0.1) {
        const stands =
          0.32 +
          0.22 * Math.sin(around * 29) ** 2 +
          0.65 * smoothPulse(up, 0.018, 0.012);
        const t = THREE.MathUtils.smoothstep(up, 0.02, 0.1);
        r = r * t + stands * (1 - t);
        g = g * t + stands * 0.96 * (1 - t);
        b = b * t + stands * 0.9 * (1 - t);
      }
      if (up < 0) {
        const ground = 0.13 + 0.1 * Math.exp(up * 6);
        const t = THREE.MathUtils.smoothstep(up, -0.03, 0);
        r = r * t + ground * 1.0 * (1 - t);
        g = g * t + ground * 1.0 * (1 - t);
        b = b * t + ground * 1.03 * (1 - t);
      }
      const at = (row * envWidth + column) * 4;
      pixels[at] = half(r);
      pixels[at + 1] = half(g);
      pixels[at + 2] = half(b);
      pixels[at + 3] = half(1);
    }
  }
  return pixels;
}

export function carEnvironment(renderer: THREE.WebGPURenderer): CarEnvironment {
  const source = new THREE.DataTexture(
    environmentPixels(),
    envWidth,
    envHeight,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.LinearSRGBColorSpace;
  source.magFilter = THREE.LinearFilter;
  source.minFilter = THREE.LinearFilter;
  source.flipY = true;
  source.needsUpdate = true;
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromEquirectangular(source);
  generator.dispose();
  return { texture: target.texture, rotation: studioEnvRotation };
}

export function useEnvironment(
  material: THREE.MeshStandardNodeMaterial,
  env: CarEnvironment,
  intensity: number,
): void {
  material.envMap = env.texture;
  material.envMapIntensity = intensity;
  material.envMapRotation = env.rotation;
}

export interface CarTextures {
  albedo: THREE.Texture;
  orm: THREE.Texture;
  bump: THREE.Texture;
  wheelFace: THREE.Texture;
  glove: THREE.Texture;
}

function loaded(url: string, sRgb: boolean, anisotropy: number): THREE.Texture {
  const map = releaseOnceUploaded(new THREE.TextureLoader().load(url));
  map.flipY = false;
  map.colorSpace = sRgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = anisotropy;
  return map;
}

function redChannel(
  image: CanvasImageSource & { width: number; height: number },
) {
  const { width, height } = image;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d canvas for the height map");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, width, height).data;
  const red = new Uint8Array(width * height);
  for (let i = 0; i < red.length; i++) red[i] = rgba[i * 4] ?? 0;
  return { data: red, width, height };
}

function heightMap(url: string, anisotropy: number): THREE.Texture {
  const map = new THREE.DataTexture(
    new Uint8Array(1),
    1,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  map.colorSpace = THREE.NoColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = anisotropy;
  const manager = THREE.DefaultLoadingManager;
  manager.itemStart(url);
  void new THREE.ImageLoader()
    .loadAsync(url)
    .then(
      (image) => {
        map.image = redChannel(image);
        map.needsUpdate = true;
      },
      () => {
        manager.itemError(url);
      },
    )
    .finally(() => {
      manager.itemEnd(url);
    });
  return releaseOnceUploaded(map);
}

export function carTextures(team: string, anisotropy: number): CarTextures {
  return {
    albedo: loaded(carFile(team, "albedo.jpg"), true, anisotropy),
    orm: loaded(carFile(team, "orm.jpg"), false, anisotropy),
    bump: heightMap(carFile(team, "bump.jpg"), anisotropy),
    wheelFace: loaded(carFile(team, "wheel-face.jpg"), true, anisotropy),
    glove: loaded(carFile(team, "glove.jpg"), true, anisotropy),
  };
}

function weave() {
  const n = abs(normalGeometry);
  const p = positionGeometry;
  const flat = step(max(n.x, n.z), n.y);
  const side = step(n.z, n.x);
  const coords = mix(mix(p.xy, p.zy, side), p.xz, flat).mul(weavePitch);
  const lane = floor(coords.x).add(floor(coords.y));
  const tow = fract(lane.mul(0.25));
  const warp = step(0.5, tow);
  const across = fract(coords.x).sub(0.5).abs();
  const along = fract(coords.y).sub(0.5).abs();
  const thread = mix(across, along, warp).mul(2);
  const shape = float(1).sub(thread.pow(2));
  const fade = float(1).sub(smoothstep(0.25, 0.7, fwidth(coords.x)));
  return mix(
    float(1),
    shape.mul(weaveDepth).add(float(1).sub(weaveDepth)),
    fade,
  ).mul(mix(float(1), mix(float(0.86), float(1.14), warp), fade));
}

export const carWetness = uniform(0);
const skyward = cameraViewMatrix.mul(vec4(0, 0, 1, 0)).xyz;

function beads() {
  const n = abs(normalGeometry);
  const p = positionGeometry;
  const flat = step(max(n.x, n.z), n.y);
  const side = step(n.z, n.x);
  const coords = mix(mix(p.xy, p.zy, side), p.xz, flat).mul(beadPitch);
  const cell = floor(coords);
  const seed = cell.x.mul(41.3).add(cell.y.mul(17.9));
  const present = step(hash(seed), float(beadShare));
  const centre = vec2(hash(seed.add(3.1)), hash(seed.add(5.7)))
    .mul(0.44)
    .add(0.28);
  const radius = mix(
    float(beadSmall),
    float(beadLarge),
    hash(seed.add(8.9)).pow(1.6),
  );
  const offset = fract(coords).sub(centre).div(radius);
  const reach = offset.dot(offset);
  const pixel = fwidth(coords);
  const fade = smoothstep(0.6, 1.4, radius.div(pixel.x.max(pixel.y)));
  const wet = carWetness.mul(fade);
  return smoothstep(1, 0.45, reach).mul(present).mul(wet);
}

function atlasMaterial(
  textures: CarTextures,
  env: CarEnvironment,
  name: string,
): THREE.MeshPhysicalNodeMaterial {
  const material = new THREE.MeshPhysicalNodeMaterial({ name });
  useEnvironment(material, env, envIntensity);
  const orm = texture(textures.orm, uv());
  const carbon = orm.b;
  const pattern = weave();
  const coat = float(1).sub(smoothstep(0.45, 0.6, orm.g));
  const water = beads();
  material.colorNode = texture(textures.albedo, uv())
    .rgb.mul(mix(float(1), pattern.mul(1.6), carbon))
    .max(water.mul(beadGrey));
  material.roughnessNode = mix(orm.g, orm.g.mul(wetSheen), carWetness);
  material.metalnessNode = float(0);
  material.aoNode = orm.r;
  material.clearcoatNode = coat.max(water);
  material.clearcoatRoughnessNode = float(coatRoughness);
  material.clearcoatNormalNode = normalViewGeometry
    .add(skyward.mul(water.mul(beadLift)))
    .normalize();
  material.normalNode = bumpMap(
    texture(textures.bump, uv()).r,
    float(bumpStrength),
  );
  return material;
}

function knit() {
  const p = positionGeometry.mul(knitPitch);
  const stitch = fract(p.x.add(p.y)).sub(0.5).abs().mul(2);
  const row = fract(p.z.sub(p.y)).sub(0.5).abs().mul(2);
  const fade = float(1).sub(smoothstep(0.3, 0.8, fwidth(p.x)));
  return mix(float(1), stitch.mul(row).mul(0.3).add(0.85), fade);
}

function copied(
  source: THREE.MeshStandardMaterial,
  env: CarEnvironment,
): THREE.MeshPhysicalNodeMaterial {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: source.name,
    color: source.color,
    roughness: source.roughness,
    metalness: source.metalness,
    side: source.side,
  });
  useEnvironment(material, env, envIntensity);
  material.emissive.copy(source.emissive);
  material.emissiveIntensity = source.emissiveIntensity;
  return material;
}

export interface DashReadout {
  kph: number;
  gear: number;
  rev: number;
  lap: number;
  lapTime: number;
  fuel: number;
  tyres: number[];
}

class WheelScreen {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private lastDraw = 0;

  constructor() {
    this.canvas.width = screenWidth;
    this.canvas.height = screenHeight;
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("no 2D canvas for the wheel screen");
    this.context = context;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw({
      kph: 0,
      gear: 0,
      rev: 0,
      lap: 1,
      lapTime: 0,
      fuel: 1,
      tyres: [0, 0, 0, 0],
    });
  }

  update(now: number, dash: DashReadout) {
    if (now - this.lastDraw < 1 / 15 && now >= this.lastDraw) return;
    this.lastDraw = now;
    this.draw(dash);
    this.texture.needsUpdate = true;
  }

  private label(
    text: string,
    x: number,
    y: number,
    font: string,
    fill: string,
  ) {
    const c = this.context;
    c.font = font;
    c.fillStyle = fill;
    c.fillText(text, x, y);
  }

  private outline(points: readonly (readonly [number, number])[]) {
    const c = this.context;
    c.strokeStyle = "#4b5560";
    c.lineWidth = 3;
    c.beginPath();
    points.forEach(([x, y], i) => {
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.closePath();
    c.stroke();
  }

  private battery(fraction: number) {
    const c = this.context;
    const left = 32;
    const right = screenWidth - 32;
    const top = 500;
    c.fillStyle = "#c5cf35";
    c.fillRect(left, top, right - left, 96);
    c.fillStyle = "#57c44a";
    c.fillRect(left, top, (right - left) * Math.min(fraction, 1), 34);
    c.fillStyle = "#0a0d11";
    c.fillRect(left, top + 34, right - left, 4);
    const text = `\u26A1${String(Math.round(fraction * 100))}%`;
    this.label(
      text,
      screenWidth / 2,
      top + 68,
      "500 34px Saira, sans-serif",
      "#14181d",
    );
  }

  private draw(dash: DashReadout): void {
    const c = this.context;
    const w = screenWidth;
    c.fillStyle = "#161b21";
    c.fillRect(0, 0, w, screenHeight);
    c.textAlign = "center";
    c.textBaseline = "middle";
    this.outline([
      [28, 150],
      [68, 40],
      [282, 40],
      [244, 150],
    ]);
    this.outline([
      [w - 282, 40],
      [w - 68, 40],
      [w - 28, 150],
      [w - 244, 150],
    ]);
    this.outline([
      [28, 330],
      [228, 330],
      [228, 470],
      [28, 470],
    ]);
    this.outline([
      [w - 228, 330],
      [w - 28, 330],
      [w - 28, 470],
      [w - 228, 470],
    ]);
    const white = "#eef1f4";
    const dim = "#98a3ad";
    const value = "500 62px Saira, sans-serif";
    const small = "500 28px Saira, sans-serif";
    this.label(String(Math.round(Math.abs(dash.kph))), 158, 82, value, white);
    this.label("KPH", 158, 124, small, dim);
    this.label(`L${String(Math.max(dash.lap, 1))}`, w - 158, 82, value, white);
    this.label("LAP", w - 158, 124, small, dim);
    const time = "500 54px Saira, sans-serif";
    this.label(dash.lapTime.toFixed(3), w / 2, 84, time, white);
    const gear =
      dash.gear <= 0 ? (dash.gear === 0 ? "N" : "R") : String(dash.gear);
    this.label(gear, w / 2, 262, "600 158px Saira, sans-serif", white);
    const temps = "500 44px Saira, sans-serif";
    const temp = (i: number) =>
      `${String(Math.round(dash.tyres[i] ?? 0))}\u00B0C`;
    const green = "#a7e9b5";
    this.label(temp(0), 128, 368, temps, green);
    this.label(temp(2), 128, 430, temps, green);
    this.label(temp(1), w - 128, 368, temps, green);
    this.label(temp(3), w - 128, 430, temps, green);
    c.fillStyle = "#2a1518";
    c.fillRect(252, 400, w - 504, 46);
    c.fillStyle = dash.rev > 0.93 ? "#e4322a" : "#7d1f25";
    c.fillRect(252, 400, (w - 504) * Math.min(dash.rev, 1), 46);
    this.battery(dash.fuel);
  }
}

function mirrorMaterial(view: THREE.Texture, name: MirrorName): THREE.Material {
  const layout = mirrorLayout[name];
  const material = new THREE.MeshBasicNodeMaterial();
  const across = positionGeometry.x.sub(layout.across).div(layout.width);
  const up = positionGeometry.y.sub(layout.up).div(layout.tall);
  const sample = vec2(across.add(0.5), float(0.5).sub(up));
  material.colorNode = texture(view, sample).rgb.mul(mirrorDim);
  return material;
}

export interface CarMaterials {
  build(source: THREE.MeshStandardMaterial): THREE.Material;
  screen: WheelScreen;
  rev: { value: number };
  heat: { value: number };
}

const rev = uniform(0);
const brakeHeat = uniform(0);
export const rainLight = uniform(0);
const rainLightColour = new THREE.Color(9, 0.25, 0.12);

function brakeGlow(physical: THREE.MeshPhysicalNodeMaterial): void {
  physical.emissiveNode = color(brakeColour).mul(brakeHeat);
}

function flatMaterial(paint: (material: THREE.MeshBasicNodeMaterial) => void) {
  const material = new THREE.MeshBasicNodeMaterial();
  paint(material);
  return material;
}

function ledGlow(physical: THREE.MeshPhysicalNodeMaterial): void {
  const index = positionGeometry.x
    .negate()
    .div(ledPitch)
    .add((ledCount - 1) / 2)
    .add(0.5);
  const lit = step(index, rev.mul(ledCount));
  physical.roughness = 0.9;
  physical.envMapIntensity = 0;
  physical.color.multiplyScalar(0.12);
  physical.emissiveNode = color(physical.emissive)
    .mul(ledOutput)
    .mul(mix(float(0.015), float(1), lit));
}

function texturedPart(
  physical: THREE.MeshPhysicalNodeMaterial,
  textures: CarTextures,
): void {
  if (physical.name === "glove") {
    const fabric = knit();
    physical.colorNode = texture(textures.glove, uv()).rgb.mul(fabric);
    physical.normalNode = bumpMap(fabric, float(knitBump));
    physical.roughness = 0.98;
  }
  if (physical.name === "wheel-face") {
    const face = texture(textures.wheelFace, uv()).rgb;
    const bare = float(1).sub(smoothstep(0.02, 0.06, luminance(face)));
    physical.colorNode = face.mul(mix(float(1), weave().mul(1.15), bare));
    physical.roughness = 0.82;
  }
}

function partMaterial(
  source: THREE.MeshStandardMaterial,
  textures: CarTextures,
  env: CarEnvironment,
): THREE.Material {
  const physical = copied(source, env);
  const name = source.name;
  physical.envMapIntensity *= shadedReflection[name] ?? 1;
  if (name === "brake") brakeGlow(physical);
  texturedPart(physical, textures);
  if (carbonMaterials.has(name))
    physical.colorNode = color(physical.color).mul(weave().mul(1.6));
  if (name === "carbon-part") {
    physical.clearcoat = 1;
    physical.clearcoatRoughness = coatRoughness;
  }
  if (satinParts.test(name)) physical.roughness = satinRoughness;
  if (name.startsWith("led-") && name !== "led-red") ledGlow(physical);
  if (name === "led-red")
    physical.emissiveNode = color(rainLightColour).mul(rainLight);
  return physical;
}

export function carMaterials(
  textures: CarTextures,
  env: CarEnvironment,
  views: Record<MirrorName, THREE.Texture>,
): CarMaterials {
  const made = new Map<string, THREE.Material>();
  const screen = new WheelScreen();
  const special: Record<string, () => THREE.Material> = {
    void: () =>
      flatMaterial((material) => {
        material.color.setRGB(0.004, 0.004, 0.005);
      }),
    "wheel-screen": () =>
      flatMaterial((material) => {
        material.colorNode = texture(screen.texture, uv()).rgb.mul(screenLift);
      }),
    "mirror-l": () => mirrorMaterial(views["mirror-l"], "mirror-l"),
    "mirror-r": () => mirrorMaterial(views["mirror-r"], "mirror-r"),
  };
  const create = (source: THREE.MeshStandardMaterial): THREE.Material => {
    if (atlasMaterials.has(source.name))
      return atlasMaterial(textures, env, source.name);
    return special[source.name]?.() ?? partMaterial(source, textures, env);
  };
  const build = (source: THREE.MeshStandardMaterial): THREE.Material => {
    const material = made.get(source.name) ?? create(source);
    made.set(source.name, material);
    return material;
  };
  return { build, screen, rev, heat: brakeHeat };
}

import * as THREE from "three/webgpu";
import { mix, normalWorld, uniform } from "three/tsl";

const rowStep = 4;
const columnStep = 8;
const channels = 4;
const irradianceUp = uniform(new THREE.Color());
const irradianceDown = uniform(new THREE.Color());
const clearUp = new THREE.Color();
const clearDown = new THREE.Color();
const overcastUp = new THREE.Color();
const overcastTint = new THREE.Color(0.93, 0.96, 1.0);
const overcastBounce = 0.15;
const overcastSpread = 0.78;
const floodUp = uniform(new THREE.Color());
const floodDown = uniform(new THREE.Color());
const flood: { cover: THREE.Node<"float"> | null } = { cover: null };

class SkyAmbient extends THREE.LightingNode {
  override setup(builder: THREE.NodeBuilder): undefined {
    const context = builder.context as {
      iblIrradiance: THREE.Node<"vec3">;
    };
    const facing = normalWorld.z.mul(0.5).add(0.5);
    const sky = mix(irradianceDown, irradianceUp, facing);
    context.iblIrradiance.addAssign(
      flood.cover
        ? sky.add(mix(floodDown, floodUp, facing).mul(flood.cover))
        : sky,
    );
    return undefined;
  }
}

export class SkyLitMaterial extends THREE.MeshStandardNodeMaterial {
  override setupEnvironment(): THREE.EnvironmentNode {
    return new SkyAmbient() as unknown as THREE.EnvironmentNode;
  }
}

function addRow(
  target: THREE.Color,
  data: Uint16Array,
  row: number,
  width: number,
  weight: number,
): void {
  const half = (value: number | undefined) =>
    THREE.DataUtils.fromHalfFloat(value ?? 0);
  for (let column = 0; column < width; column += columnStep) {
    const at = (row * width + column) * channels;
    target.r += half(data[at]) * weight;
    target.g += half(data[at + 1]) * weight;
    target.b += half(data[at + 2]) * weight;
  }
}

export function skyIrradiance(): { up: THREE.Color; down: THREE.Color } {
  return { up: irradianceUp.value, down: irradianceDown.value };
}

export function fitSkyAmbient(
  environment: THREE.Texture,
  grade: THREE.Vector3,
): void {
  const { data, width, height } = environment.image as {
    data: Uint16Array;
    width: number;
    height: number;
  };
  irradianceUp.value.setRGB(0, 0, 0);
  irradianceDown.value.setRGB(0, 0, 0);
  const cell =
    ((Math.PI / height) * rowStep * (2 * Math.PI * columnStep)) / width;
  for (let row = 0; row < height; row += rowStep) {
    const angle = ((row + 0.5) / height) * Math.PI;
    const facing = Math.cos(angle) * Math.sin(angle) * cell;
    addRow(
      facing > 0 ? irradianceUp.value : irradianceDown.value,
      data,
      row,
      width,
      Math.abs(facing),
    );
  }
  const tint = new THREE.Color(grade.x, grade.y, grade.z);
  irradianceUp.value.multiply(tint);
  irradianceDown.value.multiply(tint);
  clearUp.copy(irradianceUp.value);
  clearDown.copy(irradianceDown.value);
}

export function setAmbientOvercast(amount: number, level: number): void {
  overcastUp
    .copy(overcastTint)
    .multiplyScalar(Math.PI * overcastSpread * level);
  irradianceUp.value.copy(clearUp).lerp(overcastUp, amount);
  irradianceDown.value
    .copy(clearDown)
    .lerp(overcastUp.multiplyScalar(overcastBounce), amount);
}

export function useNightAmbient(up: THREE.Color, down: THREE.Color): void {
  clearUp.copy(up);
  clearDown.copy(down);
  irradianceUp.value.copy(up);
  irradianceDown.value.copy(down);
}

export function useFloodAmbient(
  cover: THREE.Node<"float">,
  up: THREE.Color,
  down: THREE.Color,
): void {
  flood.cover = cover;
  floodUp.value.copy(up);
  floodDown.value.copy(down);
}

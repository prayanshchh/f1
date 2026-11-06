import * as THREE from "three/webgpu";
import { mix, normalWorld, uniform } from "three/tsl";

const rowStep = 4;
const columnStep = 8;
const channels = 4;
const irradianceUp = uniform(new THREE.Color());
const irradianceDown = uniform(new THREE.Color());

class SkyAmbient extends THREE.LightingNode {
  override setup(builder: THREE.NodeBuilder): undefined {
    const context = builder.context as {
      iblIrradiance: THREE.Node<"vec3">;
    };
    context.iblIrradiance.addAssign(
      mix(irradianceDown, irradianceUp, normalWorld.z.mul(0.5).add(0.5)),
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

export function fitSkyAmbient(environment: THREE.Texture): void {
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
}

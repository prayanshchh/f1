import * as THREE from "three/webgpu";
import { cos, float, sin, texture, time, uv, vec2 } from "three/tsl";

const canvasWidth = 2400;
const canvasHeight = 1600;
const zoom = 0.72;

async function flagTexture(url: string): Promise<THREE.CanvasTexture> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvasWidth, canvasHeight);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.NoColorSpace;
  map.flipY = false;
  map.generateMipmaps = false;
  map.minFilter = THREE.LinearFilter;
  return map;
}

export class WavingFlag {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private constructor(private readonly map: THREE.Texture) {
    const material = new THREE.MeshBasicNodeMaterial();
    const at = vec2(uv().x, float(1).sub(uv().y));
    const phaseA = at.x.mul(5.6).sub(time.mul(1.25)).add(at.y.mul(2.1));
    const phaseB = at.x.mul(11.5).sub(time.mul(1.9)).add(at.y.mul(3.7));
    const offset = sin(phaseA).mul(0.022).add(sin(phaseB).mul(0.007));
    const shade = cos(phaseA).mul(0.2).add(cos(phaseB).mul(0.08)).add(0.96);
    const lookup = vec2(
      at.x.mul(zoom).add(sin(phaseA).mul(0.01)),
      at.y.mul(zoom).add(offset),
    );
    material.colorNode = texture(map, lookup).rgb.mul(shade);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  static async load(url: string): Promise<WavingFlag> {
    return new WavingFlag(await flagTexture(url));
  }

  dispose(): void {
    this.map.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      (object.geometry as THREE.BufferGeometry).dispose();
      (object.material as THREE.Material).dispose();
    });
  }
}

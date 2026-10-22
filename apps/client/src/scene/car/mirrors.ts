import {
  HalfFloatType,
  Mesh,
  MeshBasicNodeMaterial,
  NodeUpdateType,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  TextureNode,
  type Object3D,
} from "three/webgpu";
import type NodeFrame from "three/src/nodes/core/NodeFrame.js";
import { oneMinus, uv, vec2 } from "three/tsl";
import type { Tier } from "../protocol.ts";

export const MIRROR_GLASS = {
  x: 0.42,
  y: 0.63,
  z: 0.718,
  width: 0.12,
  height: 0.05,
} as const;
const MIRROR_YAW = 0.2;
const MIRROR_REFLECTANCE = 0.85;
let rendering = false;

class RearViewTexture extends TextureNode {
  constructor(
    private readonly target: RenderTarget,
    private readonly eye: PerspectiveCamera,
    private readonly glass: Mesh[],
  ) {
    super(target.texture, vec2(oneMinus(uv().x), uv().y));
    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  override updateBefore(frame: NodeFrame): undefined {
    const { renderer, scene } = frame;
    if (renderer === null || scene === null || rendering) {
      return;
    }
    rendering = true;
    const visibility = this.glass.map((mesh) => mesh.visible);
    const target = renderer.getRenderTarget();
    const mrt = renderer.getMRT();
    try {
      for (const mesh of this.glass) mesh.visible = false;
      renderer.setMRT(null);
      renderer.setRenderTarget(this.target);
      renderer.render(scene, this.eye);
    } finally {
      renderer.setRenderTarget(target);
      renderer.setMRT(mrt);
      this.glass.forEach((mesh, index) => {
        mesh.visible = visibility[index] ?? true;
      });
      rendering = false;
    }
  }
}

export function createMirrors(root: Object3D, tier: Tier): Mesh[] {
  const glass: Mesh[] = [];
  const width = tier === "ultra" || tier === "high" ? 256 : 128;
  for (const side of [1, -1]) {
    const target = new RenderTarget(width, Math.round(width / 2.4), {
      type: HalfFloatType,
    });
    const eye = new PerspectiveCamera(20, 2.4, 0.05, 400);
    eye.position.set(side * MIRROR_GLASS.x, MIRROR_GLASS.y, MIRROR_GLASS.z);
    eye.rotation.y = -side * MIRROR_YAW;
    const material = new MeshBasicNodeMaterial({ name: "mirror" });
    material.colorNode = new RearViewTexture(target, eye, glass).mul(
      MIRROR_REFLECTANCE,
    );
    const mesh = new Mesh(
      new PlaneGeometry(MIRROR_GLASS.width, MIRROR_GLASS.height),
      material,
    );
    mesh.position.copy(eye.position);
    mesh.rotation.y = Math.PI;
    mesh.name = side > 0 ? "mirror-left" : "mirror-right";
    glass.push(mesh);
    root.add(eye, mesh);
  }
  return glass;
}

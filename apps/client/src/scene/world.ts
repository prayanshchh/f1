import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  BoxGeometry,
} from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import placeholderUrl from "./placeholder.glb?url";
import type { Camera, Tier } from "./protocol.ts";

export function placeCamera(camera: PerspectiveCamera, view: Camera): void {
  switch (view) {
    case "chase":
      camera.position.set(5, 3.4, -7);
      camera.lookAt(0, 0.45, 0);
      break;
    case "cockpit":
      camera.position.set(0, 1.05, -0.1);
      camera.lookAt(0, 0.65, 14);
      break;
    case "tv":
      camera.position.set(-8, 4.5, 5);
      camera.lookAt(0, 0.4, 0);
      break;
  }
  camera.updateMatrixWorld();
}

function circuit(scene: Scene, tier: Tier): void {
  const grass = new Mesh(
    new PlaneGeometry(400, 400),
    new MeshStandardMaterial({ color: 0x335a48, roughness: 1 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  scene.add(grass);
  const asphalt = new Mesh(
    new PlaneGeometry(9, 240),
    new MeshStandardMaterial({ color: 0x34404b, roughness: 0.92 }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  scene.add(asphalt);
  const white = new MeshStandardMaterial({ color: 0xe6e3d4, roughness: 0.8 });
  const red = new MeshStandardMaterial({ color: 0xb82e38, roughness: 0.65 });
  const geometry = new BoxGeometry(0.6, 0.08, 3);
  const count = tier === "basic" || tier === "low" ? 24 : 48;
  for (let index = 0; index < count; index += 1) {
    for (const side of [-1, 1]) {
      const curb = new Mesh(geometry, index % 2 === 0 ? white : red);
      curb.position.set(side * 4.7, 0, index * 3 - 24);
      scene.add(curb);
    }
  }
  const gantryMaterial = new MeshStandardMaterial({
    color: 0x248a91,
    metalness: 0.5,
    roughness: 0.35,
  });
  for (const x of [-5.4, 5.4]) {
    const post = new Mesh(new BoxGeometry(0.25, 6, 0.25), gantryMaterial);
    post.position.set(x, 3, 24);
    scene.add(post);
  }
  const bridge = new Mesh(new BoxGeometry(11, 0.8, 0.4), gantryMaterial);
  bridge.position.set(0, 5.7, 24);
  scene.add(bridge);
}

export async function loadScene(
  tier: Tier,
): Promise<{ scene: Scene; camera: PerspectiveCamera; meshes: number }> {
  const scene = new Scene();
  scene.background = new Color(0x7698b6);
  scene.add(new HemisphereLight(0xd6ecff, 0x35412b, 2.4));
  const sun = new DirectionalLight(0xffe5bd, 4);
  sun.position.set(-3, 8, -4);
  scene.add(sun);
  const rim = new DirectionalLight(0x92cfff, 2);
  rim.position.set(4, 2, 3);
  scene.add(rim);
  circuit(scene, tier);
  const model = await new GLTFLoader().loadAsync(placeholderUrl);
  model.scene.name = "car";
  scene.add(model.scene);
  let meshes = 0;
  scene.traverse((object) => {
    if (object instanceof Mesh) {
      meshes += 1;
    }
  });
  const camera = new PerspectiveCamera(52, 1, 0.05, 500);
  placeCamera(camera, "chase");
  return { scene, camera, meshes };
}

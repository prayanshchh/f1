import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CarEnvironment } from "./carpaint.ts";
import { gltfToSdWorld } from "./gltf.ts";
import { mergedMesh, placedCopy } from "./merge.ts";
import { releaseOnceUploaded } from "./preload.ts";
import { surface } from "./road.ts";
import { carFile } from "./teams.ts";
import {
  treadPattern,
  type TyreLook,
  tyreAttribute,
  tyreLook,
  tyreMaterial,
} from "./tyre-paint.ts";
import { compounds } from "./tyres.ts";

const dark = 0x14161c;
const steel = 0x8d9199;
const rimDark = 0x1b1c20;
const tyreRadius = 0.36;
const tyreHalf = 0.17;
const rimRadius = 0.232;
const tyreSegments = 72;
const tyreProfile = [
  [0.232, -0.148],
  [0.27, -0.163],
  [0.31, -0.168],
  [0.338, -0.165],
  [0.352, -0.155],
  [0.359, -0.138],
  [0.361, -0.11],
  [0.361, 0.11],
  [0.359, 0.138],
  [0.352, 0.155],
  [0.338, 0.165],
  [0.31, 0.168],
  [0.27, 0.163],
  [0.232, 0.148],
] as const;
const kitMaterials = new Set(["crew suit", "crew shell"]);
const wheelX = [1.49, 1.49, -2.01, -2.01];
const wheelY = [-0.74, 0.74, -0.74, 0.74];
const reachIn = 0.1;
const gunsOff = 0.3;
const tyresOff = 0.42;
const tyresOn = 0.62;
const jackDown = 0.88;
const liftHeight = 0.1;
const moveTime = 0.26;
const animatedRange = 400;
const bakedAttributes = ["position", "normal", "uv"] as const;
const runCycle = 0.55;
const kneelStart = 0.25;
const kneelEnd = 0.75;
const jackHeight = 0.2;
const faceWheel = Math.PI / 2;
const memberCentre = new THREE.Vector3(0, 0, 1);
const memberReach = 2.5;

const flat = (colour: number, roughness = 0.65) => {
  const material = new THREE.MeshStandardNodeMaterial({
    color: colour,
    roughness,
  });
  return material;
};

interface Spot {
  x: number;
  y: number;
}

type Role =
  | "gunner"
  | "tyre_off"
  | "tyre_on"
  | "jack_front"
  | "jack_rear"
  | "stabilise"
  | "signal";

interface Member {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  role: Role;
  rest: Spot;
  active: Spot;
  from: number;
  to: number;
  face: number;
  handLeft: THREE.Object3D;
  handRight: THREE.Object3D;
  engaged: number;
  phase: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ramp = (value: number, from: number, to: number) =>
  Math.min(1, Math.max(0, (value - from) / (to - from)));
const smooth = (t: number) => t * t * (3 - 2 * t);

function shareSkeleton(meshes: THREE.SkinnedMesh[]): void {
  const [first, ...rest] = meshes;
  if (!first) return;
  const { bones, boneInverses } = first.skeleton;
  for (const mesh of rest) {
    const other = mesh.skeleton;
    const same =
      other.bones.length === bones.length &&
      other.bones.every((bone, i) => bone === bones[i]) &&
      other.boneInverses.every((inverse, i) =>
        inverse.equals(boneInverses[i] ?? inverse),
      );
    if (same) mesh.bind(first.skeleton, mesh.bindMatrix);
  }
}

function memberBounds(mesh: THREE.Mesh): THREE.Sphere {
  const toMesh = mesh.matrixWorld.clone().invert();
  return new THREE.Sphere(
    memberCentre.clone().applyMatrix4(toMesh),
    memberReach / mesh.matrixWorld.getMaxScaleOnAxis(),
  );
}

function tyreGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(
    tyreProfile.map(([radius, axial]) => new THREE.Vector2(radius, axial)),
    tyreSegments,
  );
  const position = geometry.getAttribute("position");
  const local = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    local[i * 4] = position.getY(i);
    local[i * 4 + 1] = position.getX(i);
    local[i * 4 + 2] = position.getZ(i);
    local[i * 4 + 3] = tyreHalf;
  }
  geometry.setAttribute(tyreAttribute, new THREE.BufferAttribute(local, 4));
  return geometry;
}

function makeTyre(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  look: TyreLook,
): THREE.Group {
  const tyre = new THREE.Group();
  const rubber = new THREE.Mesh(geometry, material);
  tyre.userData = rubber.userData = { tyre: look };
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(rimRadius, rimRadius, tyreHalf * 1.8, 32),
    flat(rimDark, 0.35),
  );
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, tyreHalf * 2.1, 12),
    flat(steel, 0.35),
  );
  tyre.add(rubber, rim, hub);
  tyre.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  return tyre;
}

export class PitCrew {
  readonly root = new THREE.Group();
  private readonly live = new THREE.Group();
  private readonly far = new THREE.Group();
  private readonly members: Member[] = [];
  private readonly wheels: {
    x: number;
    y: number;
    old: THREE.Group;
    fresh: THREE.Group;
    off: Member;
    on: Member;
  }[] = [];
  private readonly levers: { member: Member; end: Spot; mesh: THREE.Mesh }[] =
    [];
  private readonly fitted = tyreLook();
  private readonly fresh = tyreLook();
  private lastTime = 0;
  private pending: { progress: number; active: boolean } | null = null;
  private readonly anchor = new THREE.Matrix4();
  private readonly target = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();

  static async load(
    url: string,
    anisotropy: number,
    env: CarEnvironment,
    team: string,
  ): Promise<PitCrew> {
    const [gltf, kit] = await Promise.all([
      new GLTFLoader().loadAsync(url),
      new THREE.TextureLoader().loadAsync(carFile(team, "crew.jpg")),
    ]);
    kit.flipY = false;
    kit.colorSpace = THREE.SRGBColorSpace;
    kit.anisotropy = anisotropy;
    releaseOnceUploaded(kit);
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = object.material as THREE.MeshStandardMaterial;
      if (kitMaterials.has(source.name)) source.map = kit;
      object.material = surface(source, anisotropy);
    });
    return new PitCrew(
      gltf.scene,
      gltf.animations,
      tyreMaterial(env, anisotropy),
    );
  }

  private constructor(
    private readonly model: THREE.Object3D,
    private readonly clips: THREE.AnimationClip[],
    rubber: THREE.Material,
  ) {
    this.root.matrixAutoUpdate = false;
    this.root.add(this.live, this.far);
    const tyreShape = tyreGeometry();
    wheelX.forEach((x, i) => {
      const y = wheelY[i] ?? 0;
      const side = Math.sign(y);
      const face = side > 0 ? 0 : Math.PI;
      const gunner = this.addMember("gunner", face, 0, 1, {
        rest: { x, y: y + side * 2.3 },
        active: { x, y: y + side * 0.72 },
      });
      this.attachGun(gunner);
      const off = this.addMember("tyre_off", face, 0, tyresOn, {
        rest: { x: x + 0.9, y: y + side * 2.1 },
        active: { x: x + 0.12, y: y + side * 0.92 },
      });
      const on = this.addMember("tyre_on", face, tyresOff, 1, {
        rest: { x: x - 0.9, y: y + side * 2.1 },
        active: { x: x - 0.12, y: y + side * 0.92 },
      });
      const old = makeTyre(tyreShape, rubber, this.fitted);
      const fresh = makeTyre(tyreShape, rubber, this.fresh);
      old.visible = fresh.visible = false;
      this.live.add(old, fresh);
      this.wheels.push({ x, y: y + side * 0.04, old, fresh, off, on });
    });
    const front = this.addMember("jack_front", -faceWheel, 0, 1, {
      rest: { x: 5.2, y: 0.8 },
      active: { x: 4.05, y: 0 },
    });
    const rear = this.addMember("jack_rear", faceWheel, 0, 1, {
      rest: { x: -4.4, y: 2.8 },
      active: { x: -3.75, y: 0 },
    });
    this.addLever(front, { x: 2.6, y: 0 });
    this.addLever(rear, { x: -2.6, y: 0 });
    for (const side of [-1, 1])
      this.addMember("stabilise", side > 0 ? 0 : Math.PI, 0, 1, {
        rest: { x: -0.2, y: side * 3 },
        active: { x: -0.2, y: side * 1.35 },
      });
    const signaller = this.addMember("signal", -faceWheel, 0, 1, {
      rest: { x: 5, y: 1.9 },
      active: { x: 5, y: 1.9 },
    });
    this.attachPole(signaller);
    this.root.visible = false;
  }

  private addMember(
    role: Role,
    face: number,
    from: number,
    to: number,
    place: { rest: Spot; active: Spot },
  ): Member {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.matrixAutoUpdate = false;
    inner.matrix.copy(gltfToSdWorld);
    const body = cloneRig(this.model);
    const skinned: THREE.SkinnedMesh[] = [];
    body.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
      if (object instanceof THREE.SkinnedMesh)
        skinned.push(object as THREE.SkinnedMesh);
    });
    inner.add(body);
    root.add(inner);
    root.updateMatrixWorld(true);
    shareSkeleton(skinned);
    for (const mesh of skinned) mesh.boundingSphere = memberBounds(mesh);
    this.live.add(root);
    const mixer = new THREE.AnimationMixer(body);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of this.clips) {
      const action = mixer.clipAction(clip);
      action.play();
      action.paused = true;
      action.setEffectiveWeight(0);
      actions.set(clip.name, action);
    }
    const handLeft = body.getObjectByName("hand_l");
    const handRight = body.getObjectByName("hand_r");
    if (!handLeft || !handRight) throw new Error("crew rig has no hands");
    const member: Member = {
      root,
      mixer,
      actions,
      role,
      rest: place.rest,
      active: place.active,
      from,
      to,
      face,
      handLeft,
      handRight,
      engaged: 0,
      phase: Math.random(),
    };
    this.members.push(member);
    return member;
  }

  private attachGun(member: Member): void {
    const gun = new THREE.Group();
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.03, 0.3, 10),
      flat(steel, 0.35),
    );
    barrel.position.y = 0.08;
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.2, 0.09),
      flat(dark),
    );
    grip.position.set(0, -0.06, 0.05);
    gun.add(barrel, grip);
    member.handRight.add(gun);
  }

  private attachPole(member: Member): void {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 2.3, 8),
      flat(steel, 0.35),
    );
    pole.position.y = 0.7;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.3, 0.03),
      flat(0xe8c21a, 0.5),
    );
    board.position.y = 1.85;
    member.handRight.add(pole, board);
  }

  private addLever(member: Member, end: Spot): void {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 1, 8),
      flat(0xb9bdc4, 0.4),
    );
    mesh.castShadow = true;
    this.live.add(mesh);
    this.levers.push({ member, end, mesh });
  }

  setCompounds(fitted: number, fresh: number, wear: number): void {
    this.fitted.compound.set((compounds[fitted] ?? compounds[1]).colour);
    this.fitted.pattern = treadPattern(fitted);
    this.fitted.wear = wear;
    this.fresh.compound.set((compounds[fresh] ?? compounds[1]).colour);
    this.fresh.pattern = treadPattern(fresh);
  }

  setAnchor(x: number, y: number, z: number, heading: number): void {
    this.anchor.makeRotationZ(heading).setPosition(x, y, z);
  }

  private roleTime(member: Member, progress: number): number {
    if (member.role === "tyre_off") return ramp(progress, gunsOff, tyresOn);
    if (member.role === "tyre_on") return ramp(progress, tyresOff, tyresOn);
    if (member.role === "jack_front" || member.role === "jack_rear")
      return progress < jackDown
        ? ramp(progress, 0, reachIn)
        : 1 - ramp(progress, jackDown, 1);
    if (member.role === "gunner") return mix(kneelStart, kneelEnd, progress);
    return (progress * 2) % 1;
  }

  private advanceMember(
    member: Member,
    progress: number,
    active: boolean,
    delta: number,
  ): void {
    const inside = active && progress >= member.from && progress <= member.to;
    const wanted = inside ? 1 : 0;
    const change = Math.min(
      Math.abs(wanted - member.engaged),
      delta / moveTime,
    );
    member.engaged += Math.sign(wanted - member.engaged) * change;
    member.phase = (member.phase + delta / runCycle) % 1;
  }

  private poseMember(member: Member, progress: number): void {
    const e = smooth(member.engaged);
    member.root.position.set(
      mix(member.rest.x, member.active.x, e),
      mix(member.rest.y, member.active.y, e),
      0,
    );
    member.root.rotation.z = member.face;
    const moving = 4 * e * (1 - e);
    const set = (name: string, weight: number, time: number) => {
      const action = member.actions.get(name);
      if (!action) return;
      action.setEffectiveWeight(weight);
      action.time = time * action.getClip().duration;
    };
    for (const name of member.actions.keys()) set(name, 0, 0);
    set("ready", (1 - e) * (1 - moving), member.phase);
    set("run", moving, member.phase);
    set(member.role, e * (1 - moving), this.roleTime(member, progress));
    member.mixer.update(0);
  }

  private handsMiddle(member: Member): THREE.Vector3 {
    member.root.updateMatrixWorld(true);
    member.handLeft.getWorldPosition(this.left);
    member.handRight.getWorldPosition(this.right);
    return this.left
      .add(this.right)
      .multiplyScalar(0.5)
      .applyMatrix4(this.inverse);
  }

  private poseTyres(progress: number, active: boolean): void {
    for (const wheel of this.wheels) {
      wheel.old.visible = active && progress > gunsOff;
      if (wheel.old.visible) {
        const position =
          progress > tyresOff
            ? this.handsMiddle(wheel.off)
            : this.target.set(wheel.x, wheel.y, tyreRadius);
        wheel.old.position.copy(position);
      }
      wheel.fresh.visible = !active || progress < tyresOn;
      if (wheel.fresh.visible)
        wheel.fresh.position.copy(this.handsMiddle(wheel.on));
    }
  }

  private poseLevers(): void {
    for (const { member, end, mesh } of this.levers) {
      const from = this.handsMiddle(member).clone();
      const to = new THREE.Vector3(end.x, end.y, jackHeight);
      const length = from.distanceTo(to);
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.scale.set(1, length, 1);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        to.sub(from).normalize(),
      );
      mesh.visible = member.engaged > 0.8;
    }
  }

  private advance(
    progress: number,
    active: boolean,
    carMatrix: THREE.Matrix4 | null,
    delta: number,
  ): void {
    this.root.matrix.copy(carMatrix ?? this.anchor);
    this.root.matrixWorldNeedsUpdate = true;
    for (const member of this.members)
      this.advanceMember(member, progress, active, delta);
    this.pending = { progress, active };
  }

  prepare(): void {
    if (!this.pending) return;
    const { progress, active } = this.pending;
    this.pending = null;
    this.root.updateMatrixWorld(true);
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const member of this.members) this.poseMember(member, progress);
    this.poseTyres(progress, active);
    this.poseLevers();
  }

  private bakedPart(mesh: THREE.Mesh): THREE.BufferGeometry {
    const toRoot = new THREE.Matrix4().multiplyMatrices(
      this.inverse,
      mesh.matrixWorld,
    );
    const part = placedCopy(
      mesh.geometry,
      new THREE.Matrix4(),
      bakedAttributes,
    );
    if (mesh instanceof THREE.SkinnedMesh) {
      const position = part.getAttribute("position");
      const point = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        mesh.applyBoneTransform(i, point.fromBufferAttribute(position, i));
        position.setXYZ(i, point.x, point.y, point.z);
      }
    }
    part.applyMatrix4(toRoot);
    part.computeVertexNormals();
    return part;
  }

  bake(): void {
    this.advance(0, false, null, 0);
    this.prepare();
    this.live.updateMatrixWorld(true);
    const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (object: THREE.Object3D) => {
      if (!object.visible || (object.userData as { tyre?: TyreLook }).tyre)
        return;
      if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
      if (object instanceof THREE.Mesh) {
        const material = object.material as THREE.Material;
        groups.set(material, [
          ...(groups.get(material) ?? []),
          this.bakedPart(object as THREE.Mesh),
        ]);
      }
      object.children.forEach(add);
    };
    add(this.live);
    for (const [material, parts] of groups) {
      const mesh = mergedMesh(parts, material);
      mesh.castShadow = true;
      this.far.add(mesh);
    }
  }

  update(
    progress: number,
    active: boolean,
    carMatrix: THREE.Matrix4 | null,
    eye: THREE.Vector3,
    now: number,
  ): { lift: number; wheelsOff: boolean } {
    this.target.setFromMatrixPosition(this.anchor);
    const near = this.target.distanceTo(eye) <= animatedRange;
    this.live.visible = near;
    this.far.visible = !near;
    if (!near) {
      this.root.matrix.copy(this.anchor);
      this.pending = null;
      return { lift: 0, wheelsOff: false };
    }
    const delta = Math.min(0.1, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    this.advance(progress, active, carMatrix, delta);
    const jacked = active && progress > reachIn && progress < jackDown;
    return {
      lift: jacked ? liftHeight : 0,
      wheelsOff: active && progress > gunsOff && progress <= tyresOn,
    };
  }
}

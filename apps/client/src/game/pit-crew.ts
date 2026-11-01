import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { gltfToSdWorld } from "./gltf.ts";
import { finish, surface } from "./road.ts";

const dark = 0x14161c;
const steel = 0x8d9199;
const rimRed = 0xc01818;
const tyreRadius = 0.36;
const tyreWidth = 0.34;
const wheelX = [1.49, 1.49, -2.01, -2.01];
const wheelY = [-0.74, 0.74, -0.74, 0.74];
const reachIn = 0.1;
const gunsOff = 0.3;
const tyresOff = 0.42;
const tyresOn = 0.62;
const jackDown = 0.88;
const liftHeight = 0.1;
const moveTime = 0.26;
const visibleRange = 180;
const runCycle = 0.55;
const kneelStart = 0.25;
const kneelEnd = 0.75;
const jackHeight = 0.2;
const faceWheel = Math.PI / 2;

const flat = (colour: number, roughness = 0.65) => {
  const material = new THREE.MeshStandardNodeMaterial({
    color: colour,
    roughness,
  });
  finish(material);
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

function makeTyre(): THREE.Group {
  const tyre = new THREE.Group();
  const rubber = new THREE.Mesh(
    new THREE.CylinderGeometry(tyreRadius, tyreRadius, tyreWidth, 24),
    flat(dark, 0.85),
  );
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, tyreWidth + 0.01, 18),
    flat(steel, 0.35),
  );
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.31, 0.31, tyreWidth + 0.005, 24),
    flat(rimRed, 0.5),
  );
  const cover = new THREE.Mesh(
    new THREE.CylinderGeometry(0.29, 0.29, tyreWidth + 0.008, 24),
    flat(dark, 0.8),
  );
  tyre.add(rubber, stripe, cover, rim);
  tyre.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  return tyre;
}

export class PitCrew {
  readonly root = new THREE.Group();
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
  private lastTime = 0;
  private readonly anchor = new THREE.Matrix4();
  private readonly target = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();

  static async load(url: string, anisotropy: number): Promise<PitCrew> {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = surface(
        object.material as THREE.MeshStandardMaterial,
        anisotropy,
      );
    });
    return new PitCrew(gltf.scene, gltf.animations);
  }

  private constructor(
    private readonly model: THREE.Object3D,
    private readonly clips: THREE.AnimationClip[],
  ) {
    this.root.matrixAutoUpdate = false;
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
      const old = makeTyre();
      const fresh = makeTyre();
      old.visible = fresh.visible = false;
      this.root.add(old, fresh);
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
    body.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.frustumCulled = false;
      }
    });
    inner.add(body);
    root.add(inner);
    this.root.add(root);
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
    this.root.add(mesh);
    this.levers.push({ member, end, mesh });
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

  private poseMember(
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
    const e = smooth(member.engaged);
    member.root.position.set(
      mix(member.rest.x, member.active.x, e),
      mix(member.rest.y, member.active.y, e),
      0,
    );
    member.root.rotation.z = member.face;
    const moving = 4 * e * (1 - e);
    member.phase = (member.phase + delta / runCycle) % 1;
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

  update(
    progress: number,
    active: boolean,
    carMatrix: THREE.Matrix4 | null,
    eye: THREE.Vector3,
    now: number,
  ): { lift: number; wheelsOff: boolean } {
    this.target.setFromMatrixPosition(this.anchor);
    this.root.visible = this.target.distanceTo(eye) < visibleRange;
    if (!this.root.visible) return { lift: 0, wheelsOff: false };
    const delta = Math.min(0.1, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    this.root.matrix.copy(carMatrix ?? this.anchor);
    this.root.matrixWorldNeedsUpdate = true;
    this.root.updateMatrixWorld(true);
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const member of this.members)
      this.poseMember(member, progress, active, delta);
    this.poseTyres(progress, active);
    this.poseLevers();
    const jacked = active && progress > reachIn && progress < jackDown;
    return {
      lift: jacked ? liftHeight : 0,
      wheelsOff: active && progress > gunsOff && progress <= tyresOn,
    };
  }
}

import * as THREE from "three/webgpu";
import {
  float,
  instancedBufferAttribute,
  smoothstep,
  uv,
  vec2,
} from "three/tsl";
import {
  cornerMask,
  emptyPlan,
  layTiles,
  planCues,
  wrap,
  type Cue,
  type RacingLineData,
  type RacingLineMode,
  type SpeedProfile,
  type Tile,
} from "./racing-line.ts";

const tileWidth = 1.15;
const tileLength = 1.6;
const lift = 0.05;
const feather = 0.18;
const opacity = 0.78;
const behind = 4;
const fadeStart = 450;
const fadeEnd = 750;
const planReach = fadeEnd + 150;
const strongBrake = 22;
const green = new THREE.Color("#4fb85a");
const yellow = new THREE.Color("#f2c230");
const orange = new THREE.Color("#f0832a");
const red = new THREE.Color("#e3302a");

export class RacingLineView {
  readonly root = new THREE.Group();
  private readonly tiles: Tile[];
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly visible: boolean[];
  private readonly colour = new THREE.Color();
  private readonly plan: Cue[];
  private readonly shown: boolean;
  private readonly mesh: THREE.InstancedMesh;
  private readonly instance = new THREE.Matrix4();
  private readonly world = new THREE.Matrix4();

  constructor(
    private readonly data: RacingLineData,
    private readonly profile: SpeedProfile,
    mode: RacingLineMode,
  ) {
    this.plan = emptyPlan(profile.speed.length);
    this.shown = mode !== "off";
    const corners = cornerMask(data, profile);
    this.tiles = layTiles(data, corners);
    this.visible = this.tiles.map((t) => mode === "full" || !!corners[t.index]);
    this.tint = new THREE.InstancedBufferAttribute(
      new Float32Array(this.tiles.length * 4),
      4,
    );
    this.tint.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.PlaneGeometry(tileLength, tileWidth);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(
      geometry,
      this.material(),
      this.tiles.length,
    );
    this.mesh = mesh;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3(1, 1, 1);
    const position = new THREE.Vector3();
    this.tiles.forEach((tile, i) => {
      euler.set(0, -tile.heading, tile.pitch, "YZX");
      rotation.setFromEuler(euler);
      position.set(tile.x, tile.y + lift, tile.z);
      mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
    });
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.visible = mode !== "off";
    this.root.add(mesh);
  }

  private material(): THREE.MeshBasicNodeMaterial {
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 16,
    });
    const tint = instancedBufferAttribute(this.tint, "vec4" as const);
    const edge = vec2(0.5).sub(uv().sub(0.5).abs());
    const soft = smoothstep(float(0), float(feather), edge.x.min(edge.y));
    material.colorNode = tint.xyz;
    material.opacityNode = tint.w.mul(soft);
    return material;
  }

  forEachShown(
    visit: (matrix: THREE.Matrix4, colour: THREE.Color, alpha: number) => void,
  ): void {
    if (!this.shown || !this.root.visible) return;
    const array = this.tint.array as Float32Array;
    for (let i = 0; i < this.tiles.length; i++) {
      const alpha = array[i * 4 + 3] ?? 0;
      if (alpha <= 0) continue;
      this.mesh.getMatrixAt(i, this.instance);
      this.world.multiplyMatrices(this.root.matrixWorld, this.instance);
      this.colour.setRGB(
        array[i * 4] ?? 0,
        array[i * 4 + 1] ?? 0,
        array[i * 4 + 2] ?? 0,
      );
      visit(this.world, this.colour, alpha);
    }
  }

  update(carDistance: number, carSpeed: number): void {
    if (!this.shown) return;
    const length = this.data.length;
    planCues(this.plan, this.profile, length, carDistance, carSpeed, planReach);
    const array = this.tint.array as Float32Array;
    this.tiles.forEach((tile, i) => {
      const ahead = wrap(tile.distance - carDistance + behind, length) - behind;
      if (ahead <= 0 || ahead >= fadeEnd) {
        array[i * 4 + 3] = 0;
        return;
      }
      const cue = this.plan[tile.index];
      const fade = 1 - THREE.MathUtils.smoothstep(ahead, fadeStart, fadeEnd);
      const alpha = this.visible[i] && cue ? opacity * fade : 0;
      if (!cue || cue.kind === "accelerate") this.colour.copy(green);
      else if (cue.kind === "lift") this.colour.copy(yellow);
      else
        this.colour.lerpColors(
          orange,
          red,
          Math.min(1, cue.decel / strongBrake),
        );
      array[i * 4] = this.colour.r;
      array[i * 4 + 1] = this.colour.g;
      array[i * 4 + 2] = this.colour.b;
      array[i * 4 + 3] = alpha;
    });
    this.tint.needsUpdate = true;
  }
}

import * as THREE from "three/webgpu";
import { attribute, vec3 } from "three/tsl";
import { frameIndex, type WheelGrip } from "./engine.ts";
import { markStrength } from "./mark-strength.ts";

const capacity = 40000;
const segmentLength = 0.3;
const markWidths = [0.13, 0.13, 0.16, 0.16];
const tyreRadius = 0.34;
const lift = 0.012;
const darkness = 0.75;
const kerbSurface = 1;
const rubber = vec3(0.012, 0.012, 0.014);

interface Trail {
  left: THREE.Vector3;
  right: THREE.Vector3;
  strength: number;
}

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: THREE.BufferAttribute;
  private readonly strengths: THREE.BufferAttribute;
  private readonly trails: (Trail | null)[] = [null, null, null, null];
  private readonly body = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private next = 0;
  private used = 0;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(
      new Float32Array(capacity * 6 * 3),
      3,
    );
    this.strengths = new THREE.BufferAttribute(
      new Float32Array(capacity * 6),
      1,
    );
    geometry.setAttribute("position", this.positions);
    geometry.setAttribute("strength", this.strengths);
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 3,
      polygonOffsetUnits: 12,
    });
    material.colorNode = rubber;
    material.opacityNode = attribute("strength", "float").mul(darkness);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  update(frame: Float64Array, grip: WheelGrip[], surfaces: number[]): void {
    this.body.fromArray(frame, frameIndex.posMat);
    const speed = frame[frameIndex.speed] ?? 0;
    grip.forEach((wheel, i) => {
      const strength = markStrength(
        wheel.slip,
        speed,
        wheel.load,
        surfaces[i] === kerbSurface,
      );
      if (strength <= 0) {
        this.trails[i] = null;
        return;
      }
      const base = frameIndex.wheels + i * 7;
      this.point
        .set(
          frame[base] ?? 0,
          frame[base + 1] ?? 0,
          (frame[base + 2] ?? 0) - tyreRadius + lift,
        )
        .applyMatrix4(this.body);
      this.side.set(0, 1, 0).transformDirection(this.body);
      const half = this.side.multiplyScalar((markWidths[i] ?? 0.14) / 2);
      const left = this.point.clone().add(half);
      const right = this.point.clone().sub(half);
      const trail = this.trails[i];
      if (!trail) {
        this.trails[i] = { left, right, strength };
        return;
      }
      if (left.distanceTo(trail.left) < segmentLength) return;
      this.add(trail, { left, right, strength });
      this.trails[i] = { left, right, strength };
    });
  }

  private add(from: Trail, to: Trail): void {
    const corners = [
      from.left,
      from.right,
      to.right,
      from.left,
      to.right,
      to.left,
    ];
    const weights = [
      from.strength,
      from.strength,
      to.strength,
      from.strength,
      to.strength,
      to.strength,
    ];
    const start = this.next * 6;
    corners.forEach((c, k) => {
      this.positions.setXYZ(start + k, c.x, c.y, c.z);
      this.strengths.setX(start + k, weights[k] ?? 0);
    });
    this.positions.addUpdateRange(start * 3, 18);
    this.strengths.addUpdateRange(start, 6);
    this.positions.needsUpdate = true;
    this.strengths.needsUpdate = true;
    this.next = (this.next + 1) % capacity;
    this.used = Math.min(capacity, this.used + 1);
    this.mesh.geometry.setDrawRange(0, this.used * 6);
  }
}

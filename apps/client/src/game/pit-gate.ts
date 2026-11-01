import * as THREE from "three/webgpu";

const width = 7;
const height = 4.2;
const shownFrom = 2.8;

function chevrons(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 620;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.fillStyle = "rgba(150, 225, 240, 0.28)";
  context.roundRect(10, 10, 1004, 600, 60);
  context.fill();
  context.lineWidth = 14;
  context.strokeStyle = "rgba(215, 245, 250, 0.9)";
  context.stroke();
  context.lineWidth = 70;
  context.lineJoin = "miter";
  context.strokeStyle = "rgba(235, 250, 252, 0.9)";
  for (const x of [320, 520, 720]) {
    context.beginPath();
    context.moveTo(x + 120, 130);
    context.lineTo(x - 60, 310);
    context.lineTo(x + 120, 490);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class PitGate {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicNodeMaterial;

  constructor() {
    this.material = new THREE.MeshBasicNodeMaterial({
      map: chevrons(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      this.material,
    );
    this.mesh.visible = false;
  }

  place(x: number, y: number, z: number, heading: number): void {
    this.mesh.position.set(x, y, z + height / 2 + 0.2);
    this.mesh.rotation.set(Math.PI / 2, heading - Math.PI / 2, 0, "ZXY");
    this.mesh.rotation.set(Math.PI / 2, 0, heading - Math.PI / 2, "ZYX");
  }

  update(countdown: number | null): void {
    this.mesh.visible = countdown !== null && countdown < shownFrom;
    if (countdown !== null)
      this.material.opacity = 1 - Math.max(0, countdown / shownFrom) * 0.6;
  }
}

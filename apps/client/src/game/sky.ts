const deg = Math.PI / 180;
const skyDomeDistance = 20000;
const minMainLightBrightness = 0.25;

export interface TrackLocal {
  timeOfDay: number;
  sunAscension: number;
  rain: number;
  visibility: number;
  worldX: number;
  worldY: number;
  worldZ: number;
}

type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];

const scale = (v: readonly number[], s: number): Vec3 => [
  (v[0] ?? 0) * s,
  (v[1] ?? 0) * s,
  (v[2] ?? 0) * s,
];
const add = (a: readonly number[], b: readonly number[]): Vec3 => [
  (a[0] ?? 0) + (b[0] ?? 0),
  (a[1] ?? 0) + (b[1] ?? 0),
  (a[2] ?? 0) + (b[2] ?? 0),
];
const subtract = (a: readonly number[], b: readonly number[]): Vec3 => [
  (a[0] ?? 0) - (b[0] ?? 0),
  (a[1] ?? 0) - (b[1] ?? 0),
  (a[2] ?? 0) - (b[2] ?? 0),
];
const product = (a: readonly number[], b: readonly number[]): Vec3 => [
  (a[0] ?? 0) * (b[0] ?? 0),
  (a[1] ?? 0) * (b[1] ?? 0),
  (a[2] ?? 0) * (b[2] ?? 0),
];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function rotateX(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function rotateZ(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

export interface SkyState {
  sunPosition: Vec3;
  sunColor: Vec4;
  sceneAmbient: Vec3;
  sceneDiffuse: Vec3;
  sceneSpecular: Vec3;
  materialAmbient: number;
  materialEmission: number;
  fogColor: Vec3;
  fogDensity: number;
}

export class SdSky {
  private sunDeclination: number;
  private readonly sunRightAscension: number;
  private sunAngle = 0;
  private pathDistance = 0;
  private visibility = 0;
  private readonly effectiveVisibility: number;
  private sunPosition: Vec3 = [0, 0, 0];
  private ohaloColor: Vec4 = [1, 1, 1, 1];
  private initialized = false;
  private lastTimeLowSpeed = 0;
  private sdSunDeclination: number;
  private readonly fogState: { color: Vec3; density: number };
  private state!: SkyState;

  constructor(private readonly local: TrackLocal) {
    const sdVisibility =
      local.rain === 2 ? 200 : local.rain === 3 ? 120 : local.visibility;
    this.effectiveVisibility = sdVisibility <= 25 ? 25 : sdVisibility;
    this.sdSunDeclination = (15 * Math.trunc(local.timeOfDay)) / 3600 - 90.0;
    this.sunDeclination = Math.fround(this.sdSunDeclination * deg);
    this.sunRightAscension = local.sunAscension;
    this.reposition(Math.trunc(local.worldX) / 2, Math.trunc(local.worldY) / 2);
    this.state = this.updateLight();
    const sqrtMLog01 = Math.sqrt(-Math.log(0.01));
    this.fogState = {
      color: this.state.fogColor,
      density: Math.fround(sqrtMLog01 / sdVisibility),
    };
    this.state.fogDensity = this.fogState.density;
  }

  update(
    currentTime: number,
    accelTime: number,
    x: number,
    y: number,
  ): SkyState {
    if (currentTime < 0) {
      this.initialized = false;
      return this.state;
    }
    if (!this.initialized) {
      this.sdSunDeclination =
        (15 * Math.trunc(this.local.timeOfDay)) / 3600 - 90.0;
      this.sunDeclination = Math.fround(this.sdSunDeclination * deg);
      this.lastTimeLowSpeed = 60 * Math.floor(accelTime / 60.0);
      this.initialized = true;
      return this.state;
    }
    this.reposition(x, y);
    const nextTimeLowSpeed = 60 * Math.floor((accelTime + 60.0) / 60.0);
    if (nextTimeLowSpeed !== this.lastTimeLowSpeed) {
      const deltaDecl = Math.fround(
        ((nextTimeLowSpeed - this.lastTimeLowSpeed) * 360.0) /
          (24.0 * 60.0 * 60.0),
      );
      this.sdSunDeclination = Math.fround(this.sdSunDeclination + deltaDecl);
      if (this.sdSunDeclination >= 360.0) this.sdSunDeclination -= 360.0;
      this.sunDeclination = Math.fround(this.sdSunDeclination * deg);
      this.lastTimeLowSpeed = nextTimeLowSpeed;
    }
    this.state = this.updateLight();
    this.state.fogColor = this.fogState.color;
    this.state.fogDensity = this.fogState.density;
    return this.state;
  }

  private reposition(x: number, y: number): void {
    let p: Vec3 = [x, skyDomeDistance + y, 0];
    p = rotateX(p, Math.fround(this.sunDeclination));
    p = rotateZ(p, Math.fround(this.sunRightAscension - 90 * deg));
    this.sunPosition = [
      Math.fround(p[0]),
      Math.fround(p[1]),
      Math.fround(p[2]),
    ];
    const pos = subtract(this.sunPosition, [x, y, 0]);
    this.sunAngle =
      90 * deg -
      Math.atan2(pos[2], Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1]));
    this.updateColorAngle();
  }

  private updateColorAngle(): void {
    const rTropoPole = 6356752.314 + 8000;
    const rEarthPole = 6356752.314;
    const rTropo =
      rTropoPole / Math.sqrt(1 - 9.170014946e-3 * Math.cos(0) ** 2);
    const rEarth =
      rEarthPole / Math.sqrt(1 - 6.694380066e-3 * Math.cos(0) ** 2);
    const gamma = Math.PI - this.sunAngle;
    let sinBeta = (rEarth * Math.sin(gamma)) / rTropo;
    if (sinBeta > 1.0) sinBeta = 1.0;
    const alpha = Math.PI - gamma - Math.asin(sinBeta);
    this.pathDistance = Math.sqrt(
      rEarth ** 2 + rTropo ** 2 - 2 * rEarth * rTropo * Math.cos(alpha),
    );
  }

  private repaintSun(newVisibility: number): void {
    if (this.visibility !== newVisibility) {
      this.visibility = Math.min(45000, Math.max(100, newVisibility));
    }
    const aerosolFactor =
      this.visibility < 100 ? 8000 : 80.5 / Math.log(this.visibility / 100);
    const densityAvg = 0.7;
    const relHumidity = 0.5;
    const redScat = (aerosolFactor * this.pathDistance * densityAvg) / 5e7;
    const greenScat =
      this.sunDeclination > 5.0 || this.sunDeclination < 2.0
        ? (aerosolFactor * this.pathDistance * densityAvg) / 5e7
        : (aerosolFactor * this.pathDistance * densityAvg) / 8.8938e6;
    const blueScat = (aerosolFactor * this.pathDistance * densityAvg) / 3.607e6;
    const o: Vec4 = [
      1 - 1.4 * redScat,
      1 - 1.4 * greenScat,
      1 - 1.4 * blueScat,
      blueScat,
    ];
    if (newVisibility < 10000 && blueScat > 1) o[3] = 2 - blueScat;
    const saturation = 1 - relHumidity / 200;
    o[1] += (1 - saturation) * (1 - o[1]);
    o[2] += (1 - saturation) * (1 - o[2]);
    o[0] = clamp01(o[0]);
    if (o[1] < 0) o[1] = 0;
    else if (o[0] > 1) o[1] = 1;
    o[2] = clamp01(o[2]);
    o[3] = clamp01(o[3]);
    this.ohaloColor = o.map((v) => Math.fround(v)) as Vec4;
  }

  private brightness(): number {
    const absSolarTime = 12.0 - (12.0 * Math.abs(this.sunAngle)) / Math.PI;
    return 1 / (1 + Math.exp(6 - absSolarTime));
  }

  private updateLight(): SkyState {
    const solAngle = this.sunAngle;
    let skyBrightness = this.brightness();
    const lightSourceBrightness = Math.max(
      minMainLightBrightness,
      skyBrightness,
    );
    const baseFogColor: Vec3 =
      this.local.rain > 0 ? [0.42, 0.44, 0.5] : [0.84, 0.87, 1.0];
    if (this.local.rain > 0) skyBrightness = Math.pow(skyBrightness, 0.5);
    const fogColor = scale(baseFogColor, skyBrightness);
    let cloudsColor = fogColor;
    this.repaintSun(this.effectiveVisibility);
    const sunColor: Vec3 = [
      this.ohaloColor[0],
      this.ohaloColor[1],
      this.ohaloColor[2],
    ];
    if (solAngle > 1.0) {
      cloudsColor =
        this.effectiveVisibility > 1000
          ? product(cloudsColor, sunColor)
          : scale(cloudsColor, sunColor[0]);
    }
    this.repaintSun(this.effectiveVisibility);
    const visible = this.effectiveVisibility > 1000;
    const sceneAmbient = visible
      ? add(
          scale(sunColor, 0.25),
          scale(cloudsColor, 0.75 * lightSourceBrightness),
        )
      : scale(
          add(scale(cloudsColor, 0.75), [
            sunColor[0] * 0.25,
            sunColor[0] * 0.25,
            sunColor[0] * 0.25,
          ]),
          lightSourceBrightness,
        );
    const sceneDiffuse = visible
      ? add(
          scale(sunColor, 0.25),
          scale(fogColor, 0.75 * lightSourceBrightness),
        )
      : scale(
          add(scale(fogColor, 0.75), [
            sunColor[0] * 0.25,
            sunColor[0] * 0.25,
            sunColor[0] * 0.25,
          ]),
          lightSourceBrightness,
        );
    const sceneSpecular = visible
      ? scale(sunColor, lightSourceBrightness)
      : scale([1, 1, 1], sunColor[0] * lightSourceBrightness);
    return {
      sunPosition: this.sunPosition,
      sunColor: this.ohaloColor,
      sceneAmbient,
      sceneDiffuse,
      sceneSpecular,
      materialAmbient: 0.8 * lightSourceBrightness,
      materialEmission: 0.5 * lightSourceBrightness,
      fogColor,
      fogDensity: 0,
    };
  }
}

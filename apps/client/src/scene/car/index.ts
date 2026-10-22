import lod0 from "../../../../../content/cars/vanta-26/lod0.glb?url";
import lod1 from "../../../../../content/cars/vanta-26/lod1.glb?url";
import lod2 from "../../../../../content/cars/vanta-26/lod2.glb?url";
import lod3 from "../../../../../content/cars/vanta-26/lod3.glb?url";
import mask from "../../../../../content/cars/vanta-26/livery-mask.png?url";
import ember from "../../../../../content/cars/vanta-26/liveries/ember.json?url";
import type { Tier } from "../protocol.ts";
import { loadCar, type Car } from "./car.ts";

const models = {
  ultra: lod0,
  high: lod1,
  medium: lod2,
  low: lod3,
  basic: lod3,
};

export function createCar(tier: Tier): Promise<Car> {
  return loadCar({ model: models[tier], mask, livery: ember }, tier);
}

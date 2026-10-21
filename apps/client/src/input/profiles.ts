import { clamp } from "./state.ts";
import type { WheelProfile } from "./wheel.ts";

export const wheelProfiles: readonly WheelProfile[] = [
  {
    name: "Logitech Driving Force Pro",
    vendorId: 0x046d,
    productId: 0xc298,
    decode(data) {
      if (data.byteLength !== 8) {
        return null;
      }
      const packed = data.getUint32(0, true);
      const steering = packed & 0x3fff;
      const buttons = (packed >>> 14) & 0x3fff;
      return {
        steer: clamp((8192 - steering) / (steering < 8192 ? 8192 : 8191)),
        throttle: 1 - data.getUint8(5) / 255,
        brake: 1 - data.getUint8(6) / 255,
        shiftUp: (buttons & 0x20) !== 0,
        shiftDown: (buttons & 0x10) !== 0,
      };
    },
    encodeForce(force) {
      const level = Math.round(128 - clamp(force) * 127);
      return {
        reportId: 0,
        data:
          level === 128
            ? new Uint8Array([0x13, 0, 0, 0, 0, 0, 0])
            : new Uint8Array([0x11, 0x08, level, 0x80, 0, 0, 0]),
      };
    },
  },
];

export function wheelFilters() {
  return wheelProfiles.map(({ vendorId, productId }) => ({
    vendorId,
    productId,
  }));
}

import type { Input } from "../contracts/index.ts";
import { clamp, createShifts, idleInput, requirePositive } from "./state.ts";

export interface HidDeviceLike extends EventTarget {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
}

export interface WheelProfile {
  name: string;
  vendorId: number;
  productId: number;
  decode(data: DataView): Input | null;
  encodeForce(force: number): { reportId: number; data: Uint8Array };
}

export function steeringForce(torque: number, maximumTorque: number): number {
  requirePositive(maximumTorque, "Maximum torque");
  return clamp(torque / maximumTorque);
}

export async function connectWheel(
  device: HidDeviceLike,
  profile: WheelProfile,
) {
  if (!device.opened) {
    await device.open();
  }
  let state = idleInput();
  let closed = false;
  let lastForce: number | undefined;
  let queue = Promise.resolve();
  const shifts = createShifts();
  const onReport = (event: Event) => {
    if (!("data" in event) || !(event.data instanceof DataView)) {
      return;
    }
    const decoded = profile.decode(event.data);
    if (decoded !== null) {
      state = {
        steer: clamp(decoded.steer),
        throttle: clamp(decoded.throttle, 0),
        brake: clamp(decoded.brake, 0),
        shiftUp: false,
        shiftDown: false,
      };
      shifts.update(decoded.shiftUp, decoded.shiftDown);
    }
  };
  const enqueue = (force: number) => {
    const operation = queue.then(async () => {
      if (force === lastForce) {
        return;
      }
      const report = profile.encodeForce(force);
      await device.sendReport(report.reportId, new Uint8Array(report.data));
      lastForce = force;
    });
    queue = operation.catch(() => undefined);
    return operation;
  };
  device.addEventListener("inputreport", onReport);
  let closing: Promise<void> | undefined;
  return {
    read() {
      return { ...state, ...shifts.consume() };
    },
    setForce(force: number) {
      return closed ? Promise.resolve() : enqueue(clamp(force));
    },
    close() {
      if (closing !== undefined) {
        return closing;
      }
      closed = true;
      device.removeEventListener("inputreport", onReport);
      state = idleInput();
      shifts.reset();
      closing = enqueue(0).finally(() => device.close());
      return closing;
    },
  };
}

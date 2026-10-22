import type { Runtime } from "../runtime/runtime.ts";
import { idleInput } from "../runtime/shared.ts";
import type { createControls } from "./controls.ts";
import type { mountHud, mountLapTimes } from "../hud/index.ts";
import type { FollowRequest } from "../scene/follow/index.ts";
import { createLapClock } from "./laps.ts";

const SESSION_LAPS = 5;
interface Parts {
  runtime: Runtime;
  port: MessagePort;
  controls: ReturnType<typeof createControls>;
  hud: ReturnType<typeof mountHud>;
  lapTimes: ReturnType<typeof mountLapTimes>;
  onError: (error: unknown) => void;
}
export function startDriveLoop(parts: Parts): void {
  const { runtime, port, controls, hud, lapTimes, onError } = parts;
  const clock = createLapClock();
  let previous: number | undefined;
  function frame(time: number): void {
    try {
      const dt =
        previous === undefined
          ? 1 / 60
          : Math.max(0.001, Math.min(0.1, (time - previous) / 1000));
      previous = time;
      runtime.setInput(controls.read(dt));
      const state = runtime.state();
      const car = state.snapshot.cars[0];
      if (car === undefined) throw new Error("The world has no car");
      port.postMessage({
        type: "pose",
        pose: {
          tick: state.tick,
          position: car.position,
          orientation: car.orientation,
        },
      } satisfies FollowRequest);
      const speed = Math.hypot(car.velocity.x, car.velocity.y, car.velocity.z);
      const times = clock.update({
        tick: state.tick,
        lap: car.lap,
        lapDistance: car.lapDistance,
        speed,
      });
      hud.update({
        speed,
        gear: null,
        rpm: null,
        energy: null,
        tyres: null,
        delta: null,
        lap: {
          current: Math.min(times.completed + 1, SESSION_LAPS),
          total: SESSION_LAPS,
        },
      });
      lapTimes.update({ current: times.current, last: times.last });
      requestAnimationFrame(frame);
    } catch (error) {
      onError(error);
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) runtime.setInput(idleInput());
  });
  requestAnimationFrame(frame);
}

import "./drive.css";
import { Runtime } from "./runtime/runtime.ts";
import { mountHud, mountLapTimes } from "./hud/index.ts";
import { sceneOptions } from "./scene/protocol.ts";
import { hostScene, showFailure } from "./scene/host.ts";
import type { FollowReport } from "./scene/follow/index.ts";
import { loadTrack, driveSetup } from "./drive/setup.ts";
import { createControls } from "./drive/controls.ts";
import { startDriveLoop } from "./drive/loop.ts";

async function startDrive(): Promise<void> {
  const options = sceneOptions(location.search);
  const canvas = document.querySelector<HTMLCanvasElement>(
    '[data-testid="drive-canvas"]',
  );
  const hudRoot = document.querySelector<HTMLElement>('[data-testid="hud"]');
  if (canvas === null || hudRoot === null)
    throw new Error("The drive canvas or HUD is missing");
  const track = await loadTrack();
  const setup = driveSetup(location.search, track);
  const runtime = new Runtime();
  Object.assign(window, {
    drive: { state: () => runtime.state(), inputLog: () => runtime.inputLog() },
  });
  await runtime.start({ setup, transport: "none" });
  const host = hostScene(canvas, options, () => {
    document.body.dataset["renderStatus"] = "ready";
  });
  const channel = new MessageChannel();
  channel.port1.onmessage = ({ data }: MessageEvent<FollowReport>) => {
    canvas.dataset["renderedTick"] = data.tick.toFixed(3);
    canvas.dataset["carX"] = data.position.x.toFixed(3);
    canvas.dataset["carY"] = data.position.y.toFixed(3);
    canvas.dataset["carZ"] = data.position.z.toFixed(3);
  };
  host.send({ type: "drive", track, port: channel.port2 }, [channel.port2]);
  startDriveLoop({
    runtime,
    port: channel.port1,
    controls: createControls(window),
    hud: mountHud(hudRoot),
    lapTimes: mountLapTimes(hudRoot),
    onError: (error) => {
      host.stop();
      showFailure(error);
    },
  });
}
startDrive().catch(showFailure);

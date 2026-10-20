import "./style.css";
import { chart } from "./chart.ts";
import { parseTelemetry, TelemetryError, type Telemetry } from "./telemetry.ts";

const plottedChannels = [
  ["speed", "Speed (m/s)"],
  ["throttle", "Throttle"],
  ["brake", "Brake"],
] as const;

function element(testId: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  if (found === null) {
    throw new Error(`the page has no ${testId}`);
  }
  return found;
}

const title = element("telemetry-name");
const fileInput = element("telemetry-file") as HTMLInputElement;
const carSelect = element("car-select") as HTMLSelectElement;
const maxSpeed = element("stat-max-speed");
const charts = document.querySelector<HTMLElement>("#charts");
let loaded: Telemetry | null = null;

function clear(): void {
  charts?.replaceChildren();
  maxSpeed.textContent = "";
  document.querySelector('[role="alert"]')?.remove();
}

function showError(error: unknown): void {
  loaded = null;
  clear();
  carSelect.replaceChildren();
  title.textContent = "Telemetry";
  const alert = document.createElement("p");
  alert.setAttribute("role", "alert");
  alert.textContent =
    error instanceof TelemetryError
      ? `Could not show telemetry: ${error.message}.`
      : "Could not load the telemetry file.";
  charts?.before(alert);
}

function showCar(): void {
  const car = loaded?.cars.find((item) => String(item.id) === carSelect.value);
  if (car === undefined) {
    return;
  }
  clear();
  const top = Math.max(...car.channels.speed) * 3.6;
  maxSpeed.textContent = `${top.toFixed(1)} km/h`;
  charts?.append(
    ...plottedChannels.map(([channel, label]) =>
      chart(channel, label, car.channels[channel]),
    ),
  );
}

function show(text: string): void {
  try {
    loaded = parseTelemetry(text);
  } catch (error) {
    showError(error);
    return;
  }
  title.textContent = loaded.name;
  carSelect.replaceChildren(
    ...loaded.cars.map((car) => new Option(String(car.id), String(car.id))),
  );
  showCar();
}

async function fetchTelemetry(source: string): Promise<void> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new TelemetryError(
      `the telemetry file ${source} could not be loaded (HTTP ${String(response.status)})`,
    );
  }
  show(await response.text());
}

carSelect.addEventListener("change", showCar);
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file !== undefined) {
    file.text().then(show, showError);
  }
});

const source = new URLSearchParams(location.search).get("src");
if (source !== null) {
  fetchTelemetry(source).catch(showError);
}

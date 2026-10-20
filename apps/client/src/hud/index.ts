import { formatHud, type HudFrame } from "./format.ts";

export { formatHud, type HudFrame };
export { mountMenu } from "./menu.ts";

export function mountHud(root: HTMLElement) {
  const document = root.ownerDocument;
  const container = document.createElement("section");
  container.setAttribute("aria-label", "Race telemetry");
  const fields = ["speed", "gear", "rpm", "energy", "delta", "lap"] as const;
  const readings = fields.map((field) => {
    const label = document.createElement("label");
    label.textContent = field;
    const value = document.createElement("output");
    value.dataset["testid"] = `hud-${field}`;
    label.append(value);
    container.append(label);
    return { field, value };
  });
  const tyres = ["fl", "fr", "rl", "rr"].map((corner) => {
    const element = document.createElement("div");
    element.dataset["testid"] = `hud-tyre-${corner}`;
    element.setAttribute("aria-label", `${corner} tyre`);
    const temperature = document.createElement("span");
    temperature.dataset["field"] = "temperature";
    const wear = document.createElement("span");
    wear.dataset["field"] = "wear";
    element.append(temperature, " ", wear);
    container.append(element);
    return { element, temperature, wear };
  });

  function update(frame: HudFrame): void {
    const text = formatHud(frame);
    for (const { field, value } of readings) {
      value.textContent = text[field];
      value.dataset["available"] = String(frame[field] !== null);
      if (field === "delta") {
        value.dataset["trend"] = text.deltaTrend;
      }
      if (field === "energy") {
        value.dataset["mode"] = energyMode(frame.energy);
      }
    }
    for (const [index, reading] of text.tyres.entries()) {
      const tyre = tyres[index];
      if (tyre !== undefined) {
        tyre.temperature.textContent = reading.temperature;
        tyre.wear.textContent = reading.wear;
        tyre.element.dataset["state"] = reading.state;
      }
    }
  }

  update({
    speed: null,
    gear: null,
    rpm: null,
    energy: null,
    tyres: null,
    delta: null,
    lap: null,
  });
  root.append(container);
  return {
    update,
    destroy() {
      container.remove();
    },
  };
}

function energyMode(energy: HudFrame["energy"]): string {
  if (energy === null) {
    return "unknown";
  }
  if (energy.deploying) {
    return "deploying";
  }
  return energy.harvesting ? "harvesting" : "idle";
}

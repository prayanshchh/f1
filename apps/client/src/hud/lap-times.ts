interface LapTimesFrame {
  current: number | null;
  last: number | null;
}

export function formatLapTime(seconds: number | null): string {
  if (seconds === null) return "—";
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new RangeError("Lap time must be finite and not negative");
  const ms = Math.round(seconds * 1000);
  const minutes = Math.floor(ms / 60000);
  const rest = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${String(minutes)}:${rest}.${String(ms % 1000).padStart(3, "0")}`;
}

export function mountLapTimes(root: HTMLElement) {
  const section = root.ownerDocument.createElement("section");
  section.setAttribute("aria-label", "Lap timing");
  const outputs = ["lap time", "last lap"].map((name) => {
    const label = root.ownerDocument.createElement("label");
    const output = root.ownerDocument.createElement("output");
    label.append(name, output);
    section.append(label);
    output.dataset["testid"] =
      name === "lap time" ? "hud-lap-time" : "hud-last-lap";
    return output;
  });
  function update(frame: LapTimesFrame): void {
    const texts = [formatLapTime(frame.current), formatLapTime(frame.last)];
    const values = [frame.current, frame.last];
    outputs.forEach((output, i) => {
      output.textContent = texts[i] ?? "—";
      output.dataset["available"] = String(values[i] !== null);
    });
  }
  update({ current: null, last: null });
  root.append(section);
  return {
    update,
    destroy: () => {
      section.remove();
    },
  };
}

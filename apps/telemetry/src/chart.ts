const width = 1000;
const height = 160;
const buckets = 1000;
const svgNamespace = "http://www.w3.org/2000/svg";

function extremaIndices(values: number[]): number[] {
  const last = values.length - 1;
  const picked = new Set([0, last]);
  const size = Math.max(1, Math.ceil(values.length / buckets));
  for (let start = 0; start <= last; start += size) {
    let low = start;
    let high = start;
    for (
      let index = start;
      index < Math.min(start + size, values.length);
      index += 1
    ) {
      const value = values[index] ?? 0;
      if (value < (values[low] ?? 0)) {
        low = index;
      }
      if (value > (values[high] ?? 0)) {
        high = index;
      }
    }
    picked.add(low).add(high);
  }
  return [...picked].sort((a, b) => a - b);
}

function points(values: number[]): string {
  const low = Math.min(...values);
  const range = Math.max(...values) - low || 1;
  const last = Math.max(1, values.length - 1);
  return extremaIndices(values)
    .map((index) => {
      const x = (index / last) * width;
      const y = height - (((values[index] ?? low) - low) / range) * height;
      return `${x.toFixed(3)},${y.toFixed(3)}`;
    })
    .join(" ");
}

export function chart(
  channel: string,
  title: string,
  values: number[],
): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = title;
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.dataset["testid"] = `chart-${channel}`;
  svg.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title);
  const line = document.createElementNS(svgNamespace, "polyline");
  line.dataset["channel"] = channel;
  line.setAttribute("points", points(values));
  svg.append(line);
  section.append(heading, svg);
  return section;
}

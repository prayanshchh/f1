export interface Polyline {
  points: [number, number][];
  lengths: Float64Array;
  total: number;
}

export function closedPolyline(points: [number, number][]): Polyline {
  const first = points[0] ?? [0, 0];
  const closed: [number, number][] = [...points, first];
  const lengths = new Float64Array(closed.length);
  let total = 0;
  closed.forEach(([x, y], i) => {
    const [px, py] = closed[i - 1] ?? [x, y];
    total += Math.hypot(x - px, y - py);
    lengths[i] = total;
  });
  return { points: closed, lengths, total };
}

export function pointAlong(line: Polyline, distance: number): [number, number] {
  const { points, lengths } = line;
  let low = 0;
  let high = lengths.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((lengths[middle] ?? 0) <= distance) low = middle;
    else high = middle;
  }
  const [ax, ay] = points[low] ?? [0, 0];
  const [bx, by] = points[high] ?? [ax, ay];
  const from = lengths[low] ?? 0;
  const span = (lengths[high] ?? from) - from;
  const t = span > 0 ? Math.min(1, Math.max(0, (distance - from) / span)) : 0;
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

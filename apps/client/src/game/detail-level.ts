export const detailLevels = [
  { metresPerPixel: 0.02, error: 0.01, spinning: true },
  { metresPerPixel: 0.1, error: 0.05, spinning: false },
  { metresPerPixel: 0.25, error: 0.12, spinning: false },
];
const detailHold = 0.85;
export function detailFor(current: number, metresPerPixel: number): number {
  let detail = 0;
  detailLevels.forEach((level, i) => {
    const hold = i < current ? detailHold : 1;
    if (metresPerPixel >= level.metresPerPixel * hold) detail = i + 1;
  });
  return detail;
}

const minRatio = 0.26;
const fullRatio = 0.6;
const minLoad = 300;
const minSpeed = 10;
const kerbDarkening = 1.35;

export function markStrength(
  slip: number,
  speed: number,
  load: number,
  onKerb: boolean,
): number {
  if (load <= minLoad) return 0;
  const ratio = slip / Math.max(Math.abs(speed), minSpeed);
  const strength = Math.min(
    1,
    Math.max(0, (ratio - minRatio) / (fullRatio - minRatio)),
  );
  return Math.min(1, strength * (onKerb ? kerbDarkening : 1));
}

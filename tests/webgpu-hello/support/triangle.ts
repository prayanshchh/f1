type Point = readonly [number, number];

export interface Picture {
  width: number;
  height: number;
  data: Uint8Array;
}

type PixelKind = "red" | "black" | "other";

const insidePoints: readonly Point[] = [
  [0, -1 / 6],
  [0, 0.3],
  [-0.3, -0.4],
  [0.3, -0.4],
];

const outsidePoints: readonly Point[] = [
  [0, 0.6],
  [-0.4, 0.2],
  [0.4, 0.2],
  [0, -0.6],
  [-0.9, 0.9],
  [0.9, -0.9],
];

const expectedRedFraction = 0.125;
const redFractionTolerance = 0.005;
const maximumEdgeFraction = 0.01;

function classifyAt(picture: Picture, x: number, y: number): PixelKind {
  const offset = (y * picture.width + x) * 4;
  const red = picture.data[offset] ?? 0;
  const green = picture.data[offset + 1] ?? 0;
  const blue = picture.data[offset + 2] ?? 0;
  if (red >= 200 && green <= 50 && blue <= 50) {
    return "red";
  }
  if (red <= 30 && green <= 30 && blue <= 30) {
    return "black";
  }
  return "other";
}

function clipToPixel([x, y]: Point, width: number, height: number): Point {
  return [
    Math.min(width - 1, Math.floor(((x + 1) / 2) * width)),
    Math.min(height - 1, Math.floor(((1 - y) / 2) * height)),
  ];
}

function samplePoints(
  picture: Picture,
  points: readonly Point[],
  expected: PixelKind,
  label: string,
): string[] {
  return points.flatMap((point) => {
    const [x, y] = clipToPixel(point, picture.width, picture.height);
    const found = classifyAt(picture, x, y);
    return found === expected
      ? []
      : [
          `${label} point ${point.join(",")} at pixel ${String(x)},${String(y)} is ${found}`,
        ];
  });
}

export function findTriangleProblems(picture: Picture): string[] {
  const problems: string[] = [];
  const counts: Record<PixelKind, number> = { red: 0, black: 0, other: 0 };
  for (let y = 0; y < picture.height; y += 1) {
    for (let x = 0; x < picture.width; x += 1) {
      counts[classifyAt(picture, x, y)] += 1;
    }
  }
  const total = picture.width * picture.height;
  const redFraction = counts.red / total;
  const edgeFraction = counts.other / total;
  if (Math.abs(redFraction - expectedRedFraction) > redFractionTolerance) {
    problems.push(
      `red covers ${redFraction.toFixed(4)} of the picture, expected ${String(expectedRedFraction)} ± ${String(redFractionTolerance)}`,
    );
  }
  if (edgeFraction > maximumEdgeFraction) {
    problems.push(
      `${edgeFraction.toFixed(4)} of the picture is neither red nor black, allowed ${String(maximumEdgeFraction)}`,
    );
  }
  return [
    ...problems,
    ...samplePoints(picture, insidePoints, "red", "inside"),
    ...samplePoints(picture, outsidePoints, "black", "outside"),
  ];
}

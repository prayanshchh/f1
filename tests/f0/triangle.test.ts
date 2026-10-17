import { expect, test } from "vitest";
import {
  findTriangleProblems,
  triangleVertices,
  type Picture,
  type Point,
} from "./support/triangle.ts";

type Colour = readonly [number, number, number];

const red: Colour = [255, 0, 0];
const black: Colour = [0, 0, 0];

function edge([ax, ay]: Point, [bx, by]: Point, [px, py]: Point): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

function insideTriangle(vertices: readonly Point[], point: Point): boolean {
  const [a, b, c] = vertices;
  if (a === undefined || b === undefined || c === undefined) {
    return false;
  }
  const sides = [edge(a, b, point), edge(b, c, point), edge(c, a, point)];
  return sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
}

interface Painting {
  width?: number;
  height?: number;
  vertices: readonly Point[];
  fill: Colour;
  background: Colour;
}

function paint({
  width = 640,
  height = 360,
  vertices,
  fill,
  background,
}: Painting): Picture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const clip: Point = [
        ((x + 0.5) / width) * 2 - 1,
        1 - ((y + 0.5) / height) * 2,
      ];
      const colour = insideTriangle(vertices, clip) ? fill : background;
      data.set([...colour, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const problemKinds = [
  ["coverage", "red covers"],
  ["edge", "neither red nor black"],
  ["inside", "inside point"],
  ["outside", "outside point"],
] as const;

function kindsOf(problems: readonly string[]): string[] {
  return problemKinds
    .filter(([, text]) => problems.some((problem) => problem.includes(text)))
    .map(([kind]) => kind);
}

function paintSpecified(): Picture {
  return paint({ vertices: triangleVertices, fill: red, background: black });
}

function recolour(
  picture: Picture,
  pixels: readonly Point[],
  colour: Colour,
): Picture {
  for (const [x, y] of pixels) {
    picture.data.set(colour, (y * picture.width + x) * 4);
  }
  return picture;
}

function square(left: number, top: number, size: number): Point[] {
  return Array.from({ length: size * size }, (_, index) => [
    left + (index % size),
    top + Math.floor(index / size),
  ]);
}

function topRows(picture: Picture, fraction: number): Point[] {
  const count = Math.round(picture.width * picture.height * fraction);
  return Array.from({ length: count }, (_, index) => [
    index % picture.width,
    Math.floor(index / picture.width),
  ]);
}

function scale(factor: number): Point[] {
  return triangleVertices.map(([x, y]) => [x * factor, y * factor]);
}

test("accepts the specified red triangle on black at every tested canvas size", () => {
  for (const [width, height] of [
    [1280, 720],
    [1202, 902],
    [800, 600],
    [333, 211],
  ] as const) {
    const picture = paint({
      width,
      height,
      vertices: triangleVertices,
      fill: red,
      background: black,
    });
    expect(
      findTriangleProblems(picture),
      `${String(width)}x${String(height)}`,
    ).toEqual([]);
  }
});

test.each([
  {
    name: "nothing drawn",
    picture: () => paint({ vertices: [], fill: red, background: black }),
    kinds: ["coverage", "inside"],
  },
  {
    name: "whole canvas red",
    picture: () => paint({ vertices: [], fill: red, background: red }),
    kinds: ["coverage", "outside"],
  },
  {
    name: "white background",
    picture: () =>
      paint({
        vertices: triangleVertices,
        fill: red,
        background: [255, 255, 255],
      }),
    kinds: ["edge", "outside"],
  },
  {
    name: "green triangle",
    picture: () =>
      paint({
        vertices: triangleVertices,
        fill: [0, 255, 0],
        background: black,
      }),
    kinds: ["coverage", "edge", "inside"],
  },
  {
    name: "dark red triangle",
    picture: () =>
      paint({
        vertices: triangleVertices,
        fill: [150, 0, 0],
        background: black,
      }),
    kinds: ["coverage", "edge", "inside"],
  },
  {
    name: "upside-down triangle",
    picture: () =>
      paint({
        vertices: triangleVertices.map(([x, y]) => [x, -y]),
        fill: red,
        background: black,
      }),
    kinds: ["inside"],
  },
  {
    name: "half-size triangle",
    picture: () =>
      paint({ vertices: scale(0.5), fill: red, background: black }),
    kinds: ["coverage", "inside"],
  },
  {
    name: "slightly oversized triangle",
    picture: () =>
      paint({ vertices: scale(1.1), fill: red, background: black }),
    kinds: ["coverage"],
  },
  {
    name: "shifted right",
    picture: () =>
      paint({
        vertices: triangleVertices.map(([x, y]) => [x + 0.2, y]),
        fill: red,
        background: black,
      }),
    kinds: ["inside"],
  },
  {
    name: "stray red patch in a corner",
    picture: () => recolour(paintSpecified(), square(22, 8, 20), red),
    kinds: ["outside"],
  },
])("rejects a $name picture for the right reasons", ({ picture, kinds }) => {
  expect(kindsOf(findTriangleProblems(picture()))).toEqual(kinds);
});

test("allows a thin soft edge but rejects a blurred picture", () => {
  const soft = paintSpecified();
  recolour(soft, topRows(soft, 0.009), [120, 0, 0]);
  const blurred = paintSpecified();
  recolour(blurred, topRows(blurred, 0.011), [120, 0, 0]);
  expect(findTriangleProblems(soft)).toEqual([]);
  expect(kindsOf(findTriangleProblems(blurred))).toEqual(["edge"]);
});

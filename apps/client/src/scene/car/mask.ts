import type { LiveryMask } from "../../livery/index.ts";

export async function decodeMask(url: string): Promise<LiveryMask> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `could not load the livery mask ${url}: HTTP ${String(response.status)}`,
    );
  }
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  try {
    const { width, height } = bitmap;
    const context = new OffscreenCanvas(width, height).getContext("2d");
    if (context === null) {
      throw new Error("could not create a 2D context for the livery mask");
    }
    context.drawImage(bitmap, 0, 0);
    return {
      width,
      height,
      data: context.getImageData(0, 0, width, height).data,
    };
  } finally {
    bitmap.close();
  }
}

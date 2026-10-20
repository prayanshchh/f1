import { NodeBasisEncoder } from "ktx2-encoder";
import { PNG } from "pngjs";
import { fail, formatCount, isPowerOfTwo } from "./assets-config.mjs";

const basis = new NodeBasisEncoder();

const RAW_RGBA = 0;
const TEXTURE_2D = 0;

const toLinear = Float64Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
});

function fromLinear(value) {
  const channel =
    value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(channel, 0), 1) * 255);
}

export function decodePng(bytes, label) {
  try {
    const png = PNG.sync.read(Buffer.from(bytes));
    return {
      width: png.width,
      height: png.height,
      data: new Uint8Array(png.data),
    };
  } catch (error) {
    return fail(`${label}: not a readable PNG (${error.message})`);
  }
}

export function checkTexture(image, label, tier, limit) {
  const size = `${String(image.width)}x${String(image.height)}`;
  if (!isPowerOfTwo(image.width) || !isPowerOfTwo(image.height)) {
    fail(`${label}: texture is ${size}, which is not a power of two`);
  }
  if (Math.max(image.width, image.height) > limit) {
    fail(
      `${label} (${tier}): texture is ${size}, larger than the ${tier} limit of ${formatCount(limit)}`,
    );
  }
}

function averageTexel(image, x, y, channel, srgb) {
  const xs = image.width > 1 ? [x * 2, x * 2 + 1] : [0];
  const ys = image.height > 1 ? [y * 2, y * 2 + 1] : [0];
  const decode = srgb && channel < 3;
  let total = 0;
  for (const sy of ys) {
    for (const sx of xs) {
      const value = image.data[(sy * image.width + sx) * 4 + channel];
      total += decode ? toLinear[value] : value;
    }
  }
  const mean = total / (xs.length * ys.length);
  return decode ? fromLinear(mean) : Math.round(mean);
}

function halve(image, srgb) {
  const width = Math.max(1, image.width >> 1);
  const height = Math.max(1, image.height >> 1);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        data[(y * width + x) * 4 + channel] = averageTexel(
          image,
          x,
          y,
          channel,
          srgb,
        );
      }
    }
  }
  return { width, height, data };
}

export function fitTexture(image, limit, srgb) {
  let fitted = image;
  while (Math.max(fitted.width, fitted.height) > limit) {
    fitted = halve(fitted, srgb);
  }
  return fitted;
}

function configure(encoder, { srgb, normal }) {
  encoder.setDebug(false);
  encoder.setStatusOutput(false);
  encoder.setPrintStats(false);
  if (normal) {
    encoder.setNormalMapPreset();
  }
  encoder.setCreateKTX2File(true);
  encoder.setTexType(TEXTURE_2D);
  encoder.setUASTC(true);
  encoder.setKTX2UASTCSupercompression(true);
  encoder.setRDOUASTC(true);
  encoder.setPerceptual(srgb);
  encoder.setKTX2AndBasisSRGBTransferFunc(srgb);
  encoder.setMipSRGB(srgb);
  encoder.setMipRenormalize(normal);
  encoder.setMipGen(true);
  encoder.setMipSmallestDimension(1);
}

export async function encodeKtx2(image, options, label) {
  const module = await basis.init();
  const encoder = new module.BasisEncoder();
  try {
    configure(encoder, options);
    encoder.setSliceSourceImage(
      0,
      image.data,
      image.width,
      image.height,
      RAW_RGBA,
    );
    const output = new Uint8Array(image.width * image.height * 8 + 65_536);
    const length = encoder.encode(output);
    if (length === 0) {
      fail(`${label}: the KTX2 encoder failed`);
    }
    return output.slice(0, length);
  } finally {
    encoder.delete();
  }
}

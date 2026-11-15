import { Buffer } from "buffer";
import * as jpeg from "jpeg-js";
import { decode as decodePng, toRGBA8 } from "upng-js";
import { outputPixelSize, sourceCrop, type CropView, type SourceCrop } from "@/lib/imageCropGeometry";

const globalWithBuffer = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (!globalWithBuffer.Buffer) globalWithBuffer.Buffer = Buffer;

type RgbaImage = { width: number; height: number; data: Uint8Array };

export function cropImageBase64(options: {
  base64: string;
  width: number;
  height: number;
  view: CropView;
  frameWidth: number;
  frameHeight: number;
  maxEdge: number;
  maxBytes: number;
}): string {
  const bytes = new Uint8Array(Buffer.from(options.base64, "base64"));
  const decoded = decodeToRgba(bytes);
  const rect = sourceCrop(options.view, options.width, options.height, options.frameWidth, options.frameHeight);
  const mapped = {
    sx: rect.sx * (decoded.width / options.width),
    sy: rect.sy * (decoded.height / options.height),
    sw: rect.sw * (decoded.width / options.width),
    sh: rect.sh * (decoded.height / options.height),
  };
  const size = outputPixelSize(mapped.sw, mapped.sh, options.maxEdge);
  const pixels = resample(decoded, mapped, size.width, size.height);
  flattenOntoBackground(pixels);
  let quality = 85;
  let encoded = jpeg.encode({ data: pixels, width: size.width, height: size.height }, quality).data;
  while (encoded.length > options.maxBytes && quality > 40) {
    quality -= 15;
    encoded = jpeg.encode({ data: pixels, width: size.width, height: size.height }, quality).data;
  }
  return Buffer.from(encoded).toString("base64");
}

function decodeToRgba(bytes: Uint8Array): RgbaImage {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const decoded = jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: 24,
      maxMemoryUsageInMB: 256,
    });
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const png = decodePng(copy);
    const frame = toRGBA8(png)[0];
    if (!frame) throw new Error("Could not read that PNG.");
    return { width: png.width, height: png.height, data: new Uint8Array(frame) };
  }
  throw new Error("Use a JPEG or PNG photo.");
}

function resample(src: RgbaImage, rect: SourceCrop, outW: number, outH: number): Uint8Array {
  const out = new Uint8Array(outW * outH * 4);
  const sx0 = clamp(rect.sx, 0, Math.max(0, src.width - 1));
  const sy0 = clamp(rect.sy, 0, Math.max(0, src.height - 1));
  const sw = clamp(rect.sw, 1, src.width - sx0);
  const sh = clamp(rect.sh, 1, src.height - sy0);
  for (let y = 0; y < outH; y++) {
    const sy = sy0 + ((y + 0.5) / outH) * sh - 0.5;
    for (let x = 0; x < outW; x++) {
      const sx = sx0 + ((x + 0.5) / outW) * sw - 0.5;
      const pixel = bilinear(src.data, src.width, src.height, sx, sy);
      const index = (y * outW + x) * 4;
      out[index] = pixel[0];
      out[index + 1] = pixel[1];
      out[index + 2] = pixel[2];
      out[index + 3] = pixel[3];
    }
  }
  return out;
}

function bilinear(src: Uint8Array, width: number, height: number, x: number, y: number): [number, number, number, number] {
  const x0 = clamp(Math.floor(x), 0, width - 1);
  const y0 = clamp(Math.floor(y), 0, height - 1);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = clamp(x - x0, 0, 1);
  const dy = clamp(y - y0, 0, 1);
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const pixel: [number, number, number, number] = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel++) {
    const top = src[i00 + channel] * (1 - dx) + src[i10 + channel] * dx;
    const bottom = src[i01 + channel] * (1 - dx) + src[i11 + channel] * dx;
    pixel[channel] = Math.round(top * (1 - dy) + bottom * dy);
  }
  return pixel;
}

function flattenOntoBackground(data: Uint8Array) {
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    data[index] = Math.round(data[index] * alpha + 0x0a * (1 - alpha));
    data[index + 1] = Math.round(data[index + 1] * alpha + 0x0a * (1 - alpha));
    data[index + 2] = Math.round(data[index + 2] * alpha + 0x0a * (1 - alpha));
    data[index + 3] = 255;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

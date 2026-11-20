import { Buffer } from "buffer";
import * as jpeg from "jpeg-js";
import { decode as decodePng, toRGBA8 } from "upng-js";
import {
  CROP_ZOOM_MAX,
  outputPixelSize,
  previewPixelEdge,
  sourceCrop,
  type CropView,
  type SourceCrop,
} from "@/lib/imageCropGeometry";

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
  const decoded = decodeCached(options.base64);
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

let decodedCache: { key: string; image: RgbaImage } | null = null;
let workCache: { key: string; edge: number; image: RgbaImage } | null = null;

export function releaseDecodedImageCache() {
  decodedCache = null;
  workCache = null;
}

function decodeCached(base64: string): RgbaImage {
  if (decodedCache?.key === base64) return decodedCache.image;
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  const image = decodeToRgba(bytes);
  decodedCache = { key: base64, image };
  return image;
}

export type FramePreview = {
  base64: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
};

export function imagePixelSize(base64: string): { width: number; height: number } {
  const image = decodeCached(base64);
  return { width: image.width, height: image.height };
}

/**
 * JPEG of only the pixels inside the crop frame, at the frame's device-pixel size.
 * The native image view decodes to its layout size and will not ask again for the same
 * file, so a larger photo (or the camera file) gets stuck as a tiny bitmap and looks blurred.
 */
export function renderFramePreview(
  base64: string,
  view: CropView,
  frameWidth: number,
  frameHeight: number,
  pixelRatio: number
): FramePreview {
  const decoded = decodeCached(base64);
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  let outW = Math.max(1, Math.round(frameWidth * ratio));
  let outH = Math.max(1, Math.round(frameHeight * ratio));
  const cap = 2048;
  const longest = Math.max(outW, outH);
  if (longest > cap) {
    const shrink = cap / longest;
    outW = Math.max(1, Math.round(outW * shrink));
    outH = Math.max(1, Math.round(outH * shrink));
  }
  const work = workingImage(base64, decoded, frameWidth, frameHeight, view.zoom, ratio);
  const rect = sourceCrop(view, decoded.width, decoded.height, frameWidth, frameHeight);
  const mapped = {
    sx: rect.sx * (work.width / decoded.width),
    sy: rect.sy * (work.height / decoded.height),
    sw: rect.sw * (work.width / decoded.width),
    sh: rect.sh * (work.height / decoded.height),
  };
  const pixels = sampleFrame(work, mapped, outW, outH);
  flattenOntoBackground(pixels);
  const encoded = jpeg.encode({ data: pixels, width: outW, height: outH }, 82).data;
  return {
    base64: Buffer.from(encoded).toString("base64"),
    width: outW,
    height: outH,
    sourceWidth: decoded.width,
    sourceHeight: decoded.height,
  };
}

function workingImage(
  key: string,
  decoded: RgbaImage,
  frameWidth: number,
  frameHeight: number,
  zoom: number,
  pixelRatio: number
): RgbaImage {
  const needed = previewPixelEdge(decoded.width, decoded.height, frameWidth, frameHeight, zoom, pixelRatio);
  if (workCache?.key === key && workCache.edge + 1 >= needed) return workCache.image;
  const coverZoom = Math.min(CROP_ZOOM_MAX, zoom <= 1 ? zoom : zoom * 1.4);
  const edge = Math.max(
    needed,
    previewPixelEdge(decoded.width, decoded.height, frameWidth, frameHeight, coverZoom, pixelRatio)
  );
  const sourceEdge = Math.max(decoded.width, decoded.height);
  if (edge >= sourceEdge * 0.98) {
    workCache = { key, edge: sourceEdge, image: decoded };
    return decoded;
  }
  const scale = edge / sourceEdge;
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const image = {
    width,
    height,
    data: resample(decoded, { sx: 0, sy: 0, sw: decoded.width, sh: decoded.height }, width, height),
  };
  workCache = { key, edge, image };
  return image;
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

function sampleFrame(src: RgbaImage, rect: SourceCrop, outW: number, outH: number): Uint8Array {
  const sx0 = clamp(rect.sx, 0, Math.max(0, src.width - 1));
  const sy0 = clamp(rect.sy, 0, Math.max(0, src.height - 1));
  const sw = clamp(rect.sw, 1, src.width - sx0);
  const sh = clamp(rect.sh, 1, src.height - sy0);
  if (Math.abs(sw - outW) < 0.75 && Math.abs(sh - outH) < 0.75) {
    const out = new Uint8Array(outW * outH * 4);
    const x0 = clamp(Math.round(sx0), 0, src.width - 1);
    const y0 = clamp(Math.round(sy0), 0, src.height - 1);
    const copyW = Math.min(outW, src.width - x0);
    const copyH = Math.min(outH, src.height - y0);
    const rowBytes = copyW * 4;
    for (let y = 0; y < copyH; y++) {
      const start = ((y0 + y) * src.width + x0) * 4;
      out.set(src.data.subarray(start, start + rowBytes), y * outW * 4);
    }
    return out;
  }
  return resample(src, { sx: sx0, sy: sy0, sw, sh }, outW, outH);
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

/** Crop math shared by the image crop dialog. Keep in sync with crea-app/lib/imageCropGeometry.ts. */

export type CropView = {
  tx: number;
  ty: number;
  zoom: number;
};

export type SourceCrop = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 4;

export function coverScale(imgW: number, imgH: number, frameW: number, frameH: number): number {
  if (imgW <= 0 || imgH <= 0 || frameW <= 0 || frameH <= 0) return 1;
  return Math.max(frameW / imgW, frameH / imgH);
}

export function viewScale(
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
  zoom: number
): number {
  return coverScale(imgW, imgH, frameW, frameH) * clampZoom(zoom);
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return CROP_ZOOM_MIN;
  return Math.min(CROP_ZOOM_MAX, Math.max(CROP_ZOOM_MIN, zoom));
}

export function clampOffset(
  tx: number,
  ty: number,
  imgW: number,
  imgH: number,
  scale: number,
  frameW: number,
  frameH: number
): { tx: number; ty: number } {
  const minTx = frameW - imgW * scale;
  const minTy = frameH - imgH * scale;
  return {
    tx: clamp(tx, Math.min(minTx, 0), 0),
    ty: clamp(ty, Math.min(minTy, 0), 0),
  };
}

export function initialCropView(imgW: number, imgH: number, frameW: number, frameH: number): CropView {
  const scale = viewScale(imgW, imgH, frameW, frameH, 1);
  const centered = clampOffset((frameW - imgW * scale) / 2, (frameH - imgH * scale) / 2, imgW, imgH, scale, frameW, frameH);
  return { ...centered, zoom: 1 };
}

export function panCropView(
  view: CropView,
  dx: number,
  dy: number,
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number
): CropView {
  const scale = viewScale(imgW, imgH, frameW, frameH, view.zoom);
  const next = clampOffset(view.tx + dx, view.ty + dy, imgW, imgH, scale, frameW, frameH);
  return { ...next, zoom: view.zoom };
}

/** Keep the source point currently in the middle of the frame when zoom changes. */
export function zoomCropView(
  view: CropView,
  zoom: number,
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number
): CropView {
  const prevScale = viewScale(imgW, imgH, frameW, frameH, view.zoom);
  const nextZoom = clampZoom(zoom);
  const nextScale = viewScale(imgW, imgH, frameW, frameH, nextZoom);
  const cx = (-view.tx + frameW / 2) / prevScale;
  const cy = (-view.ty + frameH / 2) / prevScale;
  const next = clampOffset(frameW / 2 - cx * nextScale, frameH / 2 - cy * nextScale, imgW, imgH, nextScale, frameW, frameH);
  return { ...next, zoom: nextZoom };
}

export function sourceCrop(
  view: CropView,
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number
): SourceCrop {
  const scale = viewScale(imgW, imgH, frameW, frameH, view.zoom);
  const sx = clamp(-view.tx / scale, 0, Math.max(0, imgW - 1));
  const sy = clamp(-view.ty / scale, 0, Math.max(0, imgH - 1));
  const sw = clamp(frameW / scale, 1, imgW - sx);
  const sh = clamp(frameH / scale, 1, imgH - sy);
  return { sx, sy, sw, sh };
}

export function outputPixelSize(
  sw: number,
  sh: number,
  maxEdge = 1600
): { width: number; height: number } {
  const edge = Math.max(sw, sh);
  const ratio = edge > maxEdge ? maxEdge / edge : 1;
  return {
    width: Math.max(1, Math.round(sw * ratio)),
    height: Math.max(1, Math.round(sh * ratio)),
  };
}

export function frameSizeForAspect(
  aspect: number,
  viewportW: number,
  viewportH: number
): { width: number; height: number } {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const maxW = Math.max(160, Math.min(480, viewportW - 48));
  const maxH = Math.max(160, Math.min(560, viewportH - 230));
  let width = maxW;
  let height = width / safeAspect;
  if (height > maxH) {
    height = maxH;
    width = height * safeAspect;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

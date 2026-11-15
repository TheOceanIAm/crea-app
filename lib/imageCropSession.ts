import type { CropView } from "@/lib/imageCropGeometry";

export type ImageCropRequest = {
  uri: string;
  base64: string;
  width: number;
  height: number;
  aspect: number | "source";
  shape: "circle" | "rect";
  maxEdge: number;
  maxBytes: number;
};

export type ImageCropResult =
  | { ok: true; base64: string }
  | { ok: false; error?: string; cancelled?: boolean };

export function isImageCropFailure(
  result: ImageCropResult
): result is { ok: false; error?: string; cancelled?: boolean } {
  return result.ok === false;
}

type Waiter = {
  request: ImageCropRequest;
  resolve: (result: ImageCropResult) => void;
};

const waiters: Waiter[] = [];
let show: ((waiter: Waiter | null) => void) | null = null;

export function requestImageCrop(request: ImageCropRequest): Promise<ImageCropResult> {
  return new Promise((resolve) => {
    const waiter = { request, resolve };
    waiters.push(waiter);
    if (waiters.length === 1) show?.(waiter);
  });
}

export function bindImageCropHost(next: ((waiter: Waiter | null) => void) | null) {
  show = next;
  if (show) show(waiters[0] ?? null);
  return () => {
    if (show === next) show = null;
    while (waiters.length) {
      waiters.shift()?.resolve({ ok: false, cancelled: true });
    }
  };
}

export function settleImageCrop(result: ImageCropResult) {
  waiters.shift()?.resolve(result);
  show?.(waiters[0] ?? null);
}

export type { CropView, Waiter as ImageCropWaiter };

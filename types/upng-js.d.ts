declare module "upng-js" {
  export type DecodedPng = { width: number; height: number };
  export function decode(buffer: ArrayBuffer): DecodedPng;
  export function toRGBA8(image: DecodedPng): ArrayBuffer[];
}

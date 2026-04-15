/**
 * Fixes splash PNG: fill transparent pixels + white/light greys with solid #FFDC00.
 * Prevents white/grey bands on iOS native splash when transparency composites oddly.
 *
 * Run: node scripts/splash-flatten-brand-yellow.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const inputPath = path.join(__dirname, '../assets/splash-wordmark.png')

const YR = 255
const YG = 220
const YB = 0

function isOpaqueBlackText(r, g, b, a) {
  return a > 200 && r < 75 && g < 75 && b < 75
}

const buf = fs.readFileSync(inputPath)
const png = PNG.sync.read(buf)
const { width, height, data } = png

let n = 0
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (width * y + x) << 2
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    const a = data[idx + 3]

    if (isOpaqueBlackText(r, g, b, a)) continue

    // Fully transparent → solid brand yellow (no "holes" for native splash)
    if (a === 0) {
      data[idx] = YR
      data[idx + 1] = YG
      data[idx + 2] = YB
      data[idx + 3] = 255
      n++
      continue
    }

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max

    const lightNeutral = r > 220 && g > 220 && b > 220
    const greyWash = sat < 0.15 && max > 170

    if (lightNeutral || greyWash) {
      data[idx] = YR
      data[idx + 1] = YG
      data[idx + 2] = YB
      data[idx + 3] = 255
      n++
    }
  }
}

const out = PNG.sync.write(png)
fs.writeFileSync(inputPath, out)
console.log('Updated', inputPath, `${width}x${height}`, `(${n} pixels → #FFDC00)`)

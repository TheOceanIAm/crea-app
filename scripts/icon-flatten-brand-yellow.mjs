/**
 * Flattens app icon PNGs: yellow background → solid #FFDC00 (removes baked-in gradients).
 * Keeps dark glyph pixels + typical anti-alias fringe untouched.
 *
 * Run: node scripts/icon-flatten-brand-yellow.mjs
 * Or:  node scripts/icon-flatten-brand-yellow.mjs path/to/icon.png
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const YR = 255
const YG = 220
const YB = 0

const defaultPaths = [
  path.join(__dirname, '../assets/crea-icon.png'),
  path.join(__dirname, '../assets/adaptive-icon.png'),
]

const inputPaths =
  process.argv.length > 2
    ? process.argv.slice(2).map((p) => path.resolve(p))
    : defaultPaths

function lum(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Core glyph + dark fringe — do not repaint as yellow. */
function keepAsGlyphPixel(r, g, b, a) {
  if (a < 90) return false
  if (r < 72 && g < 72 && b < 72) return true
  const L = lum(r, g, b)
  return L < 95 && r < 105 && g < 105 && b < 105
}

function processFile(inputPath) {
  if (!fs.existsSync(inputPath)) {
    console.warn('Skip (missing):', inputPath)
    return
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

      if (keepAsGlyphPixel(r, g, b, a)) continue

      data[idx] = YR
      data[idx + 1] = YG
      data[idx + 2] = YB
      data[idx + 3] = a > 0 ? 255 : 0
      n++
    }
  }

  const out = PNG.sync.write(png)
  fs.writeFileSync(inputPath, out)
  console.log('Updated', inputPath, `${width}x${height}`, `(${n} pixels → #FFDC00)`)
}

for (const p of inputPaths) {
  processFile(p)
}

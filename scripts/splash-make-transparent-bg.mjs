/**
 * Makes near-white pixels transparent in splash-wordmark.png so expo splash
 * backgroundColor (#FFDC00) shows through instead of a white band.
 * Run: node scripts/splash-make-transparent-bg.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const inputPath = path.join(__dirname, '../assets/splash-wordmark.png')

const buf = fs.readFileSync(inputPath)
const png = PNG.sync.read(buf)
const { width, height, data } = png

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (width * y + x) << 2
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    if (r > 240 && g > 240 && b > 240) {
      data[idx + 3] = 0
    }
  }
}

const out = PNG.sync.write(png)
fs.writeFileSync(inputPath, out)
console.log('Updated', inputPath, `${width}x${height}`)

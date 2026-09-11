import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const svg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1f3a30"/>
      <stop offset="1" stop-color="#12202a"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <path d="M256 128 Q280 232 384 256 Q280 280 256 384 Q232 280 128 256 Q232 232 256 128 Z" fill="#e8a33d"/>
</svg>
`

const sizes = [192, 512]
for (const size of sizes) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(path.join(outDir, `icon-${size}.png`))
  console.log(`Skapade icon-${size}.png`)
}

// Apple touch icon (iOS home screen) - samma design, 180x180
await sharp(Buffer.from(svg))
  .resize(180, 180)
  .png()
  .toFile(path.join(outDir, 'apple-touch-icon.png'))
console.log('Skapade apple-touch-icon.png')

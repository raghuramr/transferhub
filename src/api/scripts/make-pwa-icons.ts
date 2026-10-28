/** Run once: npx tsx scripts/make-pwa-icons.ts - writes PWA icons into src/ui/public from the existing logo-icon.png. */
import { join } from 'node:path';
import sharp from 'sharp';

const pub = join(__dirname, '..', '..', 'ui', 'public');
const src = join(pub, 'logo-icon.png');

async function main() {
  for (const size of [192, 512]) {
    await sharp(src).resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(join(pub, `icon-${size}.png`));
  }
  // Maskable: the logo at ~64% on white, so launchers can crop to a circle/squircle without cutting it off.
  const inner = await sharp(src).resize(328, 328, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#ffffff' } })
    .composite([{ input: inner, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(join(pub, 'icon-maskable-512.png'));
  console.log('icons written to', pub);
}

main().catch((e) => { console.error(e); process.exit(1); });

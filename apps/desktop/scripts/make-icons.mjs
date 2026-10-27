// Renders the TeamSphere mark (same artwork as apps/web/src/components/logo.tsx) into the
// PNGs the desktop app needs. Run with `pnpm icons` after changing the artwork; outputs are committed.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const mark = (withBadge = false) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b8bf5"/>
      <stop offset="1" stop-color="#4f46e5"/>
    </linearGradient>
  </defs>
  <circle cx="16" cy="16" r="10" fill="url(#g)"/>
  <ellipse cx="16" cy="16" rx="15" ry="5.5" fill="none" stroke="#c4b5fd" stroke-width="1.8" transform="rotate(-25 16 16)"/>
  <circle cx="12.5" cy="12.5" r="2.4" fill="#ffffff" opacity="0.55"/>
  ${withBadge ? '<circle cx="25" cy="7" r="6.5" fill="#c4314b" stroke="#ffffff" stroke-width="1.5"/>' : ''}
</svg>`;

// App icon on a rounded tile so it reads well on the taskbar and in Start.
const tile = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024">
  <rect x="2" y="2" width="60" height="60" rx="14" fill="#1e1b4b"/>
  <g transform="translate(8 8) scale(1.5)">${mark().replace(/<\/?svg[^>]*>/g, '')}</g>
</svg>`;

const out = async (svg, size, file) => {
  const path = join(root, file);
  await mkdir(dirname(path), { recursive: true });
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path);
  console.log('wrote', file);
};

await out(tile, 512, 'build/icon.png');
await out(tile, 256, 'assets/icon.png');
await out(mark(), 32, 'assets/tray.png');
await out(mark(), 64, 'assets/tray@2x.png');
await out(mark(true), 32, 'assets/tray-unread.png');
await out(mark(true), 64, 'assets/tray-unread@2x.png');

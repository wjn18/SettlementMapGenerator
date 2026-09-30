import { PNG } from 'pngjs';
export function compareLegacy(actualBytes, referenceBytes) {
  const a = PNG.sync.read(actualBytes), b = PNG.sync.read(referenceBytes);
  if (a.width !== b.width || a.height !== b.height) throw new Error('Reference image dimensions differ');
  const dpr = a.width / 800;
  let pixels = 0, changed = 0, total = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    // P1's four UI buttons occupy this rectangle. Map pixels elsewhere count.
    if (x >= 660 * dpr && y < 170 * dpr) continue;
    const i = (y * a.width + x) * 4; let max = 0;
    for (let c = 0; c < 3; c++) { const delta = Math.abs(a.data[i + c] - b.data[i + c]); total += delta; max = Math.max(max, delta); }
    pixels++; if (max > 16) changed++;
  }
  return { meanAbsoluteChannelError: total / (pixels * 3), changedPixelRatio: changed / pixels, pixels, channelThreshold: 16 };
}

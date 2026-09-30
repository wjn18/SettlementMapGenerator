import fontUrl from '../../../assets/fonts/maroubra.png?url';
const image = new Image(); image.src = fontUrl;
const ready = image.decode();
// Same separator scan as legacy BitmapText; only this UI label uses the atlas.
export async function bitmapTitle(target: HTMLCanvasElement, text: string, color: string): Promise<void> {
  await ready;
  const atlas = document.createElement('canvas'); atlas.width = image.width; atlas.height = image.height;
  const ctx = atlas.getContext('2d')!; ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  const blank = (x: number) => { for (let y = 0; y < image.height; y++) if (data[(y * image.width + x) * 4 + 3]) return false; return true; };
  let pos = 0; while (pos < image.width && blank(pos)) pos++;
  const table = new Map<string, { x: number; width: number }>([[' ', { x: 0, width: --pos }]]);
  for (let i = 33; i < 128; i++) { let end = pos; do { end++; } while (end < image.width && !blank(end)); table.set(String.fromCharCode(i), { x: pos, width: end - pos }); pos = end + 1; }
  const glyphs = Array.from(text, c => table.get(c)!);
  target.width = glyphs.reduce((n, g) => n + g.width, 0) + glyphs.length - 1; target.height = image.height;
  const output = target.getContext('2d')!; let x = 0;
  for (const g of glyphs) { output.drawImage(image, g.x, 0, g.width, image.height, x, 0, g.width, image.height); x += g.width + 1; }
  output.globalCompositeOperation = 'source-in'; output.fillStyle = color; output.fillRect(0, 0, target.width, target.height);
  target.style.width = `${target.width * 2}px`; target.style.height = `${target.height * 2}px`;
}

import { Bitmap, BitmapData, Point, Rectangle, ColorTransform } from './openfl';

// Port of legacy coogee/BitmapText.hx's separator scan and copyPixels layout.
export function bitmapLabel(source: BitmapData, text: string, color: number) {
  const atlas = source.clone();
  const chars = Array.from({ length: 96 }, (_, i) => String.fromCharCode(i + 32));
  const table = new Map<string, Rectangle>();
  const blank = (x: number) => {
    for (let y = 0; y < atlas.height; y++) if (atlas.getPixel32(x, y) !== 0) return false;
    return true;
  };
  let pos = 0;
  while (pos < atlas.width && blank(pos)) pos++;
  table.set(' ', new Rectangle(0, 0, --pos, atlas.height));
  for (const char of chars.slice(1)) {
    let separator = pos;
    do { separator++; } while (separator < atlas.width && !blank(separator));
    table.set(char, new Rectangle(pos, 0, separator - pos, atlas.height));
    pos = separator + 1;
  }
  atlas.colorTransform(atlas.rect, new ColorTransform((color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255));
  const glyphs = Array.from(text, char => {
    const rect = table.get(char);
    if (!rect || rect.width <= 0) throw new Error(`Missing bitmap glyph: ${char}`);
    return rect;
  });
  const width = glyphs.reduce((sum, rect) => sum + rect.width, 0) + Math.max(0, glyphs.length - 1);
  const data = new BitmapData(width, atlas.height, true, 0);
  const point = new Point();
  for (const rect of glyphs) {
    data.copyPixels(atlas, rect, point, undefined, undefined, true);
    point.x += rect.width + 1;
  }
  atlas.dispose();
  return { bitmap: new Bitmap(data), width, height: data.height, glyphs: glyphs.map(r => ({ x: r.x, width: r.width })) };
}

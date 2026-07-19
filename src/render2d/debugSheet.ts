import { extract, pipeCellRect, REF, refDigitRect } from './sheet';

/**
 * Dev calibration view (?sprites): renders every pipes-sheet grid cell
 * (chroma-keyed) plus the ref-sheet crops, labeled, so crop rectangles
 * can be verified against screenshots.
 */
export function debugSprites(canvas: HTMLCanvasElement): void {
  canvas.width = 1420;
  canvas.height = 900;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#123524';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = false;
  g.font = 'bold 12px monospace';
  g.textBaseline = 'top';

  const S = 96;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 7; col++) {
      const x = 20 + col * (S + 14);
      const y = 30 + row * (S + 26);
      const spr = extract('pipes', pipeCellRect(col, row), S, S, { key: true });
      g.fillStyle = '#0a2016';
      g.fillRect(x, y, S, S);
      g.drawImage(spr, x, y);
      // filled variant beside it at half size
      const fill = extract('filled', pipeCellRect(col, row), S / 2, S / 2, { key: true });
      g.drawImage(fill, x + S - S / 2, y + S - S / 2);
      g.fillStyle = '#ffffff';
      g.fillText(`c${col} r${row}`, x, y + S + 2);
    }
  }

  // ref sheet crops
  let x = 810;
  const y0 = 540;
  const put = (label: string, c: HTMLCanvasElement, w: number, h: number) => {
    g.fillStyle = '#0a2016';
    g.fillRect(x, y0, w, h);
    g.drawImage(c, x, y0);
    g.fillStyle = '#ffffff';
    g.fillText(label, x, y0 + h + 2);
    x += w + 16;
  };
  put('plate', extract('ref', REF.plateSilver!, 96, 96), 96, 96);
  put('rust', extract('ref', REF.plateRust!, 96, 96), 96, 96);
  put('hero', extract('ref', REF.heroStand!, 96, 152, { key: true }), 96, 152);
  for (let d = 0; d < 10; d++) {
    put(String(d), extract('ref', refDigitRect(d), 24, 40), 24, 40);
  }
}

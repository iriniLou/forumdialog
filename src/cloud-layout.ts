export type CloudWord = { text: string; count: number };
export type PlacedWord = CloudWord & {
  x: number;
  y: number;
  size: number;
  width: number;
  height: number;
};

// The tab, step and rounded corners follow the folder mark in the supplied brandbook.
export const folderPath =
  "M85 50H420Q450 50 450 80V100H915Q950 100 950 135V915Q950 950 915 950H85Q50 950 50 915V85Q50 50 85 50Z";

export function insideFolder(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return (
    x >= 82 &&
    x + width <= 918 &&
    y >= 82 &&
    y + height <= 918 &&
    (y >= 132 || x + width <= 418)
  );
}

// Deterministic horizontal phrase packing. Whole phrases stay intact, with no stemming.
// One grid covers the interior so words cannot overlap or escape the folder.
export function layoutCloud(
  words: CloudWord[],
  measure: (text: string, size: number) => number,
): PlacedWord[] {
  if (!words.length) return [];
  const maximum = Math.max(...words.map((w) => w.count));
  const sorted = words
    .map((w) => ({ ...w, base: 28 + 112 * Math.sqrt(w.count / maximum) }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.text.length - a.text.length ||
        a.text.localeCompare(b.text, "ru"),
    );
  const area = sorted.reduce(
    (sum, w) => sum + (measure(w.text, w.base) + 12) * (w.base * 1.2 + 12),
    0,
  );
  let scale = Math.min(1, Math.sqrt(450000 / area));
  const candidates: { x: number; y: number; distance: number }[] = [];
  for (let y = 86; y <= 910; y += 10)
    for (let x = 86; x <= 910; x += 10)
      candidates.push({
        x,
        y,
        distance: ((x - 500) / 1.05) ** 2 + (y - 520) ** 2,
      });
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  for (let attempt = 0; attempt < 45; attempt++, scale *= 0.88) {
    const grid = new Uint8Array(10000);
    const placed: PlacedWord[] = [];
    for (const w of sorted) {
      const size = w.base * scale,
        width = measure(w.text, size) + 6,
        height = size * 1.2 + 6;
      for (const point of candidates) {
        const x = point.x - width / 2,
          y = point.y - height / 2;
        if (!insideFolder(x, y, width, height)) continue;
        const left = Math.floor(x / 10),
          right = Math.ceil((x + width) / 10),
          top = Math.floor(y / 10),
          bottom = Math.ceil((y + height) / 10);
        let free = true;
        for (let row = top; row < bottom && free; row++)
          for (let col = left; col < right; col++)
            if (grid[row * 100 + col]) {
              free = false;
              break;
            }
        if (!free) continue;
        for (let row = top; row < bottom; row++)
          for (let col = left; col < right; col++) grid[row * 100 + col] = 1;
        placed.push({
          text: w.text,
          count: w.count,
          x: x + width / 2,
          y: y + height / 2,
          size,
          width,
          height,
        });
        break;
      }
    }
    if (placed.length === sorted.length) return placed;
  }
  throw new Error(
    "Облако не удалось разместить. Все ответы сохранены и доступны в выгрузке.",
  );
}

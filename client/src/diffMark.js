/** Diff-square geometry shared by the graph canvas and the flow cards.
 *  side = r × 1.6, and r tracks file length so the square's area reads as lines.
 *  Fill is 20% plus a square-root share of how much of the file changed.
 */

export const ADD = '#2EFF7A';
export const DEL = '#FF4D5E';
export const TEAL = '#6ec8d4';

export function radiusFromLines(lines) {
  const side = Math.min(84, 10 + 2.6 * Math.sqrt(Math.max(1, Number(lines) || 1)));
  return side / 1.6;
}

export function sideFromRadius(r) {
  return Math.max(14, (Number(r) || 8) * 1.6);
}

/**
 * @returns {{ g: number, r: number } | null} fractions of the square, green from the bottom, red stacked on it
 */
export function fillFractions(adds, dels, lines, status) {
  const st = String(status || '');
  if (st === 'A' || st === 'added') return { g: 1, r: 0 };
  if (st === 'D' || st === 'deleted') return { g: 0, r: 1 };
  const a = Math.max(0, Number(adds) || 0);
  const d = Math.max(0, Number(dels) || 0);
  const changed = a + d;
  if (!changed) return null;
  const ln = Math.max(changed, Number(lines) || changed);
  const fr = Math.min(1, 0.2 + 0.8 * Math.sqrt(changed / ln));
  return { g: (fr * a) / changed, r: (fr * d) / changed };
}

/** Line-multiset difference, good enough for the small function squares. */
export function bodyDiffCounts(baseBody, headBody, status) {
  const headLines = String(headBody || '').split('\n');
  const baseLines = String(baseBody || '').split('\n');
  const nonempty = (rows) => rows.map((line) => line.trim()).filter(Boolean);
  if (status === 'added') {
    const n = nonempty(headLines).length || headLines.length || 1;
    return { adds: n, dels: 0, lines: n };
  }
  if (status === 'deleted') {
    const n = nonempty(baseLines).length || baseLines.length || 1;
    return { adds: 0, dels: n, lines: n };
  }
  const count = (rows) => {
    const map = new Map();
    for (const line of nonempty(rows)) map.set(line, (map.get(line) || 0) + 1);
    return map;
  };
  const base = count(baseLines);
  const head = count(headLines);
  let adds = 0;
  let dels = 0;
  const keys = new Set([...base.keys(), ...head.keys()]);
  for (const key of keys) {
    const b = base.get(key) || 0;
    const h = head.get(key) || 0;
    if (h > b) adds += h - b;
    else if (b > h) dels += b - h;
  }
  const lines = Math.max(nonempty(headLines).length, nonempty(baseLines).length, 1);
  return { adds, dels, lines };
}

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
 * Fractions of the square. Green = added, teal (`m`) = moved in, red = true removals.
 * Moved-in lines stay in the body of the square. Red is only the removal share,
 * and a file that is mostly moved keeps a small red cap instead of turning solid red.
 * @returns {{ g: number, r: number, m: number } | null}
 */
export function fillFractions(adds, dels, lines, status, moved = 0) {
  const st = String(status || '');
  const a = Math.max(0, Number(adds) || 0);
  const d = Math.max(0, Number(dels) || 0);
  const mv = Math.max(0, Number(moved) || 0);
  if ((st === 'A' || st === 'added') && !mv) return { g: 1, r: 0, m: 0 };
  if ((st === 'D' || st === 'deleted') && !mv && !a) return { g: 0, r: 1, m: 0 };
  const ln = Math.max(1, Number(lines) || a + mv || d || 1);
  if (!a && !d && !mv) return null;
  if (!mv) {
    const changed = a + d;
    const fr = Math.min(1, 0.2 + 0.8 * Math.sqrt(changed / Math.max(changed, ln)));
    return { g: (fr * a) / changed, r: (fr * d) / changed, m: 0 };
  }
  const body = Math.max(ln, a + mv);
  const g = Math.min(1, a / body);
  const m = Math.min(1 - g, mv / body);
  const share = d / (a + mv + d);
  const r = d ? (mv > d ? Math.min(0.22, Math.max(0.06, share * 0.4)) : Math.min(0.85, Math.max(0.08, share))) : 0;
  return { g, m, r };
}

/** One line for a hover card when the file has no stored summary. */
export function fallbackSummary({ summary, adds = 0, dels = 0, moved = 0 } = {}) {
  const given = String(summary || '').replace(/\s+/g, ' ').trim();
  if (given) return given.length > 110 ? `${given.slice(0, 107)}…` : given;
  const bits = [];
  if (moved) bits.push(`moves in ${moved} lines`);
  if (adds && dels) bits.push(`adds ${adds}, removes ${dels}`);
  else if (adds) bits.push(`adds ${adds} lines`);
  else if (dels) bits.push(`removes ${dels} lines`);
  const text = bits.join(' · ');
  return text.length > 110 ? `${text.slice(0, 107)}…` : text;
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

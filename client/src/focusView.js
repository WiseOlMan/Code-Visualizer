/** Pure focus-neighborhood view. The client draws it; the API returns the same object. */

const HOP_OPACITY = { 1: 0.62, 2: 0.4, 3: 0.26 };

export function defaultHops(seedMode) {
  return seedMode === 'picked' ? 2 : 1;
}

export function hopOpacity(hop) {
  if (hop == null || hop <= 0) return 1;
  if (HOP_OPACITY[hop] != null) return HOP_OPACITY[hop];
  return Math.max(0.28, 1 - hop * 0.22);
}

export function shortDirLabel(id) {
  const parts = String(id || '').split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function isTestPath(id) {
  const p = String(id || '').replace(/\\/g, '/');
  if (/(^|\/)__tests__\//.test(p)) return true;
  if (/(^|\/)tests?\//.test(p)) return true;
  const base = p.split('/').pop() || '';
  return /\.(test|spec)\./.test(base);
}

export function shortSha(value) {
  const s = String(value || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(s)) return null;
  return s.slice(0, 8);
}

/** `vs 21494897 · head 773f6ecd` — both ends must be shas. */
export function formatShaPill(baseSha, headSha) {
  const base = shortSha(baseSha);
  const head = shortSha(headSha);
  if (!base || !head) return null;
  return `vs ${base} · head ${head}`;
}

export function focusSummary({ seedCount, hops, visible, total }) {
  const seedWord = seedCount === 1 ? 'seed' : 'seeds';
  const hopWord = Number(hops) === 1 ? 'hop' : 'hops';
  return `Focus: ${seedCount} ${seedWord} · ${hops} ${hopWord} · ${visible} of ${total} files`;
}

function uniqueStrings(value, max) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(value) ? value : [];
  for (const item of list) {
    const id = String(item || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function normStatus(status) {
  const s = String(status || 'M').toUpperCase().replace(/\d+$/, '').slice(0, 1);
  if (s === 'A' || s === '?' || s === 'C') return 'A';
  if (s === 'D') return 'D';
  return 'M';
}

export function normalizeChanged(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = typeof item === 'string' ? item : (item?.id || item?.graphId || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, status: normStatus(typeof item === 'string' ? 'M' : item.status) });
  }
  return out;
}

function readHideTests(value) {
  if (value === undefined || value === null || value === '') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return true;
}

function clampHops(value, seedMode) {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return defaultHops(seedMode);
}

export function normalizeFocusState(input = {}) {
  const seedMode = input.seedMode === 'picked' ? 'picked' : 'changed';
  const direction = input.direction === 'in' || input.direction === 'out' || input.direction === 'both'
    ? input.direction
    : 'both';
  return {
    on: input.on === true || input.on === 1 || input.on === '1' || input.focus === '1' || input.focus === 1,
    seedMode,
    seeds: uniqueStrings(input.seeds, 4),
    hops: clampHops(input.hops, seedMode),
    direction,
    pins: uniqueStrings(input.pins, 8),
    hideTests: readHideTests(input.hideTests),
    base: input.base ? String(input.base) : '',
    changed: normalizeChanged(input.changed),
    head: input.head || input.headSha || '',
    baseSha: input.baseSha || '',
  };
}

function splitIds(value) {
  if (!value) return [];
  return String(value).split(',').map((part) => part.trim()).filter(Boolean);
}

export function encodeFocusQuery(input) {
  const state = normalizeFocusState(input);
  if (!state.on) return '';
  const params = new URLSearchParams();
  params.set('focus', '1');
  params.set('seedMode', state.seedMode);
  if (state.seeds.length) params.set('seeds', state.seeds.join(','));
  params.set('hops', String(state.hops));
  params.set('dir', state.direction);
  if (state.pins.length) params.set('pins', state.pins.join(','));
  params.set('hideTests', state.hideTests ? '1' : '0');
  if (state.base) params.set('base', state.base);
  return params.toString();
}

export function decodeFocusQuery(search) {
  const raw = String(search || '').replace(/^\?/, '');
  const params = new URLSearchParams(raw);
  const hasFocus = params.get('focus') === '1';
  return normalizeFocusState({
    on: hasFocus,
    seedMode: params.get('seedMode') || undefined,
    seeds: splitIds(params.get('seeds')),
    hops: params.has('hops') ? params.get('hops') : undefined,
    direction: params.get('dir') || undefined,
    pins: splitIds(params.get('pins')),
    hideTests: params.has('hideTests') ? params.get('hideTests') : undefined,
    base: params.get('base') || '',
  });
}

export function focusStateJson(input) {
  const state = normalizeFocusState(input);
  const payload = {
    seedMode: state.seedMode,
    seeds: state.seeds,
    hops: state.hops,
    direction: state.direction,
    pins: state.pins,
    hideTests: state.hideTests,
    base: state.base,
    changed: state.changed,
  };
  if (state.baseSha) payload.baseSha = state.baseSha;
  if (state.head) payload.head = state.head;
  return JSON.stringify(payload, null, 2);
}

function endpointId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.id || null;
  return null;
}

function linkEnds(link) {
  if (!link || (link.kind && link.kind !== 'import')) return null;
  const source = endpointId(link.source ?? link.s ?? link.from);
  const target = endpointId(link.target ?? link.t ?? link.to);
  if (!source || !target || source === target) return null;
  return { source, target };
}

function pushAdj(map, from, to) {
  let list = map.get(from);
  if (!list) {
    list = [];
    map.set(from, list);
  }
  if (!list.includes(to)) list.push(to);
}

/**
 * @param {{ nodes?: Array<{id: string}>, links?: Array<{source: string, target: string}> }} graph
 * @param {object} input focus state (seeds, hops, direction, pins, hideTests, base, changed)
 */
export function computeFocusView(graph, input = {}) {
  const state = normalizeFocusState(input);
  const nodesIn = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const nodeIds = new Set();
  for (const node of nodesIn) {
    const id = typeof node === 'string' ? node : node?.id;
    if (id) nodeIds.add(id);
  }

  const changed = state.changed.filter((entry) => nodeIds.has(entry.id));
  const changedById = new Map(changed.map((entry) => [entry.id, entry]));
  const pins = state.pins.filter((id) => nodeIds.has(id));
  const pinSet = new Set(pins);
  const picked = state.seeds.filter((id) => nodeIds.has(id));
  const usePicked = state.seedMode === 'picked' && picked.length >= 2;
  const hideUnlessPinned = (id) => state.hideTests && isTestPath(id) && !pinSet.has(id);
  const changedSeeds = changed.map((entry) => entry.id).filter((id) => !hideUnlessPinned(id));
  const seeds = usePicked ? picked : changedSeeds;
  const seedMode = usePicked ? 'picked' : 'changed';
  const seedSet = new Set(seeds);
  const hops = state.hops;
  const direction = state.direction;
  const hideTests = state.hideTests;

  const outgoing = new Map();
  const incoming = new Map();
  const rawEdges = [];
  const seenEdge = new Set();
  for (const link of graph?.links || []) {
    const ends = linkEnds(link);
    if (!ends || !nodeIds.has(ends.source) || !nodeIds.has(ends.target)) continue;
    const key = `${ends.source}\0${ends.target}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    rawEdges.push(ends);
    pushAdj(outgoing, ends.source, ends.target);
    pushAdj(incoming, ends.target, ends.source);
  }

  const dist = new Map();
  const queue = [];
  for (const id of seeds) {
    dist.set(id, 0);
    queue.push(id);
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const d = dist.get(id);
    if (d >= hops) continue;
    const nexts = direction === 'out'
      ? (outgoing.get(id) || [])
      : direction === 'in'
        ? (incoming.get(id) || [])
        : [...new Set([...(outgoing.get(id) || []), ...(incoming.get(id) || [])])];
    for (const next of nexts) {
      if (!nodeIds.has(next)) continue;
      if (hideTests && isTestPath(next) && !seedSet.has(next)) continue;
      const nd = d + 1;
      if (!dist.has(next) || nd < dist.get(next)) {
        dist.set(next, nd);
        queue.push(next);
      }
    }
  }
  for (const id of pins) {
    if (!dist.has(id)) dist.set(id, null);
  }

  const nodes = [];
  for (const [id, hop] of dist) {
    const entry = changedById.get(id) || null;
    const pinned = pinSet.has(id);
    const numericHop = typeof hop === 'number' ? hop : null;
    let role = 'pin';
    if (seedSet.has(id)) role = 'seed';
    else if (numericHop != null) role = 'neighbor';
    nodes.push({
      id,
      label: shortDirLabel(id),
      hop: numericHop,
      role,
      opacity: hopOpacity(numericHop),
      changed: !!entry,
      gitStatus: entry ? entry.status : null,
      pinned,
      badge: pinned ? (entry ? 'touched' : 'untouched') : null,
    });
  }
  nodes.sort((a, b) => {
    const ah = a.hop == null ? 99 : a.hop;
    const bh = b.hop == null ? 99 : b.hop;
    if (ah !== bh) return ah - bh;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const visible = new Set(nodes.map((node) => node.id));
  const edges = rawEdges
    .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
    .sort((a, b) => (a.source === b.source ? (a.target < b.target ? -1 : 1) : (a.source < b.source ? -1 : 1)));

  const snapshot = {
    seedMode,
    seeds,
    hops,
    direction,
    pins,
    hideTests,
    base: state.base,
    changed,
    head: state.head || '',
    baseSha: state.baseSha || '',
  };

  return {
    state: snapshot,
    seedMode,
    seeds,
    hops,
    direction,
    hideTests,
    base: state.base,
    total: nodesIn.length,
    visibleCount: nodes.length,
    nodes,
    edges,
    summary: focusSummary({
      seedCount: seeds.length,
      hops,
      visible: nodes.length,
      total: nodesIn.length,
    }),
    shaPill: formatShaPill(state.baseSha || state.base, state.head),
  };
}

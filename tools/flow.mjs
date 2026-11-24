/**
 * Pure flow derivation. No git, no network.
 * Entry walk, queue-hop matching, moved-vs-added, and the size cap live here.
 */
import { normalizeBody } from './functions.mjs';

export const FLOW_BOX_CAP = 12;
export const FLOW_COLUMN_CAP = 4;
export const MOVE_SIMILARITY = 0.72;

const JOB_METHODS = new Set(['perform', 'process', 'handle', 'run']);
const STOP_WORDS = new Set(['const', 'return', 'function', 'export', 'async', 'await', 'true', 'false', 'null']);

export function bodyTokens(text) {
  return (String(text || '').toLowerCase().match(/[a-z_][a-z0-9_]*/g) || [])
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** Dice coefficient over identifier sets. 1 is the same vocabulary. */
export function bodySimilarity(a, b) {
  const A = new Set(bodyTokens(a));
  const B = new Set(bodyTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const token of A) if (B.has(token)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

export function normalizeQueueName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/job$/, '');
}

function shortFnLabel(fn) {
  if (!fn) return '';
  const file = String(fn.file || '').split('/').pop();
  const name = fn.className ? `${fn.className}.${fn.name}` : fn.name;
  return `${file}/${name}`;
}

function fileStatusSet(changedFiles) {
  if (!changedFiles) return null;
  const set = new Set();
  for (const item of changedFiles) {
    if (!item) continue;
    if (typeof item === 'string') set.add(item);
    else set.add(item.graphId || item.file || item.path || item.id);
  }
  return set;
}

/**
 * Pair added functions with removed ones whose bodies largely match.
 * A paired head function is `moved` instead of `added`. The removed copy is consumed.
 */
export function pairMoves(added, deleted, threshold = MOVE_SIMILARITY) {
  const pairs = [];
  for (const head of added) {
    for (const base of deleted) {
      const score = bodySimilarity(head.bodyNorm || head.body, base.bodyNorm || base.body);
      const lenA = (head.bodyNorm || '').length;
      const lenB = (base.bodyNorm || '').length;
      const ratio = lenA && lenB ? Math.max(lenA, lenB) / Math.min(lenA, lenB) : 99;
      const tokens = Math.min(bodyTokens(head.bodyNorm).length, bodyTokens(base.bodyNorm).length);
      const need = ratio > 2.2 ? Math.max(threshold, 0.85) : threshold;
      if (score < need) continue;
      if (tokens < 4) continue;
      if (tokens < 6 && score < 0.9) continue;
      pairs.push({ head, base, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedHead = new Set();
  const usedBase = new Set();
  const moves = [];
  for (const pair of pairs) {
    if (usedHead.has(pair.head.id) || usedBase.has(pair.base.id)) continue;
    usedHead.add(pair.head.id);
    usedBase.add(pair.base.id);
    moves.push(pair);
  }
  return moves;
}

/**
 * @param {object[]} baseFns
 * @param {object[]} headFns
 * @param {{ changedFiles?: Array<string|{graphId?: string, file?: string}> }} [options]
 */
export function diffFunctions(baseFns, headFns, options = {}) {
  const changed = fileStatusSet(options.changedFiles);
  const baseById = new Map((baseFns || []).map((fn) => [fn.id, fn]));
  const headById = new Map((headFns || []).map((fn) => [fn.id, fn]));
  const out = [];
  const added = [];
  const deleted = [];

  const consider = (file) => !changed || changed.has(file);

  for (const head of headFns || []) {
    if (!consider(head.file)) {
      out.push({ ...head, status: 'unchanged', bodyNorm: head.bodyNorm || normalizeBody(head.body) });
      continue;
    }
    const prev = baseById.get(head.id);
    if (!prev) {
      added.push(head);
      continue;
    }
    const bodyNorm = head.bodyNorm || normalizeBody(head.body);
    const prevNorm = prev.bodyNorm || normalizeBody(prev.body);
    const status = bodyNorm === prevNorm ? 'unchanged' : 'edited';
    out.push({
      ...head,
      status,
      bodyNorm,
      baseBody: prev.body || '',
      headBody: head.body || '',
    });
  }

  for (const base of baseFns || []) {
    if (headById.has(base.id)) continue;
    if (!consider(base.file)) continue;
    deleted.push(base);
  }

  const moves = pairMoves(added, deleted);
  const movedBase = new Set(moves.map((pair) => pair.base.id));
  const movedHead = new Map(moves.map((pair) => [pair.head.id, pair.base]));

  for (const head of added) {
    const from = movedHead.get(head.id);
    if (from) {
      out.push({
        ...head,
        status: 'moved',
        movedFrom: from.id,
        movedFromLabel: shortFnLabel(from),
        bodyNorm: head.bodyNorm || normalizeBody(head.body),
        baseBody: from.body || '',
        headBody: head.body || '',
      });
    } else {
      out.push({
        ...head,
        status: 'added',
        bodyNorm: head.bodyNorm || normalizeBody(head.body),
        headBody: head.body || '',
      });
    }
  }

  for (const base of deleted) {
    if (movedBase.has(base.id)) continue;
    out.push({
      ...base,
      status: 'deleted',
      bodyNorm: base.bodyNorm || normalizeBody(base.body),
      baseBody: base.body || '',
    });
  }

  return out;
}

/**
 * Match a dispatch-by-name string to a job class or handler.
 * Prefers the class's perform/process/handle/run method.
 */
export function matchQueueTarget(queueName, functions) {
  const needle = normalizeQueueName(queueName);
  if (!needle) return null;
  const hits = [];
  for (const fn of functions || []) {
    const fields = [fn.queueName, fn.className, fn.name, fileBase(fn.file)];
    let score = 0;
    for (const field of fields) {
      if (!field) continue;
      if (normalizeQueueName(field) !== needle) continue;
      score = Math.max(score, field === fn.queueName || field === fn.className ? 3 : 1);
    }
    if (!score) continue;
    if (fn.entryKind === 'job') score += 2;
    if (JOB_METHODS.has(fn.name)) score += 2;
    hits.push({ fn, score });
  }
  hits.sort((a, b) => b.score - a.score || String(a.fn.id).localeCompare(String(b.fn.id)));
  return hits[0]?.fn || null;
}

function fileBase(file) {
  return String(file || '').split('/').pop().replace(/\.[^.]+$/, '');
}

function callKey(call) {
  return [
    call.from,
    call.to || '',
    call.kind,
    call.queueName || '',
    call.table || '',
    call.access || '',
    call.mode || '',
    call.callee || '',
  ].join('|');
}

/**
 * Resolve queue hops and data links on top of direct calls.
 * Direct calls keep `to`. A queue edge points at the matched handler.
 * A data edge points from a writer to a reader of the same table.
 */
export function buildEdges(functions, calls) {
  const byId = new Map((functions || []).map((fn) => [fn.id, fn]));
  const edges = [];
  const seen = new Set();
  const data = [];

  const push = (edge) => {
    if (!edge.from || !edge.to || edge.from === edge.to) return;
    if (!byId.has(edge.from) || !byId.has(edge.to)) return;
    const key = `${edge.kind}|${edge.from}|${edge.to}|${edge.mode || ''}|${edge.table || ''}|${edge.queueName || ''}`;
    if (seen.has(key)) {
      const prev = edges.find((item) => item.key === key);
      if (prev && edge.fresh === false) prev.fresh = false;
      return;
    }
    seen.add(key);
    edges.push({ key, ...edge });
  };

  for (const call of calls || []) {
    if (call.kind === 'data') {
      data.push(call);
      continue;
    }
    if (call.kind === 'queue') {
      const target = matchQueueTarget(call.queueName, functions);
      if (!target) continue;
      push({
        from: call.from,
        to: target.id,
        kind: 'queue',
        queueName: call.queueName,
        mode: call.mode || null,
        fresh: call.side !== 'base' && call.side !== 'both',
        label: 'queued',
      });
      continue;
    }
    if (!call.to) continue;
    push({
      from: call.from,
      to: call.to,
      kind: 'call',
      mode: call.mode || null,
      fresh: call.side !== 'base' && call.side !== 'both',
      callee: call.callee || null,
      label: call.mode || null,
    });
  }

  // Collapse head+base duplicates into one edge that is not "fresh".
  const groups = new Map();
  for (const call of calls || []) {
    if (call.kind === 'queue' || call.kind === 'data' || !call.to) continue;
    const key = callKey({ ...call, kind: 'call' });
    const group = groups.get(key) || { sides: new Set() };
    group.sides.add(call.side || 'head');
    groups.set(key, group);
  }
  for (const edge of edges) {
    if (edge.kind !== 'call') continue;
    const group = groups.get(callKey({
      from: edge.from,
      to: edge.to,
      kind: 'call',
      mode: edge.mode,
      callee: edge.callee,
    }));
    if (group && (group.sides.has('base') || group.sides.has('both'))) edge.fresh = false;
    if (group && group.sides.has('head') && !group.sides.has('base') && !group.sides.has('both')) edge.fresh = true;
  }

  const byTable = new Map();
  for (const call of data) {
    if (!call.table || !call.from || !byId.has(call.from)) continue;
    const bucket = byTable.get(call.table) || { writers: [], readers: [] };
    const row = {
      from: call.from,
      columns: call.columns || [],
      side: call.side || 'head',
    };
    if (call.access === 'write') bucket.writers.push(row);
    else if (call.access === 'read') bucket.readers.push(row);
    byTable.set(call.table, bucket);
  }
  for (const [table, bucket] of byTable) {
    const pairs = [];
    for (const writer of bucket.writers) {
      for (const reader of bucket.readers) {
        if (writer.from === reader.from) continue;
        const columns = (writer.columns || []).filter((col) => (reader.columns || []).includes(col));
        pairs.push({ writer, reader, columns });
      }
    }
    const changed = new Set((functions || []).filter((fn) => fn.status && fn.status !== 'unchanged').map((fn) => fn.id));
    const limited = pairs.length > 8
      ? pairs.filter((pair) => changed.has(pair.writer.from) || changed.has(pair.reader.from)).slice(0, 8)
      : pairs;
    for (const pair of limited) {
      push({
        from: pair.writer.from,
        to: pair.reader.from,
        kind: 'data',
        table,
        columns: pair.columns,
        fresh: false,
        label: 'data',
      });
    }
  }

  return edges.map(({ key, ...edge }) => edge);
}

function adjacency(edges, kinds) {
  const out = new Map();
  const inn = new Map();
  for (const edge of edges) {
    if (kinds && !kinds.has(edge.kind)) continue;
    if (!out.has(edge.from)) out.set(edge.from, []);
    if (!inn.has(edge.to)) inn.set(edge.to, []);
    out.get(edge.from).push(edge);
    inn.get(edge.to).push(edge);
  }
  return { out, inn };
}

function isChanged(fn) {
  return !!fn && fn.status && fn.status !== 'unchanged';
}

function walkRoots(fnId, inn, byId) {
  const roots = [];
  const seen = new Set();
  const stack = [{ id: fnId, depth: 0 }];
  while (stack.length) {
    const { id, depth } = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const fn = byId.get(id);
    if (!fn) continue;
    const callers = inn.get(id) || [];
    if (fn.entryKind || callers.length === 0 || depth >= 8) {
      roots.push(id);
      if (fn.entryKind || callers.length === 0) continue;
    }
    for (const edge of callers) stack.push({ id: edge.from, depth: depth + 1 });
  }
  return roots;
}

function forwardCone(root, out, limit) {
  const seen = new Set();
  const stack = [{ id: root, depth: 0 }];
  while (stack.length) {
    const { id, depth } = stack.pop();
    if (!id || seen.has(id) || depth > limit) continue;
    seen.add(id);
    for (const edge of out.get(id) || []) stack.push({ id: edge.to, depth: depth + 1 });
  }
  return seen;
}

function canReachChanged(cone, inn, changedSet) {
  const keep = new Set();
  const stack = [];
  for (const id of changedSet) if (cone.has(id)) stack.push(id);
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (!cone.has(id) || seen.has(id)) continue;
    seen.add(id);
    keep.add(id);
    for (const edge of inn.get(id) || []) stack.push(edge.from);
  }
  return keep;
}

function columnTitle(fns) {
  const entry = fns.find((fn) => fn.onPath && fn.entryKind);
  if (entry?.entryKind === 'route') return 'route · entry';
  if (entry?.entryKind === 'job') return 'job · entry';
  if (entry?.entryKind === 'cli') return 'cli · entry';
  if (entry?.entryKind === 'cron') return 'cron · entry';
  if (entry?.entryKind === 'webhook') return 'webhook · entry';
  if (entry?.entryKind === 'mcp') return 'mcp · entry';
  if (entry?.entryKind === 'handler') return 'handler · entry';
  const lead = fns.find((fn) => fn.onPath) || fns[0];
  if (!lead) return 'step';
  if (lead.kind === 'method' && lead.className) return `${lead.className}.${lead.name}`;
  return lead.name;
}

function displayName(fn) {
  if (fn.entryKind === 'route' && fn.entryLabel) return fn.entryLabel;
  if (fn.className) return `${fn.className}.${fn.name}()`;
  return `${fn.name}()`;
}

function marksFor(status) {
  if (status === 'deleted') return { pr: 'deleted', before: 'present', main: 'present' };
  if (status === 'added') return { pr: 'added', before: 'future', main: 'future' };
  if (status === 'moved') return { pr: 'moved', before: 'future', main: 'future' };
  if (status === 'edited') return { pr: 'edited', before: 'present', main: 'present' };
  return { pr: 'unchanged', before: 'unchanged', main: 'unchanged' };
}

function layoutFlow(rootIds, functions, edges, byId, changedIds) {
  const { out, inn } = adjacency(edges, new Set(['call', 'queue']));
  const changedSet = changedIds || new Set(functions.filter(isChanged).map((fn) => fn.id));
  const cone = new Set();
  for (const root of rootIds) {
    for (const id of forwardCone(root, out, 10)) cone.add(id);
  }
  const keep = canReachChanged(cone, inn, changedSet);
  for (const root of rootIds) if (byId.has(root)) keep.add(root);

  // Queue and data targets of a kept function stay visible even when unchanged.
  for (const edge of edges) {
    if (!keep.has(edge.from)) continue;
    if (edge.kind === 'queue' || edge.kind === 'data') keep.add(edge.to);
  }
  // Deleted callees of a kept function stay as ghosts.
  for (const edge of edges) {
    if (!keep.has(edge.from)) continue;
    const target = byId.get(edge.to);
    if (target?.status === 'deleted') keep.add(edge.to);
  }

  const depth = new Map();
  const queue = rootIds.filter((id) => keep.has(id)).map((id) => ({ id, d: 0 }));
  const seen = new Set();
  while (queue.length) {
    const { id, d } = queue.shift();
    if (seen.has(id) || !keep.has(id)) continue;
    seen.add(id);
    depth.set(id, d);
    for (const edge of out.get(id) || []) {
      if (!keep.has(edge.to) || seen.has(edge.to)) continue;
      queue.push({ id: edge.to, d: d + 1 });
    }
  }
  for (const edge of edges) {
    if (edge.kind !== 'data' || !keep.has(edge.to) || !depth.has(edge.from)) continue;
    if (!depth.has(edge.to)) depth.set(edge.to, depth.get(edge.from) + 1);
  }
  let fallback = 0;
  for (const value of depth.values()) fallback = Math.max(fallback, value);
  for (const id of keep) if (!depth.has(id)) depth.set(id, fallback);

  const alsoCalled = [];
  const alsoIds = new Set();
  for (const id of keep) {
    const extras = [];
    for (const edge of out.get(id) || []) {
      if (edge.kind !== 'call') continue;
      if (keep.has(edge.to)) continue;
      const fn = byId.get(edge.to);
      if (!fn || isChanged(fn) || fn.entryKind) continue;
      extras.push({ id: fn.id, name: displayName(fn), file: fn.file });
      alsoIds.add(fn.id);
    }
    if (extras.length) alsoCalled.push({ id, calls: extras });
  }

  const dimmed = [];
  const filesInFlow = new Set([...keep].map((id) => byId.get(id)?.file).filter(Boolean));
  for (const fn of functions) {
    if (!filesInFlow.has(fn.file)) continue;
    if (keep.has(fn.id) || alsoIds.has(fn.id) || isChanged(fn)) continue;
    if (dimmed.filter((item) => item.file === fn.file).length >= 4) continue;
    dimmed.push(fn);
  }

  const boxes = [];
  for (const id of keep) {
    const fn = byId.get(id);
    if (!fn) continue;
    boxes.push(boxFrom(fn, depth.get(id) || 0, true));
  }
  for (const fn of dimmed) {
    const siblings = boxes.filter((box) => box.file === fn.file && box.onPath);
    const column = siblings.length ? Math.min(...siblings.map((box) => box.column)) : 0;
    boxes.push(boxFrom(fn, column, false));
  }

  const maxColumn = boxes.reduce((max, box) => Math.max(max, box.column), 0);
  const columns = [];
  for (let i = 0; i <= maxColumn; i += 1) {
    const inCol = boxes.filter((box) => box.column === i);
    const byFile = new Map();
    for (const box of inCol) {
      if (!byFile.has(box.file)) byFile.set(box.file, []);
      byFile.get(box.file).push(box);
    }
    const files = [...byFile.entries()].map(([file, fns]) => ({
      file,
      functions: fns.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name)),
    }));
    files.sort((a, b) => a.file.localeCompare(b.file));
    columns.push({
      index: i,
      label: columnTitle(inCol),
      files,
    });
  }

  const steps = boxes
    .filter((box) => box.onPath)
    .sort((a, b) => a.column - b.column || a.file.localeCompare(b.file) || a.line - b.line)
    .map((box, index) => ({
      n: index + 1,
      id: box.id,
      name: box.name,
      label: box.label,
      file: box.file,
      column: box.column,
      entryKind: box.entryKind,
      entryLabel: box.entryLabel,
      status: box.status,
      hint: stepHint(box.id, edges, byId, keep),
    }));

  const visibleEdges = edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to));
  for (const column of columns) {
    for (const file of column.files) {
      for (const box of file.functions) {
        box.calls = relation(visibleEdges, box.id, 'from', byId);
        box.calledBy = relation(visibleEdges, box.id, 'to', byId);
      }
    }
  }

  return {
    steps,
    columns,
    edges: visibleEdges,
    alsoCalled,
    boxCount: boxes.length,
    columnCount: columns.length,
    rootIds,
  };
}

function relation(edges, id, side, byId) {
  const key = side === 'from' ? 'from' : 'to';
  const other = side === 'from' ? 'to' : 'from';
  return edges.filter((edge) => edge[key] === id).map((edge) => {
    const fn = byId.get(edge[other]);
    return {
      id: edge[other],
      name: fn ? displayName(fn) : edge[other],
      file: fn?.file || '',
      kind: edge.kind,
      mode: edge.mode || null,
      label: edge.label || null,
      table: edge.table || null,
    };
  });
}

function stepHint(id, edges, byId, keep) {
  const outgoing = edges.filter((edge) => edge.from === id && keep.has(edge.to) && (edge.kind === 'call' || edge.kind === 'queue'));
  const next = outgoing.find((edge) => edge.kind === 'call' && edge.fresh)
    || outgoing.find((edge) => edge.kind === 'call')
    || outgoing[0];
  if (!next) return '';
  const fn = byId.get(next.to);
  if (!fn) return '';
  if (next.kind === 'queue') return `queued ${displayName(fn)}`;
  return `→ ${displayName(fn)}`;
}

function boxFrom(fn, column, onPath) {
  return {
    id: fn.id,
    file: fn.file,
    name: fn.name,
    label: displayName(fn),
    className: fn.className,
    kind: fn.kind,
    line: fn.line,
    endLine: fn.endLine,
    signature: fn.signature,
    doc: fn.doc || '',
    exported: !!fn.exported,
    entryKind: fn.entryKind,
    entryLabel: fn.entryLabel,
    status: fn.status || 'unchanged',
    movedFrom: fn.movedFrom || null,
    movedFromLabel: fn.movedFromLabel || null,
    marks: marksFor(fn.status || 'unchanged'),
    column,
    onPath,
    dimmed: !onPath,
    body: fn.body || '',
    baseBody: fn.baseBody || '',
    headBody: fn.headBody || '',
  };
}

function componentKey(ids) {
  return [...ids].sort().join('|');
}

/**
 * @param {{ functions: object[], calls: object[] }} model
 * @param {{ focusId?: string }} [options]
 */
export function deriveFlows(model, options = {}) {
  const functions = model?.functions || [];
  const byId = new Map(functions.map((fn) => [fn.id, fn]));
  const edges = buildEdges(functions, model?.calls || []);
  const { out, inn } = adjacency(edges, new Set(['call', 'queue']));
  const changed = functions.filter(isChanged);
  const focusId = options.focusId && byId.has(options.focusId) ? options.focusId : null;
  const seeds = focusId ? [byId.get(focusId)] : changed;
  const focusChanged = focusId ? new Set([focusId]) : null;

  const groups = new Map();
  for (const fn of seeds) {
    let roots = walkRoots(fn.id, inn, byId);
    if (!roots.length) roots = [fn.id];
    if (focusId) {
      roots = roots.filter((root) => forwardCone(root, out, 10).has(focusId));
      if (!roots.length) roots = [fn.id];
    }
    const key = componentKey(roots);
    const group = groups.get(key) || { roots: new Set(), seeds: [] };
    for (const root of roots) group.roots.add(root);
    group.seeds.push(fn.id);
    groups.set(key, group);
  }

  let flows = [...groups.values()].map((group) => {
    const laid = layoutFlow([...group.roots], functions, edges, byId, focusChanged);
    const entry = laid.steps.find((step) => step.entryKind) || laid.steps[0];
    return {
      id: '',
      title: entry?.entryLabel || entry?.label || 'Flow',
      boxCount: laid.boxCount,
      columnCount: laid.columnCount,
      steps: laid.steps,
      columns: laid.columns,
      edges: laid.edges,
      alsoCalled: laid.alsoCalled,
      rootIds: laid.rootIds,
      seeds: group.seeds,
    };
  });

  flows.sort((a, b) => (b.seeds.length - a.seeds.length) || a.title.localeCompare(b.title));
  flows = flows.map((flow, index) => ({ ...flow, id: `flow-${index + 1}` }));

  const tooBig = (flow) => flow.boxCount > FLOW_BOX_CAP || flow.columnCount > FLOW_COLUMN_CAP;
  let capped = !focusId && flows.some(tooBig);
  if (focusId && flows[0] && tooBig(flows[0])) {
    flows[0] = truncateFlow(flows[0], focusId);
    flows[0].truncated = true;
    capped = false;
  }

  const index = changed
    .map((fn) => ({
      id: fn.id,
      name: fn.className ? `${fn.className}.${fn.name}` : fn.name,
      file: fn.file,
      line: fn.line,
      status: fn.status,
      movedFromLabel: fn.movedFromLabel || null,
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  return {
    capped,
    focused: !!focusId,
    boxCap: FLOW_BOX_CAP,
    columnCap: FLOW_COLUMN_CAP,
    index,
    flows,
  };
}

function truncateFlow(flow, focusId) {
  const keepCols = new Set();
  const focus = flow.steps.find((step) => step.id === focusId);
  const focusCol = focus?.column ?? 0;
  for (const step of flow.steps) {
    if (step.column <= focusCol) keepCols.add(step.column);
    if (step.column === focusCol + 1 && step.id !== focusId) keepCols.add(step.column);
  }
  keepCols.add(0);
  keepCols.add(focusCol);
  const columns = flow.columns.filter((col) => keepCols.has(col.index));
  const ids = new Set();
  for (const col of columns) {
    for (const file of col.files) {
      file.functions = file.functions.filter((fn) => fn.onPath || fn.id === focusId || fn.column === focusCol);
      for (const fn of file.functions) ids.add(fn.id);
    }
  }
  const steps = flow.steps.filter((step) => ids.has(step.id)).map((step, index) => ({ ...step, n: index + 1 }));
  const boxCount = columns.reduce((sum, col) => sum + col.files.reduce((n, file) => n + file.functions.length, 0), 0);
  return {
    ...flow,
    columns,
    steps,
    edges: flow.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    boxCount,
    columnCount: columns.length,
  };
}

function firstSentence(text) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  return (match ? match[1] : clean).slice(0, 240);
}

function sentenceFromName(fn) {
  if (fn.entryKind === 'route' && fn.entryLabel) return `Handles ${fn.entryLabel}.`;
  if (fn.entryKind === 'job') return `Runs the ${fn.entryLabel || fn.name} job.`;
  if (fn.entryKind === 'cli') return `Command entry ${fn.entryLabel || fn.name}.`;
  if (fn.entryKind === 'cron') return `Cron entry ${fn.entryLabel || fn.name}.`;
  if (fn.entryKind === 'webhook') return `Webhook entry ${fn.entryLabel || fn.name}.`;
  if (fn.entryKind === 'mcp') return `MCP tool ${fn.entryLabel || fn.name}.`;
  const words = String(fn.name || 'function')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return `Handles ${words}.`;
}

function changeSentence(fn) {
  if (fn.status === 'added') return addedSummary(fn) || 'New in this PR.';
  if (fn.status === 'deleted') return 'Removed in this PR.';
  if (fn.status === 'moved') return `Moved from ${fn.movedFromLabel || 'another file'}.`;
  if (fn.status === 'edited') return addedSummary(fn) || 'Edits this function.';
  return 'Unchanged in this PR.';
}

function addedSummary(fn) {
  const head = String(fn.headBody || fn.body || '');
  const base = String(fn.baseBody || '');
  const fresh = head.split('\n').filter((line) => {
    const text = line.trim();
    return text && !base.split('\n').some((prev) => prev.trim() === text);
  }).join('\n');
  const bits = [];
  if (/\benqueueJob\s*\(|\.enqueue\s*\(|\.add\s*\(\s*['"`]/.test(fresh)) bits.push('enqueues a job by name');
  if (/prisma\s*\.\s*\w+\s*\.\s*(create|update|upsert|delete)/.test(fresh) || /\bINSERT\s+INTO\b/i.test(fresh)) {
    bits.push('writes the database');
  }
  if (/prisma\s*\.\s*\w+\s*\.\s*find/.test(fresh) || /\bSELECT\b/i.test(fresh)) bits.push('reads the database');
  if (/\bswitch\s*\(/.test(fresh)) bits.push('branches on a mode');
  if (!bits.length) return '';
  const sentence = `This PR ${bits.join(' and ')}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function diffSnippet(fn) {
  const baseLines = String(fn.baseBody || '').split('\n');
  const headLines = String(fn.headBody || fn.body || '').split('\n');
  const baseSet = new Set(baseLines.map((line) => line.trim()).filter(Boolean));
  const headSet = new Set(headLines.map((line) => line.trim()).filter(Boolean));
  const out = [];
  if (fn.status === 'deleted') {
    for (const line of baseLines) {
      if (!line.trim()) continue;
      out.push({ type: 'del', text: line });
      if (out.length >= 8) break;
    }
    return out;
  }
  for (const line of baseLines) {
    if (!line.trim() || headSet.has(line.trim())) continue;
    out.push({ type: 'del', text: line });
    if (out.length >= 8) return out;
  }
  for (const line of headLines) {
    if (!line.trim() || baseSet.has(line.trim())) continue;
    out.push({ type: 'add', text: line });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Heuristic explain text. `hooks.summarize` may replace the sentences later.
 * It is not called unless the host passes it. This module never calls a model.
 */
export function explainFunction(fn, hooks = {}) {
  const custom = typeof hooks.summarize === 'function' ? hooks.summarize(fn) : null;
  const snippet = fn.diffSnippet || diffSnippet(fn);
  return {
    id: fn.id,
    file: fn.file,
    line: fn.line,
    signature: fn.signature || fn.label || fn.name,
    whatItDoes: (custom && custom.whatItDoes) || firstSentence(fn.doc) || sentenceFromName(fn),
    whatChanged: (custom && custom.whatChanged) || changeSentence(fn),
    diff: snippet,
    calls: fn.calls || [],
    calledBy: fn.calledBy || [],
  };
}

/** Replace main-now marks when a merged branch can be read. Layout stays put. */
export function applyMainMarks(view, mainByNorm) {
  if (!view || !mainByNorm) return view;
  const visit = (box) => {
    const mainNorm = mainByNorm.get(box.id);
    if (mainNorm == null) {
      box.marks = { ...box.marks, main: box.status === 'deleted' ? 'deleted' : 'future' };
      return;
    }
    const headNorm = normalizeBody(box.headBody || box.body);
    box.marks = { ...box.marks, main: mainNorm === headNorm ? box.marks.pr : 'edited' };
  };
  for (const flow of view.flows || []) {
    for (const column of flow.columns || []) {
      for (const file of column.files || []) {
        for (const box of file.functions || []) visit(box);
      }
    }
  }
  return view;
}

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readFlowParams, writeExplorerParams } from './explorerView.js';
import { ExplorerChrome } from './ExplorerChrome.jsx';
import { bodyDiffCounts, fillFractions } from './diffMark.js';
import './explorer.css';

function markView(box, mode) {
  const mark = box?.marks?.[mode] || box?.marks?.pr || 'unchanged';
  if (mark === 'future') return { tag: null, ghost: false, fade: true };
  if (mark === 'present' || mark === 'unchanged') return { tag: null, ghost: false, fade: false };
  if (mark === 'deleted') return { tag: 'deleted', ghost: true, fade: true };
  if (mark === 'moved') return { tag: 'moved', ghost: false, fade: false };
  if (mark === 'added' || mark === 'edited') return { tag: mark, ghost: false, fade: false };
  return { tag: null, ghost: false, fade: false };
}

function edgePaint(edge, onPath) {
  if (edge.kind === 'queue') return { color: '#c9b896', dash: '1.5 4', label: 'queued' };
  if (edge.kind === 'data') return { color: edge.fresh ? '#58d68d' : '#6ec8d4', dash: '5 4', label: edge.table ? `data ${edge.table}` : 'data' };
  if (edge.fresh) return { color: '#58d68d', dash: '5 4', label: edge.mode || '' };
  if (onPath) return { color: '#9184d9', dash: null, label: edge.mode || '' };
  return { color: '#4d5272', dash: null, label: edge.mode || '' };
}

function findBox(flow, id) {
  if (!flow || !id) return null;
  for (const column of flow.columns || []) {
    for (const file of column.files || []) {
      const hit = file.functions.find((fn) => fn.id === id);
      if (hit) return hit;
    }
  }
  return null;
}

function splitPath(file) {
  const slash = String(file || '').lastIndexOf('/');
  if (slash < 0) return { dir: '', name: file || '' };
  return { dir: file.slice(0, slash + 1), name: file.slice(slash + 1) };
}

function fnStats(fn) {
  if (fn.adds != null || fn.dels != null) {
    return { adds: fn.adds || 0, dels: fn.dels || 0, lines: fn.fnLines || fn.adds || 1 };
  }
  const counts = bodyDiffCounts(fn.baseBody, fn.headBody || fn.body, fn.status);
  const span = fn.endLine && fn.line ? Math.max(1, fn.endLine - fn.line + 1) : counts.lines;
  return { ...counts, lines: span };
}

function ancestorsOf(flow, selectedId) {
  const keep = new Set();
  if (!selectedId) return keep;
  const incoming = new Map();
  for (const edge of flow?.edges || []) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge.from);
  }
  const stack = [selectedId];
  keep.add(selectedId);
  while (stack.length) {
    const id = stack.pop();
    for (const src of incoming.get(id) || []) {
      if (keep.has(src)) continue;
      keep.add(src);
      stack.push(src);
    }
  }
  for (const edge of flow?.edges || []) {
    if (edge.from === selectedId) keep.add(edge.to);
  }
  return keep;
}

function DiffSquare({ adds, dels, lines, status, size }) {
  const mapped = status === 'added' || status === 'A' || status === 'moved' ? 'A'
    : status === 'deleted' || status === 'D' ? 'D' : status;
  const fr = fillFractions(adds, dels, lines, mapped);
  const radius = Math.max(3, size * 0.22);
  if (!fr) {
    return <span className="dsq hollow" style={{ width: size, height: size, borderRadius: radius }} />;
  }
  const g = (fr.g || 0) * 100;
  const r = (fr.r || 0) * 100;
  const redPct = Math.max(r, dels > 0 ? (2.5 / size) * 100 : 0);
  return (
    <span className="dsq" style={{ width: size, height: size, borderRadius: radius }}>
      {g > 0 && <i style={{ bottom: 0, height: `${g}%`, background: 'rgba(46,255,122,.85)' }} />}
      {r > 0 && <i style={{ bottom: `${g}%`, height: `${redPct}%`, background: 'rgba(255,77,94,.9)' }} />}
    </span>
  );
}

/** Fan-out from one box gets separate ports and a vertical lane in the gutter. */
function spreadEdges(edges) {
  const groups = new Map();
  edges.forEach((edge, index) => {
    edge.lane = 0;
    const key = `${edge.sameCol ? 'c' : 'x'}:${edge.from}`;
    const list = groups.get(key) || [];
    list.push({ edge, index });
    groups.set(key, list);
  });
  for (const list of groups.values()) {
    list.sort((a, b) => a.edge.y2 - b.edge.y2 || String(a.edge.kind).localeCompare(String(b.edge.kind)) || a.index - b.index);
    const n = list.length;
    list.forEach((item, i) => {
      const lane = i - (n - 1) / 2;
      item.edge.lane = lane;
      item.edge.slot = i;
      item.edge.slots = n;
      if (n > 1) item.edge.y1 += lane * 6;
    });
  }
  return edges;
}

export function FlowView({
  root, gitInfo, focusFile, focusToken, onShowInGraph, onOpenSource,
  onView, menu, graphApi, repo,
}) {
  const initial = readFlowParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [flowNo, setFlowNo] = useState(initial.flow);
  const [mark, setMark] = useState(initial.mark);
  const [selectedId, setSelectedId] = useState(initial.fn);
  const [scope, setScope] = useState(initial.scope);
  const [arrows, setArrows] = useState([]);
  const [laidOut, setLaidOut] = useState(0);
  const [scale, setScale] = useState(1);
  const [hoverId, setHoverId] = useState('');
  const canvasRef = useRef(null);
  const arrowSig = useRef('');
  const jumpToken = useRef(0);

  useEffect(() => {
    writeExplorerParams({
      view: 'flow',
      flow: String(flowNo || 1),
      fn: selectedId || '',
      mark: mark === 'pr' ? '' : mark,
      scope: scope || '',
    });
  }, [flowNo, selectedId, mark, scope]);

  useEffect(() => {
    if (!root) return undefined;
    let cancel = false;
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ root });
    if (gitInfo?.pr?.number) qs.set('pr', String(gitInfo.pr.number));
    else if (gitInfo?.baseLabel || gitInfo?.base) qs.set('base', gitInfo.baseLabel || gitInfo.base);
    if (scope) qs.set('fn', scope);
    document.documentElement.dataset.explorerView = 'flow';
    document.documentElement.dataset.explorerReady = '0';
    fetch(`/api/flow?${qs}`)
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (cancel) return;
        if (!ok) throw new Error(body?.error || 'Could not build the flow');
        setData(body);
      })
      .catch((err) => {
        if (!cancel) setError(err.message || String(err));
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => { cancel = true; };
  }, [root, gitInfo?.pr?.number, gitInfo?.baseLabel, gitInfo?.base, gitInfo?.headSha, scope]);

  const flows = data?.flows || [];
  const showingIndex = !!(data?.capped && !scope);
  const flow = flows[Math.min(flows.length, Math.max(1, flowNo)) - 1] || flows[0] || null;

  useEffect(() => {
    if (!focusToken || focusToken === jumpToken.current || !data || !focusFile) return;
    jumpToken.current = focusToken;
    const inIndex = (data.index || []).find((item) => item.file === focusFile);
    if (data.capped && inIndex) {
      setScope(inIndex.id);
      setSelectedId(inIndex.id);
      return;
    }
    for (let i = 0; i < (data.flows || []).length; i += 1) {
      const box = (data.flows[i].columns || []).flatMap((column) => column.files.flatMap((file) => file.functions))
        .find((fn) => fn.file === focusFile);
      if (box) {
        setFlowNo(i + 1);
        setSelectedId(box.id);
        return;
      }
    }
  }, [focusToken, focusFile, data]);

  useEffect(() => {
    if (mark === 'main' && data && !data.merged) setMark('before');
  }, [data, mark]);

  const selected = findBox(flow, selectedId);
  const keep = useMemo(() => ancestorsOf(flow, selectedId), [flow, selectedId]);
  const alsoById = useMemo(() => {
    const map = new Map();
    for (const row of flow?.alsoCalled || []) map.set(row.id, row.calls);
    return map;
  }, [flow]);
  const gitByFile = useMemo(() => {
    const map = new Map();
    for (const file of gitInfo?.files || []) {
      if (file.graphId) map.set(file.graphId, file);
      if (file.path) map.set(file.path, file);
    }
    return map;
  }, [gitInfo]);

  useLayoutEffect(() => {
    document.documentElement.dataset.explorerView = 'flow';
    const rootEl = canvasRef.current;
    if (!rootEl || !flow || showingIndex) {
      const token = showingIndex ? 'index' : 'empty';
      if (arrowSig.current !== token) {
        arrowSig.current = token;
        document.documentElement.dataset.explorerReady = '0';
        setArrows([]);
        setLaidOut(token);
      }
      return undefined;
    }
    const origin = rootEl.getBoundingClientRect();
    const next = [];
    for (const edge of flow.edges || []) {
      const from = rootEl.querySelector(`[data-fn="${CSS.escape(edge.from)}"]`);
      const to = rootEl.querySelector(`[data-fn="${CSS.escape(edge.to)}"]`);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const sameCol = b.left < a.right - 8;
      next.push({
        ...edge,
        sameCol,
        x1: Math.round((sameCol ? a.left : a.right) - origin.left),
        y1: Math.round(a.top + a.height / 2 - origin.top),
        x2: Math.round(b.left - origin.left),
        y2: Math.round(b.top + b.height / 2 - origin.top),
      });
    }
    spreadEdges(next);
    const sig = `${flow.id}:${scale}:${next.map((edge) => `${edge.kind}:${edge.from}:${edge.to}:${edge.x1}:${edge.y1}:${edge.x2}:${edge.y2}:${edge.lane || 0}`).join('|')}`;
    if (arrowSig.current !== sig) {
      arrowSig.current = sig;
      document.documentElement.dataset.explorerReady = '0';
      setArrows(next);
      setLaidOut(sig || 'drawn');
    }
    return undefined;
  }, [flow, mark, showingIndex, data, selectedId, scale]);

  useEffect(() => {
    if (loading || error || !laidOut) return undefined;
    const id = requestAnimationFrame(() => {
      document.documentElement.dataset.explorerView = 'flow';
      document.documentElement.dataset.explorerReady = '1';
    });
    return () => cancelAnimationFrame(id);
  }, [loading, error, laidOut]);

  const modes = data?.modes || [
    { id: 'before', label: 'main' },
    { id: 'pr', label: 'this PR' },
  ];
  const steps = flow?.steps || [];
  const stepIndex = steps.findIndex((step) => step.id === selectedId);
  const changedFns = (flow?.columns || []).flatMap((column) => column.files.flatMap((file) => file.functions))
    .filter((fn) => fn.status && fn.status !== 'unchanged').length;
  const newCalls = (flow?.edges || []).filter((edge) => edge.fresh).length;
  const risky = (flow?.edges || []).filter((edge) => edge.fresh && (edge.kind === 'queue' || edge.kind === 'data')).length;
  const colW = Math.round(270 * scale);

  function fileStat(file) {
    const git = gitByFile.get(file.file);
    let adds = Number(git?.additions) || 0;
    let dels = Number(git?.deletions) || 0;
    let lines = 0;
    if (!git) {
      for (const fn of file.functions) {
        const stats = fnStats(fn);
        adds += stats.adds;
        dels += stats.dels;
        lines = Math.max(lines, stats.lines);
      }
    }
    for (const fn of file.functions) lines = Math.max(lines, fn.endLine || 0);
    const status = git?.status || (adds && !dels ? 'A' : dels && !adds ? 'D' : (adds + dels ? 'M' : ''));
    return { adds, dels, lines: lines || git?.lines || adds || dels || 24, status };
  }

  const status = showingIndex
    ? 'This change is wide · open one function'
    : `Flow ${flows.length ? Math.min(flowNo, flows.length) : 1} of ${Math.max(flows.length, 1)}${flow ? ` · ${flow.boxCount || ''} boxes` : ''}`;

  return (
    <div className={`ex-root${selected ? ' sheet-open' : ''}`}>
      <ExplorerChrome
        view="flow"
        onView={onView}
        git={gitInfo}
        repo={repo || data?.repo}
        status={status}
        summary={flow && !showingIndex ? { kind: 'flow', functions: changedFns, calls: newCalls, risky } : null}
        zoom={`${Math.round(scale * 100)}%`}
        onZoomIn={() => setScale((s) => Math.min(1.8, Math.round((s + 0.1) * 10) / 10))}
        onZoomOut={() => setScale((s) => Math.max(0.6, Math.round((s - 0.1) * 10) / 10))}
        api={graphApi}
        menu={menu}
        sheetOpen={!!selected}
        mark={{ value: mark, modes, onChange: setMark }}
      />
      <div className="ex-stage">
        <div className="flow-scroll">
          {loading && <div className="flow-empty">Reading functions…</div>}
          {!loading && error && <div className="flow-empty">{error}</div>}
          {!loading && !error && data && !flows.length && (
            <div className="flow-empty">No changed functions to lay out against {data.baseLabel || 'the compare base'}.</div>
          )}
          {!loading && !error && showingIndex && (
            <div className="flow-index">
              <div style={{ fontSize: 16, marginBottom: 6 }}>This change is wide</div>
              <div style={{ fontSize: 12.5, color: '#b2b6ca', marginBottom: 14, lineHeight: 1.45 }}>
                More than {data.boxCap} function boxes or more than {data.columnCap} columns.
                Open one changed function to see its own flow.
              </div>
              {(data.index || []).map((item) => (
                <button key={item.id} type="button" onClick={() => { setScope(item.id); setSelectedId(item.id); setFlowNo(1); }}>
                  <span className="mono">{item.name}()</span>
                  <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: '#8b90a6' }}>{item.file}:{item.line} · {item.status}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && !error && flow && !showingIndex && (
            <div ref={canvasRef} className="flow-board">
              <div className="flow-top">
                {scope && (
                  <button type="button" onClick={() => { setScope(''); setFlowNo(1); }}>All</button>
                )}
                <button type="button" onClick={() => setFlowNo((n) => Math.max(1, n - 1))} disabled={flowNo <= 1} aria-label="Previous flow">‹</button>
                <span>Flow {Math.min(flowNo, flows.length)} of {Math.max(flows.length, 1)}</span>
                <button type="button" onClick={() => setFlowNo((n) => Math.min(flows.length, n + 1))} disabled={!flows.length || flowNo >= flows.length} aria-label="Next flow">›</button>
              </div>
              <div className="flow-cols" style={{ gap: Math.round(78 * scale) }}>
                {flow.columns.map((column) => {
                  const changed = column.files.some((file) => file.functions.some((fn) => fn.status && fn.status !== 'unchanged'));
                  const on = column.files.some((file) => file.functions.some((fn) => fn.id === selectedId));
                  return (
                    <div key={column.index} className="flow-col" style={{ width: colW }}>
                      <div className={`flow-step${on ? ' on' : ''}`}>
                        <span className="n">{column.index + 1}</span>
                        <span className="l mono">{column.label}</span>
                        {changed && <span className="dot" />}
                      </div>
                      {column.files.map((file) => {
                        const parts = splitPath(file.file);
                        const stat = fileStat(file);
                        const side = Math.round(12 + 0.6 * Math.sqrt(stat.lines || 1));
                        const offCount = file.functions.filter((fn) => fn.dimmed || !fn.onPath).length;
                        return (
                          <div key={file.file} className="flow-file">
                            <div className="flow-file head">
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div className="d">{parts.dir}</div>
                                <div className="f">{parts.name}</div>
                              </div>
                              <DiffSquare adds={stat.adds} dels={stat.dels} lines={stat.lines} status={stat.status} size={side} />
                            </div>
                            {file.functions.map((fn) => {
                              const view = markView(fn, mark);
                              const stats = fnStats(fn);
                              const onFn = fn.id === selectedId;
                              const offPath = fn.dimmed || !fn.onPath;
                              const faded = selectedId && !keep.has(fn.id);
                              const changed = fn.status && fn.status !== 'unchanged';
                              return (
                                <button
                                  key={fn.id}
                                  type="button"
                                  data-fn={fn.id}
                                  className={`flow-fn${onFn ? ' sel' : ''}${hoverId === fn.id ? ' hov' : ''}${view.ghost ? ' ghost' : ''}${!changed && !view.ghost ? ' quiet' : ''}${faded || view.fade ? ' fade' : ''}`}
                                  onClick={() => setSelectedId(fn.id)}
                                  onMouseEnter={() => setHoverId(fn.id)}
                                  onMouseLeave={() => setHoverId('')}
                                >
                                  {changed && (
                                    <DiffSquare adds={stats.adds} dels={stats.dels} lines={stats.lines} status={fn.status} size={13} />
                                  )}
                                  <span className="n">{fn.label}</span>
                                  <span className="m">
                                    {view.tag === 'moved' && (
                                      <span className="flow-new" style={{ color: '#d2cefd' }} title={fn.movedFromLabel ? `moved from ${fn.movedFromLabel}` : 'moved'}>
                                        {fn.movedFromLabel ? `moved from ${fn.movedFromLabel}` : 'moved'}
                                      </span>
                                    )}
                                    {fn.status === 'added' && <span className="flow-new">NEW</span>}
                                    {stats.adds > 0 && changed && <span className="flow-plus">+{stats.adds}</span>}
                                    {stats.dels > 0 && <span className="flow-minus">−{stats.dels}</span>}
                                    {view.tag === 'deleted' && <span className="flow-minus">deleted</span>}
                                  </span>
                                </button>
                              );
                            })}
                            {offCount > 0 && (
                              <div className={`flow-more${selectedId ? ' fade' : ''}`}>+{offCount} not on this path</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
                {arrows.map((edge) => {
                  const onPath = !selectedId || (keep.has(edge.from) && (keep.has(edge.to) || edge.from === selectedId));
                  const paint = edgePaint(edge, !!selectedId && onPath);
                  const faded = selectedId && !onPath;
                  const slots = edge.slots || 1;
                  const slot = edge.slot || 0;
                  let d;
                  if (edge.sameCol) {
                    const bend = 16 + Math.abs(edge.y2 - edge.y1) * 0.2 + Math.abs(edge.lane || 0) * 10;
                    const x = Math.min(edge.x1, edge.x2) - bend;
                    d = `M ${edge.x1} ${edge.y1} C ${x} ${edge.y1} ${x} ${edge.y2} ${edge.x2 - 6} ${edge.y2}`;
                  } else {
                    const room = Math.max(24, edge.x2 - edge.x1 - 20);
                    const step = Math.min(14, room / Math.max(slots, 1));
                    const laneX = edge.x1 + 12 + slot * step;
                    d = `M ${edge.x1} ${edge.y1} H ${laneX} V ${edge.y2} H ${edge.x2 - 5}`;
                  }
                  return (
                    <path
                      key={`${edge.kind}:${edge.from}:${edge.to}:${edge.mode || ''}:${edge.table || ''}`}
                      d={d}
                      fill="none"
                      stroke={paint.color}
                      strokeWidth="1.5"
                      strokeDasharray={paint.dash || undefined}
                      opacity={faded ? 0.25 : 0.95}
                      markerEnd=""
                    />
                  );
                })}
              </svg>
              {hoverId && hoverId !== selectedId && (
                <HoverNote flow={flow} id={hoverId} />
              )}
            </div>
          )}
        </div>
      </div>
      {selected && (
        <Explain
          selected={selected}
          flow={flow}
          stepIndex={stepIndex}
          steps={steps}
          onPrev={() => stepIndex > 0 && setSelectedId(steps[stepIndex - 1].id)}
          onNext={() => stepIndex >= 0 && stepIndex < steps.length - 1 && setSelectedId(steps[stepIndex + 1].id)}
          onClose={() => setSelectedId('')}
          onPick={setSelectedId}
          onShowInGraph={onShowInGraph}
          onOpenSource={onOpenSource}
        />
      )}
    </div>
  );
}

function HoverNote({ flow, id }) {
  const box = findBox(flow, id);
  if (!box) return null;
  const stats = fnStats(box);
  return (
    <div className="ex-tip" style={{ visibility: 'visible', left: 24, bottom: 72, top: 'auto' }}>
      <div className="t">{box.label}</div>
      <div className="sum">
        {box.status === 'added' ? 'New' : box.status === 'edited' ? 'Edited' : box.status === 'moved' ? 'Moved' : 'Unchanged'}
        {stats.adds > 0 && <span className="plus"> +{stats.adds}</span>}
        {stats.dels > 0 && <span className="minus"> −{stats.dels}</span>}
      </div>
      <div className="meta">Click to explain</div>
    </div>
  );
}

function Explain({ selected, flow, stepIndex, steps, onPrev, onNext, onClose, onPick, onShowInGraph, onOpenSource }) {
  const stats = fnStats(selected);
  const step = steps[stepIndex];
  const column = flow?.columns?.[selected.column];
  return (
    <aside className="ex-sheet">
      <div className="body">
        <div className="kick">
          <span>{step ? `Step ${step.n} of ${steps.length}` : 'Selected'}</span>
          {column?.label && <><span style={{ color: '#4a4e66' }}>·</span><span className="mono">{column.label}</span></>}
          <span className="sp">
            <button type="button" className="ex-ib" aria-label="Previous step" onClick={onPrev} disabled={stepIndex <= 0}>‹</button>
            <button type="button" className="ex-ib" aria-label="Next step" onClick={onNext} disabled={stepIndex < 0 || stepIndex >= steps.length - 1}>›</button>
            <button type="button" className="ex-ib" aria-label="Close" onClick={onClose}>×</button>
          </span>
        </div>
        <h2>{selected.label}</h2>
        <div className="path">{selected.file}:{selected.line}</div>
        <div className="chips">
          {selected.status === 'added' && <span className="chip g">new in this PR</span>}
          {selected.status === 'edited' && <span className="chip g">edited</span>}
          {selected.status === 'moved' && <span className="chip">moved{selected.movedFromLabel ? ` from ${selected.movedFromLabel}` : ''}</span>}
          {selected.status === 'deleted' && <span className="chip">deleted</span>}
          {(stats.adds > 0 || stats.dels > 0) && (
            <span className="chip mono">
              {stats.adds > 0 && <span className="flow-plus">+{stats.adds}</span>}
              {stats.dels > 0 && <span className="flow-minus"> −{stats.dels}</span>}
            </span>
          )}
        </div>
        <div className="sec">What it does</div>
        <div className="p">{selected.whatItDoes}</div>
        <div className="sec">What this PR changed</div>
        <div className="p">{selected.whatChanged}</div>
        {!!selected.diff?.length && (
          <div className="code">
            {selected.diff.map((line, index) => (
              <div key={index} className={line.type === 'add' ? 'a' : line.type === 'del' ? 'r' : ''}>
                {line.type === 'add' ? '+ ' : line.type === 'del' ? '− ' : '  '}{line.text}
              </div>
            ))}
          </div>
        )}
        <Relation title="Calls" rows={selected.calls} onPick={onPick} />
        <Relation title="Called by" rows={selected.calledBy} onPick={onPick} />
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => (onOpenSource || onShowInGraph)?.(selected.file)}>Open source</button>
        <button type="button" className="btn pri" onClick={() => onShowInGraph?.(selected.file)}>Show in graph</button>
      </div>
    </aside>
  );
}

function Relation({ title, rows, onPick }) {
  if (!rows?.length) return null;
  return (
    <>
      <div className="sec">{title}</div>
      {rows.map((row) => (
        <button key={`${row.kind}:${row.id}:${row.mode || ''}`} type="button" className="rel" onClick={() => onPick(row.id)}>
          <span className="mono" style={{ color: row.kind !== 'call' ? '#2EFF7A' : '#e9e9ed' }}>{row.name}</span>
          <span className="s">{row.kind !== 'call' ? (row.label || row.kind) : (row.file ? 'same change' : '')}</span>
        </button>
      ))}
    </>
  );
}

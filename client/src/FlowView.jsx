import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatShaPill } from './focusView.js';
import { readFlowParams, writeExplorerParams } from './explorerView.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function markView(box, mode) {
  const mark = box?.marks?.[mode] || box?.marks?.pr || 'unchanged';
  if (mark === 'future') return { tag: null, ghost: false, fade: true };
  if (mark === 'present' || mark === 'unchanged') return { tag: null, ghost: false, fade: false };
  if (mark === 'deleted') return { tag: 'deleted', ghost: true, fade: true };
  if (mark === 'moved') return { tag: 'moved', ghost: false, fade: false };
  if (mark === 'added' || mark === 'edited') return { tag: mark, ghost: false, fade: false };
  return { tag: null, ghost: false, fade: false };
}

function fileAccent(fns, mode) {
  const marks = fns.map((fn) => fn.marks?.[mode] || 'unchanged');
  if (marks.includes('deleted')) return '#c45b68';
  if (marks.some((mark) => mark === 'added' || mark === 'edited' || mark === 'moved')) return '#3ecf8e';
  return null;
}

function edgePaint(edge, mode) {
  if (edge.kind === 'queue') return { color: '#d7c4a1', dash: '1.5 4', label: 'queued' };
  if (edge.kind === 'data') return { color: '#e0a36a', dash: '5 4', label: edge.table ? `data ${edge.table}` : 'data' };
  if (edge.fresh && mode === 'pr') return { color: '#3ecf8e', dash: '5 4', label: edge.mode || '' };
  return { color: '#7ea2d6', dash: null, label: edge.mode || '' };
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

function Tag({ kind, label }) {
  const ghost = kind === 'deleted';
  const moved = kind === 'moved';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1px 6px', borderRadius: 999, fontSize: 10, letterSpacing: '0.02em',
      background: ghost ? '#3c242b' : moved ? '#3a3224' : '#1c3d30',
      color: ghost ? '#ffb0b8' : moved ? '#e7d3b0' : '#b8f5cf',
    }}>{label}</span>
  );
}

export function FlowView({ root, gitInfo, focusFile, focusToken, onShowInGraph }) {
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
  const alsoById = useMemo(() => {
    const map = new Map();
    for (const row of flow?.alsoCalled || []) map.set(row.id, row.calls);
    return map;
  }, [flow]);

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
      next.push({
        ...edge,
        x1: Math.round(a.right - origin.left),
        y1: Math.round(a.top + a.height / 2 - origin.top),
        x2: Math.round(b.left - origin.left),
        y2: Math.round(b.top + b.height / 2 - origin.top),
      });
    }
    const sig = `${flow.id}:${next.map((edge) => `${edge.kind}:${edge.from}:${edge.to}:${edge.x1}:${edge.y1}:${edge.x2}:${edge.y2}`).join('|')}`;
    if (arrowSig.current !== sig) {
      arrowSig.current = sig;
      document.documentElement.dataset.explorerReady = '0';
      setArrows(next);
      setLaidOut(sig || 'drawn');
    }
    return undefined;
  }, [flow, mark, showingIndex, data, selectedId]);

  useEffect(() => {
    if (loading || error || !laidOut) return undefined;
    const id = requestAnimationFrame(() => {
      document.documentElement.dataset.explorerView = 'flow';
      document.documentElement.dataset.explorerReady = '1';
    });
    return () => cancelAnimationFrame(id);
  }, [loading, error, laidOut]);

  const sha = formatShaPill(data?.baseSha, data?.headSha);
  const modes = data?.modes || [
    { id: 'before', label: 'main' },
    { id: 'pr', label: 'this PR' },
  ];

  return (
    <div style={{
      display: 'flex', width: '100%', height: '100%', minHeight: 0,
      background: '#161826', color: '#e9e9ed', fontFamily: 'var(--font-body)',
    }}>
      <aside style={{
        flex: 'none', width: 248, borderRight: '1px solid #292b36',
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        <div style={{
          padding: '14px 14px 8px', fontSize: 10, letterSpacing: '0.08em', color: '#8b90a6',
        }}>FLOW, IN CALL ORDER</div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(flow?.steps || []).map((step) => {
            const on = step.id === selectedId;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setSelectedId(step.id)}
                style={{
                  display: 'flex', gap: 8, textAlign: 'left', width: '100%',
                  padding: '7px 8px', borderRadius: 8, cursor: 'pointer', font: 'inherit',
                  border: '1px solid transparent',
                  background: on ? '#2a2740' : 'transparent',
                  color: 'inherit',
                }}
              >
                <span style={{
                  flex: 'none', width: 18, height: 18, borderRadius: 99, marginTop: 1,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: on ? '#9184d9' : '#2a2d3c', color: on ? '#161826' : '#cfd3e5',
                  fontSize: 10,
                }}>{step.n}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontFamily: MONO }}>{step.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: '#8b90a6', marginTop: 2 }}>
                    {step.entryKind ? `${step.entryKind} entry` : (step.hint || step.file.split('/').pop())}
                  </span>
                </span>
              </button>
            );
          })}
          {!loading && flow && !flow.steps?.length && (
            <div style={{ fontSize: 12, color: '#8b90a6', padding: 8 }}>No steps in this flow.</div>
          )}
        </div>
        <div style={{
          padding: '10px 14px 14px', borderTop: '1px solid #292b36',
          display: 'flex', flexDirection: 'column', gap: 6, fontSize: 10.5, color: '#8b90a6',
        }}>
          <Key swatch="#7ea2d6" label="call" />
          <Key swatch="#3ecf8e" dash label="new call" />
          <Key swatch="#d7c4a1" dot label="queued" />
          <Key swatch="#e0a36a" dash label="data" />
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{
          flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '10px 14px', borderBottom: '1px solid #292b36',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button type="button" onClick={() => setFlowNo((n) => Math.max(1, n - 1))} disabled={flowNo <= 1 || showingIndex} style={pagerBtn}>‹</button>
            <div style={{ fontSize: 12.5 }}>
              <span>Flow {flows.length ? Math.min(flowNo, flows.length) : 1} of {Math.max(flows.length, 1)}</span>
              {flow && !showingIndex && (
                <span style={{ color: '#8b90a6' }}> · {flow.boxCount} boxes</span>
              )}
            </div>
            <button type="button" onClick={() => setFlowNo((n) => Math.min(flows.length, n + 1))} disabled={!flows.length || flowNo >= flows.length || showingIndex} style={pagerBtn}>›</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', border: '1px solid #3f424d', borderRadius: 999, overflow: 'hidden' }}>
              {modes.map((item) => {
                const on = (item.id === 'before' ? mark === 'before' : item.id === 'main' ? mark === 'main' : mark === 'pr');
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMark(item.id)}
                    style={{
                      border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12,
                      padding: '5px 10px',
                      background: on ? '#2a2740' : 'transparent',
                      color: on ? '#f5f4ff' : '#b2b6ca',
                    }}
                  >{item.label}</button>
                );
              })}
            </div>
            {sha && (
              <span style={{
                fontFamily: MONO, fontSize: 11, color: '#d2cefd',
                border: '1px solid #9184d9', background: '#2b2741', borderRadius: 999, padding: '4px 8px',
              }}>{sha}</span>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'auto' }}>
          {loading && <Empty>Reading functions…</Empty>}
          {!loading && error && <Empty>{error}</Empty>}
          {!loading && !error && data && !flows.length && (
            <Empty>No changed functions to lay out against {data.baseLabel || 'the compare base'}.</Empty>
          )}
          {!loading && !error && showingIndex && (
            <div style={{ padding: 22, maxWidth: 640 }}>
              <div style={{ fontSize: 16, marginBottom: 6 }}>This change is wide</div>
              <div style={{ fontSize: 12.5, color: '#b2b6ca', marginBottom: 14, lineHeight: 1.45 }}>
                More than {data.boxCap} function boxes or more than {data.columnCap} columns.
                Open one changed function to see its own flow.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(data.index || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setScope(item.id); setSelectedId(item.id); setFlowNo(1); }}
                    style={{
                      textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                      background: '#1c1e2c', border: '1px solid #313445', color: 'inherit', font: 'inherit',
                    }}
                  >
                    <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{item.name}()</span>
                    <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: '#8b90a6' }}>
                      {item.file}:{item.line} · {item.status}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {!loading && !error && flow && !showingIndex && (
            <div ref={canvasRef} style={{ position: 'relative', minHeight: '100%', padding: '22px 18px 40px' }}>
              {scope && (
                <button
                  type="button"
                  onClick={() => { setScope(''); setFlowNo(1); }}
                  style={{
                    marginBottom: 12, border: 'none', background: 'none', color: '#9184d9',
                    cursor: 'pointer', font: 'inherit', fontSize: 12, padding: 0,
                  }}
                >All changed functions</button>
              )}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 84, position: 'relative', zIndex: 1 }}>
                {flow.columns.map((column) => (
                  <div key={column.index} style={{ width: 280, flex: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 11, color: '#b2b6ca', letterSpacing: '0.02em' }}>
                      <span style={{ color: '#9184d9', marginRight: 6 }}>{column.index + 1}</span>
                      {column.label}
                    </div>
                    {column.files.map((file) => {
                      const accent = fileAccent(file.functions, mark);
                      return (
                        <div key={file.file} style={{
                          background: '#1c1e2c',
                          border: '1px solid #313445',
                          borderLeft: accent ? `3px solid ${accent}` : '1px solid #313445',
                          borderRadius: 10, padding: '8px 8px 6px',
                        }}>
                          <div style={{
                            fontFamily: MONO, fontSize: 10.5, color: '#8b90a6',
                            padding: '2px 6px 8px', wordBreak: 'break-all',
                          }}>{file.file}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {file.functions.map((fn) => {
                              const view = markView(fn, mark);
                              const on = fn.id === selectedId;
                              const offPath = fn.dimmed || !fn.onPath;
                              return (
                                <button
                                  key={fn.id}
                                  type="button"
                                  data-fn={fn.id}
                                  onClick={() => setSelectedId(fn.id)}
                                  style={{
                                    textAlign: 'left', width: '100%', cursor: 'pointer', font: 'inherit',
                                    padding: '7px 8px', borderRadius: 8,
                                    background: on ? '#2a2740' : 'transparent',
                                    border: `1px ${offPath || view.ghost ? 'dashed' : 'solid'} ${on ? '#9184d9' : view.ghost ? '#a85a66' : '#3a3e52'}`,
                                    color: view.ghost ? '#e7b4bc' : '#e9e9ed',
                                    opacity: (view.ghost || view.fade || offPath) ? (view.ghost ? 0.62 : 0.55) : 1,
                                  }}
                                >
                                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                    <span style={{ fontFamily: MONO, fontSize: 12 }}>{fn.label}</span>
                                    {view.tag === 'moved' && <Tag kind="moved" label={fn.movedFromLabel ? `moved from ${fn.movedFromLabel}` : 'moved'} />}
                                    {view.tag && view.tag !== 'moved' && <Tag kind={view.tag} label={view.tag} />}
                                  </span>
                                  {offPath && !view.ghost && (
                                    <span style={{ display: 'block', marginTop: 3, fontSize: 10, color: '#8b90a6' }}>not on this path</span>
                                  )}
                                  {!!alsoById.get(fn.id)?.length && (
                                    <span style={{
                                      display: 'inline-flex', marginTop: 6, padding: '2px 6px', borderRadius: 999,
                                      background: '#262838', color: '#b2b6ca', fontSize: 10,
                                    }}>
                                      also called {alsoById.get(fn.id).map((call) => call.name).join(', ')}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
                <defs>
                  <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#7ea2d6" />
                  </marker>
                </defs>
                {arrows.map((edge, index) => {
                  const paint = edgePaint(edge, mark);
                  const lane = index - (arrows.length - 1) / 2;
                  const yShift = edge.kind === 'queue' ? -7 : edge.kind === 'data' ? 7 : 0;
                  const y1 = edge.y1 + yShift;
                  const y2 = edge.y2 + yShift;
                  const span = Math.max(24, edge.x2 - edge.x1);
                  const xMid = edge.x1 + Math.min(56, span * 0.42) + lane * 7;
                  const d = `M ${edge.x1} ${y1} H ${xMid} V ${y2} H ${edge.x2 - 7}`;
                  const label = paint.label || '';
                  const lx = edge.x2 - 10;
                  const ly = y2 - 7;
                  return (
                    <g key={`${edge.kind}:${edge.from}:${edge.to}:${edge.mode || ''}:${edge.table || ''}`}>
                      <path d={d} fill="none" stroke={paint.color} strokeWidth="1.4" strokeDasharray={paint.dash || undefined} />
                      <path d={`M ${edge.x2 - 8} ${y2 - 3.5} L ${edge.x2 - 1} ${y2} L ${edge.x2 - 8} ${y2 + 3.5}`} fill="none" stroke={paint.color} strokeWidth="1.4" />
                      {label && (
                        <g>
                          <rect x={lx - label.length * 5.4} y={ly - 9} width={label.length * 5.4 + 6} height={12} rx="3" fill="#161826" />
                          <text x={lx} y={ly} fill={paint.color} fontSize="10" textAnchor="end" fontFamily={MONO}>{label}</text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      </div>

      <aside style={{
        flex: 'none', width: 320, borderLeft: '1px solid #292b36',
        display: 'flex', flexDirection: 'column', minHeight: 0, background: '#161826',
      }}>
        {selected ? (
          <div style={{ overflow: 'auto', padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.08em', color: '#9184d9' }}>
                {flow?.steps?.some((step) => step.id === selected.id) ? `SELECTED · STEP ${flow.steps.find((step) => step.id === selected.id)?.n}` : 'SELECTED'}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 16, marginTop: 6 }}>{selected.label}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: '#8b90a6', marginTop: 4, wordBreak: 'break-all' }}>
                {selected.file} · line {selected.line}
              </div>
            </div>
            <Section title="What it does">{selected.whatItDoes}</Section>
            <Section title="What this PR changed">{selected.whatChanged}</Section>
            {!!selected.diff?.length && (
              <pre style={{
                margin: 0, padding: '8px 10px', borderRadius: 8, background: '#12131c',
                fontFamily: MONO, fontSize: 11, lineHeight: 1.5, overflow: 'auto',
              }}>
                {selected.diff.map((line, index) => (
                  <div key={index} style={{ color: line.type === 'add' ? '#9dffc0' : line.type === 'del' ? '#ffb0b8' : '#cfd3e5' }}>
                    {line.type === 'add' ? '+ ' : line.type === 'del' ? '− ' : '  '}{line.text}
                  </div>
                ))}
              </pre>
            )}
            <Relation title="Calls" rows={selected.calls} onPick={setSelectedId} />
            <Relation title="Called by" rows={selected.calledBy} onPick={setSelectedId} />
            {onShowInGraph && (
              <button
                type="button"
                onClick={() => onShowInGraph(selected.file)}
                style={{
                  alignSelf: 'flex-start', border: '1px solid #5d5294', background: '#2b2741',
                  color: '#f5f4ff', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', font: 'inherit', fontSize: 12,
                }}
              >Show in graph</button>
            )}
          </div>
        ) : (
          <div style={{
            margin: 'auto', textAlign: 'center', color: '#8b90a6', fontSize: 13, padding: 24,
          }}>Click a function to explain it.</div>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', color: '#8b90a6', marginBottom: 4 }}>{title.toUpperCase()}</div>
      <div style={{ fontSize: 13, lineHeight: 1.45 }}>{children}</div>
    </section>
  );
}

function Relation({ title, rows, onPick }) {
  if (!rows?.length) return null;
  return (
    <section>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', color: '#8b90a6', marginBottom: 6 }}>{title.toUpperCase()}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((row) => (
          <button
            key={`${row.kind}:${row.id}:${row.mode || ''}`}
            type="button"
            onClick={() => onPick(row.id)}
            style={{
              textAlign: 'left', border: '1px solid #313445', background: '#1c1e2c', color: 'inherit',
              borderRadius: 8, padding: '6px 8px', cursor: 'pointer', font: 'inherit',
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 12 }}>{row.name}</span>
            {row.kind !== 'call' && (
              <span style={{ marginLeft: 8, fontSize: 10, color: '#d7c4a1' }}>{row.label || row.kind}</span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

function Key({ swatch, label, dash, dot }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 18, borderTop: `1.5px ${dot ? 'dotted' : dash ? 'dashed' : 'solid'} ${swatch}`,
      }} />
      {label}
    </span>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 28, color: '#b2b6ca', fontSize: 13 }}>{children}</div>;
}

const pagerBtn = {
  width: 26, height: 26, borderRadius: 8, border: '1px solid #3f424d',
  background: 'transparent', color: '#e9e9ed', cursor: 'pointer', font: 'inherit',
};

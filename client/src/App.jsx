import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeExplorer } from './CodeExplorer.jsx';

const SESSION_KEY = 'code-explorer-session';

function isRemoteTarget(value) {
  return /^(https?:\/\/|git@)/i.test(value.trim()) || /github\.com\//i.test(value.trim());
}

function newTabId() {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tabs)) return null;
    return {
      activeId: data.activeId || null,
      sidebarOpen: data.sidebarOpen !== false,
      tabs: data.tabs.filter((t) => t && t.root && t.title),
    };
  } catch {
    return null;
  }
}

function writeSessionLocal(tabs, activeId, sidebarOpen) {
  const payload = {
    v: 1,
    activeId,
    sidebarOpen,
    tabs: tabs.filter((t) => t.root).map((t) => ({ id: t.id, title: t.title, root: t.root })),
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch { /* ignore quota */ }
  return payload;
}

function persistSession(tabs, activeId, sidebarOpen) {
  const payload = writeSessionLocal(tabs, activeId, sidebarOpen);
  const active = tabs.find((t) => t.id === activeId);
  fetch('/api/session', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tabs: payload.tabs,
      activeRoot: active?.root || null,
      sidebarOpen,
    }),
  }).catch(() => {});
}

async function loadTabFromRoot(stub) {
  const snap = await fetchWorkspace(stub.root);
  if (!snap?.graph) return null;
  return {
    id: stub.id || newTabId(),
    title: snap.repo || stub.title || 'Repo',
    root: snap.root || stub.root,
    liveGraph: { graph: snap.graph, endpoints: snap.endpoints || { endpoints: [], calls: [] }, soft: false },
    reloadToken: 0,
    busy: false,
    status: '',
    progress: null,
    error: '',
  };
}

async function readNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      onEvent(JSON.parse(line));
    }
  }
  const tail = buf.trim();
  if (tail) onEvent(JSON.parse(tail));
}

async function fetchWorkspace(root) {
  const res = await fetch(`/api/workspace?root=${encodeURIComponent(root)}`);
  if (!res.ok) return null;
  return res.json();
}

export default function App() {
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [booted, setBooted] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [mode, setMode] = useState('browse'); // browse | remote
  const [target, setTarget] = useState('');
  const [browse, setBrowse] = useState(null);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState('');
  const [globalBusy, setGlobalBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState('repo'); // repo | all
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);

  const tabsRef = useRef([]);
  const analyzingTabIdRef = useRef(null);
  const searchWrapRef = useRef(null);
  const sessionReadyRef = useRef(false);

  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  useEffect(() => {
    if (!booted || !sessionReadyRef.current) return;
    persistSession(tabs, activeId, sidebarOpen);
  }, [tabs, activeId, sidebarOpen, booted]);

  useEffect(() => {
    function onDoc(e) {
      if (!searchOpen) return;
      if (!searchWrapRef.current?.contains(e.target)) setSearchOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [searchOpen]);

  const activeTab = tabs.find((t) => t.id === activeId) || null;

  const loadBrowse = useCallback(async (dirPath) => {
    setListing(true);
    setError('');
    try {
      const qs = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
      const res = await fetch(`/api/browse${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open folder');
      setBrowse(data);
      setTarget(data.path);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setListing(false);
    }
  }, []);

  useEffect(() => {
    if (showPicker && mode === 'browse') loadBrowse(target || undefined);
  }, [showPicker, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const local = readSession();
        const remote = await fetch('/api/session').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const stubs = (local?.tabs?.length ? local.tabs : null)
          || (remote?.tabs?.length ? remote.tabs : null)
          || null;

        if (local?.sidebarOpen === false || remote?.sidebarOpen === false) {
          setSidebarOpen(false);
        }

        if (stubs?.length) {
          const restored = [];
          for (const stub of stubs) {
            const tab = await loadTabFromRoot(stub);
            if (tab) restored.push(tab);
          }
          if (!cancelled && restored.length) {
            const wantRoot = local?.tabs?.find((t) => t.id === local.activeId)?.root
              || remote?.activeRoot
              || null;
            const active = restored.find((t) => t.id === local?.activeId)
              || restored.find((t) => t.root === wantRoot)
              || restored[restored.length - 1];
            setTabs(restored);
            setActiveId(active.id);
            sessionReadyRef.current = true;
            setBooted(true);
            return;
          }
        }

        // Fall back: reopen every saved workspace snapshot
        const listed = await fetch('/api/workspaces').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (listed?.workspaces?.length) {
          const restored = [];
          for (const ws of listed.workspaces) {
            const tab = await loadTabFromRoot(ws);
            if (tab) restored.push(tab);
          }
          if (!cancelled && restored.length) {
            setTabs(restored);
            setActiveId(restored[0].id);
            sessionReadyRef.current = true;
            setBooted(true);
            return;
          }
        }

        const [health, graphRes, endpointsRes] = await Promise.all([
          fetch('/api/health').then((r) => r.json()).catch(() => ({})),
          fetch('/api/graph'),
          fetch('/api/endpoints'),
        ]);
        if (cancelled) return;
        if (graphRes.ok) {
          const graph = await graphRes.json();
          const endpoints = endpointsRes.ok
            ? await endpointsRes.json()
            : { endpoints: [], calls: [] };
          const id = newTabId();
          setTabs([{
            id,
            title: graph.repo || health.repo || 'Repo',
            root: health.root || null,
            liveGraph: { graph, endpoints, soft: false },
            reloadToken: 0,
            busy: false,
            status: '',
            progress: null,
            error: '',
          }]);
          setActiveId(id);
        } else {
          setShowPicker(true);
        }
      } catch {
        if (!cancelled) setShowPicker(true);
      } finally {
        if (!cancelled) {
          sessionReadyRef.current = true;
          setBooted(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function patchTab(id, patch) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function analyze(value) {
    const next = (value ?? target).trim();
    if (!next) return;
    setGlobalBusy(true);
    setError('');
    analyzingTabIdRef.current = null;
    try {
      const res = await fetch('/api/analyze/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: next }),
      });
      if (!res.ok && !res.body) {
        const text = await res.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
        throw new Error(data.error || text || `Analyze failed (${res.status})`);
      }

      let sawDone = false;
      await readNdjson(res, (event) => {
        if (event.type === 'status') {
          const id = analyzingTabIdRef.current;
          if (id) patchTab(id, { status: event.message || 'Resolving packages…' });
          return;
        }
        if (event.type === 'start') {
          setShowPicker(false);
          const hit = tabsRef.current.find((t) => t.root && event.root && t.root === event.root);
          const id = hit?.id || newTabId();
          analyzingTabIdRef.current = id;
          setActiveId(id);
          const tab = {
            id,
            title: event.repo || 'Repo',
            root: event.root || null,
            liveGraph: { graph: event.graph, endpoints: event.endpoints, soft: false },
            reloadToken: (hit?.reloadToken || 0) + 1,
            busy: true,
            status: `Found ${event.total} files — parsing imports…`,
            progress: { done: 0, total: event.total, file: '', repo: event.repo },
            error: '',
          };
          setTabs((prev) => {
            if (prev.some((t) => t.id === id)) {
              return prev.map((t) => (t.id === id ? { ...t, ...tab } : t));
            }
            return [...prev, tab];
          });
        } else if (event.type === 'progress') {
          const id = analyzingTabIdRef.current;
          if (!id) return;
          patchTab(id, {
            progress: { done: event.done, total: event.total, file: event.file, repo: event.repo },
            status: `Parsing ${event.done}/${event.total}: ${event.file}`,
            liveGraph: { graph: event.graph, endpoints: { endpoints: [], calls: [] }, soft: true },
          });
        } else if (event.type === 'done') {
          sawDone = true;
          const id = analyzingTabIdRef.current;
          if (!id) return;
          patchTab(id, {
            title: event.repo || 'Repo',
            root: event.root || null,
            progress: { done: event.stats.nodes, total: event.stats.nodes, file: '', repo: event.repo },
            status: `${event.repo}: ${event.stats.nodes} files · ${event.stats.links} imports · ${event.stats.endpoints} endpoints`,
            liveGraph: { graph: event.graph, endpoints: event.endpoints, soft: true },
            reloadToken: Date.now(),
            busy: false,
          });
        } else if (event.type === 'error') {
          throw new Error(event.error || 'Analyze failed');
        }
      });

      if (!sawDone && analyzingTabIdRef.current) {
        patchTab(analyzingTabIdRef.current, { busy: false });
      }
    } catch (err) {
      const msg = err.message || String(err);
      setError(msg);
      const id = analyzingTabIdRef.current;
      if (id) patchTab(id, { busy: false, error: msg, status: '' });
      setShowPicker(true);
    } finally {
      setGlobalBusy(false);
      const id = analyzingTabIdRef.current;
      if (id) {
        setTimeout(() => {
          patchTab(id, { progress: null });
        }, 1200);
      }
    }
  }

  function openPicker() {
    setShowPicker(true);
    setError('');
    setMode('browse');
  }

  function closeTab(id) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        const idx = prev.findIndex((t) => t.id === id);
        const neighbor = next[Math.max(0, idx - 1)] || next[0] || null;
        setActiveId(neighbor?.id || null);
        if (!neighbor) setShowPicker(true);
      }
      return next;
    });
  }

  const explorerQuery = searchScope === 'repo' ? searchQuery : '';

  const allSearchHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || searchScope !== 'all') return [];
    const hits = [];
    for (const tab of tabs) {
      const nodes = tab.liveGraph?.graph?.nodes || [];
      for (const n of nodes) {
        const id = n.id || '';
        const name = n.name || '';
        if (id.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
          hits.push({
            key: `${tab.id}:${id}`,
            tabId: tab.id,
            repo: tab.title,
            nodeId: id,
            label: name || id.split('/').pop(),
            path: id,
          });
          if (hits.length >= 40) return hits;
        }
      }
    }
    return hits;
  }, [searchQuery, searchScope, tabs]);

  function pickSearchHit(hit) {
    setActiveId(hit.tabId);
    setSearchScope('repo');
    setSearchQuery(hit.label || '');
    setFocusRequest({ nodeId: hit.nodeId, token: Date.now() });
    setSearchOpen(false);
  }

  const progress = activeTab?.progress;
  const status = activeTab?.status || '';
  const busy = globalBusy || !!activeTab?.busy;
  const pct = progress?.total
    ? Math.round((progress.done / Math.max(1, progress.total)) * 100)
    : busy ? 5 : 0;

  if (!booted) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-bg)', color: 'var(--color-neutral-500)', fontSize: 13,
      }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {tabs.length > 0 && (
        <div style={{
          flex: 'none', display: 'flex', alignItems: 'stretch',
          borderBottom: '1px solid var(--color-neutral-900)', background: 'var(--color-bg)',
          minHeight: 40,
        }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', minWidth: 0, overflowX: 'auto' }}>
            {tabs.map((tab) => {
              const on = tab.id === activeId;
              return (
                <div
                  key={tab.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0 4px 0 12px',
                    borderRight: '1px solid var(--color-neutral-900)',
                    background: on ? 'var(--color-surface)' : 'transparent',
                    maxWidth: 220, minWidth: 96,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(tab.id)}
                    style={{
                      flex: 1, minWidth: 0, border: 'none', background: 'transparent',
                      color: on ? 'var(--color-text)' : 'var(--color-neutral-500)',
                      fontFamily: 'inherit', fontSize: 12, textAlign: 'left',
                      padding: '8px 0', cursor: 'pointer',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                    title={tab.root || tab.title}
                  >
                    {tab.title}{tab.busy ? '…' : ''}
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-ghost"
                    title="Close tab"
                    aria-label={`Close ${tab.title}`}
                    onClick={() => closeTab(tab.id)}
                    style={{ width: 28, height: 28, flex: 'none', fontSize: 12, color: 'var(--color-neutral-600)' }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={openPicker}
              title="Open another repo"
              aria-label="Open another repo"
              style={{
                flex: 'none', width: 36, padding: 0, border: 'none',
                borderRight: '1px solid var(--color-neutral-900)',
                color: 'var(--color-neutral-400)', fontSize: 18, lineHeight: 1,
              }}
            >
              +
            </button>
          </div>

          <div ref={searchWrapRef} style={{
            flex: 'none', display: 'flex', alignItems: 'center',
            borderLeft: '1px solid var(--color-neutral-900)',
            position: 'relative', padding: '0 6px',
          }}>
            {searchOpen ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 300 }}>
                <input
                  className="input"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={searchScope === 'all' ? 'Search all repos…' : 'Search this repo…'}
                  style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '5px 8px', minHeight: 30 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchOpen(false);
                      setSearchQuery('');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  title={searchScope === 'all' ? 'Searching all open repos' : 'Searching this repo'}
                  onClick={() => setSearchScope((s) => (s === 'repo' ? 'all' : 'repo'))}
                  style={{
                    flex: 'none', fontSize: 10, padding: '4px 7px', whiteSpace: 'nowrap',
                    border: '1px solid',
                    color: searchScope === 'all' ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
                    borderColor: searchScope === 'all' ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
                  }}
                >
                  {searchScope === 'all' ? 'All' : 'Repo'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                title="Search"
                aria-label="Search"
                onClick={() => setSearchOpen(true)}
                style={{
                  width: 34, height: 34,
                  color: searchQuery ? 'var(--color-accent-300)' : 'var(--color-neutral-400)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}

            {searchOpen && searchScope === 'all' && searchQuery.trim() && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 30, width: 320,
                marginTop: 4, maxHeight: 320, overflowY: 'auto',
                background: 'var(--color-surface)', border: '1px solid var(--color-neutral-800)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)',
              }}>
                {allSearchHits.length === 0 ? (
                  <div style={{ padding: 10, fontSize: 12, color: 'var(--color-neutral-500)' }}>No matches</div>
                ) : allSearchHits.map((hit) => (
                  <button
                    key={hit.key}
                    type="button"
                    onClick={() => pickSearchHit(hit)}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: 2, width: '100%',
                      textAlign: 'left', padding: '8px 10px', border: 'none',
                      borderBottom: '1px solid var(--color-neutral-900)',
                      background: 'transparent', color: 'inherit', cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 12 }}>{hit.label}</span>
                    <span style={{
                      fontSize: 10.5, color: 'var(--color-neutral-500)',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {hit.repo} · {hit.path}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {tabs.length === 0 && !showPicker && (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-neutral-500)', fontSize: 13,
          }}>
            <button type="button" className="btn" onClick={openPicker}
              style={{
                fontSize: 13, padding: '8px 14px',
                background: 'var(--color-accent-700)', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-accent-600)',
              }}>
              Open a repository
            </button>
          </div>
        )}
        {tabs.map((tab) => {
          const on = tab.id === activeId;
          return (
            <div
              key={tab.id}
              style={{
                position: 'absolute', inset: 0,
                // Keep layout size while inactive — display:none zeros the canvas and breaks the graph.
                visibility: on ? 'visible' : 'hidden',
                pointerEvents: on ? 'auto' : 'none',
                zIndex: on ? 1 : 0,
              }}
              aria-hidden={!on}
            >
              <CodeExplorer
                active={on}
                skipInitialLoad
                workspaceRoot={tab.root}
                liveGraph={tab.liveGraph}
                reloadToken={tab.reloadToken}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen((v) => !v)}
                query={on ? explorerQuery : ''}
                onQueryChange={(q) => {
                  setSearchScope('repo');
                  setSearchQuery(q);
                }}
                focusNodeId={on ? focusRequest?.nodeId : null}
                focusToken={on ? focusRequest?.token : null}
              />
            </div>
          );
        })}
      </div>

      {(busy || progress) && !showPicker && activeTab && (
        <div style={{
          position: 'fixed', left: 18, bottom: 18, zIndex: 40,
          minWidth: 280, maxWidth: 420, padding: '12px 14px',
          background: 'var(--color-surface)', border: '1px solid var(--color-neutral-800)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)',
          fontSize: 12, color: 'var(--color-neutral-400)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <span style={{ color: 'var(--color-text)' }}>{progress?.repo || activeTab.title || 'Analyzing'}</span>
            <span>{pct}%</span>
          </div>
          <div style={{ height: 4, borderRadius: 99, background: 'var(--color-neutral-900)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-accent)', transition: 'width 160ms linear' }} />
          </div>
          <div style={{ marginTop: 8, color: 'var(--color-neutral-500)', wordBreak: 'break-all' }}>
            {status || 'Working…'}
          </div>
        </div>
      )}

      {showPicker && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'color-mix(in srgb, #161826 72%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{
            width: 'min(640px, 100%)', maxHeight: 'min(820px, 92vh)',
            background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
            padding: 24, boxShadow: 'var(--shadow-sm)',
            border: '1px solid var(--color-neutral-800)',
            display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-heading-weight)', fontSize: 18 }}>
                Open a repository
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-neutral-500)', marginTop: 6, lineHeight: 1.5 }}>
                Browse any local folder. Analysis walks JS/TS files, then wires up imports and API calls into the graph as it goes.
                {tabs.length > 0 ? ' Opens in a new tab.' : ''}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" disabled={globalBusy}
                onClick={() => setMode('browse')}
                style={{
                  fontSize: 12, padding: '6px 10px',
                  border: '1px solid',
                  borderColor: mode === 'browse' ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
                  color: mode === 'browse' ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
                }}>
                Local folder
              </button>
              <button type="button" className="btn btn-ghost" disabled={globalBusy}
                onClick={() => setMode('remote')}
                style={{
                  fontSize: 12, padding: '6px 10px',
                  border: '1px solid',
                  borderColor: mode === 'remote' ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
                  color: mode === 'remote' ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
                }}>
                GitHub URL
              </button>
            </div>

            {mode === 'remote' ? (
              <form onSubmit={(e) => { e.preventDefault(); analyze(); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <input
                  className="input"
                  autoFocus
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="https://github.com/org/repo"
                  style={{ width: '100%', fontSize: 13 }}
                  disabled={globalBusy}
                />
              </form>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (isRemoteTarget(target)) analyze();
                        else loadBrowse(target);
                      }
                    }}
                    placeholder="/path/to/repo"
                    style={{ width: '100%', fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                    disabled={globalBusy || listing}
                  />
                  <button type="button" className="btn btn-ghost" disabled={globalBusy || listing}
                    onClick={() => loadBrowse(target)}
                    style={{ fontSize: 12, padding: '8px 12px', border: '1px solid var(--color-neutral-800)', whiteSpace: 'nowrap' }}>
                    Go
                  </button>
                </div>

                {browse?.shortcuts?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {browse.shortcuts.map((s) => (
                      <button key={s.path} type="button" className="tag tag-outline" disabled={globalBusy || listing}
                        onClick={() => loadBrowse(s.path)}
                        style={{ cursor: 'pointer', fontFamily: 'inherit', background: target === s.path ? 'var(--color-accent-800)' : 'transparent' }}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}

                {browse?.recent?.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>
                      Recent
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {browse.recent.map((p) => (
                        <button key={p} type="button" disabled={globalBusy}
                          onClick={() => analyze(p)}
                          style={{
                            textAlign: 'left', fontSize: 12, padding: '6px 10px',
                            borderRadius: 'var(--radius-sm)', border: '1px solid transparent',
                            background: 'var(--color-bg)', color: 'var(--color-accent-300)',
                            cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            wordBreak: 'break-all',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent-700)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{
                  flex: 1, minHeight: 220, maxHeight: 340, overflow: 'auto',
                  border: '1px solid var(--color-neutral-800)', borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg)',
                }}>
                  {listing && (
                    <div style={{ padding: 14, fontSize: 12.5, color: 'var(--color-neutral-500)' }}>Loading…</div>
                  )}
                  {!listing && browse && (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {browse.parent && (
                        <button type="button" disabled={globalBusy}
                          onClick={() => loadBrowse(browse.parent)}
                          style={rowStyle}>
                          <span style={{ color: 'var(--color-neutral-500)' }}>..</span>
                          <span style={{ color: 'var(--color-neutral-600)', fontSize: 11 }}>Up</span>
                        </button>
                      )}
                      {browse.entries.map((ent) => (
                        <button key={ent.path} type="button" disabled={globalBusy}
                          onClick={() => loadBrowse(ent.path)}
                          onDoubleClick={() => analyze(ent.path)}
                          style={rowStyle}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{ color: ent.isGit ? 'var(--color-accent-300)' : 'var(--color-text)' }}>{ent.name}</span>
                            {ent.isGit && (
                              <span className="tag tag-accent" style={{ fontSize: 10, padding: '1px 6px' }}>git</span>
                            )}
                          </span>
                          <button type="button" className="btn btn-ghost"
                            disabled={globalBusy}
                            onClick={(e) => { e.stopPropagation(); analyze(ent.path); }}
                            style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--color-neutral-800)' }}>
                            Open
                          </button>
                        </button>
                      ))}
                      {browse.entries.length === 0 && (
                        <div style={{ padding: 14, fontSize: 12.5, color: 'var(--color-neutral-500)' }}>
                          No subfolders here — use Analyze on this folder if it’s your repo root.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {browse && (
                  <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' }}>
                    {browse.path}
                    {browse.isGit ? ' · git repo' : ''}
                  </div>
                )}
              </>
            )}

            {error && (
              <div style={{ fontSize: 12.5, color: '#ff8a80', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{error}</div>
            )}
            {status && !error && busy && (
              <div style={{ fontSize: 12.5, color: 'var(--color-accent-300)' }}>{status}</div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" disabled={globalBusy}
                onClick={() => setShowPicker(false)}
                style={{ fontSize: 13, padding: '8px 12px' }}>
                {tabs.length ? 'Cancel' : 'Close'}
              </button>
              <button type="button" className="btn" disabled={globalBusy || !target.trim()}
                onClick={() => analyze()}
                style={{
                  fontSize: 13, padding: '8px 14px',
                  background: 'var(--color-accent-700)', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-accent-600)',
                }}>
                {globalBusy ? 'Working…' : 'Analyze'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const rowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  width: '100%', textAlign: 'left', padding: '8px 12px',
  border: 'none', borderBottom: '1px solid var(--color-neutral-900)',
  background: 'transparent', color: 'inherit', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 13,
};

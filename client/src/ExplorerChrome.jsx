import React, { useEffect, useRef, useState } from 'react';

const LOGO = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <circle cx="3" cy="3" r="1.6" fill="#d2cefd" />
    <circle cx="9" cy="6" r="1.6" fill="#d2cefd" />
    <circle cx="3" cy="9" r="1.6" fill="#d2cefd" />
    <path d="M3 3 L9 6 L3 9" stroke="#9184d9" strokeWidth="1" fill="none" />
  </svg>
);
const SLIDERS = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="11" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </svg>
);
const MORE = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" />
  </svg>
);
const CHEV = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <path d="M2.5 4 L5 6.5 L7.5 4" />
  </svg>
);
const X = (
  <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <path d="M2 2 L8 8 M8 2 L2 8" />
  </svg>
);
const CHECK = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 6.3 L5 8.6 L9.5 3.6" />
  </svg>
);

function crumbOf(git, repo) {
  const pr = git?.pr || null;
  const remote = git?.remote || null;
  const owner = pr?.owner || remote?.owner || '';
  const name = pr?.repo || remote?.repo || repo || 'repo';
  const state = String(pr?.state || '').toLowerCase();
  return {
    owner,
    name,
    number: pr?.number || null,
    title: pr?.title || '',
    state: state === 'merged' || state === 'open' || state === 'closed' ? state : '',
  };
}

function compareLabel(git) {
  const base = git?.baseShort;
  const head = git?.headShort;
  if (!base || !head) return null;
  const merged = String(git?.pr?.state || '').toUpperCase() === 'MERGED';
  return { base, head, verb: merged ? 'merge' : 'head' };
}

function Toggle({ on, label, onClick }) {
  return (
    <div className="ex-prow">
      <span className="k">{label}</span>
      <button type="button" className={`ex-tog${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={onClick}>
        <i />
      </button>
    </div>
  );
}

function Seg({ options, value, onChange, label }) {
  return (
    <div className="ex-mseg" role="group" aria-label={label}>
      {options.map((opt) => (
        <button key={opt.id} type="button" className={value === opt.id ? 'on' : ''} aria-pressed={value === opt.id} onClick={() => onChange(opt.id)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ExplorerChrome({
  view,
  onView,
  git,
  repo,
  status,
  summary,
  zoom,
  onZoomIn,
  onZoomOut,
  api,
  menu,
  mark,
  sheetOpen,
}) {
  const [filtersOn, setFiltersOn] = useState(false);
  const [menuOn, setMenuOn] = useState(false);
  const [legendOn, setLegendOn] = useState(false);
  const [markOn, setMarkOn] = useState(false);
  const [summaryOn, setSummaryOn] = useState(true);
  const wrap = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (!wrap.current?.contains(e.target)) {
        setFiltersOn(false);
        setMenuOn(false);
        setLegendOn(false);
        setMarkOn(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const crumb = crumbOf(git, repo);
  const cmp = compareLabel(git);
  const filesMode = api?.focusOn ? 'focus' : api?.onlyGit ? 'changed' : 'all';

  return (
    <div className="ex-chrome" ref={wrap}>
      <header className="ex-bar">
        <div className="ex-logo">{LOGO}</div>
        <div className="ex-crumb">
          {crumb.owner && <span>{crumb.owner}</span>}
          {crumb.owner && <span className="sep">/</span>}
          <b>{crumb.name}</b>
          {crumb.number && (
            <>
              <span className="sep">/</span>
              <span className="ex-prno">#{crumb.number}</span>
              {crumb.title && <span className="title">{crumb.title}</span>}
            </>
          )}
        </div>
        {crumb.state && <span className="ex-state">{crumb.state}</span>}
        <div className="ex-seg" role="tablist" aria-label="Explorer view">
          {['graph', 'flow'].map((id) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => onView?.(id)}>
              {id === 'graph' ? 'Graph' : 'Flow'}
            </button>
          ))}
        </div>
        <div className="ex-right">
          {(cmp || mark) && (
            <div className="ex-pill">
              {mark && (
                <>
                  <button type="button" className="ex-pill-mode" onClick={() => setMarkOn((v) => !v)} aria-expanded={markOn}>
                    {mark.modes.find((m) => m.id === mark.value)?.label || 'this PR'}
                    {CHEV}
                  </button>
                  <span className="div" />
                  {markOn && (
                    <div className="ex-mark-menu">
                      {mark.modes.map((m) => (
                        <button key={m.id} type="button" className={m.id === mark.value ? 'on' : ''} onClick={() => { mark.onChange(m.id); setMarkOn(false); }}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {cmp && <span>vs <span className="v">{cmp.base}</span> · {cmp.verb} <span className="v">{cmp.head}</span></span>}
            </div>
          )}
          <button type="button" className={`ex-ib${filtersOn ? ' on' : ''}`} aria-label="Filters" aria-expanded={filtersOn} onClick={() => { setFiltersOn((v) => !v); setMenuOn(false); }}>
            {SLIDERS}
          </button>
          <button type="button" className={`ex-ib${menuOn ? ' on' : ''}`} aria-label="More" aria-expanded={menuOn} onClick={() => { setMenuOn((v) => !v); setFiltersOn(false); }}>
            {MORE}
          </button>
        </div>
      </header>

      {status && <div className="ex-status">{status}</div>}

      {filtersOn && (
        <div className="ex-pop" role="dialog" aria-label="Filters">
          <div className="caret" />
          {api ? <Filters api={api} filesMode={filesMode} /> : <div className="ex-phd">Graph filters load with the graph.</div>}
        </div>
      )}

      {menuOn && <Overflow menu={menu} api={api} onClose={() => setMenuOn(false)} />}

      {summaryOn && summary && <Summary summary={summary} sheetOpen={sheetOpen} onClose={() => setSummaryOn(false)} />}

      <button type="button" className="ex-help" aria-label="Legend" onClick={() => setLegendOn((v) => !v)}>?</button>
      {legendOn && <Legend api={api} />}

      <div className="ex-zoom" aria-label="Zoom">
        <button type="button" onClick={onZoomOut} aria-label="Zoom out">−</button>
        <span className="pct">{zoom || '100%'}</span>
        <button type="button" onClick={onZoomIn} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}

function Filters({ api, filesMode }) {
  return (
    <>
      <div className="ex-phd">Show</div>
      <div className="ex-prow">
        <span className="k">Files</span>
        <Seg
          label="Files"
          value={filesMode}
          onChange={(id) => api.setFilesMode(id)}
          options={[{ id: 'focus', label: 'Focus' }, { id: 'changed', label: 'Changed only' }, { id: 'all', label: 'All' }]}
        />
      </div>
      <div className="ex-prow">
        <span className="k">Start from</span>
        <select
          className="ex-sel"
          aria-label="Start from"
          value={api.focusSeedMode === 'picked' ? 'picked' : 'changed'}
          onChange={(e) => {
            if (e.target.value === 'changed') api.useChangedSeeds();
            else if (api.focusSeeds?.length >= 2) api.usePickedSeeds();
            else api.openFocusPick('seed');
          }}
        >
          <option value="changed">Changed files</option>
          <option value="picked">Hand-picked</option>
        </select>
      </div>
      {(api.focusSeedChips?.length > 0) && (
        <div className="ex-chips">
          {api.focusSeedChips.map((chip) => (
            <span key={chip.id} className="ex-chip">
              {chip.label}
              {chip.removable && <button type="button" aria-label={`Remove ${chip.label}`} onClick={() => api.removeFocusSeed(chip.id)}>×</button>}
            </span>
          ))}
          {api.focusSeedMore > 0 && <span className="k">+{api.focusSeedMore}</span>}
        </div>
      )}
      {api.focusSeedMode === 'picked' && api.focusSeeds?.length < 2 && (
        <div className="ex-phd">Pick 2–4 files</div>
      )}
      <div className="ex-prow" style={{ paddingTop: 2, paddingBottom: 2 }}>
        <button type="button" className="ex-pfoot" style={{ padding: 0 }} onClick={() => api.openFocusPick('seed')}>
          <span className="link">+ add seed</span>
        </button>
      </div>
      {api.focusPick === 'seed' && <PickList api={api} placeholder="Search files to seed" />}
      <div className="ex-prow">
        <span className="k">Hops</span>
        <Seg label="Hops" value={String(api.focusHops)} onChange={(id) => api.setFocusHops(Number(id))} options={[{ id: '1', label: '1' }, { id: '2', label: '2' }, { id: '3', label: '3' }]} />
      </div>
      <div className="ex-prow">
        <span className="k">Direction</span>
        <Seg label="Direction" value={api.focusDir} onChange={api.setFocusDir} options={[{ id: 'in', label: 'in' }, { id: 'out', label: 'out' }, { id: 'both', label: 'both' }]} />
      </div>
      <div className="ex-pdiv" />
      <div className="ex-prow">
        <span className="k">Subfolder depth</span>
        <span className="mono" style={{ fontSize: 11.5 }}>{api.folderDepth}</span>
      </div>
      <div className="ex-depth">
        <input type="range" min={0} max={3} step={1} value={api.folderDepth} aria-label="Subfolder depth" onChange={api.onFolderDepth} />
        <div className="ends"><span>top folders</span><span>deeper</span></div>
      </div>
      <div className="ex-pdiv" />
      <Toggle label="Diff fill on changed files" on={!!api.highlightGit} onClick={api.toggleHighlightGit} />
      <Toggle label="Only changed imports" on={!!api.onlyChangedImports} onClick={api.toggleOnlyChangedImports} />
      <Toggle label="Hide tests" on={!!api.hideTests} onClick={api.toggleTestsUnified} />
      <Toggle label="API calls · typed hops" on={!!api.showCalls && api.hopsOn} onClick={api.toggleApiHops} />
      <Toggle label="Show generated files" on={!api.hideGenerated} onClick={api.toggleGenerated} />
      <div className="ex-pdiv" />
      <div className="ex-prow" style={{ paddingTop: 6 }}>
        <span className="k">Watch files</span>
        <button type="button" className="link" style={{ border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12, color: '#d2cefd' }} onClick={() => api.openFocusPick('pin')}>+ Pin</button>
      </div>
      {!!api.focusPinChips?.length && (
        <div className="ex-chips">
          {api.focusPinChips.map((chip) => (
            <span key={chip.id} className="ex-chip" title={chip.badge || ''}>
              {chip.label}
              <button type="button" aria-label={`Remove ${chip.label}`} onClick={() => api.removeFocusPin(chip.id)}>×</button>
            </span>
          ))}
        </div>
      )}
      {api.focusPick === 'pin' && <PickList api={api} placeholder="Search files to pin" />}
      {!!api.groups?.length && (
        <div className="ex-folders">
          {api.groups.map((g) => (
            <button key={g.id} type="button" onClick={g.onClick} style={{ borderColor: g.bg && g.bg !== 'transparent' ? g.color : undefined }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: g.color }} />
              {g.label}
              <span style={{ color: '#686c83' }}>{g.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="ex-pdiv" />
      <div className="ex-pfoot">
        <button type="button" onClick={api.resetView}>Reset</button>
        <button type="button" className="link" onClick={api.copyViewLink}>{api.focusCopied || 'Copy view link'}</button>
      </div>
    </>
  );
}

function PickList({ api, placeholder }) {
  return (
    <div className="ex-search">
      <input autoFocus value={api.focusQuery || ''} onChange={api.onFocusQuery} placeholder={placeholder} aria-label={placeholder} />
      {api.focusMatches?.map((hit) => (
        <button key={hit.id} type="button" className="hit" onClick={() => api.pickFocusMatch(hit.id)}>{hit.label}</button>
      ))}
    </div>
  );
}

function Overflow({ menu, api, onClose }) {
  return (
    <div className="ex-menu" role="menu">
      <div className="caret" />
      <div className="block">
        <div className="lab">Search</div>
        <input
          value={menu?.query || ''}
          onChange={(e) => menu?.onQuery?.(e.target.value)}
          placeholder={menu?.scope === 'all' ? 'Search all open repos…' : 'Search this repo…'}
          aria-label="Search"
        />
        <button type="button" className="item" onClick={menu?.onToggleScope}>
          {menu?.scope === 'all' ? 'Searching all open repos' : 'Searching this repo'}
        </button>
        {menu?.scope === 'all' && menu?.hits?.map((hit) => (
          <button key={hit.key} type="button" className="item" onClick={() => { menu.onPick?.(hit); onClose(); }}>
            {hit.label} · {hit.repo}
          </button>
        ))}
      </div>
      <div className="ex-pdiv" />
      {!!menu?.tabs?.length && (
        <div className="block">
          <div className="lab">Open repos</div>
          {menu.tabs.map((tab) => (
            <span key={tab.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button type="button" className="item" style={{ flex: 1 }} onClick={() => menu.onActivate?.(tab.id)}>
                {tab.title}{tab.id === menu.activeId ? ' · current' : ''}
              </button>
              <button type="button" className="item" aria-label={`Close ${tab.title}`} onClick={() => menu.onClose?.(tab.id)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="block">
        <button type="button" className="item" onClick={() => { menu?.onOpenRepo?.(); onClose(); }}>+ Open a repository</button>
        <button type="button" className="item" onClick={() => api?.refit?.()}>Recenter</button>
        {api?.onReanalyze && (
          <button type="button" className="item" onClick={api.onReanalyze}>Re-analyze</button>
        )}
      </div>
      {api && (
        <>
          <div className="ex-pdiv" />
          <form className="block" onSubmit={(e) => { e.preventDefault(); api.submitBranch(); }}>
            <div className="lab">Switch branch</div>
            <input value={api.branchInput || ''} onChange={api.onBranchInput} placeholder="Branch, org/repo@branch, or tree URL" aria-label="Branch" />
            {api.branchError && <div className="err">{api.branchError}</div>}
          </form>
          <form className="block" onSubmit={(e) => { e.preventDefault(); api.submitCompare(); }}>
            <div className="lab">Compare to a pull request</div>
            <input value={api.compareInput || ''} onChange={api.onCompareInput} placeholder="Paste PR URL or #482" aria-label="Pull request" />
            {api.comparePr && (
              <button type="button" className="item" onClick={api.clearCompare}>Clear pasted PR</button>
            )}
            {api.gitBaseNote && <div className="lab">{api.gitBaseNote}</div>}
          </form>
        </>
      )}
      {api?.gitStale && (
        <div className="block">
          <div className="err">
            {api.gitStaleReason === 'missing' ? 'Branch files are missing from this graph.' : 'The graph is behind the repo. Re-analyze to refresh.'}
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ summary, onClose }) {
  const risky = summary.risky || 0;
  return (
    <div className="ex-summary">
      {summary.kind === 'flow' ? (
        <span><b>{summary.functions || 0}</b> functions changed</span>
      ) : (
        <span><b>{summary.files || 0}</b> files changed</span>
      )}
      {summary.kind !== 'flow' && (summary.adds || summary.dels) ? (
        <>
          <span className="sepd" />
          <span className="mono"><span className="plus">+{summary.adds || 0}</span> <span className="minus">−{summary.dels || 0}</span></span>
        </>
      ) : null}
      <span className="sepd" />
      {summary.kind === 'flow' ? (
        <span><b>{summary.calls || 0}</b> new calls</span>
      ) : (
        <span><b>{summary.imports || 0}</b> new imports</span>
      )}
      <span className="sepd" />
      {risky > 0 ? (
        <span className="bad">{risky} risky edge{risky === 1 ? '' : 's'}</span>
      ) : (
        <span className="ok">{CHECK}0 risky edges</span>
      )}
      <button type="button" className="x" aria-label="Dismiss summary" onClick={onClose}>{X}</button>
    </div>
  );
}

function Legend({ api }) {
  return (
    <div className="ex-legend" role="dialog" aria-label="Legend">
      <h4>LEGEND</h4>
      <div className="row"><span className="ex-swatch" style={{ background: '#2EFF7A' }} />added — square is all green</div>
      <div className="row">
        <span className="ex-swatch" style={{ background: 'linear-gradient(to top, #2EFF7A 0 55%, #FF4D5E 55% 80%, transparent 80%)', border: '1px solid rgba(255,255,255,.45)' }} />
        edited — green added, red removed
      </div>
      <div className="row"><span className="ex-swatch" style={{ border: '1px solid rgba(255,255,255,.35)' }} />unchanged — hollow, sized by lines</div>
      <div className="row"><span style={{ width: 16, borderTop: '1.5px solid #6ec8d4' }} />import</div>
      <div className="row"><span style={{ width: 16, borderTop: '1.5px dashed #9184d9' }} />API call, when that layer is on</div>
      <div className="row"><span className="ex-swatch" style={{ background: '#9184d9', borderRadius: 99 }} />selected</div>
      {!!api?.groups?.length && (
        <div className="ex-folders" style={{ padding: '8px 0 0' }}>
          {api.groups.map((g) => (
            <button key={g.id} type="button" onClick={g.onClick}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: g.color }} />
              {g.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { CHECK };

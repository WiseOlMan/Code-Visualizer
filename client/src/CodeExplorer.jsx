import React from 'react';
import { CodeGraphEngine } from './codeGraphLogic.js';
import { ExplorerChrome } from './ExplorerChrome.jsx';
import './explorer.css';

function LinkBtn({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', alignItems: 'stretch',
        textAlign: 'left', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
        border: '1px solid transparent', background: 'var(--color-surface)', cursor: 'pointer',
        fontFamily: 'inherit', width: '100%', color: 'inherit',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent-700)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
    >
      {children}
    </button>
  );
}

/** Left-panel toggle: filled rail when open (collapse), outline rail when closed (expand). */
function FileGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M2.5 1.5h4L9.5 4.5V10.5h-7z" stroke="#d2cefd" fill="none" strokeWidth="1" />
      <path d="M6.5 1.6V4.4H9.4" stroke="#d2cefd" fill="none" strokeWidth="1" />
    </svg>
  );
}

function RadioDot({ on }) {
  return (
    <span style={{
      width: 12, height: 12, borderRadius: 99, flex: 'none', boxSizing: 'border-box',
      border: `1.5px solid ${on ? '#9184d9' : '#75798c'}`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {on && <span style={{ width: 6, height: 6, borderRadius: 99, background: '#9184d9' }} />}
    </span>
  );
}

function Switch({ on }) {
  return (
    <span aria-hidden="true" style={{
      width: 30, height: 16, borderRadius: 99, flex: 'none', position: 'relative',
      background: on ? '#9184d9' : '#3f424d',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 14 : 2, width: 12, height: 12,
        borderRadius: 99, background: '#f3f5fe',
      }} />
    </span>
  );
}

function SegButton({ on, children, onClick, label }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      style={{
        minWidth: 28, padding: '4px 8px', borderRadius: 8, cursor: 'pointer',
        font: 'inherit', fontSize: 12,
        border: `1px solid ${on ? '#9184d9' : '#3f424d'}`,
        background: on ? '#423a6a' : 'transparent',
        color: on ? '#f5f4ff' : '#b2b6ca',
      }}
    >{children}</button>
  );
}

function FocusChip({ label, badge, onRemove }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%',
      padding: '3px 6px', borderRadius: 8,
      background: '#2b2741', border: '1px solid #5d5294',
      fontSize: 11, color: '#e9e9ed',
    }}>
      <FileGlyph />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {badge === 'untouched' && <span title="untouched">✅</span>}
      {badge === 'touched' && <span title="touched">⚠️</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          style={{ border: 'none', background: 'none', color: '#b2b6ca', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}
        >×</button>
      )}
    </span>
  );
}

function FocusCard({ v }) {
  const row = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    width: '100%', padding: 0, border: 'none', background: 'none', color: 'inherit',
    font: 'inherit', fontSize: 12, cursor: 'pointer', textAlign: 'left',
  };
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: 'var(--space-4)', borderRadius: 'var(--radius-md)',
      background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ fontSize: 12, letterSpacing: '0.04em', color: 'var(--color-neutral-300)' }}>Focus</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {v.focusSeedChips.map((chip) => (
          <FocusChip
            key={chip.id}
            label={chip.label}
            onRemove={chip.removable ? () => v.removeFocusSeed(chip.id) : null}
          />
        ))}
        {v.focusSeedMore > 0 && (
          <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', alignSelf: 'center' }}>+{v.focusSeedMore}</span>
        )}
      </div>
      {v.focusSeedMode === 'picked' && v.focusSeeds.length < 2 && (
        <div style={{ fontSize: 10.5, color: '#e6c07b' }}>Pick 2–4 files</div>
      )}
      <button
        type="button"
        onClick={() => v.openFocusPick('seed')}
        style={{ ...row, color: '#d2cefd', justifyContent: 'flex-start', gap: 6 }}
      >
        + add seed
      </button>
      {v.focusPick === 'seed' && (
        <FocusSearch v={v} placeholder="Search files to seed" />
      )}
      <button type="button" onClick={v.useChangedSeeds} style={row} aria-pressed={v.focusSeedMode === 'changed'}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <RadioDot on={v.focusSeedMode === 'changed'} />
          <span><span style={{ color: 'var(--color-neutral-500)' }}>or · </span>Seed = changed files</span>
        </span>
      </button>
      {v.focusSeeds.length >= 2 && (
        <button type="button" onClick={v.usePickedSeeds} style={row} aria-pressed={v.focusSeedMode === 'picked'}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <RadioDot on={v.focusSeedMode === 'picked'} />
            Hand-picked seeds
          </span>
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Hops</span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {[1, 2, 3].map((n) => (
            <SegButton key={n} on={v.focusHops === n} label={`${n} hop${n === 1 ? '' : 's'}`} onClick={() => v.setFocusHops(n)}>{n}</SegButton>
          ))}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Direction</span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {['in', 'out', 'both'].map((dir) => (
            <SegButton key={dir} on={v.focusDir === dir} label={`Direction ${dir}`} onClick={() => v.setFocusDir(dir)}>{dir}</SegButton>
          ))}
        </span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Watch</div>
      {!!v.focusPinChips.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {v.focusPinChips.map((chip) => (
            <FocusChip
              key={chip.id}
              label={chip.label}
              badge={chip.badge}
              onRemove={() => v.removeFocusPin(chip.id)}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => v.openFocusPick('pin')}
        style={{ ...row, color: '#d2cefd', justifyContent: 'flex-start', gap: 6 }}
      >
        + pin file
      </button>
      {v.focusPick === 'pin' && (
        <FocusSearch v={v} placeholder="Search files to pin" />
      )}

      <button type="button" onClick={v.toggleFocusTests} role="switch" aria-checked={v.focusHideTests} style={row}>
        <span>Hide tests</span>
        <Switch on={v.focusHideTests} />
      </button>
      <button type="button" onClick={v.toggleFocus} role="switch" aria-checked={v.focusOn} style={row}>
        <span>Hide the rest</span>
        <Switch on={v.focusOn} />
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={v.copyFocusJson} style={{ fontSize: 11, padding: '4px 0' }}>
          {v.focusCopied || 'Copy focus JSON'}
        </button>
        {v.focusOn && (
          <button type="button" className="btn btn-ghost" onClick={v.clearFocus} style={{ fontSize: 11, padding: '4px 0' }}>
            Clear focus
          </button>
        )}
      </div>
    </div>
  );
}

function FocusSearch({ v, placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input
        className="input"
        autoFocus
        value={v.focusQuery}
        onChange={v.onFocusQuery}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{ fontSize: 11, padding: '5px 8px', minHeight: 28 }}
      />
      {v.focusMatches.map((hit) => (
        <button
          key={hit.id}
          type="button"
          onClick={() => v.pickFocusMatch(hit.id)}
          style={{
            textAlign: 'left', fontSize: 11, padding: '4px 6px', cursor: 'pointer',
            border: '1px solid transparent', borderRadius: 6, background: 'transparent',
            color: 'var(--color-text)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >{hit.label}</button>
      ))}
    </div>
  );
}

export class CodeExplorer extends CodeGraphEngine {
  render() {
    const v = this.renderVals();
    const sel = v.sel;

    return (
      <div className={`ex-root${sel ? ' sheet-open' : ''}`}>
        {this.props.viewActive !== false && (
          <ExplorerChrome
            view="graph"
            onView={this.props.onView}
            git={this.props.gitInfo}
            repo={v.repoName}
            status={v.statusLine}
            summary={v.graphSummary}
            zoom={v.zoomLabel}
            onZoomIn={() => this.zoomBy(1.15)}
            onZoomOut={() => this.zoomBy(1 / 1.15)}
            api={v}
            menu={this.props.menu}
            sheetOpen={!!sel}
          />
        )}
        <div className="ex-stage">
          <canvas ref={v.canvasRef} />
          {v.captureBanner && (
            <div role="status" data-capture-banner className="ex-capture-banner">
              {v.captureBanner}
            </div>
          )}
          {v.hoverTip && (
            <div ref={v.tipRef} className="ex-tip">
              <div className="t">
                {v.hoverTip.changed && (
                  <>
                    {v.hoverTip.adds > 0 && <span className="plus">+{v.hoverTip.adds}</span>}
                    {v.hoverTip.dels > 0 && <span className="minus">{v.hoverTip.adds ? ' ' : ''}−{v.hoverTip.dels}</span>}
                    <span style={{ color: '#4a4e66' }}> · </span>
                  </>
                )}
                {v.hoverTip.name}
              </div>
              {v.hoverTip.summary && <div className="sum">{v.hoverTip.summary}</div>}
              <div className="meta">
                {v.hoverTip.path} · {v.hoverTip.lines || '—'} lines · imports {v.hoverTip.imports} · imported by {v.hoverTip.importedBy}
              </div>
            </div>
          )}
          {v.hopCard && (
            <div
              ref={v.hopCardRef}
              style={{
                position: 'absolute', left: v.hopCard.x, top: v.hopCard.y, zIndex: 6,
                width: 292, pointerEvents: 'auto',
                background: 'var(--color-surface)', border: '1px solid var(--color-neutral-800)',
                borderLeft: `3px solid ${v.hopCard.color}`,
                boxShadow: 'var(--shadow-md)',
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
                padding: '10px 12px', borderBottom: '1px solid var(--color-neutral-900)',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: v.hopCard.color, fontWeight: 500,
                  }}>{v.hopCard.kindLabel}</div>
                  <div style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 13, color: 'var(--color-text)', marginTop: 2, wordBreak: 'break-all',
                  }}>{v.hopCard.label}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                  {v.hopCard.change && (
                    <span style={{ fontSize: 11, color: '#2EFF7A' }}>{v.hopCard.change}</span>
                  )}
                  <button type="button" className="btn btn-icon btn-ghost" onClick={v.clearHop}
                    style={{ width: 28, height: 28, color: 'var(--color-neutral-500)' }}>✕</button>
                </div>
              </div>
              <div style={{ padding: '8px 8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {v.hopCard.urls.map((u) => (
                  <div key={u} style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 11, color: 'var(--color-accent-300)', padding: '4px 8px', wordBreak: 'break-all',
                  }}>{u}</div>
                ))}
                {v.hopCard.fields.map((f) => (
                  <div key={f.name} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                    background: 'rgba(46,255,122,0.12)',
                  }}>
                    <span style={{
                      width: 110, flexShrink: 0,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 12, color: '#2EFF7A',
                    }}>{f.name}</span>
                    {f.from ? (
                      <>
                        <span style={{
                          flex: 1, minWidth: 0,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: 12, color: 'var(--color-neutral-500)', wordBreak: 'break-all',
                        }}>{f.from}</span>
                        <span style={{ flex: 'none', fontSize: 12, color: 'var(--color-neutral-500)' }}>→</span>
                        <span style={{
                          flex: 1, minWidth: 0,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: 12, color: 'var(--color-text)', wordBreak: 'break-all',
                        }}>{f.to || '—'}</span>
                      </>
                    ) : (
                      <span style={{
                        flex: 1, minWidth: 0,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 12, color: 'var(--color-text)', wordBreak: 'break-all',
                      }}>{f.to || '—'}</span>
                    )}
                  </div>
                ))}
                {!v.hopCard.fields.length && !v.hopCard.urls.length && (
                  <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '4px 8px' }}>
                    {v.hopCard.from} → {v.hopCard.to}
                  </div>
                )}
              </div>
              {!!v.hopCard.protected?.length && (
                <div style={{
                  padding: '8px 12px 12px', borderTop: '1px solid var(--color-neutral-900)',
                  fontSize: 11, lineHeight: '16px', color: 'var(--color-neutral-500)',
                }}>
                  Protected, not in this write: {v.hopCard.protected.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>

        {sel && (
          <aside className="ex-sheet">
            <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '16px 16px 0' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-heading-weight)', fontSize: 15, wordBreak: 'break-word' }}>{sel.label}</div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'var(--color-neutral-500)', marginTop: 'var(--space-1)', wordBreak: 'break-all' }}>{sel.path}</div>
              {this.props.onShowInFlow && (
                <button
                  type="button"
                  onClick={() => this.props.onShowInFlow(sel.path)}
                  style={{
                    marginTop: 6, padding: 0, border: 'none', background: 'none', cursor: 'pointer',
                    color: '#9184d9', font: 'inherit', fontSize: 11,
                  }}
                >Show in flow</button>
              )}
              </div>
              <button type="button" className="btn btn-icon btn-ghost" onClick={v.clearSel} style={{ flex: 'none' }}>✕</button>
            </div>

            <div style={{ flex: 'none', display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 16px 0' }}>
              {[
                { id: 'details', label: 'Details' },
                { id: 'source', label: 'Source' },
              ].map((tab) => {
                const on = v.panelTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => v.setPanelTab(tab.id)}
                    style={{
                      fontSize: 12, padding: '6px 10px',
                      border: '1px solid',
                      borderColor: on ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
                      color: on ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
                      background: on ? 'var(--color-accent-900)' : 'transparent',
                    }}
                  >
                    {tab.label}
                    {tab.id === 'source' && sel.codeMeta ? ` · ${sel.codeMeta}` : ''}
                  </button>
                );
              })}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', padding: '12px 16px 20px' }}>
              {v.panelTab === 'source' ? (
                sel.diffLines?.length ? (
                  <div style={{
                    margin: 0, padding: '6px 0', borderRadius: 'var(--radius-md)',
                    background: 'var(--color-neutral-900)', color: 'var(--color-neutral-200)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, lineHeight: 1.55,
                    overflow: 'auto', flex: 1, boxShadow: 'var(--shadow-sm)',
                  }}>
                    {sel.codeDiff?.base && (
                      <div style={{
                        padding: '4px 10px 8px', fontSize: 10.5, color: 'var(--color-neutral-500)',
                        borderBottom: '1px solid var(--color-neutral-800)', marginBottom: 4,
                      }}>
                        vs {sel.codeDiff.base}
                      </div>
                    )}
                    {sel.diffLines.map((line, i) => {
                      const bg = line.type === 'add' ? 'rgba(46,255,122,0.14)'
                        : line.type === 'del' ? 'rgba(255,77,94,0.16)'
                        : 'transparent';
                      const fg = line.type === 'add' ? '#9dffc0'
                        : line.type === 'del' ? '#ffb0b8'
                        : 'var(--color-neutral-300)';
                      const mark = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
                      const markColor = line.type === 'add' ? '#2EFF7A'
                        : line.type === 'del' ? '#FF4D5E'
                        : 'var(--color-neutral-700)';
                      return (
                        <div key={i} style={{
                          display: 'flex', gap: 8, padding: '0 10px',
                          background: bg, color: fg, whiteSpace: 'pre',
                        }}>
                          <span style={{ flex: 'none', width: 10, color: markColor, userSelect: 'none' }}>{mark}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>{line.text || ' '}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : sel.hasCode ? (
                  <pre style={{
                    margin: 0, padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                    background: 'var(--color-neutral-900)', color: 'var(--color-neutral-200)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, lineHeight: 1.6,
                    overflow: 'auto', flex: 1, whiteSpace: 'pre', boxShadow: 'var(--shadow-sm)',
                  }}>{sel.code}</pre>
                ) : sel.gitChanged ? (
                  <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>Loading diff…</div>
                ) : (
                  <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>Loading source…</div>
                )
              ) : (
                <>
                  {sel.endpoint && (
                    <div style={{
                      flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
                      padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)',
                      border: '1px solid var(--color-accent-800)', boxShadow: 'var(--shadow-sm)',
                    }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent-300)' }}>Backend endpoint</div>
                      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, wordBreak: 'break-all' }}>{sel.endpoint.url}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                        {sel.endpoint.methods.map((m) => (
                          <span key={m.name} className="tag tag-accent" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5, letterSpacing: '0.04em' }}>{m.name}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ flex: 'none', display: 'flex', gap: 'var(--space-3)' }}>
                    <div style={{ flex: 1, padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
                      <div style={{ fontSize: 19, fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-heading-weight)' }}>{sel.inDeg}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', marginTop: 1 }}>depend on this</div>
                    </div>
                    <div style={{ flex: 1, padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
                      <div style={{ fontSize: 19, fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-heading-weight)' }}>{sel.outDeg}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', marginTop: 1 }}>this imports</div>
                    </div>
                  </div>

                  {sel.hasCallers && (
                    <section style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>
                        Called by <span style={{ color: 'var(--color-neutral-500)' }}>{sel.callerCount}</span>
                      </div>
                      {sel.callers.map((c) => (
                        <LinkBtn key={c.path} onClick={c.onClick}>
                          <span style={{ fontSize: 12, wordBreak: 'break-all' }}>{c.path}</span>
                          {c.urls.map((u) => (
                            <span key={u.text} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5, lineHeight: 1.5, color: 'var(--color-accent-300)', wordBreak: 'break-all' }}>{u.text}</span>
                          ))}
                        </LinkBtn>
                      ))}
                    </section>
                  )}

                  {sel.hasCallsOut && (
                    <section style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>
                        Calls endpoints <span style={{ color: 'var(--color-neutral-500)' }}>{sel.callsOutCount}</span>
                      </div>
                      {sel.callsOut.map((c) => (
                        <LinkBtn key={c.path} onClick={c.onClick}>
                          <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, color: 'var(--color-accent-300)', wordBreak: 'break-all', flex: 1 }}>{c.url}</span>
                            <span style={{ fontSize: 10, letterSpacing: '0.04em', color: 'var(--color-neutral-500)', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{c.methods}</span>
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', wordBreak: 'break-all' }}>{c.path}</span>
                        </LinkBtn>
                      ))}
                    </section>
                  )}

                  {sel.hasSymbols && (
                    <section style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>What others take from it</div>
                      {sel.symbolRows.map((r) => (
                        <div key={r.sym} style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
                            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, color: 'var(--color-accent-300)', wordBreak: 'break-all', flex: 1 }}>{r.sym}</span>
                            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>{r.label}</span>
                          </div>
                          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5, lineHeight: 1.5, color: 'var(--color-neutral-500)', wordBreak: 'break-word' }}>{r.sig}</span>
                        </div>
                      ))}
                    </section>
                  )}

                  <section style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>Imported by</div>
                    {sel.incoming.map((e) => (
                      <LinkBtn key={e.path} onClick={e.onClick}>
                        <span style={{ fontSize: 12, wordBreak: 'break-all' }}>{e.path}</span>
                        {e.syms.map((sy) => (
                          <span key={sy.name} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5, lineHeight: 1.5, color: 'var(--color-accent-300)', wordBreak: 'break-word' }}>
                            {sy.name}<span style={{ color: 'var(--color-neutral-500)' }}>{sy.sig ? ` ${sy.sig}` : ''}</span>
                          </span>
                        ))}
                        {e.loadsModule && !e.syms.length && (
                          <span style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>loads module</span>
                        )}
                      </LinkBtn>
                    ))}
                    {sel.noIncoming && <div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>Nothing imports this — entry point or dead code.</div>}
                  </section>

                  <section style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>Imports</div>
                    {sel.outgoing.map((e) => (
                      <LinkBtn key={e.path} onClick={e.onClick}>
                        <span style={{ fontSize: 12, wordBreak: 'break-all' }}>{e.path}</span>
                        {e.syms.map((sy) => (
                          <span key={sy.name} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5, lineHeight: 1.5, color: 'var(--color-accent-2-300)', wordBreak: 'break-word' }}>
                            {sy.name}<span style={{ color: 'var(--color-neutral-500)' }}>{sy.sig ? ` ${sy.sig}` : ''}</span>
                          </span>
                        ))}
                        {e.loadsModule && !e.syms.length && (
                          <span style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>loads module</span>
                        )}
                      </LinkBtn>
                    ))}
                    {sel.noOutgoing && <div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>Imports nothing local — a leaf.</div>}
                  </section>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    );
  }
}

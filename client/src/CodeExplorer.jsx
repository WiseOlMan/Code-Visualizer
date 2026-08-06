import React from 'react';
import { CodeGraphEngine } from './codeGraphLogic.js';

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
function SidebarIcon({ open }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.5" y="3" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 3.5v11" stroke="currentColor" strokeWidth="1.4" />
      {open ? (
        <rect x="3.2" y="3.8" width="3.2" height="10.4" fill="currentColor" opacity="0.85" />
      ) : (
        <path d="M9.5 9h4M11.75 7.25L13.5 9l-1.75 1.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export class CodeExplorer extends CodeGraphEngine {
  render() {
    const v = this.renderVals();
    const sel = v.sel;

    return (
      <div style={{
        display: 'flex', width: '100%', height: '100%', overflow: 'hidden',
        background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)',
      }}>
        {v.sidebarOpen && (
          <aside style={{
            flex: 'none', width: 266, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)',
            padding: 'var(--space-6)', boxSizing: 'border-box',
            borderRight: '1px solid var(--color-neutral-900)', overflowY: 'auto',
          }}>
            <div>
              <div style={{
                fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-heading-weight)',
                fontSize: 17, letterSpacing: '-0.01em',
              }}>{v.repoName}</div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 'var(--space-1)' }}>
                {v.statLine}
              </div>
              {v.gitSummary && (
                <div style={{ fontSize: 11, color: 'var(--color-accent-300)', marginTop: 'var(--space-2)', lineHeight: 1.4 }}>
                  {v.gitSummary}
                </div>
              )}
            </div>

            {v.gitStale && v.onReanalyze && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                background: 'var(--color-accent-900)', border: '1px solid var(--color-accent-700)',
              }}>
                <div style={{ fontSize: 11.5, color: 'var(--color-accent-200)', lineHeight: 1.4 }}>
                  {v.gitStaleReason === 'missing' || v.gitMissing
                    ? `${v.gitMissing} branch file${v.gitMissing === 1 ? '' : 's'} missing from this graph — refreshing…`
                    : v.gitStaleReason === 'sources' || v.gitSourcesNewer
                      ? 'Source files changed since the last analyze — refreshing imports…'
                      : 'Git moved since the last analyze — refreshing the graph…'}
                </div>
                <button type="button" className="btn" onClick={v.onReanalyze}
                  style={{
                    fontSize: 12, padding: '6px 10px',
                    background: 'var(--color-accent-700)', borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-accent-600)',
                  }}>
                  Re-analyze now
                </button>
              </div>
            )}
            {!v.gitStale && v.onReanalyze && v.gitFileCount > 0 && (
              <button type="button" className="btn btn-ghost" onClick={v.onReanalyze}
                style={{ fontSize: 11, padding: 'var(--space-2) var(--space-3)', alignSelf: 'flex-start' }}>
                Re-analyze
              </button>
            )}

            <div style={{
              display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
              padding: 'var(--space-4)', borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)',
            }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 11, color: 'var(--color-neutral-400)' }}>
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  Subfolder depth<span style={{ color: 'var(--color-neutral-600)' }}>{v.folderDepthLabel}</span>
                </span>
                <input
                  type="range" min={0} max={3} step={1}
                  value={v.folderDepth}
                  onChange={v.onFolderDepth}
                  style={{ width: '100%' }}
                />
                <span style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
                  0 = top folders only · 1 = one split · 2–3 = deeper
                </span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <button type="button" className="btn btn-ghost" onClick={v.toggleCalls}
                  style={{ fontSize: 11, whiteSpace: 'nowrap', padding: 'var(--space-2) var(--space-3)', borderColor: v.callsBorder, color: v.callsColor }}>
                  {v.callsLabel}
                </button>
                <button type="button" className="btn btn-ghost" onClick={v.toggleGenerated}
                  style={{ fontSize: 11, whiteSpace: 'nowrap', padding: 'var(--space-2) var(--space-3)', borderColor: v.generatedBorder, color: v.generatedColor }}>
                  {v.generatedLabel}
                </button>
                <button type="button" className="btn btn-ghost" onClick={v.toggleTests}
                  style={{ fontSize: 11, whiteSpace: 'nowrap', padding: 'var(--space-2) var(--space-3)' }}>
                  {v.testsLabel}
                </button>
                <button type="button" className="btn btn-ghost" onClick={v.toggleHighlightGit}
                  style={{
                    fontSize: 11, whiteSpace: 'nowrap', padding: 'var(--space-2) var(--space-3)',
                    borderColor: v.highlightGit ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
                    color: v.highlightGit ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
                  }}>
                  {v.highlightGit ? 'Branch colors on' : 'Branch colors off'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={v.toggleOnlyGit}
                  style={{
                    fontSize: 11, whiteSpace: 'nowrap', padding: 'var(--space-2) var(--space-3)',
                    borderColor: v.onlyGit ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
                    color: v.onlyGit ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
                  }}>
                  {v.onlyGit ? 'Changed files only' : 'All files'}
                </button>
                {v.gitFileCount > 0 && (
                  <button type="button" className="btn btn-ghost" onClick={v.focusGit}
                    style={{ fontSize: 11, whiteSpace: 'nowrap', padding: 'var(--space-2) var(--space-3)' }}>
                    Focus changed
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={v.refit}
                  style={{ fontSize: 11, whiteSpace: 'nowrap', padding: 'var(--space-2) var(--space-3)' }}>
                  Recenter
                </button>
              </div>
              {v.gitFileCount > 0 && (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10.5,
                  color: 'var(--color-neutral-400)', alignItems: 'center',
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: '#2EFF7A', display: 'block' }} />
                    added{v.gitCounts?.A ? ` ${v.gitCounts.A}` : ''}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 99, display: 'block',
                      border: '2px solid #2EFF7A', boxSizing: 'border-box',
                    }} />
                    edited{v.gitCounts?.M ? ` ${v.gitCounts.M}` : ''}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: '#FF4D5E', display: 'block' }} />
                    deleted{v.gitCounts?.D ? ` ${v.gitCounts.D}` : ''}
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {v.groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="tag tag-outline"
                  onClick={g.onClick}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer',
                    fontFamily: 'inherit', whiteSpace: 'nowrap', background: g.bg,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: g.color, display: 'block', flex: 'none' }} />
                  {g.label}
                  <span style={{ color: 'var(--color-neutral-500)' }}>{g.count}</span>
                </button>
              ))}
              <span
                className="tag tag-outline"
                title="Endpoint"
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                <canvas ref={v.legendRef} width={52} height={26} style={{ width: 26, height: 13, flex: 'none' }} />
                Endpoint
              </span>
            </div>

            {v.labelCycleHint && (
              <div style={{
                color: 'var(--color-accent-300)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 11,
              }}>
                {v.labelCycleHint}
              </div>
            )}
          </aside>
        )}

        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <canvas ref={v.canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', cursor: 'grab' }} />

          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={this.props.onToggleSidebar}
            title={v.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-label={v.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            style={{
              position: 'absolute', top: 12, left: 12, zIndex: 5,
              width: 34, height: 34,
              border: 'none',
              background: 'color-mix(in srgb, var(--color-bg) 88%, transparent)',
              color: 'var(--color-neutral-300)',
            }}
          >
            <SidebarIcon open={v.sidebarOpen} />
          </button>
        </div>

        {sel && (
          <aside style={{
            flex: 'none', width: 352, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
            padding: 'var(--space-6)', boxSizing: 'border-box',
            borderLeft: '1px solid var(--color-neutral-900)', background: 'var(--color-bg)', overflow: 'hidden',
          }}>
            <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-heading-weight)', fontSize: 15, wordBreak: 'break-word' }}>{sel.label}</div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'var(--color-neutral-500)', marginTop: 'var(--space-1)', wordBreak: 'break-all' }}>{sel.path}</div>
              </div>
              <button type="button" className="btn btn-icon btn-ghost" onClick={v.clearSel} style={{ flex: 'none' }}>✕</button>
            </div>

            <div style={{ flex: 'none', display: 'flex', gap: 6 }}>
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

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
              {v.panelTab === 'source' ? (
                sel.hasCode ? (
                  <pre style={{
                    margin: 0, padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                    background: 'var(--color-neutral-900)', color: 'var(--color-neutral-200)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, lineHeight: 1.6,
                    overflow: 'auto', flex: 1, whiteSpace: 'pre', boxShadow: 'var(--shadow-sm)',
                  }}>{sel.code}</pre>
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

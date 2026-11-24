/** URL state for Graph | Flow. Focus params stay on the query string. */

export function readExplorerView(search) {
  const raw = search == null && typeof window !== 'undefined' ? window.location.search : (search || '');
  return new URLSearchParams(String(raw).replace(/^\?/, '')).get('view') === 'flow' ? 'flow' : 'graph';
}

export function readFlowParams(search) {
  const raw = search == null && typeof window !== 'undefined' ? window.location.search : (search || '');
  const params = new URLSearchParams(String(raw).replace(/^\?/, ''));
  const flow = Number(params.get('flow'));
  const mark = params.get('mark');
  return {
    flow: Number.isInteger(flow) && flow > 0 ? flow : 1,
    fn: params.get('fn') || '',
    mark: mark === 'before' || mark === 'main' || mark === 'pr' ? mark : 'pr',
    scope: params.get('scope') || '',
  };
}

export function writeExplorerParams(updates) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates || {})) {
    if (value == null || value === '') params.delete(key);
    else params.set(key, String(value));
  }
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(null, '', next);
}

/**
 * Capture readiness for the force graph.
 *
 * Headless shots race the git compare: "Changed files only" can hide every
 * node before /api/git/changes returns, so the canvas is blank and the
 * "vs <base>" line is missing. Callers wait until `ready` (graph loaded,
 * compare settled, one layout frame drawn) or a terminal `compare-error` /
 * `empty` state.
 */

export function classifyCompareResult(result) {
  if (!result || result.networkError) {
    return { phase: 'error', reason: result?.error || 'branch diff request failed' };
  }
  if (!result.ok) {
    return { phase: 'error', reason: result.error || `branch diff failed (${result.status || 'error'})` };
  }
  const data = result.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { phase: 'empty', reason: 'compare returned nothing' };
  }
  if (data.ok === false) {
    return { phase: 'error', reason: data.error || 'branch diff failed' };
  }
  const hasFiles = Array.isArray(data.files) && data.files.length > 0;
  const hasPackages = Array.isArray(data.packages) && data.packages.length > 0;
  if (!hasFiles && !hasPackages) {
    return { phase: 'empty', reason: 'compare returned nothing' };
  }
  return { phase: 'ok', reason: null };
}

/**
 * @param {{
 *   booted: boolean,
 *   hasGraph: boolean,
 *   busy: boolean,
 *   nodeCount: number,
 *   needsCompare: boolean,
 *   comparePhase: 'idle'|'pending'|'ok'|'error'|'empty',
 *   compareReason?: string|null,
 *   frameDrawn: boolean,
 * }} input
 */
export function resolveGraphReadiness(input) {
  const reason = input.compareReason || null;
  const loading = {
    ready: false,
    state: 'loading',
    reason: null,
    banner: null,
  };

  if (!input.booted || input.busy || !input.hasGraph) return loading;

  if (!input.nodeCount) {
    return {
      ready: false,
      state: 'empty',
      reason: 'No files in graph',
      banner: 'No files in graph',
    };
  }

  if (input.needsCompare && input.comparePhase === 'error') {
    const why = reason || 'branch diff failed';
    return {
      ready: false,
      state: 'compare-error',
      reason: why,
      banner: `Compare not loaded: ${why}`,
    };
  }

  if (input.needsCompare && input.comparePhase === 'empty') {
    const why = reason || 'compare returned nothing';
    return {
      ready: false,
      state: 'empty',
      reason: why,
      banner: `Compare not loaded: ${why}`,
    };
  }

  if (input.needsCompare && input.comparePhase !== 'ok') {
    const why = reason || 'waiting for branch diff';
    return {
      ready: false,
      state: 'loading',
      reason: why,
      banner: `Compare not loaded: ${why}`,
    };
  }

  if (!input.frameDrawn) {
    return {
      ready: false,
      state: 'loading',
      reason: 'waiting for layout',
      banner: null,
    };
  }

  return { ready: true, state: 'ready', reason: null, banner: null };
}

/** Mirror readiness onto #root and window so capture scripts can poll it. */
export function publishGraphReadiness(result) {
  if (typeof document === 'undefined') return result;
  const root = document.getElementById('root');
  if (root) {
    root.setAttribute('data-graph-ready', result.ready ? 'true' : 'false');
    root.setAttribute('data-graph-state', result.state);
    if (result.reason) root.setAttribute('data-graph-reason', result.reason);
    else root.removeAttribute('data-graph-reason');
  }
  window.__codeVizReady = result.ready === true;
  window.__codeVizStatus = {
    ready: result.ready === true,
    state: result.state,
    reason: result.reason || null,
  };
  return result;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCompareResult, resolveGraphReadiness } from './graphReadiness.js';

const base = {
  booted: true,
  hasGraph: true,
  busy: false,
  nodeCount: 4,
  needsCompare: true,
  comparePhase: 'pending',
  compareReason: null,
  frameDrawn: false,
};

test('stays loading until the graph, compare, and a layout frame are all in', () => {
  assert.equal(resolveGraphReadiness({ ...base, booted: false }).state, 'loading');
  assert.equal(resolveGraphReadiness({ ...base, busy: true }).banner, null);
  const waiting = resolveGraphReadiness(base);
  assert.equal(waiting.ready, false);
  assert.equal(waiting.state, 'loading');
  assert.equal(waiting.banner, 'Compare not loaded: waiting for branch diff');
  const framed = resolveGraphReadiness({ ...base, comparePhase: 'ok', frameDrawn: false });
  assert.equal(framed.ready, false);
  assert.equal(framed.banner, null);
  const ready = resolveGraphReadiness({ ...base, comparePhase: 'ok', frameDrawn: true });
  assert.deepEqual(ready, { ready: true, state: 'ready', reason: null, banner: null });
});

test('compare failure and an empty payload are terminal, not ready', () => {
  const failed = resolveGraphReadiness({
    ...base,
    comparePhase: 'error',
    compareReason: 'branch diff failed (500)',
    frameDrawn: true,
  });
  assert.equal(failed.ready, false);
  assert.equal(failed.state, 'compare-error');
  assert.equal(failed.banner, 'Compare not loaded: branch diff failed (500)');

  const empty = resolveGraphReadiness({
    ...base,
    comparePhase: 'empty',
    compareReason: 'compare returned nothing',
    frameDrawn: true,
  });
  assert.equal(empty.state, 'empty');
  assert.equal(empty.banner, 'Compare not loaded: compare returned nothing');
});

test('a graph with no nodes explains itself', () => {
  const empty = resolveGraphReadiness({ ...base, nodeCount: 0, comparePhase: 'ok', frameDrawn: true });
  assert.equal(empty.state, 'empty');
  assert.equal(empty.banner, 'No files in graph');
  assert.equal(empty.ready, false);
});

test('static graphs without a workspace root do not wait on compare', () => {
  const ready = resolveGraphReadiness({
    ...base,
    needsCompare: false,
    comparePhase: 'idle',
    frameDrawn: true,
  });
  assert.equal(ready.ready, true);
});

test('classifyCompareResult separates ok, error, and nothing', () => {
  assert.equal(classifyCompareResult({ ok: true, data: { ok: true, files: [], packages: [{ branch: 'main' }] } }).phase, 'ok');
  assert.equal(classifyCompareResult({ ok: false, status: 500, error: 'boom' }).phase, 'error');
  assert.equal(classifyCompareResult({ ok: false, status: 500, error: 'boom' }).reason, 'boom');
  assert.equal(classifyCompareResult({ networkError: true, error: 'ECONNRESET' }).reason, 'ECONNRESET');
  assert.equal(classifyCompareResult({ ok: true, data: { ok: false, error: 'No packages for workspace' } }).phase, 'error');
  assert.equal(classifyCompareResult({ ok: true, data: {} }).phase, 'empty');
  assert.equal(classifyCompareResult({ ok: true, data: null }).reason, 'compare returned nothing');
});

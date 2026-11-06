import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeFocusView,
  decodeFocusQuery,
  defaultHops,
  encodeFocusQuery,
  focusStateJson,
  formatShaPill,
  hopOpacity,
  isTestPath,
  shortDirLabel,
} from './focusView.js';

const link = (source, target) => ({ source, target });

test('default hop count follows how the seeds were chosen', () => {
  assert.equal(defaultHops('changed'), 1);
  assert.equal(defaultHops('picked'), 2);
});

test('hop opacity fades with distance and ignores changed status', () => {
  assert.equal(hopOpacity(0), 1);
  assert.ok(hopOpacity(1) < hopOpacity(0));
  assert.ok(hopOpacity(2) < hopOpacity(1));
  assert.ok(hopOpacity(3) < hopOpacity(2));
  assert.equal(hopOpacity(1), hopOpacity(1));
});

test('short directory hint keeps the last parent and the file name', () => {
  assert.equal(shortDirLabel('lib/placement/couplePlacement.js'), 'placement/couplePlacement.js');
  assert.equal(shortDirLabel('lib/classifier.js'), 'lib/classifier.js');
  assert.equal(shortDirLabel('root.js'), 'root.js');
});

test('test paths match the focus hide-tests rules', () => {
  assert.equal(isTestPath('lib/placement/couplePlacement.test.js'), true);
  assert.equal(isTestPath('src/app.spec.ts'), true);
  assert.equal(isTestPath('src/__tests__/app.js'), true);
  assert.equal(isTestPath('test/helper.js'), true);
  assert.equal(isTestPath('src/tests/helper.ts'), true);
  assert.equal(isTestPath('lib/sync/test.ts'), false);
  assert.equal(isTestPath('lib/classifier.js'), false);
});

test('hops walk outward and stop at N', () => {
  const graph = {
    nodes: ['a.js', 'b.js', 'c.js', 'd.js'].map((id) => ({ id })),
    links: [link('a.js', 'b.js'), link('b.js', 'c.js'), link('c.js', 'd.js')],
  };
  const one = computeFocusView(graph, { seedMode: 'picked', seeds: ['a.js', 'b.js'], hops: 1, direction: 'out' });
  assert.deepEqual(one.nodes.map((n) => n.id).sort(), ['a.js', 'b.js', 'c.js']);
  const two = computeFocusView(graph, { seedMode: 'picked', seeds: ['a.js', 'b.js'], hops: 2, direction: 'out' });
  assert.deepEqual(two.nodes.map((n) => n.id).sort(), ['a.js', 'b.js', 'c.js', 'd.js']);
});

test('direction in follows importers, out follows imports, both walks either way', () => {
  const graph = {
    nodes: ['a.js', 'b.js', 'c.js', 'd.js'].map((id) => ({ id })),
    links: [link('a.js', 'b.js'), link('b.js', 'c.js'), link('d.js', 'b.js')],
  };
  const base = { seedMode: 'picked', seeds: ['b.js', 'c.js'], hops: 1 };
  const out = computeFocusView(graph, { ...base, direction: 'out' });
  assert.deepEqual(out.nodes.map((n) => n.id).sort(), ['b.js', 'c.js']);
  const inn = computeFocusView(graph, { ...base, direction: 'in' });
  assert.deepEqual(inn.nodes.map((n) => n.id).sort(), ['a.js', 'b.js', 'c.js', 'd.js']);
  const both = computeFocusView(graph, { ...base, direction: 'both' });
  assert.deepEqual(both.nodes.map((n) => n.id).sort(), ['a.js', 'b.js', 'c.js', 'd.js']);
  assert.deepEqual(out.edges, [{ source: 'b.js', target: 'c.js' }]);
  assert.ok(inn.edges.some((e) => e.source === 'd.js' && e.target === 'b.js'));
  assert.ok(inn.edges.some((e) => e.source === 'a.js' && e.target === 'b.js'));
  assert.equal(out.nodes.some((n) => n.id === 'd.js'), false);
});

test('changed files are the seeds at 1 hop, and opacity is not the changed marker', () => {
  const graph = {
    nodes: ['root.js', 'lib/classifier.js', 'lib/placement/couplePlacement.js', 'lib/placement/helpers.js', 'lib/other.js'].map((id) => ({ id })),
    links: [
      link('root.js', 'lib/classifier.js'),
      link('lib/classifier.js', 'lib/placement/helpers.js'),
      link('lib/other.js', 'lib/placement/helpers.js'),
    ],
  };
  const changed = [
    { id: 'root.js', status: 'M' },
    { id: 'lib/classifier.js', status: 'M' },
  ];
  const view = computeFocusView(graph, {
    seedMode: 'changed',
    changed,
    hops: 1,
    direction: 'both',
    hideTests: true,
  });
  const byId = Object.fromEntries(view.nodes.map((n) => [n.id, n]));
  assert.equal(byId['root.js'].role, 'seed');
  assert.equal(byId['lib/classifier.js'].role, 'seed');
  assert.equal(byId['lib/placement/helpers.js'].hop, 1);
  assert.equal(byId['lib/other.js'], undefined);
  assert.equal(byId['root.js'].opacity, 1);
  assert.equal(byId['lib/classifier.js'].opacity, byId['root.js'].opacity);
  assert.ok(byId['lib/placement/helpers.js'].opacity < 1);
  assert.equal(byId['lib/placement/helpers.js'].changed, false);
  assert.equal(byId['root.js'].gitStatus, 'M');
  assert.equal(view.summary, 'Focus: 2 seeds · 1 hop · 3 of 5 files');
});

test('pins always show, with a touched or untouched badge, and no synthetic edge', () => {
  const graph = {
    nodes: ['a.js', 'b.js', 'lib/reply/drafter.js', 'lib/reply/tone.js'].map((id) => ({ id })),
    links: [link('a.js', 'b.js'), link('lib/reply/drafter.js', 'lib/reply/tone.js')],
  };
  const view = computeFocusView(graph, {
    seedMode: 'picked',
    seeds: ['a.js', 'b.js'],
    hops: 1,
    direction: 'both',
    pins: ['lib/reply/drafter.js'],
    changed: [{ id: 'a.js', status: 'M' }],
  });
  const drafter = view.nodes.find((n) => n.id === 'lib/reply/drafter.js');
  assert.ok(drafter);
  assert.equal(drafter.pinned, true);
  assert.equal(drafter.badge, 'untouched');
  assert.equal(drafter.changed, false);
  assert.equal(view.nodes.some((n) => n.id === 'lib/reply/tone.js'), false);
  assert.equal(view.edges.some((e) => e.source === 'lib/reply/drafter.js' || e.target === 'lib/reply/drafter.js'), false);
  assert.deepEqual(view.edges, [{ source: 'a.js', target: 'b.js' }]);

  const touched = computeFocusView(graph, {
    seedMode: 'picked',
    seeds: ['a.js', 'b.js'],
    hops: 1,
    pins: ['lib/reply/drafter.js'],
    changed: [{ id: 'lib/reply/drafter.js', status: 'M' }],
  });
  assert.equal(touched.nodes.find((n) => n.id === 'lib/reply/drafter.js').badge, 'touched');
});

test('hideTests leaves changed test files out of the default seeds', () => {
  const graph = {
    nodes: ['src/app.js', 'src/app.test.js', 'src/util.js'].map((id) => ({ id })),
    links: [link('src/app.js', 'src/util.js'), link('src/app.test.js', 'src/app.js')],
  };
  const view = computeFocusView(graph, {
    seedMode: 'changed',
    changed: [
      { id: 'src/app.js', status: 'M' },
      { id: 'src/app.test.js', status: 'A' },
    ],
    hops: 1,
    direction: 'both',
    hideTests: true,
  });
  assert.equal(view.nodes.some((n) => n.id === 'src/app.test.js'), false);
  assert.equal(view.seeds.includes('src/app.test.js'), false);
  assert.ok(view.nodes.some((n) => n.id === 'src/app.js'));
  assert.ok(view.nodes.some((n) => n.id === 'src/util.js'));

  const kept = computeFocusView(graph, {
    seedMode: 'changed',
    changed: [{ id: 'src/app.test.js', status: 'A' }],
    hops: 1,
    hideTests: true,
    pins: ['src/app.test.js'],
  });
  assert.equal(kept.nodes.find((n) => n.id === 'src/app.test.js').badge, 'touched');
});

test('hideTests drops test files from the walk unless they are pinned', () => {
  const graph = {
    nodes: [
      'src/app.js',
      'src/app.test.js',
      'src/app.spec.ts',
      'src/__tests__/extra.js',
      'test/helper.js',
      'src/util.js',
      'src/only-via-test.js',
    ].map((id) => ({ id })),
    links: [
      link('src/app.js', 'src/util.js'),
      link('src/app.js', 'src/app.test.js'),
      link('src/app.test.js', 'src/only-via-test.js'),
      link('src/app.js', 'src/app.spec.ts'),
      link('src/app.js', 'src/__tests__/extra.js'),
      link('src/app.js', 'test/helper.js'),
    ],
  };
  const hidden = computeFocusView(graph, {
    seedMode: 'picked',
    seeds: ['src/app.js', 'src/util.js'],
    hops: 2,
    direction: 'out',
    hideTests: true,
  });
  const ids = hidden.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ['src/app.js', 'src/util.js']);

  const shown = computeFocusView(graph, {
    seedMode: 'picked',
    seeds: ['src/app.js', 'src/util.js'],
    hops: 1,
    direction: 'out',
    hideTests: false,
  });
  assert.ok(shown.nodes.some((n) => n.id === 'src/app.test.js'));

  const pinned = computeFocusView(graph, {
    seedMode: 'picked',
    seeds: ['src/app.js', 'src/util.js'],
    hops: 1,
    direction: 'out',
    hideTests: true,
    pins: ['src/app.test.js'],
  });
  const testNode = pinned.nodes.find((n) => n.id === 'src/app.test.js');
  assert.equal(testNode.pinned, true);
  assert.equal(pinned.nodes.some((n) => n.id === 'src/only-via-test.js'), false);
});

test('focus query round-trips seeds, hops, direction, pins, hideTests, and base', () => {
  const state = {
    on: true,
    seedMode: 'picked',
    seeds: ['lib/classifier.js', 'lib/placement/couplePlacement.js'],
    hops: 3,
    direction: 'in',
    pins: ['lib/reply/drafter.js'],
    hideTests: false,
    base: 'feat/auth-layer',
  };
  const query = encodeFocusQuery(state);
  const back = decodeFocusQuery(`?${query}`);
  assert.equal(back.on, true);
  assert.equal(back.seedMode, 'picked');
  assert.deepEqual(back.seeds, state.seeds);
  assert.equal(back.hops, 3);
  assert.equal(back.direction, 'in');
  assert.deepEqual(back.pins, state.pins);
  assert.equal(back.hideTests, false);
  assert.equal(back.base, 'feat/auth-layer');
  assert.equal(decodeFocusQuery('').on, false);
  assert.equal(decodeFocusQuery('?focus=1').hops, defaultHops('changed'));
  assert.equal(decodeFocusQuery('?focus=1').hideTests, true);
  assert.equal(decodeFocusQuery('?focus=1').direction, 'both');
});

test('copy JSON is the state a screenshot API can post back', () => {
  const state = {
    on: true,
    seedMode: 'picked',
    seeds: ['a.js', 'b.js'],
    hops: 2,
    direction: 'out',
    pins: ['c.js'],
    hideTests: true,
    base: 'main',
    changed: [{ id: 'a.js', status: 'A' }],
  };
  const parsed = JSON.parse(focusStateJson(state));
  const again = computeFocusView(
    {
      nodes: ['a.js', 'b.js', 'c.js', 'd.js'].map((id) => ({ id })),
      links: [link('a.js', 'd.js'), link('b.js', 'd.js')],
    },
    parsed,
  );
  assert.deepEqual(again.nodes.map((n) => n.id).sort(), ['a.js', 'b.js', 'c.js', 'd.js']);
  assert.equal(again.nodes.find((n) => n.id === 'a.js').gitStatus, 'A');
  assert.equal(again.nodes.find((n) => n.id === 'c.js').badge, 'untouched');
});

test('formatShaPill uses the short compare base and head', () => {
  assert.equal(
    formatShaPill('21494897aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '773f6ecdbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    'vs 21494897 · head 773f6ecd',
  );
  assert.equal(formatShaPill('feat/auth-layer', '773f6ecd'), null);
});

test('PR #1031 shape: changed seeds, 1 hop, reply drafter pinned and unlinked', () => {
  const graph = {
    nodes: [
      { id: 'root.js' },
      { id: 'lib/classifier.js' },
      { id: 'lib/placement/couplePlacement.js' },
      { id: 'lib/placement/helpers.js' },
      { id: 'lib/reply/drafter.js' },
      { id: 'lib/reply/tone.js' },
      { id: 'lib/placement/couplePlacement.test.js' },
      { id: 'lib/far/elsewhere.js' },
    ],
    links: [
      link('root.js', 'lib/classifier.js'),
      link('root.js', 'lib/placement/couplePlacement.js'),
      link('lib/classifier.js', 'lib/placement/couplePlacement.js'),
      link('lib/placement/couplePlacement.js', 'lib/placement/helpers.js'),
      link('lib/placement/couplePlacement.test.js', 'lib/placement/couplePlacement.js'),
      link('lib/far/elsewhere.js', 'lib/placement/helpers.js'),
      link('lib/reply/drafter.js', 'lib/reply/tone.js'),
    ],
  };
  const view = computeFocusView(graph, {
    seedMode: 'changed',
    changed: [
      { id: 'lib/placement/couplePlacement.js', status: 'A' },
      { id: 'root.js', status: 'M' },
      { id: 'lib/classifier.js', status: 'M' },
    ],
    hops: 1,
    direction: 'both',
    pins: ['lib/reply/drafter.js'],
    hideTests: true,
    base: '21494897',
    baseSha: '21494897aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    head: '773f6ecdbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });
  const byId = Object.fromEntries(view.nodes.map((n) => [n.id, n]));
  assert.equal(byId['lib/placement/couplePlacement.js'].gitStatus, 'A');
  assert.equal(byId['lib/placement/couplePlacement.js'].opacity, 1);
  assert.equal(byId['lib/placement/couplePlacement.js'].label, 'placement/couplePlacement.js');
  assert.equal(byId['root.js'].gitStatus, 'M');
  assert.equal(byId['lib/classifier.js'].gitStatus, 'M');
  assert.equal(byId['lib/reply/drafter.js'].badge, 'untouched');
  assert.equal(byId['lib/reply/drafter.js'].pinned, true);
  assert.equal(byId['lib/placement/couplePlacement.test.js'], undefined);
  assert.equal(byId['lib/far/elsewhere.js'], undefined);
  assert.equal(byId['lib/reply/tone.js'], undefined);
  assert.equal(
    view.edges.some((e) => e.source === 'lib/reply/drafter.js' || e.target === 'lib/reply/drafter.js'),
    false,
  );
  assert.ok(view.edges.some((e) => e.source === 'root.js' && e.target === 'lib/placement/couplePlacement.js'));
  assert.equal(view.shaPill, 'vs 21494897 · head 773f6ecd');
  assert.equal(byId['lib/placement/helpers.js'].hop, 1);
  assert.ok(byId['lib/placement/helpers.js'].opacity < byId['lib/placement/couplePlacement.js'].opacity);
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectGitChanges, resolveRev } from './git-changes.mjs';
import { chooseCompareBase, parseGithubRemote, parsePrSpec, resolveCompareBase } from './pr-base.mjs';

function git(cwd, args) {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
}

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-base-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const a = 1;\n');
  git(dir, ['add', 'a.js']);
  git(dir, ['commit', '-m', 'main']);
  git(dir, ['checkout', '-b', 'feat/auth-layer']);
  fs.writeFileSync(path.join(dir, 'b.js'), 'export const b = 1;\n');
  git(dir, ['add', 'b.js']);
  git(dir, ['commit', '-m', 'auth']);
  git(dir, ['checkout', '-b', 'feat/invite-flow']);
  fs.writeFileSync(path.join(dir, 'c.js'), 'export const c = 1;\n');
  git(dir, ['add', 'c.js']);
  git(dir, ['commit', '-m', 'invite']);
  return dir;
}

test('parsePrSpec reads a number, hash, or pull URL', () => {
  assert.deepEqual(parsePrSpec('#482'), { number: 482 });
  assert.deepEqual(parsePrSpec('482'), { number: 482 });
  assert.deepEqual(
    parsePrSpec('https://github.com/acme/app/pull/482/files?diff=split'),
    { owner: 'acme', repo: 'app', number: 482 },
  );
  assert.equal(parsePrSpec('feat/invite-flow'), null);
  assert.equal(parsePrSpec('#0'), null);
});

test('parseGithubRemote ignores credentials and non-GitHub hosts', () => {
  assert.deepEqual(
    parseGithubRemote('https://x-access-token:ghs_secret@github.com/WiseOlMan/Code-Visualizer.git'),
    { owner: 'WiseOlMan', repo: 'Code-Visualizer' },
  );
  assert.equal(
    JSON.stringify(parseGithubRemote('https://user:ghs_secret@github.com/acme/app.git')).includes('ghs_secret'),
    false,
  );
  assert.deepEqual(parseGithubRemote('git@github.com:acme/app.git'), { owner: 'acme', repo: 'app' });
  assert.deepEqual(parseGithubRemote('ssh://git@github.com/acme/app.git'), { owner: 'acme', repo: 'app' });
  assert.equal(parseGithubRemote('https://gitlab.com/acme/app.git'), null);
});

test('chooseCompareBase prefers the PR base, then the default branch', () => {
  const has = new Set(['main', 'feat/auth-layer', 'feat/invite-flow']);
  const hasRev = (name) => has.has(name);
  const remote = { owner: 'acme', repo: 'app' };
  const record = {
    number: 482,
    baseRef: 'feat/auth-layer',
    headRef: 'feat/invite-flow',
    url: 'https://github.com/acme/app/pull/482',
    title: 'Invite',
    state: 'OPEN',
  };

  const auto = chooseCompareBase({
    remote,
    headBranch: 'feat/invite-flow',
    prRecord: record,
    defaultBranch: 'main',
    hasRev,
  });
  assert.equal(auto.source, 'head');
  assert.equal(auto.baseLabel, 'feat/auth-layer');
  assert.equal(auto.pr.number, 482);
  assert.match(auto.note, /PR #482/);
  assert.match(auto.note, /feat\/auth-layer/);

  const pasted = chooseCompareBase({
    prSpec: { number: 482 },
    remote,
    headBranch: 'feat/invite-flow',
    prRecord: record,
    defaultBranch: 'main',
    hasRev,
  });
  assert.equal(pasted.source, 'pr');
  assert.equal(pasted.baseLabel, 'feat/auth-layer');

  const missing = chooseCompareBase({
    remote,
    headBranch: 'feat/invite-flow',
    prRecord: { ...record, baseRef: 'feat/missing' },
    defaultBranch: 'main',
    hasRev,
  });
  assert.equal(missing.source, 'default');
  assert.equal(missing.baseLabel, 'main');
  assert.match(missing.note, /isn’t in this clone/);
  assert.match(missing.note, /Comparing to main/);

  const none = chooseCompareBase({
    remote,
    headBranch: 'feat/invite-flow',
    prRecord: null,
    defaultBranch: 'main',
    hasRev,
  });
  assert.equal(none.source, 'default');
  assert.match(none.note, /No open pull request for feat\/invite-flow/);

  const auth = chooseCompareBase({
    remote,
    headBranch: 'feat/invite-flow',
    lookupNote: 'GitHub auth isn’t available, so the PR base couldn’t be resolved.',
    defaultBranch: 'main',
    hasRev,
  });
  assert.equal(auth.source, 'default');
  assert.match(auth.note, /GitHub auth/);
  assert.equal(auth.pr, null);

  const onDefault = chooseCompareBase({
    remote,
    headBranch: 'main',
    prRecord: null,
    defaultBranch: 'main',
    hasRev,
  });
  assert.equal(onDefault.baseLabel, 'main');
  assert.match(onDefault.note, /No open pull request for main/);

  const explicit = chooseCompareBase({
    explicitBase: 'feat/auth-layer',
    defaultBranch: 'main',
    hasRev,
  });
  assert.equal(explicit.source, 'explicit');
  assert.equal(explicit.baseLabel, 'feat/auth-layer');
  assert.equal(explicit.note, null);
});

test('the default branch does not warn about a missing pull request', async () => {
  const dir = initRepo();
  try {
    git(dir, ['checkout', 'main']);
    const result = await resolveCompareBase(dir, {});
    assert.equal(result.baseLabel, 'main');
    assert.equal(result.source, 'default');
    assert.equal(result.note, null);
    assert.equal(result.pr, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a stacked branch diffs against the PR base, not main', () => {
  const dir = initRepo();
  try {
    const hasRev = (name) => !!resolveRev(dir, name);
    assert.equal(resolveRev(dir, 'feat/auth-layer'), 'feat/auth-layer');
    assert.equal(resolveRev(dir, 'main...HEAD'), null);
    assert.equal(resolveRev(dir, '--all'), null);

    const choice = chooseCompareBase({
      remote: { owner: 'acme', repo: 'app' },
      headBranch: 'feat/invite-flow',
      prRecord: {
        number: 482,
        baseRef: 'feat/auth-layer',
        headRef: 'feat/invite-flow',
        state: 'OPEN',
        url: 'https://github.com/acme/app/pull/482',
      },
      defaultBranch: 'main',
      hasRev,
    });
    const changes = collectGitChanges(
      [{ root: dir, name: 'app', prefix: '' }],
      { base: choice.baseLabel },
    );
    assert.equal(changes[0].base, 'feat/auth-layer');
    assert.equal(changes[0].branch, 'feat/invite-flow');
    assert.match(changes[0].head, /^[0-9a-f]{40}$/);
    assert.match(changes[0].baseSha, /^[0-9a-f]{40}$/);
    assert.notEqual(changes[0].baseSha, changes[0].head);
    assert.deepEqual(changes[0].files.map((f) => f.path), ['c.js']);

    const againstMain = collectGitChanges([{ root: dir, name: 'app', prefix: '' }], { base: 'main' });
    assert.deepEqual(againstMain[0].files.map((f) => f.path).sort(), ['b.js', 'c.js']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

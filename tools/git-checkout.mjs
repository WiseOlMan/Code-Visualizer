/**
 * Parse pasted branch / repo@branch / GitHub tree URLs and checkout locally.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isGitRepo, gitBranch, gitHead } from './git-changes.mjs';

function git(cwd, args, opts = {}) {
  try {
    let out = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: opts.timeout ?? 60_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (out.endsWith('\n')) out = out.slice(0, -1);
    if (out.endsWith('\r')) out = out.slice(0, -1);
    return out;
  } catch (err) {
    const stderr = String(err?.stderr || err?.message || '');
    const error = new Error(stderr.trim().split('\n').pop() || 'git failed');
    error.stderr = stderr;
    throw error;
  }
}

function gitOk(cwd, args) {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

export function remoteSlug(url) {
  if (!url) return null;
  const m = String(url).trim().replace(/\.git$/, '')
    .match(/(?:github\.com[:/]|@github\.com:)([\w.-]+)\/([\w.-]+)/i);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/i, '') } : null;
}

export function originSlug(cwd) {
  if (!isGitRepo(cwd)) return null;
  try {
    const url = git(cwd, ['remote', 'get-url', 'origin']);
    return remoteSlug(url);
  } catch {
    return null;
  }
}

/**
 * @returns {{ kind:'branch', branch:string }
 *   | { kind:'remote', owner:string, repo:string, branch:string|null, cloneUrl:string }
 *   | { kind:'path', path:string, branch:string|null }}
 */
export function parseCheckoutTarget(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('Paste a branch name or repo URL');

  // Local path (optional @branch / #branch / :branch suffix)
  if (s.startsWith('/') || s.startsWith('~/') || s.startsWith('./') || /^[A-Za-z]:[\\/]/.test(s)) {
    const m = s.match(/^(.*?)[@#:]([^@#:\/]+)$/);
    if (m && !m[1].includes('://')) {
      return { kind: 'path', path: m[1], branch: m[2] };
    }
    return { kind: 'path', path: s, branch: null };
  }

  // git@github.com:owner/repo(.git)[@|#|tree…]
  const ssh = s.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[@:#](.+))?$/i);
  if (ssh) {
    return {
      kind: 'remote',
      owner: ssh[1],
      repo: ssh[2],
      branch: ssh[3] ? decodeURIComponent(ssh[3]) : null,
      cloneUrl: `https://github.com/${ssh[1]}/${ssh[2]}.git`,
    };
  }

  // https://github.com/owner/repo/tree/<branch…>
  // https://github.com/owner/repo/blob/<branch>/…
  // https://github.com/owner/repo/pull/123
  // https://github.com/owner/repo
  const gh = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(.*))?$/i);
  if (gh) {
    const owner = gh[1];
    const repo = gh[2];
    const rest = (gh[3] || '').replace(/\/$/, '');
    let branch = null;
    if (rest.startsWith('tree/')) branch = decodeURIComponent(rest.slice('tree/'.length));
    else if (rest.startsWith('blob/')) {
      // blob/<branch>/<path> — branch is the first segment (common case).
      branch = decodeURIComponent(rest.slice('blob/'.length).split('/')[0] || '');
    } else if (rest.startsWith('pull/')) {
      const n = rest.split('/')[1];
      if (n && /^\d+$/.test(n)) branch = `pull/${n}/head`;
    } else if (rest.startsWith('compare/')) {
      // main...feature/foo or feature/foo
      const spec = decodeURIComponent(rest.slice('compare/'.length));
      const dots = spec.includes('...') ? spec.split('...').pop() : spec.split('..').pop();
      branch = (dots || '').replace(/^\^/, '') || null;
    } else if (rest.includes('@')) {
      branch = decodeURIComponent(rest.split('@').pop());
    }
    return {
      kind: 'remote',
      owner,
      repo,
      branch: branch || null,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }

  // owner/repo@branch | owner/repo#branch | owner/repo:branch
  // (Require an explicit separator — bare owner/repo looks like a branch path.)
  const at = s.match(/^([\w.-]+)\/([\w.-]+)[@#:](.+)$/);
  if (at) {
    return {
      kind: 'remote',
      owner: at[1],
      repo: at[2],
      branch: at[3].trim(),
      cloneUrl: `https://github.com/${at[1]}/${at[2]}.git`,
    };
  }

  // Otherwise treat the whole string as a branch / ref name (may include slashes).
  if (/[\s]/.test(s) || s.includes('://')) {
    throw new Error('Unrecognized paste — use a branch name, owner/repo@branch, or GitHub tree URL');
  }
  return { kind: 'branch', branch: s };
}

export function findLocalRepo(owner, repo, searchRoots = []) {
  const want = `${owner}/${repo}`.toLowerCase();
  const wantRepo = repo.toLowerCase();
  const seen = new Set();

  for (const root of searchRoots) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;

    const slug = originSlug(root);
    if (slug && `${slug.owner}/${slug.repo}`.toLowerCase() === want) return root;

    // Folder named like the repo (common for sibling checkouts).
    const base = path.basename(root).toLowerCase();
    if (base === wantRepo || base === `${owner}-${repo}`.toLowerCase()) {
      if (isGitRepo(root)) return root;
    }

    // Scan one level of children (e.g. ~/Documents/GitHub/*).
    try {
      for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
        const child = path.join(root, ent.name);
        if (seen.has(child)) continue;
        const childSlug = originSlug(child);
        if (childSlug && `${childSlug.owner}/${childSlug.repo}`.toLowerCase() === want) return child;
        if (ent.name.toLowerCase() === wantRepo && isGitRepo(child)) return child;
      }
    } catch { /* ignore */ }
  }
  return null;
}

function refExists(cwd, ref) {
  return gitOk(cwd, ['rev-parse', '--verify', '--quiet', ref]);
}

/**
 * Checkout/switch a branch in a single git repo. Fetches when needed.
 * Dirty trees are auto-stashed (incl. untracked) before switching.
 * @returns {{ root:string, branch:string, head:string, fetched:boolean, stashed:boolean }}
 */
export function checkoutBranch(cwd, branch) {
  if (!cwd || !isGitRepo(cwd)) throw new Error(`Not a git repo: ${cwd}`);
  if (!branch) throw new Error('Missing branch');

  let stashed = false;
  const dirty = git(cwd, ['status', '--porcelain']);
  if (dirty && dirty.trim()) {
    const msg = `code-explorer: auto-stash before switch to ${branch}`;
    git(cwd, ['stash', 'push', '-u', '-m', msg]);
    stashed = true;
  }

  let fetched = false;
  const local = refExists(cwd, `refs/heads/${branch}`) || refExists(cwd, branch);
  const remote = refExists(cwd, `refs/remotes/origin/${branch}`);

  // PR refs and other oddities: fetch explicitly.
  if (branch.startsWith('pull/') && branch.endsWith('/head')) {
    const n = branch.split('/')[1];
    git(cwd, ['fetch', 'origin', `pull/${n}/head:refs/remotes/origin/pr/${n}`], { timeout: 120_000 });
    fetched = true;
    git(cwd, ['switch', '--detach', `origin/pr/${n}`]);
    return { root: cwd, branch, head: gitHead(cwd), fetched, stashed };
  }

  if (!local && !remote) {
    try {
      git(cwd, ['fetch', 'origin', branch], { timeout: 120_000 });
      fetched = true;
    } catch {
      try {
        git(cwd, ['fetch', 'origin'], { timeout: 120_000 });
        fetched = true;
      } catch (err) {
        throw new Error(`Could not fetch '${branch}': ${err.message}`);
      }
    }
  } else if (!local && remote) {
    // Have origin/branch — still refresh lightly.
    try {
      git(cwd, ['fetch', 'origin', branch], { timeout: 90_000 });
      fetched = true;
    } catch { /* offline ok if remote ref exists */ }
  }

  if (refExists(cwd, `refs/heads/${branch}`) || (local && refExists(cwd, branch))) {
    git(cwd, ['switch', branch]);
  } else if (refExists(cwd, `refs/remotes/origin/${branch}`)) {
    git(cwd, ['switch', '-C', branch, '--track', `origin/${branch}`]);
  } else {
    throw new Error(`Branch not found: ${branch}`);
  }

  return {
    root: cwd,
    branch: gitBranch(cwd) || branch,
    head: gitHead(cwd),
    fetched,
    stashed,
  };
}

/**
 * Checkout branch across workspace packages (monorepo shells). Succeeds if at
 * least one package switches; others that lack the branch are reported as skipped.
 */
export function checkoutWorkspace(packages, branch) {
  const list = (packages || []).filter((p) => p?.root && isGitRepo(p.root));
  if (!list.length) throw new Error('No git packages in this workspace');

  const switched = [];
  const skipped = [];
  for (const pkg of list) {
    try {
      switched.push({
        name: pkg.name || path.basename(pkg.root),
        ...checkoutBranch(pkg.root, branch),
      });
    } catch (err) {
      skipped.push({
        name: pkg.name || path.basename(pkg.root),
        root: pkg.root,
        error: err.message || String(err),
      });
    }
  }
  if (!switched.length) {
    const detail = skipped.map((s) => `${s.name}: ${s.error}`).join('; ');
    throw new Error(detail || `Could not switch any package to ${branch}`);
  }
  return { branch, switched, skipped };
}

export function expandHome(p) {
  return path.resolve(String(p || '').replace(/^~(?=$|\/)/, os.homedir()));
}

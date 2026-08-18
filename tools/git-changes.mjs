/**
 * Git helpers for branch-diff overlays and analyze freshness.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function git(cwd, args) {
  try {
    // Do NOT trim leading whitespace — `git status --porcelain` uses a leading
    // space for unstaged status; trimming the whole buffer corrupts the first path
    // (" cypress/..." → "M cypress/..." → slice(3) → "ypress/...").
    let out = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (out.endsWith('\n')) out = out.slice(0, -1);
    if (out.endsWith('\r')) out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

export function isGitRepo(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return false;
  return git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

export function gitHead(cwd) {
  return git(cwd, ['rev-parse', 'HEAD']);
}

export function gitBranch(cwd) {
  const name = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return name && name !== 'HEAD' ? name : null;
}

function revExists(cwd, rev) {
  return !!git(cwd, ['rev-parse', '--verify', rev]);
}

/** Prefer main → master → develop → upstream default. */
export function resolveBaseBranch(cwd) {
  for (const cand of ['main', 'master', 'develop', 'origin/main', 'origin/master', 'origin/develop']) {
    if (revExists(cwd, cand)) {
      return cand.replace(/^origin\//, '');
    }
  }
  const upstream = git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (upstream) {
    // origin/main → try merge-base with upstream tip's remote branch sibling… use origin/HEAD
    const remoteHead = git(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
    if (remoteHead) {
      const m = remoteHead.match(/refs\/remotes\/origin\/(.+)$/);
      if (m) return m[1];
    }
  }
  return null;
}

function toGraphId(prefix, relPath) {
  const rel = String(relPath || '').split(path.sep).join('/');
  if (!rel) return null;
  const pfx = (prefix || '').split(path.sep).join('/');
  return pfx ? `${pfx}/${rel}` : rel;
}

function parseNameStatus(text) {
  const files = [];
  if (!text) return files;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    // e.g. "M\tpath" or "R100\told\tnew"
    const parts = line.split('\t');
    const status = (parts[0] || '?').replace(/\d+$/, '').slice(0, 1) || '?';
    const filePath = parts.length >= 3 ? parts[parts.length - 1] : parts[1];
    if (!filePath) continue;
    files.push({ path: filePath.split(path.sep).join('/'), status });
  }
  return files;
}

function diffAgainstBase(cwd, base) {
  if (!base) return [];
  // Three-dot: changes on this branch since merge-base with base.
  const ranged = git(cwd, ['diff', '--name-status', `${base}...HEAD`]);
  if (ranged != null) return parseNameStatus(ranged);
  const two = git(cwd, ['diff', '--name-status', base, 'HEAD']);
  return parseNameStatus(two || '');
}

function uncommitted(cwd) {
  const text = git(cwd, ['status', '--porcelain', '-uall']);
  if (!text) return [];
  const files = [];
  for (const line of text.split('\n')) {
    if (line.length < 4) continue;
    // Porcelain: two status chars, then a space, then the path.
    const status = (line[0] !== ' ' ? line[0] : line[1]) || 'M';
    let filePath = line[2] === ' ' ? line.slice(3) : line.slice(2).trimStart();
    // renames: "R  old -> new"
    if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop();
    if (filePath.startsWith('"') && filePath.endsWith('"')) filePath = filePath.slice(1, -1);
    filePath = filePath.trim();
    if (!filePath) continue;
    files.push({ path: filePath.split(path.sep).join('/'), status, uncommitted: true });
  }
  return files;
}

/**
 * @param {Array<{name?:string, prefix?:string, root:string}>} packages
 * @param {{ base?: string }} [opts]
 */
export function collectGitChanges(packages, opts = {}) {
  const out = [];
  for (const pkg of packages || []) {
    if (!pkg?.root || !isGitRepo(pkg.root)) continue;
    const branch = gitBranch(pkg.root);
    const head = gitHead(pkg.root);
    const base = opts.base || resolveBaseBranch(pkg.root);
    const committed = base && branch && base !== branch ? diffAgainstBase(pkg.root, base) : [];
    // Always include uncommitted so WIP shows even on main
    const dirty = uncommitted(pkg.root);
    const byPath = new Map();
    for (const f of [...committed, ...dirty]) {
      const graphId = toGraphId(pkg.prefix, f.path);
      if (!graphId) continue;
      const prev = byPath.get(graphId);
      byPath.set(graphId, {
        path: f.path,
        graphId,
        status: f.status,
        uncommitted: !!(prev?.uncommitted || f.uncommitted),
        package: pkg.name || path.basename(pkg.root),
        prefix: pkg.prefix || '',
      });
    }
    out.push({
      name: pkg.name || path.basename(pkg.root),
      prefix: pkg.prefix || '',
      root: pkg.root,
      branch,
      head,
      base,
      files: [...byPath.values()],
    });
  }
  return out;
}

/** Record HEAD per package root at analyze time. */
export function collectPackageHeads(packages) {
  const heads = {};
  for (const pkg of packages || []) {
    if (!pkg?.root) continue;
    const head = gitHead(pkg.root);
    if (head) heads[pkg.root] = head;
  }
  return heads;
}

/**
 * Compare saved packageHeads to current HEADs.
 * @returns {{ stale: boolean, packages: Array<{name, root, branch, analyzedHead, currentHead}> }}
 */
export function checkFreshness(packages, packageHeads = {}) {
  const stalePackages = [];
  for (const pkg of packages || []) {
    if (!pkg?.root || !isGitRepo(pkg.root)) continue;
    const currentHead = gitHead(pkg.root);
    if (!currentHead) continue;
    const analyzedHead = packageHeads[pkg.root] || null;
    // Legacy snapshots without recorded HEADs: don't flag HEAD-stale (missing
    // graph files still trigger refresh via the API layer).
    if (!analyzedHead) continue;
    if (analyzedHead !== currentHead) {
      stalePackages.push({
        name: pkg.name || path.basename(pkg.root),
        root: pkg.root,
        branch: gitBranch(pkg.root),
        analyzedHead,
        currentHead,
      });
    }
  }
  return { stale: stalePackages.length > 0, packages: stalePackages };
}

function parseUnifiedDiff(text) {
  const lines = [];
  if (!text) return lines;
  for (const raw of text.split('\n')) {
    if (
      raw.startsWith('diff ') ||
      raw.startsWith('index ') ||
      raw.startsWith('---') ||
      raw.startsWith('+++') ||
      raw.startsWith('@@') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file') ||
      raw.startsWith('similarity ') ||
      raw.startsWith('rename ') ||
      raw.startsWith('\\')
    ) continue;
    if (raw.startsWith('+')) lines.push({ type: 'add', text: raw.slice(1) });
    else if (raw.startsWith('-')) lines.push({ type: 'del', text: raw.slice(1) });
    else lines.push({ type: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw });
  }
  // Drop trailing empty ctx from split on final newline
  while (lines.length && lines[lines.length - 1].type === 'ctx' && lines[lines.length - 1].text === '') {
    lines.pop();
  }
  return lines;
}

function fileTracked(cwd, relPath) {
  const out = git(cwd, ['ls-files', '--', relPath]);
  return !!(out && out.split('\n').some((l) => l === relPath));
}

/**
 * Line-level diff for a repo-relative path vs the merge base (incl. WIP).
 * New untracked files → all additions. Deleted → all deletions from base tip.
 * @returns {{ base: string|null, status: string, lines: Array<{type:'ctx'|'add'|'del', text:string}> } | null}
 */
export function fileDiff(cwd, relPath, opts = {}) {
  if (!cwd || !relPath || !isGitRepo(cwd)) return null;
  const base = opts.base || resolveBaseBranch(cwd);
  const abs = path.join(cwd, relPath);
  const exists = fs.existsSync(abs) && fs.statSync(abs).isFile();
  const tracked = fileTracked(cwd, relPath);

  if (!exists && !tracked) return null;

  // Untracked / brand-new on disk → whole file is an addition.
  if (exists && !tracked) {
    const text = fs.readFileSync(abs, 'utf8');
    const lines = text.split('\n').map((text) => ({ type: 'add', text }));
    if (lines.length && lines[lines.length - 1].text === '') lines.pop();
    return { base, status: 'A', lines };
  }

  // Prefer full change vs base (branch commits + working tree). Fall back to HEAD.
  let diffText = null;
  if (base) {
    diffText = git(cwd, ['diff', '-U9999', '--no-color', `${base}`, '--', relPath]);
  }
  if (diffText == null || diffText === '') {
    const againstHead = git(cwd, ['diff', '-U9999', '--no-color', 'HEAD', '--', relPath]);
    if (againstHead) diffText = againstHead;
  }

  // Deleted from tree but still known to git
  if (!exists && tracked) {
    const tip = base || 'HEAD';
    const old = git(cwd, ['show', `${tip}:${relPath}`]);
    if (old == null) return { base, status: 'D', lines: [] };
    const lines = old.split('\n').map((text) => ({ type: 'del', text }));
    if (lines.length && lines[lines.length - 1].text === '') lines.pop();
    return { base, status: 'D', lines };
  }

  const lines = parseUnifiedDiff(diffText || '');
  if (!lines.length) {
    // No textual diff (binary / unchanged vs base) — still return empty for UI.
    return { base, status: 'M', lines: [] };
  }
  const hasAdd = lines.some((l) => l.type === 'add');
  const hasDel = lines.some((l) => l.type === 'del');
  const hasCtx = lines.some((l) => l.type === 'ctx');
  // Pure add/del only when the other side (and context) is absent — else it's an edit.
  const status = hasAdd && !hasDel && !hasCtx ? 'A' : hasDel && !hasAdd && !hasCtx ? 'D' : 'M';
  return { base, status, lines };
}

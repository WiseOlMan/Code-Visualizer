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
  return !!git(cwd, ['rev-parse', '--verify', '--end-of-options', rev]);
}

const SAFE_REV = /^(?:[\w.-]+)(?:\/[\w.-]+)*$/;

/** Branch or commit-ish safe to pass as a git argv (no ranges, flags, or rev syntax). */
export function isSafeRev(name) {
  return typeof name === 'string' && SAFE_REV.test(name) && !name.includes('..') && !name.startsWith('-');
}

/**
 * A rev git can actually resolve. Prefers the local branch, then origin/<name>,
 * so a PR base that was fetched but not checked out still diffs.
 */
export function resolveRev(cwd, name) {
  if (!isSafeRev(name)) return null;
  if (revExists(cwd, name)) return name;
  if (!name.startsWith('origin/')) {
    const remote = `origin/${name}`;
    if (isSafeRev(remote) && revExists(cwd, remote)) return remote;
  }
  return null;
}

function shortBase(name) {
  if (!name) return null;
  return name.startsWith('origin/') ? name.slice('origin/'.length) : name;
}

export function gitRemoteUrl(cwd, remote = 'origin') {
  if (!isSafeRev(remote)) return null;
  return git(cwd, ['remote', 'get-url', remote]);
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
    const oldPath = parts.length >= 3 ? parts[1] : null;
    const filePath = parts.length >= 3 ? parts[parts.length - 1] : parts[1];
    if (!filePath) continue;
    files.push({
      path: filePath.split(path.sep).join('/'),
      oldPath: oldPath ? oldPath.split(path.sep).join('/') : null,
      status,
    });
  }
  return files;
}

/** `dir/{old => new}/file.js` and `old => new` both yield the destination path. */
function numstatPath(raw) {
  const brace = String(raw || '').match(/^(.*)\{([^}]*) => ([^}]*)\}(.*)$/);
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/{2,}/g, '/');
  const arrow = String(raw || '').lastIndexOf(' => ');
  if (arrow >= 0) return raw.slice(arrow + 4).trim();
  return String(raw || '');
}

function parseNumstat(text) {
  const map = new Map();
  if (!text) return map;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const additions = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
    const deletions = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
    const filePath = numstatPath(parts.slice(2).join('\t')).split(path.sep).join('/');
    const prev = map.get(filePath) || { additions: 0, deletions: 0 };
    map.set(filePath, {
      additions: prev.additions + additions,
      deletions: prev.deletions + deletions,
    });
  }
  return map;
}

function diffNumstat(cwd, base) {
  const rev = resolveRev(cwd, base);
  if (!rev) return new Map();
  const ranged = git(cwd, ['diff', '--numstat', '--no-renames', `${rev}...HEAD`]);
  if (ranged != null) return parseNumstat(ranged);
  return parseNumstat(git(cwd, ['diff', '--numstat', '--no-renames', rev, 'HEAD']) || '');
}

function countLines(abs) {
  try {
    const text = fs.readFileSync(abs, 'utf8');
    if (!text) return 0;
    return text.split('\n').length;
  } catch {
    return 0;
  }
}

function readFile(abs) {
  try { return fs.readFileSync(abs, 'utf8'); } catch { return ''; }
}

const SKIP_FN = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'constructor']);

function functionSpans(src) {
  const text = String(src || '');
  const re = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(\w+))\s*\([^)]*\)\s*\{/g;
  const hits = [];
  let match;
  while ((match = re.exec(text))) {
    const name = match[1] || match[2];
    if (!name || SKIP_FN.has(name)) continue;
    hits.push({ name, at: match.index });
  }
  const out = new Map();
  hits.forEach((hit, index) => {
    const end = hits[index + 1] ? hits[index + 1].at : text.length;
    const body = text.slice(hit.at, end).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();
    if (!out.has(hit.name)) out.set(hit.name, body);
  });
  return out;
}

function leadingComment(src) {
  const block = String(src || '').match(/\/\*\*([\s\S]*?)\*\//);
  const line = String(src || '').match(/(?:^|\n)\s*\/\/\s*([^\n]+)/);
  const raw = block ? block[1] : (line ? line[1] : '');
  return raw.replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ').trim();
}

function clip(text, max = 110) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** One line: adds / edits / removes, then the leading comment when it fits. A move is an add plus a remove. */
function changeSummary(headSrc, baseSrc) {
  const head = functionSpans(headSrc);
  const base = functionSpans(baseSrc);
  const added = [];
  const edited = [];
  const removed = [];
  for (const [name, body] of head) {
    if (!base.has(name)) added.push(name);
    else if (base.get(name) !== body) edited.push(name);
  }
  for (const name of base.keys()) {
    if (!head.has(name)) removed.push(name);
  }
  const bits = [];
  if (added.length) bits.push(`adds ${added.slice(0, 3).join(', ')}`);
  if (edited.length) bits.push(`edits ${edited.slice(0, 3).join(', ')}`);
  if (removed.length) bits.push(`removes ${removed.slice(0, 2).join(', ')}`);
  const comment = leadingComment(headSrc) || leadingComment(baseSrc);
  const actions = bits.join(' · ');
  let text = actions;
  if (comment && actions && actions.length + comment.length + 3 <= 110) text = `${actions} · ${comment}`;
  else if (!actions) text = comment;
  return clip(text);
}

function diffAgainstBase(cwd, base) {
  const rev = resolveRev(cwd, base);
  if (!rev) return [];
  // Three-dot: changes on this branch since merge-base with base.
  const ranged = git(cwd, ['diff', '--name-status', '--no-renames', `${rev}...HEAD`]);
  if (ranged != null) return parseNameStatus(ranged);
  const two = git(cwd, ['diff', '--name-status', '--no-renames', rev, 'HEAD']);
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
    // renames: record the old path too, then split into a delete and an add below
    let oldPath = null;
    if (filePath.includes(' -> ')) {
      const bits = filePath.split(' -> ');
      oldPath = bits[0];
      filePath = bits.pop();
    }
    if (filePath.startsWith('"') && filePath.endsWith('"')) filePath = filePath.slice(1, -1);
    filePath = filePath.trim();
    if (!filePath) continue;
    files.push({
      path: filePath.split(path.sep).join('/'),
      oldPath: oldPath ? oldPath.split(path.sep).join('/') : null,
      status,
      uncommitted: true,
    });
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
    const requested = opts.base || resolveBaseBranch(pkg.root);
    const rev = resolveRev(pkg.root, requested);
    // Show the branch name (`feat/auth-layer`), even when the rev used is origin/…
    const base = shortBase(rev || requested);
    const baseSha = rev ? git(pkg.root, ['rev-parse', '--verify', '--end-of-options', rev]) : null;
    const committed = rev && branch && base !== branch ? diffAgainstBase(pkg.root, requested) : [];
    // Always include uncommitted so WIP shows even on main
    const dirty = uncommitted(pkg.root);
    const byPath = new Map();
    const flat = [];
    for (const f of [...committed, ...dirty]) {
      if ((f.status === 'R' || f.status === 'C') && f.oldPath && f.oldPath !== f.path) {
        flat.push({ ...f, path: f.oldPath, oldPath: null, status: 'D' });
        flat.push({ ...f, oldPath: null, status: 'A' });
      } else {
        flat.push(f);
      }
    }
    for (const f of flat) {
      const graphId = toGraphId(pkg.prefix, f.path);
      if (!graphId) continue;
      const prev = byPath.get(graphId);
      byPath.set(graphId, {
        path: f.path,
        oldPath: f.oldPath || prev?.oldPath || null,
        graphId,
        status: f.status,
        uncommitted: !!(prev?.uncommitted || f.uncommitted),
        package: pkg.name || path.basename(pkg.root),
        prefix: pkg.prefix || '',
      });
    }
    const committedStat = diffNumstat(pkg.root, requested);
    const dirtyStat = parseNumstat(git(pkg.root, ['diff', '--numstat', '--no-renames', 'HEAD']) || '');
    for (const file of byPath.values()) {
      const committed = committedStat.get(file.path) || { additions: 0, deletions: 0 };
      const dirty = dirtyStat.get(file.path) || { additions: 0, deletions: 0 };
      let additions = committed.additions + dirty.additions;
      let deletions = committed.deletions + dirty.deletions;
      const abs = path.join(pkg.root, file.path);
      let headSrc = readFile(abs);
      const deleted = file.status === 'D';
      const added = file.status === 'A' || file.status === '?';
      const baseSrc = rev && !added ? (git(pkg.root, ['show', `${rev}:${file.path}`]) || '') : '';
      if (deleted) headSrc = '';
      const lines = (deleted ? baseSrc : headSrc) ? (deleted ? baseSrc : headSrc).split('\n').length : 0;
      if (!additions && !deletions && added) additions = lines;
      if (!deletions && deleted) deletions = lines;
      file.additions = additions;
      file.deletions = deletions;
      file.lines = lines;
      const code = /\.(jsx?|tsx?|mjs|cjs)$/.test(file.path);
      file.summary = code ? changeSummary(headSrc, added ? '' : baseSrc) : '';
    }
    out.push({
      name: pkg.name || path.basename(pkg.root),
      prefix: pkg.prefix || '',
      root: pkg.root,
      branch,
      head,
      base,
      baseSha,
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
  const requested = opts.base || resolveBaseBranch(cwd);
  const rev = resolveRev(cwd, requested) || resolveRev(cwd, resolveBaseBranch(cwd));
  const base = shortBase(rev);
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
  if (rev) {
    diffText = git(cwd, ['diff', '-U9999', '--no-color', rev, '--', relPath]);
  }
  if (diffText == null || diffText === '') {
    const againstHead = git(cwd, ['diff', '-U9999', '--no-color', 'HEAD', '--', relPath]);
    if (againstHead) diffText = againstHead;
  }

  // Deleted from tree but still known to git
  if (!exists && tracked) {
    const tip = rev || 'HEAD';
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

#!/usr/bin/env node
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractGraph, extractGraphStream } from '../tools/extract-graph.mjs';
import { prepareWorkspace } from '../tools/workspace.mjs';
import {
  checkFreshness,
  collectGitChanges,
  collectPackageHeads,
  fileDiff,
  resolveBaseBranch,
} from '../tools/git-changes.mjs';
import {
  checkoutBranch,
  checkoutWorkspace,
  expandHome,
  findLocalRepo,
  parseCheckoutTarget,
} from '../tools/git-checkout.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.CODE_EXPLORER_DATA
  ? path.resolve(process.env.CODE_EXPLORER_DATA)
  : path.join(ROOT, 'data');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');
const PORT = Number(process.env.PORT || 8787);
const SERVE_UI = process.env.CODE_EXPLORER_SERVE_UI === '1';
const BOOTSTRAP_REPO = process.env.CODE_EXPLORER_REPO
  ? path.resolve(process.env.CODE_EXPLORER_REPO)
  : null;

const RECENT_PATH = path.join(DATA_DIR, 'recent.json');
const SESSION_PATH = path.join(DATA_DIR, 'session.json');
const HIDDEN_DIR = /^\./;

const state = {
  root: null,
  repo: null,
  packages: [],
};

/** root path → { root, repo, packages } so multi-tab UIs can fetch source for any open workspace */
const workspaces = new Map();

function workspaceKey(root) {
  return crypto.createHash('sha1').update(String(root)).digest('hex').slice(0, 16);
}

function workspaceDir(root) {
  return path.join(WORKSPACES_DIR, workspaceKey(root));
}

function setWorkspaceState(eventOrResult) {
  if (!eventOrResult) return;
  if (eventOrResult.root) state.root = eventOrResult.root;
  if (eventOrResult.repo) state.repo = eventOrResult.repo;
  if (Array.isArray(eventOrResult.packages)) state.packages = eventOrResult.packages;
  if (state.root) {
    workspaces.set(state.root, {
      root: state.root,
      repo: state.repo,
      packages: state.packages || [],
    });
  }
}

/** Persist a finished analysis under data/workspaces/<hash>/ so tabs survive refresh. */
function persistWorkspaceSnapshot(eventOrResult) {
  if (!eventOrResult?.root || !eventOrResult.graph) return;
  const dir = workspaceDir(eventOrResult.root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(eventOrResult.graph, null, 2));
  fs.writeFileSync(
    path.join(dir, 'endpoints.json'),
    JSON.stringify(eventOrResult.endpoints || { endpoints: [], calls: [] }, null, 2),
  );
  const packages = eventOrResult.packages || [];
  const packageHeads = eventOrResult.packageHeads || collectPackageHeads(packages);
  let sourceFingerprint = {};
  try {
    const files = collectGitChanges(packages).flatMap((p) => p.files);
    sourceFingerprint = fingerprintSourceFiles(packages, files);
  } catch { /* ignore */ }
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({
      repo: eventOrResult.repo || path.basename(eventOrResult.root),
      root: eventOrResult.root,
      packages,
      missing: eventOrResult.missing || [],
      analyzedAt: new Date().toISOString(),
      packageHeads,
      sourceFingerprint,
    }, null, 2),
  );
  setWorkspaceState(eventOrResult);
}

function packagesForRoot(root) {
  const snap = root ? loadWorkspaceSnapshot(root) : null;
  if (snap?.packages?.length) return { packages: snap.packages, meta: snap, graph: snap.graph };
  if (state.root === root && state.packages?.length) {
    return {
      packages: state.packages,
      meta: { root: state.root, packages: state.packages, packageHeads: {} },
      graph: readJson('graph.json'),
    };
  }
  if (root && fs.existsSync(root)) {
    const workspace = prepareWorkspace(root);
    return { packages: workspace.packages, meta: { root, packages: workspace.packages, packageHeads: {} }, graph: null };
  }
  return { packages: [], meta: null, graph: null };
}

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

function resolveChangedAbs(packages, f) {
  const pkg = packages.find((p) => (p.prefix || '') === (f.prefix || ''))
    || packages.find((p) => p.prefix && f.graphId.startsWith(`${p.prefix}/`))
    || packages.find((p) => !p.prefix);
  if (!pkg?.root) return null;
  return path.join(pkg.root, f.path);
}

/** Snapshot of branch/WIP JS/TS files at analyze time — used to detect real edits. */
function fingerprintSourceFiles(packages, files) {
  const fp = {};
  for (const f of files || []) {
    if (!f.graphId) continue;
    if (!CODE_EXT.has(path.extname(f.path || f.graphId))) continue;
    if (f.status === 'D') {
      fp[f.graphId] = 'D';
      continue;
    }
    const abs = resolveChangedAbs(packages, f);
    if (!abs || !fs.existsSync(abs)) continue;
    try {
      const st = fs.statSync(abs);
      fp[f.graphId] = `${Math.round(st.mtimeMs)}:${st.size}:${f.status || 'M'}`;
    } catch { /* ignore */ }
  }
  return fp;
}

/**
 * Files whose fingerprint moved since the last analyze.
 * Legacy snapshots without sourceFingerprint never flag "sources" (avoids mtime loops).
 */
function sourcesChangedSinceAnalyze(packages, files, savedFp) {
  if (!savedFp || typeof savedFp !== 'object') return [];
  const current = fingerprintSourceFiles(packages, files);
  const changed = [];
  for (const [id, cur] of Object.entries(current)) {
    if (savedFp[id] !== cur) changed.push(id);
  }
  // New code files in the change set that weren't fingerprinted at analyze.
  for (const f of files || []) {
    if (!f.graphId || f.status === 'D') continue;
    if (!CODE_EXT.has(path.extname(f.path || ''))) continue;
    if (savedFp[f.graphId] == null && current[f.graphId] && !changed.includes(f.graphId)) {
      changed.push(f.graphId);
    }
  }
  return changed;
}

function buildGitChangesResponse(root, baseHint) {
  const { packages, meta, graph } = packagesForRoot(root);
  if (!packages.length) {
    return { ok: false, error: 'No packages for workspace', files: [], packages: [], stale: false };
  }
  const pkgChanges = collectGitChanges(packages, { base: baseHint || undefined });
  const files = pkgChanges.flatMap((p) => p.files);
  const nodeIds = new Set((graph?.nodes || []).map((n) => n.id));
  // Only JS/TS can appear in the graph — ignore docs/assets in the "missing" nag.
  const missingFromGraph = files.filter((f) => {
    if (f.status === 'D' || !nodeIds.size || nodeIds.has(f.graphId)) return false;
    if (!CODE_EXT.has(path.extname(f.path))) return false;
    // Ignore bogus paths that aren't on disk (parse glitches, mid-flight deletes).
    const abs = resolveChangedAbs(packages, f);
    if (abs && !fs.existsSync(abs)) return false;
    return true;
  });
  const freshness = checkFreshness(packages, meta?.packageHeads || {});
  const sourcesNewer = sourcesChangedSinceAnalyze(packages, files, meta?.sourceFingerprint);
  // Stale when HEADs moved, new source files aren't in the graph, or fingerprinted
  // sources actually changed after the snapshot (not mere clock/mtime noise).
  const stale = freshness.stale || missingFromGraph.length > 0 || sourcesNewer.length > 0;
  return {
    ok: true,
    root,
    packages: pkgChanges.map((p) => ({
      name: p.name,
      prefix: p.prefix,
      root: p.root,
      branch: p.branch,
      base: p.base,
      head: p.head,
      fileCount: p.files.length,
    })),
    files,
    missingFromGraph: missingFromGraph.map((f) => f.graphId),
    sourcesNewer,
    stale,
    staleReason: freshness.stale
      ? 'head'
      : missingFromGraph.length
        ? 'missing'
        : sourcesNewer.length
          ? 'sources'
          : null,
    stalePackages: freshness.packages,
    analyzedAt: meta?.analyzedAt || null,
  };
}

function loadWorkspaceSnapshot(root) {
  if (!root) return null;
  const dir = workspaceDir(root);
  const metaPath = path.join(dir, 'meta.json');
  const graphPath = path.join(dir, 'graph.json');
  if (!fs.existsSync(graphPath)) return null;
  try {
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    const endpoints = fs.existsSync(path.join(dir, 'endpoints.json'))
      ? JSON.parse(fs.readFileSync(path.join(dir, 'endpoints.json'), 'utf8'))
      : { endpoints: [], calls: [] };
    const meta = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      : { root, repo: graph.repo || path.basename(root), packages: [] };
    setWorkspaceState({
      root: meta.root || root,
      repo: meta.repo || graph.repo,
      packages: meta.packages || [],
    });
    return {
      root: meta.root || root,
      repo: meta.repo || graph.repo || path.basename(root),
      packages: meta.packages || [],
      packageHeads: meta.packageHeads || {},
      analyzedAt: meta.analyzedAt || null,
      sourceFingerprint: meta.sourceFingerprint || null,
      graph,
      endpoints,
    };
  } catch {
    return null;
  }
}

function listWorkspaceSnapshots() {
  if (!fs.existsSync(WORKSPACES_DIR)) return [];
  let entries = [];
  try { entries = fs.readdirSync(WORKSPACES_DIR, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const metaPath = path.join(WORKSPACES_DIR, ent.name, 'meta.json');
    const graphPath = path.join(WORKSPACES_DIR, ent.name, 'graph.json');
    if (!fs.existsSync(metaPath) || !fs.existsSync(graphPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (!meta.root) continue;
      setWorkspaceState({
        root: meta.root,
        repo: meta.repo,
        packages: meta.packages || [],
      });
      out.push({
        root: meta.root,
        repo: meta.repo || path.basename(meta.root),
        analyzedAt: meta.analyzedAt || null,
      });
    } catch { /* ignore */ }
  }
  return out.sort((a, b) => String(b.analyzedAt || '').localeCompare(String(a.analyzedAt || '')));
}

function loadAllWorkspaceSnapshots() {
  listWorkspaceSnapshots();
}

function readSessionFile() {
  try {
    if (!fs.existsSync(SESSION_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    if (!data || !Array.isArray(data.tabs)) return null;
    return {
      activeRoot: data.activeRoot || null,
      sidebarOpen: data.sidebarOpen !== false,
      tabs: data.tabs.filter((t) => t && t.root),
    };
  } catch {
    return null;
  }
}

function writeSessionFile(session) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify({
    v: 1,
    activeRoot: session.activeRoot || null,
    sidebarOpen: session.sidebarOpen !== false,
    tabs: (session.tabs || []).filter((t) => t && t.root).map((t) => ({
      id: t.id || null,
      title: t.title || path.basename(t.root),
      root: t.root,
    })),
  }, null, 2));
}

function workspacePackages(rootHint) {
  const ws = rootHint && workspaces.get(rootHint);
  if (ws?.packages?.length) return ws.packages;
  if (state.packages?.length) return state.packages;
  const root = (ws && ws.root) || state.root;
  return root ? [{ prefix: '', root }] : [];
}

function resolveSourceHit(rel, rootHint) {
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) return null;
  const packages = [...workspacePackages(rootHint)]
    .sort((a, b) => (b.prefix || '').length - (a.prefix || '').length);

  let missing = null;
  for (const pkg of packages) {
    const prefix = (pkg.prefix || '').split(path.sep).join('/');
    let rest = rel;
    if (prefix) {
      if (rel !== prefix && !rel.startsWith(prefix + '/')) continue;
      rest = rel === prefix ? '' : rel.slice(prefix.length + 1);
    }
    if (!rest) continue;
    const abs = path.resolve(pkg.root, rest);
    const rootAbs = path.resolve(pkg.root);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) continue;
    const hit = {
      abs,
      pkgRoot: pkg.root,
      repoRel: rest.split(path.sep).join('/'),
      onDisk: fs.existsSync(abs) && fs.statSync(abs).isFile(),
    };
    if (hit.onDisk) return hit;
    // Prefer longest prefix match for deleted files (diff via git blob).
    if (!missing) missing = hit;
  }
  return missing;
}

function resolveSourcePath(rel, rootHint) {
  const hit = resolveSourceHit(rel, rootHint);
  return hit?.onDisk ? hit.abs : null;
}

function readRecent() {
  try {
    if (!fs.existsSync(RECENT_PATH)) return [];
    const list = JSON.parse(fs.readFileSync(RECENT_PATH, 'utf8'));
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string' && fs.existsSync(p)) : [];
  } catch {
    return [];
  }
}

function rememberRecent(repoPath) {
  const next = [repoPath, ...readRecent().filter((p) => p !== repoPath)].slice(0, 12);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RECENT_PATH, JSON.stringify(next, null, 2));
  return next;
}

function browseDir(rawPath) {
  const home = os.homedir();
  const requested = rawPath
    ? path.resolve(String(rawPath).replace(/^~(?=$|\/|\\)/, home))
    : home;

  if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) {
    throw new Error(`Not a directory: ${requested}`);
  }

  let entries = [];
  try {
    entries = fs.readdirSync(requested, { withFileTypes: true });
  } catch (err) {
    throw new Error(err.message || `Cannot read ${requested}`);
  }

  const dirs = entries
    .filter((ent) => ent.isDirectory() && !HIDDEN_DIR.test(ent.name) && ent.name !== 'node_modules')
    .map((ent) => {
      const abs = path.join(requested, ent.name);
      let isGit = false;
      try { isGit = fs.existsSync(path.join(abs, '.git')); } catch { /* ignore */ }
      return { name: ent.name, path: abs, isGit };
    })
    .sort((a, b) => {
      if (a.isGit !== b.isGit) return a.isGit ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const parent = path.dirname(requested);
  const shortcuts = [
    { name: 'Home', path: home },
    { name: 'Desktop', path: path.join(home, 'Desktop') },
    { name: 'Documents', path: path.join(home, 'Documents') },
    { name: 'Downloads', path: path.join(home, 'Downloads') },
    { name: 'GitHub', path: path.join(home, 'Documents', 'GitHub') },
  ].filter((s) => fs.existsSync(s.path) && fs.statSync(s.path).isDirectory());

  return {
    path: requested,
    parent: parent && parent !== requested ? parent : null,
    isGit: fs.existsSync(path.join(requested, '.git')),
    entries: dirs,
    shortcuts,
    recent: readRecent(),
  };
}

function loadMeta() {
  loadAllWorkspaceSnapshots();
  const metaPath = path.join(DATA_DIR, 'meta.json');
  if (!fs.existsSync(metaPath)) return;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    state.root = meta.root || null;
    state.repo = meta.repo || null;
    state.packages = Array.isArray(meta.packages) ? meta.packages : [];
    if (state.root) {
      workspaces.set(state.root, {
        root: state.root,
        repo: state.repo,
        packages: state.packages || [],
      });
      // Seed a workspace snapshot from the last analysis if none exists yet.
      if (!fs.existsSync(path.join(workspaceDir(state.root), 'graph.json'))) {
        const graph = readJson('graph.json');
        const endpoints = readJson('endpoints.json') || { endpoints: [], calls: [], hops: [] };
        if (graph) {
          persistWorkspaceSnapshot({
            root: state.root,
            repo: state.repo,
            packages: state.packages,
            graph,
            endpoints,
          });
        }
      }
    }
  } catch {
    /* ignore */
  }
}

function readJson(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function isGithubUrl(value) {
  return /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(value) ||
    /^git@github\.com:[\w.-]+\/[\w.-]+/i.test(value);
}

function normalizeGithubUrl(value) {
  let v = value.trim().replace(/\.git$/, '');
  if (v.startsWith('git@github.com:')) {
    v = 'https://github.com/' + v.slice('git@github.com:'.length);
  }
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  const u = new URL(v);
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('Expected https://github.com/org/repo');
  return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/, '')}.git`;
}

async function cloneGithub(cloneUrl, branch) {
  const name = cloneUrl.split('/').pop().replace(/\.git$/, '');
  const dest = path.join(os.tmpdir(), 'code-explorer-clones', `${name}-${Date.now()}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const args = ['clone', '--depth', '1'];
  if (branch) args.push('--branch', branch, '--single-branch');
  args.push(cloneUrl, dest);
  await execFileAsync('git', args, {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return dest;
}

function checkoutSearchRoots(activeRoot) {
  const roots = [];
  const push = (p) => { if (p && !roots.includes(p)) roots.push(p); };
  push(activeRoot);
  if (activeRoot) push(path.dirname(activeRoot));
  for (const p of readRecent()) push(p);
  for (const p of readRecent()) push(path.dirname(p));
  push(path.join(os.homedir(), 'Documents', 'GitHub'));
  push(path.join(os.homedir(), 'Documents'));
  push(os.homedir());
  return roots;
}

async function resolveTarget(target) {
  const value = target.trim();
  if (!value) throw new Error('Missing target');

  // GitHub URL or owner/repo@branch — find local checkout or clone (honour tree branch).
  if (isGithubUrl(value) || /^[\w.-]+\/[\w.-]+[@#:].+$/.test(value) || /^git@github\.com:/i.test(value)) {
    const parsed = parseCheckoutTarget(value);
    if (parsed.kind === 'remote') {
      const local = findLocalRepo(parsed.owner, parsed.repo, checkoutSearchRoots(null));
      if (local) {
        if (parsed.branch) checkoutBranch(local, parsed.branch);
        return local;
      }
      return cloneGithub(parsed.cloneUrl, parsed.branch);
    }
  }

  // Local path, optional @branch suffix
  const pathParsed = (() => {
    try { return parseCheckoutTarget(value); } catch { return null; }
  })();
  if (pathParsed?.kind === 'path') {
    const local = expandHome(pathParsed.path);
    if (!fs.existsSync(local)) throw new Error(`Path not found: ${local}`);
    if (!fs.statSync(local).isDirectory()) throw new Error(`Not a directory: ${local}`);
    if (pathParsed.branch) checkoutBranch(local, pathParsed.branch);
    return local;
  }

  const local = expandHome(value);
  if (!fs.existsSync(local)) throw new Error(`Path not found: ${local}`);
  if (!fs.statSync(local).isDirectory()) throw new Error(`Not a directory: ${local}`);
  return local;
}

loadMeta();

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, repo: state.repo, root: state.root });
});

app.get('/api/bootstrap', (_req, res) => {
  const repo = BOOTSTRAP_REPO && fs.existsSync(BOOTSTRAP_REPO) ? BOOTSTRAP_REPO : null;
  res.json({
    repo,
    changedOnly: process.env.CODE_EXPLORER_CHANGED_ONLY === '1',
  });
});

app.get('/api/browse', (req, res) => {
  try {
    res.json(browseDir(req.query.path));
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

app.get('/api/recent', (_req, res) => {
  res.json({ recent: readRecent() });
});

app.get('/api/graph', (_req, res) => {
  const graph = readJson('graph.json');
  if (!graph) return res.status(404).json({ error: 'No graph yet. Analyze a repo first.' });
  res.json(graph);
});

app.get('/api/endpoints', (_req, res) => {
  const data = readJson('endpoints.json');
  if (!data) return res.json({ endpoints: [], calls: [] });
  res.json(data);
});

app.get('/api/workspace', (req, res) => {
  const root = req.query.root ? String(req.query.root) : '';
  if (!root) return res.status(400).json({ error: 'Missing root' });
  const snap = loadWorkspaceSnapshot(root);
  if (!snap) return res.status(404).json({ error: 'No saved workspace for that root' });
  res.json(snap);
});

app.get('/api/git/changes', (req, res) => {
  const root = req.query.root ? String(req.query.root) : state.root;
  if (!root) return res.status(400).json({ error: 'Missing root' });
  const base = req.query.base ? String(req.query.base) : undefined;
  try {
    res.json(buildGitChangesResponse(root, base));
  } catch (err) {
    console.error('[git/changes]', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

/**
 * Paste a branch name (current workspace), owner/repo@branch, or GitHub tree URL.
 * Same-repo switches stay on the tab; other repos open (or reuse) another root.
 */
app.post('/api/git/checkout', async (req, res) => {
  try {
    const target = String(req.body?.target || req.body?.branch || '').trim();
    const activeRoot = req.body?.root ? String(req.body.root) : state.root;
    if (!target) return res.status(400).json({ ok: false, error: 'Missing target' });

    const parsed = parseCheckoutTarget(target);

    if (parsed.kind === 'branch') {
      if (!activeRoot) {
        return res.status(400).json({ ok: false, error: 'Open a repo first, or paste owner/repo@branch' });
      }
      const { packages } = packagesForRoot(activeRoot);
      const result = checkoutWorkspace(packages.length ? packages : [{ root: activeRoot }], parsed.branch);
      return res.json({
        ok: true,
        newTab: false,
        root: activeRoot,
        branch: result.branch,
        switched: result.switched,
        skipped: result.skipped,
      });
    }

    if (parsed.kind === 'path') {
      const local = expandHome(parsed.path);
      if (!fs.existsSync(local) || !fs.statSync(local).isDirectory()) {
        return res.status(404).json({ ok: false, error: `Path not found: ${local}` });
      }
      if (parsed.branch) checkoutBranch(local, parsed.branch);
      const same = activeRoot && path.resolve(activeRoot) === path.resolve(local);
      return res.json({
        ok: true,
        newTab: !same,
        root: local,
        branch: parsed.branch,
        repo: path.basename(local),
      });
    }

    // remote: prefer an existing local checkout, else clone
    let root = findLocalRepo(parsed.owner, parsed.repo, checkoutSearchRoots(activeRoot));
    let cloned = false;
    if (root) {
      if (parsed.branch) checkoutBranch(root, parsed.branch);
    } else {
      root = await cloneGithub(parsed.cloneUrl, parsed.branch);
      cloned = true;
    }
    const same = activeRoot && path.resolve(activeRoot) === path.resolve(root);
    return res.json({
      ok: true,
      newTab: !same,
      root,
      branch: parsed.branch,
      repo: parsed.repo,
      owner: parsed.owner,
      cloned,
    });
  } catch (err) {
    console.error('[git/checkout]', err);
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.get('/api/workspaces', (_req, res) => {
  res.json({ workspaces: listWorkspaceSnapshots() });
});

app.get('/api/session', (_req, res) => {
  res.json(readSessionFile() || { tabs: [], activeRoot: null, sidebarOpen: true });
});

app.put('/api/session', (req, res) => {
  const body = req.body || {};
  const tabs = Array.isArray(body.tabs) ? body.tabs : [];
  writeSessionFile({
    tabs,
    activeRoot: body.activeRoot || null,
    sidebarOpen: body.sidebarOpen !== false,
  });
  res.json({ ok: true });
});

app.get('/api/source', (req, res) => {
  const rel = String(req.query.path || '');
  const rootHint = req.query.root ? String(req.query.root) : null;
  const abs = resolveSourcePath(rel, rootHint);
  if (!abs) return res.status(404).type('text').send('');
  res.type('text/plain').send(fs.readFileSync(abs, 'utf8'));
});

app.get('/api/source/diff', (req, res) => {
  try {
    const rel = String(req.query.path || '');
    const rootHint = req.query.root ? String(req.query.root) : null;
    const hit = resolveSourceHit(rel, rootHint);
    if (!hit?.pkgRoot || !hit.repoRel) {
      return res.status(404).json({ ok: false, error: 'File not found', lines: [] });
    }
    const base = resolveBaseBranch(hit.pkgRoot);
    const diff = fileDiff(hit.pkgRoot, hit.repoRel, { base });
    if (!diff) {
      return res.json({ ok: true, path: rel, base, status: null, lines: [] });
    }
    res.json({
      ok: true,
      path: rel,
      base: diff.base,
      status: diff.status,
      lines: diff.lines,
    });
  } catch (err) {
    console.error('[source/diff]', err);
    res.status(500).json({ ok: false, error: err.message || String(err), lines: [] });
  }
});

app.post('/api/analyze', async (req, res) => {
  try {
    const target = req.body?.target || req.body?.path || req.body?.url;
    const repoPath = await resolveTarget(String(target || ''));
    const workspace = prepareWorkspace(repoPath);
    const result = extractGraph(workspace, { outDir: DATA_DIR });
    persistWorkspaceSnapshot(result);
    rememberRecent(result.root);
    res.json({
      ok: true,
      repo: result.repo,
      root: result.root,
      packages: result.packages,
      missing: result.missing,
      ...result.stats,
    });
  } catch (err) {
    console.error('[analyze]', err);
    res.status(400).json({ error: err.message || String(err) });
  }
});

// NDJSON stream: status* → start → progress* → done | error
app.post('/api/analyze/stream', async (req, res) => {
  let repoPath;
  try {
    const target = req.body?.target || req.body?.path || req.body?.url;
    repoPath = await resolveTarget(String(target || ''));
  } catch (err) {
    res.status(400).json({ type: 'error', error: err.message || String(err) });
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const write = (event) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    const workspace = prepareWorkspace(repoPath, {
      onStatus: (message) => write({ type: 'status', message }),
    });
    write({
      type: 'status',
      message: workspace.packages.length
        ? `Analyzing ${workspace.packages.length} local package(s)`
        : 'No local packages resolved yet',
      packages: workspace.packages,
      missing: workspace.missing,
    });

    for (const event of extractGraphStream(workspace, { outDir: DATA_DIR, batchSize: 30 })) {
      if (event.type === 'start' || event.type === 'done') {
        setWorkspaceState(event);
        if (event.type === 'done') {
          persistWorkspaceSnapshot(event);
          rememberRecent(event.root);
        }
      }
      if (event.type === 'error' && event.root) {
        setWorkspaceState(event);
        rememberRecent(event.root);
      }
      write(event);
      await new Promise((r) => setImmediate(r));
    }
  } catch (err) {
    console.error('[analyze/stream]', err);
    write({ type: 'error', error: err.message || String(err) });
  } finally {
    res.end();
  }
});

if (SERVE_UI) {
  const dist = path.join(ROOT, 'client', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(dist, 'index.html'), (err) => next(err));
    });
  } else {
    console.warn(`UI bundle missing at ${dist} — run the CLI so it can build, or npm run build`);
  }
}

const server = app.listen(PORT, () => {
  if (SERVE_UI) console.log(`Code Explorer UI on http://localhost:${PORT}`);
  else console.log(`Code Explorer API on http://localhost:${PORT}`);
  if (BOOTSTRAP_REPO) console.log(`Opening ${BOOTSTRAP_REPO}`);
  else if (state.repo) console.log(`Loaded data for ${state.repo}`);
  else console.log('No analyzed repo yet — open the UI and point it at one.');
});
server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — stop the other Code Explorer API (lsof -i :${PORT}) and retry.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

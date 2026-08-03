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

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');
const PORT = Number(process.env.PORT || 8787);

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
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({
      repo: eventOrResult.repo || path.basename(eventOrResult.root),
      root: eventOrResult.root,
      packages: eventOrResult.packages || [],
      missing: eventOrResult.missing || [],
      analyzedAt: new Date().toISOString(),
    }, null, 2),
  );
  setWorkspaceState(eventOrResult);
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

function resolveSourcePath(rel, rootHint) {
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) return null;
  const packages = [...workspacePackages(rootHint)]
    .sort((a, b) => (b.prefix || '').length - (a.prefix || '').length);

  for (const pkg of packages) {
    const prefix = (pkg.prefix || '').split(path.sep).join('/');
    let rest = rel;
    if (prefix) {
      if (rel !== prefix && !rel.startsWith(prefix + '/')) continue;
      rest = rel === prefix ? '' : rel.slice(prefix.length + 1);
    }
    const abs = path.resolve(pkg.root, rest);
    const rootAbs = path.resolve(pkg.root);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) continue;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
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
        const endpoints = readJson('endpoints.json') || { endpoints: [], calls: [] };
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

async function resolveTarget(target) {
  const value = target.trim();
  if (!value) throw new Error('Missing target');

  if (isGithubUrl(value)) {
    const url = normalizeGithubUrl(value);
    const name = url.split('/').pop().replace(/\.git$/, '');
    const dest = path.join(os.tmpdir(), 'code-explorer-clones', `${name}-${Date.now()}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await execFileAsync('git', ['clone', '--depth', '1', url, dest], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return dest;
  }

  const local = path.resolve(value.replace(/^~(?=$|\/)/, os.homedir()));
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

app.listen(PORT, () => {
  console.log(`Code Explorer API on http://localhost:${PORT}`);
  if (state.repo) console.log(`Loaded data for ${state.repo}`);
  else console.log('No analyzed repo yet — open the UI and point it at one.');
});

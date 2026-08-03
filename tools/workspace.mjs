/**
 * Resolve monorepos / git-submodule shells into concrete local package dirs.
 * Never clones or fetches — only uses checkouts already on disk.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo',
  'out', '.cache', '.vercel', 'vendor', '__pycache__', '.venv', 'venv',
  'DerivedData', 'Pods', 'xcuserdata', '.gradle',
]);

function hasCodeFiles(dir, budget = 40) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  const stack = [dir];
  let seen = 0;
  while (stack.length && seen < budget) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.name !== '.env.example') continue;
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        stack.push(abs);
      } else if (CODE_EXT.has(path.extname(ent.name))) {
        return true;
      }
      seen += 1;
      if (seen >= budget) break;
    }
  }
  return false;
}

export function parseGitmodules(root) {
  const file = path.join(root, '.gitmodules');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const mods = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const sec = line.match(/^\s*\[submodule\s+"([^"]+)"\]\s*$/);
    if (sec) {
      cur = { name: sec[1], path: sec[1], url: null, branch: null };
      mods.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = line.match(/^\s*([a-zA-Z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const val = kv[2];
    if (key === 'path') cur.path = val;
    if (key === 'url') cur.url = val;
    if (key === 'branch') cur.branch = val;
  }
  return mods.filter((m) => m.path);
}

function parseWorkspaceFolders(root) {
  try {
    const names = fs.readdirSync(root).filter((n) => n.endsWith('.code-workspace'));
    const out = [];
    for (const name of names) {
      const raw = fs.readFileSync(path.join(root, name), 'utf8');
      const json = JSON.parse(raw);
      for (const folder of json.folders || []) {
        if (!folder.path) continue;
        out.push({
          name: folder.name || path.basename(folder.path),
          path: folder.path,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function repoNameFromUrl(url) {
  if (!url) return null;
  const cleaned = url.replace(/\.git$/, '').replace(/\/$/, '');
  const parts = cleaned.split(/[:/]/).filter(Boolean);
  return parts[parts.length - 1] || null;
}

function candidateLocalPaths(root, mod) {
  const home = os.homedir();
  const name = path.basename(mod.path);
  const urlName = repoNameFromUrl(mod.url) || name;
  const parent = path.dirname(root);
  const grand = path.dirname(parent);
  return [
    path.join(root, mod.path),
    path.join(parent, name),
    path.join(parent, urlName),
    path.join(grand, name),
    path.join(grand, urlName),
    path.join(home, 'Documents', 'GitHub', name),
    path.join(home, 'Documents', 'GitHub', urlName),
    path.join(home, 'Documents', 'GitHub', path.basename(root), name),
    path.join(home, 'Documents', 'GitHub', path.basename(root), urlName),
    path.join(home, name),
    path.join(home, urlName),
  ];
}

/**
 * @returns {{ root: string, repo: string, packages: Array<{name:string, prefix:string, root:string, source:string}>, missing: Array<{name:string, path:string}> }}
 */
export function prepareWorkspace(repoPath, { onStatus } = {}) {
  const root = path.resolve(repoPath);
  const repo = path.basename(root);
  const packages = [];
  const missing = [];
  const seenRoots = new Set();

  const addPackage = (name, prefix, absRoot, source) => {
    const resolved = path.resolve(absRoot);
    if (seenRoots.has(resolved)) return false;
    if (!hasCodeFiles(resolved)) return false;
    seenRoots.add(resolved);
    packages.push({ name, prefix, root: resolved, source });
    return true;
  };

  // Root-level JS/TS (if any)
  if (hasCodeFiles(root)) {
    // Only treat as a root package when it isn't solely empty submodule dirs —
    // hasCodeFiles already requires real source files under root.
    addPackage(repo, '', root, 'root');
  }

  const mods = parseGitmodules(root);
  const workspaceFolders = parseWorkspaceFolders(root);
  const hints = [
    ...mods.map((m) => ({ name: m.name || path.basename(m.path), path: m.path, url: m.url })),
    ...workspaceFolders.map((f) => ({
      name: f.name,
      path: f.path,
      url: mods.find((m) => m.path === f.path || path.basename(m.path) === f.name)?.url || null,
    })),
  ];

  const byPath = new Map();
  for (const h of hints) {
    if (!byPath.has(h.path)) byPath.set(h.path, h);
  }

  for (const mod of byPath.values()) {
    const prefix = mod.path.split(path.sep).join('/');
    onStatus?.(`Resolving ${prefix}…`);

    let resolved = null;
    let source = null;

    for (const candidate of candidateLocalPaths(root, mod)) {
      if (hasCodeFiles(candidate)) {
        resolved = candidate;
        source = path.resolve(candidate) === path.resolve(root, mod.path) ? 'submodule' : 'local';
        if (source === 'local') onStatus?.(`Using local checkout for ${prefix}: ${candidate}`);
        break;
      }
    }

    if (resolved) addPackage(mod.name || path.basename(mod.path), prefix, resolved, source);
    else missing.push({ name: mod.name || path.basename(mod.path), path: prefix });
  }

  // Nested package-like dirs already on disk
  const nestedPkgDirs = ['apps', 'packages', 'services', 'frontend', 'backend', 'web', 'api', 'server', 'client'];
  for (const dirName of nestedPkgDirs) {
    const abs = path.join(root, dirName);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    if (hasCodeFiles(abs)) {
      addPackage(dirName, dirName, abs, 'nested');
      continue;
    }
    let kids = [];
    try {
      kids = fs.readdirSync(abs, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      kids = [];
    }
    for (const kid of kids) {
      if (SKIP_DIRS.has(kid.name) || kid.name.startsWith('.')) continue;
      const kidAbs = path.join(abs, kid.name);
      const prefix = `${dirName}/${kid.name}`;
      if (byPath.has(prefix) || byPath.has(kid.name)) continue;
      addPackage(kid.name, prefix, kidAbs, 'nested');
    }
  }

  // If root was added but packages cover the same trees via prefixes, keep both
  // only when root has files outside those prefixes — extract-graph handles
  // skipping package subtrees when walking a '' prefix package.

  return { root, repo, packages, missing };
}

export function describeWorkspace(workspace) {
  const lines = workspace.packages.map(
    (p) => `${p.prefix || '(root)'} ← ${p.root}${p.source ? ` [${p.source}]` : ''}`,
  );
  if (workspace.missing?.length) {
    lines.push(
      `missing locally: ${workspace.missing.map((m) => m.path).join(', ')}`,
    );
  }
  return lines.join('\n') || 'No JS/TS packages found.';
}

#!/usr/bin/env node
/**
 * Walk a JS/TS codebase and emit graph.json + endpoints.json for Code Explorer.
 * Usage: node tools/extract-graph.mjs <repoPath> [--out <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareWorkspace } from './workspace.mjs';

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo',
  'out', '.cache', '.vercel', '__pycache__', '.venv', 'venv',
  // Native / Capacitor build debris (megabyte hashed bundles freeze analysis)
  'DerivedData', 'Pods', 'xcuserdata', '.gradle',
]);
// Composer PHP "vendor/" only — do not skip API folders like backend/src/api/me/vendor.
/** Skip generated/minified sources that choke the import regex (bytes). */
const MAX_SOURCE_BYTES = 200_000;
const SKIP_FILE_RE = [
  /(^|\/)DerivedData\//,
  /(^|\/)Pods\//,
  /(^|\/)android\/app\/src\/main\/assets\//,
  /(^|\/)ios\/App\/App\/public\/assets\/[^/]+-[A-Za-z0-9_]{6,}\.[cm]?js$/,
  /(^|\/)prisma\/generated\//,
  /(^|\/)public\/assets\/[^/]+-[A-Za-z0-9_]{6,}\.[cm]?js$/,
];

const ENDPOINT_PATH = [
  /(^|\/)app\/.*\/route\.[jt]sx?$/,
  /(^|\/)pages\/api\//,
  // Express / Nest-style route modules (any depth). Controllers are NOT
  // endpoints — they're ordinary modules the router imports.
  /(^|\/)(routes|handlers|endpoints)\/.+\.[jt]sx?$/,
  // Common api/ trees (backend/src/api/couples.js, etc.)
  /(^|\/)api\/.+\.[jt]sx?$/,
];

const IMPORT_FROM_RE =
  /(?:import\s+(?:type\s+)?([\s\S]*?)\s+from\s+|export\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+)['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /(?:^|[;\n])\s*import\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const HTTP_RE =
  /(?:fetch|axios\.(?:get|post|put|patch|delete)|axios)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;

// OpenAPI/Superagent-style clients (novela backend_client) + call-site patterns
const BACKEND_FETCH_RE = /(?:\b|\.)backendFetch\s*\(\s*[`'"]([A-Za-z_][\w]*)[`'"]/g;
const API_METHOD_RE = /\b(?:api|apiClient|backendApi|client)\.([A-Za-z_][\w]*)\s*\(/g;
const CALL_API_RE = /\.callApi\s*\(\s*[`'"]([^`'"]+)[`'"]\s*,\s*[`'"]([A-Z]+)[`'"]/g;
const CONTROL_FLOW = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'function', 'else']);
const METHOD_NOISE = new Set([
  'then', 'catch', 'finally', 'map', 'filter', 'forEach', 'reduce', 'find', 'some', 'every',
  'push', 'pop', 'shift', 'unshift', 'includes', 'indexOf', 'lastIndexOf', 'slice', 'splice',
  'join', 'split', 'replace', 'trim', 'toLowerCase', 'toUpperCase', 'startsWith', 'endsWith',
  'toString', 'valueOf', 'bind', 'apply', 'call',
  'log', 'warn', 'error', 'json', 'send', 'status', 'next', 'emit', 'on', 'once',
  'keys', 'values', 'entries', 'has',
]);
const APP_MOUNT_RE = /\bapp\.use\s*\(\s*[`'"](\/[^`'"]*)[`'"]/g;
const ROUTER_VERB_RE = /\b(?:router|app|server)\.(get|post|put|patch|delete|all)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi;

function walk(dir, root, out = [], { skipTopLevel = new Set(), prefix = '' } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.env.example') {
      if (ent.isDirectory() && ent.name !== '.') continue;
    }
    const abs = path.join(dir, ent.name);
    const relWithin = path.relative(root, abs).split(path.sep).join('/');
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      // Composer dependency tree (has autoload.php). Keep app routes named "vendor".
      if (ent.name === 'vendor' && fs.existsSync(path.join(abs, 'autoload.php'))) continue;
      // When walking a monorepo root, skip dirs that are covered by other packages
      if (dir === root && skipTopLevel.has(ent.name)) continue;
      walk(abs, root, out, { skipTopLevel, prefix });
    } else if (CODE_EXT.has(path.extname(ent.name))) {
      if (SKIP_FILE_RE.some((re) => re.test(relWithin))) continue;
      try {
        if (fs.statSync(abs).size > MAX_SOURCE_BYTES) continue;
      } catch {
        continue;
      }
      const rel = prefix ? `${prefix}/${relWithin}` : relWithin;
      out.push({ abs, rel, packagePrefix: prefix });
    }
  }
  return out;
}

function collectFiles(workspace) {
  const packages = workspace.packages?.length
    ? workspace.packages
    : [{ name: workspace.repo, prefix: '', root: workspace.root, source: 'root' }];

  const skipFromRoot = new Set(
    packages.filter((p) => p.prefix && !p.prefix.includes('/')).map((p) => p.prefix),
  );

  const files = [];
  const seenRel = new Set();
  for (const pkg of packages) {
    const prefix = (pkg.prefix || '').split(path.sep).join('/');
    const walked = walk(pkg.root, pkg.root, [], {
      prefix,
      skipTopLevel: prefix === '' ? skipFromRoot : new Set(),
    });
    for (const f of walked) {
      if (seenRel.has(f.rel)) continue;
      seenRel.add(f.rel);
      files.push(f);
    }
  }
  return files;
}

function packageForRel(rel, packages) {
  const ranked = [...packages].sort((a, b) => (b.prefix || '').length - (a.prefix || '').length);
  for (const pkg of ranked) {
    const p = pkg.prefix || '';
    if (!p) continue;
    if (rel === p || rel.startsWith(p + '/')) return pkg;
  }
  return packages.find((p) => !p.prefix) || packages[0] || null;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function parseImportedSymbols(clause) {
  if (!clause) return [];
  const clean = clause.replace(/\btype\b/g, '').trim();
  if (!clean || clean === "''" || clean.startsWith('(')) return [];
  const symbols = [];
  const def = clean.match(/^([A-Za-z_$][\w$]*)/);
  if (def && !clean.startsWith('{') && !clean.startsWith('*')) symbols.push(def[1]);
  const star = clean.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (star) symbols.push(star[1]);
  const brace = clean.match(/\{([^}]+)\}/);
  if (brace) {
    for (const part of brace[1].split(',')) {
      const m = part.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+[A-Za-z_$][\w$]*)?/);
      if (m) symbols.push(m[1]);
    }
  }
  return [...new Set(symbols)];
}

/** Bindings from `const x = require(...)` / `const { a, b: c } = require(...)`. */
function parseRequireBinding(code, requireIndex) {
  const before = code.slice(Math.max(0, requireIndex - 160), requireIndex);
  let m = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
  if (m) return [m[1]];
  m = before.match(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*$/);
  if (!m) return [];
  const names = [];
  for (const part of m[1].split(',')) {
    const bit = part.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?/);
    if (!bit) continue;
    names.push(bit[2] || bit[1]);
  }
  return names;
}

/** Collect local import edges from one file's source. */
function extractImportRefs(code) {
  const refs = []; // { spec, symbols, sideEffect }
  const push = (spec, symbols, sideEffect) => {
    if (!spec) return;
    refs.push({ spec, symbols: symbols || [], sideEffect: !!sideEffect && !(symbols && symbols.length) });
  };

  IMPORT_FROM_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_FROM_RE.exec(code))) {
    const symbols = parseImportedSymbols(m[1]);
    push(m[2], symbols, symbols.length === 0);
  }

  BARE_IMPORT_RE.lastIndex = 0;
  while ((m = BARE_IMPORT_RE.exec(code))) {
    push(m[1], [], true);
  }

  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(code))) {
    const symbols = parseRequireBinding(code, m.index);
    push(m[1], symbols, symbols.length === 0);
  }

  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT_RE.exec(code))) {
    push(m[1], [], true);
  }

  return refs;
}

function resolveImport(fromRel, spec, fileIndex) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const fromDir = path.posix.dirname(fromRel);
  let base = spec.startsWith('/')
    ? spec.slice(1)
    : path.posix.normalize(path.posix.join(fromDir, spec));

  const candidates = [];
  const push = (p) => { if (p && !candidates.includes(p)) candidates.push(p); };
  push(base);
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
    push(base + ext);
    push(path.posix.join(base, 'index' + ext));
  }
  const noExt = base.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
  if (noExt !== base) {
    push(noExt);
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
      push(noExt + ext);
      push(path.posix.join(noExt, 'index' + ext));
    }
  }

  for (const c of candidates) {
    if (fileIndex.has(c)) return c;
  }
  return null;
}

function resolveAliasImport(fromRel, spec, fileIndex, packages) {
  if (!spec.startsWith('@/') && !spec.startsWith('~/')) return null;
  const rest = spec.replace(/^(@\/|~\/)/, '');
  const pkg = packageForRel(fromRel, packages);
  const bases = [];
  if (pkg?.prefix) {
    bases.push(`${pkg.prefix}/src`, pkg.prefix);
  } else {
    bases.push('src', '');
  }
  // Also try other packages' src roots as a weak fallback (monorepo path aliases)
  for (const p of packages) {
    if (!p.prefix) continue;
    bases.push(`${p.prefix}/src`, p.prefix);
  }
  for (const base of bases) {
    const fakeFrom = path.posix.join(base || '.', '_');
    const hit = resolveImport(fakeFrom, './' + rest, fileIndex);
    if (hit) return hit;
  }
  return null;
}

function isEndpointNoise(id) {
  return (
    /\.(test|spec)\./.test(id) ||
    /(^|\/)(tests?|__tests__|spec)(\/|$)/.test(id) ||
    /(^|\/)(backend_client|__generated__|generated|\.openapi-generator|__mocks__|http-mocks|cypress)(\/|$)/.test(id)
  );
}

function looksLikeEndpointPath(id) {
  if (isEndpointNoise(id)) return false;
  return ENDPOINT_PATH.some((re) => re.test(id));
}

function looksLikeEndpointSource(src) {
  if (!src) return false;
  const hasRouter = /express\.Router\s*\(|\bRouter\s*\(\s*\)/.test(src);
  const hasRouteVerb = /\b(?:router|app|server)\.(?:get|post|put|patch|delete|all|use)\s*\(/.test(src);
  return hasRouter && hasRouteVerb;
}

function looksLikeEndpoint(id, src) {
  if (isEndpointNoise(id)) return false;
  return looksLikeEndpointPath(id) || looksLikeEndpointSource(src);
}

function urlFromPath(id) {
  if (/\/route\.[jt]sx?$/.test(id)) {
    return '/' + id
      .replace(/^.*?\bapp\//, '')
      .replace(/\/route\.[jt]sx?$/, '')
      .replace(/\/?\([^/]*\)/g, '')
      .replace(/\[(\.\.\.)?([^\]]+)\]/g, ':$2');
  }
  if (/(^|\/)pages\/api\//.test(id)) {
    return '/' + id
      .replace(/^.*?\bpages\//, '')
      .replace(/\.[jt]sx?$/, '')
      .replace(/\/index$/, '')
      .replace(/\[(\.\.\.)?([^\]]+)\]/g, ':$2');
  }
  if (/(^|\/)api\//.test(id)) {
    return '/' + id
      .replace(/^.*?\bapi\//, 'api/')
      .replace(/\.[jt]sx?$/, '')
      .replace(/\/index$/, '');
  }
  return '/' + id
    .replace(/^.*?\b(routes|handlers|endpoints)\//, '')
    .replace(/\.[jt]sx?$/, '');
}

function detectMethods(src) {
  const methods = new Set();
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`).test(src) ||
        new RegExp(`export\\s+const\\s+${m}\\b`).test(src)) {
      methods.add(m);
    }
    // Express: router.get(...), app.post(...)
    if (new RegExp(`\\b(?:router|app|server)\\.${m.toLowerCase()}\\s*\\(`).test(src)) {
      methods.add(m);
    }
  }
  return [...methods];
}

function normalizeUrl(raw) {
  if (!raw) return null;
  let u = raw.trim();
  if (u.startsWith('${')) return null;
  u = u.replace(/\$\{[^}]+\}/g, ':param');
  if (!u.startsWith('/')) {
    try {
      const parsed = new URL(u);
      u = parsed.pathname;
    } catch {
      return null;
    }
  }
  u = u.split('?')[0].replace(/\/+/g, '/');
  if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1);
  return u || null;
}

function urlMatchesEndpoint(callUrl, endpointUrl) {
  if (!callUrl || !endpointUrl) return false;
  const a = callUrl.split('/').filter(Boolean);
  const b = endpointUrl.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (y.startsWith(':') || y.startsWith('[') || x.startsWith(':')) continue;
    if (x !== y) return false;
  }
  return true;
}

function joinUrl(a, b) {
  const left = (a || '').replace(/\/+$/, '');
  const right = (b || '').replace(/^\/+/, '');
  if (!left && !right) return '/';
  if (!left) return normalizeUrl('/' + right);
  if (!right) return normalizeUrl(left);
  return normalizeUrl(left + '/' + right);
}

function isGeneratedApiClientFile(rel, src) {
  if (!src || !/\.callApi\s*\(/.test(src)) return false;
  return (
    /(^|\/)backend_client\//.test(rel) ||
    /(^|\/)api\/[A-Za-z]\w*Api\.[jt]sx?$/.test(rel)
  );
}

/** operationId → { name, url, httpMethod, file } from OpenAPI-generated *Api.js */
function parseGeneratedApiMethods(rel, src) {
  const map = new Map();
  CALL_API_RE.lastIndex = 0;
  let m;
  while ((m = CALL_API_RE.exec(src))) {
    const url = normalizeUrl(m[1]);
    if (!url) continue;
    // Bodies often contain `if (...) {` before callApi — walk back past those.
    const before = src.slice(Math.max(0, m.index - 1200), m.index);
    const decls = [...before.matchAll(/(?:^|\n)\s*([A-Za-z_][\w]*)\s*\([^)]*\)\s*\{/g)];
    let name = null;
    for (let i = decls.length - 1; i >= 0; i--) {
      const cand = decls[i][1];
      if (!CONTROL_FLOW.has(cand)) { name = cand; break; }
    }
    if (!name) continue;
    map.set(name, { name, url, httpMethod: m[2], file: rel });
  }
  return map;
}

function extractAppMounts(contents) {
  const mounts = new Set();
  for (const src of contents.values()) {
    if (!src) continue;
    APP_MOUNT_RE.lastIndex = 0;
    let m;
    while ((m = APP_MOUNT_RE.exec(src))) {
      const p = normalizeUrl(m[1]);
      if (p && p !== '/') mounts.add(p);
    }
  }
  return [...mounts];
}

function preferredMountForFile(rel, mounts) {
  const hits = mounts.filter((m) => {
    const seg = m.replace(/^\//, '');
    if (!seg) return false;
    return (
      rel.includes('/api/' + seg + '/') ||
      rel.includes('/api/' + seg + '.') ||
      rel.endsWith('/api/' + seg + '.js') ||
      rel.endsWith('/api/' + seg + '.ts')
    );
  });
  hits.sort((a, b) => b.length - a.length);
  return hits[0] || '';
}

function extractExpressRouteUrls(rel, src, mounts) {
  const urls = new Set();
  const methods = new Set();
  if (!src) return { urls, methods };
  const preferred = preferredMountForFile(rel, mounts);
  // Only mounts that clearly belong to this file — never cross-product every
  // app.use prefix with every router path (that produced hundreds of fakes).
  const localMounts = preferred
    ? [preferred]
    : mounts.filter((m) => {
      const seg = m.replace(/^\//, '');
      return seg && (rel.includes('/api/' + seg + '/') || rel.includes('/api/' + seg + '.'));
    });
  ROUTER_VERB_RE.lastIndex = 0;
  let m;
  while ((m = ROUTER_VERB_RE.exec(src))) {
    const verb = m[1].toUpperCase();
    if (verb === 'ALL') for (const v of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) methods.add(v);
    else methods.add(verb);
    const routePath = normalizeUrl(m[2].startsWith('/') ? m[2] : '/' + m[2]);
    if (!routePath) continue;
    urls.add(routePath);
    for (const mount of localMounts) {
      const full = joinUrl(mount, routePath);
      if (full) urls.add(full);
    }
  }
  return { urls, methods };
}

function findEndpointForUrl(url, endpointByUrl, endpoints) {
  if (!url) return null;
  let ep = endpointByUrl.get(url);
  if (ep) return ep;
  for (const e of endpoints) {
    if (urlMatchesEndpoint(url, e.url)) return e;
    for (const u of e.urls || []) {
      if (urlMatchesEndpoint(url, u)) return e;
    }
  }
  return null;
}

function matchBalanced(src, from, open, close) {
  const start = src.indexOf(open, from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  return null;
}

function ensureNode(nodesById, id, extras = {}) {
  if (!id || nodesById.has(id)) return;
  nodesById.set(id, {
    id,
    name: id.split('/').pop(),
    folder: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '',
    isTest: false,
    inDeg: 0,
    outDeg: 0,
    synthetic: true,
    ...extras,
  });
}

function addHop(hopMap, hop) {
  if (!hop?.source || !hop?.target || hop.source === hop.target) return;
  const key = `${hop.hop}|${hop.source}=>${hop.target}|${hop.label}`;
  const existing = hopMap.get(key);
  if (existing) {
    existing.weight = (existing.weight || 1) + (hop.weight || 1);
    if (hop.fields?.length && !existing.fields?.length) existing.fields = hop.fields;
    return;
  }
  hopMap.set(key, { weight: 1, fields: [], ...hop });
}

const PRISMA_WRITE = new Set([
  'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
]);
const PRISMA_CALL_RE =
  /(?:^|[^\w.])(?:prisma|db|database|client|tx|this\.(?:prisma|db))\s*\.\s*([A-Za-z_]\w*)\s*\.\s*(findMany|findUnique|findFirst|findFirstOrThrow|findUniqueOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate)\s*\(/g;
const JOB_STR_RE =
  /(?:jobs|jobQueue|queue|queues|agenda|pgBoss|pgboss|bullmq|bull|workerClient|workers)\s*\.\s*(?:enqueue|add|now|schedule|publish|push)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi;
const JOB_IDENT_RE =
  /(?:jobs|jobQueue|queue)\s*\.\s*(?:enqueue|add)\s*\(\s*([A-Za-z_]\w*(?:Job)?)/g;
const DRIZZLE_WRITE_RE =
  /(?:^|[^\w.])(?:db|database|tx|this\.(?:db|database))\s*\.\s*(update|insert|delete)\s*\(\s*([A-Za-z_]\w*)/g;
const DRIZZLE_SELECT_RE =
  /(?:^|[^\w.])(?:db|database|tx|this\.(?:db|database))\s*\.\s*select\s*\(/g;
const DRIZZLE_QUERY_RE =
  /(?:^|[^\w.])(?:db|database|tx)\s*\.\s*query\s*\.\s*([A-Za-z_]\w*)\s*\.\s*(findMany|findFirst|findFirstOrThrow)\s*\(/g;
const METHOD_CALL_RE = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;

const SKIP_OBJECT_KEYS = new Set([
  'select', 'include', 'where', 'data', 'orderBy', 'skip', 'take', 'cursor', 'distinct',
]);

function extractObjectFields(src, fromIndex, key = 'data') {
  const slice = src.slice(fromIndex, fromIndex + 1200);
  const re = new RegExp(`\\b${key}\\s*:`);
  const m = re.exec(slice);
  if (!m) return [];
  const body = matchBalanced(slice, m.index, '{', '}');
  if (!body) return [];
  const fields = [];
  const inner = body.slice(1, -1);
  for (const fm of inner.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) {
    if (SKIP_OBJECT_KEYS.has(fm[1])) continue;
    const after = inner.slice(fm.index + fm[0].length).trim();
    const to = after.split(/[,\n]/)[0].replace(/\s+/g, ' ').trim().slice(0, 72);
    if (!to || to.startsWith('{') || to.startsWith('[') || to.startsWith('...')) continue;
    fields.push({ name: fm[1], to });
    if (fields.length >= 10) break;
  }
  return fields;
}

function extractCallObjectFields(src, fromIndex, fnName) {
  const slice = src.slice(fromIndex, fromIndex + 1400);
  const re = new RegExp(`\\.${fnName}\\s*\\(`);
  const m = re.exec(slice);
  if (!m) return [];
  const body = matchBalanced(slice, m.index + m[0].length - 1, '{', '}');
  if (!body) return [];
  const fields = [];
  const inner = body.slice(1, -1);
  for (const fm of inner.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) {
    if (SKIP_OBJECT_KEYS.has(fm[1])) continue;
    const after = inner.slice(fm.index + fm[0].length).trim();
    const to = after.split(/[,\n]/)[0].replace(/\s+/g, ' ').trim().slice(0, 72);
    if (!to || to.startsWith('{') || to.startsWith('[') || to.startsWith('...')) continue;
    fields.push({ name: fm[1], to });
    if (fields.length >= 10) break;
  }
  return fields;
}

function extractProtectedFields(src, usedNames) {
  const m = src.match(/\b(?:protectedFields|PROTECTED_FIELDS|omitFields)\b[^=\n]{0,80}=\s*\[([^\]]{0,500})\]/);
  if (!m) return [];
  const used = new Set(usedNames || []);
  return [...m[1].matchAll(/['"]([A-Za-z_]\w*)['"]/g)]
    .map((x) => x[1])
    .filter((name) => !used.has(name))
    .slice(0, 12);
}

function findWorkerFile(jobName, fileIndex) {
  const needle = String(jobName || '')
    .replace(/Job$/i, '')
    .replace(/[-_]/g, '')
    .toLowerCase();
  if (!needle) return null;
  let best = null;
  for (const rel of fileIndex.keys()) {
    if (/\.(test|spec)\./.test(rel)) continue;
    const base = path.posix.basename(rel).replace(/\.[^.]+$/, '').replace(/[-_.]/g, '').toLowerCase();
    if (!base.includes(needle) && !needle.includes(base)) continue;
    const score = /worker|job|queue|tasks?/.test(rel.toLowerCase()) ? 2 : 1;
    if (!best || score > best.score) best = { rel, score };
  }
  return best?.rel || null;
}

function extractHops({ files, contents, fileIndex, nodesById, linkMap }) {
  const hopMap = new Map();
  const importedByFile = new Map();
  for (const link of linkMap.values()) {
    const list = importedByFile.get(link.source) || [];
    list.push(link);
    importedByFile.set(link.source, list);
  }

  for (const f of files) {
    const src = contents.get(f.rel);
    if (!src) continue;
    if (isEndpointNoise(f.rel)) continue;
    if (isGenerated(f.rel) || isGeneratedApiClientFile(f.rel, src)) continue;
    const code = stripComments(src);

    PRISMA_CALL_RE.lastIndex = 0;
    let m;
    while ((m = PRISMA_CALL_RE.exec(code))) {
      const model = m[1];
      const op = m[2];
      const hop = PRISMA_WRITE.has(op) ? 'prisma-write' : 'prisma-read';
      const target = `prisma/${model}`;
      ensureNode(nodesById, target, { kind: 'prisma-model' });
      const t = nodesById.get(target);
      if (t) t.inDeg += 1;
      const fields = hop === 'prisma-write'
        ? extractObjectFields(code, m.index, 'data')
        : extractObjectFields(code, m.index, 'where');
      addHop(hopMap, {
        source: f.rel,
        target,
        hop,
        label: `${model}.${op}`,
        fields,
        protected: hop === 'prisma-write' ? extractProtectedFields(src, fields.map((f) => f.name)) : [],
      });
    }

    DRIZZLE_WRITE_RE.lastIndex = 0;
    while ((m = DRIZZLE_WRITE_RE.exec(code))) {
      const op = m[1];
      const model = m[2];
      const target = `db/${model}`;
      ensureNode(nodesById, target, { kind: 'prisma-model' });
      const t = nodesById.get(target);
      if (t) t.inDeg += 1;
      const fields = op === 'insert'
        ? extractCallObjectFields(code, m.index, 'values')
        : op === 'update'
          ? extractCallObjectFields(code, m.index, 'set')
          : [];
      addHop(hopMap, {
        source: f.rel,
        target,
        hop: 'drizzle-write',
        label: `${model}.${op}`,
        fields,
      });
    }
    DRIZZLE_SELECT_RE.lastIndex = 0;
    while ((m = DRIZZLE_SELECT_RE.exec(code))) {
      const from = /\.from\s*\(\s*([A-Za-z_]\w*)/.exec(code.slice(m.index, m.index + 400));
      const model = from?.[1];
      if (!model) continue;
      const target = `db/${model}`;
      ensureNode(nodesById, target, { kind: 'prisma-model' });
      const t = nodesById.get(target);
      if (t) t.inDeg += 1;
      addHop(hopMap, {
        source: f.rel,
        target,
        hop: 'drizzle-read',
        label: `${model}.select`,
      });
    }
    DRIZZLE_QUERY_RE.lastIndex = 0;
    while ((m = DRIZZLE_QUERY_RE.exec(code))) {
      const model = m[1];
      const op = m[2];
      const target = `db/${model}`;
      ensureNode(nodesById, target, { kind: 'prisma-model' });
      const t = nodesById.get(target);
      if (t) t.inDeg += 1;
      addHop(hopMap, {
        source: f.rel,
        target,
        hop: 'drizzle-read',
        label: `${model}.${op}`,
      });
    }

    JOB_STR_RE.lastIndex = 0;
    while ((m = JOB_STR_RE.exec(code))) {
      const jobName = m[1].replace(/\s+/g, '');
      const target = findWorkerFile(jobName, fileIndex) || `jobs/${jobName}`;
      ensureNode(nodesById, target, { kind: 'job' });
      const t = nodesById.get(target);
      if (t) t.inDeg += 1;
      addHop(hopMap, {
        source: f.rel,
        target,
        hop: 'job',
        label: `enqueue ${jobName}`,
        fields: extractObjectFields(code, m.index, 'data'),
      });
    }
    JOB_IDENT_RE.lastIndex = 0;
    while ((m = JOB_IDENT_RE.exec(code))) {
      const jobName = m[1];
      const target = findWorkerFile(jobName, fileIndex) || `jobs/${jobName}`;
      ensureNode(nodesById, target, { kind: 'job' });
      const t = nodesById.get(target);
      if (t) t.inDeg += 1;
      addHop(hopMap, {
        source: f.rel,
        target,
        hop: 'job',
        label: `enqueue ${jobName}`,
      });
    }

    const imports = importedByFile.get(f.rel) || [];
    if (!imports.length) continue;
    const methodsByBinding = new Map();
    METHOD_CALL_RE.lastIndex = 0;
    while ((m = METHOD_CALL_RE.exec(code))) {
      const binding = m[1];
      const method = m[2];
      if (CONTROL_FLOW.has(binding) || CONTROL_FLOW.has(method) || METHOD_NOISE.has(method)) continue;
      if (binding === 'prisma' || binding === 'db' || binding === 'console' || binding === 'Math') continue;
      const set = methodsByBinding.get(binding) || new Set();
      set.add(method);
      methodsByBinding.set(binding, set);
    }
    for (const link of imports) {
      for (const sym of link.symbols || []) {
        if (/^[A-Z0-9_]+$/.test(sym)) continue;
        const methods = methodsByBinding.get(sym);
        if (!methods?.size) continue;
        for (const method of methods) {
          addHop(hopMap, {
            source: f.rel,
            target: link.target,
            hop: 'call',
            label: `${sym}.${method}`,
          });
        }
      }
    }
  }

  return [...hopMap.values()];
}

function isGenerated(id) {
  return (
    /(^|\/)(\.next|dist|build|coverage|out|storybook-static|__generated__|generated|\.openapi-generator)(\/|$)/.test(id) ||
    /(^|\/)(backend_client|__mocks__|http-mocks)(\/|$)/.test(id) ||
    /\.(generated|gen)\.[jt]sx?$/.test(id)
  );
}

function addCallEdge(callMap, { source, target, urls, weight = 1, role = 'direct', via = null }) {
  if (!source || !target || source === target) return;
  const urlKey = (urls || []).slice().sort().join(',');
  const key = `${role}|${source}=>${target}|${urlKey}`;
  const existing = callMap.get(key);
  if (existing) {
    existing.weight += weight;
    for (const u of urls || []) if (!existing.urls.includes(u)) existing.urls.push(u);
    return;
  }
  callMap.set(key, {
    source,
    target,
    urls: [...(urls || [])],
    weight,
    role,
    via: via || null,
  });
}

/** Emit direct + optional hop-through-generated-client edges. */
function recordApiCall(callMap, { source, endpointId, via, urls, weight = 1 }) {
  if (!source || !endpointId) return;
  const list = urls || [];
  if (via && via !== source && via !== endpointId) {
    addCallEdge(callMap, { source, target: via, urls: list, weight, role: 'to-client', via });
    addCallEdge(callMap, { source: via, target: endpointId, urls: list, weight, role: 'to-endpoint', via });
    addCallEdge(callMap, { source, target: endpointId, urls: list, weight, role: 'direct', via });
  } else {
    addCallEdge(callMap, { source, target: endpointId, urls: list, weight, role: 'direct', via: null });
  }
}

function emptyRepoMessage(workspace, files) {
  if (files.length > 0) return null;
  const missing = workspace.missing || [];
  if (missing.length || parseGitmodulesExists(workspace.root)) {
    const names = missing.map((m) => m.path).join(', ') || 'frontend, backend, …';
    return (
      `No JavaScript/TypeScript source found for ${workspace.repo}. ` +
      `Submodule folders look empty, and no local checkouts were found for: ${names}. ` +
      `Clone those packages next to this repo (e.g. ~/Documents/GitHub/frontend) or open a package folder directly.`
    );
  }
  return (
    'No JavaScript/TypeScript source files found (.js/.jsx/.ts/.tsx). ' +
    'Pick a folder that contains that source, or a package inside a monorepo (e.g. …/frontend).'
  );
}

function parseGitmodulesExists(root) {
  return fs.existsSync(path.join(root, '.gitmodules'));
}

function writeOutputs(outDir, graph, endpointData, workspace) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 2));
  fs.writeFileSync(path.join(outDir, 'endpoints.json'), JSON.stringify(endpointData, null, 2));
  fs.writeFileSync(
    path.join(outDir, 'meta.json'),
    JSON.stringify({
      repo: workspace.repo,
      root: workspace.root,
      packages: workspace.packages || [],
      missing: workspace.missing || [],
      analyzedAt: new Date().toISOString(),
    }, null, 2),
  );
}

function normalizeWorkspace(input) {
  if (input && typeof input === 'object' && input.root && Array.isArray(input.packages)) {
    return input;
  }
  const root = path.resolve(String(input));
  return {
    root,
    repo: path.basename(root),
    packages: [{ name: path.basename(root), prefix: '', root, source: 'root' }],
    missing: [],
  };
}

/**
 * Progressive analyzer. Accepts a path string or a prepared workspace object.
 * Yields NDJSON-friendly events: start → progress* → done | error
 */
export function* extractGraphStream(repoPathOrWorkspace, { outDir, batchSize = 35 } = {}) {
  const workspace = normalizeWorkspace(repoPathOrWorkspace);
  const root = workspace.root;
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    yield { type: 'error', error: `Not a directory: ${root}` };
    return;
  }

  const files = collectFiles(workspace);
  const repoName = workspace.repo;
  const emptyMsg = emptyRepoMessage(workspace, files);

  if (emptyMsg) {
    if (outDir) {
      writeOutputs(
        outDir,
        { repo: repoName, nodes: [], links: [] },
        { endpoints: [], calls: [], hops: [] },
        workspace,
      );
    }
    yield {
      type: 'error',
      error: emptyMsg,
      repo: repoName,
      root,
      packages: workspace.packages,
      missing: workspace.missing,
    };
    return;
  }

  const nodesById = new Map();
  for (const f of files) {
    const name = path.posix.basename(f.rel);
    nodesById.set(f.rel, {
      id: f.rel,
      name,
      folder: path.posix.dirname(f.rel),
      isTest: /\.(test|spec)\.[jt]sx?$/.test(name),
      inDeg: 0,
      outDeg: 0,
    });
  }

  yield {
    type: 'start',
    repo: repoName,
    root,
    packages: workspace.packages,
    missing: workspace.missing,
    total: files.length,
    graph: { repo: repoName, nodes: [...nodesById.values()], links: [] },
    endpoints: { endpoints: [], calls: [], hops: [] },
  };

  const fileIndex = new Map(files.map((f) => [f.rel, f]));
  const packages = workspace.packages;

  const linkMap = new Map();
  const contents = new Map();
  let batchLinks = [];
  let done = 0;

  for (const f of files) {
    let src = '';
    try {
      src = fs.readFileSync(f.abs, 'utf8');
    } catch {
      done += 1;
      continue;
    }
    contents.set(f.rel, src);
    const code = stripComments(src);
    for (const ref of extractImportRefs(code)) {
      const target =
        resolveImport(f.rel, ref.spec, fileIndex) ||
        resolveAliasImport(f.rel, ref.spec, fileIndex, packages);
      if (!target || target === f.rel) continue;
      const symbols = ref.symbols;
      const key = f.rel + '=>' + target;
      const existing = linkMap.get(key);
      if (existing) {
        for (const s of symbols) if (!existing.symbols.includes(s)) existing.symbols.push(s);
        if (existing.symbols.length) existing.sideEffect = false;
        else if (ref.sideEffect) existing.sideEffect = true;
        existing.weight += 1;
        batchLinks.push({ ...existing });
      } else {
        const link = {
          source: f.rel,
          target,
          symbols: [...symbols],
          weight: 1,
          sideEffect: !!ref.sideEffect && symbols.length === 0,
        };
        linkMap.set(key, link);
        batchLinks.push(link);
        const s = nodesById.get(f.rel);
        const t = nodesById.get(target);
        if (s) s.outDeg += 1;
        if (t) t.inDeg += 1;
      }
    }

    done += 1;
    if (done % batchSize === 0 || done === files.length) {
      yield {
        type: 'progress',
        repo: repoName,
        root,
        done,
        total: files.length,
        file: f.rel,
        newLinks: batchLinks,
        graph: {
          repo: repoName,
          nodes: [...nodesById.values()],
          links: [...linkMap.values()],
        },
      };
      batchLinks = [];
    }
  }

  const mounts = extractAppMounts(contents);

  // OpenAPI-generated clients (novela backend_client DefaultApi, etc.)
  const sdkMethods = new Map(); // operationId → { name, url, httpMethod, file }
  for (const f of files) {
    const src = contents.get(f.rel) || '';
    if (!isGeneratedApiClientFile(f.rel, src)) continue;
    for (const [name, info] of parseGeneratedApiMethods(f.rel, src)) {
      sdkMethods.set(name, info);
    }
  }

  const endpoints = [];
  const endpointByUrl = new Map();
  const registerEndpointUrl = (url, ep) => {
    if (!url || !ep) return;
    const prev = endpointByUrl.get(url);
    if (!prev) { endpointByUrl.set(url, ep); return; }
    // Prefer exact primary url, then deeper router files, then fewer alias urls.
    const score = (e) => {
      let s = 0;
      if (e.url === url) s += 100;
      s += (e.id.match(/\//g) || []).length * 2;
      s -= Math.min(40, (e.urls || []).length);
      if (/(^|\/)controllers\//.test(e.id)) s -= 20;
      return s;
    };
    if (score(ep) > score(prev)) endpointByUrl.set(url, ep);
  };

  for (const f of files) {
    const src = contents.get(f.rel) || '';
    if (!looksLikeEndpoint(f.rel, src)) continue;
    const { urls: routeUrls, methods: routeMethods } = extractExpressRouteUrls(f.rel, src, mounts);
    const methods = routeMethods.size ? [...routeMethods] : detectMethods(src);
    const preferred = preferredMountForFile(f.rel, mounts);
    let url = urlFromPath(f.rel);
    if (routeUrls.size) {
      // Prefer a fully-mounted path that matches how clients call the API.
      const ranked = [...routeUrls].sort((a, b) => {
        const aPref = preferred && (a === preferred || a.startsWith(preferred + '/')) ? 0 : 1;
        const bPref = preferred && (b === preferred || b.startsWith(preferred + '/')) ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        return b.length - a.length;
      });
      url = ranked[0] || url;
    }
    const ep = {
      id: f.rel,
      url,
      urls: routeUrls.size ? [...routeUrls] : [url],
      methods,
    };
    endpoints.push(ep);
    registerEndpointUrl(url, ep);
    for (const u of ep.urls) registerEndpointUrl(u, ep);
  }

  // Also index any SDK urls that landed on an endpoint via fuzzy match later.
  for (const info of sdkMethods.values()) {
    const ep = findEndpointForUrl(info.url, endpointByUrl, endpoints);
    if (ep) registerEndpointUrl(info.url, ep);
  }

  const callMap = new Map();

  // 1) Literal fetch/axios URLs (cville-events style)
  for (const f of files) {
    const src = contents.get(f.rel);
    if (!src) continue;
    if (isGeneratedApiClientFile(f.rel, src)) continue;
    const code = stripComments(src);
    HTTP_RE.lastIndex = 0;
    let m;
    while ((m = HTTP_RE.exec(code))) {
      const url = normalizeUrl(m[1]);
      if (!url || (!url.startsWith('/api') && !url.startsWith('/'))) continue;
      const targetEp = findEndpointForUrl(url, endpointByUrl, endpoints);
      if (!targetEp) continue;
      recordApiCall(callMap, {
        source: f.rel,
        endpointId: targetEp.id,
        via: null,
        urls: [url],
      });
    }
  }

  // 2) Generated-client call sites: api.meCoupleGet / backendFetch('meCoupleGet')
  if (sdkMethods.size) {
    for (const f of files) {
      const src = contents.get(f.rel);
      if (!src) continue;
      if (isGeneratedApiClientFile(f.rel, src)) continue;
      if (isEndpointNoise(f.rel) && /(^|\/)backend_client\//.test(f.rel)) continue;
      const code = stripComments(src);
      const hits = new Map(); // methodName → count

      BACKEND_FETCH_RE.lastIndex = 0;
      let m;
      while ((m = BACKEND_FETCH_RE.exec(code))) {
        hits.set(m[1], (hits.get(m[1]) || 0) + 1);
      }
      API_METHOD_RE.lastIndex = 0;
      while ((m = API_METHOD_RE.exec(code))) {
        if (!sdkMethods.has(m[1])) continue;
        hits.set(m[1], (hits.get(m[1]) || 0) + 1);
      }

      for (const [methodName, count] of hits) {
        const info = sdkMethods.get(methodName);
        if (!info) continue;
        const targetEp = findEndpointForUrl(info.url, endpointByUrl, endpoints);
        if (!targetEp) continue;
        recordApiCall(callMap, {
          source: f.rel,
          endpointId: targetEp.id,
          via: info.file,
          urls: [info.url],
          weight: count,
        });
      }
    }
  }

  const hops = extractHops({ files, contents, fileIndex, nodesById, linkMap });

  const graph = {
    repo: repoName,
    nodes: [...nodesById.values()],
    links: [...linkMap.values()],
  };
  const allCalls = [...callMap.values()];
  const endpointData = {
    endpoints,
    calls: allCalls,
    hops,
  };

  if (outDir) writeOutputs(outDir, graph, endpointData, workspace);

  const logicalCalls = allCalls.filter((c) => c.role === 'direct').length;
  yield {
    type: 'done',
    repo: repoName,
    root,
    packages: workspace.packages,
    missing: workspace.missing,
    graph,
    endpoints: endpointData,
    stats: {
      nodes: graph.nodes.length,
      links: graph.links.length,
      endpoints: endpoints.length,
      calls: logicalCalls,
      hops: hops.length,
      sdkMethods: sdkMethods.size,
    },
  };
}

export function extractGraph(repoPathOrWorkspace, { outDir } = {}) {
  let result = null;
  let error = null;
  for (const event of extractGraphStream(repoPathOrWorkspace, { outDir })) {
    if (event.type === 'error') error = new Error(event.error);
    if (event.type === 'done') {
      result = {
        graph: event.graph,
        endpoints: event.endpoints,
        root: event.root,
        repo: event.repo,
        packages: event.packages,
        missing: event.missing,
        stats: event.stats,
      };
    }
  }
  if (error) throw error;
  if (!result) throw new Error('Analysis produced no result');
  return result;
}

function printHelp() {
  console.log(`Usage: node tools/extract-graph.mjs <repoPath> [--out <dir>]

Analyzes a local JavaScript/TypeScript repository and writes:
  graph.json       file nodes + import edges
  endpoints.json   API routes + HTTP call edges
  meta.json        source path metadata`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(args.length ? 0 : 1);
  }
  let outDir = path.resolve('data');
  let repoPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') outDir = path.resolve(args[++i]);
    else if (!args[i].startsWith('-')) repoPath = args[i];
  }
  if (!repoPath) {
    printHelp();
    process.exit(1);
  }
  try {
    const workspace = prepareWorkspace(repoPath, {
      onStatus: (msg) => console.error(msg),
    });
    if (workspace.packages.length) {
      console.error('Packages:\n' + workspace.packages.map((p) => `  ${p.prefix || '(root)'} ← ${p.root}`).join('\n'));
    }
    if (workspace.missing.length) {
      console.error('Missing locally: ' + workspace.missing.map((m) => m.path).join(', '));
    }
    const result = extractGraph(workspace, { outDir });
    console.log(
      `Wrote ${outDir}\n  ${result.stats.nodes} files · ${result.stats.links} imports · ${result.stats.endpoints} endpoints · ${result.stats.calls} calls · ${result.stats.hops} hops`,
    );
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

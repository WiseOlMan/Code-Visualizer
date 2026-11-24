/**
 * Build a flow view for one repo: head sources, compare-base blobs, then pure derivation.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { analyzeModules, normalizeBody } from './functions.mjs';
import { applyMainMarks, deriveFlows, diffFunctions, explainFunction } from './flow.mjs';
import { bodyDiffCounts } from '../client/src/diffMark.js';
import { listRepoSources } from './extract-graph.mjs';

function git(cwd, args) {
  try {
    let out = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 12 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (out.endsWith('\n')) out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

function readHead(root) {
  const modules = [];
  for (const source of listRepoSources(root)) {
    try {
      modules.push({ file: source.file, source: fs.readFileSync(source.abs, 'utf8') });
    } catch { /* unreadable file */ }
  }
  return modules;
}

function readRev(changes, rev) {
  const modules = [];
  if (!rev) return modules;
  const seen = new Set();
  for (const file of changes || []) {
    if (!file?.root || !file.path || !file.graphId || seen.has(file.graphId)) continue;
    seen.add(file.graphId);
    const blob = git(file.root, ['show', `${rev}:${file.path}`]);
    if (blob == null) continue;
    modules.push({ file: file.graphId, source: blob });
  }
  return modules;
}

function publish(view) {
  for (const flow of view.flows || []) {
    for (const column of flow.columns || []) {
      for (const file of column.files || []) {
        for (const box of file.functions || []) {
          const explained = explainFunction(box);
          const counts = bodyDiffCounts(box.baseBody, box.headBody || box.body, box.status);
          box.whatItDoes = explained.whatItDoes;
          box.whatChanged = explained.whatChanged;
          box.diff = explained.diff;
          box.adds = counts.adds;
          box.dels = counts.dels;
          box.fnLines = (box.endLine && box.line) ? Math.max(1, box.endLine - box.line + 1) : counts.lines;
          delete box.body;
          delete box.baseBody;
          delete box.headBody;
        }
      }
    }
  }
  return view;
}

function baseButtonLabel(baseLabel) {
  const short = String(baseLabel || 'main').replace(/^origin\//, '');
  if (short === 'main' || short === 'master') return 'main';
  return short;
}

/**
 * @param {{
 *   root: string,
 *   changes?: object[],
 *   baseRev?: string|null,
 *   baseLabel?: string|null,
 *   headSha?: string|null,
 *   baseSha?: string|null,
 *   merged?: boolean,
 *   mainRev?: string|null,
 *   focusId?: string|null,
 * }} input
 */
function expandRenames(changes, baseRev) {
  if (!baseRev) return changes || [];
  const extra = [];
  const seen = new Set((changes || []).map((file) => file.graphId));
  const roots = new Map();
  for (const file of changes || []) {
    if (file?.root && !roots.has(file.root)) roots.set(file.root, file.prefix || '');
  }
  for (const [cwd, prefix] of roots) {
    const text = git(cwd, ['diff', '--name-status', '-M', `${baseRev}...HEAD`]);
    if (!text) continue;
    for (const line of text.split('\n')) {
      const parts = line.split('\t');
      if (!parts[0] || !/^R/.test(parts[0]) || parts.length < 3) continue;
      const oldPath = parts[1].split('\\').join('/');
      const graphId = prefix ? `${prefix}/${oldPath}` : oldPath;
      if (seen.has(graphId)) continue;
      seen.add(graphId);
      extra.push({ graphId, path: oldPath, status: 'D', root: cwd, prefix });
    }
  }
  return [...(changes || []), ...extra];
}

export function buildFlowView(input) {
  const changes = expandRenames(input.changes || [], input.baseRev);
  const changedFiles = changes.map((file) => file.graphId).filter(Boolean);
  const head = analyzeModules(readHead(input.root));
  const base = analyzeModules(readRev(changes, input.baseRev));
  const functions = diffFunctions(base.functions, head.functions, { changedFiles });
  const changedSet = new Set(changedFiles);
  const callerFile = (id) => String(id || '').split('#')[0];
  const calls = [
    // Unchanged files are not re-parsed at the base, so their calls are not new.
    ...head.calls.map((call) => ({
      ...call,
      side: changedSet.has(callerFile(call.from)) ? 'head' : 'both',
    })),
    ...base.calls.map((call) => ({ ...call, side: 'base' })),
  ];
  const view = deriveFlows({ functions, calls }, { focusId: input.focusId || undefined });
  if (input.merged && input.mainRev) {
    const main = analyzeModules(readRev(changes, input.mainRev));
    const mainByNorm = new Map(main.functions.map((fn) => [fn.id, fn.bodyNorm || normalizeBody(fn.body)]));
    applyMainMarks(view, mainByNorm);
  }
  publish(view);
  const merged = !!input.merged;
  return {
    ok: true,
    merged,
    baseLabel: input.baseLabel || null,
    headSha: input.headSha || null,
    baseSha: input.baseSha || null,
    modes: merged
      ? [
        { id: 'before', label: 'before' },
        { id: 'pr', label: 'this PR' },
        { id: 'main', label: 'main now' },
      ]
      : [
        { id: 'before', label: baseButtonLabel(input.baseLabel) },
        { id: 'pr', label: 'this PR' },
      ],
    ...view,
  };
}

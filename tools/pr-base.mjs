/**
 * Compare-base for branch overlays.
 * Prefer a GitHub pull request's base ref (stacked PRs), else main/master/develop.
 * Lookup uses `gh` when it is installed, then the GitHub REST API. No token and
 * no matching PR both fall back to the default branch with a note — never throw.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  gitBranch,
  gitRemoteUrl,
  isGitRepo,
  resolveBaseBranch,
  resolveRev,
} from './git-changes.mjs';

const execFileAsync = promisify(execFile);

const GH_FIELDS = ['number', 'baseRefName', 'headRefName', 'url', 'title', 'state'];
const lookupCache = new Map();
const lookupInflight = new Map();

function cacheGet(key) {
  const hit = lookupCache.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) {
    lookupCache.delete(key);
    return null;
  }
  return hit.value;
}

/** @returns {{ number: number, owner?: string, repo?: string } | null} */
export function parsePrSpec(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const bare = raw.match(/^#(\d+)$/) || raw.match(/^(\d+)$/);
  if (bare) {
    const number = cleanPrNumber(bare[1]);
    return number ? { number } : null;
  }
  const url = raw.match(/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/pull\/(\d+)/i);
  if (!url) return null;
  const number = cleanPrNumber(url[3]);
  if (!number) return null;
  return { owner: url[1], repo: url[2], number };
}

function cleanPrNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 1_000_000_000) return null;
  return number;
}

/** Drop userinfo so a token in an https remote never leaves this function. */
export function parseGithubRemote(url) {
  let raw = String(url || '').trim();
  if (!raw) return null;
  // https://user:token@github.com/… — drop userinfo. Leave ssh://git@github.com alone.
  raw = raw.replace(/^https?:\/\/(?:[^@/\s]+@)?/i, 'https://');
  raw = raw.replace(/\.git$/i, '').replace(/\/+$/, '');
  const ssh = raw.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/i)
    || raw.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+)$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = raw.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/i);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

function sameRepo(a, b) {
  if (!a?.owner || !b?.owner) return false;
  return a.owner.toLowerCase() === b.owner.toLowerCase()
    && a.repo.toLowerCase() === b.repo.toLowerCase();
}

function shortBranch(name) {
  const raw = String(name || '');
  return raw.startsWith('origin/') ? raw.slice('origin/'.length) : raw;
}

function fallback(defaultBranch, hasRev, why) {
  const label = defaultBranch ? shortBranch(defaultBranch) : null;
  const usable = !!(label && (hasRev(label) || hasRev(`origin/${label}`) || hasRev(defaultBranch)));
  const note = usable ? `${why} Comparing to ${label}.` : why;
  return {
    base: usable ? label : null,
    baseLabel: usable ? label : null,
    source: 'default',
    pr: null,
    note,
  };
}

/**
 * Pure decision for which branch a diff should use.
 * `hasRev` reports whether a name exists in the local clone (branch or origin/*).
 */
export function chooseCompareBase({
  explicitBase = null,
  prSpec = null,
  invalidPr = false,
  remote = null,
  headBranch = null,
  prRecord = null,
  lookupNote = null,
  defaultBranch = null,
  hasRev = () => false,
} = {}) {
  if (explicitBase) {
    const label = shortBranch(explicitBase);
    const usable = hasRev(explicitBase) || hasRev(label) || hasRev(`origin/${label}`);
    if (!usable) return fallback(defaultBranch, hasRev, `Branch ${label} isn’t in this clone.`);
    return {
      base: label,
      baseLabel: label,
      source: 'explicit',
      pr: null,
      note: null,
    };
  }

  if (invalidPr) {
    return fallback(
      defaultBranch,
      hasRev,
      lookupNote || 'Paste a pull request number (#482) or a github.com pull URL.',
    );
  }

  const canLookup = !!(remote || (prSpec?.owner && prSpec?.repo));
  if (!canLookup) {
    return fallback(
      defaultBranch,
      hasRev,
      'This repo has no GitHub remote, so the PR base couldn’t be resolved.',
    );
  }
  if (lookupNote && !prRecord) return fallback(defaultBranch, hasRev, lookupNote);
  if (!prRecord?.baseRef || !prRecord.number) {
    const where = prSpec?.owner && prSpec?.repo ? ` on ${prSpec.owner}/${prSpec.repo}` : '';
    const why = prSpec
      ? `No pull request #${prSpec.number}${where}.`
      : headBranch
        ? `No open pull request for ${headBranch}.`
        : 'No branch is checked out, so there is no pull request to look up.';
    return fallback(defaultBranch, hasRev, why);
  }

  const label = shortBranch(prRecord.baseRef);
  const usable = hasRev(label) || hasRev(`origin/${label}`) || hasRev(prRecord.baseRef);
  if (!usable) {
    return fallback(
      defaultBranch,
      hasRev,
      `PR #${prRecord.number} bases on ${label}, which isn’t in this clone.`,
    );
  }

  const closed = prRecord.state && String(prRecord.state).toUpperCase() !== 'OPEN'
    ? ` (${String(prRecord.state).toLowerCase()})`
    : '';
  const elsewhere = prSpec?.owner && prSpec?.repo && remote && !sameRepo(prSpec, remote)
    ? ` (${prSpec.owner}/${prSpec.repo})`
    : '';
  const note = prSpec
    ? `From PR #${prRecord.number}${closed}${elsewhere} · base ${label}.`
    : `Auto from GitHub · PR #${prRecord.number} bases on ${label}.`;
  return {
    base: label,
    baseLabel: label,
    source: prSpec ? 'pr' : 'head',
    pr: {
      number: prRecord.number,
      url: prRecord.url || null,
      baseRef: label,
      headRef: prRecord.headRef ? shortBranch(prRecord.headRef) : null,
      title: prRecord.title || null,
    },
    note,
  };
}

function normalizeGh(row) {
  if (!row || row.number == null || !row.baseRefName) return null;
  const number = cleanPrNumber(row.number);
  if (!number) return null;
  return {
    number,
    baseRef: String(row.baseRefName),
    headRef: row.headRefName ? String(row.headRefName) : null,
    url: row.url || null,
    title: row.title || null,
    state: row.state ? String(row.state).toUpperCase() : null,
  };
}

function normalizeApi(row) {
  if (!row?.number || !row.base?.ref) return null;
  const number = cleanPrNumber(row.number);
  if (!number) return null;
  return {
    number,
    baseRef: String(row.base.ref),
    headRef: row.head?.ref ? String(row.head.ref) : null,
    url: row.html_url || null,
    title: row.title || null,
    state: row.state ? String(row.state).toUpperCase() : null,
  };
}

function classifyGhError(err) {
  if (err?.code === 'ENOENT') return 'missing';
  const text = `${err?.stderr || ''} ${err?.message || ''}`;
  if (/auth|login|token|HTTP 401|HTTP 403|credential|forbidden/i.test(text)) return 'auth';
  if (/not found|no pull requests|could not resolve|no pull request/i.test(text)) return 'empty';
  return 'other';
}

async function ghJson(args) {
  const { stdout } = await execFileAsync('gh', args, {
    timeout: 12_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
  });
  return JSON.parse(stdout);
}

let tokenCache;
async function githubToken() {
  if (tokenCache !== undefined) return tokenCache;
  const env = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  if (env) {
    tokenCache = env;
    return tokenCache;
  }
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      timeout: 5_000,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
    });
    tokenCache = stdout.trim() || null;
  } catch {
    tokenCache = null;
  }
  return tokenCache;
}

async function fetchPrFromApi({ remote, number, head, token }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'code-explorer',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let url;
  if (number) {
    url = `https://api.github.com/repos/${remote.owner}/${remote.repo}/pulls/${number}`;
  } else if (head) {
    // Pulls API filter is `owner:branch` (gh's --head flag is the branch name only).
    const q = new URLSearchParams({
      state: 'open',
      head: `${remote.owner}:${head}`,
      per_page: '10',
    });
    url = `https://api.github.com/repos/${remote.owner}/${remote.repo}/pulls?${q}`;
  } else {
    return { ok: true, record: null, status: 0 };
  }
  let res;
  try {
    res = await fetch(url, { headers });
  } catch {
    return { ok: false, record: null, status: 0 };
  }
  if (res.status === 404) return { ok: true, record: null, status: 404 };
  if (!res.ok) return { ok: false, record: null, status: res.status };
  const body = await res.json();
  if (Array.isArray(body)) {
    const records = body.map(normalizeApi).filter(Boolean).filter((row) => !head || row.headRef === head);
    return { ok: true, record: records[0] || null, status: res.status };
  }
  return { ok: true, record: normalizeApi(body), status: res.status };
}

async function lookupPullRequest({ remote, number, head }) {
  let ghProblem = null;
  try {
    if (number) {
      const row = await ghJson([
        'pr', 'view', String(number),
        '--repo', `${remote.owner}/${remote.repo}`,
        '--json', GH_FIELDS.join(','),
      ]);
      return { record: normalizeGh(row), note: null };
    }
    if (head) {
      // `--head` does not accept `owner:branch` — branch name only.
      const rows = await ghJson([
        'pr', 'list',
        '--repo', `${remote.owner}/${remote.repo}`,
        '--head', head,
        '--state', 'open',
        '--limit', '10',
        '--json', GH_FIELDS.join(','),
      ]);
      const list = (Array.isArray(rows) ? rows : []).map(normalizeGh).filter(Boolean);
      const exact = list.filter((row) => row.headRef === head);
      return { record: (exact.length ? exact : list)[0] || null, note: null };
    }
    return { record: null, note: null };
  } catch (err) {
    ghProblem = classifyGhError(err);
    if (ghProblem === 'empty') return { record: null, note: null };
  }

  const token = await githubToken();
  let api = await fetchPrFromApi({ remote, number, head, token });
  // A rejected token should not hide a public pull request.
  if (!api.ok && token && (api.status === 401 || api.status === 403)) {
    const pub = await fetchPrFromApi({ remote, number, head, token: null });
    if (pub.ok) api = pub;
  }
  if (api.ok) return { record: api.record, note: null };
  if (api.status === 401 || api.status === 403 || ghProblem === 'auth') {
    return {
      record: null,
      note: 'GitHub auth isn’t available, so the PR base couldn’t be resolved.',
    };
  }
  if (ghProblem === 'missing' && !api.ok) {
    return {
      record: null,
      note: 'GitHub auth isn’t available, so the PR base couldn’t be resolved.',
    };
  }
  return { record: null, note: 'The PR base couldn’t be resolved.' };
}

function splitHints(hints) {
  let base = String(hints.base || '').trim();
  let pr = String(hints.pr || '').trim();
  if (pr) base = '';
  else if (base && parsePrSpec(base)) {
    pr = base;
    base = '';
  }
  return { base, pr };
}

async function cachedLookup(key, fn) {
  const hit = cacheGet(key);
  if (hit) return hit;
  if (lookupInflight.has(key)) return lookupInflight.get(key);
  const pending = fn().then((value) => {
    const ttl = value?.note && /auth/i.test(value.note) ? 15_000 : 45_000;
    lookupCache.set(key, { exp: Date.now() + ttl, value });
    return value;
  }).finally(() => lookupInflight.delete(key));
  lookupInflight.set(key, pending);
  return pending;
}

/**
 * @param {string} cwd package root
 * @param {{ base?: string, pr?: string }} [hints]
 * @returns {Promise<{ base: string|null, baseLabel: string|null, source: string, pr: object|null, note: string|null }>}
 */
export async function resolveCompareBase(cwd, hints = {}) {
  try {
    return await resolveCompareBaseInner(cwd, hints);
  } catch {
    const defaultBranch = cwd && isGitRepo(cwd) ? resolveBaseBranch(cwd) : null;
    const label = defaultBranch ? shortBranch(defaultBranch) : null;
    return {
      base: label,
      baseLabel: label,
      source: 'default',
      pr: null,
      note: label
        ? `The PR base couldn’t be resolved. Comparing to ${label}.`
        : 'The PR base couldn’t be resolved.',
    };
  }
}

async function resolveCompareBaseInner(cwd, hints) {
  const hasRev = (name) => !!resolveRev(cwd, name);
  const defaultBranch = isGitRepo(cwd) ? resolveBaseBranch(cwd) : null;
  if (!cwd || !isGitRepo(cwd)) {
    return fallback(null, () => false, 'This path isn’t a git repository, so the PR base couldn’t be resolved.');
  }

  const { base, pr } = splitHints(hints);
  const prSpec = pr ? parsePrSpec(pr) : null;
  const invalidPr = !!(pr && !prSpec);
  const headBranch = gitBranch(cwd);
  const remote = parseGithubRemote(gitRemoteUrl(cwd));

  // Already on main/master/develop — there is no stacked base to look up.
  if (!pr && !base && headBranch && defaultBranch && shortBranch(headBranch) === shortBranch(defaultBranch)) {
    const label = shortBranch(defaultBranch);
    return {
      base: label,
      baseLabel: label,
      source: 'default',
      pr: null,
      note: null,
    };
  }

  if (base && !pr) {
    return chooseCompareBase({
      explicitBase: base,
      remote,
      headBranch,
      defaultBranch,
      hasRev,
    });
  }

  const lookupRemote = (prSpec?.owner && prSpec?.repo)
    ? { owner: prSpec.owner, repo: prSpec.repo }
    : remote;

  let prRecord = null;
  let lookupNote = null;
  if (!invalidPr && lookupRemote && (prSpec || headBranch)) {
    const key = [
      lookupRemote.owner,
      lookupRemote.repo,
      prSpec ? `n:${prSpec.number}` : `h:${headBranch}`,
    ].join('|');
    const found = await cachedLookup(key, () => lookupPullRequest({
      remote: lookupRemote,
      number: prSpec?.number || null,
      head: prSpec ? null : headBranch,
    }));
    prRecord = found.record;
    lookupNote = found.note;
  }

  return chooseCompareBase({
    prSpec,
    invalidPr,
    remote,
    headBranch,
    prRecord,
    lookupNote,
    defaultBranch,
    hasRev,
  });
}

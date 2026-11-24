/**
 * Function, method, and static-call extraction for JS/TS.
 * The file graph ignores this. Flow view uses it.
 * Masking keeps string indexes aligned with the original source.
 */
import path from 'node:path';

const WRITE_OPS = new Set([
  'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
]);
const READ_OPS = new Set([
  'findMany', 'findUnique', 'findFirst', 'findFirstOrThrow', 'findUniqueOrThrow', 'count',
]);
const SKIP_CALLS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'new', 'typeof', 'await',
  'void', 'delete', 'import', 'super', 'class', 'case', 'else', 'do', 'try', 'throw',
  'yield', 'async', 'of', 'in', 'instanceof', 'constructor',
]);
const SKIP_KEYS = new Set([
  'select', 'include', 'where', 'data', 'orderBy', 'skip', 'take', 'cursor', 'distinct',
  'from', 'set', 'values',
]);
const METHOD_MODS = '(?:public|private|protected|static|async|readonly|override|abstract|get|set|declare)';

/** Patterns are source strings so a caller can add a queue style without editing the walker. */
export const DEFAULT_QUEUE_PATTERNS = [
  { name: 'enqueueJob', source: String.raw`\benqueueJob\s*\(\s*(['"\`])([^'"\`]+)\1` },
  { name: 'dispatchJob', source: String.raw`\bdispatch(?:Job)?\s*\(\s*(['"\`])([^'"\`]+)\1` },
  {
    name: 'queueMethod',
    source: String.raw`\b(?:jobs|jobQueue|queue|queues|boss|pgBoss|pgboss|bull|bullmq|worker|workers)\s*\.\s*(?:enqueue|add|send|publish|dispatch|now|schedule|push)\s*\(\s*(['"\`])([^'"\`]+)\1`,
  },
];

export function normalizeBody(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);
}

export function maskSource(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && src[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < n) {
        out[i] = ' ';
        if (src[i + 1] === '/') out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      out[i] = ' ';
      i += 1;
      while (i < n) {
        if (src[i] === '\\') {
          out[i] = ' ';
          if (i + 1 < n && src[i + 1] !== '\n') out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (src[i] === c) {
          out[i] = ' ';
          i += 1;
          break;
        }
        if (src[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

function lineAt(indexes, index) {
  let lo = 0;
  let hi = indexes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (indexes[mid] <= index) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

function newlineIndex(src) {
  const lines = [0];
  for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') lines.push(i + 1);
  return lines;
}

function matchBrace(src, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function docBefore(source, index) {
  const before = source.slice(Math.max(0, index - 600), index);
  const m = before.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
  if (!m) return '';
  return m[1].replace(/\r/g, '').replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim().slice(0, 320);
}

function insideSpan(spans, index) {
  for (const span of spans) {
    if (index >= span.start && index <= span.end) return true;
  }
  return false;
}

function signatureOf(name, params) {
  const flat = String(params || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${name}(${flat})`;
}

function paramsOf(source, parenIndex) {
  if (source[parenIndex] !== '(') return '';
  let depth = 0;
  for (let i = parenIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(parenIndex + 1, i);
    }
  }
  return '';
}

function routePathFromFile(file) {
  let p = String(file || '').replace(/\\/g, '/');
  p = p.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
  const app = p.match(/(?:^|\/)app\/(.+)\/route$/);
  if (app) return `/${app[1]}`.replace(/\/+/g, '/');
  const pages = p.match(/(?:^|\/)pages\/(.+)$/);
  if (pages) return `/${pages[1]}`.replace(/\/index$/, '').replace(/\/+/g, '/') || '/';
  const routes = p.match(/(?:^|\/)routes\/(.+)$/);
  if (routes) return `/${routes[1]}`.replace(/\/index$/, '').replace(/\/+/g, '/');
  const api = p.match(/(?:^|\/)api\/(.+)$/);
  if (api) return `/${api[1]}`.replace(/\/index$/, '').replace(/\/+/g, '/');
  return `/${p.split('/').pop() || ''}`;
}

function fileEntryKind(file, source) {
  const p = String(file || '').replace(/\\/g, '/');
  if (/(^|\/)(cron|crons)\//.test(p)) return 'cron';
  if (/webhook/i.test(p)) return 'webhook';
  if (/(^|\/)(bin|cli)\//.test(p) || source.startsWith('#!')) return 'cli';
  if (/(^|\/)mcp\//.test(p) || /\bregisterTool\s*\(/.test(source) || /\bserver\.tool\s*\(/.test(source)) return 'mcp';
  if (/(^|\/)(jobs|workers|queues)\//.test(p)) return 'job';
  if (
    /(?:^|\/)app\/.*\/route\.[jt]sx?$/.test(p)
    || /(?:^|\/)pages\/api\//.test(p)
    || /(?:^|\/)(routes|handlers|endpoints)\//.test(p)
    || /(?:^|\/)api\//.test(p)
  ) return 'route';
  return null;
}

function objectKeys(raw, fromIndex, key) {
  const slice = raw.slice(fromIndex, fromIndex + 900);
  const m = new RegExp(`\\b${key}\\s*:`).exec(slice);
  if (!m) return [];
  const open = slice.indexOf('{', m.index);
  if (open < 0) return [];
  const close = matchBrace(slice, open);
  if (close < 0) return [];
  const inner = slice.slice(open + 1, close);
  const keys = [];
  for (const fm of inner.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) {
    if (SKIP_KEYS.has(fm[1])) continue;
    keys.push(fm[1]);
    if (keys.length >= 8) break;
  }
  return keys;
}

function pushFn(list, fn) {
  if (!fn?.name || SKIP_CALLS.has(fn.name)) return;
  list.push(fn);
}

function extractFunctions(file, source, masked, lines) {
  const functions = [];
  const classSpans = [];
  const classRe = /(?:^|[\n;])[ \t]*(export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)\b/g;
  let m;
  while ((m = classRe.exec(masked))) {
    const name = m[2];
    const brace = masked.indexOf('{', m.index + m[0].length - 1);
    if (brace < 0) continue;
    const end = matchBrace(masked, brace);
    if (end < 0) continue;
    classSpans.push({ name, start: m.index, bodyStart: brace, end, exported: /export/.test(m[1] || '') });
    const body = masked.slice(brace + 1, end);
    const methodRe = new RegExp(
      `(?:^|[\\n;{}])[ \\t]*(?:${METHOD_MODS}\\s+)*([A-Za-z_$][\\w$]*)\\s*\\(`,
      'g',
    );
    let mm;
    while ((mm = methodRe.exec(body))) {
      const method = mm[1];
      if (SKIP_CALLS.has(method) && method !== 'constructor') continue;
      if (method === 'constructor') continue;
      const absParen = brace + 1 + mm.index + mm[0].lastIndexOf('(');
      const params = paramsOf(source, absParen);
      const after = masked.slice(absParen, Math.min(masked.length, absParen + 180));
      const bodyOpen = after.indexOf('{');
      if (bodyOpen < 0) continue;
      const open = absParen + bodyOpen;
      if (open > end) continue;
      const close = matchBrace(masked, open);
      if (close < 0 || close > end) continue;
      const queueName = readQueueName(source.slice(brace, end));
      pushFn(functions, {
        id: `${file}#${name}.${method}`,
        file,
        name: method,
        kind: 'method',
        className: name,
        line: lineAt(lines, m.index + mm.index),
        endLine: lineAt(lines, close),
        start: open,
        end: close,
        exported: /export/.test(m[1] || ''),
        signature: signatureOf(`${name}.${method}`, params),
        doc: docBefore(source, m.index + mm.index),
        queueName,
        body: source.slice(open, close + 1).slice(0, 1200),
      });
      methodRe.lastIndex = close - (brace + 1);
    }
  }

  const namedRe = /(?:^|[\n;])[ \t]*(export\s+(?:default\s+)?)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = namedRe.exec(masked))) {
    const openParen = m.index + m[0].lastIndexOf('(');
    if (insideSpan(classSpans, openParen)) continue;
    const name = m[3];
    const params = paramsOf(source, openParen);
    const after = masked.slice(openParen, openParen + 200);
    const bodyOpenRel = after.indexOf('{');
    if (bodyOpenRel < 0) continue;
    const open = openParen + bodyOpenRel;
    const close = matchBrace(masked, open);
    if (close < 0) continue;
    pushFn(functions, {
      id: `${file}#${name}`,
      file,
      name,
      kind: 'function',
      className: null,
      line: lineAt(lines, m.index),
      endLine: lineAt(lines, close),
      start: open,
      end: close,
      exported: /export/.test(m[1] || ''),
      signature: signatureOf(name, params),
      doc: docBefore(source, m.index),
      queueName: null,
      body: source.slice(open, close + 1).slice(0, 1200),
    });
    namedRe.lastIndex = close;
  }

  const arrowRe = /(?:^|[\n;])[ \t]*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?\([^)]*\)\s*=>/g;
  while ((m = arrowRe.exec(masked))) {
    const name = m[2];
    const arrowAt = m.index + m[0].length;
    if (insideSpan(classSpans, arrowAt)) continue;
    const after = masked.slice(m.index, m.index + m[0].length + 80);
    const rel = after.indexOf('=>');
    if (rel < 0) continue;
    const from = m.index + rel + 2;
    let open = -1;
    for (let i = from; i < Math.min(masked.length, from + 40); i += 1) {
      if (masked[i] === '{') { open = i; break; }
      if (masked[i] !== ' ' && masked[i] !== '\n' && masked[i] !== '\t') break;
    }
    if (open < 0) continue;
    const close = matchBrace(masked, open);
    if (close < 0) continue;
    const paren = masked.indexOf('(', m.index);
    pushFn(functions, {
      id: `${file}#${name}`,
      file,
      name,
      kind: 'arrow',
      className: null,
      line: lineAt(lines, m.index),
      endLine: lineAt(lines, close),
      start: open,
      end: close,
      exported: /export/.test(m[1] || ''),
      signature: signatureOf(name, paren >= 0 ? paramsOf(source, paren) : ''),
      doc: docBefore(source, m.index),
      queueName: null,
      body: source.slice(open, close + 1).slice(0, 1200),
    });
    arrowRe.lastIndex = close;
  }

  return functions;
}

function readQueueName(classBody) {
  const m = classBody.match(/\bstatic\s+(?:jobName|queueName|name)\s*=\s*['"`]([^'"`]+)['"`]/);
  return m ? m[1] : null;
}

function enclosing(functions, index) {
  let best = null;
  for (const fn of functions) {
    if (index < fn.start || index > fn.end) continue;
    if (!best || (fn.end - fn.start) < (best.end - best.start)) best = fn;
  }
  return best;
}

function modeRanges(maskedBody, rawBody = maskedBody) {
  const ranges = [];
  const switchRe = /\bswitch\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = switchRe.exec(maskedBody))) {
    const open = maskedBody.indexOf('{', m.index);
    const close = matchBrace(maskedBody, open);
    if (close < 0) continue;
    // Case labels live in strings, which the mask blanks out. Read them from the raw slice.
    const block = rawBody.slice(open + 1, close);
    const caseRe = /\bcase\s+(['"`])([^'"`]+)\1\s*:|\bcase\s+([A-Za-z_$][\w$]*)\s*:|\bdefault\s*:/g;
    const cases = [];
    let cm;
    while ((cm = caseRe.exec(block))) {
      cases.push({ index: cm.index, mode: cm[2] || cm[3] || null });
    }
    for (let i = 0; i < cases.length; i += 1) {
      if (!cases[i].mode) continue;
      const start = open + 1 + cases[i].index;
      const end = i + 1 < cases.length ? open + 1 + cases[i + 1].index : close;
      ranges.push({ start, end, mode: String(cases[i].mode) });
    }
    switchRe.lastIndex = close;
  }
  const ifRe = /\bif\s*\(\s*[A-Za-z0-9_$.]*mode\s*===?\s*(['"`])([^'"`]+)\1\s*\)\s*\{/g;
  while ((m = ifRe.exec(rawBody))) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(maskedBody, open);
    if (close < 0) continue;
    ranges.push({ start: open, end: close, mode: m[2] });
    ifRe.lastIndex = close;
  }
  return ranges;
}

function modeAt(ranges, index) {
  let found = null;
  for (const range of ranges) {
    if (index >= range.start && index < range.end) found = range.mode;
  }
  return found;
}

function parseImports(source) {
  const map = new Map();
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source))) {
    const clause = m[1].replace(/\btype\b/g, '').trim();
    const spec = m[2];
    const def = clause.match(/^([A-Za-z_$][\w$]*)/);
    if (def && !clause.startsWith('{') && !clause.startsWith('*')) {
      map.set(def[1], { spec, imported: 'default' });
    }
    const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (star) map.set(star[1], { spec, imported: '*', namespace: true });
    const brace = clause.match(/\{([^}]+)\}/);
    if (brace) {
      for (const part of brace[1].split(',')) {
        const bit = part.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/);
        if (!bit) continue;
        map.set(bit[2] || bit[1], { spec, imported: bit[1] });
      }
    }
  }
  return map;
}

function decorateEntries(file, source, functions, routeBinds) {
  const kind = fileEntryKind(file, source);
  const routePath = routePathFromFile(file);
  for (const fn of functions) {
    fn.entryKind = null;
    fn.entryLabel = null;
    if (fn.className && /Job$/.test(fn.className) && /^(perform|process|handle|run)$/.test(fn.name)) {
      fn.entryKind = 'job';
      fn.entryLabel = fn.queueName || fn.className;
    } else if (kind === 'job' && /^(perform|process|handle|run)$/.test(fn.name) && fn.exported) {
      fn.entryKind = 'job';
      fn.entryLabel = fn.className || fn.name;
    }
    if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(fn.name) && fn.exported) {
      fn.entryKind = 'route';
      fn.entryLabel = `${fn.name} ${routePath}`;
    }
    if (kind === 'cli' && fn.exported && (fn.name === 'main' || fn.name === 'run')) {
      fn.entryKind = 'cli';
      fn.entryLabel = `cli ${fn.name}`;
    }
    if (kind === 'cron' && fn.exported) {
      fn.entryKind = 'cron';
      fn.entryLabel = `cron ${fn.name}`;
    }
    if (kind === 'webhook' && fn.exported && !fn.entryKind) {
      fn.entryKind = 'webhook';
      fn.entryLabel = `webhook ${fn.name}`;
    }
    if (kind === 'mcp' && fn.exported && !fn.entryKind) {
      fn.entryKind = 'mcp';
      fn.entryLabel = `mcp ${fn.name}`;
    }
    if (kind === 'route' && fn.exported && !fn.entryKind && fn.kind !== 'method') {
      fn.entryKind = 'handler';
      fn.entryLabel = fn.name;
    }
  }
  for (const bind of routeBinds) {
    const target = functions.find((fn) => fn.name === bind.handler && !fn.className)
      || functions.find((fn) => fn.name === bind.handler);
    if (!target) continue;
    target.entryKind = 'route';
    target.entryLabel = `${bind.verb} ${bind.url}`;
    target.exported = true;
  }
}

function compilePatterns(patterns) {
  return (patterns || DEFAULT_QUEUE_PATTERNS).map((p) => ({
    name: p.name,
    re: new RegExp(p.source, 'g'),
  }));
}

/**
 * @param {string} file
 * @param {string} source
 * @param {{ queuePatterns?: Array<{name: string, source: string}> }} [options]
 */
export function extractModule(file, source, options = {}) {
  const text = String(source || '');
  const masked = maskSource(text);
  const lines = newlineIndex(text);
  const functions = extractFunctions(file, text, masked, lines);
  const calls = [];
  const imports = parseImports(text);

  const queuePatterns = compilePatterns(options.queuePatterns);
  for (const pattern of queuePatterns) {
    pattern.re.lastIndex = 0;
    let m;
    while ((m = pattern.re.exec(text))) {
      const name = m[2] || m[1];
      if (!name || name === '\'' || name === '"' || name === '`') continue;
      const fn = enclosing(functions, m.index);
      if (!fn) continue;
      calls.push({
        from: fn.id,
        callee: null,
        kind: 'queue',
        queueName: name,
        line: lineAt(lines, m.index),
        mode: null,
      });
    }
  }

  const prismaRe = /(?:prisma|db)\s*\.\s*([A-Za-z_]\w*)\s*\.\s*(findMany|findUnique|findFirst|findFirstOrThrow|findUniqueOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count)\s*\(/g;
  let m;
  while ((m = prismaRe.exec(text))) {
    const fn = enclosing(functions, m.index);
    if (!fn) continue;
    const op = m[2];
    const access = WRITE_OPS.has(op) ? 'write' : READ_OPS.has(op) ? 'read' : null;
    if (!access) continue;
    const columns = access === 'write'
      ? objectKeys(text, m.index, 'data').concat(objectKeys(text, m.index, 'set'))
      : objectKeys(text, m.index, 'select');
    calls.push({
      from: fn.id,
      callee: null,
      kind: 'data',
      table: m[1],
      op,
      access,
      columns: [...new Set(columns)],
      line: lineAt(lines, m.index),
      mode: null,
    });
  }

  const sqlRes = [
    { re: /\bINSERT\s+INTO\s+[`"']?([A-Za-z_]\w*)[`"']?\s*\(([^)]{0,200})\)/gi, access: 'write', table: 1, cols: 2 },
    { re: /\bUPDATE\s+[`"']?([A-Za-z_]\w*)/gi, access: 'write', table: 1 },
    { re: /\bDELETE\s+FROM\s+[`"']?([A-Za-z_]\w*)/gi, access: 'write', table: 1 },
    { re: /\bSELECT\s+([^;\n]{0,160}?)\s+FROM\s+[`"']?([A-Za-z_]\w*)/gi, access: 'read', table: 2, cols: 1 },
  ];
  for (const spec of sqlRes) {
    spec.re.lastIndex = 0;
    while ((m = spec.re.exec(text))) {
      const fn = enclosing(functions, m.index);
      if (!fn) continue;
      let columns = [];
      if (spec.cols && m[spec.cols] && !m[spec.cols].includes('*')) {
        columns = m[spec.cols].split(',').map((part) => {
          const bit = part.trim().split(/\s+/).pop() || '';
          return bit.replace(/.*\./, '').replace(/[^A-Za-z0-9_]/g, '');
        }).filter((name) => name && !/^(select|from|where|and|or)$/i.test(name)).slice(0, 8);
      }
      calls.push({
        from: fn.id,
        callee: null,
        kind: 'data',
        table: m[spec.table],
        op: spec.access === 'write' ? 'sql-write' : 'sql-read',
        access: spec.access,
        columns,
        line: lineAt(lines, m.index),
        mode: null,
      });
    }
  }

  const routeBinds = [];
  const routeRe = /\b(?:router|app|server)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:async\s+)?([A-Za-z_$][\w$]*)/gi;
  while ((m = routeRe.exec(text))) {
    routeBinds.push({ verb: m[1].toUpperCase(), url: m[2], handler: m[3] });
  }
  decorateEntries(file, text, functions, routeBinds);

  for (const fn of functions) {
    const body = masked.slice(fn.start, fn.end + 1);
    const ranges = modeRanges(body, text.slice(fn.start, fn.end + 1));
    const occupied = [];
    const memberRe = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let cm;
    while ((cm = memberRe.exec(body))) {
      occupied.push([cm.index, memberRe.lastIndex]);
      const obj = cm[1];
      const method = cm[2];
      if (SKIP_CALLS.has(method)) continue;
      if (obj === 'prisma' || obj === 'db') continue;
      const rel = fn.start + cm.index;
      const mode = modeAt(ranges, cm.index);
      if (obj === 'this' && fn.className) {
        calls.push({
          from: fn.id,
          callee: method,
          kind: 'call',
          localClass: fn.className,
          line: lineAt(lines, rel),
          mode,
        });
        continue;
      }
      const imported = imports.get(obj);
      if (imported?.namespace) {
        calls.push({
          from: fn.id,
          callee: method,
          kind: 'call',
          importSpec: imported.spec,
          importName: method,
          line: lineAt(lines, rel),
          mode,
        });
      }
    }
    const callRe = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    while ((cm = callRe.exec(body))) {
      const name = cm[1];
      if (SKIP_CALLS.has(name)) continue;
      const at = cm.index;
      if (occupied.some(([a, b]) => at >= a && at < b)) continue;
      const imported = imports.get(name);
      calls.push({
        from: fn.id,
        callee: imported?.imported && imported.imported !== '*' ? imported.imported : name,
        localName: name,
        kind: 'call',
        importSpec: imported?.spec || null,
        importName: imported?.imported || null,
        line: lineAt(lines, fn.start + at),
        mode: modeAt(ranges, at),
      });
    }
  }

  for (const fn of functions) {
    fn.bodyNorm = normalizeBody(fn.body);
    delete fn.start;
    delete fn.end;
  }
  return { file, functions, calls, imports };
}

export function resolveRelative(fromFile, spec, fileSet) {
  if (!spec || (!spec.startsWith('.') && !spec.startsWith('/'))) return null;
  const dir = path.posix.dirname(fromFile);
  const base = spec.startsWith('/')
    ? spec.slice(1)
    : path.posix.normalize(path.posix.join(dir, spec));
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  for (const ext of exts) {
    if (!ext && fileSet.has(base)) return base;
    if (ext && fileSet.has(base + ext)) return base + ext;
    const index = path.posix.join(base, `index${ext}`);
    if (ext && fileSet.has(index)) return index;
  }
  return null;
}

/**
 * Parse modules and resolve direct calls to function ids.
 * Queue and data calls stay unresolved so flow matching can own them.
 * @param {Array<{file: string, source: string}>} modules
 */
export function analyzeModules(modules, options = {}) {
  const parsed = (modules || []).filter((m) => m?.file).map((m) => extractModule(m.file, m.source || '', options));
  const fileSet = new Set(parsed.map((m) => m.file));
  const byId = new Map();
  const byFile = new Map();
  for (const mod of parsed) {
    const names = new Map();
    for (const fn of mod.functions) {
      byId.set(fn.id, fn);
      names.set(fn.className ? `${fn.className}.${fn.name}` : fn.name, fn);
      if (!names.has(fn.name)) names.set(fn.name, fn);
    }
    byFile.set(mod.file, names);
  }

  const calls = [];
  for (const mod of parsed) {
    for (const call of mod.calls) {
      if (call.kind !== 'call') {
        calls.push({ ...call, to: null });
        continue;
      }
      let to = null;
      if (call.localClass) {
        to = `${mod.file}#${call.localClass}.${call.callee}`;
        if (!byId.has(to)) to = null;
      } else if (call.importSpec) {
        const target = resolveRelative(mod.file, call.importSpec, fileSet);
        const imported = call.importName && call.importName !== 'default' ? call.importName : call.callee;
        if (target) {
          const hit = byFile.get(target)?.get(imported) || byFile.get(target)?.get(call.callee);
          to = hit?.id || null;
        }
      } else {
        const local = byFile.get(mod.file)?.get(call.localName || call.callee);
        if (local && local.id !== call.from) to = local.id;
      }
      if (!to) continue;
      calls.push({
        from: call.from,
        to,
        callee: call.callee,
        kind: 'call',
        mode: call.mode || null,
        line: call.line,
      });
    }
  }

  const functions = parsed.flatMap((mod) => mod.functions.map((fn) => ({
    id: fn.id,
    file: fn.file,
    name: fn.name,
    kind: fn.kind,
    className: fn.className,
    line: fn.line,
    endLine: fn.endLine,
    exported: !!fn.exported,
    signature: fn.signature,
    doc: fn.doc,
    entryKind: fn.entryKind,
    entryLabel: fn.entryLabel,
    queueName: fn.queueName,
    body: fn.body,
    bodyNorm: fn.bodyNorm,
  })));
  return { functions, calls };
}

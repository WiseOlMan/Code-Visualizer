import React from 'react';


const asset = (_id, fallback) => fallback;

const INK = { bg: '#161826', text: '#e9e9ed', edge: '#75798c', call: '#9184d9', plate: '#161826' };
/** Branch-diff colors — neon green adds / edit rings; red deletions.
 *  Kept out of the folder palette so group greens never read as "added". */
const GIT = { add: '#2EFF7A', edit: '#2EFF7A', del: '#FF4D5E', delDim: '#FF4D5E99' };
const HOP_COLOR = {
  http: '#9184d9',
  call: '#b5abfc',
  'prisma-write': '#2EFF7A',
  'prisma-read': '#6ec8d4',
  'drizzle-write': '#2EFF7A',
  'drizzle-read': '#6ec8d4',
  job: '#c890d4',
};
const HOP_KIND_LABEL = {
  http: 'HTTP',
  call: 'CALL',
  'prisma-write': 'Prisma write',
  'prisma-read': 'Prisma read',
  'drizzle-write': 'DB write',
  'drizzle-read': 'DB read',
  job: 'JOB',
};

function hopKindOf(l) {
  if (!l) return null;
  if (l.kind === 'call') return 'http';
  if (l.kind === 'hop') return l.hop || 'call';
  return null;
}
function hopColor(l) {
  return HOP_COLOR[hopKindOf(l)] || INK.edge;
}
function hopLabelOf(l) {
  if (l?.kind === 'call') {
    const url = (l.urls && l.urls[0]) || l.label || '/';
    return url.startsWith('HTTP') ? url : `HTTP ${url}`;
  }
  if (l?.label) return l.label;
  return '';
}
function hopKeyOf(l) {
  if (!l) return null;
  return l._key || `${l.kind}|${l.s?.id || ''}=>${l.t?.id || ''}|${hopLabelOf(l)}`;
}
function linkCurve(l) {
  const end = l.t.isEndpoint ? socketPort(l.t, l.s.x, l.s.y) : { x: l.t.x, y: l.t.y };
  const start = l.s.isEndpoint ? socketPort(l.s, l.t.x, l.t.y) : { x: l.s.x, y: l.s.y };
  const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
  const dx = end.x - start.x, dy = end.y - start.y;
  const typed = hopKindOf(l);
  const bow = typed ? 0.045 : 0.09;
  return { start, end, cx: mx - dy * bow, cy: my + dx * bow };
}
function bezierAt(start, c, end, t) {
  const u = 1 - t;
  return {
    x: u * u * start.x + 2 * u * t * c.x + t * t * end.x,
    y: u * u * start.y + 2 * u * t * c.y + t * t * end.y,
  };
}
function distToCurve(p, start, c, end) {
  let best = 1e9;
  for (let i = 0; i <= 20; i++) {
    const q = bezierAt(start, c, end, i / 20);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function normGitStatus(status) {
  const s = String(status || '').toUpperCase().slice(0, 1);
  if (s === 'A' || s === '?' || s === 'C') return 'A';
  if (s === 'D') return 'D';
  if (s === 'M' || s === 'R' || s === 'T' || s === 'U') return 'M';
  return s ? 'M' : null;
}

/** Folder fills when branch colors are on — mute so only git A/M/D pop. */
function muteFolderColor(c) {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(String(c || ''));
  if (m) return `oklch(${(+m[1] * 0.52).toFixed(3)} ${(+m[2] * 0.12).toFixed(3)} ${m[3]})`;
  return '#3a3d4c';
}

/* ---------- grouping: derived from the repo's own folder tree ---------- */
// Nothing here is repo-specific — drop any codebase in and the palette
// reorganises around whatever top-level structure it actually has.
const MAX_GROUPS = 11;
// Hues deliberately skip ~120–160 (lime/green) reserved for git adds/edits.
const GROUP_HUES = [220, 255, 290, 325, 15, 40, 55, 195, 245, 340, 75];
function deriveGroups(ids) {
  const count = {};
  const keyOf = id => {
    const parts = id.split('/');
    if (parts.length <= 2) return parts[0] || '(root)';
    return parts.slice(0, 2).join('/');
  };
  for (const id of ids) count[keyOf(id)] = (count[keyOf(id)] || 0) + 1;
  // fold thin second-level folders back into their parent
  const folded = {};
  for (const k in count) {
    const target = count[k] >= 3 ? k : k.split('/')[0];
    folded[target] = (folded[target] || 0) + count[k];
  }
  const ranked = Object.keys(folded).sort((a, b) => folded[b] - folded[a]).slice(0, MAX_GROUPS);
  const prefixes = ranked.sort((a, b) => b.length - a.length);
  const colors = {};
  ranked.forEach((k, i) => {
    const h = GROUP_HUES[i % GROUP_HUES.length];
    colors[k] = `oklch(0.72 0.11 ${h})`;
  });
  const label = k => k.split('/').pop();
  return {
    of(id) {
      for (const p of prefixes) if (id === p || id.startsWith(p + '/')) return { key: p, label: label(p), color: colors[p] };
      return { key: '(other)', label: 'other', color: '#9397ab' };
    },
    keys: ranked.slice().sort((a, b) => folded[b] - folded[a]),
    label, colorOf: k => colors[k] || '#9397ab',
  };
}

/* ---------- endpoint detection (framework-shaped paths) ---------- */
// Mirrors tools/extract-graph.mjs, and only used when endpoints.json is absent
// or does not mention a file — so a repo with no precomputed endpoint pass
// still shows its routes as sockets.
const ENDPOINT_PATH = [
  /(^|\/)app\/.*\/route\.[jt]sx?$/,
  /(^|\/)pages\/api\//,
  // Controllers are implementation, not HTTP sockets.
  /(^|\/)(routes|handlers|endpoints)\/.+\.[jt]sx?$/,
  /(^|\/)api\/.+\.[jt]sx?$/,
];
const looksLikeEndpoint = id =>
  !/\.(test|spec)\./.test(id) &&
  !/(^|\/)(tests?|__tests__|spec)(\/|$)/.test(id) &&
  !/(^|\/)(backend_client|__generated__|generated|\.openapi-generator|__mocks__|http-mocks|cypress)(\/|$)/.test(id) &&
  ENDPOINT_PATH.some(re => re.test(id));
function urlFromPath(id) {
  if (/\/route\.[jt]sx?$/.test(id)) return '/' + id.replace(/^.*?\bapp\//, '').replace(/\/route\.[jt]sx?$/, '').replace(/\/?\([^/]*\)/g, '');
  if (/(^|\/)pages\/api\//.test(id)) return '/' + id.replace(/^.*?\bpages\//, '').replace(/\.[jt]sx?$/, '').replace(/\/index$/, '');
  if (/(^|\/)api\//.test(id)) return '/' + id.replace(/^.*?\bapi\//, 'api/').replace(/\.[jt]sx?$/, '').replace(/\/index$/, '');
  return '/' + id.replace(/^.*?\b(routes|handlers|endpoints)\//, '').replace(/\.[jt]sx?$/, '');
}

/* ---------- generated / codegen noise ---------- */
function isGenerated(id) {
  return (
    /(^|\/)(\.next|dist|build|coverage|out|storybook-static|__generated__|generated|\.openapi-generator)(\/|$)/.test(id) ||
    /(^|\/)(backend_client|__mocks__|http-mocks)(\/|$)/.test(id) ||
    /\.(generated|gen)\.[jt]sx?$/.test(id)
  );
}

/* ---------- labels ---------- */
const AMBIGUOUS = new Set(['route.ts', 'route.tsx', 'route.js', 'page.tsx', 'page.ts', 'page.jsx', 'layout.tsx', 'index.ts', 'index.tsx', 'index.js', 'types.ts', 'utils.ts', 'client.ts', 'handler.ts', 'controller.ts']);
function displayName(id, endpointUrl) {
  if (endpointUrl) return endpointUrl;
  const parts = id.split('/');
  const file = parts[parts.length - 1];
  if (!AMBIGUOUS.has(file)) return file;
  const base = file.replace(/\.(tsx?|jsx?)$/, '');
  let dirs = parts.slice(0, -1);
  if (base === 'route' || base === 'page' || base === 'layout') {
    if (dirs[0] === 'app' || dirs[0] === 'src' || dirs[0] === 'pages') dirs = dirs.slice(1);
    if (dirs[0] === 'api') dirs = dirs.slice(1);
    const tail = dirs.slice(-3).join('/');
    if (!tail) return base === 'page' ? '/ home' : '/' + base;
    if (base === 'layout') return tail + ' layout';
    return '/' + tail;
  }
  const parent = dirs[dirs.length - 1] || '';
  return parent ? parent + '/' + base : file;
}

function tidy(t) {
  return t.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/,? \)/g, ')').replace(/,\)/g, ')').trim();
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
function extractSignature(src, sym) {
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('export\\s+(?:async\\s+)?(function|const|let|var|interface|type|class)\\s+' + esc + '\\b', 'm');
  const m = re.exec(src);
  if (!m) return null;
  const kind = m[1];
  const after = m.index + m[0].length;

  if (kind === 'function' || kind === 'class') {
    const params = matchBalanced(src, after, '(', ')');
    if (!params) return null;
    const tail = src.slice(src.indexOf(params, after) + params.length);
    const stop = tail.search(/\{|;|\n/);
    const ret = tidy(tail.slice(0, stop < 0 ? 0 : stop));
    return (tidy(params) + (ret ? ' ' + ret : '')).replace(/\) :/g, '):');
  }
  if (kind === 'interface') {
    const body = matchBalanced(src, after, '{', '}');
    const fields = body ? (body.match(/^\s*\w+\??\s*:/gm) || []).length : 0;
    return fields ? 'interface · ' + fields + ' fields' : 'interface';
  }
  const eq = src.indexOf('=', after);
  const nl = src.indexOf('\n', after);
  if (kind === 'type') {
    const val = tidy(src.slice(eq + 1, eq + 220).split(';')[0]);
    return 'type = ' + (val.length > 120 ? val.slice(0, 120) + '…' : val);
  }
  const ann = tidy(src.slice(after, eq > 0 && (nl < 0 || eq < nl) ? eq : nl));
  const rhs = eq > 0 ? src.slice(eq + 1).replace(/^\s+/, '') : '';
  if (/^(async\s*)?\(/.test(rhs) || /^(async\s*)?[\w$]+\s*=>/.test(rhs)) {
    const params = matchBalanced(rhs, 0, '(', ')');
    if (params) return tidy(params) + (ann ? ' ' + ann : '') + ' ⇒';
  }
  if (rhs.startsWith('{')) {
    const body = matchBalanced(rhs, 0, '{', '}');
    const keys = body ? (body.match(/^\s*[\w"'\[\]$]+\s*:/gm) || []).length : 0;
    return (ann || 'object') + (keys ? ' · ' + keys + ' keys' : '');
  }
  if (rhs.startsWith('[')) {
    const body = matchBalanced(rhs, 0, '[', ']');
    const items = body ? body.split(',').length : 0;
    return (ann || 'array') + (items ? ' · ' + items + ' items' : '');
  }
  const val = tidy(rhs.split('\n')[0]).replace(/;$/, '');
  return ann || (val ? '= ' + (val.length > 80 ? val.slice(0, 80) + '…' : val) : 'value');
}

/* ---------- the female-connector glyph ---------- */
// A receptacle: dark cavity behind a coloured shell, with contact slots.
// Drawn in world units so it scales with the view like every other node.
function socketBox(n) {
  const w = Math.max(15, n.r * 2.7), h = Math.max(10, n.r * 1.75);
  return { w, h, x0: n.x - w / 2, y0: n.y - h / 2 };
}
function drawSocket(ctx, n, k, alpha, emphasis, fillOverride, dashed) {
  const shell = fillOverride || n.color;
  const { w, h, x0, y0 } = socketBox(n);
  const r = Math.min(h / 2.4, 4);
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = shell;
  ctx.beginPath(); ctx.roundRect(x0, y0, w, h, r); ctx.fill();

  const inset = Math.max(1.6, h * 0.17);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = INK.bg;
  ctx.beginPath();
  ctx.roundRect(x0 + inset, y0 + inset, w - inset * 2, h - inset * 2, Math.max(1, r - inset * 0.5));
  ctx.fill();

  // contact slots — three of them reads unmistakably as a socket at any size
  const pins = w > 26 ? 3 : 2;
  const pw = Math.max(1.1, w * 0.075), ph = (h - inset * 2) * 0.55;
  ctx.globalAlpha = alpha * 0.95;
  ctx.fillStyle = shell;
  for (let i = 0; i < pins; i++) {
    const cx = x0 + w * ((i + 1) / (pins + 1));
    ctx.beginPath();
    ctx.roundRect(cx - pw / 2, n.y - ph / 2, pw, ph, pw / 2);
    ctx.fill();
  }
  if (emphasis) {
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2 / k;
    ctx.strokeStyle = emphasis;
    if (dashed) ctx.setLineDash([3 / k, 2.5 / k]);
    ctx.beginPath(); ctx.roundRect(x0 - 2, y0 - 2, w + 4, h + 4, r + 2); ctx.stroke();
    if (dashed) ctx.setLineDash([]);
  }
}
// Where a wire should meet the shell, coming from (fx, fy)
function socketPort(n, fx, fy) {
  const { w, h } = socketBox(n);
  const dx = fx - n.x, dy = fy - n.y;
  const s = Math.max(Math.abs(dx) / (w / 2 + 3), Math.abs(dy) / (h / 2 + 3)) || 1;
  return { x: n.x + dx / s, y: n.y + dy / s };
}

/* ---------- collision ---------- */
// Every node has a footprint: circles their radius, sockets their shell box.
// Overlap is resolved as a hard positional correction after the force pass,
// so nothing ever ends up sitting on top of anything else.
const NODE_GAP = 4;
function extents(n) {
  if (!n.isEndpoint) return { hw: n.r, hh: n.r, round: true };
  const b = socketBox(n);
  return { hw: b.w / 2, hh: b.h / 2, round: false };
}
function separateNodes(ns, iterations) {
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < ns.length; i++) {
      const a = ns[i], ea = extents(a);
      for (let j = i + 1; j < ns.length; j++) {
        const b = ns[j], eb = extents(b);
        let dx = b.x - a.x, dy = b.y - a.y;
        let px, py;
        if (ea.round && eb.round) {
          const need = ea.hw + eb.hw + NODE_GAP;
          const d2 = dx * dx + dy * dy;
          if (d2 >= need * need) continue;
          const d = Math.sqrt(d2) || 0.01;
          if (d < 0.02) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
          const push = (need - d) / 2;
          px = (dx / d) * push; py = (dy / d) * push;
        } else {
          const ox = ea.hw + eb.hw + NODE_GAP - Math.abs(dx);
          const oy = ea.hh + eb.hh + NODE_GAP - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          if (ox < oy) { px = (dx < 0 ? -ox : ox) / 2; py = 0; }
          else { px = 0; py = (dy < 0 ? -oy : oy) / 2; }
        }
        if (!a.fixed) { a.x -= px; a.y -= py; }
        if (!b.fixed) { b.x += px; b.y += py; }
        if (a.fixed && !b.fixed) { b.x += px; b.y += py; }
        if (b.fixed && !a.fixed) { a.x -= px; a.y -= py; }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

const FOLDER_PAD = 18;
function folderRects(ns) {
  const by = {};
  for (const n of ns) {
    const e = extents(n);
    const r = by[n.gkey] || (by[n.gkey] = { key: n.gkey, label: n.g, color: n.gcolor, n: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    r.n++;
    r.x0 = Math.min(r.x0, n.x - e.hw); r.x1 = Math.max(r.x1, n.x + e.hw);
    r.y0 = Math.min(r.y0, n.y - e.hh); r.y1 = Math.max(r.y1, n.y + e.hh);
  }
  return Object.values(by).map(r => ({
    ...r,
    x0: r.x0 - FOLDER_PAD, y0: r.y0 - FOLDER_PAD - 9,
    x1: r.x1 + FOLDER_PAD, y1: r.y1 + FOLDER_PAD,
  }));
}

export class CodeGraphEngine extends React.Component {
  state = {
    query: '', selId: null, selHopKey: null, code: null, codeDiff: null, sigTick: 0, labelTick: 0, panelTab: 'details',
    folderDepth: 2, hideTests: true, hideGenerated: true,
    showCalls: true, showHops: true, highlightGit: true, onlyGit: false,
    branchInput: '',
    stats: '', repoName: '',
    gitSummary: '', gitStale: false, gitMissing: 0, gitSourcesNewer: 0, gitStaleReason: null, gitFileCount: 0,
  };

  constructor(p) {
    super(p);
    this.canvasRef = React.createRef();
    this.legendRef = React.createRef();
    this.hopCardRef = React.createRef();
    this.view = { x: 0, y: 0, k: 1 };
    this.nodes = []; this.links = []; this.byId = {};
    this.hover = null; this.hoverHop = null; this.drag = null; this.pan = null;
    this.alpha = 1;
    if (p.initialOnlyGit) this.state = { ...this.state, onlyGit: true };
  }

  componentDidMount() {
    const cv = this.canvasRef.current;
    if (cv && window.ResizeObserver) {
      this._ro = new ResizeObserver(() => {
        if (this._paused || this.props.active === false) return;
        const prevW = this.w, prevH = this.h;
        this.resize();
        // Selecting a node reflows the details panel and nudges the canvas by a
        // few pixels — that must not trigger a full-graph refit (it undoes zoom).
        const dw = Math.abs((this.w || 0) - (prevW || 0));
        const dh = Math.abs((this.h || 0) - (prevH || 0));
        if (!prevW || !prevH || dw > 40 || dh > 40) this.queueFit();
        this.kick(0.02);
      });
      this._ro.observe(cv);
    }
    this.drawLegend();
    if (this.props.liveGraph?.graph) {
      this.applyGraph(this.props.liveGraph.graph, this.props.liveGraph.endpoints, { soft: !!this.props.liveGraph.soft });
    } else if (!this.props.skipInitialLoad) {
      this.loadData();
    }
    if (this.props.active !== false) this.resumeEngine();
    else this.pauseEngine();
  }

  pauseEngine() {
    this._paused = true;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (window.__codeGraph === this) window.__codeGraph = null;
  }

  resumeEngine() {
    this._paused = false;
    this._dead = false;
    const prev = window.__codeGraph;
    if (prev && prev !== this) prev.pauseEngine();
    window.__codeGraph = this;
    // Inactive tabs used to be display:none (0×0 canvas). Refit once we have real size.
    requestAnimationFrame(() => {
      if (this._paused || this._dead) return;
      this.resize();
      if (this.nodes?.length) this.queueFit({ all: true });
      this.dirty = true;
      this.kick(0.15);
    });
  }

  loadData() {
    this._src = {};
    this._pending = {};
    this._sigs = {};
    Promise.all([
      fetch('/api/graph').then(r => {
        if (!r.ok) throw new Error('graph missing');
        return r.json();
      }),
      fetch('/api/endpoints').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([g, e]) => this.init(g, e)).catch(err => console.error('[cge] graph load failed', err));
  }

  /** Apply a graph snapshot. soft=true keeps existing node positions while links grow in. */
  applyGraph(d, ep, { soft = false } = {}) {
    if (!d) return;
    if (!soft || !this.nodes?.length || this.state.repoName !== (d.repo || this.state.repoName)) {
      this.init(d, ep || { endpoints: [], calls: [], hops: [] });
      return;
    }
    const prevPos = Object.fromEntries(this.nodes.map(n => [n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy }]));
    this.init(d, ep || { endpoints: [], calls: [], hops: [] });
    for (const n of this.nodes) {
      const p = prevPos[n.id];
      if (!p) continue;
      n.x = p.x; n.y = p.y; n.vx = p.vx * 0.3; n.vy = p.vy * 0.3;
    }
    this._needsFit = false;
    this.kick(0.25);
  }

  componentDidUpdate(prev) {
    if (prev.active !== this.props.active) {
      if (this.props.active === false) this.pauseEngine();
      else this.resumeEngine();
    }
    if (this.props.query !== undefined && this.props.query !== prev.query && this.props.query !== this.state.query) {
      this.setState({ query: this.props.query }, () => this.kick());
    }
    if (this.props.focusToken && this.props.focusToken !== prev.focusToken && this.props.focusNodeId) {
      this.select(this.props.focusNodeId);
    }
    if (prev.sidebarOpen !== this.props.sidebarOpen) {
      this._legendDrawn = false;
      requestAnimationFrame(() => { this.resize(); this.kick(0.02); });
    }
    if (prev.reloadToken !== this.props.reloadToken) {
      this._legendDrawn = false;
      // Live stream updates push graphs via ref; token-only reloads fetch from disk.
      if (!this.props.liveGraph) this.loadData();
    }
    if (this.props.liveGraph && this.props.liveGraph !== prev.liveGraph) {
      const { graph, endpoints, soft } = this.props.liveGraph;
      this.applyGraph(graph, endpoints, { soft: !!soft });
      this.applyGitOverlay(this.props.gitInfo);
    }
    if (this.props.gitInfo !== prev.gitInfo) {
      this.invalidateSourceDiffs();
      this.applyGitOverlay(this.props.gitInfo);
      const sel = this.state.selId && this.byId[this.state.selId];
      if (sel?.gitChanged) {
        this.sourceDiff(sel.id).then((d) => {
          if (this.state.selId === sel.id) this.setState({ codeDiff: d });
        });
      } else if (this.state.codeDiff) {
        this.setState({ codeDiff: null });
      }
    }
    this.drawLegend();
  }

  componentWillUnmount() {
    this.pauseEngine();
    if (this._ro) this._ro.disconnect();
    for (const [ev, fn] of this._winListeners || []) window.removeEventListener(ev, fn);
    this._winListeners = [];
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._dead = true;
  }

  drawLegend() {
    const cv = this.legendRef.current;
    if (!cv || this._legendDrawn) return;
    this._legendDrawn = true;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save(); ctx.scale(2, 2);
    drawSocket(ctx, { x: 13, y: 6.5, r: 5.2, color: INK.call }, 1, 1, null);
    ctx.restore();
  }

  source(id) {
    this._src = this._src || {};
    if (this._src[id] !== undefined) return Promise.resolve(this._src[id]);
    if (this._pending && this._pending[id]) return this._pending[id];
    this._pending = this._pending || {};
    const root = this.props.workspaceRoot;
    let url = '/api/source?path=' + encodeURIComponent(id);
    if (root) url += '&root=' + encodeURIComponent(root);
    this._pending[id] = fetch(url)
      .then(r => (r.ok ? r.text() : null))
      .catch(() => null)
      .then(t => { this._src[id] = t; return t; });
    return this._pending[id];
  }

  sourceDiff(id) {
    this._diff = this._diff || {};
    this._diffPending = this._diffPending || {};
    if (this._diff[id] !== undefined) return Promise.resolve(this._diff[id]);
    if (this._diffPending[id]) return this._diffPending[id];
    const root = this.props.workspaceRoot;
    let url = '/api/source/diff?path=' + encodeURIComponent(id);
    if (root) url += '&root=' + encodeURIComponent(root);
    this._diffPending[id] = fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        const payload = d?.lines?.length ? d : null;
        this._diff[id] = payload;
        delete this._diffPending[id];
        return payload;
      });
    return this._diffPending[id];
  }

  /** Drop cached diffs when the change set moves so Source stays honest. */
  invalidateSourceDiffs() {
    this._diff = {};
    this._diffPending = {};
  }

  sig(fileId, sym) {
    this._sigs = this._sigs || {};
    const key = fileId + '#' + sym;
    if (this._sigs[key] !== undefined) return this._sigs[key];
    const src = (this._src || {})[fileId];
    if (src == null) return '';
    const out = extractSignature(src, sym) || '';
    this._sigs[key] = out;
    return out;
  }

  loadSignatures(node) {
    if (!node) return;
    const ids = new Set([node.id]);
    for (const l of this.links) if (!l.off && l.kind === 'import' && l.s === node) ids.add(l.t.id);
    Promise.all([...ids].map(id => this.source(id))).then(() => {
      if (this.state.selId === node.id) this.setState(st => ({ sigTick: st.sigTick + 1 }));
    });
  }

  neighborsOf(node) {
    const out = [node];
    const seen = new Set([node.id]);
    for (const l of this.activeLinks || this.links) {
      if (l.off) continue;
      const other = l.s === node ? l.t : l.t === node ? l.s : null;
      if (!other || other.off || seen.has(other.id)) continue;
      seen.add(other.id);
      out.push(other);
    }
    return out;
  }

  /** Full import/call neighborhood, ignoring onlyGit/hide filters — used to reveal
   *  connected files when hovering a branch-changed node. */
  graphNeighbors(node) {
    if (!node) return [];
    const out = [];
    const seen = new Set([node.id]);
    const showCalls = this.state.showCalls;
    for (const l of this.links || []) {
      if (l.kind === 'call' && !showCalls) continue;
      if (l.kind === 'hop' && this.state.showHops === false) continue;
      const other = l.s === node ? l.t : l.t === node ? l.s : null;
      if (!other || seen.has(other.id)) continue;
      seen.add(other.id);
      out.push(other);
    }
    return out;
  }

  fitNodes(ns, { pad = 56, maxK = 2.6, minSpan = 80 } = {}) {
    if (!ns?.length || !this.w || !this.h) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) {
      const e = extents(n);
      x0 = Math.min(x0, n.x - e.hw); x1 = Math.max(x1, n.x + e.hw);
      y0 = Math.min(y0, n.y - e.hh); y1 = Math.max(y1, n.y + e.hh);
    }
    // Keep a little air around sparse neighborhoods so a 1–2 node focus doesn't overzoom
    const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
    if (x1 - x0 < minSpan) { x0 = midX - minSpan / 2; x1 = midX + minSpan / 2; }
    if (y1 - y0 < minSpan) { y0 = midY - minSpan / 2; y1 = midY + minSpan / 2; }
    const availW = this.w - pad * 2, availH = this.h - pad * 2;
    const k = Math.min(maxK, Math.max(0.18, Math.min(availW / (x1 - x0 || 1), availH / (y1 - y0 || 1))));
    this.view.k = k;
    this.view.x = pad + (availW - (x1 - x0) * k) / 2 - x0 * k;
    this.view.y = pad + (availH - (y1 - y0) * k) / 2 - y0 * k;
    this.dirty = true;
    this.kick();
  }

  // Frame the selected node and every connected neighbor so hub files
  // (e.g. database.js) keep their full star on screen.
  fitSelection(node) {
    if (!node) return;
    const ns = this.neighborsOf(node);
    // Sparse leaves get a comfortable close-up; dense hubs size to their bbox.
    const minSpan = ns.length <= 3 ? 140 : 80;
    this.fitNodes(ns, { pad: 64, maxK: ns.length <= 3 ? 4 : 2.8, minSpan });
  }

  /** Queue a camera refit. While a node is selected, keep focus on its neighborhood. */
  queueFit({ all = false } = {}) {
    this._forceFitAll = !!all;
    this._needsFit = true;
    this._settle = 0;
    this.kick(0.05);
  }

  applyFit() {
    if (this._forceFitAll) {
      this.fit();
      return;
    }
    const sel = this.state.selId && this.byId[this.state.selId];
    if (sel && !sel.off) this.fitSelection(sel);
    else this.fit();
  }

  select(id) {
    const node = id ? this.byId[id] : null;
    this.resetLabelCycle(node?.id || null);
    // Selecting must win over any in-flight full-graph settle-fit.
    this._forceFitAll = false;
    this._needsFit = false;
    this._settle = 0;
    if (node) this.fitSelection(node);
    const openSource = !!(node && node.gitChanged);
    this.setState({
      selId: id, selHopKey: node ? null : this.state.selHopKey, code: null, codeDiff: null,
      panelTab: openSource ? 'source' : 'details',
    }, () => {
      if (!node || this.state.selId !== node.id) return;
      this._needsFit = false;
      this._forceFitAll = false;
      this.fitSelection(this.byId[node.id] || node);
      // Panel reflow can race a resize; re-assert focus after layout.
      requestAnimationFrame(() => {
        if (this.state.selId !== node.id) return;
        this._needsFit = false;
        this._forceFitAll = false;
        this.fitSelection(this.byId[node.id] || node);
      });
    });
    if (!node) { this.kick(); return; }
    this.source(node.id).then(t => { if (this.state.selId === node.id) this.setState({ code: t }); });
    if (node.gitChanged) {
      this.sourceDiff(node.id).then((d) => {
        if (this.state.selId === node.id) this.setState({ codeDiff: d });
      });
    }
    this.loadSignatures(node);
    this.kick();
  }

  resetLabelCycle(anchorId) {
    this._labelAnchor = anchorId || null;
    this.labelCycleIndex = 0;
  }

  labelRing() {
    const focus = this.hover || (this.state.selId && this.byId[this.state.selId]);
    if (!focus || (focus.off && !focus.gitChanged)) return [];
    // Changed-file focus: cycle through the real graph neighborhood, not just
    // the filtered "changed only" set.
    if (focus.gitChanged) return [focus, ...this.graphNeighbors(focus)];
    return this.neighborsOf(focus);
  }

  labeledNode() {
    const ring = this.labelRing();
    if (!ring.length) return null;
    const focus = ring[0];
    if (this._labelAnchor !== focus.id) this.resetLabelCycle(focus.id);
    const i = ((this.labelCycleIndex || 0) % ring.length + ring.length) % ring.length;
    return ring[i];
  }

  cycleLabel(dir = 1) {
    const ring = this.labelRing();
    if (ring.length < 2) return false;
    this.labelCycleIndex = ((this.labelCycleIndex || 0) + dir + ring.length) % ring.length;
    this.setState((st) => ({ labelTick: (st.labelTick || 0) + 1 }));
    this.kick();
    return true;
  }

  init(d, ep) {
    const cv = this.canvasRef.current; if (!cv) return;
    this.resize();
    const W = this.w || 900, H = this.h || 600;

    const epList = ((ep && ep.endpoints) || []).filter(e => !/(^|\/)controllers\//.test(e.id));
    const calls = (ep && ep.calls) || [];
    const hops = (ep && ep.hops) || [];
    this.endpointById = Object.fromEntries(epList.map(e => [e.id, e]));

    // union of everything referenced anywhere — endpoints and callers the
    // import pass may not have reached still get a node
    const ids = new Set(d.nodes.map(n => n.id));
    for (const e of epList) ids.add(e.id);
    for (const c of calls) { ids.add(c.source); ids.add(c.target); }
    for (const h of hops) { ids.add(h.source); ids.add(h.target); }
    const raw = Object.fromEntries(d.nodes.map(n => [n.id, n]));

    this.groups = deriveGroups([...ids]);
    const callIn = {};
    for (const c of calls) callIn[c.target] = (callIn[c.target] || 0) + 1;

    this.nodes = [...ids].map(id => {
      const base = raw[id] || {
        id, name: id.split('/').pop(), inDeg: 0, outDeg: 0,
        synthetic: /^(prisma|jobs|db)\//.test(id),
      };
      const g = this.groups.of(id);
      const meta = base.synthetic ? null
        : (this.endpointById[id] || (looksLikeEndpoint(id) ? { id, url: urlFromPath(id), methods: [] } : null));
      if (meta && !this.endpointById[id]) this.endpointById[id] = meta;
      const gi = this.groups.keys.indexOf(g.key);
      const a = ((gi < 0 ? this.groups.keys.length : gi) / (this.groups.keys.length + 1)) * Math.PI * 2;
      const weight = (base.inDeg || 0) + (callIn[id] || 0);
      return {
        ...base, g: g.label, gkey: g.key, gcolor: g.color, color: meta ? INK.call : g.color,
        isEndpoint: !!meta, url: meta ? meta.url : null,
        label: displayName(id, meta ? meta.url : null),
        x: W / 2 + Math.cos(a) * Math.min(W, H) * 0.3 + (Math.random() - 0.5) * 110,
        y: H / 2 + Math.sin(a) * Math.min(W, H) * 0.3 + (Math.random() - 0.5) * 110,
        vx: 0, vy: 0, r: 3.5 + Math.sqrt(weight) * 3.2,
      };
    });
    // endpoints keep their folder colour as a tint but read as sockets;
    // give them the accent so the receptacle layer is legible as one system
    this.byId = Object.fromEntries(this.nodes.map(n => [n.id, n]));

    this.links = [
      ...d.links.map(l => ({ ...l, kind: 'import', s: this.byId[l.source], t: this.byId[l.target] })),
      ...calls.map(c => ({
        ...c,
        kind: 'call',
        role: c.role || 'direct',
        via: c.via || null,
        symbols: [],
        s: this.byId[c.source],
        t: this.byId[c.target],
      })),
      ...hops.map(h => ({
        ...h,
        kind: 'hop',
        hop: h.hop,
        label: h.label,
        fields: h.fields || [],
        protected: h.protected || [],
        s: this.byId[h.source],
        t: this.byId[h.target],
        _key: `${h.hop}|${h.source}=>${h.target}|${h.label}`,
      })),
    ].filter(l => l.s && l.t);

    this.applyFilter();
    const gc = {};
    for (const n of this.nodes) gc[n.gkey] = (gc[n.gkey] || 0) + 1;
    this.groupCounts = gc;
    if (!this._bound) { this.bindEvents(cv); this._bound = true; }
    this.queueFit({ all: true });
    const nEp = this.nodes.filter(n => n.isEndpoint).length;
    const nCalls = calls.filter(c => !c.role || c.role === 'direct').length;
    this.setState({
      repoName: (d.repo || 'codebase'),
      selHopKey: null,
      stats: `${this.nodes.length} files · ${d.links.length} imports · ${nEp} endpoints · ${nCalls} calls · ${hops.length} hops`,
    });
    this.applyGitOverlay(this.props.gitInfo);
    this.kick(1);
  }

  applyGitOverlay(gitInfo) {
    const files = gitInfo?.files || [];
    const byStatus = new Map();
    const rank = { A: 3, M: 2, D: 1 };
    for (const f of files) {
      if (!f.graphId) continue;
      const st = normGitStatus(f.status);
      if (!st) continue;
      const prev = byStatus.get(f.graphId);
      if (!prev || (rank[st] || 0) > (rank[prev] || 0)) byStatus.set(f.graphId, st);
    }

    const overlaySig = [...byStatus.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, st]) => `${id}:${st}`).join('|')
      + `|stale:${gitInfo?.stale ? 1 : 0}:${gitInfo?.staleReason || ''}`
      + `|miss:${(gitInfo?.missingFromGraph || []).join(',')}`;
    if (overlaySig === this._gitOverlaySig && this.nodes?.length) {
      // Same change set — refresh banner fields only, don't rebuild nodes/layout.
      const missing = gitInfo?.missingFromGraph?.length || 0;
      this.setState({
        gitStale: !!gitInfo?.stale,
        gitMissing: missing,
        gitSourcesNewer: gitInfo?.sourcesNewer?.length || 0,
        gitStaleReason: gitInfo?.staleReason || null,
      });
      return;
    }
    this._gitOverlaySig = overlaySig;

    // Drop deletion ghosts from a previous overlay before rebuilding.
    if (this._gitGhostIds?.length) {
      const ghosts = new Set(this._gitGhostIds);
      this.nodes = (this.nodes || []).filter((n) => !ghosts.has(n.id));
      this.byId = Object.fromEntries(this.nodes.map((n) => [n.id, n]));
      this._gitGhostIds = [];
    }

    for (const n of this.nodes || []) {
      n.gitStatus = byStatus.get(n.id) || null;
      n.gitChanged = !!n.gitStatus;
      n.gitGhost = false;
    }

    // Deletions still show when the file remains in the last graph; if it's
    // already gone from the graph, inject a ghost node so red "removed" is visible.
    this._gitGhostIds = [];
    if (this.groups && this.nodes) {
      const W = this.w || 900, H = this.h || 600;
      for (const [graphId, st] of byStatus) {
        if (st !== 'D' || this.byId[graphId]) continue;
        const g = this.groups.of(graphId);
        const peers = this.nodes.filter((n) => n.gkey === g.key && !n.gitGhost);
        const anchor = peers[0];
        const ghost = {
          id: graphId,
          name: graphId.split('/').pop(),
          label: graphId.split('/').pop(),
          folder: graphId.includes('/') ? graphId.slice(0, graphId.lastIndexOf('/')) : '',
          g: g.label, gkey: g.key, gcolor: g.color,
          color: GIT.del,
          gitStatus: 'D', gitChanged: true, gitGhost: true,
          inDeg: 0, outDeg: 0, isEndpoint: false, url: null,
          x: (anchor?.x ?? W / 2) + (Math.random() - 0.5) * 40,
          y: (anchor?.y ?? H / 2) + (Math.random() - 0.5) * 40,
          vx: 0, vy: 0, r: 5.5,
        };
        this.nodes.push(ghost);
        this.byId[graphId] = ghost;
        this._gitGhostIds.push(graphId);
      }
    }

    const branches = [...new Set((gitInfo?.packages || []).map((p) => p.branch).filter(Boolean))];
    const bases = [...new Set((gitInfo?.packages || []).map((p) => p.base).filter(Boolean))];
    const missing = gitInfo?.missingFromGraph?.length || 0;
    const sourcesNewer = gitInfo?.sourcesNewer?.length || 0;
    const counts = { A: 0, M: 0, D: 0 };
    for (const st of byStatus.values()) counts[st] = (counts[st] || 0) + 1;
    let gitSummary = '';
    if (branches.length || byStatus.size) {
      const br = branches.length ? branches.join(', ') : 'HEAD';
      const base = bases[0] ? ` vs ${bases[0]}` : '';
      const parts = [];
      if (counts.A) parts.push(`${counts.A} added`);
      if (counts.M) parts.push(`${counts.M} edited`);
      if (counts.D) parts.push(`${counts.D} deleted`);
      gitSummary = `${br}${base} · ${parts.join(' · ') || `${byStatus.size} changed`}`;
      if (missing) gitSummary += ` · ${missing} not in graph`;
    }
    const gitFileCount = byStatus.size;
    const patch = {
      gitSummary,
      gitStale: !!gitInfo?.stale,
      gitMissing: missing,
      gitSourcesNewer: sourcesNewer,
      gitStaleReason: gitInfo?.staleReason || null,
      gitFileCount,
      gitCounts: counts,
    };
    // Auto: colors on when there are edits, off when the diff is empty.
    // Manual toggle pins until the change set clears, then auto resumes.
    if (!gitFileCount) {
      patch.highlightGit = false;
      patch.onlyGit = false;
      this._gitHighlightPinned = null;
    } else if (this._gitHighlightPinned == null) {
      patch.highlightGit = true;
      if (this.props.initialOnlyGit) patch.onlyGit = true;
    } else {
      patch.highlightGit = this._gitHighlightPinned;
    }
    this.setState(patch, () => {
      this.applyFilter();
      if (this.props.initialOnlyGit && gitFileCount && !this._focusedGitOnce) {
        this._focusedGitOnce = true;
        const ns = (this.nodes || []).filter((n) => n.gitChanged && !n.off);
        if (ns.length) this.fitNodes(ns, { pad: 64, maxK: 2.8 });
      }
    });
  }

  applyFilter() {
    const hideTests = this.state.hideTests;
    const hideGenerated = this.state.hideGenerated;
    const showCalls = this.state.showCalls;
    const showHops = this.state.showHops !== false;
    const onlyGit = this.state.onlyGit;
    for (const n of this.nodes) {
      // "Changed only" wins: show every git-touched file (incl. tests) and keep
      // folder cells rebuilt from that set so foldering stays intact.
      if (onlyGit) {
        n.off = !n.gitChanged;
      } else {
        n.off =
          (hideTests && /\.(test|spec)\.[jt]sx?$/.test(n.name || '')) ||
          (hideGenerated && isGenerated(n.id));
      }
    }
    // Typed hops (Prisma, jobs, method calls) should still reach their target
    // when "changed files only" is on — otherwise the write/job disappears.
    if (onlyGit && showHops) {
      for (const l of this.links) {
        if (!hopKindOf(l)) continue;
        if (l.s?.gitChanged && l.t) l.t.off = false;
      }
    }
    for (const l of this.links) {
      let off = l.s.off || l.t.off || (l.kind === 'call' && !showCalls) || (l.kind === 'hop' && !showHops);
      // SDK calls: when generated client is visible, show caller→client→endpoint;
      // when hidden, collapse to the direct caller→endpoint edge.
      if (!off && l.kind === 'call') {
        if (hideGenerated) {
          if (l.role && l.role !== 'direct') off = true;
        } else if (l.role === 'direct' && l.via) {
          off = true;
        }
      }
      if (!off && onlyGit) {
        if (hopKindOf(l)) off = !l.s.gitChanged && !l.t.gitChanged;
        else if (!l.s.gitChanged || !l.t.gitChanged) off = true;
      }
      l.off = off;
    }
    this.cells = null; this.frames = null;
    this.active = this.nodes.filter(n => !n.off);
    this.activeLinks = this.links.filter(l => !l.off);
    this.kick(0.5);
  }

  resize() {
    const cv = this.canvasRef.current; if (!cv) return;
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width || !r.height) return;
    this.w = r.width; this.h = r.height;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    this.ctx = cv.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  fit() {
    const ns = this.active || this.nodes;
    if (!ns.length || !this.w) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) {
      const e = extents(n);
      x0 = Math.min(x0, n.x - e.hw); x1 = Math.max(x1, n.x + e.hw);
      y0 = Math.min(y0, n.y - e.hh); y1 = Math.max(y1, n.y + e.hh);
    }
    if (this.cells) for (const r of [...(this.frames || []), ...Object.values(this.cells)]) {
      x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1);
      y0 = Math.min(y0, r.y0); y1 = Math.max(y1, r.y1);
    }
    const pad = 34;
    const availW = this.w - pad * 2, availH = this.h - pad * 2;
    const k = Math.min(2, Math.max(0.12, Math.min(availW / (x1 - x0 || 1), availH / (y1 - y0 || 1))));
    this.view.k = k;
    this.view.x = pad + (availW - (x1 - x0) * k) / 2 - x0 * k;
    this.view.y = pad + (availH - (y1 - y0) * k) / 2 - y0 * k;
    this.dirty = true;
  }

  toWorld(px, py) { return { x: (px - this.view.x) / this.view.k, y: (py - this.view.y) / this.view.k }; }

  pick(px, py) {
    const p = this.toWorld(px, py), slop = 9 / this.view.k;
    let candidates = this.active || this.nodes;
    // With a selection, only the selected node and its neighbors are interactive.
    const sel = this.state.selId ? this.byId[this.state.selId] : null;
    if (sel && !sel.off) {
      const allowed = new Set(this.neighborsOf(sel).map((n) => n.id));
      candidates = candidates.filter((n) => allowed.has(n.id));
    }
    let best = null, bd = 1e9;
    for (const n of candidates) {
      if (n.isEndpoint) {
        const b = socketBox(n);
        if (p.x > b.x0 - slop && p.x < b.x0 + b.w + slop && p.y > b.y0 - slop && p.y < b.y0 + b.h + slop) {
          const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
          if (d < bd) { bd = d; best = n; }
        }
        continue;
      }
      const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      if (d < bd && d < (n.r + slop) ** 2) { bd = d; best = n; }
    }
    return best;
  }

  pickHop(px, py) {
    if (this.state.showHops === false) return null;
    const p = this.toWorld(px, py);
    const slop = 10 / this.view.k;
    let best = null, bd = slop;
    // Match node picking: with a selection, only incident hops are interactive.
    const sel = this.state.selId ? this.byId[this.state.selId] : null;
    for (const l of this.activeLinks || this.links || []) {
      if (l.off || !hopKindOf(l) || !l.s || !l.t) continue;
      if (sel && !sel.off && l.s !== sel && l.t !== sel) continue;
      const c = linkCurve(l);
      const d = distToCurve(p, c.start, { x: c.cx, y: c.cy }, c.end);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  selectHop(link) {
    const key = link ? hopKeyOf(link) : null;
    if (key === this.state.selHopKey) {
      this.kick();
      return;
    }
    this.setState({ selHopKey: key }, () => this.positionHopCard());
    this.kick();
  }

  worldToScreen(wx, wy) {
    return { x: this.view.x + wx * this.view.k, y: this.view.y + wy * this.view.k };
  }

  bindEvents(cv) {
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onWin = (ev, fn) => { window.addEventListener(ev, fn); (this._winListeners || (this._winListeners = [])).push([ev, fn]); };

    cv.addEventListener('mousedown', e => {
      const [x, y] = pos(e), n = this.pick(x, y);
      if (n) { this.drag = n; n.fixed = true; this.kick(0.3); }
      else if (this.pickHop(x, y)) { this._pressHop = true; }
      else this.pan = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      cv.style.cursor = 'grabbing';
    });
    onWin('keydown', e => {
      if (this._paused || this._dead) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape') {
        if (this.state.selHopKey) {
          e.preventDefault();
          this.selectHop(null);
          return;
        }
        if (this.state.selId) {
          e.preventDefault();
          this.select(null);
          return;
        }
      }
      if (e.key !== 'Tab') return;
      if (!this.labelRing().length) return;
      e.preventDefault();
      this.cycleLabel(e.shiftKey ? -1 : 1);
    });
    onWin('mousemove', e => {
      if (this._paused || this._dead) return;
      const [x, y] = pos(e);
      if (this.drag) {
        const p = this.toWorld(x, y);
        this.drag.x = p.x; this.drag.y = p.y; this.drag.vx = 0; this.drag.vy = 0;
        this.kick(0.35);
      } else if (this.pan) {
        this.view.x = this.pan.vx + (e.clientX - this.pan.x);
        this.view.y = this.pan.vy + (e.clientY - this.pan.y);
        this.kick();
      } else {
        const inside = x >= 0 && y >= 0 && x <= this.w && y <= this.h;
        const h = inside ? this.pick(x, y) : null;
        const hop = !h && inside ? this.pickHop(x, y) : null;
        if (h !== this.hover || hop !== this.hoverHop) {
          this.hover = h;
          this.hoverHop = hop;
          this.resetLabelCycle(h?.id || (this.state.selId || null));
          this.kick();
          cv.style.cursor = (h || hop) ? 'pointer' : 'grab';
        }
      }
    });
    onWin('mouseup', () => {
      if (this._paused || this._dead) return;
      const wasDrag = !!this.drag;
      if (this.drag) { this.drag.fixed = false; this.drag = null; }
      this.pan = null;
      cv.style.cursor = (this.hover || this.hoverHop) ? 'pointer' : 'grab';
      this._pressHop = false;
      // Clicks must not reheat the sim — that kept hubs jiggling after every select.
      if (wasDrag) this.kick(0.08);
      else this.kick();
    });
    cv.addEventListener('click', e => {
      const [x, y] = pos(e);
      const n = this.pick(x, y);
      if (n) {
        this.selectHop(null);
        this.select(n.id);
        return;
      }
      const hop = this.pickHop(x, y);
      if (hop) {
        this.selectHop(hop);
        return;
      }
      this.selectHop(null);
      this.select(null);
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const [x, y] = pos(e);
      const f = Math.exp(-e.deltaY * 0.0016), k = Math.min(4, Math.max(0.1, this.view.k * f));
      const r = k / this.view.k;
      this.view.x = x - (x - this.view.x) * r;
      this.view.y = y - (y - this.view.y) * r;
      this.view.k = k;
      this.kick();
    }, { passive: false });
  }

  kick(heat) {
    if (this._paused || this._dead) return;
    if (heat) this.alpha = Math.max(this.alpha, heat);
    this.dirty = true;
    if (!this._raf) this._raf = requestAnimationFrame(this.tick);
  }

  tick = () => {
    this._raf = null;
    if (this._dead || this._paused) return;
    const moving = this.alpha > 0.008 || this.drag;
    if (moving) {
      let move = 0;
      try { move = this.step() || 0; } catch (err) { console.error('STEP THREW', err); this.alpha = 0; }
      this.alpha *= 0.94;
      this.dirty = true;
      // Freeze once motion is only micro-jitter — keeps zoomed hubs from simmering.
      if (!this.drag && move < 0.22) this.alpha = 0;
    }
    const settled = !(this.alpha > 0.008 || this.drag);
    // While a refit is pending the view tracks the layout every frame and the
    // loop stays alive, so it cannot stop half-framed no matter how the
    // layout settles. Three settled frames in a row release it.
    if (this._needsFit) {
      this.applyFit();
      if (settled) {
        if ((this._settle = (this._settle || 0) + 1) > 2) {
          this._needsFit = false;
          this._forceFitAll = false;
          this._settle = 0;
        }
      } else this._settle = 0;
    }
    if (this.dirty) { this.draw(); this.dirty = false; }
    if (!settled || this._needsFit) this._raf = requestAnimationFrame(this.tick);
  };

  step() {
    const ns = this.active || this.nodes;
    if (!ns.length || !this.w) return;
    // Cool forces with alpha so the graph settles instead of simmering forever.
    const heat = this.drag ? Math.max(this.alpha, 0.35) : this.alpha;

    // Folder cells are always on — forces only run inside the same cell so
    // cross-folder import springs don't mash sibling folders together.
    if (!this.cells) this.buildCells(ns);
    const sameCell = (a, b) => {
      if (a.gkey !== b.gkey) return false;
      if (a.cellKey && b.cellKey) return a.cellKey === b.cellKey;
      return true;
    };

    for (let i = 0; i < ns.length; i++) {
      const a = ns[i];
      for (let j = i + 1; j < ns.length; j++) {
        const b = ns[j];
        if (!sameCell(a, b)) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (i - j) || 0.5; dy = (j - i) || 0.5; d2 = dx * dx + dy * dy; }
        if (d2 > 90000) continue;
        const pad = (a.isEndpoint ? 10 : 0) + (b.isEndpoint ? 10 : 0);
        const f = ((260 + (a.r + b.r + pad) * 22) / d2) * heat;
        const d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
        a.vx -= ux * f; a.vy -= uy * f;
        b.vx += ux * f; b.vy += uy * f;
      }
    }
    for (const l of (this.activeLinks || this.links)) {
      const a = l.s, b = l.t;
      if (!sameCell(a, b)) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const typed = hopKindOf(l);
      const rest = (typed ? 62 : 46) + a.r + b.r;
      const f = (d - rest) * (typed ? 0.017 : 0.022) * heat;
      const ux = dx / d * f, uy = dy / d * f;
      a.vx += ux; a.vy += uy;
      b.vx -= ux; b.vy -= uy;
    }
    for (const n of ns) {
      const cell = this.cells ? this.cells[n.cellKey] : null;
      if (cell) {
        n.vx += (cell.cx - n.x) * 0.04 * heat;
        n.vy += (cell.cy - n.y) * 0.04 * heat;
      }
      if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
      // Heavier damping = more inertia, less perpetual micro-motion.
      n.vx *= 0.58; n.vy *= 0.58;
      if (Math.abs(n.vx) < 0.02) n.vx = 0;
      if (Math.abs(n.vy) < 0.02) n.vy = 0;
      n.x += Math.max(-18, Math.min(18, n.vx));
      n.y += Math.max(-18, Math.min(18, n.vy));
    }

    // Skip expensive overlap repair once the layout is nearly cool.
    const sepIters = heat > 0.25 ? 6 : heat > 0.08 ? 2 : 0;
    if (!this.cells) this.buildCells(ns);
    this.containCells(ns);
    if (sepIters) {
      separateNodes(ns, sepIters);
      this.containCells(ns);
    }

    let move = 0;
    for (const n of ns) {
      const dx = n.x - (n.px || 0), dy = n.y - (n.py || 0);
      move = Math.max(move, Math.abs(dx), Math.abs(dy));
      n.px = n.x; n.py = n.y;
    }
    return move;
  }

  // Folders mode gives every folder a fixed cell, laid out once and then held.
  // Nodes are contained inside their cell, so frames can never overlap and the
  // arrangement cannot drift — the earlier version repacked from live sizes
  // every frame and chased its own tail.
  // folderDepth: 0 = top-level groups only; 1 = one subfolder split (default);
  // 2–3 = keep splitting large cells by the next path segment.
  buildCells(ns) {
    const groups = {};
    for (const n of ns) (groups[n.gkey] = groups[n.gkey] || []).push(n);

    const depthLimit = Math.max(0, Math.min(3, this.state.folderDepth ?? 1));
    const MISC = '\u0000misc';
    const shortLabel = (key) => {
      if (key.endsWith('/\u0000')) return 'top level';
      const parts = key.split('/');
      return parts[parts.length - 1] || key;
    };

    const partition = (prefix, members, depthLeft, isRoot) => {
      const color = members[0].gcolor;
      const label = isRoot ? prefix : shortLabel(prefix);
      const leaf = () => ({ key: prefix, label, nodes: members, color });
      if (depthLeft <= 0 || members.length < 8) return leaf();

      const sub = {};
      for (const n of members) {
        const rest = n.id.startsWith(prefix + '/') ? n.id.slice(prefix.length + 1) : n.id;
        const parts = rest.split('/');
        const key = parts.length > 1 ? parts[0] : MISC;
        (sub[key] = sub[key] || []).push(n);
      }
      const named = Object.keys(sub).filter(k => k !== MISC && sub[k].length >= 2);
      if (named.length < 2) return leaf();

      const kids = [];
      const misc = [];
      for (const k of Object.keys(sub)) {
        if (named.includes(k)) kids.push(partition(prefix + '/' + k, sub[k], depthLeft - 1, false));
        else misc.push(...sub[k]);
      }
      if (misc.length) {
        kids.push({ key: prefix + '/\u0000', label: 'top level', nodes: misc, color: misc[0].gcolor });
      }
      return { key: prefix, label, kids, color };
    };

    const roots = Object.keys(groups).map(gk => partition(gk, groups[gk], depthLimit, true));

    const sizeOf = nodes => {
      let area = 0;
      for (const n of nodes) {
        const e = extents(n);
        area += (e.hw * 2 + NODE_GAP + 6) * (e.hh * 2 + NODE_GAP + 6);
      }
      area *= 2.1;
      const w = Math.max(84, Math.sqrt(area * 1.35));
      return { w, h: Math.max(64, area / w) };
    };

    const shelf = (items, gapX, gapY, aspect) => {
      const total = items.reduce((s2, i) => s2 + (i.w + gapX) * (i.h + gapY), 0);
      const rowW = Math.sqrt(total * aspect) * 1.02;
      let x = 0, y = 0, rowH = 0, maxX = 0;
      for (const i of items) {
        if (x > 0 && x + i.w > rowW) { x = 0; y += rowH + gapY; rowH = 0; }
        i.lx = x; i.ly = y;
        x += i.w + gapX;
        rowH = Math.max(rowH, i.h);
        maxX = Math.max(maxX, x - gapX);
      }
      return { w: maxX, h: y + rowH };
    };

    const PAD = 14, HDR = 15;
    const measure = (node) => {
      if (!node.kids) {
        Object.assign(node, sizeOf(node.nodes));
        return;
      }
      for (const k of node.kids) measure(k);
      node.kids.sort((a, b) => b.h - a.h);
      const ext = shelf(node.kids, 12, 24, 1.5);
      node.w = ext.w + PAD * 2;
      node.h = ext.h + PAD * 2 + HDR;
    };
    for (const r of roots) measure(r);

    roots.sort((a, b) => b.h - a.h);
    const ext = shelf(roots, 22, 44, (this.w || 1200) / (this.h || 800));
    const ox = (this.w || 1200) / 2 - ext.w / 2, oy = (this.h || 800) / 2 - ext.h / 2;

    const cells = {}, frames = [];
    const place = (node, x, y, depth) => {
      if (node.kids) {
        frames.push({
          key: node.key, label: node.label, color: node.color,
          x0: x, y0: y, x1: x + node.w, y1: y + node.h, depth,
        });
        for (const k of node.kids) {
          place(k, x + PAD + k.lx, y + PAD + HDR + k.ly, depth + 1);
        }
        return;
      }
      cells[node.key] = {
        key: node.key, label: node.label, color: node.color, n: node.nodes.length,
        x0: x, y0: y, x1: x + node.w, y1: y + node.h,
        cx: x + node.w / 2, cy: y + node.h / 2, depth,
      };
      for (const n of node.nodes) n.cellKey = node.key;
    };
    for (const r of roots) place(r, ox + r.lx, oy + r.ly, 0);

    this.cells = cells;
    this.frames = frames;
  }

  // keep every node inside its folder's cell
  containCells(ns) {
    const cells = this.cells;
    if (!cells) return;
    const pad = 12;
    for (const n of ns) {
      const c = cells[n.cellKey];
      if (!c) continue;
      const e = extents(n);
      const lo = c.x0 + pad + e.hw, hi = c.x1 - pad - e.hw;
      const to = c.y0 + pad + e.hh, bo = c.y1 - pad - e.hh;
      n.x = hi > lo ? Math.min(hi, Math.max(lo, n.x)) : c.cx;
      n.y = bo > to ? Math.min(bo, Math.max(to, n.y)) : c.cy;
    }
  }

  draw() {
    const ctx = this.ctx; if (!ctx || !this.w) return;
    const { x: vx, y: vy, k } = this.view;
    ctx.save();
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = INK.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.translate(vx, vy); ctx.scale(k, k);

    if (!this.cells) this.buildCells(this.active || this.nodes);
    const rects = [...(this.frames || []), ...Object.values(this.cells || {})];
    this.rects = rects;
    ctx.lineWidth = 1 / k;
    for (const r of rects) {
      const w = r.x1 - r.x0, h = r.y1 - r.y0;
      const d = r.depth || 0;
      const nested = d > 0;
      ctx.globalAlpha = nested ? Math.max(0.04, 0.07 - d * 0.015) : 0.035;
      ctx.fillStyle = r.color;
      ctx.beginPath(); ctx.roundRect(r.x0, r.y0, w, h, nested ? 8 : 12); ctx.fill();
      ctx.globalAlpha = nested ? Math.max(0.22, 0.4 - d * 0.06) : 0.5;
      ctx.strokeStyle = r.color;
      ctx.beginPath(); ctx.roundRect(r.x0, r.y0, w, h, nested ? 8 : 12); ctx.stroke();
    }
    this._frameLabels = rects.map(r => ({
      text: r.label || r.key, color: r.color, nested: (r.depth || 0) > 0,
      x: vx + r.x0 * k, y: vy + r.y0 * k, w: (r.x1 - r.x0) * k,
    }));

    const q = this.state.query.trim().toLowerCase();
    const sel = this.state.selId ? this.byId[this.state.selId] : null;
    // Hover or selection dims to the neighborhood; Tab cycles which title is shown.
    const focus = this.hover || sel;
    // Hovering/selecting a changed file reveals its real connections (even when
    // "changed only" has filtered them out) and labels them.
    const revealGit = !!(focus && focus.gitChanged);
    const revealed = new Set();
    if (revealGit) {
      revealed.add(focus.id);
      for (const n of this.graphNeighbors(focus)) revealed.add(n.id);
    }
    const near = new Set();
    if (focus) {
      for (const n of this.neighborsOf(focus)) near.add(n.id);
      for (const id of revealed) near.add(id);
    }
    const labeled = this.labeledNode();

    const linkList = [];
    const seenLink = new Set();
    for (const l of (this.activeLinks || this.links)) {
      seenLink.add(l);
      linkList.push(l);
    }
    if (revealGit) {
      for (const l of this.links) {
        if (seenLink.has(l)) continue;
        if (l.kind === 'call' && !this.state.showCalls) continue;
        if (l.kind === 'hop' && this.state.showHops === false) continue;
        if (l.s !== focus && l.t !== focus) continue;
        if (!revealed.has(l.s.id) || !revealed.has(l.t.id)) continue;
        linkList.push(l);
      }
    }

    const hopOn = this.state.showHops !== false;
    const selHopKey = this.state.selHopKey;
    const hopLabelLinks = [];
    for (const l of linkList) {
      const typed = hopKindOf(l);
      const isCall = l.kind === 'call';
      const selectedHop = typed && hopKeyOf(l) === selHopKey;
      const hoverHop = typed && l === this.hoverHop;
      const nodeOn = !!(focus && (l.s === focus || l.t === focus));
      const dim = q && !(l.s.id.toLowerCase().includes(q) || l.t.id.toLowerCase().includes(q));
      const c = linkCurve(l);
      if (typed && hopOn) {
        // Quiet until a connected file or this hop is the focus — idle 0.72
        // made every Drizzle/HTTP edge a wall and hid branch colors.
        if (selectedHop || hoverHop) {
          ctx.globalAlpha = 1;
          ctx.lineWidth = (selectedHop ? 3.1 : 2.4) / k;
        } else if (nodeOn) {
          ctx.globalAlpha = 0.92;
          ctx.lineWidth = 2.05 / k;
        } else if (focus || selHopKey) {
          ctx.globalAlpha = 0.07;
          ctx.lineWidth = 0.7 / k;
        } else {
          ctx.globalAlpha = 0.14;
          ctx.lineWidth = 0.75 / k;
        }
        ctx.strokeStyle = hopColor(l);
        ctx.setLineDash(typed === 'http' ? [5 / k * k, 4] : []);
      } else {
        const on = focus ? nodeOn : true;
        ctx.globalAlpha = on ? (focus ? 0.9 : isCall ? 0.34 : hopOn ? 0.12 : 0.26) : 0.05;
        if (dim && !on) ctx.globalAlpha *= 0.3;
        ctx.strokeStyle = isCall ? INK.call : (on && focus ? l.t.color : INK.edge);
        ctx.lineWidth = isCall ? Math.min(2.6, 0.7 + l.weight * 0.3) : Math.min(3.2, 0.55 + l.weight * 0.28);
        ctx.setLineDash(isCall ? [5 / k * k, 4] : []);
      }

      ctx.beginPath();
      ctx.moveTo(c.start.x, c.start.y);
      ctx.quadraticCurveTo(c.cx, c.cy, c.end.x, c.end.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (typed && hopOn && (selectedHop || hoverHop || nodeOn)) {
        hopLabelLinks.push({ l, c, selectedHop });
      }

      if (nodeOn && focus && !typed) {
        const ang = Math.atan2(c.end.y - c.cy, c.end.x - c.cx);
        ctx.fillStyle = ctx.strokeStyle;
        if (isCall) {
          // a plug prong meeting the socket, rather than an arrowhead
          const px = c.end.x - Math.cos(ang) * 1.5, py = c.end.y - Math.sin(ang) * 1.5;
          ctx.lineWidth = 3.4;
          ctx.strokeStyle = INK.call;
          ctx.beginPath();
          ctx.moveTo(px - Math.cos(ang) * 5.5, py - Math.sin(ang) * 5.5);
          ctx.lineTo(px, py);
          ctx.stroke();
        } else {
          const dx = c.end.x - c.start.x, dy = c.end.y - c.start.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const ax = c.end.x - dx / d * (l.t.r + 2), ay = c.end.y - dy / d * (l.t.r + 2);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - Math.cos(ang - 0.4) * 7, ay - Math.sin(ang - 0.4) * 7);
          ctx.lineTo(ax - Math.cos(ang + 0.4) * 7, ay - Math.sin(ang + 0.4) * 7);
          ctx.closePath(); ctx.fill();
        }
      }
    }

    const hopLabelCap = 14;
    const hopRank = (h) => {
      if (h.selectedHop) return 0;
      if (h.l === this.hoverHop) return 1;
      const kind = hopKindOf(h.l);
      if (kind === 'prisma-write' || kind === 'drizzle-write' || kind === 'job') return 2;
      if (kind === 'http' || kind === 'call') return 3;
      return 4;
    };
    const drawHopLabels = hopLabelLinks.length > hopLabelCap
      ? [...hopLabelLinks].sort((a, b) => hopRank(a) - hopRank(b)).slice(0, hopLabelCap)
      : hopLabelLinks;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { l, c, selectedHop } of drawHopLabels) {
      const text = hopLabelOf(l).slice(0, 42);
      if (!text) continue;
      const mid = bezierAt(c.start, { x: c.cx, y: c.cy }, c.end, 0.5);
      const size = Math.max(9, Math.min(12, 10 / k));
      ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const w = ctx.measureText(text).width;
      const padX = 5 / k, padY = 3.5 / k;
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = INK.plate;
      ctx.beginPath();
      ctx.roundRect(mid.x - w / 2 - padX, mid.y - size / 2 - padY, w + padX * 2, size + padY * 2, 3 / k);
      ctx.fill();
      ctx.strokeStyle = selectedHop ? hopColor(l) : hopColor(l);
      ctx.lineWidth = (selectedHop ? 1.6 : 1) / k;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = INK.text;
      ctx.fillText(text, mid.x, mid.y);
      const gitTag = l.s.gitStatus === 'A' ? 'new' : l.s.gitChanged ? 'edited' : '';
      if (gitTag && selectedHop) {
        ctx.font = `${Math.max(8, 9 / k)}px Inter, ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = GIT.add;
        ctx.fillText(gitTag, mid.x, mid.y + size / 2 + 8 / k);
      }
    }
    ctx.textBaseline = 'alphabetic';

    const labels = [];
    const hlGit = this.state.highlightGit;
    const drawNodes = [];
    const seenNode = new Set();
    for (const n of (this.active || this.nodes)) {
      seenNode.add(n.id);
      drawNodes.push(n);
    }
    if (revealGit) {
      for (const id of revealed) {
        if (seenNode.has(id)) continue;
        const n = this.byId[id];
        if (n) drawNodes.push(n);
      }
    }
    for (const n of drawNodes) {
      const match = !q || n.id.toLowerCase().includes(q);
      const on = !focus || near.has(n.id);
      const peek = revealGit && revealed.has(n.id);
      let alpha = (on ? 1 : 0.16) * (match ? 1 : 0.2);
      // With branch colors on, mute unchanged so folder greens never look like adds —
      // unless this neighbor was just revealed by hovering a changed file.
      if (hlGit && !n.gitChanged && !peek) alpha *= 0.28;
      if (hlGit && n.gitStatus === 'D') alpha *= 0.85;
      const folderFill = (hlGit && !n.gitChanged && !peek) ? muteFolderColor(n.color) : n.color;
      if (n.isEndpoint) {
        const gitFill = hlGit && n.gitStatus === 'A' ? GIT.add
          : hlGit && n.gitStatus === 'D' ? GIT.del
          : (hlGit && !n.gitChanged && !peek ? folderFill : null);
        const emph = (n === sel || n === labeled) ? INK.text
          : (hlGit && n.gitStatus === 'M') ? GIT.edit
          : (hlGit && n.gitStatus === 'A') ? '#12c45a'
          : (hlGit && n.gitStatus === 'D') ? '#ff8a95'
          : (peek && !n.gitChanged ? INK.text : null)
          || (q && match && q.length > 1 ? INK.text : null);
        drawSocket(ctx, n, k, alpha, emph, gitFill, hlGit && n.gitStatus === 'D');
      } else {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, 6.2832);
        // Added = neon green fill; deleted = red; edited keep (unmuted) folder color + ring.
        if (hlGit && n.gitStatus === 'A') ctx.fillStyle = GIT.add;
        else if (hlGit && n.gitStatus === 'D') ctx.fillStyle = GIT.del;
        else ctx.fillStyle = folderFill;
        ctx.fill();
        if (n === sel || n === labeled) {
          ctx.lineWidth = 2.5 / k; ctx.strokeStyle = INK.text; ctx.globalAlpha = 0.95; ctx.stroke();
        } else if (peek && !n.gitChanged) {
          ctx.lineWidth = 1.6 / k; ctx.strokeStyle = INK.text; ctx.globalAlpha = 0.85; ctx.stroke();
        } else if (hlGit && n.gitStatus === 'M') {
          // Edited = bright green ring
          ctx.lineWidth = 2.4 / k; ctx.strokeStyle = GIT.edit; ctx.globalAlpha = 1; ctx.stroke();
        } else if (hlGit && n.gitStatus === 'A') {
          ctx.lineWidth = 1.6 / k; ctx.strokeStyle = '#12c45a'; ctx.globalAlpha = 0.95; ctx.stroke();
        } else if (hlGit && n.gitStatus === 'D') {
          ctx.lineWidth = 1.8 / k; ctx.strokeStyle = '#ff8a95'; ctx.globalAlpha = 0.95;
          ctx.setLineDash([3 / k, 2.5 / k]); ctx.stroke(); ctx.setLineDash([]);
        } else if (q && match && q.length > 1) {
          ctx.lineWidth = 1.5 / k; ctx.strokeStyle = INK.text; ctx.globalAlpha = 0.8; ctx.stroke();
        }
      }
      // One neighborhood title at a time (Tab / Shift+Tab cycles). Search hits still collide-cull.
      // Revealed neighbors of a changed file all get names while hovered.
      const primary = labeled && n === labeled;
      const searchHit = q && q.length > 1 && match;
      const gitHit = hlGit && n.gitChanged && (this.state.onlyGit || !q);
      const revealHit = peek && n !== focus;
      if (primary || searchHit || gitHit || revealHit) {
        labels.push({ n, on, primary, searchHit: searchHit || gitHit || revealHit });
      }
    }

    // Draw primary label last so it wins overlaps against search hits
    labels.sort((a, b) => (a.primary === b.primary ? b.n.r - a.n.r : a.primary ? 1 : -1));
    const placed = [];
    ctx.textAlign = 'center';
    for (const L of labels) {
      const n = L.n;
      const size = Math.max(9, Math.min(13, 9.5 + n.r * 0.22)) / k;
      ctx.font = `${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
      const w = ctx.measureText(n.label).width;
      const top = n.isEndpoint ? socketBox(n).y0 : n.y - n.r;
      const y = top - 5 / k;
      const box = { x0: n.x - w / 2 - 3 / k, x1: n.x + w / 2 + 3 / k, y0: y - size, y1: y + 3 / k };
      if (!L.primary) {
        let hit = false;
        for (const p of placed) {
          if (box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0) { hit = true; break; }
        }
        if (hit) continue;
      }
      placed.push(box);
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = INK.plate;
      ctx.beginPath();
      ctx.roundRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 3);
      ctx.fill();
      ctx.globalAlpha = L.on ? 0.94 : 0.15;
      ctx.fillStyle = n.isEndpoint && !L.on ? INK.call : INK.text;
      ctx.fillText(n.label, n.x, y);
    }
    ctx.restore();

    // folder names live in screen space so they stay 10px at any zoom
    if (this._frameLabels) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = '10px Inter, ui-sans-serif, system-ui, sans-serif';
      for (const L of this._frameLabels) {
        ctx.font = `${L.nested ? 9 : 10}px Inter, ui-sans-serif, system-ui, sans-serif`;
        // drop the name rather than let it run over the neighbouring frame
        if (ctx.measureText(L.text).width > L.w + 8) continue;
        ctx.globalAlpha = L.nested ? 0.72 : 0.95;
        ctx.fillStyle = L.color;
        ctx.fillText(L.text, L.x + 1, L.y - 4);
      }
      ctx.restore();
    }
    this.positionHopCard();
  }

  positionHopCard() {
    const el = this.hopCardRef?.current;
    if (!el) return;
    const hopLink = (this.activeLinks || this.links || []).find((l) => hopKeyOf(l) === this.state.selHopKey);
    if (!hopLink || hopLink.off || !hopLink.s || !hopLink.t) return;
    const c = linkCurve(hopLink);
    const mid = bezierAt(c.start, { x: c.cx, y: c.cy }, c.end, 0.5);
    const sc = this.worldToScreen(mid.x, mid.y);
    const x = Math.min((this.w || 800) - 312, Math.max(8, sc.x + 14));
    const y = Math.min((this.h || 600) - 80, Math.max(8, sc.y + 16));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  renderVals() {
    const sel = this.state.selId && this.byId[this.state.selId];
    let selVal = null;
    if (sel) {
      const mk = other => ({ path: other.label, onClick: () => this.select(other.id) });
      // Named imports only — bare/side-effect loads get a quiet note, not a fake symbol.
      const symList = (fileId, l) => (l.symbols || [])
        .map(name => ({ name, sig: this.sig(fileId, name) }));
      const imports = this.links.filter(l => l.kind === 'import' && !l.off);
      const incoming = imports.filter(l => l.t === sel).map(l => ({
        ...mk(l.s), syms: symList(sel.id, l), loadsModule: !!(l.sideEffect && !(l.symbols || []).length),
      }));
      const outgoing = imports.filter(l => l.s === sel).map(l => ({
        ...mk(l.t), syms: symList(l.t.id, l), loadsModule: !!(l.sideEffect && !(l.symbols || []).length),
      }));

      const callLinks = this.links.filter(l => l.kind === 'call' && !l.off);
      const callers = callLinks.filter(l => l.t === sel).map(l => ({
        path: l.s.id, onClick: () => this.select(l.s.id),
        urls: (l.urls || []).map(text => ({ text })),
      }));
      const callsOut = callLinks.filter(l => l.s === sel).map(l => {
        const meta = (this.endpointById || {})[l.t.id] || {};
        return {
          path: l.t.id, url: (l.urls && l.urls[0]) || meta.url || l.t.label,
          methods: (meta.methods || []).join(' '), onClick: () => this.select(l.t.id),
        };
      });

      const bySym = {};
      for (const l of imports) {
        if (l.t !== sel) continue;
        for (const sym of (l.symbols || [])) (bySym[sym] = bySym[sym] || []).push(l.s.label);
      }
      const symbolRows = Object.entries(bySym).sort((a, b) => b[1].length - a[1].length)
        .map(([sym, users]) => ({ sym, sig: this.sig(sel.id, sym), label: users.length === 1 ? users[0] : users.length + ' files' }));

      const meta = (this.endpointById || {})[sel.id];
      const code = this.state.code;
      const codeDiff = this.state.codeDiff;
      const diffLines = codeDiff?.lines || null;
      const addN = diffLines ? diffLines.filter((l) => l.type === 'add').length : 0;
      const delN = diffLines ? diffLines.filter((l) => l.type === 'del').length : 0;
      let codeMeta = '';
      if (diffLines?.length) {
        const bits = [];
        if (addN) bits.push(`+${addN}`);
        if (delN) bits.push(`−${delN}`);
        codeMeta = bits.length ? bits.join(' ') : 'diff';
      } else if (code) {
        codeMeta = code.split('\n').length + ' lines';
      }
      selVal = {
        label: sel.label, path: sel.id, inDeg: incoming.length, outDeg: outgoing.length,
        endpoint: meta ? { url: meta.url, methods: (meta.methods || []).map(name => ({ name })) } : null,
        callers, hasCallers: callers.length > 0, callerCount: callers.length,
        callsOut, hasCallsOut: callsOut.length > 0, callsOutCount: callsOut.length,
        incoming, outgoing, noIncoming: incoming.length === 0, noOutgoing: outgoing.length === 0,
        symbolRows, hasSymbols: symbolRows.length > 0,
        code, codeDiff, diffLines, codeMeta,
        hasCode: !!(diffLines?.length || code),
        gitChanged: !!sel.gitChanged,
        gitStatus: sel.gitStatus || null,
      };
    }
    const counts = this.groupCounts || {};
    const gs = this.groups;
    const ring = this.labelRing();
    const labeled = this.labeledNode();
    const setQuery = (query) => {
      this.setState({ query }, () => this.kick());
      this.props.onQueryChange?.(query);
    };
    let hopCard = null;
    const hopLink = (this.activeLinks || this.links || []).find((l) => hopKeyOf(l) === this.state.selHopKey);
    if (hopLink && !hopLink.off && hopLink.s && hopLink.t) {
      const c = linkCurve(hopLink);
      const mid = bezierAt(c.start, { x: c.cx, y: c.cy }, c.end, 0.5);
      const sc = this.worldToScreen(mid.x, mid.y);
      const kind = hopKindOf(hopLink);
      hopCard = {
        x: Math.min((this.w || 800) - 312, Math.max(8, sc.x + 14)),
        y: Math.min((this.h || 600) - 80, Math.max(8, sc.y + 16)),
        kind,
        kindLabel: HOP_KIND_LABEL[kind] || kind,
        color: hopColor(hopLink),
        label: hopLabelOf(hopLink),
        change: hopLink.s.gitStatus === 'A' ? 'new' : hopLink.s.gitChanged ? 'edited' : null,
        fields: hopLink.fields || [],
        protected: hopLink.protected || [],
        urls: kind === 'http' ? [] : (hopLink.urls || []),
        from: hopLink.s.label,
        to: hopLink.t.label,
      };
    }
    return {
      canvasRef: this.canvasRef,
      legendRef: this.legendRef,
      repoName: this.state.repoName || 'codebase',
      statLine: this.state.stats || 'loading…',
      query: this.state.query,
      sidebarOpen: this.props.sidebarOpen !== false,
      panelTab: this.state.panelTab || 'details',
      setPanelTab: (tab) => this.setState({ panelTab: tab }),
      labelCycleHint: ring.length > 1
        ? `Tab ${((this.labelCycleIndex || 0) % ring.length) + 1}/${ring.length}${labeled ? ` · ${labeled.label}` : ''}`
        : '',
      folderDepth: this.state.folderDepth,
      folderDepthLabel: String(this.state.folderDepth),
      onFolderDepth: e => {
        const folderDepth = Math.max(0, Math.min(3, +e.target.value));
        this.setState({ folderDepth }, () => {
          this.cells = null; this.frames = null;
          this.queueFit({ all: true }); this.kick(1);
        });
      },
      testsLabel: this.state.hideTests ? 'Show tests' : 'Hide tests',
      toggleTests: () => this.setState({ hideTests: !this.state.hideTests }, () => { this.applyFilter(); this.queueFit({ all: true }); }),
      generatedLabel: this.state.hideGenerated ? 'Show generated' : 'Hide generated',
      generatedBorder: this.state.hideGenerated ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
      generatedColor: this.state.hideGenerated ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
      toggleGenerated: () => this.setState({ hideGenerated: !this.state.hideGenerated }, () => { this.applyFilter(); this.queueFit({ all: true }); }),
      callsLabel: this.state.showCalls ? 'API calls on' : 'API calls off',
      callsBorder: this.state.showCalls ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
      callsColor: this.state.showCalls ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
      toggleCalls: () => this.setState({ showCalls: !this.state.showCalls }, () => this.applyFilter()),
      hopsOn: this.state.showHops !== false,
      hopsLabel: this.state.showHops !== false ? 'Typed hops on' : 'Typed hops off',
      hopsBorder: this.state.showHops !== false ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
      hopsColor: this.state.showHops !== false ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
      toggleHops: () => this.setState((st) => ({ showHops: st.showHops === false }), () => {
        if (this.state.showHops === false) this.selectHop(null);
        this.applyFilter();
      }),
      hopCard,
      hopCardRef: this.hopCardRef,
      clearHop: () => this.selectHop(null),
      highlightGit: this.state.highlightGit,
      onlyGit: this.state.onlyGit,
      gitSummary: this.state.gitSummary,
      gitStale: this.state.gitStale,
      gitMissing: this.state.gitMissing,
      gitSourcesNewer: this.state.gitSourcesNewer,
      gitStaleReason: this.state.gitStaleReason,
      gitFileCount: this.state.gitFileCount,
      gitCounts: this.state.gitCounts || { A: 0, M: 0, D: 0 },
      toggleHighlightGit: () => {
        const highlightGit = !this.state.highlightGit;
        this._gitHighlightPinned = highlightGit;
        this.setState({ highlightGit }, () => this.kick());
      },
      toggleOnlyGit: () => this.setState({ onlyGit: !this.state.onlyGit }, () => {
        this.applyFilter();
        this.queueFit({ all: true });
      }),
      focusGit: () => {
        // Hide everything else, keep foldering, then frame the diff.
        this.setState({ onlyGit: true, highlightGit: true }, () => {
          this.applyFilter();
          const ns = (this.nodes || []).filter((n) => n.gitChanged && !n.off);
          if (ns.length) this.fitNodes(ns, { pad: 64, maxK: 2.8 });
          else this.queueFit({ all: true });
          this.kick();
        });
      },
      onReanalyze: this.props.onReanalyze,
      branchInput: this.state.branchInput || '',
      branchBusy: !!this.props.branchBusy,
      branchError: this.props.branchError || '',
      onBranchInput: (e) => this.setState({ branchInput: e.target.value }),
      submitBranch: () => {
        const value = (this.state.branchInput || '').trim();
        if (!value || !this.props.onSwitchBranch) return;
        Promise.resolve(this.props.onSwitchBranch(value)).then((ok) => {
          if (ok) this.setState({ branchInput: '' });
        });
      },
      refit: () => this.queueFit({ all: true }),
      groups: gs ? gs.keys.map(k => ({
        id: k, label: gs.label(k), color: gs.colorOf(k), count: counts[k] || 0,
        bg: this.state.query === k ? 'var(--color-accent-800)' : 'transparent',
        onClick: () => setQuery(this.state.query === k ? '' : k),
      })).filter(g => g.count > 0) : [],
      sel: selVal,
      clearSel: () => this.select(null),
    };
  }
}

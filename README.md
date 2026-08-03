# Code Explorer

Interactive force-graph explorer for JavaScript / TypeScript codebases. Run it locally, point it at any repo (or monorepo shell), and browse imports, folders, and HTTP API edges.

- **Solid edges** — file imports  
- **Dashed edges** — HTTP calls into backend routes  
- **Socket glyphs** — API endpoints  
- **Folders** — always-on layout cells (adjustable subfolder depth)  
- **Tabs** — open multiple repos and switch between them (restored on refresh)  
- **Search** — magnifying glass (top-right of the tab row); this repo by default, or all open repos  
- **Sidebar** — filters + legend; toggle from the panel icon at the top-left of the graph  

Click a node for imports, callers, symbols, and source.

## Quick start

```bash
npm install
npm run dev
```

| Service | URL |
|---|---|
| UI | [http://localhost:5173](http://localhost:5173) |
| API | [http://localhost:8787](http://localhost:8787) |

1. Open the UI  
2. Choose a local folder (or paste a GitHub URL)  
3. Click **Analyze** — the graph streams in as files are parsed  

Use the **+** control (or **Open another repo…**) to analyze another project; each open repo becomes a tab.

## CLI analyze

```bash
npm run analyze -- /path/to/repo
npm run analyze -- /path/to/repo --out data
```

Writes `data/graph.json`, `data/endpoints.json`, and `data/meta.json`. Then run `npm run dev` and reload.

## How analysis works

1. Walks `.js` / `.jsx` / `.ts` / `.tsx` (skips `node_modules`, `.git`, build dirs, etc.)  
2. Streams file nodes into the viewer immediately  
3. Parses imports (ESM + CommonJS bindings) and grows edges  
4. Detects route handlers and HTTP / OpenAPI-client call sites  

For git-submodule shells (e.g. `novela`), it does **not** clone missing packages. It resolves local sibling checkouts when present and skips the rest.

## What it understands

Best on JS/TS apps (Next.js, Vite, Express, etc.):

- Relative imports and common aliases (`@/…`)  
- App Router `route.ts`, Pages API routes, Express `api/` routers  
- `fetch` / `axios` URL literals  
- OpenAPI-generated clients (`api.meCoupleGet`, `backendFetch('…')`) wired through `backend_client` when present  

## Scripts

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | API + Vite UI |
| `npm run analyze -- <path>` | Write graph files under `data/` |
| `npm start` | API only |
| `npm run build` | Production UI build |

## Requirements

- Node.js 18+  
- Local filesystem access to the repos you open  

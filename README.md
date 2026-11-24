# Code Explorer

Interactive force-graph explorer for JavaScript / TypeScript codebases. Browse imports, folders, and HTTP API edges — locally, via `npx`, or from a Cursor cloud agent VM.

- **Solid edges** — file imports  
- **Dashed edges** — HTTP calls into backend routes  
- **Socket glyphs** — API endpoints  
- **Folders** — always-on layout cells (adjustable subfolder depth)  
- **Tabs** — open multiple repos and switch between them (restored on refresh)  
- **Search** — magnifying glass (top-right of the tab row); this repo by default, or all open repos  
- **Sidebar** — filters + legend; toggle from the panel icon at the top-left of the graph  
- **Branch changes** — green fill = added, green ring = edited, red = deleted. The diff uses the open GitHub pull request’s base when this branch has one (so stacked PRs are not compared to `main`), otherwise `main`/`master`/`develop`. Paste a PR URL or `#N` under **Compare to** to pin that PR’s base. “Changed files only” keeps folder layout; Source panel shows line diffs; auto-refreshes when dirty sources change after analyze  
- **Focus** — “Hide the rest” keeps N import hops around the changed files (1 hop) or 2–4 hand-picked seeds (2 hops). Direction is in, out, or both, and edges draw arrowheads. Pin a file to keep it visible; it shows ✅ untouched or ⚠️ touched. Hide tests is on by default. The view is stored in the URL, **Copy focus JSON** repeats it, and `POST /api/focus` returns the same neighborhood for a later screenshot. Clear focus restores the full graph  
- **Flow** — header switch **Graph | Flow** (`?view=flow`). Flow lays changed functions out in call order: numbered steps, file cards, and a click-to-explain panel. Dashed green arrows are new calls, dotted arrows are queue hops (`enqueueJob('name')`), and data arrows link a write to a later read. Deleted functions stay as faded ghosts; a body that matches a removal is tagged moved instead of added. Several entry points use **Flow 1 of N**. More than 12 function boxes or 4 columns opens the changed-function list. Open PRs switch **main | this PR**; merged PRs switch **before | this PR | main now**
- **Switch branch** — paste a branch name to check it out in the current repo, or `owner/repo@branch` / a GitHub tree URL to open that repo (new tab) on that branch  

Click a node for imports, callers, symbols, and source.

## Quick start (this repo)

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

## CLI (any repo, no dependency)

Do **not** add this package to other repos. Run it against the working tree:

```bash
npx -y github:WiseOlMan/Code-Visualizer serve --repo "$PWD"
```

Or, if it is installed globally:

```bash
code-explorer serve --repo "$PWD"
```

That serves the UI and API on one port (default `8787`, or the next free port) and opens the current repo in **Changed files only**. Leave the process running so you can click around — including after taking over a cloud agent desktop.

```text
code-explorer serve [--repo <path>] [--port <n>] [--all-files] [--open] [--base <branch>] [--pr <number|url>]
code-explorer analyze <repo> [--out <dir>]
```

## Cursor cloud agents

Do **not** `npm i -g` — Cursor cloud VMs usually cannot write `/usr/lib/node_modules` (`EACCES`).

**Default (no environment setup):**

```bash
npx -y github:WiseOlMan/Code-Visualizer serve --repo "$PWD"
```

**Warm install** on the cloud environment (not in the product repo):

```bash
git clone --depth 1 https://github.com/WiseOlMan/Code-Visualizer.git "$HOME/code-explorer"
cd "$HOME/code-explorer" && npm ci && npm run build
mkdir -p "$HOME/.local/bin"
ln -sf "$HOME/code-explorer/cli.mjs" "$HOME/.local/bin/code-explorer"
```

Then the agent runs `node "$HOME/code-explorer/cli.mjs" serve --repo "$PWD"` (or `code-explorer serve --repo "$PWD"` if that file is on `PATH`). Screenshot the graph with computer use; leave the server up so you can take over the desktop.

A Cursor plugin skill in this repo tells agents to prefer PATH, then `npx`, and never `npm i -g`.

## Headless screenshots

Cloud agents screenshot the live UI. The canvas stays blank if the shot is taken before the git compare lands. The page publishes one readiness hook for Graph and Flow once the graph data **and** the compare have loaded **and** the active view's layout has settled.

On `#root`:

| Attribute | Meaning |
|---|---|
| `data-graph-ready="true"` | Safe to capture |
| `data-graph-state="loading"` | Still waiting (compare or layout) |
| `data-graph-state="compare-error"` | Compare failed. Banner: `Compare not loaded: <reason>` |
| `data-graph-state="empty"` | Compare returned nothing, or the graph has no files. Banner explains which |
| `data-graph-reason` | Short reason for the banner |

`window.__codeVizReady === true` matches `data-graph-ready`. `window.__codeVizStatus` is `{ ready, state, reason }`.

```bash
code-explorer screenshot --url http://localhost:8787 --out graph.png
```

The command polls the hook (default 45s, `--timeout <ms>`). It writes the PNG only when the page is ready. If the state is `compare-error` or `empty`, or the wait times out, it prints one JSON object on stderr and exits non-zero **without** saving an image:

```json
{"ok":false,"error":"Timed out after 45000ms waiting for data-graph-ready=\"true\"","state":"loading","reason":"waiting for branch diff"}
```

```json
{"ok":false,"error":"Compare not loaded: branch diff failed (500)","state":"compare-error","reason":"branch diff failed (500)"}
```

```json
{"ok":false,"error":"Compare not loaded: compare returned nothing","state":"empty","reason":"compare returned nothing"}
```

A failed compare or an empty graph also paints that same text on the canvas, so a shot taken too early still explains itself. Needs Chrome or Chromium on `PATH` (`CHROME_PATH` overrides).

Install the plugin from this GitHub repo, a team marketplace, or a local symlink:

```bash
ln -s "/path/to/Code Visualizer" ~/.cursor/plugins/local/code-explorer
```

Then reload the Cursor window.

## CLI analyze (write graph files)

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
| `npm run serve` | CLI: UI + API on one port, analyzes `$PWD` |
| `npm run analyze -- <path>` | Write graph files under `data/` |
| `npm start` | API only |
| `npm run build` | Production UI build |

## Requirements

- Node.js 18+  
- Local filesystem access to the repos you open  

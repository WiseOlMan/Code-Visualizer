# Code Explorer CLI + Plugin Implementation Plan

> **For agentic workers:** Inline execution in this session. User asked to build immediately; do not wait for an execution-mode choice. Do not commit unless the user asks.

**Goal:** Agents and humans can run `code-explorer serve` against any working tree, with a Cursor skill that prefers a global binary and falls back to `npx`.

**Architecture:** A `cli.mjs` bin sets env (`CODE_EXPLORER_REPO`, `CODE_EXPLORER_DATA`, `CODE_EXPLORER_SERVE_UI`, `CODE_EXPLORER_CHANGED_ONLY`) then loads the existing Express server. The server optionally serves `client/dist` and exposes `/api/bootstrap`. The UI auto-opens that repo and focuses branch changes.

**Tech Stack:** Node 18+, Express 5, Vite, existing extract-graph pipeline.

## Global Constraints

- Do not add Code Explorer as a dependency of other product repos.
- Do not change local `npm run dev` (Vite 5173 + API 8787, `data/` under the package).
- Never remove existing comments.
- No git commit unless the user asks.

---

### Task 1: CLI bin + package.json

**Files:**
- Create: `cli.mjs`
- Modify: `package.json`

### Task 2: Server env, static UI, bootstrap

**Files:**
- Modify: `server/index.mjs`
- Modify: `vite.config.js` (explicit `build.outDir`)

### Task 3: UI auto-open + changed-only

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/codeGraphLogic.js`

### Task 4: Cursor plugin skill + README

**Files:**
- Create: `.cursor-plugin/plugin.json`
- Create: `skills/code-explorer/SKILL.md`
- Modify: `README.md`

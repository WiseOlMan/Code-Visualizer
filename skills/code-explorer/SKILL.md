---
name: code-explorer
description: Visualizes JS/TS import graphs and branch-changed files. Use when showing how code changes affect the codebase, attaching a graph screenshot to a PR or chat, or when the user wants to explore imports, callers, or API edges in the working tree.
---

# Code Explorer

Do **not** add this package to the target repo's `package.json`, `.cursor/skills`, or git submodules.

## Start the UI

Do **not** run `npm i -g` — cloud VMs typically cannot write `/usr/lib/node_modules` (`EACCES`).

If `code-explorer` is already on `PATH`, use it. Otherwise use `npx` (no global install):

```bash
if command -v code-explorer >/dev/null 2>&1; then
  code-explorer serve --repo "$PWD"
else
  npx -y github:WiseOlMan/Code-Visualizer serve --repo "$PWD"
fi
```

If this VM already has a clone (for example `$HOME/code-explorer`), skip `npx`:

```bash
node "$HOME/code-explorer/cli.mjs" serve --repo "$PWD"
```

The process prints a `ui` URL (API + viewer on one port). Leave it running. Do **not** use `npm run analyze` + `npm run dev` for cloud screenshots — that is the local two-port workflow.

## Screenshot change impact

1. Open the printed URL.
2. Wait until analyze finishes and the page is ready to capture. Do not shoot while the canvas is still settling:
   - `#root` has `data-graph-ready="true"` (same signal: `window.__codeVizReady === true`).
   - `window.__codeVizStatus` is `{ ready, state, reason }`.
   - If `data-graph-state` is `compare-error` or `empty`, stop. The canvas shows `Compare not loaded: <reason>` or `No files in graph`. Report that text. Do not attach the image.
3. Prefer the waiter. It exits non-zero and writes no file unless the hook is ready:

```bash
code-explorer screenshot --url http://localhost:8787 --out /tmp/code-explorer.png
```

Use the same binary you served with (`node "$HOME/code-explorer/cli.mjs" screenshot …` when that is how you started it). `--timeout <ms>` defaults to 45000.

4. Confirm the sidebar shows **Changed files only** when the branch has edits (branch colors on) and the compare line includes `vs main` (or that repo's base). If the diff is empty, the UI falls back to the full graph and the compare line still names the base.
5. Leave the server up so the user can take over the cloud desktop and click around.

`--all-files` starts on the full graph. Humans can toggle **Changed files only** / **All files** in the sidebar.

## Cloud environment (optional, not per-repo)

Warm install belongs on the **cloud environment**, never in the product repository. Use a user-writable prefix — not `npm i -g`:

```bash
git clone --depth 1 https://github.com/WiseOlMan/Code-Visualizer.git "$HOME/code-explorer"
cd "$HOME/code-explorer" && npm ci && npm run build
mkdir -p "$HOME/.local/bin"
ln -sf "$HOME/code-explorer/cli.mjs" "$HOME/.local/bin/code-explorer"
```

# Code Explorer

Interactive force-graph explorer for JS/TS codebases. A Vite React UI talks to an Express API that parses a repo's imports/HTTP edges and streams a graph. See `README.md` for the full product overview and CLI usage.

## Cursor Cloud specific instructions

- Node 18+ is required; the VM ships Node 22, which works. There is no lockfile-pinned package manager — use `npm` (`package-lock.json`).
- There are no lint or test scripts in `package.json`. The relevant dev commands are `npm run dev`, `npm run build`, and `npm run analyze`; see the `Scripts` table in `README.md`.
- `npm run dev` runs two processes via `concurrently`: the Express API on `http://localhost:8787` (`dev:server`) and the Vite UI on `http://localhost:5173` (`dev:client`). The UI proxies `/api` to the server, so both must be running.
- The server persists analysis output and per-tab snapshots under `data/` (`graph.json`, `endpoints.json`, `workspaces/`, etc.). Most of these are git-ignored; committed `data/graph.json` / `data/endpoints.json` are just sample fixtures and get overwritten when you analyze a repo in dev mode.
- Hello-world / smoke check: with `npm run dev` running, `POST /api/analyze` with JSON body `{"target":"/workspace"}` analyzes a repo, then `GET /api/graph` returns the node/edge graph. In the UI, load `http://localhost:5173`, enter a repo path (e.g. `/workspace`), click Analyze, and the force graph renders; clicking a node opens its details/source panel.
- Do NOT `npm i -g` this package on cloud VMs (`EACCES` on `/usr/lib/node_modules`). To run the single-port CLI against an arbitrary repo, use `node cli.mjs serve --repo "$PWD"` or `npx`; see the "Cursor cloud agents" section of `README.md`.

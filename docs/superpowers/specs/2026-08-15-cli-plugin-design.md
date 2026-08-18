# Code Explorer CLI + Cursor plugin

Ship Code Explorer as a CLI agents and humans can run against any working tree, without adding it to product repos. Cloud VMs get a warm global install; everywhere else falls back to `npx`.

## Product

| Layer | Role |
|---|---|
| CLI `code-explorer serve` | Analyze `$PWD` (or `--repo`), serve UI + API on one port |
| Cursor plugin skill | Teach agents: prefer PATH binary, else `npx` |
| Cloud environment `npm i -g` | Warm install on those VMs (not a per-repo dependency) |

## CLI

```
code-explorer serve [--repo <path>] [--port <n>] [--all-files] [--open]
code-explorer analyze <repo> [--out <dir>]
```

- Default command is `serve`. Default repo is `process.cwd()`.
- First run builds the Vite UI into `client/dist` if missing, then serves it from the API port.
- Graph cache goes to `~/.code-explorer/data` so a global install never writes into the package or the target repo.
- `GET /api/bootstrap` returns `{ repo, changedOnly }` so the UI opens that repo and starts in “Changed files only” (unless `--all-files`).
- Leave the server running so a human can take over the cloud desktop.

## Plugin

This repo is the plugin (`.cursor-plugin/plugin.json` + `skills/code-explorer/SKILL.md`). Install from GitHub, `~/.cursor/plugins/local`, or a team marketplace. The skill must not tell agents to add this package to the target repo.

## Out of scope

Headless PNG without a browser. Cloud computer-use screenshots the live UI.

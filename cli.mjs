#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

function printHelp() {
  console.log(`Code Explorer — interactive JS/TS import graph

Usage:
  code-explorer serve [options]
  code-explorer analyze <repo> [--out <dir>]
  code-explorer --help

serve options:
  --repo <path>     Repository to open (default: current directory)
  --port <n>        Port (default: 8787, or the next free port)
  --all-files       Start showing the full graph, not "Changed files only"
  --open            Open the UI in the default browser

Cloud / npx (do not npm i -g — EACCES on cloud VMs):
  npx -y github:WiseOlMan/Code-Visualizer serve --repo "$PWD"
  node "$HOME/code-explorer/cli.mjs" serve --repo "$PWD"
`);
}

function findPort(preferred) {
  const tryListen = (port) => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => resolve(addr.port));
    });
  });
  return tryListen(preferred).catch(() => tryListen(0));
}

function ensureUiBuild() {
  const index = path.join(ROOT, 'client', 'dist', 'index.html');
  if (fs.existsSync(index)) return;
  console.log('Building UI…');
  const viteJs = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const result = fs.existsSync(viteJs)
    ? spawnSync(process.execPath, [viteJs, 'build'], { cwd: ROOT, stdio: 'inherit' })
    : spawnSync('npx', ['vite', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  if (result.status !== 0) {
    console.error('UI build failed. Run npm install in the Code Explorer package and retry.');
    process.exit(result.status ?? 1);
  }
}

function openBrowser(url) {
  const spec = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  spawnSync(spec[0], spec[1], { stdio: 'ignore' });
}

async function serve(opts) {
  const repo = path.resolve(opts.repo || process.cwd());
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
    console.error(`Not a directory: ${repo}`);
    process.exit(1);
  }
  ensureUiBuild();
  const preferred = Number(opts.port || process.env.PORT || 8787);
  const port = await findPort(Number.isFinite(preferred) && preferred > 0 ? preferred : 8787);
  process.env.PORT = String(port);
  process.env.CODE_EXPLORER_REPO = repo;
  process.env.CODE_EXPLORER_SERVE_UI = '1';
  process.env.CODE_EXPLORER_CHANGED_ONLY = opts.allFiles ? '0' : '1';
  process.env.CODE_EXPLORER_DATA = path.join(os.homedir(), '.code-explorer', 'data');
  const url = `http://localhost:${port}`;
  console.log('Code Explorer');
  console.log(`  repo  ${repo}`);
  console.log(`  ui    ${url}`);
  if (opts.open) openBrowser(url);
  await import(pathToFileURL(path.join(ROOT, 'server', 'index.mjs')).href);
}

function analyze(repoArg, outDir) {
  const repo = path.resolve(repoArg || process.cwd());
  const extract = path.join(ROOT, 'tools', 'extract-graph.mjs');
  const args = [extract, repo];
  if (outDir) args.push('--out', outDir);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h' },
    repo: { type: 'string' },
    port: { type: 'string' },
    'all-files': { type: 'boolean', default: false },
    open: { type: 'boolean', default: false },
    out: { type: 'string' },
  },
  allowPositionals: true,
});

if (values.help) {
  printHelp();
  process.exit(0);
}

const cmd = positionals[0] && !positionals[0].startsWith('-')
  ? positionals[0]
  : 'serve';

if (cmd === 'serve') {
  await serve({
    repo: values.repo || (positionals[0] === 'serve' ? positionals[1] : null),
    port: values.port,
    allFiles: values['all-files'],
    open: values.open,
  });
} else if (cmd === 'analyze') {
  const repo = values.repo || positionals[1] || positionals[0];
  if (!repo || repo === 'analyze') {
    console.error('Usage: code-explorer analyze <repo> [--out <dir>]');
    process.exit(1);
  }
  analyze(repo, values.out);
} else if (cmd === 'help') {
  printHelp();
} else {
  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

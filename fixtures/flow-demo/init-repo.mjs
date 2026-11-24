#!/usr/bin/env node
/**
 * Turn fixtures/flow-demo/{base,head} into a git repo with a main commit and a head commit.
 * Usage: node fixtures/flow-demo/init-repo.mjs [dest]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dest = path.resolve(process.argv[2] || path.join(here, 'repo'));

function git(args) {
  execFileSync('git', args, { cwd: dest, stdio: 'inherit' });
}

function copyTree(from, to) {
  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
copyTree(path.join(here, 'base'), dest);
git(['init', '-b', 'main']);
git(['config', 'user.email', 'flow-demo@example.com']);
git(['config', 'user.name', 'Flow Demo']);
git(['add', '.']);
git(['commit', '-m', 'base']);
git(['checkout', '-b', 'flow-demo']);
for (const name of fs.readdirSync(dest)) {
  if (name === '.git') continue;
  fs.rmSync(path.join(dest, name), { recursive: true, force: true });
}
copyTree(path.join(here, 'head'), dest);
git(['add', '-A']);
git(['commit', '-m', 'head']);
console.log(dest);

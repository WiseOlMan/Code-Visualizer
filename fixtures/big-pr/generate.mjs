#!/usr/bin/env node
/**
 * Synthetic stand-in for a large PR (about 1,500 files, about 50 changed).
 * Usage: node fixtures/big-pr/generate.mjs [dest]
 * Writes a git repo on branch `feature` (base `main`) plus `tests-only`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dest = path.resolve(process.argv[2] || '/tmp/code-explorer-big-pr');
const folders = [
  ['agents', 280],
  ['services', 220],
  ['api', 180],
  ['lib', 200],
  ['controllers', 160],
  ['presenters', 140],
  ['prisma', 120],
  ['tests', 140],
  ['test', 60],
];

function git(args) {
  execFileSync('git', args, { cwd: dest, stdio: 'ignore' });
}

function write(rel, body) {
  const abs = path.join(dest, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
git(['init', '-b', 'main']);
git(['config', 'user.email', 'fixture@example.com']);
git(['config', 'user.name', 'Fixture']);

const files = [];
for (const [folder, count] of folders) {
  const buckets = ['inbound', 'outbound', 'shared', 'internal'];
  for (let i = 0; i < count; i++) {
    const bucket = buckets[i % buckets.length];
    const ext = i % 17 === 0 ? 'mjs' : 'js';
    const rel = `${folder}/${bucket}/file${String(i).padStart(3, '0')}.${ext}`;
    const dep = files.length ? files[Math.max(0, files.length - 3)] : null;
    let importLine = '';
    if (dep) {
      let spec = path.posix.relative(path.posix.dirname(rel), dep);
      if (!spec.startsWith('.')) spec = `./${spec}`;
      importLine = `import { tag as up } from '${spec}';\n`;
    }
    write(rel, `${importLine}export function tag() { return '${rel}'; }\nexport const id = ${i};\n`);
    files.push(rel);
  }
}

write('agents/__tests__/recognize.js', 'export function recognize() { return true; }\n');
write('services/__tests__/summary.js', 'export function summary() { return "summary"; }\n');
write('agents/sender.test.js', 'import { tag } from "./inbound/file000.js";\nexport function sender() { return tag(); }\n');
write('api/routes.spec.js', 'export const routes = ["/forms"];\n');
write('lib/format.test.mjs', 'export const format = (v) => String(v);\n');
write('presenters/card.spec.js', 'export const card = "card";\n');
write('tests/flow.test.js', 'export const flow = 1;\n');
write('test/helper.js', 'export const helper = true;\n');
write('services/nested/plain.js', 'export const plain = 1;\n');

git(['add', '-A']);
git(['commit', '-m', 'base']);

git(['checkout', '-b', 'feature']);
const changed = [];
const sourceFiles = files.filter((rel) => !rel.startsWith('tests/') && !rel.startsWith('test/'));
for (let i = 0; i < 40; i++) {
  const rel = sourceFiles[i * 29 % sourceFiles.length];
  if (changed.includes(rel)) continue;
  fs.appendFileSync(path.join(dest, rel), `\nexport const changed = ${i};\n`);
  changed.push(rel);
}
const testEdits = [
  'agents/__tests__/recognize.js',
  'services/__tests__/summary.js',
  'agents/sender.test.js',
  'api/routes.spec.js',
  'lib/format.test.mjs',
  'presenters/card.spec.js',
  'tests/flow.test.js',
  'test/helper.js',
];
for (const rel of testEdits) {
  fs.appendFileSync(path.join(dest, rel), '\nexport const touched = true;\n');
}
write(
  'agents/formSender.js',
  'import { tag } from "./inbound/file000.js";\nexport function recognizeFormSender() { return tag(); }\n',
);
git(['add', '-A']);
git(['commit', '-m', 'recognize form senders']);

git(['checkout', 'main']);
git(['checkout', '-b', 'tests-only']);
for (const rel of testEdits) {
  fs.appendFileSync(path.join(dest, rel), '\nexport const onlyTests = true;\n');
}
git(['add', '-A']);
git(['commit', '-m', 'test-only edits']);
git(['checkout', 'feature']);

const total = fs.readdirSync(dest, { recursive: true }).filter((rel) => String(rel).endsWith('.js') || String(rel).endsWith('.mjs')).length;
console.log(`fixture ${dest}`);
console.log(`files ${total}`);
console.log(`source edits ${changed.length} plus ${testEdits.length} tests and agents/formSender.js`);

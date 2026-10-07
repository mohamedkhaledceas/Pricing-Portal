/* CLAUDE.md: only src/config/index.js may read process.env, so secrets and
   settings have one home. This keeps it that way for src/ and scripts/. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ALLOWED = path.join('src', 'config', 'index.js');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'views' ? [] : jsFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

test('process.env is read only in src/config/index.js', () => {
  const offenders = ['src', 'scripts'].flatMap((d) => jsFiles(path.join(ROOT, d)))
    .filter((f) => path.relative(ROOT, f) !== ALLOWED)
    .filter((f) => /process\.env\b/.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

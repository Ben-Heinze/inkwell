// Frontend integrity without a browser: the module import graph must resolve,
// every asset must be served, and every API call the UI makes must hit a
// route the server actually registers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, makeClient } from './helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const clientFiles = [...walk(join(ROOT, 'public', 'js')), ...walk(join(ROOT, 'shared'))];

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

test('every frontend import resolves to a real file', () => {
  let checked = 0;
  for (const file of clientFiles) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      let target;
      if (spec.startsWith('./') || spec.startsWith('../')) target = resolve(dirname(file), spec);
      else if (spec.startsWith('/')) target = join(ROOT, spec.startsWith('/shared/') ? '' : 'public', spec);
      else continue; // bare specifiers would be a bug in a no-build app
      assert.ok(existsSync(target), `${file} imports missing module ${spec}`);
      checked++;
    }
  }
  assert.ok(checked >= 15, `only ${checked} imports found — extraction regex may be broken`);
  // and no bare specifiers at all (nothing to npm-install)
  for (const file of clientFiles) {
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+['"]([^'"./][^'"]*)['"]/g)) {
      assert.fail(`${file} uses bare import "${m[1]}" — impossible without a bundler`);
    }
  }
});

test('index.html references assets that exist', () => {
  const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('data:'));
  assert.ok(refs.includes('/app.css'));
  assert.ok(refs.includes('/js/main.js'));
  for (const ref of refs) {
    assert.ok(existsSync(join(ROOT, 'public', ref)), `index.html references missing ${ref}`);
  }
});

test('every frontend module is actually served with the right MIME type', async () => {
  const urls = clientFiles.map((f) =>
    f.includes(`${join(ROOT, 'shared')}`) ? `/shared/${f.split(/[\\/]/).pop()}` : f.slice(join(ROOT, 'public').length).replaceAll('\\', '/'),
  );
  urls.push('/app.css', '/');
  for (const url of urls) {
    const res = await fetch(app.base + url);
    assert.equal(res.status, 200, `${url} not served`);
    const type = res.headers.get('content-type');
    if (url.endsWith('.js')) assert.match(type, /text\/javascript/, `${url}: wrong MIME ${type}`);
  }
});

test('every API call in the UI hits a registered route', async () => {
  const anon = makeClient(app.base);
  const calls = new Map(); // "METHOD path" -> source file
  for (const file of clientFiles) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/api\.(get|post|put|del)\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g)) {
      const method = m[1];
      let path = m[2] ?? m[3] ?? m[4];
      path = path.split('?')[0];
      path = path.replaceAll(/\$\{[^}]*\}/g, path.startsWith('/api/auth/') ? 'login' : '1');
      if (!path.startsWith('/api/')) continue;
      calls.set(`${method} ${path}`, file);
    }
  }
  assert.ok(calls.size >= 12, `only ${calls.size} API calls extracted — regex may be broken`);

  for (const [key, file] of calls) {
    const [method, path] = key.split(' ');
    const res = await anon[method](path);
    // 404 "No such endpoint" means the route doesn't exist server-side; any
    // other response (401, 422, entity-404…) proves the route is registered.
    assert.ok(
      !(res.status === 404 && res.data.error === 'No such endpoint') && res.status !== 405,
      `${file} calls ${key} but the server has no such route (got ${res.status} ${res.data.error ?? ''})`,
    );
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {build} from 'vite';

test('BUG-005495 the real Vite initial graph excludes the password dictionary and stays within its reduced JS budget', async () => {
  const result = await build({root: fileURLToPath(new URL('../', import.meta.url)), logLevel: 'silent', build: {write: false, emptyOutDir: false}});
  const chunks = new Map(result.output.filter(item => item.type === 'chunk').map(chunk => [chunk.fileName, chunk]));
  const initial = new Set();
  function visit(name) {
    if (initial.has(name)) return;
    initial.add(name); const chunk = chunks.get(name); assert.ok(chunk, name);
    chunk.imports.forEach(visit);
  }
  for (const chunk of chunks.values()) if (chunk.isEntry) visit(chunk.fileName);
  const dictionaryChunks = [...chunks.values()].filter(chunk => Object.keys(chunk.modules).some(id => id.includes('/node_modules/zxcvbn/')));
  assert.equal(dictionaryChunks.length, 1, 'the same local strength estimator is still delivered');
  assert.ok(!initial.has(dictionaryChunks[0].fileName), 'a static import/preload would undo the repair');
  assert.ok([...chunks.values()].some(chunk => chunk.dynamicImports.includes(dictionaryChunks[0].fileName)));
  const raw = [...initial].reduce((n, name) => n + Buffer.byteLength(chunks.get(name).code), 0);
  const gzip = [...initial].reduce((n, name) => n + gzipSync(chunks.get(name).code).length, 0);
  assert.ok(raw < 1_200_000, `initial JavaScript ${raw} bytes exceeds the reduced budget`);
  assert.ok(gzip < 330_000, `initial gzip JavaScript ${gzip} bytes exceeds the reduced budget`);
  const html = result.output.find(item => item.fileName === 'index.html').source;
  assert.ok(!html.includes(dictionaryChunks[0].fileName), 'the deferred chunk must not appear in initial HTML preloads');
});

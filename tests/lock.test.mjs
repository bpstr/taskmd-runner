import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lock as legacyLock } from 'proper-lockfile';
import { acquireTaskLock, taskLease, taskRegistryLease } from '../dist/lock.js';

function fixture(t) {
  const tasks = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'taskmd-lock-')));
  for (const scope of ['api/documentation', 'astro', 'astro/list']) fs.mkdirSync(path.join(tasks, scope), { recursive: true });
  t.after(() => fs.rmSync(tasks, { recursive: true, force: true }));
  return tasks;
}
const acquire = (tasks, prefixes = [], compromised = error => { throw error; }) => acquireTaskLock(tasks, compromised, prefixes.map(prefix => path.join(tasks, prefix)));
const registryFile = tasks => path.join(taskLease(tasks), 'owners.json');
function expireOwners(tasks) {
  const registry = JSON.parse(fs.readFileSync(registryFile(tasks), 'utf8'));
  for (const owner of registry.owners) owner.updated = Date.now() - 31_000;
  fs.writeFileSync(registryFile(tasks), JSON.stringify(registry));
}

test('disjoint scopes acquire concurrently and the first release preserves its peer', async t => {
  const tasks = fixture(t);
  const [releaseApi, releaseAstro] = await Promise.all([acquire(tasks, ['api/documentation']), acquire(tasks, ['astro'])]);
  try {
    assert.equal(JSON.parse(fs.readFileSync(registryFile(tasks), 'utf8')).owners.length, 2);
    await releaseApi();
    await assert.rejects(acquire(tasks), /Another runner/);
    await assert.rejects(acquire(tasks, ['astro/list']), /Another runner/);
    const releaseApiAgain = await acquire(tasks, ['api/documentation']); await releaseApiAgain();
  } finally { await releaseApi(); await releaseAstro(); }
  assert.equal(fs.existsSync(taskLease(tasks)), false);
});

test('same-prefix concurrent acquisition admits exactly one owner', async t => {
  const tasks = fixture(t);
  const results = await Promise.allSettled([acquire(tasks, ['astro']), acquire(tasks, ['astro'])]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of results) if (result.status === 'fulfilled') await result.value();
});

test('ancestors, descendants, repeated multi-prefixes and global leases exclude overlaps', async t => {
  const tasks = fixture(t);
  const release = await acquire(tasks, ['astro/list', 'api/documentation', 'astro/list']);
  try {
    for (const prefixes of [[], ['astro'], ['astro/list'], ['api'], ['api/documentation']])
      await assert.rejects(acquire(tasks, prefixes), /Another runner/);
  } finally { await release(); }
  const exclusive = await acquire(tasks);
  try { await assert.rejects(acquire(tasks, ['astro']), /Another runner/); }
  finally { await exclusive(); }
});

test('active legacy root locks block scoped owners without modifying the lease', async t => {
  const tasks = fixture(t);
  const release = await legacyLock(tasks, { lockfilePath: taskLease(tasks), stale: 30_000, update: 10_000, retries: 0 });
  try {
    await assert.rejects(acquire(tasks, ['astro']), /Another runner/);
    assert.deepEqual(fs.readdirSync(taskLease(tasks)), []);
  } finally { await release(); }
});

test('scoped leases also exclude legacy binaries until their last owner releases', async t => {
  const tasks = fixture(t);
  const api = await acquire(tasks, ['api/documentation']); const astro = await acquire(tasks, ['astro']);
  try {
    await api();
    await assert.rejects(legacyLock(tasks, { lockfilePath: taskLease(tasks), stale: 30_000, retries: 0 }), /already being held/);
    // Even a legacy process observing a stale sentinel cannot remove the registry.
    const old = new Date(Date.now() - 31_000); fs.utimesSync(taskLease(tasks), old, old);
    await assert.rejects(legacyLock(tasks, { lockfilePath: taskLease(tasks), stale: 30_000, retries: 0 }), /ENOTEMPTY/);
  } finally { await api(); await astro(); }
});

test('stale scoped owners can be recovered without an old owner deleting its replacement', async t => {
  const tasks = fixture(t);
  const old = await acquire(tasks, ['astro']); expireOwners(tasks);
  const replacement = await acquire(tasks, ['astro']);
  try {
    await old();
    await assert.rejects(acquire(tasks, ['astro']), /Another runner/);
  } finally { await old(); await replacement(); }
});

test('stale empty legacy leases recover while corrupt registries remain intact', async t => {
  const tasks = fixture(t);
  fs.mkdirSync(taskLease(tasks)); const old = new Date(Date.now() - 31_000); fs.utimesSync(taskLease(tasks), old, old);
  const release = await acquire(tasks, ['astro']); await release();
  fs.mkdirSync(taskLease(tasks)); fs.writeFileSync(registryFile(tasks), 'invalid-json');
  await assert.rejects(acquire(tasks, ['astro']), /JSON/);
  assert.equal(fs.readFileSync(registryFile(tasks), 'utf8'), 'invalid-json');
});

test('scope validation rejects symlinks and escapes while permitting absent subtrees', async t => {
  const tasks = fixture(t); fs.symlinkSync(path.join(tasks, 'astro'), path.join(tasks, 'alias'));
  for (const prefix of [tasks, path.join(tasks, 'alias'), path.dirname(tasks)])
    await assert.rejects(acquireTaskLock(tasks, () => {}, [prefix]), /canonical subtree/);
  const release = await acquire(tasks, ['not-created']); await release();
});

test('a symlinked lease directory is preserved and rejected', async t => {
  const tasks = fixture(t);
  fs.symlinkSync(path.join(tasks, 'astro'), taskLease(tasks));
  await assert.rejects(acquire(tasks, ['api/documentation']), /physical directory/);
  assert.equal(fs.lstatSync(taskLease(tasks)).isSymbolicLink(), true);
});

test('a heartbeat retains ownership and a removed owner triggers compromise', async t => {
  const tasks = fixture(t); let compromised;
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.now() });
  const release = await acquire(tasks, ['astro'], error => { compromised = error; });
  try {
    const before = JSON.parse(fs.readFileSync(registryFile(tasks), 'utf8')).owners[0].updated;
    t.mock.timers.tick(10_000);
    for (let i = 0; i < 100 && JSON.parse(fs.readFileSync(registryFile(tasks), 'utf8')).owners[0].updated === before; i++) await new Promise(resolve => setImmediate(resolve));
    const after = JSON.parse(fs.readFileSync(registryFile(tasks), 'utf8')).owners[0].updated;
    assert.ok(after > before);
    for (let i = 0; i < 100 && fs.existsSync(taskRegistryLease(tasks)); i++) await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    fs.writeFileSync(registryFile(tasks), JSON.stringify({ version: 1, owners: [] }));
    t.mock.timers.tick(10_000);
    for (let i = 0; i < 100 && !compromised; i++) await new Promise(resolve => setImmediate(resolve));
    assert.match(compromised?.message ?? '', /lost or expired/);
  } finally { await release(); }
});

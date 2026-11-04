import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { acquireTaskLock } from '../dist/lock.js';
import { taskContext, readTask } from '../dist/task.js';
import { parseArgs } from '../dist/cli.js';
import { Notifications } from '../dist/notifications.js';
import { command } from '../dist/process.js';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fake = path.join(ROOT, 'tests/fake-worker.mjs');
test('version reports installed package metadata without a project or worker', async () => {
  const output = await command(process.execPath, [path.join(ROOT, 'bin/taskmd-runner.js'), '--version'], { cwd: ROOT });
  assert.equal(output.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
});
function fixture(t, config = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskmd-ts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'tasks'));
  fs.writeFileSync(path.join(root, '.taskmd.yaml'), 'dir: tasks\n' + config);
  fs.writeFileSync(path.join(root, 'README.md'), '# Prepared fixture contract\n\nDeliver only the selected fixture.\n');
  return root;
}
function task(root, id, { priority = 'medium', dependencies = [], status = 'pending', directory = '' } = {}) {
  fs.mkdirSync(path.join(root, 'tasks', directory), { recursive: true });
  const file = path.join(root, 'tasks', directory, id + '-task.md');
  fs.writeFileSync(file, '---\n' + stringify({ id, title: 'Task ' + id, status, priority, dependencies }) + '---\n# Task\n\n- [ ] Deliver the fixture\n');
  return file;
}
async function run(root, mode = 'completed', options = [], adapter = false) {
  const args = [path.join(ROOT, 'bin/taskmd-runner.js'), '--project', root, '--notify', 'off', '--timeout', '10', ...options];
  if (adapter) args.push('--executable', fake);
  else args.push('--worker', process.execPath, fake, mode);
  const child = spawn(process.execPath, args, { env: { ...process.env, PREPARED_MODE: mode } });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const final = events.find(event => event.summary);
  return { code, stderr, events, summary: final && JSON.parse(fs.readFileSync(final.summary, 'utf8')) };
}
test('five-round cap preserves strict priority and dependencies', async t => {
  const root = fixture(t); task(root, '001', { priority: 'low' }); task(root, '002', { priority: 'critical', dependencies: ['001'] });
  for (const id of ['003', '004', '005', '006']) task(root, id, { priority: 'high' });
  const r = await run(root, 'completed', ['--rounds', '5']);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'round_limit');
  assert.deepEqual(new Set(r.summary.rounds.slice(0, 4).map(x => x.task_id)), new Set(['003', '004', '005', '006']));
  assert.equal(r.summary.rounds[4].task_id, '001'); assert.equal(r.summary.rounds[0].usage.input_tokens, 10);
});
test('drains work then exits without polling an empty queue', async t => {
  const root = fixture(t); task(root, '001');
  const r = await run(root); assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'empty'); assert.equal(r.summary.rounds.length, 1);
});
test('empty queue never launches worker', async t => {
  const r = await run(fixture(t), 'exit'); assert.equal(r.code, 0, r.stderr); assert.deepEqual(r.summary.rounds, []);
});
test('custom worker help flags remain worker arguments', async t => {
  const root = fixture(t); task(root, '001'); const r = await run(root, '--help');
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'empty');
});
test('blocked task permits independent work and leaves unfinished exit', async t => {
  const root = fixture(t); task(root, '001', { priority: 'critical' }); task(root, '002', { dependencies: ['001'] }); task(root, '003');
  const r = await run(root, 'blocked'); assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
  assert.deepEqual(r.summary.rounds.map(x => x.task_id), ['001', '003']);
});
test('pending without checked progress stops', async t => {
  const root = fixture(t); task(root, '001'); const r = await run(root, 'pending');
  assert.equal(r.code, 2); assert.equal(r.summary.reason, 'no_progress');
});
for (const mode of ['false-completion', 'scope', 'status', 'malformed', 'exit', 'timeout']) {
  test(`${mode} blocks once without retries`, async t => {
    const root = fixture(t); const file = task(root, '001');
    const r = await run(root, mode, mode === 'timeout' ? ['--timeout', '0.1'] : []);
    assert.equal(r.code, 1, r.stderr); assert.equal(r.summary.reason, 'worker_error');
    assert.equal(r.summary.rounds.length, 1); assert.equal(readTask(file).meta.status, 'blocked');
    if (mode === 'scope' || mode === 'status') assert.match(r.summary.rounds[0].error, /changed task scope, metadata or runner-owned status/);
  });
}
test('verified partial slices continue with original acceptance open', async t => {
  const root = fixture(t); const file = task(root, '001'); const r = await run(root, 'partial', ['--rounds', '2']);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.rounds[1].checked_after, 0); assert.equal(r.summary.rounds[1].verified_after, 2);
  assert.match(fs.readFileSync(file, 'utf8'), /- \[ \] Deliver/);
});
test('native worklogs retain worker notes and compact task handoffs', async t => {
  const root = fixture(t, 'worklogs: true\n'); const file = task(root, '001');
  const r = await run(root, 'partial', ['--rounds', '2']); assert.equal(r.code, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(root, 'tasks/.worklogs/001.md'), 'utf8'), /Worker notes:/);
  const text = fs.readFileSync(file, 'utf8'); assert.doesNotMatch(text, /Started round 1/); assert.match(text, /Ticket worklog/);
  assert.equal((await run(root)).summary.reason, 'empty');
});
test('invalid dependency fails before claim', async t => {
  const root = fixture(t); const file = task(root, '001', { dependencies: ['missing'] }); const r = await run(root);
  assert.equal(r.code, 1); assert.equal(r.summary, undefined); assert.equal(readTask(file).meta.status, 'pending');
});
test('rejects a competing Node lease owner', async t => {
  const root = fixture(t); task(root, '001'); const release = await acquireTaskLock(path.join(root, 'tasks'), () => {});
  try { const r = await run(root); assert.equal(r.code, 1); assert.match(r.stderr, /Another runner/); }
  finally { await release(); }
});
test('PR-review ends in review with a linked PR', async t => {
  const root = fixture(t, 'workflow: pr-review\n'); task(root, '001'); const r = await run(root, 'in-review');
  assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.rounds[0].status, 'in-review');
});
test('bounds history without changing the contract or latest next action', t => {
  const root = fixture(t); const file = task(root, '001'); const original = fs.readFileSync(file, 'utf8');
  const history = '\n## Progress\n\nold-audit-marker\n\n' + 'historical receipt\n\n'.repeat(1000) + 'Next: selected PATCH fixture\n';
  fs.writeFileSync(file, original + history); const context = taskContext(file);
  assert.ok(context.startsWith(original.trimEnd())); assert.match(context, /Next: selected PATCH fixture/); assert.doesNotMatch(context, /old-audit-marker/);
  assert.ok(Buffer.byteLength(context) <= Buffer.byteLength(original) + 4200); assert.equal(fs.readFileSync(file, 'utf8'), original + history);
});
for (const client of ['codex', 'claude', 'grok']) {
  test(`published adapter contract: ${client}, three-round cap with prepared process`, async t => {
    const root = fixture(t); for (let n = 1; n <= 4; n++) task(root, String(n).padStart(3, '0'));
    const r = await run(root, 'completed', ['--client', client, '--rounds', '3'], true);
    assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'round_limit'); assert.equal(r.summary.rounds.length, 3);
    assert.ok(r.summary.rounds.every(row => row.status === 'completed' && row.client === client));
    if (client !== 'grok') assert.equal(r.summary.rounds[0].usage.inputTokens, 10);
    if (client === 'codex') {
      const folder = path.dirname(r.events.find(x => x.summary).summary);
      const args = JSON.parse(fs.readFileSync(path.join(folder, '001-001/invocation.json'), 'utf8'));
      assert.ok(args.includes('workspace-write')); assert.ok(args.includes('--output-schema')); assert.ok(args.includes('approval_policy="never"'));
    }
  });
}
test('adapter text receipt fallback works for clients without file controls', async t => {
  const root = fixture(t); task(root, '001');
  const r = await run(root, 'text-only', ['--client', 'grok', '--rounds', '1'], true); assert.equal(r.code, 0, r.stderr);
});
test('notifications deduplicate successful submissions and retain failed evidence', async t => {
  const root = fixture(t); let calls = 0;
  const file = path.join(root, 'notifications.json');
  const alerts = new Notifications({ notify: 'attention', notifyOn: ['runner.turn_limit_reached'] }, file, async () => ++calls === 1 ? 'permission_denied' : 'submitted');
  await alerts.send('runner.blocked', root, '001'); await alerts.send('runner.blocked', root, '001'); await alerts.send('runner.blocked', root, '001');
  assert.equal(calls, 2); await alerts.sendForReason('round_limit', root); assert.equal(calls, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).deliveries.map(x => x.result), ['permission_denied', 'submitted', 'submitted']);
  let disabledCalls = 0;
  const off = new Notifications({ notify: 'off', notifyOn: ['runner.completed'] }, file, async () => { disabledCalls++; return 'submitted'; });
  await off.sendForReason('empty', root);
  assert.equal(disabledCalls, 0);
});
test('SIGTERM blocks the claimed task, reaps the worker and releases the lock', async t => {
  const root = fixture(t); const file = task(root, '001');
  const child = spawn(process.execPath, [path.join(ROOT, 'bin/taskmd-runner.js'), '--project', root, '--notify', 'off', '--worker', process.execPath, fake, 'timeout']);
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const closed = new Promise(resolve => child.once('close', resolve));
  let pidFile;
  try {
    for (let i = 0; i < 100; i++) {
      const state = path.join(root, '.taskmd-runner');
      if (fs.existsSync(state)) for (const run of fs.readdirSync(state)) {
        const candidate = path.join(state, run, '001-001/worker.pid'); if (fs.existsSync(candidate)) pidFile = candidate;
      }
      if (pidFile) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(pidFile, stderr); const workerPid = Number(fs.readFileSync(pidFile, 'utf8'));
    child.kill('SIGTERM'); assert.equal(await closed, 130, stderr);
    assert.throws(() => process.kill(workerPid, 0), /ESRCH/); assert.equal(readTask(file).meta.status, 'blocked');
    const final = stdout.trim().split('\n').map(line => JSON.parse(line)).find(event => event.summary);
    assert.equal(JSON.parse(fs.readFileSync(final.summary)).reason, 'interrupted');
    const release = await acquireTaskLock(path.join(root, 'tasks'), () => {}); await release();
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await closed; } }
});
test('CRLF frontmatter reads like LF frontmatter', t => {
  const root = fixture(t); const file = task(root, '001'); const original = readTask(file);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('\n', '\r\n'));
  assert.deepEqual(readTask(file), original);
});

test('task identifiers retain leading zeros and precision without changing other scalar types', t => {
  const root = fixture(t); const file = task(root, '084');
  fs.writeFileSync(file, '---\nid: 084\ntitle: Prepared identity\nparent: 009\ndependencies: [003, 9223372036854775807]\nweight: 3\nenabled: false\n---\n# Task\n');
  const { meta } = readTask(file);
  assert.equal(meta.id, '084'); assert.equal(meta.parent, '009');
  assert.deepEqual(meta.dependencies, ['003', '9223372036854775807']);
  assert.equal(meta.weight, 3); assert.equal(meta.enabled, false);
});
test('leading-zero identifier survives real taskmd rewrites and native worklog handoff', async t => {
  const root = fixture(t, 'worklogs: true\n'); const file = task(root, '084');
  const r = await run(root, 'completed', ['--rounds', '1']);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.rounds[0].task_id, '084');
  assert.equal(readTask(file).meta.id, '084'); assert.equal(readTask(file).meta.status, 'completed');
  assert.ok(fs.existsSync(path.join(root, 'tasks/.worklogs/084.md')));
});
test('task prefixes select API or Astro while preserving excluded prerequisites', async t => {
  const root = fixture(t);
  const desktop = task(root, '001', { directory: 'desktop', priority: 'critical' });
  task(root, '002', { directory: 'api/documentation', priority: 'high' });
  task(root, '003', { directory: 'astro/detail', priority: 'medium' });
  const mobile = task(root, '004', { directory: 'mobile', priority: 'critical' });
  const dependent = task(root, '005', { directory: 'api/producers', priority: 'critical', dependencies: ['001'] });
  const sibling = task(root, '006', { directory: 'api-other', priority: 'critical' });
  const r = await run(root, 'completed', ['--task-prefix', 'api', '--task-prefix', 'astro', '--rounds', '2']);
  assert.equal(r.code, 0, r.stderr); assert.deepEqual(r.summary.rounds.map(row => row.task_id), ['002', '003']);
  assert.ok(r.summary.rounds.every(row => /^(api|astro)\//.test(row.task_path)));
  for (const file of [desktop, mobile, dependent, sibling]) assert.equal(readTask(file).meta.status, 'pending');
});
test('task prefixes reject a symlink that redirects API scope to Desktop', async t => {
  const root = fixture(t); const file = task(root, '001', { directory: 'desktop', priority: 'critical' });
  fs.symlinkSync(path.join(root, 'tasks/desktop'), path.join(root, 'tasks/api'), 'dir');
  const r = await run(root, 'exit', ['--task-prefix', 'api']);
  assert.equal(r.code, 1); assert.match(r.stderr, /prefix cannot redirect through a symlink/);
  assert.equal(r.summary, undefined); assert.equal(readTask(file).meta.status, 'pending');
});
test('task prefixes distinguish a blocked selection from an empty scoped backlog', async t => {
  const blocked = fixture(t); task(blocked, '001', { directory: 'desktop' });
  task(blocked, '002', { directory: 'api', dependencies: ['001'] });
  const r = await run(blocked, 'exit', ['--task-prefix', 'api', '--task-prefix', 'astro']);
  assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks'); assert.equal(r.summary.rounds.length, 0);
  const empty = fixture(t); task(empty, '001', { directory: 'desktop' });
  task(empty, '002', { directory: 'api', status: 'completed' });
  const drained = await run(empty, 'exit', ['--task-prefix', 'api', '--task-prefix', 'astro']);
  assert.equal(drained.code, 0, drained.stderr); assert.equal(drained.summary.reason, 'empty'); assert.equal(drained.summary.rounds.length, 0);
});
test('taskmd transport preserves UTF-8 characters split across pipe chunks', async () => {
  const text = await command(process.execPath, ['-e', 'const b=Buffer.from("árvíztűrő");process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.end(b.subarray(1)),20)'], { cwd: ROOT });
  assert.equal(text, 'árvíztűrő');
});
test('CLI rejects invalid caps and unsupported client controls before launch', () => {
  for (const args of [['--rounds', '-1'], ['--rounds', 'NaN'], ['--timeout', '0'], ['--client', 'unknown'], ['--notify-on', 'unknown'], ['--worker']]) assert.throws(() => parseArgs(['--project', '/tmp', ...args]));
});

test('Codex defaults to Sol 6.1 medium with explicit overrides and other clients preserved', () => {
  const options = parseArgs(['--project', '/tmp']);
  assert.equal(options.model, 'gpt-6.1-sol'); assert.equal(options.effort, 'medium');
  const overridden = parseArgs(['--project', '/tmp', '--model', 'custom-model', '--effort', 'high']);
  assert.equal(overridden.model, 'custom-model'); assert.equal(overridden.effort, 'high');
  const other = parseArgs(['--project', '/tmp', '--client', 'claude']);
  assert.equal(other.model, undefined); assert.equal(other.effort, undefined);
});
for (const mode of ['missing-docs', 'missing-docs-evidence', 'stale-docs']) {
  test(`documentation guard rejects ${mode} before completion or another claim`, async t => {
    const root = fixture(t); const file = task(root, '001'); task(root, '002');
    if (mode === 'stale-docs') fs.appendFileSync(file, '\n## Progress\n\nDocumentation check: aligned — README.md; old round evidence\n');
    const r = await run(root, mode);
    assert.equal(r.code, 1, r.stderr); assert.equal(r.summary.reason, 'worker_error');
    assert.equal(r.summary.rounds.length, 1); assert.equal(readTask(file).meta.status, 'blocked');
    assert.match(r.summary.rounds[0].error, /Documentation check/);
    assert.equal(readTask(path.join(root, 'tasks/002-task.md')).meta.status, 'pending');
  });
}

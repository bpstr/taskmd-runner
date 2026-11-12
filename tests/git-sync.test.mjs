import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { GitSync } from '../dist/git.js';
import { acquireTaskLock, taskLease } from '../dist/lock.js';
import { readTask, setTaskRuns, taskRuns } from '../dist/task.js';
import { parseArgs } from '../dist/cli.js';
process.env.TASKMD_MONITOR = 'off';
const ROOT = path.resolve(import.meta.dirname, '..');
const WORKER = path.join(ROOT, 'tests/git-worker.mjs');
fs.chmodSync(WORKER, 0o755);
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskmd-git-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
function git(repo, ...args) { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function configure(repo) {
  git(repo, 'config', 'user.name', 'Prepared fixture'); git(repo, 'config', 'user.email', 'fixture@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false'); git(repo, 'config', 'core.hooksPath', path.join(repo, '.git/hooks'));
}
function commit(repo, subject = 'Save prepared fixture') { git(repo, 'add', '-A'); git(repo, 'commit', '--allow-empty', '-m', subject); }
function repository(base, name = 'client') {
  const repo = path.join(base, name), remote = path.join(base, name + '.git'), peer = path.join(base, name + '-peer');
  fs.mkdirSync(repo); git(repo, 'init', '-b', 'main'); configure(repo);
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'baseline\n'); fs.writeFileSync(path.join(repo, 'outside.txt'), 'preserved\n'); commit(repo);
  git(base, 'init', '--bare', '--initial-branch=main', remote); git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-u', 'origin', 'main');
  git(base, 'clone', remote, peer); configure(peer); return { repo, remote, peer };
}
function conflicting(repo, peer) {
  git(peer, 'pull', '--ff-only');
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'local\n'); commit(repo, 'Keep local feature');
  fs.writeFileSync(path.join(peer, 'shared.txt'), 'remote\n'); commit(peer, 'Keep remote feature'); git(peer, 'push');
}
function sync(repo, dir, resolver) { return new GitSync(repo, [], [dir], dir, undefined, resolver); }
function assertSyncWarning(result, phase) {
  const warnings = result.stderr.split('\n').filter(line => line.includes('"event":"git_sync_warning"')).map(line => JSON.parse(line));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].requires_attention, true);
  assert.match(warnings[0].phase, phase);
  assert.equal(result.summary.git_sync.warning.phase, warnings[0].phase);
  assert.equal(result.summary.git_sync.events.filter(event => event.event === 'sync_skipped').length, 1);
}
function tasks(root, count = 1) {
  fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.taskmd.yaml'), 'dir: tasks\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Prepared fixture contract\n\nDeliver only the selected fixture.\n');
  for (let n = 1; n <= count; n++) {
    const id = String(n).padStart(3, '0');
    fs.writeFileSync(path.join(root, 'tasks', `${id}-task.md`), `---\nid: '${id}'\ntitle: Task ${id}\nstatus: pending\npriority: medium\n---\n# Task\n\n- [ ] Deliver the fixture\n`);
  }
}
async function run(root, options = [], env = {}, adapter, upstream = true) {
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'taskmd-git-control-'));
  const args = [path.join(ROOT, 'bin/taskmd-runner.js'), '--project', root, '--notify', 'off', '--timeout', '10', ...(upstream ? ['--git-sync'] : []), ...options];
  if (adapter) args.push('--client', adapter, '--executable', WORKER);
  else args.push('--worker', process.execPath, WORKER);
  const child = spawn(process.execPath, args, { env: { ...process.env, TASKMD_MONITOR: 'off', ...env, TASKMD_RUNNER_CONTROL_DIR: control } });
  let stdout = '', stderr = ''; child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x);
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); })
    .finally(() => fs.rmSync(control, { recursive: true, force: true }));
  const event = stdout.trim().split('\n').filter(Boolean).map(x => JSON.parse(x)).find(x => x.summary);
  return { code, stderr, summary: event && JSON.parse(fs.readFileSync(event.summary)), directory: event && path.dirname(event.summary) };
}
test('Git CLI options require explicit sync and preserve worker argv', () => {
  const args = parseArgs(['--project', '/tmp', '--git-sync', '--git-repo', 'core', '--git-repo', 'tasks', '--git-conflicts', 'worker', '--worker', 'fixture', '--git-sync']);
  assert.deepEqual(args.gitRepo, ['core', 'tasks']); assert.equal(args.gitConflicts, 'worker'); assert.deepEqual(args.worker, ['fixture', '--git-sync']);
  for (const flags of [['--git-repo', 'core'], ['--git-conflicts', 'worker'], ['--git-sync', '--git-conflicts', 'unknown']]) assert.throws(() => parseArgs(['--project', '/tmp', ...flags]));
  const local = parseArgs(['--project', '/tmp', '--git-integration-branch', 'main', '--git-repo', 'core', '--git-conflicts', 'worker']);
  assert.equal(local.gitIntegrationBranch, 'main'); assert.equal(local.gitSync, false);
  assert.equal(local.gitConflicts, 'worker');
  assert.equal(parseArgs(['--project', '/tmp', '--git-sync']).gitConflicts, 'skip');
  assert.throws(() => parseArgs(['--project', '/tmp', '--git-integration-branch', '']), /nonempty/);
});
test('local worktree integration merges main before every task without a remote', async t => {
  const base = temporary(t), { repo } = repository(base);
  tasks(repo, 2); fs.mkdirSync(path.join(repo, 'tasks/api'));
  for (const id of ['001', '002']) fs.renameSync(path.join(repo, `tasks/${id}-task.md`), path.join(repo, `tasks/api/${id}-task.md`));
  fs.writeFileSync(path.join(repo, 'integration.txt'), 'baseline\n'); commit(repo);
  git(repo, 'remote', 'remove', 'origin');
  const lane = path.join(base, 'lane'); git(repo, 'worktree', 'add', '-b', 'lane/api', lane, 'main');
  fs.writeFileSync(path.join(repo, 'integration.txt'), 'before first worker\n'); commit(repo);
  const result = await run(lane, ['--git-integration-branch', 'main', '--task-prefix', 'api'],
    { PREPARED_GIT_LOCAL_INTEGRATION: repo }, undefined, false);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.summary.rounds.length, 2);
  assert.deepEqual(result.summary.rounds.map(row => row.git_sync), ['committed', 'committed']);
  assert.equal(fs.readFileSync(path.join(result.directory, '001-001/integration-seen.txt'), 'utf8'), 'before first worker\n');
  assert.equal(fs.readFileSync(path.join(result.directory, '002-002/integration-seen.txt'), 'utf8'), 'after first worker\n');
  assert.equal(git(lane, 'branch', '--show-current'), 'lane/api');
  git(lane, 'merge-base', '--is-ancestor', 'main', 'HEAD');
  const state = result.summary.git_sync;
  assert.equal(state.upstream_sync, false); assert.equal(state.integration_branch, 'main');
  assert.equal(state.events.filter(event => event.event === 'checkpointed').length, 2);
  assert.equal(state.events.some(event => event.event === 'pushed'), false);
  assert.ok(state.events.some(event => event.event === 'merge' && event.target === 'refs/heads/main' && event.phase === 'integration before round 2'));
  assert.equal(readTask(path.join(repo, 'tasks/api/001-task.md')).meta.status, 'pending');
});
for (const mode of ['missing', 'conflict']) test(`local integration ${mode} warns and allows a local checkpoint`, async t => {
  const base = temporary(t), { repo } = repository(base); tasks(repo); commit(repo);
  git(repo, 'switch', '-c', 'lane/api');
  if (mode === 'conflict') {
    fs.writeFileSync(path.join(repo, 'shared.txt'), 'lane\n'); commit(repo);
    git(repo, 'switch', 'main'); fs.writeFileSync(path.join(repo, 'shared.txt'), 'integration\n'); commit(repo);
    git(repo, 'switch', 'lane/api');
  }
  const result = await run(repo, ['--git-integration-branch', mode === 'missing' ? 'missing' : 'main'], {}, undefined, false);
  assert.equal(result.code, 0, result.stderr);
  assertSyncWarning(result, mode === 'missing' ? /find integration branch/ : /integration before round 1/);
  assert.equal(result.summary.rounds[0].git_sync, 'committed');
  assert.match(git(repo, 'show', 'HEAD:tasks/001-task.md'), /status: completed/);
  assert.equal(fs.existsSync(path.join(repo, '.git/MERGE_HEAD')), false);
});
test('local integration and upstream sync merge independently and publish only the lane branch', async t => {
  const base = temporary(t), { repo, peer, remote } = repository(base);
  git(repo, 'switch', '-c', 'lane/api'); git(repo, 'push', '-u', 'origin', 'lane/api');
  git(repo, 'switch', 'main'); fs.writeFileSync(path.join(repo, 'local-main.txt'), 'local integration\n'); commit(repo);
  git(repo, 'switch', 'lane/api');
  git(peer, 'fetch'); git(peer, 'switch', '-c', 'lane-peer', '--track', 'origin/lane/api');
  fs.writeFileSync(path.join(peer, 'remote-lane.txt'), 'upstream lane\n'); commit(peer); git(peer, 'push', 'origin', 'HEAD:lane/api');
  const proof = path.join(base, 'proof');
  const controller = new GitSync(repo, [], [proof], proof, undefined, undefined, 'main', true);
  await controller.initialize(); await controller.before(1);
  assert.equal(fs.readFileSync(path.join(repo, 'local-main.txt'), 'utf8'), 'local integration\n');
  assert.equal(fs.readFileSync(path.join(repo, 'remote-lane.txt'), 'utf8'), 'upstream lane\n');
  await controller.after(1, '001', 'completed', async () => {});
  assert.equal(git(remote, 'rev-parse', 'refs/heads/lane/api'), git(repo, 'rev-parse', 'HEAD'));
  assert.throws(() => git(remote, 'show', 'main:local-main.txt'));
});
test('Node lease excludes another owner, releases, and reclaims a stale crashed lease', async t => {
  const root = temporary(t), lease = taskLease(root); const release = await acquireTaskLock(root, () => {});
  await assert.rejects(acquireTaskLock(root, () => {}), /Another runner/); await release();
  fs.mkdirSync(lease); fs.utimesSync(lease, new Date(0), new Date(0));
  const next = await acquireTaskLock(root, () => {}); await next(); assert.equal(fs.existsSync(lease), false);
});
test('fetches upstream before each boundary and publishes completed changes', async t => {
  const base = temporary(t), { repo, peer, remote } = repository(base), controller = sync(repo, path.join(base, 'evidence'));
  await controller.initialize();
  for (const round of [1, 2]) {
    fs.writeFileSync(path.join(peer, `remote-${round}.txt`), `newest ${round}\n`); commit(peer); git(peer, 'push');
    await controller.before(round); assert.equal(fs.readFileSync(path.join(repo, `remote-${round}.txt`), 'utf8'), `newest ${round}\n`);
    fs.writeFileSync(path.join(repo, `task-${round}.txt`), 'finished\n'); await controller.after(round, String(round), 'completed', async () => {});
    assert.equal(git(remote, 'rev-parse', 'main'), git(repo, 'rev-parse', 'HEAD'));
    git(peer, 'pull', '--ff-only');
  }
  assert.equal(controller.events.filter(x => x.event === 'fast_forward').length, 2);
});
test('rejects dirty, detached and unfinished checkouts before sync', async t => {
  const base = temporary(t), { repo } = repository(base);
  fs.writeFileSync(path.join(repo, 'unknown.txt'), 'unrelated');
  await assert.rejects(sync(repo, path.join(base, 'a')).initialize(), /clean checkout/); fs.unlinkSync(path.join(repo, 'unknown.txt'));
  git(repo, 'checkout', '--detach'); await assert.rejects(sync(repo, path.join(base, 'b')).initialize(), /not a symbolic ref/); git(repo, 'checkout', 'main');
  fs.writeFileSync(path.join(repo, '.git/CHERRY_PICK_HEAD'), git(repo, 'rev-parse', 'HEAD'));
  await assert.rejects(sync(repo, path.join(base, 'd')).initialize(), /Unfinished Git operation/);
});
for (const mode of ['missing upstream', 'unavailable remote']) test(`${mode} warns and allows local work`, async t => {
  const base = temporary(t), { repo, remote } = repository(base); tasks(repo, 2); commit(repo); git(repo, 'push');
  if (mode === 'missing upstream') git(repo, 'branch', '--unset-upstream');
  else git(repo, 'remote', 'set-url', 'origin', path.join(base, 'offline.git'));
  const result = await run(repo);
  assert.equal(result.code, 0, result.stderr);
  assertSyncWarning(result, mode === 'missing upstream' ? /configure upstream/ : /fetch before round 1/);
  assert.deepEqual(result.summary.rounds.map(row => row.git_sync), ['committed', 'committed']);
  assert.match(git(repo, 'show', 'HEAD:tasks/002-task.md'), /status: completed/);
  assert.match(git(remote, 'show', 'main:tasks/002-task.md'), /status: pending/);
});
test('restores the clean checkout after a conflict and continues local work by default', async t => {
  const base = temporary(t), { repo, peer, remote } = repository(base); tasks(repo, 2); commit(repo); git(repo, 'push'); conflicting(repo, peer);
  const result = await run(repo);
  assert.equal(result.code, 0, result.stderr);
  assertSyncWarning(result, /before round 1/);
  assert.deepEqual(result.summary.rounds.map(row => row.git_sync), ['committed', 'committed']);
  assert.equal(git(repo, 'show', 'HEAD:shared.txt'), 'local');
  assert.equal(git(remote, 'show', 'main:shared.txt'), 'remote');
  assert.equal(fs.existsSync(path.join(repo, '.git/MERGE_HEAD')), false);
});
test('skips an update that would overwrite an ignored local file', async t => {
  const base = temporary(t), { repo, peer } = repository(base); tasks(repo); commit(repo); git(repo, 'push'); git(peer, 'pull', '--ff-only');
  fs.appendFileSync(path.join(repo, '.git/info/exclude'), '\nlocal.txt\n');
  fs.writeFileSync(path.join(repo, 'local.txt'), 'keep local data\n');
  fs.writeFileSync(path.join(peer, 'local.txt'), 'upstream data\n'); commit(peer); git(peer, 'push');
  const result = await run(repo);
  assert.equal(result.code, 0, result.stderr);
  assertSyncWarning(result, /before round 1/);
  assert.equal(fs.readFileSync(path.join(repo, 'local.txt'), 'utf8'), 'keep local data\n');
  assert.equal(result.summary.rounds[0].git_sync, 'committed');
});
test('explicit stop mode preserves a conflicting merge before claiming a task', async t => {
  const base = temporary(t), { repo, peer } = repository(base); tasks(repo); commit(repo); git(repo, 'push'); conflicting(repo, peer);
  const r = await run(repo, ['--git-conflicts', 'stop']); assert.equal(r.code, 1, r.stderr); assert.equal(r.summary.reason, 'git_sync_error'); assert.equal(r.summary.rounds.length, 0);
  assert.equal(readTask(path.join(repo, 'tasks/001-task.md')).meta.status, 'pending'); assert.ok(fs.existsSync(path.join(repo, '.git/MERGE_HEAD')));
});
for (const adapter of [undefined, 'grok', 'codex', 'claude']) test(`dedicated ${adapter || 'custom'} resolver reconciles conflicts before the capped task`, async t => {
  const base = temporary(t), { repo, peer, remote } = repository(base); tasks(repo); commit(repo); git(repo, 'push'); conflicting(repo, peer);
  const r = await run(repo, ['--git-conflicts', 'worker', '--rounds', '1'], { PREPARED_GIT_REPOS: JSON.stringify([repo]) }, adapter);
  assert.equal(r.code, 0, r.stderr + JSON.stringify(r.summary)); assert.equal(r.summary.rounds.length, 1); assert.equal(r.summary.rounds[0].git_sync, 'pushed');
  assert.equal(git(remote, 'show', 'main:shared.txt'), 'resolved both sides'); assert.equal(git(remote, 'show', 'main:finished.txt'), 'Prepared task 001-task.md');
  assert.equal(fs.existsSync(path.join(repo, '.git/MERGE_HEAD')), false); assert.ok(fs.existsSync(path.join(r.directory, 'git-conflicts/001/receipt.json')));
  assert.equal(git(remote, 'ls-tree', '-r', '--name-only', 'main').includes('.taskmd-runner'), false);
});
for (const mode of ['blocked', 'unsafe', 'markers', 'index', 'malformed']) test(`conflict resolver ${mode} stops with preserved evidence and no task claim`, async t => {
  const base = temporary(t), { repo, peer } = repository(base); tasks(repo); commit(repo); git(repo, 'push'); conflicting(repo, peer);
  const r = await run(repo, ['--git-conflicts', 'worker'], { PREPARED_GIT_CONFLICT: mode });
  assert.equal(r.code, 1, r.stderr); assert.equal(r.summary.reason, 'git_sync_error'); assert.equal(r.summary.rounds.length, 0);
  assert.ok(fs.existsSync(path.join(repo, '.git/MERGE_HEAD'))); assert.equal(readTask(path.join(repo, 'tasks/001-task.md')).meta.status, 'pending');
});
for (const rejectPush of [false, true]) test(`multi-repository workspace checkpoints both repositories${rejectPush ? ' after the first push is rejected' : ' and publishes them'}`, async t => {
  const base = temporary(t), work = path.join(base, 'workspace'); fs.mkdirSync(work); tasks(work, 2);
  const code = repository(base, 'code'), taskRepo = path.join(work, 'tasks'); git(taskRepo, 'init', '-b', 'main'); configure(taskRepo); commit(taskRepo);
  const taskRemote = path.join(base, 'tasks.git'); git(base, 'init', '--bare', '--initial-branch=main', taskRemote); git(taskRepo, 'remote', 'add', 'origin', taskRemote); git(taskRepo, 'push', '-u', 'origin', 'main');
  if (rejectPush) fs.writeFileSync(path.join(code.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const r = await run(work, ['--rounds', '2', '--git-repo', code.repo, '--git-repo', taskRepo], { PREPARED_GIT_REPOS: JSON.stringify([code.repo]) });
  assert.equal(r.code, 0, r.stderr + JSON.stringify(r.summary)); assert.equal(r.summary.rounds.length, 2);
  assert.equal(git(code.repo, 'show', 'HEAD:finished.txt'), 'Prepared task 002-task.md');
  assert.match(git(taskRepo, 'show', 'HEAD:002-task.md'), /status: completed/);
  if (rejectPush) {
    assertSyncWarning(r, /publish round 1/);
    assert.match(git(taskRemote, 'show', 'main:002-task.md'), /status: pending/);
  } else {
    assert.equal(git(code.remote, 'show', 'main:finished.txt'), 'Prepared task 002-task.md');
    assert.match(git(taskRemote, 'show', 'main:002-task.md'), /status: completed/);
  }
});
test('publishes a verified partial handoff as in-progress across invocations', async t => {
  const base = temporary(t), { repo, remote } = repository(base); tasks(repo, 2);
  commit(repo); git(repo, 'push');
  const options = ['--rounds', '1', '--state-dir', path.join(base, 'runner-state')];
  const first = await run(repo, options, { PREPARED_GIT_MODE: 'partial-first' });
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.summary.rounds[0].task_status, 'in-progress');
  assert.equal(first.summary.rounds[0].git_sync, 'pushed');
  assert.match(git(remote, 'show', 'main:tasks/001-task.md'), /status: in-progress/);

  const second = await run(repo, options);
  assert.equal(second.code, 0, second.stderr || JSON.stringify(second.summary?.git_sync));
  assert.equal(second.summary.rounds[0].task_id, '001');
  assert.match(git(remote, 'show', 'main:tasks/001-task.md'), /status: completed/);
});
for (const previousRuns of [4, 5]) {
  test(`task run limits publish a blocked handoff with ${previousRuns} prior runs and continue`, async t => {
    const base = temporary(t), { repo, remote } = repository(base); tasks(repo, 2);
    const file = path.join(repo, 'tasks/001-task.md'); setTaskRuns(file, previousRuns);
    commit(repo); git(repo, 'push');
    const r = await run(repo, [], { PREPARED_GIT_MODE: 'partial-first' });
    assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
    assert.deepEqual(r.summary.rounds.map(row => row.task_id), previousRuns === 4 ? ['001', '002'] : ['002']);
    assert.equal(taskRuns(file), 5); assert.equal(readTask(file).meta.status, 'blocked');
    const published = git(remote, 'show', 'main:tasks/001-task.md');
    assert.match(published, /status: blocked/); assert.match(published, /Task run limit reached \(5\/5\)/);
    assert.match(published, /review this task or split it into subtasks that collectively preserve the original scope and acceptance criteria/);
    assert.match(git(remote, 'show', 'main:tasks/002-task.md'), /status: completed/);
    assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=no'), '');
    assert.equal(git(remote, 'rev-parse', 'main'), git(repo, 'rev-parse', 'HEAD'));
  });
}
for (const mode of ['pending-first', 'exit-first', 'unrepairable-first', 'scope-first']) {
  test(`publishes ${mode} as blocked and continues independent Git work`, async t => {
    const base = temporary(t), { repo, remote } = repository(base); tasks(repo, 2); commit(repo); git(repo, 'push');
    const r = await run(repo, [], { PREPARED_GIT_MODE: mode, PREPARED_GIT_REPOS: JSON.stringify([repo]) });
    assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
    const attempts = ['pending-first', 'exit-first'].includes(mode) ? 5 : mode === 'unrepairable-first' ? 2 : 1;
    const expected = ['pending-first', 'exit-first'].includes(mode)
      ? ['001', '002', ...Array(attempts - 1).fill('001')]
      : [...Array(attempts).fill('001'), '002'];
    assert.deepEqual(r.summary.rounds.map(row => row.task_id), expected);
    assert.match(git(remote, 'show', 'main:tasks/001-task.md'), /status: blocked/);
    assert.match(git(remote, 'show', 'main:tasks/002-task.md'), /status: completed/);
    assert.doesNotMatch(git(remote, 'show', 'main:tasks/001-task.md'), /# Changed scope/);
    assert.equal(r.summary.blocked_tasks.length, 1);
    assert.equal(r.summary.rounds.at(-1).git_sync, 'pushed');
    assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=no'), '');
    assert.equal(git(remote, 'rev-parse', 'main'), git(repo, 'rev-parse', 'HEAD'));
  });
}
test('push rejection warns once and later tasks still commit locally', async t => {
  const base = temporary(t), { repo, remote } = repository(base); tasks(repo, 2); commit(repo); git(repo, 'push');
  fs.writeFileSync(path.join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const r = await run(repo, [], { PREPARED_GIT_REPOS: JSON.stringify([repo]) });
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'empty');
  assertSyncWarning(r, /publish round 1/);
  assert.deepEqual(r.summary.rounds.map(row => row.git_sync), ['committed', 'committed']);
  for (const id of ['001', '002']) {
    assert.match(git(repo, 'show', `HEAD:tasks/${id}-task.md`), /status: completed/);
    assert.match(git(remote, 'show', `main:tasks/${id}-task.md`), /status: pending/);
  }
  assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=no'), '');
});
test('one push race fetches and merges the new upstream before a bounded retry', async t => {
  const base = temporary(t), { repo, peer, remote } = repository(base), controller = sync(repo, path.join(base, 'evidence')); await controller.initialize(); await controller.before(1);
  fs.writeFileSync(path.join(repo, 'local-finished.txt'), 'finished\n'); fs.writeFileSync(path.join(peer, 'remote.txt'), 'concurrent\n'); commit(peer); git(peer, 'push');
  let verified = 0; await controller.after(1, '001', 'completed', async () => { verified++; });
  assert.equal(verified, 1); assert.equal(git(remote, 'show', 'main:remote.txt'), 'concurrent'); assert.equal(git(remote, 'show', 'main:local-finished.txt'), 'finished');
});
test('task worker staging is rejected before the controller can publish its index', async t => {
  const base = temporary(t), { repo } = repository(base); tasks(repo); commit(repo); git(repo, 'push');
  const r = await run(repo, [], { PREPARED_GIT_REPOS: JSON.stringify([repo]), PREPARED_GIT_STAGE: '1' });
  assert.equal(r.code, 1); assert.match(r.summary.git_sync.error, /controller-owned Git index/); assert.equal(r.summary.rounds[0].status, 'completed');
});
test('changed upstream configuration requires restart before claiming work', async t => {
  const base = temporary(t), { repo, peer } = repository(base); tasks(repo); commit(repo); git(repo, 'push'); git(peer, 'pull', '--ff-only');
  fs.appendFileSync(path.join(peer, '.taskmd.yaml'), 'worklogs: true\n'); commit(peer); git(peer, 'push');
  const r = await run(repo); assert.equal(r.code, 1); assert.equal(r.summary.rounds.length, 0); assert.match(r.summary.git_sync.error, /restart with the updated configuration/);
});
test('all checkout boundaries are checked before any upstream is integrated', async t => {
  const base = temporary(t), a = repository(base, 'a'), b = repository(base, 'b');
  const controller = new GitSync(base, [a.repo, b.repo], [], path.join(base, 'evidence')); await controller.initialize();
  fs.writeFileSync(path.join(a.peer, 'new.txt'), 'new\n'); commit(a.peer); git(a.peer, 'push');
  const before = git(a.repo, 'rev-parse', 'HEAD'); fs.writeFileSync(path.join(b.repo, 'dirty.txt'), 'unrelated\n');
  await assert.rejects(controller.before(1), /dirty between rounds/); assert.equal(git(a.repo, 'rev-parse', 'HEAD'), before);
});
test('controller preserves literal filenames, renames and deletions in its commit', async t => {
  const base = temporary(t), { repo, remote } = repository(base), controller = sync(repo, path.join(base, 'evidence')); await controller.initialize(); await controller.before(1);
  fs.renameSync(path.join(repo, 'shared.txt'), path.join(repo, ':(glob)*.txt')); fs.unlinkSync(path.join(repo, 'outside.txt'));
  await controller.after(1, '001', 'completed', async () => {});
  assert.equal(git(remote, 'show', 'main::(glob)*.txt'), 'baseline'); assert.equal(git(remote, 'ls-tree', '--name-only', 'main'), ':(glob)*.txt');
});
test('a publication conflict is resolved once and verified before the merged result is pushed', async t => {
  const base = temporary(t), { repo, peer, remote } = repository(base); let resolved = 0, verified = 0;
  const controller = sync(repo, path.join(base, 'evidence'), async request => { resolved++; assert.deepEqual(request.files, ['shared.txt']); fs.writeFileSync(path.join(repo, 'shared.txt'), 'both sides\n'); });
  await controller.initialize(); await controller.before(1);
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'local completed\n'); fs.writeFileSync(path.join(peer, 'shared.txt'), 'remote\n'); commit(peer); git(peer, 'push');
  await controller.after(1, '001', 'completed', async () => { verified++; });
  assert.equal(resolved, 1); assert.equal(verified, 1); assert.equal(git(remote, 'show', 'main:shared.txt'), 'both sides');
});
test('skipping a publication conflict keeps the accepted handoff committed', async t => {
  const base = temporary(t), { repo, peer, remote } = repository(base); tasks(repo); commit(repo); git(repo, 'push'); git(peer, 'pull', '--ff-only');
  const r = await run(repo, ['--rounds', '1'], { PREPARED_GIT_ADVANCE_PEER: peer });
  assert.equal(r.code, 0, r.stderr);
  assertSyncWarning(r, /publish round 1/);
  assert.equal(r.summary.rounds[0].git_sync, 'committed');
  assert.match(git(repo, 'show', 'HEAD:tasks/001-task.md'), /status: completed/);
  assert.match(git(remote, 'show', 'main:tasks/001-task.md'), /Concurrent prepared note/);
  assert.equal(fs.existsSync(path.join(repo, '.git/MERGE_HEAD')), false);
});
test('publication resolution cannot discard the accepted task handoff', async t => {
  const base = temporary(t), { repo, peer, remote } = repository(base); tasks(repo); commit(repo); git(repo, 'push'); git(peer, 'pull', '--ff-only');
  const r = await run(repo, ['--git-conflicts', 'worker', '--rounds', '1'], { PREPARED_GIT_ADVANCE_PEER: peer, PREPARED_GIT_CONFLICT: 'drop-handoff' });
  assert.equal(r.code, 1, r.stderr); assert.equal(r.summary.rounds[0].status, 'completed'); assert.match(r.summary.git_sync.error, /accepted task contract, status or handoff/);
  assert.ok(fs.existsSync(path.join(repo, '.git/MERGE_HEAD'))); assert.match(git(remote, 'show', 'main:tasks/001-task.md'), /status: pending/);
});

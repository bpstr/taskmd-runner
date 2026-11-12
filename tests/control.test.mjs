import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { RunControl, controlRoot, runStatus, controlRun, requestRun, listRuns } from '../dist/control.js';
import { parseArgs } from '../dist/cli.js';
import { projectMonitor } from '../dist/monitor.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(ROOT, 'bin/taskmd-runner.js');
const fake = path.join(ROOT, 'tests/fake-worker.mjs');
const cleanups = new WeakMap();
const cleanup = (t, fn) => cleanups.get(t).push(fn);
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'taskmd-control-')));
  const previous = process.env.TASKMD_RUNNER_CONTROL_DIR;
  process.env.TASKMD_RUNNER_CONTROL_DIR = path.join(dir, 'control');
  cleanups.set(t, []);
  t.after(async () => {
    const errors = [];
    for (const fn of cleanups.get(t).reverse()) { try { await fn(); } catch (error) { errors.push(error); } }
    if (previous === undefined) delete process.env.TASKMD_RUNNER_CONTROL_DIR; else process.env.TASKMD_RUNNER_CONTROL_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
    if (errors.length) throw new AggregateError(errors, 'Fixture cleanup failed');
  });
  return dir;
}
async function waitFor(read, accepts, message = 'condition', timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  for (let delay = 10; Date.now() < deadline; delay = Math.min(delay * 2, 150)) {
    last = await read(); if (accepts(last)) return last;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  assert.fail(`Timed out waiting for ${message}: ${JSON.stringify(last)}`);
}
async function controller(t, project, lane = 'main', onChange = () => {}) {
  const control = new RunControl(project, lane, path.join(project, 'evidence'), onChange);
  await control.open(); cleanup(t, () => control.close()); return control;
}
async function mcp(t, extraEnv = {}, self = false) {
  const child = spawn(process.execPath, [cli, 'mcp', ...(self ? ['--self'] : [])], {
    env: { ...process.env, TASKMD_MONITOR: 'off', CODEX_HOME: path.join(controlRoot(), 'prepared-profile'), ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let next = 0, stderr = '';
  const pending = new Map();
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line); const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout ${method}: ${stderr}`)); }, 12000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const close = async () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Test ended')); }
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 1000);
    await exited; clearTimeout(timer);
  };
  cleanup(t, close);
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prepared-test', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return { call, close, tool: async (name, args = {}) => {
    const result = await call('tools/call', { name, arguments: args });
    return { value: JSON.parse(result.content[0].text), error: result.isError || false };
  } };
}
function project(dir, name, tasks = ['001', '002']) {
  const root = path.join(dir, name); fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.taskmd.yaml'), 'dir: tasks\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Prepared fixture\n');
  for (const id of tasks) fs.writeFileSync(path.join(root, 'tasks', `${id}-task.md`), `---\nid: "${id}"\ntitle: Prepared task\nstatus: pending\n---\n# Task\n\n- [ ] Deliver the fixture\n`);
  return root;
}

test('controllers separate workspace/lane identities, authenticate and report stale endpoints without signaling PIDs', async t => {
  const dir = fixture(t), actions = [];
  const a = await controller(t, dir, 'api', action => actions.push(action));
  const b = await controller(t, dir, 'web');
  const other = project(dir, 'other', []), c = await controller(t, other, 'api');
  const duplicate = new RunControl(dir, 'api', dir, () => {});
  await assert.rejects(duplicate.open(), /Another runner/);
  assert.equal((await listRuns(dir)).runs.length, 2);
  assert.equal((await listRuns()).runs.length, 3);
  assert.equal((await listRuns(undefined, 0, 1)).next_offset, 1);
  const file = path.join(controlRoot(), 'runs', `${a.status.run_id}.json`);
  const saved = JSON.parse(fs.readFileSync(file));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  const publicValue = await runStatus(a.status.run_id);
  assert.equal('token' in publicValue, false); assert.equal('endpoint' in publicValue, false);
  const forbidden = await fetch(`${saved.endpoint}/stop`, { method: 'POST' }); assert.equal(forbidden.status, 403);
  const origin = await fetch(`${saved.endpoint}/stop`, { method: 'POST', headers: { Authorization: `Bearer ${saved.token}`, Origin: 'https://example.com' } });
  assert.equal(origin.status, 403); assert.deepEqual(actions, []);
  assert.equal((await controlRun(a.status.run_id, 'pause')).state, 'pausing');
  await controlRun(a.status.run_id, 'pause'); assert.deepEqual(actions, ['pause']);
  assert.equal((await runStatus(b.status.run_id)).state, 'running');
  assert.equal((await runStatus(c.status.run_id)).state, 'running');
  await a.close(); assert.equal((await runStatus(a.status.run_id)).state, 'unreachable');
  assert.ok((await listRuns(dir)).runs.some(run => run.run_id === a.status.run_id && run.state === 'unreachable'));
  await assert.rejects(controlRun(a.status.run_id, 'stop'));
  await assert.rejects(requestRun({ ...saved, endpoint: 'https://example.com' }, 'stop'), /unavailable/);
  await assert.rejects(runStatus('../unsafe'), /not found/);
});

test('a replacement lane reconciles a dead controller, reports a terminal Monitor state and resumes the checkpoint', async t => {
  const dir = fixture(t), root = project(dir, 'recovered workspace');
  const file = path.join(root, 'tasks', '001-task.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: pending', 'status: in-progress') +
    '\n## Progress\n\nPrepared checkpoint before disk exhaustion.\n\n<!-- taskmd-runner runs: 1 -->\n');
  const child = spawn(process.execPath, ['-e', '']);
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });

  const id = randomUUID(), lane = 'recover', startedAt = new Date().toISOString();
  const sourceId = id.replaceAll('-', '').slice(0, 24);
  const records = path.join(controlRoot(), 'runs'), lanes = path.join(controlRoot(), 'lanes');
  fs.mkdirSync(records, { recursive: true }); fs.mkdirSync(lanes, { recursive: true });
  const recordFile = path.join(records, `${id}.json`);
  fs.writeFileSync(recordFile, JSON.stringify({ run_id: id, project: root, lane, state: 'running', revision: 3,
    pid: child.pid, run_dir: path.join(root, 'old-evidence'), started_at: startedAt, task: '001', round: 1 }));
  const staleLane = path.join(lanes, createHash('sha256').update(root + '\0' + lane).digest('hex') + '.lock');
  fs.mkdirSync(staleLane);
  const expired = new Date(Date.now() - 60000); fs.utimesSync(staleLane, expired, expired);

  const reports = [], installationId = randomUUID();
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    reports.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ installation_id: installationId, protocol_versions: [1] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup(t, () => new Promise(resolve => server.close(resolve)));
  const stateDir = path.join(dir, 'monitor-state'), connectionId = randomUUID();
  const monitor = path.join(stateDir, 'monitor'), outbox = path.join(monitor, 'outbox', connectionId);
  fs.mkdirSync(outbox, { recursive: true });
  fs.writeFileSync(path.join(monitor, 'config.json'), JSON.stringify({ version: 1, connectionId, installationId,
    enabled: true, verified: true, endpoint: `http://127.0.0.1:${server.address().port}/ingest`,
    apiKey: `rm_${'a'.repeat(16)}_${'b'.repeat(64)}` }));
  const state = { version: 1, connectionId, installationId, sequence: 8, incarnationId: randomUUID(), events: [] };
  const live = projectMonitor({ id: sourceId, roadmap: root, createdAt: startedAt, processState: 'running',
    roadmapState: 'in_progress', role: 'worker', task: '001', iteration: 1, pid: child.pid }, state);
  const spool = path.join(outbox, `${sourceId}.json`);
  fs.writeFileSync(spool, JSON.stringify({ ...state, replayBase: live }));
  fs.writeFileSync(spool + '.publisher', String(child.pid));

  const client = await mcp(t, { TASKMD_MONITOR: 'on', TASKMD_MONITOR_STATE_DIR: stateDir });
  const start = await client.tool('runner_start', { project: root, lane, rounds: 1, notify: 'off', worker: [process.execPath, fake] });
  assert.equal(start.error, false, JSON.stringify(start.value));
  cleanup(t, async () => {
    if ((await runStatus(start.value.run_id)).state === 'exited') return;
    await controlRun(start.value.run_id, 'stop');
    await waitFor(() => runStatus(start.value.run_id), run => run.state === 'exited', 'replacement cleanup');
  });
  const finished = await waitFor(() => runStatus(start.value.run_id), run => run.state === 'exited', 'replacement exit');
  const recovered = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  assert.equal(recovered.state, 'exited'); assert.equal(recovered.reason, 'controller_lost');
  assert.deepEqual((await client.tool('runner_list', { project: root })).value.runs, []);
  assert.ok((await client.tool('runner_list', { project: root, include_exited: true })).value.runs.some(run => run.run_id === id));
  const terminal = await waitFor(() => reports.find(report => report.source_run_id === sourceId && report.run.terminal), Boolean, 'terminal replay');
  assert.equal(terminal.run.heartbeat_expected, false);
  assert.equal(terminal.run.reason_code, 'controller_lost');
  assert.ok(terminal.report_sequence > live.report_sequence);
  assert.equal(terminal.process.incarnation_id, live.process.incarnation_id);
  const summary = JSON.parse(fs.readFileSync(path.join(finished.run_dir, 'summary.json'), 'utf8'));
  assert.deepEqual(summary.rounds.map(round => [round.task_id, round.task_run, round.status]), [['001', 2, 'completed']]);
  const prompt = fs.readFileSync(path.join(finished.run_dir, '001-001', 'prompt.md'), 'utf8');
  assert.match(prompt, /Aim to finish and verify within 60 minutes/);
  assert.match(prompt, /Task run: 2 of 5 allowed runs/);
  assert.match(fs.readFileSync(file, 'utf8'), /Prepared checkpoint before disk exhaustion/);
  assert.match(fs.readFileSync(path.join(root, 'tasks', '002-task.md'), 'utf8'), /status: pending/);
});

test('pause checkpoints resume and stop without stopping neighboring lanes', async t => {
  const dir = fixture(t), signal = new AbortController();
  const a = await controller(t, dir, 'a', action => { if (action === 'stop') signal.abort(); });
  const b = await controller(t, dir, 'b');
  await controlRun(a.status.run_id, 'pause');
  const waiting = a.checkpoint(signal.signal);
  assert.equal((await runStatus(a.status.run_id)).state, 'paused');
  await controlRun(a.status.run_id, 'resume'); await waiting;
  await controlRun(a.status.run_id, 'pause');
  const stopped = a.checkpoint(signal.signal);
  await controlRun(a.status.run_id, 'stop'); await stopped;
  assert.equal(signal.signal.aborted, true);
  assert.equal((await runStatus(b.status.run_id)).state, 'running');
});

test('MCP protocol exposes compact exact-target control, revision checks and self scope', async t => {
  const dir = fixture(t), a = await controller(t, dir, 'api'), b = await controller(t, dir, 'web');
  const desktop = await mcp(t);
  assert.deepEqual((await desktop.call('tools/list')).tools.map(tool => tool.name).sort(), ['runner_control', 'runner_list', 'runner_start', 'runner_status']);
  const list = await desktop.tool('runner_list', { project: dir, limit: 1 });
  assert.equal(list.error, false); assert.equal(list.value.runs.length, 1); assert.equal(list.value.next_offset, 1);
  const status = await desktop.tool('runner_status', { run_id: a.status.run_id });
  assert.equal(status.error, false); assert.equal('token' in status.value, false);
  const unchanged = await desktop.tool('runner_status', { run_id: a.status.run_id, since_revision: status.value.revision });
  assert.deepEqual(unchanged.value, { run_id: a.status.run_id, revision: status.value.revision, unchanged: true });
  const worker = await mcp(t, a.workerEnv(), true);
  assert.deepEqual((await worker.call('tools/list')).tools.map(tool => tool.name).sort(), ['runner_control', 'runner_status']);
  assert.equal((await worker.tool('runner_status')).value.run_id, a.status.run_id);
  assert.equal((await worker.tool('runner_control', { run_id: b.status.run_id, action: 'stop' })).error, true);
  assert.equal((await worker.tool('runner_control', { action: 'pause' })).value.state, 'pausing');
  assert.equal((await desktop.tool('runner_status', { run_id: a.status.run_id, since_revision: status.value.revision })).value.state, 'pausing');
  assert.equal((await runStatus(b.status.run_id)).state, 'running');
  const inherited = await mcp(t, a.workerEnv());
  assert.equal((await inherited.call('tools/list')).tools.length, 2);
});

test('MCP detached start, boundary pause/resume and stop retain prepared task receipts', async t => {
  const dir = fixture(t), root = project(dir, 'prepared workspace');
  const client = await mcp(t);
  const started = await client.tool('runner_start', { project: root, lane: 'prepared', notify: 'off', timeout: 30,
    worker: [process.execPath, path.join(ROOT, 'tests/control-worker.mjs')] });
  assert.equal(started.error, false, JSON.stringify(started.value));
  const id = started.value.run_id;
  cleanup(t, async () => {
    const status = await runStatus(id); if (!['exited', 'unreachable'].includes(status.state)) {
      await controlRun(id, 'stop'); await waitFor(() => runStatus(id), s => s.state === 'exited', 'cleanup exit');
    }
  });
  const paused = await waitFor(() => runStatus(id), s => s.state === 'paused', 'worker-requested boundary pause');
  assert.equal(paused.round, 1); assert.equal(paused.task, null);
  assert.equal(fs.existsSync(path.join(paused.run_dir, '002-002')), false);
  const first = JSON.parse(fs.readFileSync(path.join(paused.run_dir, '001-001', 'receipt.json')));
  assert.equal(first.status, 'completed');
  const duplicate = await client.tool('runner_start', { project: root, lane: 'prepared', worker: [process.execPath, fake] });
  assert.equal(duplicate.error, true);
  await client.close();
  assert.equal((await runStatus(id)).state, 'paused');
  const nextClient = await mcp(t);
  assert.equal((await nextClient.tool('runner_control', { run_id: id, action: 'resume' })).value.state, 'running');
  const finished = await waitFor(() => runStatus(id), s => s.state === 'exited', 'drained run');
  assert.equal(finished.reason, 'empty'); assert.equal(finished.round, 2);
  assert.equal((await nextClient.tool('runner_list', { project: root })).value.runs.length, 0);
  assert.equal((await nextClient.tool('runner_list', { project: root, include_exited: true })).value.runs[0].run_id, id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(finished.run_dir, 'summary.json'))).rounds.length, 2);
  assert.equal((await nextClient.tool('runner_control', { run_id: id, action: 'resume' })).error, true);
  const gitStart = await nextClient.tool('runner_start', { project: root, lane: 'git-option', notify: 'off',
    git_integration_branch: 'main', git_conflicts: 'skip', worker: [process.execPath, fake] });
  assert.equal(gitStart.error, false, JSON.stringify(gitStart.value));
  const gitFailed = await waitFor(() => runStatus(gitStart.value.run_id), s => s.state === 'exited', 'local Git option forwarding');
  assert.equal(gitFailed.reason, 'git_sync_error', 'MCP forwards local Git mode even without upstream sync');
  const cancelRoot = project(dir, 'cancel workspace', ['003']);
  const stopping = await nextClient.tool('runner_start', { project: cancelRoot, lane: 'cancel', notify: 'off', timeout: 30,
    worker: [process.execPath, fake, 'timeout'] });
  assert.equal(stopping.error, false, JSON.stringify(stopping.value));
  const stopId = stopping.value.run_id;
  cleanup(t, async () => {
    const status = await runStatus(stopId);
    if (!['exited', 'unreachable'].includes(status.state)) {
      await controlRun(stopId, 'stop'); await waitFor(() => runStatus(stopId), s => s.state === 'exited', 'cancel cleanup');
    }
  });
  const active = await waitFor(() => runStatus(stopId), s => s.task === '003', 'active prepared worker');
  await waitFor(() => fs.existsSync(path.join(active.run_dir, '001-003', 'worker.pid')), Boolean, 'worker PID evidence');
  assert.equal((await nextClient.tool('runner_control', { run_id: stopId, action: 'stop' })).value.state, 'stopping');
  const cancelled = await waitFor(() => runStatus(stopId), s => s.state === 'exited', 'cancelled run');
  assert.equal(cancelled.reason, 'interrupted'); assert.equal(cancelled.exit_code, 130);
  const summary = JSON.parse(fs.readFileSync(path.join(cancelled.run_dir, 'summary.json')));
  assert.equal(summary.rounds[0].status, 'blocked');
  assert.match(fs.readFileSync(path.join(cancelRoot, 'tasks', '003-task.md'), 'utf8'), /status: blocked/);
});

test('lane CLI validation and monitor pause projection preserve clear state', () => {
  assert.equal(parseArgs(['--project', '/tmp', '--lane', 'api']).lane, 'api');
  assert.throws(() => parseArgs(['--project', '/tmp', '--lane', '../bad']), /Lane/);
  assert.throws(() => parseArgs(['--project', '/tmp', '--lane']), /Missing value/);
  const report = projectMonitor({ id: randomUUID(), roadmap: '/tmp', createdAt: new Date().toISOString(), processState: 'waiting',
    roadmapState: 'in_progress', waitReason: 'paused' }, {});
  assert.equal(report.run.wait_reason, 'paused');
  assert.equal(report.activity.text, 'Paused');
  assert.equal(report.run.heartbeat_expected, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { MonitorReporter, projectMonitor, terminalOutcome, monitorText, flushMonitor } from '../dist/monitor.js';
import { configureMonitor, diagnostics, monitorConfig, readMonitorConfig, saveMonitorConfig, endpoint } from '../dist/monitor-config.js';
import { command } from '../dist/process.js';

const key = `rm_${'a'.repeat(16)}_${'b'.repeat(64)}`;
const installation = '00000000-0000-4000-8000-000000000001';
const config = { version: 1, endpoint: 'http://127.0.0.1:1/ingest', apiKey: key, connectionId: 'prepared', installationId: installation, enabled: true, verified: true };
const accepted = () => new Response(JSON.stringify({ installation_id: installation, protocol_versions: [1] }));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskmd-monitor-'));
  const previous = Object.fromEntries(['TASKMD_MONITOR_STATE_DIR', 'TASKMD_MONITOR', 'TASKMD_MONITOR_URL', 'TASKMD_MONITOR_API_KEY'].map(k => [k, process.env[k]]));
  process.env.TASKMD_MONITOR_STATE_DIR = root;
  for (const k of Object.keys(previous).filter(k => k !== 'TASKMD_MONITOR_STATE_DIR')) delete process.env[k];
  t.after(() => { for (const [k,v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(root, { recursive: true, force: true }); });
  return { id: randomUUID().replaceAll('-', '').slice(0, 24), roadmap: '/Users/private/project', createdAt: new Date().toISOString(), processState: 'running', roadmapState: 'in_progress', pid: process.pid, role: 'worker', task: '001', iteration: 1 };
}
const event = (type, data = {}) => ({ id: randomUUID(), sequence: 1, at: new Date().toISOString(), type, ...data });

test('projection keeps explicit task activity, redacts private data and distinguishes completion from caps', t => {
  const record = fixture(t), state = { sequence: 0, taskId: '001', title: 'Deliver login', activityAt: record.createdAt };
  const report = projectMonitor(record, state);
  assert.equal(report.run.roadmap_label, 'Taskmd · project');
  assert.equal(report.activity.text, 'Working on 001 · Deliver login');
  assert.equal(projectMonitor(record, state).activity.observed_at, report.activity.observed_at);
  assert.ok(!JSON.stringify(report).includes('/Users/private'));
  assert.equal(monitorText(`${key} password=secret sk-abcdefghijk /Users/private/file`), '[REDACTED] password=[REDACTED] [REDACTED] [private path]');
  for (const [reason, outcome] of [['empty', 'completed'], ['round_limit', 'needs_attention'], ['no_ready_tasks', 'needs_attention'], ['interrupted', 'cancelled'], ['runner_error', 'failed']]) {
    Object.assign(record, { reason, roadmapState: reason === 'empty' ? 'complete' : 'stopped', exitCode: 0 });
    assert.equal(terminalOutcome(record), outcome);
    const terminal = projectMonitor(record, state, true);
    assert.equal(terminal.run.heartbeat_expected, false); assert.equal(terminal.run.terminal, true);
  }
});

test('configuration preserves saved credentials on rejection and disabled settings override environment', async t => {
  fixture(t);
  await configureMonitor(config.endpoint, key, 'Prepared', async () => accepted());
  const saved = readMonitorConfig();
  await assert.rejects(configureMonitor(config.endpoint, key, undefined, async () => new Response('{}', { status: 401 })));
  assert.deepEqual(readMonitorConfig(), saved);
  assert.ok(!JSON.stringify(diagnostics()).includes(key));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(process.env.TASKMD_MONITOR_STATE_DIR, 'monitor/config.json')).mode & 0o777, 0o600);
  saveMonitorConfig({ ...saved, enabled: false });
  process.env.TASKMD_MONITOR_URL = config.endpoint; process.env.TASKMD_MONITOR_API_KEY = key;
  assert.equal(monitorConfig(), null);
  for (const url of ['http://example.com/ingest', 'https://user:pass@example.com', 'https://example.com?key=secret']) assert.throws(() => endpoint(url));
});

test('publisher sends current state before sparse history, retains failures and replays terminal state', async t => {
  const record = fixture(t), reports = [];
  const transport = async (_url, options) => { reports.push(JSON.parse(options.body)); return accepted(); };
  const reporter = new MonitorReporter(record, { config, timers: false, transport });
  reporter.event(event('runner.turn_starting', { task: '001', role: 'worker', activityTitle: 'Deliver login' }));
  await reporter.pending;
  reporter.event(event('runner.task_result', { task: '001', operation: 'Verified login', outcome: 'completed', nextRecordedStep: 'Select next task' }));
  await reporter.pending;
  assert.equal(reporter.state.lastUpdate.text, 'Verified login');
  Object.assign(record, { reason: 'empty', roadmapState: 'complete', processState: 'exited' });
  reporter.transport = async () => { throw new Error('prepared offline'); };
  await reporter.finish();
  const stored = JSON.parse(fs.readFileSync(reporter.file));
  assert.equal(stored.terminal.run.terminal_outcome, 'completed'); assert.equal(stored.terminal.run.heartbeat_expected, false);
  assert.ok(!fs.existsSync(`${reporter.file}.publisher`));
  assert.equal(reports[0].kind, 'snapshot'); assert.equal(reports[0].events.length, 0);
  saveMonitorConfig(config);
  t.mock.method(globalThis, 'fetch', transport);
  fs.writeFileSync(path.join(path.dirname(reporter.file), `${'f'.repeat(24)}.json`), 'broken');
  await flushMonitor();
  const replay = reports.at(-1);
  assert.equal(replay.kind, 'replay'); assert.equal(replay.run.heartbeat_expected, false); assert.equal(replay.run.terminal, true);
  assert.ok(!JSON.parse(fs.readFileSync(reporter.file)).terminal);
});

test('a pending request cannot lose the terminal outcome and sends only one request at a time', async t => {
  const record = fixture(t), reports = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const reporter = new MonitorReporter(record, { config, timers: false, transport: async (_url, options) => { reports.push(JSON.parse(options.body)); if (reports.length === 1) await barrier; return accepted(); } });
  const pending = reporter.send();
  await Promise.resolve();
  reporter.send();
  Object.assign(record, { reason: 'round_limit', processState: 'exited' });
  const finish = reporter.finish();
  release(); await Promise.all([pending, finish]);
  assert.equal(reports[0].kind, 'snapshot');
  assert.equal(reports.at(-1).run.terminal_outcome, 'needs_attention');
  assert.ok(!fs.existsSync(`${reporter.file}.publisher`));
});

test('retry honors rejection backoff, task switches clear prior text and blockers remain attributed', async t => {
  const record = fixture(t);
  let calls = 0;
  const reporter = new MonitorReporter(record, { config, timers: false, transport: async () => { calls++; return new Response('{}', { status: 401 }); } });
  reporter.event(event('runner.task_result', { task: '001', operation: 'Old task operation', outcome: 'pending' }));
  await reporter.pending; await reporter.send();
  assert.equal(calls, 1); assert.ok(reporter.nextAttempt - Date.now() > 890000);
  Object.assign(record, { task: '002', attentionTasks: ['001'], attentionReasons: { '001': 'task_run_limit' } });
  reporter.event(event('runner.turn_starting', { task: '002', role: 'worker', activityTitle: 'Next task' }));
  const report = projectMonitor(record, reporter.state);
  assert.equal(report.last_update, null); assert.equal(report.attention[0].task_id, '001');
  assert.equal(report.attention[0].reason_code, 'task_run_limit'); assert.equal(report.attention[0].requires_attention, true);
  Object.assign(record, { reason: 'no_ready_tasks', processState: 'exited' });
  await reporter.finish();
});

test('monitor credentials never enter command subprocesses', async t => {
  fixture(t); process.env.TASKMD_MONITOR_API_KEY = key;
  const result = await command(process.execPath, ['-e', 'console.log(JSON.stringify({key:process.env.TASKMD_MONITOR_API_KEY,roadmap:process.env.ROADMAP_MONITOR_API_KEY}))'], { cwd: process.cwd(), env: { ...process.env, ROADMAP_MONITOR_API_KEY: key } });
  assert.deepEqual(JSON.parse(result), {});
});

test('monitor CLI configures through stdin, tests and toggles saved settings without a project', async t => {
  fixture(t);
  const kinds = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    kinds.push(JSON.parse(body).kind);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ installation_id: installation, protocol_versions: [1] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const cli = (...args) => command(process.execPath, ['bin/taskmd-runner.js', 'monitor', ...args, '--json'], { cwd: process.cwd(), input: key });
  const configured = JSON.parse(await cli('configure', '--url', `http://127.0.0.1:${server.address().port}/ingest`, '--api-key-stdin'));
  assert.equal(configured.verified, true); assert.ok(!JSON.stringify(configured).includes(key));
  assert.equal(JSON.parse(await cli('test')).ok, true);
  assert.equal(JSON.parse(await cli('disable')).enabled, false);
  assert.equal(JSON.parse(await cli('status')).enabled, false);
  assert.equal(JSON.parse(await cli('enable')).enabled, true);
  assert.equal(JSON.parse(await cli('flush')).attempted, 0);
  assert.deepEqual(kinds, ['probe', 'probe']);
});

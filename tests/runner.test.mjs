import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { acquireTaskLock } from '../dist/lock.js';
import { readTask, taskRuns, setTaskRuns } from '../dist/task.js';
import { parseArgs } from '../dist/cli.js';
import { Runner, pendingReason } from '../dist/runner.js';
import { Notifications } from '../dist/notifications.js';
import { command } from '../dist/process.js';
process.env.TASKMD_MONITOR = 'off';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fake = path.join(ROOT, 'tests/fake-worker.mjs');
const limitReview = /Review required: the task owner must review this task or split it into subtasks that collectively preserve the original scope and acceptance criteria/;
test('version reports installed package metadata without a project or worker', async () => {
  const output = await command(process.execPath, [path.join(ROOT, 'bin/taskmd-runner.js'), '--version'], { cwd: ROOT });
  assert.equal(output.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
});
function fixture(t, config = '', prefix = 'taskmd-ts-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
async function run(root, mode = 'completed', options = [], adapter = false, env = {}) {
  const args = [path.join(ROOT, 'bin/taskmd-runner.js'), '--project', root, '--notify', 'off', '--timeout', '10', ...options];
  if (adapter) args.push('--executable', fake);
  else args.push('--worker', process.execPath, fake, mode);
  const child = spawn(process.execPath, args, { env: { ...process.env, TASKMD_MONITOR: 'off', TASKMD_MONITOR_STATE_DIR: path.join(root, 'monitor-state'), CODEX_HOME: path.join(root, 'prepared-profile'), PREPARED_MODE: mode, ...env } });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const final = events.find(event => event.summary);
  return { code, stderr, events, summary: final && JSON.parse(fs.readFileSync(final.summary, 'utf8')) };
}
for (const scenario of [
  { name: 'drained queue', mode: 'completed', options: [], outcome: 'completed', code: 0 },
  { name: 'round cap', mode: 'completed', options: ['--rounds', '1'], outcome: 'needs_attention', code: 0 },
  { name: 'blocked task followed by independent work', mode: 'blocked-first', options: [], outcome: 'needs_attention', code: 2 },
]) test(`monitor reports ${scenario.name} through prepared workers`, async t => {
  const root = fixture(t); task(root, '001', { priority: 'critical' }); task(root, '002');
  const reports = [], key = `rm_${'a'.repeat(16)}_${'b'.repeat(64)}`;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    reports.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ installation_id: '00000000-0000-4000-8000-000000000001', protocol_versions: [1] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const r = await run(root, scenario.mode, scenario.options, scenario.name === 'drained queue', { PREPARED_REQUIRE_NO_MONITOR_KEY: '1', TASKMD_MONITOR: 'on', TASKMD_MONITOR_URL: `http://127.0.0.1:${server.address().port}/ingest`, TASKMD_MONITOR_API_KEY: key });
  assert.equal(r.code, scenario.code, r.stderr);
  const envelopes = reports.filter(report => report.kind !== 'probe'), final = envelopes.at(-1);
  assert.equal(final.run.terminal, true); assert.equal(final.run.heartbeat_expected, false);
  assert.equal(final.run.terminal_outcome, scenario.outcome);
  assert.match(envelopes[0].run.roadmap_label, /^Taskmd · /);
  assert.equal(final.last_update?.outcome, 'completed');
  assert.ok(final.run.last_progress_at);
  assert.ok(envelopes.some(report => report.activity?.text.includes('Task 001')));
  assert.ok(envelopes.flatMap(report => report.events).some(event => event.type === 'runner.task_result'));
  assert.ok(!JSON.stringify(envelopes).includes(root)); assert.ok(!JSON.stringify(envelopes).includes(key));
  if (scenario.mode === 'blocked-first') {
    assert.deepEqual(r.summary.rounds.map(row => row.task_id), ['001', '002']);
    assert.equal(final.attention[0].task_id, '001');
  }
  if (process.env.MONITOR_REPORT_CAPTURE) fs.writeFileSync(path.join(process.env.MONITOR_REPORT_CAPTURE, scenario.mode + (scenario.options.length ? '-cap' : '') + '.json'), JSON.stringify(envelopes));
});
test('offline monitor delivery retains terminal replay while prepared work succeeds', async t => {
  const root = fixture(t); task(root, '001');
  const r = await run(root, 'completed', [], false, { TASKMD_MONITOR: 'on', TASKMD_MONITOR_URL: 'http://127.0.0.1:1/ingest', TASKMD_MONITOR_API_KEY: `rm_${'a'.repeat(16)}_${'b'.repeat(64)}` });
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'empty');
  const outbox = path.join(root, 'monitor-state/monitor/outbox');
  const partition = path.join(outbox, fs.readdirSync(outbox)[0]);
  const files = fs.readdirSync(partition);
  assert.equal(files.length, 1); assert.ok(files[0].endsWith('.json'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(partition, files[0]))).terminal.run.terminal_outcome, 'completed');
});
test('monitor finalizes prepared cancellation without a live heartbeat', async t => {
  const root = fixture(t); task(root, '001');
  const reports = [];
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const report = JSON.parse(body); reports.push(report);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ installation_id: '00000000-0000-4000-8000-000000000001', protocol_versions: [1] }));
    if (report.run?.task_id) started();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const child = spawn(process.execPath, [path.join(ROOT, 'bin/taskmd-runner.js'), '--project', root, '--notify', 'off', '--worker', process.execPath, fake, 'timeout'], {
    env: { ...process.env, TASKMD_MONITOR_STATE_DIR: path.join(root, 'monitor-state'), TASKMD_MONITOR: 'on', TASKMD_MONITOR_URL: `http://127.0.0.1:${server.address().port}/ingest`, TASKMD_MONITOR_API_KEY: `rm_${'a'.repeat(16)}_${'b'.repeat(64)}`, PREPARED_MODE: 'timeout' }, stdio: 'ignore',
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const exit = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  await running;
  child.kill('SIGINT');
  assert.equal(await exit, 130);
  const final = reports.at(-1);
  assert.equal(final.run.terminal_outcome, 'cancelled'); assert.equal(final.run.heartbeat_expected, false);
  if (process.env.MONITOR_REPORT_CAPTURE) fs.writeFileSync(path.join(process.env.MONITOR_REPORT_CAPTURE, 'interrupted.json'), JSON.stringify(reports.filter(report => report.kind !== 'probe')));
});
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
test('adapter accepts large tool events while bounding retained output', async t => {
  for (const client of ['codex', 'claude']) {
    const root = fixture(t), file = task(root, '001');
    const r = await run(root, 'large-event', ['--client', client], true);
    assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'empty');
    assert.equal(readTask(file).meta.status, 'completed');
    const folder = path.join(path.dirname(r.events.find(event => event.summary).summary), '001-001');
    const agent = JSON.parse(fs.readFileSync(path.join(folder, 'agent.json'), 'utf8'));
    assert.equal(agent.status, 'success'); assert.equal(agent.error, null);
    assert.equal(agent.truncated.stdout, true);
    assert.equal(agent.usage.inputTokens, 10);
    assert.ok(fs.statSync(path.join(folder, 'worker.jsonl')).size > 2 * 1024 * 1024);
  }
});
test('adapter reports event overflow and rejects a completed receipt', async t => {
  const root = fixture(t), file = task(root, '001');
  const r = await run(root, 'oversized-event', [], true);
  assert.equal(readTask(file).meta.status, 'blocked');
  assert.match(r.summary.rounds[0].error, /JSON event exceeds maxEventBytes \(16777216\)/);
  assert.equal(r.summary.rounds[0].recovery_reason, 'worker_error');
  assert.equal(r.summary.rounds.at(-1).blocked_reason, 'task_run_limit');
});
test('adapter reports provider errors even with a completed receipt and zero exit', async t => {
  for (const client of ['codex', 'claude']) {
    const root = fixture(t), file = task(root, '001');
    const r = await run(root, 'provider-error', ['--client', client], true);
    assert.equal(readTask(file).meta.status, 'blocked');
    assert.match(r.summary.rounds[0].error, /Prepared provider failure/);
    assert.equal(r.summary.rounds[0].recovery_reason, 'worker_error');
    assert.equal(r.summary.rounds.at(-1).blocked_reason, 'task_run_limit');
  }
});
test('Codex timeout retries within the task budget then continues independent work', async t => {
  const root = fixture(t), file = task(root, '001', { priority: 'critical' });
  const dependent = task(root, '002', { dependencies: ['001'] });
  const independent = task(root, '003');
  const r = await run(root, 'timeout-first', ['--timeout', '1'], true);
  assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
  assert.deepEqual(r.summary.rounds.map(row => row.task_id), ['001', '001', '001', '003']);
  assert.equal(readTask(file).meta.status, 'blocked'); assert.equal(taskRuns(file), 3);
  assert.equal(readTask(dependent).meta.status, 'pending');
  assert.equal(readTask(independent).meta.status, 'completed');
  assert.match(r.summary.rounds[0].error, /codex timed-out \(124\)/);
  assert.equal(r.summary.rounds[0].recovery_reason, 'timeout');
  assert.equal(r.summary.rounds[1].session_resumed, true);
  assert.equal(r.summary.rounds[2].blocked_reason, 'task_run_limit');
  assert.equal(r.summary.rounds[3].session_resumed, false);
  assert.equal(r.events.find(event => event.event === 'task_blocked').next_action, 'select_next_task');
  const folder = path.join(path.dirname(r.events.find(event => event.summary).summary), '001-001');
  const agent = JSON.parse(fs.readFileSync(path.join(folder, 'agent.json'), 'utf8'));
  assert.equal(agent.status, 'timed-out'); assert.equal(agent.code, 124);
  const pid = Number(fs.readFileSync(path.join(folder, 'worker.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
test('custom worker help flags remain worker arguments', async t => {
  const root = fixture(t); task(root, '001'); const r = await run(root, '--help');
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'empty');
});
test('Codex receives a deadline steer and resumes its graceful checkpoint', async t => {
  const root = fixture(t), file = task(root, '001');
  const r = await run(root, 'graceful-once', ['--timeout', '3'], true);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'empty');
  assert.deepEqual(r.summary.rounds.map(row => row.status), ['pending', 'completed']);
  assert.equal(r.summary.rounds[1].session_resumed, true); assert.equal(taskRuns(file), 2);
  const folder = path.join(path.dirname(r.events.find(event => event.summary).summary), '001-001');
  const rpc = fs.readFileSync(path.join(folder, 'rpc.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const steer = rpc.find(message => message.method === 'turn/steer').params;
  assert.equal(steer.threadId, 'prepared-thread'); assert.equal(steer.expectedTurnId, 'prepared-turn');
  assert.match(steer.input[0].text, /record a durable Progress checkpoint/);
  assert.equal(r.summary.rounds[0].handoff_requested, true);
  assert.ok(fs.existsSync(path.join(folder, 'handoff-request.json')));
  assert.match(fs.readFileSync(path.join(folder, 'worker.jsonl'), 'utf8'), /handoff.delivered/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'agent.json'), 'utf8')).status, 'success');
});
for (const [mode, adapter] of [['timeout-once', true], ['crash-once', true], ['crash-once', false]]) {
  test(`${adapter ? 'Codex' : 'custom worker'} recovers ${mode} on the next attempt`, async t => {
    const root = fixture(t), file = task(root, '001');
    const r = await run(root, mode, ['--timeout', '1'], adapter);
    assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'empty');
    assert.deepEqual(r.summary.rounds.map(row => row.status), ['pending', 'completed']);
    assert.equal(r.summary.rounds[0].next_action, 'retry_task');
    assert.equal(readTask(file).meta.status, 'completed'); assert.equal(taskRuns(file), 2);
    assert.equal(r.summary.blocked_tasks.length, 0);
    assert.equal(r.events.filter(event => event.event === 'task_retry').length, 1);
  });
}
test('worker recovery respects invocation caps and survives a runner restart', async t => {
  const root = fixture(t), file = task(root, '001');
  const first = await run(root, 'crash-once', ['--rounds', '1'], true);
  assert.equal(first.code, 0, first.stderr); assert.equal(first.summary.reason, 'round_limit');
  assert.equal(readTask(file).meta.status, 'pending'); assert.equal(taskRuns(file), 1);
  assert.equal(first.summary.rounds[0].recovery_reason, 'worker_error');
  const second = await run(root, 'crash-once', [], true);
  assert.equal(second.code, 0, second.stderr); assert.equal(readTask(file).meta.status, 'completed');
  assert.equal(taskRuns(file), 2);
});
test('blocked task permits independent work and leaves unfinished exit', async t => {
  const root = fixture(t); task(root, '001', { priority: 'critical' }); task(root, '002', { dependencies: ['001'] }); task(root, '003');
  const r = await run(root, 'blocked'); assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
  assert.deepEqual(r.summary.rounds.map(x => x.task_id), ['001', '003']);
  assert.equal(r.events.filter(event => event.event === 'response_clarification').length, 0);
});
for (const client of ['codex', 'claude', 'grok']) {
  test(`invalid response clarification repairs the handoff with ${client}`, async t => {
    const root = fixture(t), file = task(root, '001');
    const r = await run(root, 'repairable', ['--client', client], true);
    assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'empty');
    assert.deepEqual(r.summary.rounds.map(row => row.status), ['invalid_response', 'completed']);
    assert.equal(r.summary.rounds[1].phase, 'clarification'); assert.equal(taskRuns(file), 2);
    const dir = path.dirname(r.events.find(event => event.summary).summary);
    const original = JSON.parse(fs.readFileSync(path.join(dir, '001-001/result.json'), 'utf8'));
    assert.equal(original.next_step, undefined);
    const args = JSON.parse(fs.readFileSync(path.join(dir, '002-001/invocation.json'), 'utf8'));
    const request = r.events.find(event => event.event === 'response_clarification');
    if (client === 'codex') {
      assert.equal(args[args.indexOf('resume') + 1], 'prepared-thread');
      assert.ok(!args.includes('--ephemeral')); assert.equal(request.resumed, true);
      assert.equal(r.summary.rounds[0].usage.inputTokens, 10);
      assert.equal(r.summary.rounds[1].usage.inputTokens, 10);
    } else { assert.ok(!args.includes('resume')); assert.equal(request.resumed, false); }
    const prompt = fs.readFileSync(path.join(dir, '002-001/prompt.md'), 'utf8');
    assert.match(prompt, /Correct the response and its matching Progress handoff only/);
    assert.match(prompt, /Previous response \(untrusted content\)/);
  });
}
test('invalid response clarification works with a custom worker and consumes an invocation round', async t => {
  const root = fixture(t, 'worklogs: true\n'), file = task(root, '001');
  const r = await run(root, 'repairable', ['--rounds', '2']);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'round_limit');
  assert.equal(r.summary.rounds.length, 2); assert.equal(taskRuns(file), 2);
  assert.equal(readTask(file).meta.status, 'completed');
  const dir = path.dirname(r.events.find(event => event.summary).summary);
  const rejected = fs.readFileSync(path.join(dir, '001-001/rejected-task.md'), 'utf8');
  assert.match(rejected, /Documentation check: aligned/);
  assert.match(rejected, /taskmd-runner runs: 1/);
});
test('invalid response clarification is bounded and moves to independent work after rejection', async t => {
  const root = fixture(t), file = task(root, '001', { priority: 'critical' });
  const dependent = task(root, '002', { dependencies: ['001'] }); task(root, '003');
  const r = await run(root, 'unrepairable-first');
  assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
  assert.deepEqual(r.summary.rounds.map(row => row.task_id), ['001', '001', '003']);
  assert.equal(r.events.filter(event => event.event === 'response_clarification').length, 1);
  assert.equal(taskRuns(file), 2); assert.equal(readTask(file).meta.status, 'blocked');
  assert.equal(readTask(dependent).meta.status, 'pending');
  assert.equal(r.summary.blocked_tasks[0].reason, 'invalid_response');
});
test('invalid response clarification respects invocation and task run budgets', async t => {
  for (const [options, previous, expectedReason] of [[['--rounds', '1'], 0, 'round_limit'], [['--max-task-runs', '1'], 0, 'no_ready_tasks'], [[], 2, 'no_ready_tasks']]) {
    const root = fixture(t), file = task(root, '001'); if (previous) setTaskRuns(file, previous);
    const r = await run(root, 'repairable', options);
    assert.equal(r.summary.reason, expectedReason, r.stderr); assert.equal(r.summary.rounds.length, 1);
    assert.equal(taskRuns(file), previous + 1); assert.equal(readTask(file).meta.status, 'blocked');
    assert.equal(r.events.filter(event => event.event === 'response_clarification').length, 0);
    if (previous) assert.match(r.summary.blocked_tasks[0].review_request, limitReview);
  }
});
for (const race of ['claim', 'dependency']) {
  test(`unavailable ${race} selection is skipped without stopping independent work or spinning`, async t => {
    const root = fixture(t);
    task(root, '001', { status: race === 'dependency' ? 'blocked' : 'pending', priority: 'critical' });
    task(root, '002', { dependencies: race === 'dependency' ? ['001'] : [] });
    if (race === 'dependency') task(root, '003');
    const runner = new Runner(parseArgs(['--project', root, '--notify', 'off', '--timeout', '10', '--worker', process.execPath, fake, 'completed']));
    const cli = runner.cliJson.bind(runner); let injected = false, claims = 0;
    runner.cliJson = async (...args) => {
      if (race === 'dependency' && args[0] === 'next' && !injected) { injected = true; return [await cli('get', '002', '--exact', '--format', 'json')]; }
      const value = await cli(...args);
      if (race === 'claim' && args[0] === 'get' && args[1] === '001') { claims++; return { ...value, remote_only: true }; }
      return value;
    };
    assert.equal(await runner.run(), 2);
    const summary = JSON.parse(fs.readFileSync(path.join(runner.runDir, 'summary.json'), 'utf8'));
    assert.equal(summary.reason, 'no_ready_tasks');
    assert.deepEqual(summary.rounds.map(row => row.task_id), [race === 'claim' ? '002' : '003']);
    if (race === 'claim') assert.ok(claims <= 2);
    else assert.equal(readTask(path.join(root, 'tasks/002-task.md')).meta.status, 'pending');
  });
}
test('pending without checked progress retries within budget then continues independent work', async t => {
  const root = fixture(t), file = task(root, '001', { priority: 'critical' });
  const dependent = task(root, '002', { dependencies: ['001'] }); task(root, '003');
  const r = await run(root, 'pending-first');
  assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
  assert.deepEqual(r.summary.rounds.map(row => row.task_id), ['001', '001', '001', '003']);
  assert.equal(readTask(file).meta.status, 'blocked'); assert.equal(readTask(dependent).meta.status, 'pending');
  assert.equal(r.summary.rounds[0].recovery_reason, 'no_progress');
  assert.equal(r.summary.rounds[2].blocked_reason, 'task_run_limit');
  assert.equal(r.events.find(event => event.event === 'task_blocked').next_action, 'select_next_task');
});
for (const mode of ['false-completion', 'scope', 'status', 'malformed', 'exit', 'timeout']) {
  test(`${mode} blocks that task and continues independent work`, async t => {
    const root = fixture(t); const file = task(root, '001', { priority: 'critical' });
    const dependent = task(root, '002', { dependencies: ['001'] }); task(root, '003');
    const r = await run(root, mode + '-first', mode === 'timeout' ? ['--timeout', '0.1'] : []);
    assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
    const attempts = ['false-completion', 'malformed'].includes(mode) ? 2 : ['exit', 'timeout'].includes(mode) ? 3 : 1;
    assert.deepEqual(r.summary.rounds.map(row => row.task_id), [...Array(attempts).fill('001'), '003']);
    assert.equal(readTask(file).meta.status, 'blocked'); assert.equal(readTask(dependent).meta.status, 'pending');
    assert.equal(readTask(path.join(root, 'tasks/003-task.md')).meta.status, 'completed');
    assert.equal(r.events.find(event => event.event === 'task_blocked').next_action, 'select_next_task');
    if (mode === 'scope' || mode === 'status') assert.match(r.summary.rounds[0].error, /changed task scope, metadata or runner-owned status/);
    if (mode === 'scope') {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /# Changed scope/);
      const dir = path.dirname(r.events.find(event => event.summary).summary);
      assert.match(fs.readFileSync(path.join(dir, '001-001/rejected-task.md'), 'utf8'), /# Changed scope/);
    }
  });
}
test('verified partial slices continue with original acceptance open', async t => {
  const root = fixture(t); const file = task(root, '001'); const r = await run(root, 'partial', ['--rounds', '2']);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.rounds[1].checked_after, 0); assert.equal(r.summary.rounds[1].verified_after, 6);
  assert.match(fs.readFileSync(file, 'utf8'), /- \[ \] Deliver/);
});
test('early checkpoints share one charged run and absolute deadline without verified progress', async t => {
  const root = fixture(t), file = task(root, '001');
  const r = await run(root, 'early-twice', ['--rounds', '1'], true);
  assert.equal(r.code, 0, r.stderr); assert.equal(readTask(file).meta.status, 'completed');
  assert.equal(taskRuns(file), 1); assert.equal(r.summary.rounds.length, 1);
  const attempts = r.summary.rounds[0].attempts;
  assert.equal(attempts.length, 3); assert.deepEqual(attempts.map(x => x.reason), ['early_pending', 'early_pending', 'completed']);
  assert.equal(r.summary.rounds[0].usage.inputTokens, 30);
  assert.deepEqual(attempts.map(x => x.session_resumed), [false, true, true]);
  const prompts = attempts.map(x => fs.readFileSync(path.join(x.folder, 'prompt.md'), 'utf8'));
  assert.equal(new Set(prompts.map(x => x.match(/Deadline \(UTC\): (\S+)/)[1])).size, 1);
  const budgets = prompts.map(x => Number(x.match(/Worker budget: ([\d.]+)/)[1]));
  assert.ok(budgets[2] < budgets[1] && budgets[1] < budgets[0]);
  for (const a of attempts) assert.equal(JSON.parse(fs.readFileSync(path.join(a.folder, 'attempt.json'), 'utf8')).reason, a.reason);
});
test('context handoffs get fresh history and retain peak and final request telemetry', async t => {
  const root = fixture(t), file = task(root, '001');
  const r = await run(root, 'context-once', ['--rounds', '1'], true);
  assert.equal(r.code, 0, r.stderr); assert.equal(taskRuns(file), 1);
  const attempts = r.summary.rounds[0].attempts;
  assert.equal(attempts.length, 2); assert.equal(attempts[0].reason, 'reported_context_limit');
  assert.deepEqual(attempts[0].context, { last_input_tokens: 169838, peak_input_tokens: 449769, model_context_window: 475000 });
  assert.equal(attempts[1].session_resumed, false);
  const rpc = fs.readFileSync(path.join(attempts[1].folder, 'rpc.jsonl'), 'utf8');
  assert.match(rpc, /thread\/start/); assert.doesNotMatch(rpc, /thread\/resume/);
});
test('two early context handoffs then a near-deadline stop preserve the next run', async t => {
  const root = fixture(t), file = task(root, '001');
  const r = await run(root, 'mixed-handoffs', ['--timeout', '4']);
  assert.equal(r.code, 0, r.stderr); assert.equal(readTask(file).meta.status, 'completed');
  assert.equal(taskRuns(file), 2);
  const attempts = r.summary.rounds[0].attempts;
  assert.deepEqual(attempts.map(x => x.reason), ['reported_context_limit', 'reported_context_limit', 'deadline']);
  assert.ok(attempts[2].remaining_seconds <= 0.44);
  assert.ok(r.summary.rounds[0].elapsed_seconds < 4);
  const result = { status: 'pending', summary: 'Checkpoint', evidence: [], next_step: 'Continue' };
  assert.equal(pendingReason(result, 63, 7200), 'deadline');
  assert.equal(pendingReason(result, 1000, 7200), 'early_pending');
});
test('explicit provider context overflow retries with fresh history within durable limits', async t => {
  const root = fixture(t), file = task(root, '001');
  const r = await run(root, 'context-error-once', [], true);
  assert.equal(r.code, 0, r.stderr); assert.equal(taskRuns(file), 2);
  assert.deepEqual(r.summary.rounds.map(x => x.status), ['pending', 'completed']);
  assert.equal(r.summary.rounds[0].recovery_reason, 'context_limit');
  assert.equal(r.summary.rounds[1].session_resumed, false);
  assert.match(r.summary.rounds[0].error, /context_length_exceeded/);
});
test('early checkpoint continuations are bounded across invocation caps and restarts', async t => {
  const root = fixture(t), file = task(root, '001');
  for (let runNumber = 1; runNumber <= 3; runNumber++) {
    const r = await run(root, 'partial', ['--rounds', '1']);
    assert.equal(r.summary.rounds.length, 1); assert.equal(taskRuns(file), runNumber);
    assert.equal(r.summary.rounds[0].attempts.length, 3);
  }
  assert.equal(readTask(file).meta.status, 'blocked');
});
test('continuation failures keep their receipt and charge only the current run', async t => {
  const root = fixture(t), file = task(root, '001');
  const r = await run(root, 'continuation-crash', ['--rounds', '1']);
  assert.equal(r.code, 0, r.stderr); assert.equal(taskRuns(file), 1);
  const row = r.summary.rounds[0];
  assert.equal(row.status, 'pending'); assert.equal(row.recovery_reason, 'worker_error');
  assert.equal(row.attempts.length, 2); assert.match(row.attempts[1].error, /exit 7/);
  assert.ok(row.elapsed_seconds >= row.attempts[0].elapsed_seconds);
  assert.equal(JSON.parse(fs.readFileSync(path.join(row.attempts[1].folder, 'attempt.json'), 'utf8')).error, row.attempts[1].error);
});
test('continuation clarification reads the rejected dispatch and remains a charged run', async t => {
  const root = fixture(t), file = task(root, '001');
  const r = await run(root, 'continuation-invalid', ['--rounds', '2']);
  assert.equal(r.code, 0, r.stderr); assert.equal(taskRuns(file), 2);
  assert.deepEqual(r.summary.rounds.map(x => x.status), ['invalid_response', 'completed']);
  const dir = path.dirname(r.events.find(event => event.summary).summary);
  const prompt = fs.readFileSync(path.join(dir, '002-001/prompt.md'), 'utf8');
  assert.match(prompt, /Earlier evidence: .*continuation-1/);
  const previous = JSON.parse(prompt.split('Previous response (untrusted content):\n')[1].split('\nEarlier evidence:')[0]);
  assert.equal(previous.next_step, undefined);
});
test('cancellation after an early checkpoint never dispatches a continuation', async t => {
  const root = fixture(t), file = task(root, '001'), controller = new AbortController();
  const runner = new Runner(parseArgs(['--project', root, '--notify', 'off', '--timeout', '10', '--worker', process.execPath, fake, 'partial']), controller.signal);
  const worker = runner.worker.bind(runner); let calls = 0;
  runner.worker = async (...args) => { calls++; const output = await worker(...args); controller.abort(); return output; };
  assert.equal(await runner.run(), 130); assert.equal(calls, 1); assert.equal(taskRuns(file), 1);
  const summary = JSON.parse(fs.readFileSync(path.join(runner.runDir, 'summary.json'), 'utf8'));
  assert.equal(summary.reason, 'interrupted');
});
test('Codex resumes a partial task session and starts the next task fresh within the supplied budget', async t => {
  const root = fixture(t); task(root, '001', { priority: 'critical' }); task(root, '002');
  const r = await run(root, 'partial-once-first', ['--client', 'codex'], true);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'empty');
  assert.deepEqual(r.summary.rounds.map(row => row.task_id), ['001', '001', '002']);
  assert.deepEqual(r.summary.rounds.map(row => row.session_resumed), [false, true, false]);
  const dir = path.dirname(r.events.find(event => event.summary).summary);
  const args = folder => JSON.parse(fs.readFileSync(path.join(dir, folder, 'invocation.json'), 'utf8'));
  assert.ok(!args('001-001').includes('resume'));
  const continued = args('002-001'); assert.equal(continued[continued.indexOf('resume') + 1], 'prepared-thread');
  const rpc = fs.readFileSync(path.join(dir, '002-001/rpc.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rpc.find(message => message.method === 'thread/resume').params.excludeTurns, true);
  assert.ok(!args('003-002').includes('resume'));
  const prompt = fs.readFileSync(path.join(dir, '001-001/prompt.md'), 'utf8');
  const deadline = Date.parse(prompt.match(/Deadline \(UTC\): ([\dT:.-]+Z)/)[1]);
  const supplied = deadline - Date.parse(r.summary.rounds[0].started_at);
  assert.ok(supplied >= 10000 && supplied < 12000, String(supplied));
  assert.ok(Number(prompt.match(/Worker budget: ([\d.]+) seconds/)[1]) <= 10);
  assert.equal(Number(prompt.match(/Reserve the final ([\d.]+) seconds/)[1]), 1);
});
test('Codex isolates persistent history and reuses profile inputs across continuations', async t => {
  const root = fixture(t); task(root, '001');
  const profile = path.join(root, 'prepared-profile'); fs.mkdirSync(profile);
  const inputs = { 'auth.json': '{"prepared":"credential"}', 'config.toml': 'sqlite_home = "/shared/state"\n',
    'AGENTS.md': 'Prepared instructions', 'hooks.json': '{}', '.credentials.json': '{}', 'worker.config.toml': '' };
  for (const [name, content] of Object.entries(inputs)) fs.writeFileSync(path.join(profile, name), content);
  for (const name of ['sessions', 'archived_sessions', 'skills', 'rules', 'plugins']) fs.mkdirSync(path.join(profile, name));
  fs.writeFileSync(path.join(profile, 'sessions/manual.json'), 'existing user chat');
  fs.writeFileSync(path.join(profile, 'state.sqlite'), 'existing user index');
  const before = fs.readdirSync(profile).sort();
  const state = path.join(root, 'separate-state');
  const r = await run(root, 'partial-once', ['--state-dir', state], true, { CODEX_SQLITE_HOME: '/shared/env-state' });
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.rounds[1].session_resumed, true);
  const dir = path.dirname(r.events.find(event => event.summary).summary), home = path.join(dir, 'codex-home');
  assert.ok(dir.startsWith(state + path.sep));
  for (const round of ['001-001', '002-001']) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, round, 'server-home.json'))).home, home);
    const argv = JSON.parse(fs.readFileSync(path.join(dir, round, 'server-argv.json')));
    assert.ok(argv.includes(`sqlite_home=${JSON.stringify(home)}`));
    assert.ok(argv.includes(`log_dir=${JSON.stringify(path.join(home, 'log'))}`));
    const mcp = argv.find(arg => arg.startsWith('mcp_servers.taskmd_runner='));
    assert.ok(mcp?.includes('"mcp","--self"'), 'Codex receives the self-scoped runner MCP');
    assert.ok(mcp.includes('env_vars=["TASKMD_RUNNER_SELF_ID","TASKMD_RUNNER_SELF_ENDPOINT","TASKMD_RUNNER_SELF_TOKEN"]'));
    assert.doesNotMatch(mcp, /http:\/\/127\.0\.0\.1|Bearer/);
  }
  for (const name of [...Object.keys(inputs), 'skills', 'rules', 'plugins'])
    assert.equal(fs.realpathSync(path.join(home, name)), fs.realpathSync(path.join(profile, name)));
  assert.ok(!fs.lstatSync(path.join(home, 'sessions')).isSymbolicLink());
  assert.equal(fs.existsSync(path.join(home, 'archived_sessions')), false);
  assert.equal(fs.existsSync(path.join(home, 'state.sqlite')), false);
  assert.deepEqual(fs.readdirSync(profile).sort(), before);
  assert.deepEqual(fs.readdirSync(path.join(profile, 'sessions')), ['manual.json']);
  assert.equal(fs.readFileSync(path.join(profile, 'sessions/manual.json'), 'utf8'), 'existing user chat');
  assert.equal(fs.readFileSync(path.join(profile, 'state.sqlite'), 'utf8'), 'existing user index');
  for (const [name, content] of Object.entries(inputs)) assert.equal(fs.readFileSync(path.join(profile, name), 'utf8'), content);
});
test('Codex shared history requires an explicit session policy', async t => {
  const root = fixture(t); task(root, '001');
  const profile = path.join(root, 'prepared-profile'); fs.mkdirSync(profile);
  const r = await run(root, 'completed', ['--codex-session-policy', 'shared'], true);
  assert.equal(r.code, 0, r.stderr);
  const dir = path.dirname(r.events.find(event => event.summary).summary), folder = path.join(dir, '001-001');
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'server-home.json'))).home, profile);
  assert.ok(fs.existsSync(path.join(profile, 'sessions/prepared-thread.json')));
  assert.equal(fs.existsSync(path.join(dir, 'codex-home')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'server-argv.json'))).some(arg => arg.startsWith('sqlite_home=')), false);
  assert.throws(() => parseArgs(['--project', root, '--codex-session-policy', 'hidden']), /Invalid Codex session policy/);
  assert.throws(() => parseArgs(['--project', root, '--codex-session-policy', '']), /Invalid Codex session policy/);
});
test('Codex starts a fresh continuation when the task contract changes between runs', async t => {
  const root = fixture(t), file = task(root, '001');
  const runner = new Runner(parseArgs(['--project', root, '--notify', 'off', '--timeout', '10', '--executable', fake]));
  const cli = runner.cliJson.bind(runner); let changed = false;
  runner.cliJson = async (...args) => {
    if (args[0] === 'next' && runner.rows.length === 1 && !changed) {
      changed = true; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('# Task', '# Updated task'));
    }
    return cli(...args);
  };
  // The prepared executable uses this deterministic scenario without provider access.
  const worker = runner.worker.bind(runner);
  runner.worker = async (...args) => {
    const old = process.env.PREPARED_MODE; process.env.PREPARED_MODE = 'partial-once';
    try { return await worker(...args); }
    finally { if (old === undefined) delete process.env.PREPARED_MODE; else process.env.PREPARED_MODE = old; }
  };
  assert.equal(await runner.run(), 0); assert.equal(changed, true);
  assert.deepEqual(runner.rows.map(row => row.session_resumed), [false, false]);
  const args = JSON.parse(fs.readFileSync(path.join(runner.runDir, '002-001/invocation.json'), 'utf8'));
  assert.ok(!args.includes('resume')); assert.equal(readTask(file).meta.status, 'completed');
});
test('task run limits default to five maximum and three unfinished runs and require positive integers', () => {
  const defaults = parseArgs(['--project', '/tmp']);
  assert.equal(defaults.maxTaskRuns, 5); assert.equal(defaults.blockAfterRuns, 3);
  for (const flag of ['--max-task-runs', '--block-after-runs']) {
    for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'])
      assert.throws(() => parseArgs(['--project', '/tmp', flag, value]), /positive integer/);
  }
});
test('task run limits block after three partial runs and continue independent work', async t => {
  const root = fixture(t), file = task(root, '001', { priority: 'critical' });
  const dependent = task(root, '002', { dependencies: ['001'] });
  const successor = task(root, '003');
  const r = await run(root, 'partial-first');
  assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
  assert.deepEqual(r.summary.rounds.map(row => row.task_id), ['001', '001', '001', '003']);
  const last = r.summary.rounds[2];
  assert.equal(last.task_run, 3); assert.equal(last.status, 'blocked'); assert.equal(last.result.status, 'pending');
  assert.equal(last.blocked_reason, 'task_run_limit'); assert.equal(taskRuns(file), 3);
  assert.equal(readTask(file).meta.status, 'blocked'); assert.equal(readTask(dependent).meta.status, 'pending');
  assert.equal(readTask(successor).meta.status, 'completed');
  assert.match(fs.readFileSync(file, 'utf8'), /Task run limit reached \(3\/3\)/);
  assert.match(fs.readFileSync(file, 'utf8'), limitReview);
  assert.match(last.review_request, limitReview);
  assert.equal(r.summary.blocked_tasks[0].review_request, last.review_request);
  const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(r.events.find(event => event.summary).summary), '003-001/receipt.json'), 'utf8'));
  assert.equal(receipt.review_request, last.review_request);
  assert.equal(r.summary.blocked_tasks[0].task_id, '001');
});
test('task run limits enforce a lower maximum and allow five runs with a raised blocking threshold', async t => {
  for (const [options, limit] of [[['--max-task-runs', '2'], 2], [['--block-after-runs', '10'], 5]]) {
    const root = fixture(t), file = task(root, '001');
    const r = await run(root, 'partial', options);
    assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.rounds.length, limit);
    assert.equal(taskRuns(file), limit); assert.equal(readTask(file).meta.status, 'blocked');
  }
});
test('task run limits persist across restarts, state directories and native worklog compaction', async t => {
  const root = fixture(t, 'worklogs: true\n'), file = task(root, '001');
  const first = await run(root, 'partial', ['--rounds', '2']);
  assert.equal(first.code, 0, first.stderr); assert.equal(taskRuns(file), 2);
  const second = await run(root, 'partial', ['--state-dir', path.join(root, 'other-state')]);
  assert.equal(second.code, 2, second.stderr); assert.equal(second.summary.rounds.length, 1);
  assert.equal(second.summary.rounds[0].task_run, 3); assert.equal(taskRuns(file), 3);
  assert.match(fs.readFileSync(path.join(root, 'tasks/.worklogs/001.md'), 'utf8'), /Task run limit reached/);
  assert.match(fs.readFileSync(path.join(root, 'tasks/.worklogs/001.md'), 'utf8'), limitReview);
});
test('task run limits accept completion and PR review on the final allowed run', async t => {
  for (const [config, mode, expected] of [['', 'completed', 0], ['workflow: pr-review\n', 'in-review', 2]]) {
    const root = fixture(t, config), file = task(root, '001'); setTaskRuns(file, 2);
    const r = await run(root, mode);
    assert.equal(r.code, expected, r.stderr); assert.equal(r.summary.rounds[0].status, mode);
    assert.equal(taskRuns(file), 3); assert.deepEqual(r.summary.blocked_tasks, []);
  }
});
test('task run limits skip already exhausted tasks without consuming worker rounds', async t => {
  const root = fixture(t), file = task(root, '001', { priority: 'critical' }); setTaskRuns(file, 3);
  task(root, '002');
  const r = await run(root, 'completed', ['--rounds', '1']);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.summary.reason, 'round_limit');
  assert.deepEqual(r.summary.rounds.map(row => row.task_id), ['002']);
  assert.equal(readTask(file).meta.status, 'blocked'); assert.equal(taskRuns(file), 3);
  assert.equal(r.summary.blocked_tasks[0].task_id, '001');
  assert.match(r.summary.blocked_tasks[0].review_request, limitReview);
  assert.match(fs.readFileSync(file, 'utf8'), limitReview);
});
test('task run limits preserve a charged attempt after worker counter tampering', async t => {
  const root = fixture(t), file = task(root, '001');
  const r = await run(root, 'counter');
  assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
  assert.match(r.summary.rounds[0].error, /runner-owned status\/counter/);
  assert.equal(taskRuns(file), 1); assert.equal(readTask(file).meta.status, 'blocked');
});
test('task run limits preserve an existing counter in CRLF task files', async t => {
  const root = fixture(t), file = task(root, '001'); setTaskRuns(file, 2);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('\n', '\r\n'));
  const r = await run(root, 'completed');
  assert.equal(r.code, 0, r.stderr); assert.equal(taskRuns(file), 3);
  assert.equal(r.summary.rounds[0].status, 'completed');
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
test('task file references keep large scope and history out of continuation prompts', async t => {
  const root = fixture(t, '', 'taskmd ts '), file = task(root, '001');
  const scope = 'task-body-only-marker ' + 'required scope '.repeat(2000);
  const history = '\n## Progress\n\nold-audit-marker\n\n' + 'historical receipt\n\n'.repeat(1000) + 'Next: selected PATCH fixture\n';
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('# Task', '# Task\n\n' + scope) + history);
  const r = await run(root, 'early-twice', ['--rounds', '1']);
  assert.equal(r.code, 0, r.stderr); assert.equal(readTask(file).meta.status, 'completed');
  assert.equal(taskRuns(file), 1); assert.ok(readTask(file).body.includes(scope));
  const attempts = r.summary.rounds[0].attempts;
  assert.equal(attempts.length, 3);
  const prompts = attempts.map(x => fs.readFileSync(path.join(x.folder, 'prompt.md'), 'utf8'));
  const stable = fs.readFileSync(path.join(ROOT, 'WORKER.md'), 'utf8') + '\nResult schema:\n' + fs.readFileSync(path.join(ROOT, 'result.schema.json'), 'utf8') + '\n';
  for (const prompt of prompts) {
    assert.ok(prompt.startsWith(stable)); assert.ok(prompt.includes(`\nTask file: ${fs.realpathSync(file)}\n`));
    assert.doesNotMatch(prompt, /task-body-only-marker|old-audit-marker|selected PATCH fixture|Selected task:/);
    assert.ok(Buffer.byteLength(prompt) < Buffer.byteLength(scope));
  }
  assert.equal(new Set(prompts.map(x => x.split('\nResult file:')[0])).size, 1);
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
      const messages = fs.readFileSync(path.join(folder, '001-001/rpc.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      const thread = messages.find(message => message.method === 'thread/start').params;
      const turn = messages.find(message => message.method === 'turn/start').params;
      assert.equal(messages.find(message => message.method === 'initialize').params.clientInfo.version,
        JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
      assert.equal(thread.sandbox, 'workspace-write'); assert.equal(thread.approvalPolicy, 'never');
      assert.equal(thread.model, 'gpt-6.1-sol'); assert.equal(turn.effort, 'medium');
      assert.deepEqual(turn.outputSchema, JSON.parse(fs.readFileSync(path.join(ROOT, 'result.schema.json'), 'utf8')));
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
for (const adapter of [false, true]) test(`SIGTERM reaps ${adapter ? 'Codex' : 'custom'} worker and releases the lock without retrying`, async t => {
  const root = fixture(t); const file = task(root, '001');
  const child = spawn(process.execPath, [path.join(ROOT, 'bin/taskmd-runner.js'), '--project', root, '--notify', 'off',
    ...(adapter ? ['--executable', fake] : ['--worker', process.execPath, fake, 'timeout'])], { env: { ...process.env, TASKMD_MONITOR: 'off', PREPARED_MODE: 'timeout' } });
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
    const summary = JSON.parse(fs.readFileSync(final.summary));
    assert.equal(summary.reason, 'interrupted'); assert.equal(summary.rounds.length, 1);
    assert.doesNotMatch(stdout, /"event":"task_retry"/);
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
  assert.equal(parseArgs(['--project', '/tmp']).timeout, 7200);
  assert.equal(parseArgs(['--project', '/tmp', '--timeout', '60']).timeout, 60);
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
  test(`documentation guard rejects ${mode} after clarification and continues independent work`, async t => {
    const root = fixture(t); const file = task(root, '001'); task(root, '002');
    if (mode === 'stale-docs') fs.appendFileSync(file, '\n## Progress\n\nDocumentation check: aligned — README.md; old round evidence\n');
    const r = await run(root, mode + '-first');
    assert.equal(r.code, 2, r.stderr); assert.equal(r.summary.reason, 'no_ready_tasks');
    assert.equal(r.summary.rounds.length, 3); assert.equal(readTask(file).meta.status, 'blocked');
    assert.match(r.summary.rounds[0].error, /Documentation check/);
    assert.equal(readTask(path.join(root, 'tasks/002-task.md')).meta.status, 'completed');
  });
}

test('scoped runner can finish beside a disjoint owner while Git sync remains exclusive', async t => {
  const root = fixture(t);
  task(root, '001', { directory: 'astro' });
  fs.mkdirSync(path.join(root, 'tasks/api/documentation'), { recursive: true });
  const tasks = fs.realpathSync(path.join(root, 'tasks'));
  const release = await acquireTaskLock(tasks, () => {}, [path.join(tasks, 'api/documentation')]);
  try {
    const synced = await run(root, 'exit', ['--task-prefix', 'astro', '--git-sync']);
    assert.equal(synced.code, 1); assert.match(synced.stderr, /Another runner/);
    const scoped = await run(root, 'completed', ['--task-prefix', 'astro']);
    assert.equal(scoped.code, 0, scoped.stderr); assert.equal(scoped.summary.rounds[0].task_id, '001');
    assert.equal(fs.existsSync(path.join(tasks, '.taskmd-runner.lease/owners.json')), true);
  } finally { await release(); }
});

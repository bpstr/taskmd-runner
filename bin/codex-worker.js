#!/usr/bin/env node
// Keep the adapter's process ownership and JSON-event contract, with a steerable Codex turn.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createOutputParser } from '@bpstr/agent-adapter';
const args = process.argv.slice(2);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const effortConfig = args.find(arg => arg.startsWith('model_reasoning_effort='));
const effort = effortConfig ? JSON.parse(effortConfig.slice(effortConfig.indexOf('=') + 1)) : undefined;
const resume = value('resume');
const isolatedHome = process.env.TASKMD_CODEX_ISOLATED_HOME;
const child = spawn(process.env.TASKMD_CODEX_EXECUTABLE || 'codex',
  ['app-server', '--listen', 'stdio://', '-c', 'approval_policy="never"',
    ...(isolatedHome ? ['-c', `sqlite_home=${JSON.stringify(isolatedHome)}`, '-c', `log_dir=${JSON.stringify(path.join(isolatedHome, 'log'))}`] : [])],
  { stdio: ['pipe', 'pipe', 'inherit'] });
const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
const pending = new Map();
const serverLog = fs.createWriteStream(path.join(process.env.TASKMD_ROUND_DIR, 'codex-server.jsonl'));
let nextId = 0, threadId, turnId, finalText = '', usage, ended = false, handoffTimer, shutdownTimer;
const send = message => child.stdin.write(JSON.stringify(message) + '\n');
const request = (method, params) => new Promise((resolve, reject) => {
  const id = ++nextId; pending.set(id, { resolve, reject });
  send({ id, method, params });
});
const shutdown = () => {
  clearTimeout(handoffTimer);
  child.stdin.end();
  shutdownTimer = setTimeout(() => child.kill('SIGTERM'), 500);
};
const fail = error => {
  if (ended) return;
  ended = true; process.exitCode = 1;
  emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  shutdown();
};
const steer = async () => {
  if (ended || !turnId) return;
  emit({ type: 'handoff.requested', thread_id: threadId, turn_id: turnId });
  try {
    await request('turn/steer', { threadId, expectedTurnId: turnId,
      input: [{ type: 'text', text: process.env.TASKMD_HANDOFF_MESSAGE, text_elements: [] }] });
    emit({ type: 'handoff.delivered', thread_id: threadId, turn_id: turnId });
  } catch (error) {
    if (!ended) emit({ type: 'handoff.warning', message: String(error) });
  }
};
const receive = message => {
  if (message.id !== undefined && !message.method) {
    const waiter = pending.get(message.id); if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
    return;
  }
  if (message.id !== undefined) {
    send({ id: message.id, error: { code: -32601, message: 'Unattended worker requires a noninteractive task handoff' } });
    return;
  }
  const p = message.params || {};
  if (p.threadId && threadId && p.threadId !== threadId) return;
  if (p.turnId && turnId && p.turnId !== turnId) return;
  if (message.method === 'item/completed' && p.item?.type === 'agentMessage') finalText = p.item.text;
  if (message.method === 'thread/tokenUsage/updated') usage = p.tokenUsage?.last;
  if (message.method === 'turn/completed') {
    if (ended) return;
    if (turnId && p.turn?.id !== turnId) return;
    if (p.turn?.status !== 'completed') { fail(new Error(p.turn?.error?.message || `Codex turn ${p.turn?.status}`)); return; }
    if (finalText.trim()) {
      fs.writeFileSync(process.env.TASKMD_RESULT_FILE, finalText);
      emit({ type: 'item.completed', item: { type: 'agent_message', text: finalText } });
    }
    ended = true;
    emit({ type: 'turn.completed', ...(usage ? { usage: {
      input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cached_input_tokens: usage.cachedInputTokens,
    } } : {}) });
    shutdown();
  }
};
const parser = createOutputParser('codex-json', event => {
  try {
    if (event.type === 'raw') { emit(event.data); receive(event.data); }
    if (event.type === 'error') fail(new Error(event.message));
  } catch (error) { fail(error); }
}, 16 * 1024 * 1024);
child.stdout.on('data', chunk => { serverLog.write(chunk); parser.write(chunk); });
serverLog.on('error', fail);
child.stdin.on('error', error => { if (error.code !== 'EPIPE') fail(error); });
child.once('error', fail);
child.once('close', code => {
  clearTimeout(handoffTimer); clearTimeout(shutdownTimer); parser.end();
  serverLog.end();
  for (const waiter of pending.values()) waiter.reject(new Error('Codex app-server exited'));
  pending.clear();
  if (!ended) { ended = true; process.exitCode = code || 1; emit({ type: 'error', message: `Codex app-server exited before completing the turn (${code})` }); }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearTimeout(handoffTimer);
  if (threadId && turnId && !ended) request('turn/interrupt', { threadId, turnId }).catch(() => {});
});
try {
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  await request('initialize', { clientInfo: { name: 'taskmd_runner', title: 'Taskmd Runner', version } });
  send({ method: 'initialized', params: {} });
  const config = { cwd: process.cwd(), approvalPolicy: 'never',
    sandbox: args.includes('--dangerously-bypass-approvals-and-sandbox') ? 'danger-full-access' : process.env.TASKMD_CODEX_SANDBOX || 'workspace-write',
    ...(value('--model') ? { model: value('--model') } : {}) };
  const response = await request(resume ? 'thread/resume' : 'thread/start',
    { ...config, ...(resume ? { threadId: resume, excludeTurns: true } : { ephemeral: args.includes('--ephemeral') }) });
  threadId = response.thread.id;
  emit({ type: 'thread.started', thread_id: threadId });
  const turn = await request('turn/start', { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }],
    ...(effort ? { effort } : {}), outputSchema: JSON.parse(fs.readFileSync(process.env.TASKMD_RESULT_SCHEMA, 'utf8')) });
  turnId = turn.turn.id;
  if (!ended && process.env.TASKMD_HANDOFF_AT) handoffTimer = setTimeout(steer, Math.max(0, Number(process.env.TASKMD_HANDOFF_AT) - Date.now()));
} catch (error) { fail(error); }

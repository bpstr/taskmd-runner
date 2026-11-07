// Prepared app-server protocol. Child fixtures never contact a provider.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createOutputParser } from '@bpstr/agent-adapter';

const emit = message => process.stdout.write(JSON.stringify(message) + '\n');
const threadId = 'prepared-thread', turnId = 'prepared-turn';
let config, resumed = false, startParams, waiting = false;
const folder = process.env.TASKMD_ROUND_DIR;
fs.writeFileSync(path.join(folder, 'server-argv.json'), JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(path.join(folder, 'server-home.json'), JSON.stringify({ home: process.env.CODEX_HOME }));
const perform = mode => {
  const args = ['exec', ...(resumed ? ['resume', threadId] : []), '--sandbox', config.sandbox,
    '-c', 'approval_policy="never"', '--output-schema', process.env.TASKMD_RESULT_SCHEMA];
  const worker = spawn(process.execPath, [process.argv[1], ...args], {
    env: { ...process.env, PREPARED_MODE: mode }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  let failure, finished = false;
  const notify = (method, params) => emit({ method, params: { threadId, turnId, ...params } });
  const parser = createOutputParser('codex-json', event => {
    if (event.type !== 'raw') return;
    const e = event.data;
    if (e.type === 'error') failure = e.message;
    if (e.type === 'item.completed') notify('item/completed', { item: e.item.type === 'agent_message'
      ? { type: 'agentMessage', text: e.item.text } : { type: 'commandExecution', aggregatedOutput: e.item.aggregated_output } });
    if (e.type === 'turn.completed') {
      const u = e.usage;
      const pressure = mode === 'context-once';
      if (pressure) notify('thread/tokenUsage/updated', { tokenUsage: { modelContextWindow: 475000, last: { inputTokens: 449769, outputTokens: 2, cachedInputTokens: 0 } } });
      notify('thread/tokenUsage/updated', { tokenUsage: { modelContextWindow: 475000, last: { inputTokens: pressure ? 169838 : u.input_tokens, outputTokens: u.output_tokens, cachedInputTokens: 0 } } });
      finished = true;
      notify('turn/completed', { turn: { id: turnId, status: failure ? 'failed' : 'completed', error: failure ? { message: failure } : null } });
    }
  }, 32 * 1024 * 1024);
  worker.stdout.on('data', chunk => parser.write(chunk));
  worker.on('close', code => {
    parser.end();
    if (!finished) notify('turn/completed', { turn: { id: turnId, status: 'failed', error: { message: `Prepared worker exit ${code}` } } });
  });
  worker.stdin.end(startParams.input[0].text);
};
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line), p = message.params || {};
  fs.appendFileSync(path.join(folder, 'rpc.jsonl'), JSON.stringify(message) + '\n');
  if (message.id === undefined) continue;
  if (message.method === 'initialize') emit({ id: message.id, result: {} });
  else if (message.method === 'thread/start' || message.method === 'thread/resume') {
    config = p; resumed = message.method === 'thread/resume';
    const session = path.join(process.env.CODEX_HOME, 'sessions', threadId + '.json');
    if (resumed && !fs.existsSync(session)) {
      emit({ id: message.id, error: { message: 'Prepared session missing from worker profile' } }); continue;
    }
    if (!resumed && !p.ephemeral) {
      fs.mkdirSync(path.dirname(session), { recursive: true }); fs.writeFileSync(session, '{}');
    }
    emit({ id: message.id, result: { thread: { id: threadId } } });
  } else if (message.method === 'turn/start') {
    startParams = p;
    emit({ id: message.id, result: { turn: { id: turnId, status: 'inProgress' } } });
    const mode = process.env.PREPARED_MODE || 'completed';
    waiting = mode === 'graceful-once' && /taskmd-runner runs: 1 -->/.test(fs.readFileSync(process.env.TASKMD_TASK_FILE, 'utf8'));
    if (waiting) fs.writeFileSync(path.join(folder, 'worker.pid'), String(process.pid));
    else perform(mode === 'graceful-once' ? 'completed' : mode);
  } else if (message.method === 'turn/steer') {
    emit({ id: message.id, result: { turnId } });
    if (waiting) { waiting = false; perform('partial'); }
  } else if (message.method === 'turn/interrupt') {
    emit({ id: message.id, result: {} });
  } else emit({ id: message.id, error: { code: -32601, message: 'Unsupported prepared request' } });
}

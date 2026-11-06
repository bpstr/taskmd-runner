#!/usr/bin/env node
// Prepared process only. No provider SDK, network, credentials or live recording.
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
let mode = process.env.PREPARED_MODE || process.argv[2] || 'completed';
let prompt = '';
if (process.argv.some(arg => arg.startsWith('--single='))) prompt = process.argv.find(arg => arg.startsWith('--single=')).slice(9);
else for await (const chunk of process.stdin) prompt += chunk;
if (!prompt.includes('Selected task:')) throw new Error('Missing selected task prompt');
const file = process.env.TASKMD_TASK_FILE, output = process.env.TASKMD_RESULT_FILE;
fs.writeFileSync(path.join(process.env.TASKMD_ROUND_DIR, 'invocation.json'), JSON.stringify(process.argv.slice(2)));
if (mode.endsWith('-first')) mode = path.basename(file).startsWith('001-') ? mode.slice(0, -6) : 'completed';
if (mode === 'partial-once') mode = /taskmd-runner runs: 1 -->/.test(fs.readFileSync(file, 'utf8')) ? 'partial' : 'completed';
if (mode === 'repairable') mode = prompt.includes('\nClarification request:\n') ? 'completed' : 'invalid-fields';
if (mode === 'unrepairable') mode = 'invalid-fields';
if (mode === 'timeout') {
  fs.writeFileSync(path.join(process.env.TASKMD_ROUND_DIR, 'worker.pid'), String(process.pid));
  await new Promise(resolve => setTimeout(resolve, 60000));
}
if (mode === 'exit') process.exit(7);
if (mode === 'malformed') { fs.writeFileSync(output, 'invalid json'); process.exit(0); }
let text = fs.readFileSync(file, 'utf8');
if (mode === 'partial') text += '\n- [x] Verified slice ' + path.basename(process.env.TASKMD_ROUND_DIR) + ': prepared evidence passes\n';
if (!['pending', 'blocked', 'false-completion', 'partial'].includes(mode)) text = text.replaceAll('- [ ]', '- [x]');
if (mode === 'scope') text = text.replace('# Task', '# Changed scope');
if (mode === 'status') text = text.replace('status: in-progress', 'status: completed');
if (mode === 'counter') text = text.replace(/<!-- taskmd-runner runs: \d+ -->/, '');
if (mode === 'in-review') {
  const parts = text.split('---'); const meta = parse(parts[1]);
  meta.pr = ['https://github.com/example/project/pull/1'];
  text = '---\n' + stringify(meta) + '---' + parts.slice(2).join('---');
}
const docs = 'Documentation check: aligned — README.md; the prepared ticket matches the documented fixture contract';
if (!['missing-docs', 'stale-docs'].includes(mode)) text += '\n\n' + docs + '\n';
fs.writeFileSync(file, text);
const result = { status: mode === 'partial' ? 'pending' : ['pending', 'blocked', 'in-review'].includes(mode) ? mode : 'completed',
  summary: 'Prepared worker result', evidence: ['prepared selector: 1 passed'], next_step: 'Fixture owner supplies prerequisite; retry after input changes' };
if (mode === 'partial') result.next_step = 'Prepared context-limit handoff: continue the next fixture criterion using the retained evidence.';
if (!['missing-docs', 'missing-docs-evidence'].includes(mode)) result.evidence.push(docs);
if (mode === 'invalid-fields') delete result.next_step;
if (mode !== 'text-only') fs.writeFileSync(output, JSON.stringify(result));
if (process.argv.includes('exec')) {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'prepared-thread' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(result) } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }));
} else if (process.argv.includes('--output-format')) {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(result), usage: { input_tokens: 10, output_tokens: 2 } }));
} else if (process.argv.some(arg => arg.startsWith('--single='))) console.log(JSON.stringify(result));
else console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }));

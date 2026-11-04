#!/usr/bin/env node
// Prepared process only. No provider SDK, network, credentials or live recording.
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
const mode = process.env.PREPARED_MODE || process.argv[2] || 'completed';
let prompt = '';
if (process.argv.some(arg => arg.startsWith('--single='))) prompt = process.argv.find(arg => arg.startsWith('--single=')).slice(9);
else for await (const chunk of process.stdin) prompt += chunk;
if (!prompt.includes('Selected task:')) throw new Error('Missing selected task prompt');
if (mode === 'timeout') {
  fs.writeFileSync(path.join(process.env.TASKMD_ROUND_DIR, 'worker.pid'), String(process.pid));
  await new Promise(resolve => setTimeout(resolve, 60000));
}
if (mode === 'exit') process.exit(7);
const file = process.env.TASKMD_TASK_FILE, output = process.env.TASKMD_RESULT_FILE;
if (mode === 'malformed') { fs.writeFileSync(output, 'invalid json'); process.exit(0); }
let text = fs.readFileSync(file, 'utf8');
if (mode === 'partial') text += '\n- [x] Verified slice ' + path.basename(process.env.TASKMD_ROUND_DIR) + ': prepared evidence passes\n';
if (!['pending', 'blocked', 'false-completion', 'partial'].includes(mode)) text = text.replaceAll('- [ ]', '- [x]');
if (mode === 'scope') text = text.replace('# Task', '# Changed scope');
if (mode === 'status') text = text.replace('status: in-progress', 'status: completed');
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
if (!['missing-docs', 'missing-docs-evidence'].includes(mode)) result.evidence.push(docs);
if (mode !== 'text-only') fs.writeFileSync(output, JSON.stringify(result));
if (process.argv.includes('exec')) {
  fs.writeFileSync(path.join(process.env.TASKMD_ROUND_DIR, 'invocation.json'), JSON.stringify(process.argv.slice(2)));
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'prepared-thread' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(result) } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }));
} else if (process.argv.includes('--output-format')) {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(result), usage: { input_tokens: 10, output_tokens: 2 } }));
} else if (process.argv.some(arg => arg.startsWith('--single='))) console.log(JSON.stringify(result));
else console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }));

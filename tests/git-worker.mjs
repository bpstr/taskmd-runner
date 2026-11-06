#!/usr/bin/env node
// Prepared Git fixture. Only local repositories and the existing fake worker.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
if (process.argv.includes('app-server')) { await import('./fake-codex-server.mjs'); process.exit(); }
const single = process.argv.find(arg => arg.startsWith('--single='));
let prompt = single ? single.slice(9) : '';
if (!single) for await (const chunk of process.stdin) prompt += chunk;
const git = (repo, args) => {
  const env = { ...process.env }; for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete env[name];
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env });
};
function emit(result) {
  fs.writeFileSync(process.env.TASKMD_RESULT_FILE, JSON.stringify(result));
  if (process.argv.includes('exec')) {
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(result) } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 1 } }));
  } else if (process.argv.includes('--output-format')) console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(result) }));
  else console.log(JSON.stringify(result));
}
if (process.env.TASKMD_WORKER_ROLE === 'git-conflict') {
  const files = JSON.parse(prompt.match(/Conflict paths \(JSON\): ([^\n]+)/)[1]);
  const mode = process.env.PREPARED_GIT_CONFLICT || 'resolve';
  if (mode === 'malformed') { fs.writeFileSync(process.env.TASKMD_RESULT_FILE, 'not JSON'); process.exit(0); }
  if (mode !== 'blocked') {
    for (const file of files) {
      const text = mode === 'drop-handoff' ? git(process.cwd(), ['show', `HEAD:${file}`]).replace(/\n## Progress[\s\S]*/, '\n') : mode === 'markers' ? '<<<<<<< unresolved\n=======\n>>>>>>> unresolved\n' : 'resolved both sides\n';
      fs.writeFileSync(path.join(process.cwd(), file), text);
    }
    if (mode === 'unsafe') fs.writeFileSync('outside.txt', 'unrelated edit\n');
    if (mode === 'index') git(process.cwd(), ['add', '--', ...files]);
  }
  emit({ status: mode === 'blocked' ? 'blocked' : 'completed', summary: 'Prepared conflict resolution', evidence: ['Prepared resolution inspected'], next_step: 'Fixture owner resolves policy decision' });
} else {
  for (const repo of JSON.parse(process.env.PREPARED_GIT_REPOS || '[]')) fs.writeFileSync(path.join(repo, 'finished.txt'), `Prepared task ${path.basename(process.env.TASKMD_TASK_FILE)}\n`);
  if (process.env.PREPARED_GIT_STAGE) git(process.cwd(), ['add', 'finished.txt']);
  const child = spawnSync(process.execPath, [path.join(import.meta.dirname, 'fake-worker.mjs'), 'completed'], { input: prompt, encoding: 'utf8', env: { ...process.env, PREPARED_MODE: process.env.PREPARED_GIT_MODE || 'completed' } });
  if (child.status !== 0) { process.stderr.write(child.stderr); process.exit(child.status || 1); }
  if (process.env.PREPARED_GIT_ADVANCE_PEER) {
    const peer = process.env.PREPARED_GIT_ADVANCE_PEER, file = path.relative(process.cwd(), process.env.TASKMD_TASK_FILE);
    fs.appendFileSync(path.join(peer, file), '\n## Progress\n\nConcurrent prepared note\n');
    git(peer, ['add', '--', file]); git(peer, ['commit', '-m', 'Record concurrent prepared note']); git(peer, ['push']);
  }
  emit(JSON.parse(fs.readFileSync(process.env.TASKMD_RESULT_FILE, 'utf8')));
}

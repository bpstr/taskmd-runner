#!/usr/bin/env node
// Retain taskmd-runner's Codex sandbox and structured-result contract while the
// shared adapter owns process-group cancellation, event parsing and usage.
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
args.splice(1, 0, ...(args.includes('--dangerously-bypass-approvals-and-sandbox') ? [] : ['--sandbox', process.env.TASKMD_CODEX_SANDBOX || 'workspace-write']),
  '-c', 'approval_policy="never"', '--output-schema', process.env.TASKMD_RESULT_SCHEMA,
  '--output-last-message', process.env.TASKMD_RESULT_FILE);
const child = spawn(process.env.TASKMD_CODEX_EXECUTABLE || 'codex', args, { stdio: 'inherit' });
// The adapter signals this wrapper and its child together; wait for child exit.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {});
child.once('error', error => { console.error(error.message); process.exitCode = 127; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });

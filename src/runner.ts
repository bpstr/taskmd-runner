import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { finished } from 'node:stream/promises';
import { parse } from 'yaml';
import { runAgent, buildRunnerInvocation, type ClientName, type Usage } from '@bpstr/agent-adapter';
import { command } from './process.js';
import { readTask, contract, checks, verifiedCount, progress, taskContext, now } from './task.js';
import { Notifications, type NotificationOptions } from './notifications.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export interface Options extends NotificationOptions {
  project: string; config?: string; taskDir?: string; stateDir?: string; taskmd: string;
  filter: string[]; rounds: number; timeout: number; client: ClientName; executable?: string;
  sandbox: 'workspace-write' | 'danger-full-access'; permissions: 'default' | 'bypass';
  model?: string; effort?: string; worker?: string[];
}
export interface WorkerResult {
  status: 'pending' | 'blocked' | 'completed' | 'in-review';
  summary: string; evidence: string[]; next_step: string;
}
export function validateResult(value: unknown): WorkerResult {
  const r = value as WorkerResult;
  if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).sort().join() !== 'evidence,next_step,status,summary') throw new Error('Worker result fields do not match result.schema.json');
  if (!['pending', 'blocked', 'completed', 'in-review'].includes(r.status)) throw new Error('Invalid worker status');
  if (typeof r.summary !== 'string' || !r.summary.trim() || typeof r.next_step !== 'string') throw new Error('Worker summary and next_step must be strings; summary must be nonempty');
  if (!Array.isArray(r.evidence) || r.evidence.some(x => typeof x !== 'string' || !x.trim())) throw new Error('Worker evidence must be a list of nonempty strings');
  return r;
}
const effectiveStatus = (task: Record<string, any>) => task.effective_status ?? task.status;
export function documentationEvidence(result: WorkerResult, notes: string): string {
  const marker = /Documentation check:\s*(aligned|authorized change|conflict|missing)\b/ig;
  const evidence = result.evidence.find(item => [...item.matchAll(marker)].length > 0);
  const outcome = evidence && [...evidence.matchAll(marker)].at(-1)?.[1].toLowerCase();
  const current = [...notes.matchAll(marker)].at(-1)?.[1].toLowerCase();
  if (!evidence || !outcome || current !== outcome)
    throw new Error('Each round requires a matching Documentation check outcome in new Progress notes and result evidence');
  return evidence;
}
const jsonFile = (file: string, data: unknown) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

export class Runner {
  root: string; config: string; tasks: string; workflow: string; worklogs: boolean;
  base: string[]; filters: string[]; runDir: string; rows: Record<string, any>[] = [];
  notifications: Notifications;
  constructor(public args: Options, private signal?: AbortSignal) {
    this.root = fs.realpathSync(path.resolve(args.project));
    this.config = args.config ? path.resolve(args.config) : path.join(this.root, '.taskmd.yaml');
    const config = parse(fs.readFileSync(this.config, 'utf8')) || {};
    this.tasks = fs.realpathSync(path.resolve(this.root, args.taskDir || config.dir || 'tasks'));
    this.workflow = config.workflow || 'solo'; this.worklogs = config.worklogs === true;
    if (!['solo', 'pr-review'].includes(this.workflow)) throw new Error(`Unsupported workflow: ${this.workflow}`);
    this.base = ['--config', this.config, '--task-dir', this.tasks, '--no-color'];
    this.filters = args.filter.flatMap(f => ['--filter', f]);
    const state = args.stateDir ? path.resolve(args.stateDir) : path.join(this.root, '.taskmd-runner');
    this.runDir = path.join(state, now().replace(/[-:.]/g, '').slice(0, 15) + '-' + randomUUID().slice(0, 8));
    this.notifications = new Notifications(args, path.join(this.runDir, 'notifications.json'));
  }
  async cli(...args: string[]): Promise<string> {
    return command(this.args.taskmd, [...this.base, ...args], { cwd: this.root, timeoutMs: 60000 });
  }
  async cliJson(...args: string[]): Promise<any> { return JSON.parse(await this.cli(...args)); }
  async status(id: string, status: string) { await this.cli('set', id, '--status', status); }
  async record(file: string, message: string, handoff = false, workerNotes = '') {
    if (!this.worklogs) { progress(file, message); return; }
    const id = String(readTask(file).meta.id);
    await this.cli('worklog', id, '--add', message + (workerNotes.trim() ? '\n\nWorker notes:\n' + workerNotes.trim() : ''));
    if (!handoff) { progress(file, message); return; }
    const text = fs.readFileSync(file, 'utf8'); const at = text.indexOf('\n## Progress');
    const scope = at < 0 ? text : text.slice(0, at), journal = at < 0 ? '' : text.slice(at);
    const slices = [...new Set(journal.match(/^\s*- \[[xX]\] .+$/gm) || [])];
    // Native worklogs live beside grouped task files, not necessarily at the task root.
    const history = `[Ticket worklog](.worklogs/${id}.md) contains earlier handoffs and verification details.`;
    fs.writeFileSync(file, scope.trimEnd() + '\n\n## Progress\n\n' + slices.join('\n') + `\n\n${now()} — ${message}\n\n${history}\n`);
  }
  async finish(reason: string, code: number): Promise<number> {
    jsonFile(path.join(this.runDir, 'summary.json'), { reason, exit_code: code, client: this.args.client, rounds: this.rows, ended_at: now() });
    console.log(JSON.stringify({ reason, rounds: this.rows.length, summary: path.join(this.runDir, 'summary.json') }));
    await this.notifications.sendForReason(reason, this.root, this.rows.at(-1)?.task_id);
    return code;
  }
  async worker(file: string, folder: string) {
    const resultFile = path.join(folder, 'result.json');
    const prompt = fs.readFileSync(path.join(HERE, 'WORKER.md'), 'utf8') +
      `\nProject: ${this.root}\nWorkflow: ${this.workflow}\nClient: ${this.args.worker ? 'custom' : this.args.client}\nTask file: ${file}\nResult file: ${resultFile}\n` +
      `\nResult schema:\n${fs.readFileSync(path.join(HERE, 'result.schema.json'), 'utf8')}\nSelected task:\n${taskContext(file)}`;
    fs.writeFileSync(path.join(folder, 'prompt.md'), prompt);
    const env = { ...process.env, TASKMD_TASK_FILE: file, TASKMD_RESULT_FILE: resultFile, TASKMD_ROUND_DIR: folder, ASSIGN_OFFLINE_TESTS: '1' };
    const log = fs.createWriteStream(path.join(folder, 'worker.jsonl'));
    const started = performance.now(); let usage: Usage | Record<string, number> | null = null;
    let providerThreadId: string | null = null;
    try {
      if (this.args.worker) {
        await command(this.args.worker[0], this.args.worker.slice(1), { cwd: this.root, env, input: prompt, signal: this.signal, timeoutMs: this.args.timeout * 1000, log });
      } else {
        const result = await runAgent({ client: this.args.client, prompt, workdir: this.root,
          model: this.args.model, effort: this.args.effort,
          executable: this.args.client === 'codex' ? path.join(HERE, 'bin/codex-worker.js') : this.args.executable,
          permissions: this.args.permissions, timeoutMs: this.args.timeout * 1000, signal: this.signal,
          // Preserve Codex's original workspace-write/never policy via a small executable wrapper.
          env: { ...env, TASKMD_CODEX_SANDBOX: this.args.sandbox, TASKMD_CODEX_EXECUTABLE: this.args.executable || 'codex', TASKMD_RESULT_SCHEMA: path.join(HERE, 'result.schema.json') },
          onOutput: chunk => { log.write(chunk); },
        });
        jsonFile(path.join(folder, 'agent.json'), { client: result.client, status: result.status, code: result.code, signal: result.signal,
          usage: result.usage, providerThreadId: result.providerThreadId, error: result.error, truncated: result.truncated });
        usage = result.usage; providerThreadId = result.providerThreadId;
        if (result.status !== 'success') throw new Error(`${this.args.client} ${result.status} (${result.code}); see ${folder}/worker.jsonl`);
        if (!fs.existsSync(resultFile)) {
          // CLI clients without output-file controls can return a bare or fenced receipt.
          const raw = result.text.trim(); const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
          jsonFile(resultFile, validateResult(JSON.parse(fenced ? fenced[1] : raw)));
        }
      }
    } finally { log.end(); await finished(log); }
    if (this.args.worker) {
      const totals: Record<string, number> = {};
      for (const line of fs.readFileSync(path.join(folder, 'worker.jsonl'), 'utf8').split('\n')) {
        try { const event = JSON.parse(line); if (event.type === 'turn.completed') for (const [key, value] of Object.entries(event.usage || {})) if (Number.isInteger(value)) totals[key] = (totals[key] || 0) + Number(value); } catch {}
      }
      usage = totals;
    }
    return { result: validateResult(JSON.parse(fs.readFileSync(resultFile, 'utf8'))), metrics: {
      elapsed_seconds: Math.round((performance.now() - started) / 10) / 100, prompt_bytes: Buffer.byteLength(prompt), usage, provider_thread_id: providerThreadId,
    } };
  }
  async run(): Promise<number> {
    // flock matches the Python runner's lock and automatically releases on exit/crash.
    let flockSync: typeof import('fs-ext').flockSync;
    try { ({ flockSync } = await import('fs-ext')); }
    catch { throw new Error(`Cannot load the advisory lock addon with Node ${process.version}. Run npm rebuild fs-ext using ${process.execPath}, or use the Node version used to install dependencies.`); }
    const lock = fs.openSync(path.join(this.tasks, '.taskmd-runner.lock'), 'a+');
    try { try { flockSync(lock, 'exnb'); } catch { throw new Error('Another runner owns this task directory'); }
      fs.mkdirSync(this.runDir, { recursive: true });
      // Check adapter controls before claiming any task.
      if (!this.args.worker) buildRunnerInvocation({ client: this.args.client, prompt: 'preflight', workdir: this.root, model: this.args.model, effort: this.args.effort, permissions: this.args.permissions });
      await this.cli('validate');
      while (!this.args.rounds || this.rows.length < this.args.rounds) {
        if (this.signal?.aborted) return this.finish('interrupted', 130);
        const selected = await this.cliJson('next', '--format', 'json', '--strict-priority', '--limit', '1', '--filter', 'status=pending', ...this.filters);
        if (!Array.isArray(selected)) throw new Error('Unexpected taskmd next response; not an empty backlog');
        if (!selected.length) {
          const remaining = await this.cliJson('list', '--format', 'json', ...this.filters);
          if (!Array.isArray(remaining)) throw new Error('Unexpected taskmd list response');
          const unfinished = remaining.some(task => !['completed', 'cancelled'].includes(effectiveStatus(task)));
          return await this.finish(unfinished ? 'no_ready_tasks' : 'empty', unfinished ? 2 : 0);
        }
        const id = String(selected[0].id);
        const task = await this.cliJson('get', id, '--exact', '--format', 'json');
        if (task.remote_only || effectiveStatus(task) !== 'pending') return await this.finish('claim_conflict', 2);
        const file = fs.realpathSync(path.resolve(this.tasks, task.file_path));
        const relative = path.relative(this.tasks, file);
        if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Selected task is outside task directory');
        const meta = readTask(file).meta;
        for (const dep of meta.dependencies || []) {
          const prerequisite = await this.cliJson('get', String(dep), '--exact', '--format', 'json');
          if (effectiveStatus(prerequisite) !== 'completed') return await this.finish('unmet_dependency', 2);
        }
        const before = contract(file), count = checks(file), verifiedBefore = verifiedCount(file);
        if (!/^[\w.-]+$/.test(id) || id === '.' || id === '..') throw new Error('Unsafe task ID');
        const folder = path.join(this.runDir, `${String(this.rows.length + 1).padStart(3, '0')}-${id}`);
        fs.mkdirSync(folder); await this.status(id, 'in-progress');
        const row: Record<string, any> = { task_id: id, started_at: now(), round: this.rows.length + 1, client: this.args.worker ? 'custom' : this.args.client };
        this.rows.push(row); console.log(JSON.stringify({ round: row.round, task_id: id, event: 'started', client: row.client }));
        try {
          await this.record(file, `Started round ${row.round}. Evidence: ${folder}`);
          const priorNotes = readTask(file).body.split('\n## Progress').slice(1).join('\n## Progress');
          const { result, metrics } = await this.worker(file, folder); Object.assign(row, metrics);
          if (!isDeepStrictEqual(contract(file), before) || readTask(file).meta.status !== 'in-progress') throw new Error('Worker changed task scope, metadata or runner-owned status');
          const status = result.status;
          if (status === 'completed' || status === 'in-review') {
            if (checks(file)[1] || !result.evidence.length) throw new Error('Completion requires checked criteria and verification evidence');
            if (this.workflow === 'pr-review') {
              if (status !== 'in-review' || !readTask(file).meta.pr?.length) throw new Error('PR-review work requires in-review and a real linked PR');
            } else if (status !== 'completed') throw new Error('Solo work completes directly');
          } else if (!result.next_step.trim()) throw new Error('Unfinished work needs a concrete next step or blocker/owner/retry trigger');
          const noProgress = status === 'pending' && (verifiedCount(file) <= verifiedBefore || !result.evidence.length);
          const journal = readTask(file).body.split('\n## Progress').slice(1).join('\n## Progress');
          const notes = journal.startsWith(priorNotes) ? journal.slice(priorNotes.length) : journal;
          row.documentation_check = documentationEvidence(result, notes);
          await this.record(file, `${status}: ${result.summary}\n\nEvidence: ${result.evidence.join('; ')}\n\nNext: ${result.next_step}`, true, notes);
          await this.status(id, status); await this.cli('validate');
          Object.assign(row, { status, ended_at: now(), checked_before: count[0], checked_after: checks(file)[0], verified_before: verifiedBefore, verified_after: verifiedCount(file), result });
          jsonFile(path.join(folder, 'receipt.json'), row);
          if (status === 'blocked') await this.notifications.send('runner.blocked', this.root, id);
          if (noProgress) return await this.finish('no_progress', 2);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failure = `Interrupted or invalid result: ${message}. Inspect ${folder} before retrying.`;
          // Preserve the terminal receipt even if reconciliation itself fails.
          try { await this.status(id, 'blocked'); } catch (e) { row.reconciliation_error = String(e); }
          try { await this.record(file, failure, true); } catch (e) { progress(file, failure + ` Worklog write failed: ${e}`); }
          Object.assign(row, { status: 'blocked', error: message, ended_at: now() });
          jsonFile(path.join(folder, 'receipt.json'), row);
          return await this.finish(this.signal?.aborted ? 'interrupted' : 'worker_error', this.signal?.aborted ? 130 : 1);
        }
      }
      return await this.finish('round_limit', 0);
    } finally { fs.closeSync(lock); }
  }
}

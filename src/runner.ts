import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { finished } from 'node:stream/promises';
import { parse } from 'yaml';
import { runAgent, buildRunnerInvocation, type ClientName, type Usage } from '@bpstr/agent-adapter';
import { command } from './process.js';
import { readTask, contract, checks, verifiedCount, progress, taskRuns, setTaskRuns, now } from './task.js';
import { Notifications, type NotificationOptions } from './notifications.js';
import { GitSync, type GitConflict } from './git.js';
import { acquireTaskLock, taskLease, taskRegistryLease } from './lock.js';
import { isolatedCodexHome } from './codex.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export interface Options extends NotificationOptions {
  project: string; config?: string; taskDir?: string; stateDir?: string; taskmd: string;
  filter: string[]; taskPrefix?: string[]; rounds: number; timeout: number; client: ClientName; executable?: string;
  maxTaskRuns: number; blockAfterRuns: number;
  codexSessionPolicy?: 'isolated' | 'shared';
  sandbox: 'workspace-write' | 'danger-full-access'; permissions: 'default' | 'bypass';
  model?: string; effort?: string; worker?: string[];
  gitSync: boolean; gitRepo: string[]; gitConflicts: 'stop' | 'worker';
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
class InvalidResponse extends Error {
  constructor(message: string, public metrics?: Record<string, unknown>) { super(message); }
}
class WorkerFailure extends Error {
  constructor(message: string, public kind: string, public metrics?: Record<string, unknown>) { super(message); }
}
interface Clarification { folder: string; error: string; sessionId?: string; }

const handoffReserve = (seconds: number) => Math.min(60, seconds / 10);
// Include a small safety margin for a worker stopping just before the warning.
export function pendingReason(result: WorkerResult, remaining: number, budget: number): string {
  if (remaining <= handoffReserve(budget) + Math.min(5, budget / 100)) return 'deadline';
  return /context[\s-]*(?:budget|limit|window|pressure)/i.test([result.summary, result.next_step, ...result.evidence].join('\n'))
    ? 'reported_context_limit' : 'early_pending';
}
function attemptTotals(attempts: Record<string, any>[]) {
  const keys = [...new Set(attempts.flatMap(attempt => Object.keys(attempt.usage || {})))];
  return {
    elapsed_seconds: Math.round(attempts.reduce((total, attempt) => total + (attempt.elapsed_seconds || 0), 0) * 100) / 100,
    usage: keys.length ? Object.fromEntries(keys.map(key => [key, attempts.every(attempt => typeof attempt.usage?.[key] === 'number')
      ? attempts.reduce((total, attempt) => total + attempt.usage[key], 0) : null])) : null,
  };
}

export class Runner {
  root: string; config: string; tasks: string; workflow: string; worklogs: boolean;
  base: string[]; filters: string[]; runDir: string; rows: Record<string, any>[] = [];
  notifications: Notifications;
  taskPrefixes: string[];
  blockedTasks: Record<string, any>[] = [];
  private unavailableTasks = new Map<string, string>();
  private taskSessions = new Map<string, { id: string; contract: ReturnType<typeof contract> }>();
  gitSync?: GitSync;
  private lockError?: string;
  private configText: string;
  constructor(public args: Options, private signal?: AbortSignal) {
    this.root = fs.realpathSync(path.resolve(args.project));
    this.config = args.config ? path.resolve(args.config) : path.join(this.root, '.taskmd.yaml');
    this.configText = fs.readFileSync(this.config, 'utf8');
    const config = parse(this.configText) || {};
    this.tasks = fs.realpathSync(path.resolve(this.root, args.taskDir || config.dir || 'tasks'));
    this.taskPrefixes = (args.taskPrefix || []).map(prefix => {
      if (!prefix || path.isAbsolute(prefix)) throw new Error('Task prefix must be a relative subtree');
      const resolved = path.resolve(this.tasks, prefix);
      const target = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
      if (target !== resolved) throw new Error('Task prefix cannot redirect through a symlink');
      const relative = path.relative(this.tasks, target);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        throw new Error('Task prefix must stay below the task directory');
      return target;
    });
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
  inScope(task: Record<string, any>): boolean {
    if (!this.taskPrefixes.length) return true;
    if (typeof task.file_path !== 'string') throw new Error('Scoped task selection requires a file_path');
    const within = (file: string) => this.taskPrefixes.some(prefix => {
      const relative = path.relative(prefix, file);
      return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    });
    const file = path.resolve(this.tasks, task.file_path);
    return within(file) && within(fs.realpathSync(file));
  }
  async nextTasks(): Promise<Record<string, any>[]> {
    // Preserve taskmd's native phase/priority/dependency order; stop expanding
    // as soon as an allowed candidate appears. The search is always bounded.
    const expand = this.taskPrefixes.length > 0 || this.unavailableTasks.size > 0;
    for (let limit = expand ? 64 : 1; limit <= 4096; limit *= 4) {
      const rows = await this.cliJson('next', '--format', 'json', '--strict-priority', '--limit', String(limit), '--filter', 'status=pending', ...this.filters);
      if (!Array.isArray(rows)) throw new Error('Unexpected taskmd next response; not an empty backlog');
      const candidate = rows.find(task => !this.unavailableTasks.has(String(task.id)) && this.inScope(task));
      if (candidate) return [candidate];
      if (!expand || rows.length < limit) return [];
    }
    throw new Error('Scoped selection reached 4096 candidates; narrow the taskmd filters');
  }
  async status(id: string, status: string) { await this.cli('set', id, '--status', status); }
  private skipTask(id: string, reason: string) {
    this.taskSessions.delete(id);
    this.unavailableTasks.set(id, reason);
    console.log(JSON.stringify({ event: 'task_skipped', task_id: id, reason, next_action: 'select_next_task' }));
  }
  private async reportBlocked(row: Record<string, any>, folder?: string) {
    const blocked = { task_id: row.task_id, task_path: row.task_path, task_runs: row.task_run,
      reason: row.blocked_reason || 'worker_blocked', limit: row.task_run_limit,
      ...(row.review_request ? { review_request: row.review_request } : {}),
      ...(row.error ? { error: row.error } : {}), ...(folder ? { receipt: path.join(folder, 'receipt.json') } : {}) };
    this.blockedTasks.push(blocked);
    console.log(JSON.stringify({ event: 'task_blocked', ...blocked, next_action: 'select_next_task' }));
    await this.notifications.send('runner.blocked', this.root, row.task_id);
  }
  private async publishRound(row: Record<string, any>, folder: string, file: string, before: ReturnType<typeof contract>): Promise<boolean> {
    jsonFile(path.join(folder, 'receipt.json'), row);
    if (!this.gitSync) return true;
    const acceptedJournal = readTask(file).body.split('\n## Progress').slice(1).join('\n## Progress').trim();
    try {
      await this.gitSync.after(row.round, row.task_id, row.status, async () => {
        const merged = readTask(file), journal = merged.body.split('\n## Progress').slice(1).join('\n## Progress');
        if (!isDeepStrictEqual(contract(file), before) || merged.meta.status !== row.status || taskRuns(file) !== row.task_run || !journal.includes(acceptedJournal) || ((row.status === 'completed' || row.status === 'in-review') && checks(file)[1])) throw new Error('Git integration changed the accepted task contract, status or handoff');
        await this.cli('validate');
      });
      row.git_sync = 'pushed';
    } catch (error) {
      this.gitSync.failed(error); row.git_sync = 'failed'; row.git_error = this.gitSync.error;
    }
    jsonFile(path.join(folder, 'receipt.json'), row);
    return row.git_sync === 'pushed';
  }
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
    const runs = taskRuns(file);
    fs.writeFileSync(file, scope.trimEnd() + '\n\n## Progress\n\n' + slices.join('\n') + `\n\n${now()} — ${message}\n\n${history}\n`);
    if (runs) setTaskRuns(file, runs);
  }
  async finish(reason: string, code: number): Promise<number> {
    jsonFile(path.join(this.runDir, 'summary.json'), { reason, exit_code: code, client: this.args.client, rounds: this.rows, blocked_tasks: this.blockedTasks, skipped_tasks: [...this.unavailableTasks].map(([task_id, reason]) => ({ task_id, reason })), ...(this.gitSync ? { git_sync: this.gitSync.state() } : {}), ...(this.lockError ? { lock_error: this.lockError } : {}), ended_at: now() });
    console.log(JSON.stringify({ reason, rounds: this.rows.length, summary: path.join(this.runDir, 'summary.json') }));
    await this.notifications.sendForReason(reason, this.root, this.rows.at(-1)?.task_id);
    return code;
  }
  async worker(file: string, folder: string, clarification?: Clarification, resumeSessionId?: string, deadline = Date.now() + this.args.timeout * 1000, continuation = 0) {
    const budget = Math.max(0.001, (deadline - Date.now()) / 1000);
    const resultFile = path.join(folder, 'result.json');
    const prompt = fs.readFileSync(path.join(HERE, 'WORKER.md'), 'utf8') +
      `\nResult schema:\n${fs.readFileSync(path.join(HERE, 'result.schema.json'), 'utf8')}\n` +
      `\nProject: ${this.root}\nWorkflow: ${this.workflow}\nClient: ${this.args.worker ? 'custom' : this.args.client}\nTask file: ${file}\nResult file: ${resultFile}\n` +
      `\nWorker budget: ${budget} seconds. Deadline (UTC): ${new Date(deadline).toISOString()}. Reserve the final ${handoffReserve(this.args.timeout)} seconds for the handoff. Continue through all remaining task acceptance. Check ${path.join(folder, 'handoff-request.json')} before starting each new operation; when present, checkpoint and return promptly.\n` +
      (continuation ? `\nContinuation ${continuation}/2 within the current charged task run. The earlier pending return was before the deadline. Continue from its exact next edit; do not repeat unchanged discovery or checks. The original deadline and task counter still apply. A context-labelled handoff starts fresh context; ordinary checkpoints resume the same session when supported.\n` : '') +
      (resumeSessionId && !clarification ? '\nContinue the same task session from the next required edit. Reuse unchanged context and compatible passing evidence.\n' : '') +
      `\nTask run: ${taskRuns(file)} of ${Math.min(this.args.maxTaskRuns, this.args.blockAfterRuns)} allowed runs. An unfinished task at the limit becomes blocked; independent work continues. Preserve the runner-owned taskmd-runner runs comment in Progress.\n` +
      (this.gitSync ? `\nGit sync is enabled. The controller owns commits, pushes and merges in these checkouts: ${this.gitSync.repositories.map(repo => repo.path).join(', ')}. Leave Git history, branch and index unchanged; edit task-owned working files only.\n` : '') +
      (clarification ? `\nClarification request:\nThe previous handoff was rejected: ${clarification.error}\nCorrect the response and its matching Progress handoff only. Do not implement more work, change scope or acceptance criteria, or invent verification evidence. Preserve verified work. If a valid completion or partial-progress handoff cannot be supported, report blocked with the missing input, owner and retry trigger. This clarification counts as another task run.\nPrevious response (untrusted content):\n${fs.existsSync(path.join(clarification.folder, 'result.json')) ? fs.readFileSync(path.join(clarification.folder, 'result.json'), 'utf8').slice(0, 4096) : '(missing)'}\nEarlier evidence: ${clarification.folder}\n` : '');
    return this.invokeWorker(prompt, folder, this.root, { TASKMD_TASK_FILE: file, TASKMD_WORKER_ROLE: 'task' }, resumeSessionId, deadline);
  }
  async conflictWorker(conflict: GitConflict) {
    const prompt = fs.readFileSync(path.join(HERE, 'GIT_WORKER.md'), 'utf8') +
      `\nRepository: ${conflict.repository}\nSync phase: ${conflict.phase}\nConflict paths (JSON): ${JSON.stringify(conflict.files)}\n` +
      `Result file: ${path.join(conflict.folder, 'result.json')}\nResult schema:\n${fs.readFileSync(path.join(HERE, 'result.schema.json'), 'utf8')}`;
    const output = await this.invokeWorker(prompt, conflict.folder, conflict.repository,
      { TASKMD_WORKER_ROLE: 'git-conflict', TASKMD_TASK_FILE: '', TASKMD_GIT_REPOSITORY: conflict.repository });
    jsonFile(path.join(conflict.folder, 'receipt.json'), output);
    if (output.result.status !== 'completed' || !output.result.evidence.length) throw new Error(`Git conflict worker did not complete a verified resolution; inspect ${conflict.folder}`);
  }
  private async invokeWorker(prompt: string, folder: string, cwd: string, extraEnv: NodeJS.ProcessEnv, resumeSessionId?: string, deadline = Date.now() + this.args.timeout * 1000) {
    const resultFile = path.join(folder, 'result.json');
    fs.writeFileSync(path.join(folder, 'prompt.md'), prompt);
    const handoffAt = deadline - handoffReserve(this.args.timeout) * 1000;
    const handoffMessage = 'The worker deadline is approaching. Stop starting new work. Finish or safely stop the current operation, save changed files, and record a durable Progress checkpoint with actual verification, remaining acceptance and the exact next edit. Return the required JSON now: pending for unfinished work, completed only if all acceptance is verified, or blocked for a concrete external prerequisite. Preserve scope and report unverified work honestly.';
    const env = { ...process.env, ...extraEnv, TASKMD_RESULT_FILE: resultFile, TASKMD_ROUND_DIR: folder, ASSIGN_OFFLINE_TESTS: '1',
      TASKMD_HANDOFF_AT: String(handoffAt), TASKMD_HANDOFF_MESSAGE: handoffMessage };
    const log = fs.createWriteStream(path.join(folder, 'worker.jsonl'));
    const started = performance.now(); let usage: Usage | Record<string, number> | null = null;
    let providerThreadId: string | null = null;
    let handoffRequested = false, handoffError: string | undefined;
    const metrics = () => ({ elapsed_seconds: Math.round((performance.now() - started) / 10) / 100,
      prompt_bytes: Buffer.byteLength(prompt), usage, provider_thread_id: providerThreadId, handoff_requested: handoffRequested,
      ...(handoffError ? { handoff_warning_error: handoffError } : {}),
      ...(fs.existsSync(path.join(folder, 'context.json')) ? { context: JSON.parse(fs.readFileSync(path.join(folder, 'context.json'), 'utf8')) } : {}) });
    const handoffTimer = setTimeout(() => {
      handoffRequested = true;
      try { jsonFile(path.join(folder, 'handoff-request.json'), { requested_at: now(), message: handoffMessage }); }
      catch (error) { handoffError = String(error); }
    }, Math.max(0, handoffAt - Date.now()));
    try {
      if (this.args.worker) {
        try { await command(this.args.worker[0], this.args.worker.slice(1), { cwd, env, input: prompt, signal: this.signal, timeoutMs: Math.max(1, deadline - Date.now()), log }); }
        catch (error) { const message = error instanceof Error ? error.message : String(error); throw new WorkerFailure(message, message.startsWith('Command timed out:') ? 'timeout' : 'worker_error', metrics()); }
      } else {
        const result = await runAgent({ client: this.args.client, prompt, workdir: cwd,
          persistSession: this.args.client === 'codex' && extraEnv.TASKMD_WORKER_ROLE === 'task', resumeSessionId,
          model: this.args.model, effort: this.args.effort,
          executable: this.args.client === 'codex' ? path.join(HERE, 'bin/codex-worker.js') : this.args.executable,
          permissions: this.args.permissions, timeoutMs: Math.max(1, deadline - Date.now()), signal: this.signal,
          // Tool output is one JSON event; its limit is separate from retained output tails.
          maxEventBytes: 16 * 1024 * 1024,
          // Preserve Codex's original workspace-write/never policy via a small executable wrapper.
          env: { ...env, ...(this.args.client === 'codex' && this.args.codexSessionPolicy !== 'shared'
            ? { CODEX_HOME: isolatedCodexHome(this.runDir), TASKMD_CODEX_ISOLATED_HOME: path.join(this.runDir, 'codex-home') }
            : { TASKMD_CODEX_ISOLATED_HOME: undefined }),
            TASKMD_CODEX_SANDBOX: this.args.sandbox, TASKMD_CODEX_EXECUTABLE: this.args.executable || 'codex', TASKMD_RESULT_SCHEMA: path.join(HERE, 'result.schema.json') },
          onOutput: chunk => { log.write(chunk); },
        });
        jsonFile(path.join(folder, 'agent.json'), { client: result.client, status: result.status, code: result.code, signal: result.signal,
          usage: result.usage, providerThreadId: result.providerThreadId, error: result.error, truncated: result.truncated });
        usage = result.usage; providerThreadId = result.providerThreadId;
        if (result.status !== 'success') throw new WorkerFailure(`${this.args.client} ${result.status} (${result.code})${result.error ? `: ${result.error}` : ''}; see ${folder}/worker.jsonl`, result.status === 'timed-out' ? 'timeout'
          : /context_window_exceeded|context_length_exceeded|maximum context length/i.test(result.error || '') ? 'context_limit' : 'worker_error',
          metrics());
        if (!fs.existsSync(resultFile)) {
          // CLI clients without output-file controls can return a bare or fenced receipt.
          const raw = result.text.trim(); const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
          fs.writeFileSync(resultFile, fenced ? fenced[1] : raw);
        }
      }
    } finally { clearTimeout(handoffTimer); log.end(); await finished(log); }
    if (this.args.worker) {
      const totals: Record<string, number> = {};
      for (const line of fs.readFileSync(path.join(folder, 'worker.jsonl'), 'utf8').split('\n')) {
        try { const event = JSON.parse(line); if (event.type === 'turn.completed') for (const [key, value] of Object.entries(event.usage || {})) if (Number.isInteger(value)) totals[key] = (totals[key] || 0) + Number(value); } catch {}
      }
      usage = totals;
    }
    try { return { result: validateResult(JSON.parse(fs.readFileSync(resultFile, 'utf8'))), metrics: metrics() }; }
    catch (error) { throw new InvalidResponse(error instanceof Error ? error.message : String(error), metrics()); }
  }
  async run(): Promise<number> {
    const lease = new AbortController(), originalSignal = this.signal;
    const stop = () => lease.abort();
    originalSignal?.addEventListener('abort', stop, { once: true });
    if (originalSignal?.aborted) lease.abort();
    this.signal = lease.signal;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireTaskLock(this.tasks, error => { this.lockError = error.message; lease.abort(); }, this.args.gitSync ? [] : this.taskPrefixes);
      fs.mkdirSync(this.runDir, { recursive: true });
      // Check adapter controls before claiming any task.
      if (!this.args.worker) buildRunnerInvocation({ client: this.args.client, prompt: 'preflight', workdir: this.root, model: this.args.model, effort: this.args.effort, permissions: this.args.permissions });
      if (this.args.gitSync) {
        this.gitSync = new GitSync(this.root, this.args.gitRepo, [this.runDir, taskLease(this.tasks), taskRegistryLease(this.tasks)], this.runDir, this.signal,
          this.args.gitConflicts === 'worker' ? conflict => this.conflictWorker(conflict) : undefined);
        try { await this.gitSync.initialize(); await this.gitSync.requirePath(this.tasks); }
        catch (error) { this.gitSync.failed(error); return await this.finish('git_sync_error', 1); }
      } else await this.cli('validate');
      while (!this.args.rounds || this.rows.length < this.args.rounds) {
        if (this.signal?.aborted) return this.finish(this.lockError ? 'lock_lost' : 'interrupted', this.lockError ? 1 : 130);
        if (this.gitSync) {
          try {
            await this.gitSync.before(this.rows.length + 1);
            if (fs.readFileSync(this.config, 'utf8') !== this.configText) throw new Error('Git sync changed the runner configuration; restart with the updated configuration');
            await this.cli('validate');
          } catch (error) { this.gitSync.failed(error); return await this.finish(this.lockError ? 'lock_lost' : this.signal?.aborted ? 'interrupted' : 'git_sync_error', this.lockError ? 1 : this.signal?.aborted ? 130 : 1); }
        }
        const selected = await this.nextTasks();
        if (!selected.length) {
          const remaining = await this.cliJson('list', '--format', 'json', ...this.filters);
          if (!Array.isArray(remaining)) throw new Error('Unexpected taskmd list response');
          const unfinished = remaining.some(task => this.inScope(task) && !['completed', 'cancelled'].includes(effectiveStatus(task)));
          return await this.finish(unfinished ? 'no_ready_tasks' : 'empty', unfinished ? 2 : 0);
        }
        const id = String(selected[0].id);
        const task = await this.cliJson('get', id, '--exact', '--format', 'json');
        if (!this.inScope(task) || task.remote_only || effectiveStatus(task) !== 'pending') { this.skipTask(id, 'claim_conflict'); continue; }
        const file = fs.realpathSync(path.resolve(this.tasks, task.file_path));
        const relative = path.relative(this.tasks, file);
        if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Selected task is outside task directory');
        const meta = readTask(file).meta;
        let unmetDependency = false;
        for (const dep of meta.dependencies || []) {
          const prerequisite = await this.cliJson('get', String(dep), '--exact', '--format', 'json');
          if (effectiveStatus(prerequisite) !== 'completed') { unmetDependency = true; break; }
        }
        if (unmetDependency) { this.skipTask(id, 'unmet_dependency'); continue; }
        const previousRuns = taskRuns(file), limit = Math.min(this.args.maxTaskRuns, this.args.blockAfterRuns);
        const limitMessage = (runs: number) => `Task run limit reached (${runs}/${limit}). Review required: the task owner must review this task or split it into subtasks that collectively preserve the original scope and acceptance criteria. Retain the run counter; explicitly unblock the task and raise the run limits only if further runs are approved.`;
        if (previousRuns >= limit) {
          const before = contract(file);
          await this.status(id, 'blocked');
          await this.record(file, limitMessage(previousRuns), true);
          await this.cli('validate');
          if (this.gitSync) {
            const acceptedJournal = readTask(file).body.split('\n## Progress').slice(1).join('\n## Progress').trim();
            try {
              await this.gitSync.after(this.rows.length + 1, id, 'blocked', async () => {
                if (!isDeepStrictEqual(contract(file), before) || readTask(file).meta.status !== 'blocked' || taskRuns(file) !== previousRuns || !readTask(file).body.includes(acceptedJournal)) throw new Error('Git integration changed the task run limit handoff');
                await this.cli('validate');
              });
            } catch (error) {
              this.gitSync.failed(error);
              return await this.finish(this.lockError ? 'lock_lost' : this.signal?.aborted ? 'interrupted' : 'git_sync_error', this.lockError ? 1 : this.signal?.aborted ? 130 : 1);
            }
          }
          await this.reportBlocked({ task_id: id, task_path: relative, task_run: previousRuns, task_run_limit: limit, blocked_reason: 'task_run_limit', review_request: limitMessage(previousRuns) });
          continue;
        }
        const before = contract(file), originalTask = fs.readFileSync(file, 'utf8'), count = checks(file), verifiedBefore = verifiedCount(file);
        const previousSession = this.taskSessions.get(id);
        if (previousSession && !isDeepStrictEqual(previousSession.contract, before)) {
          this.taskSessions.delete(id);
          console.log(JSON.stringify({ event: 'task_session_reset', task_id: id, reason: 'task_contract_changed' }));
        }
        if (!/^[\w.-]+$/.test(id) || id === '.' || id === '..') throw new Error('Unsafe task ID');
        await this.status(id, 'in-progress');
        let taskRun = previousRuns, clarification: Clarification | undefined;
        while (true) {
          const folder = path.join(this.runDir, `${String(this.rows.length + 1).padStart(3, '0')}-${id}`);
          let attemptFolder = folder;
          fs.mkdirSync(folder);
          let resumeSessionId = clarification?.sessionId || this.taskSessions.get(id)?.id;
          const row: Record<string, any> = { task_id: id, task_path: relative, task_run: ++taskRun, task_run_limit: limit, started_at: now(), round: this.rows.length + 1, client: this.args.worker ? 'custom' : this.args.client, phase: clarification ? 'clarification' : 'execution', session_resumed: !!resumeSessionId };
          this.rows.push(row); console.log(JSON.stringify({ round: row.round, task_id: id, event: 'started', client: row.client }));
          try {
            setTaskRuns(file, row.task_run);
            await this.record(file, `Started round ${row.round}. Evidence: ${folder}`);
            const priorNotes = readTask(file).body.split('\n## Progress').slice(1).join('\n## Progress');
            const deadline = Date.now() + this.args.timeout * 1000;
            let attemptNotes = priorNotes, result!: WorkerResult, status: WorkerResult['status'];
            row.attempts = [];
            for (let continuation = 0; ; continuation++) {
              if (this.signal?.aborted) throw new Error('Worker cancelled before continuation');
              const output = await this.worker(file, attemptFolder, clarification, resumeSessionId, deadline, continuation);
              result = output.result;
              const remaining = Math.max(0, (deadline - Date.now()) / 1000);
              const reason = result.status === 'pending' ? pendingReason(result, remaining, this.args.timeout) : result.status;
              const attempt = { ...output.metrics, result, reason, remaining_seconds: remaining, session_resumed: !!resumeSessionId, folder: attemptFolder };
              row.attempts.push(attempt);
              jsonFile(path.join(attemptFolder, 'attempt.json'), attempt);
              Object.assign(row, output.metrics, { elapsed_seconds: Math.round((this.args.timeout - remaining) * 100) / 100 });
              if (!isDeepStrictEqual(contract(file), before) || readTask(file).meta.status !== 'in-progress' || taskRuns(file) !== row.task_run) throw new Error('Worker changed task scope, metadata or runner-owned status/counter');
              status = result.status;
              if (status === 'completed' || status === 'in-review') {
                if (checks(file)[1] || !result.evidence.length) throw new InvalidResponse('Completion requires checked criteria and verification evidence');
                if (this.workflow === 'pr-review') {
                  if (status !== 'in-review' || !readTask(file).meta.pr?.length) throw new InvalidResponse('PR-review work requires in-review and a real linked PR');
                } else if (status !== 'completed') throw new InvalidResponse('Solo work completes directly');
              } else if (!result.next_step.trim()) throw new InvalidResponse('Unfinished work needs a concrete next step or blocker/owner/retry trigger');
              const journal = readTask(file).body.split('\n## Progress').slice(1).join('\n## Progress');
              const newNotes = journal.startsWith(attemptNotes) ? journal.slice(attemptNotes.length) : journal;
              try { row.documentation_check = documentationEvidence(result, newNotes); }
              catch (error) { throw new InvalidResponse(error instanceof Error ? error.message : String(error)); }
              row.pending_reason = reason;
              if (status !== 'pending' || reason === 'deadline' || clarification || continuation >= 2) break;
              await this.record(file, `Checkpoint within task run ${row.task_run}: ${result.summary}\nEvidence: ${result.evidence.join('; ')}\nNext: ${result.next_step}\nContinuation reason: ${reason}. Original deadline: ${new Date(deadline).toISOString()}.`);
              if ((deadline - Date.now()) / 1000 <= handoffReserve(this.args.timeout) + Math.min(5, this.args.timeout / 100)) {
                row.pending_reason = 'deadline'; break;
              }
              resumeSessionId = reason === 'early_pending' && this.args.client === 'codex' && !this.args.worker
                ? output.metrics.provider_thread_id || undefined : undefined;
              // A fresh thread really sheds context; resuming the same history does not.
              this.taskSessions.delete(id);
              attemptNotes = readTask(file).body.split('\n## Progress').slice(1).join('\n## Progress');
              attemptFolder = path.join(folder, `continuation-${continuation + 1}`);
              fs.mkdirSync(attemptFolder);
              console.log(JSON.stringify({ event: 'task_continuation', task_id: id, task_run: row.task_run, continuation: continuation + 1, reason, remaining_seconds: remaining, resumed: !!resumeSessionId }));
            }
            const noProgress = status === 'pending' && (verifiedCount(file) <= verifiedBefore || !result.evidence.length);
            Object.assign(row, attemptTotals(row.attempts));
            const journal = readTask(file).body.split('\n## Progress').slice(1).join('\n## Progress');
            const notes = journal.startsWith(priorNotes) ? journal.slice(priorNotes.length) : journal;
            if (status === 'pending' && row.task_run >= limit) {
              status = 'blocked'; row.blocked_reason = 'task_run_limit'; row.review_request = limitMessage(row.task_run);
            } else if (noProgress) row.recovery_reason = 'no_progress';
            await this.record(file, `${status}: ${result.summary}\n\nEvidence: ${result.evidence.join('; ')}\n\nNext: ${result.next_step}`, true, notes);
            if (row.review_request) await this.record(file, row.review_request);
            await this.status(id, status); await this.cli('validate');
            Object.assign(row, { status, ended_at: now(), checked_before: count[0], checked_after: checks(file)[0], verified_before: verifiedBefore, verified_after: verifiedCount(file), result });
            if (!await this.publishRound(row, folder, file, before)) return await this.finish(this.lockError ? 'lock_lost' : this.signal?.aborted ? 'interrupted' : 'git_sync_error', this.lockError ? 1 : this.signal?.aborted ? 130 : 1);
            if (status === 'pending' && row.pending_reason !== 'reported_context_limit' && this.args.client === 'codex' && !this.args.worker && row.provider_thread_id)
              this.taskSessions.set(id, { id: row.provider_thread_id, contract: before });
            else this.taskSessions.delete(id);
            if (status === 'blocked') await this.reportBlocked(row, folder);
            if (status === 'completed') this.unavailableTasks.clear();
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof InvalidResponse || error instanceof WorkerFailure) Object.assign(row, error.metrics);
            if (row.attempts) {
              let attempt = row.attempts.at(-1);
              if (attempt?.folder !== attemptFolder) {
                attempt = { folder: attemptFolder, ...(error instanceof InvalidResponse || error instanceof WorkerFailure ? error.metrics : {}) };
                row.attempts.push(attempt);
              }
              attempt.error = message;
              jsonFile(path.join(attemptFolder, 'attempt.json'), attempt);
              Object.assign(row, attemptTotals(row.attempts));
            }
            try { if (fs.existsSync(file)) fs.copyFileSync(file, path.join(attemptFolder, 'rejected-task.md')); }
            catch (e) { row.archival_error = String(e); }
            let intact = false;
            try { intact = isDeepStrictEqual(contract(file), before) && readTask(file).meta.status === 'in-progress' && taskRuns(file) === row.task_run; } catch {}
            if (error instanceof WorkerFailure && intact && !row.archival_error && !this.signal?.aborted && !this.lockError && row.task_run < limit) {
              Object.assign(row, { status: 'pending', recovery_reason: error.kind, error: message, ended_at: now(), next_action: 'retry_task' });
              await this.record(file, `Worker attempt interrupted: ${message}. Changes are retained and are not assumed verified. Continue from the current files and retained evidence: ${folder}.`, true);
              await this.status(id, 'pending'); await this.cli('validate');
              if (!await this.publishRound(row, folder, file, before)) return await this.finish(this.lockError ? 'lock_lost' : this.signal?.aborted ? 'interrupted' : 'git_sync_error', this.lockError ? 1 : this.signal?.aborted ? 130 : 1);
              if (error.kind !== 'context_limit' && this.args.client === 'codex' && !this.args.worker && row.provider_thread_id)
                this.taskSessions.set(id, { id: row.provider_thread_id, contract: before });
              else this.taskSessions.delete(id);
              console.log(JSON.stringify({ event: 'task_retry', task_id: id, round: row.round, reason: error.kind, next_action: 'retry_task' }));
              break;
            }
            if (error instanceof InvalidResponse && intact && !row.archival_error && !clarification && !this.signal?.aborted && !this.lockError && row.task_run < limit && (!this.args.rounds || this.rows.length < this.args.rounds)) {
              Object.assign(row, { status: 'invalid_response', error: message, ended_at: now(), next_action: 'clarify_response' });
              jsonFile(path.join(folder, 'receipt.json'), row);
              clarification = { folder: attemptFolder, error: message, ...(this.args.client === 'codex' && !this.args.worker && (row.provider_thread_id || resumeSessionId) ? { sessionId: row.provider_thread_id || resumeSessionId } : {}) };
              console.log(JSON.stringify({ event: 'response_clarification', task_id: id, round: row.round, reason: message, resumed: !!clarification.sessionId, next_action: 'clarify_response' }));
              continue;
            }
            const failure = `Interrupted or invalid result: ${message}. Inspect ${folder} before retrying.`;
            // Preserve the terminal receipt even if reconciliation itself fails.
            let scopeChanged = true;
            try { scopeChanged = !isDeepStrictEqual(contract(file), before); } catch {}
            try {
              if (scopeChanged) {
                fs.writeFileSync(file, originalTask);
              }
            } catch (e) { row.reconciliation_error = String(e); }
            try { await this.status(id, 'blocked'); } catch (e) { row.reconciliation_error = String(e); }
            try { setTaskRuns(file, row.task_run); } catch (e) { row.counter_error = String(e); }
            try { await this.record(file, failure, true); } catch (e) {
              try { progress(file, failure + ` Worklog write failed: ${e}`); } catch (e) { row.reconciliation_error = String(e); }
            }
            Object.assign(row, { status: 'blocked', blocked_reason: error instanceof InvalidResponse ? 'invalid_response' : 'worker_error', error: message, ended_at: now() });
            this.taskSessions.delete(id);
            if (row.task_run >= limit) {
              row.blocked_reason = 'task_run_limit'; row.review_request = limitMessage(row.task_run);
              try { await this.record(file, row.review_request); } catch (e) { row.reconciliation_error = String(e); }
            }
            jsonFile(path.join(folder, 'receipt.json'), row);
            if (this.lockError || this.signal?.aborted) return await this.finish(this.lockError ? 'lock_lost' : 'interrupted', this.lockError ? 1 : 130);
            try { await this.cli('validate'); } catch (e) { row.reconciliation_error = String(e); }
            jsonFile(path.join(folder, 'receipt.json'), row);
            if (row.reconciliation_error || row.counter_error || row.archival_error) return await this.finish('reconciliation_error', 1);
            if (!await this.publishRound(row, folder, file, before)) return await this.finish(this.lockError ? 'lock_lost' : this.signal?.aborted ? 'interrupted' : 'git_sync_error', this.lockError ? 1 : this.signal?.aborted ? 130 : 1);
            await this.reportBlocked(row, folder);
            break;
          }
        }
      }
      return await this.finish('round_limit', 0);
    } finally {
      originalSignal?.removeEventListener('abort', stop);
      if (release) { try { await release(); } catch (error) { if (!this.lockError) throw error; } }
    }
  }
}

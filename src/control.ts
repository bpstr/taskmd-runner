import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lock } from 'proper-lockfile';
import { atomicJson, privateDir, registryRoot } from './monitor-state.js';
import { queueRecoveredMonitor } from './monitor.js';

export type ControlAction = 'pause' | 'resume' | 'stop';
export interface RunStatus {
  run_id: string; project: string; lane: string; state: 'starting' | 'running' | 'pausing' | 'paused' | 'stopping' | 'exited' | 'unreachable';
  revision: number; pid: number; run_dir: string; started_at: string;
  task: string | null; round: number; reason?: string; exit_code?: number; ended_at?: string;
}
interface RunRecord extends RunStatus { endpoint?: string; token?: string; }
export const controlRoot = () => process.env.TASKMD_RUNNER_CONTROL_DIR || path.join(registryRoot(), 'control');
const records = () => path.join(controlRoot(), 'runs');
const validId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export function laneName(lane = 'main') {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(lane)) throw new Error('Lane must be 1–64 letters, numbers, dots, underscores or hyphens');
  return lane;
}
const recordFile = (id: string) => {
  if (!validId(id)) throw new Error('Invalid run ID');
  return path.join(records(), `${id}.json`);
};
function publicStatus(record: RunRecord): RunStatus {
  const { endpoint, token, ...status } = record;
  return status;
}
function readRecord(id: string): RunRecord {
  try { return JSON.parse(fs.readFileSync(recordFile(id), 'utf8')); }
  catch { throw new Error('Run not found'); }
}
function savedRuns(project?: string) {
  if (!fs.existsSync(records())) return [];
  return fs.readdirSync(records()).flatMap(name => {
    const id = name.slice(0, -5);
    if (!name.endsWith('.json') || !validId(id)) return [];
    try {
      const record = readRecord(id);
      return record.run_id === id && (!project || record.project === project) ? [record] : [];
    } catch { return []; }
  });
}
function controllerGone(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}
function reconcileRecord(record: RunRecord): RunRecord {
  if (record.state !== 'exited') {
    if (!controllerGone(record.pid)) return record;
    // The controller may have persisted its own terminal status before exiting.
    record = readRecord(record.run_id);
    if (record.state !== 'exited') {
      let reason = 'controller_lost', endedAt = new Date().toISOString();
      try {
        const summary = JSON.parse(fs.readFileSync(path.join(record.run_dir, 'summary.json'), 'utf8'));
        if (summary.reason === 'storage_error') { reason = summary.reason; endedAt = summary.ended_at || endedAt; }
      } catch {}
      record = { ...publicStatus(record), state: 'exited', revision: record.revision + 1,
        reason, ended_at: endedAt, exit_code: 1, task: null };
      try { atomicJson(recordFile(record.run_id), record); } catch {}
    }
  }
  if (record.reason === 'controller_lost' || record.reason === 'storage_error') {
    queueRecoveredMonitor({ id: record.run_id.replaceAll('-', '').slice(0, 24), roadmap: record.project,
      createdAt: record.started_at, endedAt: record.ended_at, pid: record.pid, exitCode: record.exit_code,
      reason: record.reason, processState: 'exited', roadmapState: 'stopped' });
  }
  return record;
}
export async function requestRun(record: { run_id: string; endpoint?: string; token?: string }, action: 'status' | ControlAction): Promise<RunStatus> {
  if (!validId(record.run_id) || !record.token || !record.endpoint ||
      !new RegExp(`^http://127\\.0\\.0\\.1:[0-9]+/${record.run_id}$`).test(record.endpoint)) throw new Error('Run controller is unavailable');
  const response = await fetch(`${record.endpoint}/${action}`, {
    method: action === 'status' ? 'GET' : 'POST', headers: { Authorization: `Bearer ${record.token}` },
    signal: AbortSignal.timeout(2000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Run controller rejected ${action} (${response.status})`);
  const status = await response.json() as RunStatus;
  if (status.run_id !== record.run_id) throw new Error('Run controller identity mismatch');
  return status;
}
export async function runStatus(id: string): Promise<RunStatus> {
  const record = readRecord(id);
  if (record.state === 'exited') return publicStatus(reconcileRecord(record));
  try { return await requestRun(record, 'status'); }
  catch {
    const recovered = publicStatus(reconcileRecord(record));
    return recovered.state === 'exited' ? recovered : { ...recovered, state: 'unreachable' };
  }
}
export async function controlRun(id: string, action: ControlAction) {
  const record = readRecord(id);
  if (record.state === 'exited') throw new Error('Run has exited; start a new run');
  return requestRun(record, action);
}
export async function listRuns(project?: string, offset = 0, limit = 20, includeExited = false) {
  const root = project ? fs.realpathSync(path.resolve(project)) : undefined;
  const matching = savedRuns(root)
    .filter(record => includeExited || record.state !== 'exited')
    .map(reconcileRecord)
    .filter(record => includeExited || record.state !== 'exited')
    .sort((a, b) => b.started_at.localeCompare(a.started_at) || a.run_id.localeCompare(b.run_id));
  const page = matching.slice(offset, offset + limit);
  const runs = await Promise.all(page.map(record => record.state === 'exited' ? publicStatus(record) : runStatus(record.run_id)));
  return { runs: includeExited ? runs : runs.filter(record => record.state !== 'exited'),
    next_offset: offset + page.length < matching.length ? offset + page.length : null };
}

/** One authenticated loopback endpoint per invocation; never signal a saved PID. */
export class RunControl {
  status: RunStatus;
  private token = randomUUID();
  private endpoint?: string;
  private server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.origin || req.headers.authorization !== `Bearer ${this.token}`) { res.writeHead(403).end('{}'); return; }
    const action = req.url?.split('/').at(-1);
    if (req.url !== `/${this.status.run_id}/${action}` ||
        !((action === 'status' && req.method === 'GET') || (['pause', 'resume', 'stop'].includes(action || '') && req.method === 'POST'))) {
      res.writeHead(404).end('{}'); return;
    }
    if (action === 'pause' && !['stopping', 'exited', 'paused', 'pausing'].includes(this.status.state)) {
      this.update({ state: 'pausing' }); this.onChange('pause');
    } else if (action === 'resume' && ['paused', 'pausing'].includes(this.status.state)) {
      this.update({ state: 'running' }); this.onChange('resume'); this.wake?.();
    } else if (action === 'stop' && !['stopping', 'exited'].includes(this.status.state)) {
      this.update({ state: 'stopping' });
      // Let an in-run caller receive its acknowledgement before cancellation.
      res.once('finish', () => { this.onChange('stop'); this.wake?.(); });
    }
    res.end(JSON.stringify(this.status));
  });
  private wake?: () => void;
  private release?: () => Promise<void>;
  constructor(project: string, lane: string, runDir: string, private onChange: (action: ControlAction) => void) {
    const id = process.env.TASKMD_RUNNER_LAUNCH_ID || randomUUID();
    if (!validId(id)) throw new Error('Invalid launch ID');
    this.status = { run_id: id, project, lane: laneName(lane), state: 'starting', revision: 0,
      pid: process.pid, run_dir: runDir, started_at: new Date().toISOString(), task: null, round: 0 };
  }
  async open() {
    privateDir(controlRoot()); privateDir(records()); privateDir(path.join(controlRoot(), 'lanes'));
    const lane = createHash('sha256').update(this.status.project + '\0' + this.status.lane).digest('hex');
    try {
      this.release = await lock(path.join(controlRoot(), 'lanes', lane), { realpath: false, stale: 30_000,
        onCompromised: () => { this.onChange('stop'); this.wake?.(); } });
    } catch { throw new Error('Another runner owns this workspace and lane'); }
    try {
      for (const record of savedRuns(this.status.project)) {
        if (record.lane === this.status.lane) reconcileRecord(record);
      }
      await new Promise<void>((resolve, reject) => {
        this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve);
      });
      const address = this.server.address();
      if (!address || typeof address === 'string') throw new Error('No controller address');
      this.endpoint = `http://127.0.0.1:${address.port}/${this.status.run_id}`;
      this.update({ state: 'running' });
    } catch (error) { await this.close(); throw error; }
  }
  update(change: Partial<RunStatus>) {
    Object.assign(this.status, change, { revision: this.status.revision + 1 });
    atomicJson(recordFile(this.status.run_id), { ...this.status, ...(this.status.state === 'exited' ? {} : { endpoint: this.endpoint, token: this.token }) });
  }
  workerEnv(): NodeJS.ProcessEnv {
    return { TASKMD_RUNNER_SELF_ID: this.status.run_id, TASKMD_RUNNER_SELF_ENDPOINT: this.endpoint, TASKMD_RUNNER_SELF_TOKEN: this.token };
  }
  async checkpoint(signal: AbortSignal) {
    if (!['pausing', 'paused'].includes(this.status.state) || signal.aborted) return;
    this.update({ state: 'paused', task: null });
    await new Promise<void>(resolve => {
      const done = () => { signal.removeEventListener('abort', done); this.wake = undefined; resolve(); };
      this.wake = done; signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }
  async close() {
    this.wake?.();
    if (this.server.listening) {
      const closed = new Promise<void>(resolve => this.server.close(() => resolve()));
      this.server.closeAllConnections(); await closed;
    }
    const release = this.release; this.release = undefined;
    if (release) await release();
  }
}

/** Detached controllers survive a Desktop conversation or MCP client closing. */
export async function launchRun(project: string, lane: string, args: string[] = []) {
  const root = fs.realpathSync(path.resolve(project)); laneName(lane);
  const id = randomUUID();
  const logs = privateDir(path.join(privateDir(controlRoot()), 'launches'));
  const logFile = path.join(logs, `${id}.log`);
  const log = fs.openSync(logFile, 'wx', 0o600);
  const cli = fileURLToPath(new URL('../bin/taskmd-runner.js', import.meta.url));
  let child;
  try {
    child = spawn(process.execPath, [cli, '--project', root, '--lane', lane, ...args], {
      cwd: root, detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, TASKMD_RUNNER_LAUNCH_ID: id, TASKMD_RUNNER_SELF_ID: undefined,
        TASKMD_RUNNER_SELF_ENDPOINT: undefined, TASKMD_RUNNER_SELF_TOKEN: undefined },
    });
  } finally { fs.closeSync(log); }
  let failure: Error | undefined, exited = false;
  child.once('error', error => { failure = error; }); child.once('exit', () => { exited = true; });
  child.unref();
  for (let delay = 20, elapsed = 0; elapsed < 8000; delay = Math.min(delay * 2, 400)) {
    if (fs.existsSync(recordFile(id))) return { ...await runStatus(id), log: logFile };
    if (failure || exited) throw new Error(`Runner failed to start; see ${logFile}`);
    await new Promise(resolve => setTimeout(resolve, delay)); elapsed += delay;
  }
  return { run_id: id, project: root, lane, state: 'starting', log: logFile };
}

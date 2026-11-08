import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import { withoutMonitorCredentials } from './monitor-state.js';

export interface CommandOptions {
  cwd: string; env?: NodeJS.ProcessEnv; input?: string; signal?: AbortSignal;
  timeoutMs?: number; log?: Writable;
}
/** Each child owns a new process group; cancellation always reaps that group. */
export function command(executable: string, args: string[], options: CommandOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Interrupted')); return; }
    const child = spawn(executable, args, { cwd: options.cwd, env: withoutMonitorCredentials(options.env), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '', failure: Error | undefined, escalation: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ||= error as Error; }
    };
    const stop = (message: string) => {
      if (failure) return;
      failure = new Error(message); kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), 1000);
    };
    const abort = () => stop('Interrupted');
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(`Command timed out: ${executable}`), options.timeoutMs ?? 60000);
    child.stdout.on('data', chunk => {
      options.log?.write(chunk);
      if (options.log) stdout = (stdout + chunk).slice(-65536);
      else if (stdout.length + chunk.length > 16 * 1024 * 1024) stop(`Command output exceeds limit: ${executable}`);
      else stdout += chunk;
    });
    child.stderr.on('data', chunk => { options.log?.write(chunk); stderr = (stderr + chunk).slice(-3000); });
    child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') failure ||= error; });
    child.once('error', error => { failure ||= error; });
    child.once('close', code => {
      clearTimeout(timer); if (escalation) clearTimeout(escalation);
      // Reap descendants that outlived the leader as well.
      kill('SIGTERM');
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${executable} exit ${code}: ${stderr.slice(-1500)} ${stdout.slice(-1500)}`));
      else resolve(stdout);
    });
    child.stdin.end(options.input || '');
  });
}

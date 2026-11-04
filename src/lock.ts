import path from 'node:path';
import { lock } from 'proper-lockfile';

export const taskLease = (tasks: string) => path.join(tasks, '.taskmd-runner.lease');

/** Node-only lease: active owners heartbeat; crashed owners expire after 30s. */
export async function acquireTaskLock(tasks: string, onCompromised: (error: Error) => void) {
  try {
    return await lock(tasks, { lockfilePath: taskLease(tasks), stale: 30_000, update: 10_000, retries: 0, onCompromised });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw new Error('Another runner owns this task directory');
    throw error;
  }
}

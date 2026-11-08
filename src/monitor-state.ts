import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface MonitorRun {
  id: string; roadmap: string; createdAt: string; processState: string; roadmapState: string;
  pid?: number; role?: string | null; task?: string | null; iteration?: number;
  sourceRevision?: string; readyAt?: string; endedAt?: string; reason?: string; exitCode?: number;
  deadline?: string; waitReason?: string; resetAt?: string;
  attentionTasks?: string[]; attentionReasons?: Record<string, string>;
}
export const registryRoot = () => process.env.TASKMD_MONITOR_STATE_DIR || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'taskmd-runner')
  : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'taskmd-runner'));
export const privateDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); return dir;
};
export const atomicJson = (file: string, value: unknown) => {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
};
export const sanitize = (text: string) => text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '')
  .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{10,})\b/g, '[REDACTED]')
  .replace(/((?:api[_-]?key|authorization|password|token)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;"']+/gi, '$1[REDACTED]');
/** Explicit undefined values also mask adapters which merge their own process.env. */
export const withoutMonitorCredentials = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
  ...env, TASKMD_MONITOR_API_KEY: undefined, ROADMAP_MONITOR_API_KEY: undefined,
});

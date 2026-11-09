// Prepared local control exercise; no model or provider transport.
import fs from 'node:fs';
import path from 'node:path';
import { requestRun } from '../dist/control.js';
if (path.basename(process.env.TASKMD_TASK_FILE).startsWith('001-')) {
  const status = await requestRun({ run_id: process.env.TASKMD_RUNNER_SELF_ID,
    endpoint: process.env.TASKMD_RUNNER_SELF_ENDPOINT, token: process.env.TASKMD_RUNNER_SELF_TOKEN }, 'pause');
  if (status.state !== 'pausing') throw new Error('Pause was not acknowledged');
  fs.writeFileSync(path.join(process.env.TASKMD_ROUND_DIR, 'control.json'), JSON.stringify(status));
}
process.argv[2] = 'completed';
await import('./fake-worker.mjs');

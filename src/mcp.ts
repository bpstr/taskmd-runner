import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { CLIENT_NAMES } from '@bpstr/agent-adapter';
import { controlRun, launchRun, listRuns, requestRun, runStatus } from './control.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const guarded = async (work: () => Promise<unknown>) => {
  try { return result(await work()); }
  catch (error) { return { ...result({ error: error instanceof Error ? error.message : String(error) }), isError: true }; }
};
const annotations = (readOnly: boolean) => ({ readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false });
const startSchema = z.object({
  project: z.string().min(1).refine(path.isAbsolute, 'Use an absolute workspace path'),
  lane: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/).default('main'),
  client: z.enum(CLIENT_NAMES).optional(),
  rounds: z.number().int().min(0).optional(),
  filters: z.array(z.string()).max(64).optional(),
  task_prefixes: z.array(z.string()).max(64).optional(),
  timeout: z.number().int().positive().optional(),
  max_task_runs: z.number().int().positive().optional(),
  block_after_runs: z.number().int().positive().optional(),
  review_blockers: z.boolean().optional().describe('Review a worker-reported blocker within the current round before publishing it'),
  model: z.string().optional(), effort: z.string().optional(),
  config: z.string().optional(), task_dir: z.string().optional(), state_dir: z.string().optional(),
  taskmd: z.string().optional(), executable: z.string().optional(),
  worker: z.array(z.string()).min(1).max(64).optional().describe('Custom worker argv, replacing the coding-agent client'),
  notify: z.enum(['attention', 'off']).optional(), codex_session_policy: z.enum(['isolated', 'shared']).optional(),
  permissions: z.enum(['default', 'bypass']).optional(),
  sandbox: z.enum(['workspace-write', 'danger-full-access']).optional(),
  git_sync: z.boolean().optional(), git_repos: z.array(z.string()).max(64).optional(),
  git_integration_branch: z.string().min(1).optional().describe('Local integration branch, e.g. main. Merge before each task and commit handoffs; git_sync additionally fetches/pushes upstream.'),
  git_conflicts: z.enum(['skip', 'stop', 'worker']).optional(),
}).strict();

export function createRunnerMcp(self = false) {
  // Auto-scope inherited Desktop MCP configuration in runner-launched conversations.
  const scoped = self || Boolean(process.env.TASKMD_RUNNER_SELF_ID);
  const identity = { run_id: process.env.TASKMD_RUNNER_SELF_ID || '',
    endpoint: process.env.TASKMD_RUNNER_SELF_ENDPOINT, token: process.env.TASKMD_RUNNER_SELF_TOKEN };
  if (scoped && (!identity.run_id || !identity.endpoint || !identity.token)) throw new Error('Self MCP requires a runner worker environment');
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const server = new McpServer({ name: 'taskmd-runner', version });
  const id = scoped ? z.string().uuid().optional().describe('Omit to target this run') : z.string().uuid();
  const checkSelf = (requested?: string) => {
    if (scoped && requested && requested !== identity.run_id) throw new Error('Worker MCP can control only its own run');
  };
  server.registerTool('runner_status', {
    description: scoped ? 'Compact status of this run. Use since_revision to return only changes.' : 'Compact status by exact run ID. Use since_revision to return only changes.',
    inputSchema: z.object({ run_id: id, since_revision: z.number().int().nonnegative().optional() }).strict(),
    annotations: annotations(true),
  }, input => guarded(async () => {
    checkSelf(input.run_id);
    const status = scoped ? await requestRun(identity, 'status') : await runStatus(input.run_id!);
    return status.state !== 'unreachable' && status.revision === input.since_revision
      ? { run_id: status.run_id, revision: status.revision, unchanged: true } : status;
  }));
  server.registerTool('runner_control', {
    description: 'Pause after the current task round, resume, or stop with cancellation and task reconciliation. Requests are idempotent; pausing is not yet paused.',
    inputSchema: z.object({ run_id: id, action: z.enum(['pause', 'resume', 'stop']) }).strict(),
    annotations: annotations(false),
  }, input => guarded(async () => {
    checkSelf(input.run_id);
    return scoped ? requestRun(identity, input.action) : controlRun(input.run_id!, input.action);
  }));
  if (!scoped) {
    server.registerTool('runner_list', {
      description: 'Discover active local runs across workspaces, newest first. Include exited runs on request. Paginated; unreachable is not proof of exit.',
      inputSchema: z.object({ project: z.string().optional(), offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(50).default(20), include_exited: z.boolean().default(false) }).strict(), annotations: annotations(true),
    }, input => guarded(() => listRuns(input.project, input.offset, input.limit, input.include_exited)));
    server.registerTool('runner_start', {
      description: 'Start a detached runner in a workspace and named lane. Disjoint task_prefixes allow concurrent lanes; overlapping scopes remain locked. Starts real coding workers; use only when authorized.',
      inputSchema: startSchema, annotations: annotations(false),
    }, input => guarded(async () => {
      const args: string[] = [];
      const values = ['client', 'rounds', 'timeout', 'max_task_runs', 'block_after_runs', 'model', 'effort',
        'config', 'task_dir', 'state_dir', 'permissions', 'sandbox', 'git_conflicts', 'git_integration_branch', 'taskmd', 'executable', 'notify', 'codex_session_policy'] as const;
      for (const key of values) if (input[key] !== undefined) args.push('--' + key.replaceAll('_', '-'), String(input[key]));
      for (const [key, flag] of [['filters', '--filter'], ['task_prefixes', '--task-prefix'], ['git_repos', '--git-repo']] as const)
        for (const value of input[key] || []) args.push(flag, value);
      if (input.git_sync) args.push('--git-sync');
      if (input.review_blockers) args.push('--review-blockers');
      if (input.worker) args.push('--worker', ...input.worker);
      return launchRun(input.project, input.lane, args);
    }));
  }
  return server;
}

export async function serveMcp(self = false) {
  // Validate scope before waiting for the client's first message.
  const server = createRunnerMcp(self);
  const handle = serveStdio(() => server, { onerror: error => console.error(error.message) });
  const close = () => { void handle.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  process.stdin.once('end', close);
}

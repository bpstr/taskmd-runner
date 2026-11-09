import { CLIENT_NAMES, type ClientName } from '@bpstr/agent-adapter';
import { readFileSync } from 'node:fs';
import { Runner, type Options } from './runner.js';
import { notificationEvents, requestNotificationPermission, type NotificationEvent } from './notifications.js';
import { monitorCommand } from './monitor-cli.js';
import { laneName } from './control.js';

const help = `Usage: taskmd-runner --project PATH [options]

Select pending taskmd work, claim it, run one worker, validate and repeat.

  --version              Print the installed package version
  --lane NAME            Workspace lane identity (default main, or task-prefix scope)
  mcp [--self]           Serve local runner control over MCP stdio
  --client NAME          ${CLIENT_NAMES.join(', ')} (default codex)
  --rounds N             Maximum worker rounds; 0 drains ready work (default 0)
  --max-task-runs N      Maximum runs per task across restarts (default 5)
  --block-after-runs N   Block unfinished tasks after N runs (default 3)
  --filter EXPR          Repeatable taskmd filter
  --task-prefix PATH     Allow a task-directory subtree; repeat for alternatives
  --timeout SECONDS      Per-worker timeout (default 7200; 2 hours)
  --model NAME           Codex default gpt-6.1-sol; other clients inherit configuration
  --effort LEVEL         Codex default medium; other clients inherit configuration
  --permissions POLICY  default or bypass (explicit unattended permission opt-in)
  --sandbox MODE         Codex workspace-write (default) or danger-full-access
  --codex-session-policy POLICY  isolated (default) or shared desktop history
  --executable PATH      Agent executable override
  --taskmd PATH          taskmd executable (default taskmd)
  --config PATH          Project config override
  --task-dir PATH        Task directory override
  --state-dir PATH       Evidence directory override
  --git-sync             Fetch/merge before tasks; commit/push valid rounds
  --git-integration-branch NAME  Merge a local branch before each task; commit handoffs
  --git-repo PATH        Repeatable repository path (default project checkout)
  --git-conflicts MODE   stop (default) or worker for a dedicated resolver
  --notify POLICY       attention (default) or off
  --notify-on EVENT      Additional alert; repeatable or comma-separated:
                        ${notificationEvents.join(', ')}
  --worker COMMAND ...  Custom worker argv; must be last
  notifications request-permission   macOS notification setup
  monitor configure --url URL [--api-key-stdin] [--label NAME]
  monitor test|status|enable|disable|flush [--json]   Roadmap Monitor reporting
`;
export function parseArgs(argv: string[]): Options {
  const options: Options = { project: '', taskmd: 'taskmd', filter: [], rounds: 0, maxTaskRuns: 5, blockAfterRuns: 3, timeout: 7200, client: 'codex', sandbox: 'workspace-write', permissions: 'default', notify: 'attention', notifyOn: [], gitSync: false, gitRepo: [], gitConflicts: 'stop' };
  const strings: Record<string, keyof Options> = { '--project': 'project', '--config': 'config', '--task-dir': 'taskDir', '--state-dir': 'stateDir', '--taskmd': 'taskmd', '--model': 'model', '--effort': 'effort', '--client': 'client', '--sandbox': 'sandbox', '--executable': 'executable', '--permissions': 'permissions', '--notify': 'notify' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--lane') { options.lane = laneName(argv[++i]); if (argv[i] === undefined) throw new Error('Missing value for --lane'); continue; }
    if (flag === '--worker') { options.worker = argv.slice(i + 1); if (!options.worker.length) throw new Error('--worker must be nonempty'); break; }
    if (flag === '--git-sync') { options.gitSync = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (strings[flag]) Object.assign(options, { [strings[flag]]: value });
    else if (flag === '--filter') options.filter.push(value);
    else if (flag === '--task-prefix') (options.taskPrefix ??= []).push(value);
    else if (flag === '--rounds') options.rounds = Number(value);
    else if (flag === '--codex-session-policy') options.codexSessionPolicy = value as Options['codexSessionPolicy'];
    else if (flag === '--max-task-runs') options.maxTaskRuns = Number(value);
    else if (flag === '--block-after-runs') options.blockAfterRuns = Number(value);
    else if (flag === '--timeout') options.timeout = Number(value);
    else if (flag === '--notify-on') options.notifyOn.push(...value.split(',') as NotificationEvent[]);
    else if (flag === '--git-repo') options.gitRepo.push(value);
    else if (flag === '--git-conflicts') options.gitConflicts = value as Options['gitConflicts'];
    else if (flag === '--git-integration-branch') { if (!value.trim()) throw new Error('Integration branch must be nonempty'); options.gitIntegrationBranch = value; }
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!options.project) throw new Error('--project is required');
  if (!CLIENT_NAMES.includes(options.client as ClientName)) throw new Error(`Unsupported client: ${options.client}`);
  if (!Number.isSafeInteger(options.rounds) || options.rounds < 0) throw new Error('rounds must be a nonnegative integer');
  for (const key of ['maxTaskRuns', 'blockAfterRuns'] as const)
    if (!Number.isSafeInteger(options[key]) || options[key] <= 0) throw new Error(`${key} must be a positive integer`);
  if (!Number.isFinite(options.timeout) || options.timeout <= 0 || !Number.isSafeInteger(options.timeout * 1000) || options.timeout * 1000 > 2147483647) throw new Error('timeout must be positive and fit a Node timer');
  if (!['workspace-write', 'danger-full-access'].includes(options.sandbox)) throw new Error('Invalid sandbox');
  if (!['default', 'bypass'].includes(options.permissions)) throw new Error('Invalid permissions');
  if (options.codexSessionPolicy !== undefined && !['isolated', 'shared'].includes(options.codexSessionPolicy)) throw new Error('Invalid Codex session policy');
  if (!['attention', 'off'].includes(options.notify)) throw new Error('Invalid notification policy');
  if (!['stop', 'worker'].includes(options.gitConflicts)) throw new Error('Invalid Git conflict policy');
  if (!options.gitSync && !options.gitIntegrationBranch && (options.gitRepo.length || options.gitConflicts === 'worker')) throw new Error('--git-repo and --git-conflicts worker require --git-sync or --git-integration-branch');
  if (options.notifyOn.some(event => !notificationEvents.includes(event))) throw new Error('Unknown notification event');
  if (options.client === 'codex') {
    options.model ??= 'gpt-6.1-sol';
    options.effort ??= 'medium';
  }
  return options;
}
export async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'mcp') {
    if (argv.length > 2 || (argv[1] !== undefined && argv[1] !== '--self')) throw new Error('Use mcp [--self]');
    const { serveMcp } = await import('./mcp.js');
    await serveMcp(argv[1] === '--self'); return 0;
  }
  const workerAt = argv.indexOf('--worker');
  const runnerArgs = workerAt < 0 ? argv : argv.slice(0, workerAt);
  if (runnerArgs.includes('--help') || runnerArgs.includes('-h')) { console.log(help); return 0; }
  if (runnerArgs.includes('--version')) {
    console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
    return 0;
  }
  const controller = new AbortController(); const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    if (argv[0] === 'monitor') { await monitorCommand(argv.slice(1)); return 0; }
    if (argv[0] === 'notifications') {
      if (argv.length !== 2 || argv[1] !== 'request-permission') throw new Error('Use notifications request-permission');
      return await requestNotificationPermission(controller.signal);
    }
    return await new Runner(parseArgs(argv), controller.signal).run();
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); return controller.signal.aborted ? 130 : 1; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}

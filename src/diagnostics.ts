import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const toolKinds = new Set(['commandExecution', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'fileChange', 'collabAgentToolCall']);
const initialShellCalls = 8;

async function inspectLog(file: string) {
  if (!fs.existsSync(file)) return null;
  const calls: Record<string, number> = {}, unsuccessful: Record<string, number> = {};
  const seen = new Set<string>(), signatures = new Set<string>();
  const largestShell: { call: number; bytes: number; duration_ms: number | null; exit_code: number | null }[] = [];
  let count = 0, repeats = 0, shellCount = 0, shellBytes = 0, initialBytes = 0, malformed = 0;
  const input = fs.createReadStream(file);
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { malformed++; continue; }
    if (event?.method !== 'item/completed') continue;
    const item = event.params?.item;
    if (!toolKinds.has(item?.type)) continue;
    if (item.id) {
      const id = JSON.stringify([event.params.threadId, item.id]);
      if (seen.has(id)) continue;
      seen.add(id);
    }
    count++;
    const kind: string = item.type;
    calls[kind] = (calls[kind] ?? 0) + 1;
    if ((typeof item.exitCode === 'number' && item.exitCode !== 0) ||
        ['failed', 'declined', 'interrupted'].includes(item.status) || item.success === false || item.error)
      unsuccessful[kind] = (unsuccessful[kind] ?? 0) + 1;
    if (['commandExecution', 'mcpToolCall', 'dynamicToolCall', 'webSearch'].includes(kind)) {
      const invocation = [kind, item.cwd, item.command, item.server, item.tool, item.arguments, item.query, item.action];
      const signature = createHash('sha256').update(JSON.stringify(invocation)).digest('hex');
      if (signatures.has(signature)) repeats++;
      signatures.add(signature);
    }
    if (kind === 'commandExecution') {
      const bytes = typeof item.aggregatedOutput === 'string' ? Buffer.byteLength(item.aggregatedOutput) : 0;
      shellBytes += bytes;
      if (++shellCount <= initialShellCalls) initialBytes += bytes;
      largestShell.push({ call: count, bytes, duration_ms: item.durationMs ?? null, exit_code: item.exitCode ?? null });
      largestShell.sort((a, b) => b.bytes - a.bytes);
      if (largestShell.length > 5) largestShell.pop();
    }
  }
  return { calls: count, calls_by_kind: calls, unsuccessful_by_kind: unsuccessful, exact_repeats: repeats,
    shell_calls: shellCount, shell_output_bytes: shellBytes, first_eight_shell_output_bytes: initialBytes,
    largest_shell_results: largestShell, malformed_lines: malformed };
}

export async function writeDiagnostics(runDir: string, rows: Record<string, any>[], settings: Record<string, unknown>) {
  const rounds = [];
  const totals = { rounds: rows.length, dispatches: 0, dispatches_with_usage: 0, dispatches_with_tool_logs: 0,
    input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, elapsed_worker_seconds: 0,
    tool_calls: 0, unsuccessful_calls: 0, exact_repeats: 0, shell_calls: 0, shell_output_bytes: 0,
    first_eight_shell_output_bytes: 0, malformed_lines: 0 };
  const outcomes: Record<string, number> = {};
  for (const row of rows) {
    const attempts = [];
    for (const attempt of row.attempts ?? []) {
      totals.dispatches++;
      totals.elapsed_worker_seconds += attempt.elapsed_seconds ?? 0;
      const usage = attempt.usage;
      const input = usage?.inputTokens ?? usage?.input_tokens;
      const cached = usage?.cachedInputTokens ?? usage?.cached_input_tokens;
      const output = usage?.outputTokens ?? usage?.output_tokens;
      if ([input, cached, output].every(Number.isFinite)) {
        totals.dispatches_with_usage++;
        totals.input_tokens += input;
        totals.cached_input_tokens += cached;
        totals.output_tokens += output;
      }
      const folder = typeof attempt.folder === 'string' ? path.relative(runDir, attempt.folder) : null;
      const log = folder !== null && settings.client === 'codex' ? await inspectLog(path.join(runDir, folder, 'worker.jsonl')) : null;
      if (log) {
        totals.dispatches_with_tool_logs++;
        totals.tool_calls += log.calls;
        totals.unsuccessful_calls += Object.values(log.unsuccessful_by_kind).reduce((sum, n) => sum + n, 0);
        totals.exact_repeats += log.exact_repeats;
        totals.shell_calls += log.shell_calls;
        totals.shell_output_bytes += log.shell_output_bytes;
        totals.first_eight_shell_output_bytes += log.first_eight_shell_output_bytes;
        totals.malformed_lines += log.malformed_lines;
      }
      attempts.push({ folder, reason: attempt.reason, resumed: attempt.session_resumed ?? false,
        elapsed_seconds: attempt.elapsed_seconds, prompt_bytes: attempt.prompt_bytes, usage: usage ?? null,
        context: attempt.context ?? null, tools: log });
    }
    const status = row.status ?? 'unknown';
    outcomes[status] = (outcomes[status] ?? 0) + 1;
    rounds.push({ round: row.round, task_id: row.task_id, task_path: row.task_path, status,
      reason: row.blocked_reason ?? row.pending_reason ?? row.recovery_reason,
      checked_before: row.checked_before, checked_after: row.checked_after,
      verified_before: row.verified_before, verified_after: row.verified_after, attempts });
  }
  totals.elapsed_worker_seconds = Math.round(totals.elapsed_worker_seconds * 100) / 100;
  const file = path.join(runDir, 'diagnostics.json');
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, settings, outcomes, totals, rounds }, null, 2) + '\n', { mode: 0o600 });
  return file;
}

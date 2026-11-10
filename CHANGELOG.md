# Changelog

## 0.4.1 — 2026-11-10

- Add opt-in review of worker-reported blockers within the current task round.
  Preserve its deadline, run counter and task contract, and retain both receipts.

## 0.4.0 — 2026-11-09

- Merge an explicitly selected local integration branch before each lane task,
  with local handoff commits and optional additional upstream Git synchronization.
- Add local MCP discovery, detached start, compact status and pause/resume/stop
  control across workspaces and named lanes. Keep existing scope locks,
  cancellation reconciliation, receipts and monitoring.
- Automatically attach a self-scoped runner MCP to Codex workers. Pause at task
  boundaries and return unchanged status revisions without reading worker logs.

- Report taskmd invocations to Roadmap Monitor using its existing v1 protocol.
  Add private connection setup, status/probe controls, heartbeats, task activity,
  validated results, blocker attention and durable historical replay.
- Preserve task execution during reporting failures. Exclude monitor credentials
  from taskmd, Git and coding-worker subprocess environments.
- Distinguish a completed queue from a successful round-cap exit in the dashboard.


## 0.3.3 — 2026-11-07

- Reference task files instead of embedding their contents in each worker prompt;
  keep stable instructions and the result schema ahead of changing run details.
- Keep up to two early checkpoint continuations within one charged task run and
  its original deadline, with separate receipts and retained usage telemetry.
- Remove the worker's precautionary context stopping rule. Start fresh Codex
  history for context handoffs and explicit provider context-overflow recovery;
  preserve near-deadline safe stops and durable run limits.

## 0.3.2 — 2026-11-06

- Isolate Codex worker sessions under each runner's state directory by default,
  keeping background conversations out of ordinary Codex Desktop history while
  preserving same-task continuation, clarification and deadline steering.
- Reuse profile configuration and file-based credentials without sharing session
  stores. Override inherited SQLite/log paths; document keyring-only setup.
- Add `--codex-session-policy shared` for explicit use of shared desktop history.
  Existing conversations are preserved; restart running queues after upgrading.

## 0.3.1 — 2026-11-06

- Request a durable checkpoint before the worker deadline. Codex receives an
  active-turn message through app-server; other workers check a handoff file.
- Preserve work and retry timeouts, crashes and unfinished checkpoints within
  the task-run budget. Exhausted tasks yield to independent ready work.
- Allow JSON events up to 16 MiB while retaining bounded output tails, and
  include the actual parser or provider error in failure receipts.
- Resume Codex sessions without downloading their full turn history. Preserve
  sandbox settings, structured results, usage and interruption cleanup.

## 0.3.0 — 2026-11-06

- Allow runners with disjoint task prefixes to share a task directory while
  preserving exclusive ownership for overlapping scopes and Git synchronization.
- Persist per-task run counts, with configurable limits and owner review requests
  when unfinished tasks reach their limit.
- Continue independent work after task-level blockers and worker failures;
  preserve rejected handoffs and allow one bounded response clarification.
- Keep workers focused on full task acceptance within their budget, reuse Codex
  sessions for partial continuations, and increase the default timeout to two hours.

## 0.2.1 — 2026-11-05

- Keep workers within the ticket's stated outcome and acceptance criteria.
  Treat conflicts as blockers and require an explicit user decision for scope
  changes instead of reframing the ticket around existing behavior or difficulty.

## 0.2.0 — 2026-11-04

- Add optional Git fetch/integration before each task and commit/push after
  validated handoffs, with explicit repository selection for workspaces.
- Add opt-in dedicated conflict workers and bounded push-race recovery. Preserve
  merge state, local commits and task completion when synchronization fails.
- Remove the Python forwarding launcher and native lock addon. Use a Node-only
  lease with stale-owner recovery and interruption cleanup. Stop older runners
  before upgrading because their advisory locks use a different protocol.
- Keep task workers, conflict workers and Git synchronization evidence distinct.
- Add task-subtree allowlists and preserve zero-padded task identifiers through
  native taskmd rewrites and worklog handoffs.

## 0.1.0 — 2026-11-04

First packaged TypeScript release of taskmd-runner.

- Preserve the sequential Python loop's selection, locking, dependency checks,
  task transitions, bounded handoffs, worklogs and stop conditions.
- Run Codex, Claude, Gemini, Grok, Kimi and Muse through the public
  `@bpstr/agent-adapter` package. Retain custom workers and a Python forwarding
  entry point.
- Require fresh documentation-check evidence in worker notes and results.
- Add desktop attention alerts, optional completion/round-limit alerts and macOS
  notification permission setup.
- Expose `--version`; ship compiled modules, worker instructions and result schema.

Prepared checks cover the runner and client contracts. Live work exercised Grok,
Claude and Codex with three-round caps. Native locking is qualified on Node 24
and macOS; Windows is not qualified. Notification display depends on system
permission and desktop settings.

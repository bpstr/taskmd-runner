# Changelog

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

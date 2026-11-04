# taskmd-runner

A sequential taskmd loop: select pending work, claim it, run one coding worker,
validate the result, update the task Markdown and repeat. It exits when the selected
queue has no ready work. It never polls an empty queue or retries failed workers.

Requires Node.js 20+, taskmd 0.8.0 and a configured coding-agent CLI. Supports
Codex, Claude, Gemini, Grok, Kimi and Muse through the public
[@bpstr/agent-adapter](https://www.npmjs.com/package/@bpstr/agent-adapter) package.
macOS and Linux are supported; advisory locking uses the native `fs-ext` addon
and may require a C++ build toolchain when installing. Install/build and execute
with the same Node major version; after changing Node versions, rebuild `fs-ext`.

Install the published CLI:

```sh
npm install -g @bpstr/taskmd-runner
taskmd-runner --version
taskmd-runner --project /path/to/project --client claude --rounds 3
```

From a source checkout:

```sh
npm ci
npm run build
node bin/taskmd-runner.js --project /path/to/project --client claude --rounds 3 --filter group=api/documentation
```

The project supplies `.taskmd.yaml`, task files and repository instructions.
`--rounds 0` (the default) drains ready work. Filters are repeatable and passed
directly to taskmd. Strict priority ordering preserves phase and dependency gates.
The default Codex sandbox is `workspace-write`; select `danger-full-access` only
in an environment where the task already authorizes that access. Model and effort
default to `gpt-6.1-sol` and `medium` for Codex; explicit flags override them.
Other clients inherit their configuration. `--timeout` bounds each
worker in seconds (default 1800). `--client` defaults to `codex`; `--model` and
`--effort` use these defaults for Codex and are otherwise passed only when supplied. Clients that do not support an effort
override fail before a task is claimed. Other clients inherit their permission
configuration; `--permissions bypass` explicitly enables unattended permissions.
Codex retains the original sandbox and `approval_policy="never"` behavior.
`--executable` overrides the selected agent binary. Each round is a fresh session.

The runner passes [WORKER.md](WORKER.md), the complete task contract and up to
4 KiB of its latest Progress to a fresh worker. Context files and older receipts
are read on demand. Progress and terminal evidence stay under
`## Progress` in the task file. Machine receipts, prompts and worker logs are in
`.taskmd-runner/<run>/<round>/`; `summary.json` records elapsed seconds, prompt
bytes, reported token usage and checklist progress. These local artifacts can contain
source context; keep them private. Token usage is not a monetary-cost estimate.

Every worker receives the mandatory documentation-consistency check in
[WORKER.md](WORKER.md). It records alignment, an authorized change, a conflict or
missing documentation in Progress and result evidence before implementation;
unresolved scope, authority, publication or acceptance conflicts block the ticket.
The runner rejects a round without matching Documentation check outcomes in its
new Progress notes and result evidence, retaining that evidence in the receipt.
The worker performs the semantic comparison; the runner validates its presence.

With `worklogs: true`, native `taskmd worklog` notes retain detailed handoffs.
The task body keeps verified slice checkmarks and its latest checkpoint, with a
link to the ticket worklog. Existing projects with worklogs disabled keep inline
history. Put Progress after scope and acceptance as the task's final section.

Transitions:

| Outcome | Transition | Continuation |
| --- | --- | --- |
| Verified acceptance | pending → in-progress → completed | Select next task |
| PR-review acceptance + linked real PR | pending → in-progress → in-review | Wait for manual merge disposition |
| Verified partial slice | in-progress → pending | Continue with a new checked Progress slice and evidence |
| Missing prerequisite/input | in-progress → blocked | Continue independent work |
| Failure, timeout, interruption or invalid result | in-progress → blocked | Stop; inspect evidence before retry |

Completion requires unchanged task scope, checked criteria and nonempty evidence.
The worker checks acceptance; the runner validates the result contract. It does not
independently prove semantic correctness or execute unreviewed `verify` commands.
Human review remains appropriate before publication. Commits, pushes and deployment
are manual. PR-review never marks work completed before merge.

Exit 0 means a drained selection or the round limit; inspect the summary reason.
Exit 2 means unfinished work has no eligible successor, or a pending worker made no
checked progress. Exit 1 means an error; 130 means worker interruption. Existing
in-progress/blocked tasks require explicit operator reconciliation. Each physical
task directory has an advisory process lock; coordinate other tools and worktrees
through their existing owners. A taskmd failure is an error, never an empty queue.

Custom workers use an argument vector without a shell:

```sh
node bin/taskmd-runner.js --project /path/to/project --rounds 5 --worker /path/to/worker --flag
```

The worker reads its prompt from stdin, edits `TASKMD_TASK_FILE`, and writes
[result.schema.json](result.schema.json) JSON to `TASKMD_RESULT_FILE`.
`TASKMD_ROUND_DIR` is its artifact directory. Keep `--worker` last.

Run the prepared tests (real taskmd, fake worker, no model calls):

```sh
npm test
```

Desktop notifications follow roadmap-runner's attention policy. They use
`terminal-notifier` on macOS or `notify-send` in a Linux desktop session. Install
and configure the sender separately. Failures are recorded in `notifications.json`
and do not change task outcomes. `--notify off` disables all alerts; successful
alerts are deduplicated within a run. Add round-limit or completion alerts with
`--notify-on runner.turn_limit_reached,runner.completed`. Alerts contain project
and task identifiers, not worker output. On macOS, request authorization with:

```sh
node bin/taskmd-runner.js notifications request-permission
```

`taskmd_runner.py` remains a standard-library-only forwarding entry point for
existing commands; execution is entirely TypeScript/Node. Build before using it.

Built against the [taskmd 0.8 quick start](https://driangle.github.io/taskmd/getting-started/),
the original [do-task](https://github.com/driangle/taskmd/blob/main/claude-code-plugin/skills/do-task/SKILL.md),
[complete-task](https://github.com/driangle/taskmd/blob/main/claude-code-plugin/skills/complete-task/SKILL.md)
and [verify-task](https://github.com/driangle/taskmd/blob/main/claude-code-plugin/skills/verify-task/SKILL.md)
skills, and [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/).

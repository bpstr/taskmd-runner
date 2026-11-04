# taskmd-runner

A sequential taskmd loop: select pending work, claim it, run one coding worker,
validate the result, update the task Markdown and repeat. It exits when the selected
queue has no ready work. It never polls an empty queue or retries failed workers.

Requires Python 3.10+, taskmd 0.8.0 and Codex CLI (or a custom worker).

```sh
python3 -m pip install -r requirements.txt
python3 taskmd_runner.py --project /path/to/project --rounds 5 --filter group=api/documentation
```

The project supplies `.taskmd.yaml`, task files and repository instructions.
`--rounds 0` (the default) drains ready work. Filters are repeatable and passed
directly to taskmd. Strict priority ordering preserves phase and dependency gates.
The default worker sandbox is `workspace-write`; select `danger-full-access` only
in an environment where the task already authorizes that access. Model and effort
inherit CLI configuration unless explicitly supplied. `--timeout` bounds each
worker in seconds (default 1800).

The runner passes [WORKER.md](WORKER.md), the complete task contract and up to
4 KiB of its latest Progress to a fresh worker. Context files and older receipts
are read on demand. Progress and terminal evidence stay under
`## Progress` in the task file. Machine receipts, prompts and worker logs are in
`.taskmd-runner/<run>/<round>/`; `summary.json` records elapsed seconds, prompt
bytes, reported token usage and checklist progress. These local artifacts can contain
source context; keep them private. Token usage is not a monetary-cost estimate.

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
python3 taskmd_runner.py --project /path/to/project --rounds 5 --worker /path/to/worker --flag
```

The worker reads its prompt from stdin, edits `TASKMD_TASK_FILE`, and writes
[result.schema.json](result.schema.json) JSON to `TASKMD_RESULT_FILE`.
`TASKMD_ROUND_DIR` is its artifact directory. Keep `--worker` last.

Run the prepared tests (real taskmd, fake worker, no model calls):

```sh
python3 -m unittest discover -s tests -v
```

Built against the [taskmd 0.8 quick start](https://driangle.github.io/taskmd/getting-started/)
and [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/).

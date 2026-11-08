# taskmd-runner

A sequential taskmd loop: select pending work, claim it, run one coding worker,
validate the result, update the task Markdown and repeat. It exits when the selected
queue has no ready work. It never polls an empty queue or retries failed workers.

Requires Node.js 20+, taskmd 0.8.0 and a configured coding-agent CLI. Supports
Codex, Claude, Gemini, Grok, Kimi and Muse through the public
[@bpstr/agent-adapter](https://www.npmjs.com/package/@bpstr/agent-adapter) package.
macOS and Linux are supported. The runner and its npm dependencies use Node.js;
installation requires no Python, native addon or C++ build toolchain. Optional
Git synchronization also requires Git and configured repository credentials.

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

Each task has a maximum of 5 worker runs (`--max-task-runs 5`). Unfinished work
becomes blocked after 3 runs by default (`--block-after-runs 3`); the lower limit
applies. A verified partial slice counts as a run. Completion or a valid PR-review
handoff on the final allowed run is accepted. At the limit, the runner records
the blocker and requests owner review or splitting into subtasks that collectively
preserve the original scope and acceptance criteria. This request appears in the
task handoff and run summary, and in the receipt when a worker reaches the limit.
The runner selects independent ready work; dependent tasks remain gated.
These limits are separate from `--rounds`, which caps workers for the whole
invocation. Each worker has a two-hour timeout by default (`--timeout 7200`),
allowing up to six hours over three runs. To allow five sessions for a task that has
been reviewed, raise both thresholds, for example `--block-after-runs 5`.

The runner keeps a `<!-- taskmd-runner runs: N -->` counter under `## Progress`,
so counts survive restarts, changed evidence directories, Git synchronization
and worklog compaction. Tasks without a counter start at zero; earlier runs are
not reconstructed. Preserve the counter when editing handoffs. A blocked task
requires owner review before explicitly returning it to pending; raise both
thresholds above its retained count to grant more runs. An already exhausted
pending task is blocked before another worker starts.

Use repeatable `--task-prefix` options to select task-directory subtrees, for example
`--task-prefix api --task-prefix astro`. Prefixes are alternatives; normal taskmd
filters still apply. Selection retains native ordering and the full dependency graph;
tasks in other directories are never claimed. A scoped search expands up to 4,096
ranked candidates and fails for review if that bound is exhausted. Recheck the
owning checkout at claim time; symlinks cannot widen an allowed subtree.
The default Codex sandbox is `workspace-write`; select `danger-full-access` only
in an environment where the task already authorizes that access. Model and effort
default to `gpt-6.1-sol` and `medium` for Codex; explicit flags override them.
Other clients inherit their configuration. `--timeout` bounds each
worker in seconds (default 7200, or two hours). `--client` defaults to `codex`; `--model` and
`--effort` use these defaults for Codex and are otherwise passed only when supplied. Clients that do not support an effort
override fail before a task is claimed. Other clients inherit their permission
configuration; `--permissions bypass` explicitly enables unattended permissions.
Codex retains the original sandbox and `approval_policy="never"` behavior.
`--executable` overrides the selected agent binary. Each task starts a fresh
session. Workers continue through full task acceptance within the supplied
deadline; verified slices are checkpoints within execution. Sizing estimates do
not end a run. A partial handoff records the actual time/context limit, retained
verification, unverified work and next edit. Before the deadline, the runner asks
for a checkpoint: Codex receives an active-turn message through app-server; other
clients and custom workers check the supplied handoff-request file. Unresponsive
workers still have a hard deadline. Within one runner invocation, Codex resumes
the task's session after a handoff or recoverable worker failure while its
contract is unchanged. Early `pending` returns receive at most two continuations
inside that same charged task run, sharing its original deadline. Each dispatch
keeps its own receipt under the round directory; invocation round caps and durable
task-run limits still apply. Stops within the handoff reserve plus a small safety
margin are accepted as deadline handoffs even before the warning fires. The runner
imposes no context-token budget. Context-labelled handoffs and explicit provider
context-overflow errors start a fresh Codex thread from durable Progress instead of replaying the
same history. Receipts distinguish reported concerns from observed usage; neither
token counts nor a normal pending return establish a provider context failure.

Task prompts reference the task file through its path and `TASKMD_TASK_FILE`.
Workers read its requirements and latest Progress from disk using bounded reads.
The stable worker instructions and result schema precede changing run details;
the task body and accumulated history are not copied into each launch prompt.
Reading files still consumes context, and cache savings depend on provider reuse.

By default, Codex workers use a private `codex-home/` inside the runner's run
directory, including when `--state-dir` is supplied. Persistent sessions and
SQLite state stay there, so new background chats do not enter your ordinary
Codex Desktop history. Task retries and clarification turns share that home.
The runner links configuration, file-based credentials, user instructions,
hooks, rules, skills and plugins from the inherited `CODEX_HOME` (normally
`~/.codex`); it never links existing sessions, archives or state databases.
Worker SQLite and log paths override inherited storage locations. Other relative
file references in your Codex configuration should use absolute paths.

Keyring-only credentials are scoped to the Codex home and may require a separate
file-backed automation profile: sign in with
`CODEX_HOME=/private/runner-profile codex -c cli_auth_credentials_store='"file"' login`,
then run with that `CODEX_HOME`. Create the private directory first and set
`cli_auth_credentials_store = "file"` in its `config.toml`. Existing environment
credentials still pass through. No credentials are copied into runner logs.
To deliberately use your inherited profile and display persisted worker chats
alongside your own conversations, select `--codex-session-policy shared`.
Custom workers and other clients keep their own session policies.

After upgrading, stop and restart existing runners to adopt isolation. Earlier
worker chats remain in your ordinary history; this change does not archive or
delete conversations. Keep run directories private, including their credential
links and any refreshed credentials Codex writes there.

A changed contract or new invocation starts fresh; other clients use the recorded
checkpoint. An invalid response can receive one clarification turn if the task and
invocation run budgets allow it. That turn counts as another run, resumes the
explicit persisted Codex session, or supplies the prior response and evidence
context to other clients/custom workers in a new session. Clarification corrects
the handoff only; it cannot implement more work or change scope or acceptance.
Both attempts retain their own logs, usage and receipts. A second invalid response
blocks the task and continues independent ready work.

The runner passes [WORKER.md](WORKER.md), the complete task contract and up to
4 KiB of its latest Progress to a fresh worker. Context files and older receipts
are read on demand. Progress and terminal evidence stay under
`## Progress` in the task file. Machine receipts, prompts and worker logs are in
`.taskmd-runner/<run>/<round>/`; `summary.json` records elapsed seconds, prompt
bytes, reported token usage and checklist progress. These local artifacts can contain
source context; keep them private. Token usage is not a monetary-cost estimate.

Worker logs stream to disk; Codex's original protocol stream is also retained as
`codex-server.jsonl`. The adapter retains only the latest 1 MiB of each
output stream in memory, while individual JSON events can be up to 16 MiB.
Larger events fail the round; the adapter error is included in its receipt.

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
| Time/context limit | in-progress → pending | Continue from the checkpoint with retained evidence |
| Unfinished at the per-task run limit | in-progress → blocked | Continue independent work |
| Missing prerequisite/input | in-progress → blocked | Continue independent work |
| Worker failure, timeout or no new verified progress | in-progress → pending | Retry within the task-run budget; block at the limit and continue independent work |
| Invalid result | in-progress → blocked or accepted result | One bounded correction turn; continue independent work if still blocked |
| Operator interruption or lost lock | in-progress → blocked | Stop explicitly |

Completion requires unchanged task scope, checked criteria and nonempty evidence.
The worker checks acceptance; the runner validates the result contract. It does not
independently prove semantic correctness or execute unreviewed `verify` commands.
Human review remains appropriate before publication. Commits, pushes and deployment
are manual. PR-review never marks work completed before merge.

Exit 0 means a drained selection or the round limit; inspect the summary reason.
Exit 2 means unfinished work has no eligible successor. Blocked tasks and unmet
dependencies are skipped while independent ready work exists. Task-level errors
produce a `task_blocked` event with `next_action: select_next_task`, a receipt and
a summary entry. Stale or unavailable selections produce a `task_skipped` event;
selection stays bounded. A failed task's Git checkpoint is published before the
next worker starts. Rejected task-scope changes are archived as `rejected-task.md`
and the original task contract is restored before continuation.
Exit 1 means a controller error, such as unrecoverable reconciliation or unsafe Git
state; 130 means operator interruption. Configured round caps still apply. Existing
in-progress/blocked tasks require explicit operator reconciliation.

Runs with disjoint `--task-prefix` subtrees can share a physical task directory.
Equal, ancestor and descendant prefixes conflict, including any overlap in a
multi-prefix selection. Filters alone grant no concurrent ownership. Runs without
prefixes and all `--git-sync` runs remain exclusive. Task scopes coordinate task
claims; coordinate shared source files, other tools and worktrees through their
existing owners. A taskmd failure is an error, never an empty queue.

## Roadmap Monitor reporting

Report runs to the private [Roadmap Monitor](https://bpstr-roadmap-monitor.netlify.app)
dashboard. Under Connections, create a connection for this machine, select
Taskmd Runner and enter its write key at the masked prompt:

```sh
taskmd-runner monitor configure --url https://spauznhnjhsycddvxzuk.supabase.co/functions/v1/monitor-ingest
taskmd-runner monitor test --json
taskmd-runner monitor status --json
```

For another deployment, use the ingestion URL shown in Connections. Automation
can pipe the key to `monitor configure --url URL --api-key-stdin`. Keys are never
command arguments. Setup and probes create no dashboard run or model call.

Configured invocations report automatically, including custom workers. The
dashboard shows `Taskmd · PROJECT`, task IDs/titles, rounds, validated summaries,
blockers and terminal outcomes. An empty finished queue is completed; a round cap
requires attention even when the CLI exits successfully. Blocked tasks remain
visible while independent work continues. Interruptions are cancelled; unexpected
runner failures are failed. Existing runs need restarting to adopt reporting.

`monitor disable` / `monitor enable` preserve the connection and its identity.
`TASKMD_MONITOR=off` disables reporting for one invocation. Environment overrides
`TASKMD_MONITOR_URL` and `TASKMD_MONITOR_API_KEY` respect a saved disabled setting.
Monitor keys are removed from taskmd, Git and coding-worker environments.

Private configuration and replay state live under
`~/Library/Application Support/taskmd-runner/monitor` on macOS and
`${XDG_STATE_HOME:-~/.local/state}/taskmd-runner/monitor` on Linux. The optional
`TASKMD_MONITOR_STATE_DIR` changes the parent directory; `--state-dir` continues
to control local task evidence. Credential files use mode 0600 in 0700 directories.
Task bodies, prompts, evidence paths and raw worker output are not uploaded.
Task titles and validated summaries are bounded and redact common secrets and
private paths; keep sensitive content out of these fields.

Monitoring failures never block task execution. Live reporting uses a roughly
60-second heartbeat, one request in flight and bounded backoff. Failed terminal
reports and sparse events remain on disk; `monitor flush` retries up to 32 stored
streams for the selected connection as historical reports. A configured invocation
can retry one stored stream using an already verified connection. Saved settings
and retained reports survive package updates.

## Git synchronization

Opt in for a repository with a configured tracking branch:

```sh
taskmd-runner --project /path/to/repo --rounds 3 --git-sync
```

Each round fetches and integrates upstream before selecting or claiming a task.
After a valid worker handoff, the controller commits changed files and the final
task state, then pushes to the configured upstream branch. Verified partial or
blocked handoffs also checkpoint their progress. Existing local commits on the
selected branch are included in the push. Failed or invalid workers leave their
changes for inspection.

For a workspace with separate repositories, list every checkout the selected
work may change, including the task directory's owning repository:

```sh
taskmd-runner --project /path/to/workspace --rounds 3 --git-sync \
  --git-repo assign-core --git-repo tasks --git-conflicts worker
```

Use clean, dedicated checkouts on attached branches with configured upstreams
and author identity. The controller checks all selected repositories before
syncing. It preserves an unfinished Git operation and stops for reconciliation.
Keep `.taskmd-runner/` ignored or store evidence outside the repositories.
If synchronization changes the runner configuration, restart so the controller
can acquire the correct task-directory lease and workflow settings.

Conflicts stop the runner by default. `--git-conflicts worker` starts one
dedicated session using the selected client, model, permissions and timeout.
That worker edits only the supplied conflicted files. The controller checks the
resolution and stages, commits and pushes it. Conflict sessions have separate
receipts under `git-conflicts/`; they do not consume task `--rounds`. There is at
most one resolver per repository at each pre-task or publication boundary.
Custom workers receive `TASKMD_WORKER_ROLE=git-conflict` and the repository in
`TASKMD_GIT_REPOSITORY`; their stdin contains the scoped resolution instructions.

Synchronization errors exit with `git_sync_error` and stop further task workers.
A failed push preserves local commits and completed task status. If upstream
advanced during a worker, the controller fetches, integrates it and retries the
push once. A multi-repository failure can leave some repositories already pushed;
`git-sync.json` and the summary identify each completed step. Merges and local
changes remain available for recovery. The controller never force-pushes,
stashes, resets, or switches branches.

## Worker commands and locking

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

Ownership uses a shared Node lease at `tasks/.taskmd-runner.lease`, refreshed
every 10 seconds. Its private `owners.json` registry records canonical task
prefixes and owner heartbeats; a short `tasks/.taskmd-runner.registry.lease`
serializes claims, heartbeat updates and release. Each crashed owner expires
after 30 seconds; exiting one scoped run preserves its active peers. Lost or
expired ownership aborts that runner. Unscoped and Git synchronization runs exclude
all other scopes.

A live older whole-store Node lease blocks new scoped runs. Stop the old runner
at a completed-round checkpoint before upgrading; the new shared sentinel also
blocks old binaries while any scope is active. An abandoned populated registry
requires a current runner for stale recovery; an old binary fails safely instead
of deleting it. Stop older 0.1.x or Python runners before upgrading: their advisory file lock does not coordinate
with this lease. The Python forwarding launcher has been removed; use
`taskmd-runner` or `node bin/taskmd-runner.js`.

Built against the [taskmd 0.8 quick start](https://driangle.github.io/taskmd/getting-started/),
the original [do-task](https://github.com/driangle/taskmd/blob/main/claude-code-plugin/skills/do-task/SKILL.md),
[complete-task](https://github.com/driangle/taskmd/blob/main/claude-code-plugin/skills/complete-task/SKILL.md)
and [verify-task](https://github.com/driangle/taskmd/blob/main/claude-code-plugin/skills/verify-task/SKILL.md)
skills, and [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/).

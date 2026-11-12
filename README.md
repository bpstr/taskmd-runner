# taskmd-runner

A sequential taskmd loop: select ready work, claim it, run one coding worker,
validate the result, update the task Markdown and repeat. It exits when the selected
queue has no ready work. It never polls an empty queue.

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
directly to taskmd. The runner asks `taskmd next` for eligible in-progress work
first, then for pending work. Taskmd's strict priority ordering preserves phase
and dependency rules within each status. Task prefixes and worktree exclusions
apply to both queries.

Unfinished tasks block after five charged runs by default. Adjust the limit with
`--max-task-runs` and `--block-after-runs`. The lower value applies. Completion or a valid PR-review
handoff on the final allowed run is accepted. At the limit, the runner records
the blocker and requests owner review or splitting into subtasks that collectively
preserve the original scope and acceptance criteria. This request appears in the
task handoff and run summary, and in the receipt when a worker reaches the limit.
The runner selects independent ready work; dependent tasks remain gated.
After a timeout, worker failure or pending handoff without verified progress,
the task stays pending and yields to other ready tasks. Once those tasks have
had a turn, the runner retries deferred work in taskmd order within the retained
task and invocation limits. A partial handoff with new verified progress stays
in progress so a later round or invocation can pick it up before pending work.
Its receipt records the worker outcome as `status: pending` and the persisted
task status as `task_status: in-progress`.
`--rounds` caps charged runs for the whole invocation.

The runner keeps a `<!-- taskmd-runner runs: N -->` counter under `## Progress`,
so counts survive restarts, changed evidence directories, Git synchronization
and worklog compaction. Tasks without a counter start at zero; earlier runs are
not reconstructed. Preserve the counter when editing handoffs. A blocked task
requires owner review before explicitly returning it to pending; raise both
thresholds above its retained count to grant more runs. An already exhausted
ready task is blocked before another worker starts.

Use `--review-blockers` (MCP `runner_start.review_blockers`) to review a
worker-reported blocker once before publishing it. The runner starts a fresh
worker with the earlier handoff, the same task, and the time remaining in the
original round. The reviewer can continue authorized work or confirm the
blocker. Both dispatches retain separate evidence under the same round and
share one charged task run. A custom worker sees `TASKMD_BLOCKER_REVIEW=1`
during the review dispatch and uses the same result schema.

Review is off by default. It applies to worker-reported blocks with time and
run budget remaining. Tasks already blocked, invalid-response clarifications
and worker failures follow their existing paths. Genuine approval and contract
decisions stay with their owners. Review cannot change task scope, dependency
gates, Git ownership or the completion checks.

Use repeatable `--task-prefix` options to select task-directory subtrees, for example
`--task-prefix api --task-prefix astro`. Prefixes are alternatives; normal taskmd
filters still apply. Selection retains native ordering and the full dependency graph;
tasks in other directories are never claimed. A scoped search expands up to 4,096
ranked candidates and fails for review if that bound is exhausted. Recheck the
owning checkout at claim time; symlinks cannot widen an allowed subtree.
The default Codex sandbox is `workspace-write`; select `danger-full-access` only
in an environment where the task already authorizes that access. Model and effort
default to `gpt-6.1-sol` and `medium` for Codex; explicit flags override them.
Other clients inherit their configuration. `--timeout` sets the hard deadline for
each task run in seconds (default 5400, or 90 minutes). Workers aim to finish and
verify within 60 minutes when the timeout allows and can continue until the
deadline. `--client` defaults to `codex`; `--model` and
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
prefixes and all `--git-sync` / `--git-integration-branch` runs remain exclusive. Task scopes coordinate task
claims; coordinate shared source files, other tools and worktrees through their
existing owners. A taskmd failure is an error, never an empty queue.

## Local MCP control

Connect Codex Desktop or another MCP host to the runner's stdio server:

```sh
codex mcp add taskmd_runner -- taskmd-runner mcp
```

From a source checkout, use absolute paths so the connection works from any
workspace:

```sh
codex mcp add taskmd_runner -- node /absolute/path/taskmd-runner/bin/taskmd-runner.js mcp
```

The shared Codex configuration also supports other MCP hosts' equivalent setup:

```toml
[mcp_servers.taskmd_runner]
command = "taskmd-runner"
args = ["mcp"]
```

| Tool | Purpose |
| --- | --- |
| `runner_list` | Discover active local runs across workspaces; filter by project, paginate, or set `include_exited` for history |
| `runner_start` | Start a detached runner with an absolute project path, lane and typed CLI options |
| `runner_status` | Read compact status by exact `run_id`; pass `since_revision` for a small unchanged response |
| `runner_control` | Send `pause`, `resume` or `stop` to an exact `run_id` |

Start options use snake_case, for example `task_prefixes: ["api"]`,
`max_task_runs: 5`, `git_sync: true`, or `worker: ["/path/to/custom-worker"]`.
The defaults and worker budgets are the same as the CLI. Starting a run launches
real coding workers; it requires the same user authorization as a CLI launch.
Closing the MCP client or Desktop chat leaves detached runs running.

Each invocation has its own run ID. A lane name belongs to one canonical
workspace, so `api` can run in multiple workspaces at once. Only one invocation
can own a workspace/lane pair. Within a workspace, use distinct lane names and
disjoint `task_prefixes` to run concurrently; existing task-directory locks reject
overlapping scopes. Git synchronization and local integration retain an exclusive
task-store lock within each checkout.
CLI launches are discoverable too: `--lane api --task-prefix api`. Without
`--lane`, task-prefix launches derive a stable scope lane; other launches use
`main`. MCP starts default to `main`, so name concurrent lanes explicitly.

Pause returns `pausing` immediately, finishes the current task round and its
normal receipt, validation and Git handoff, then becomes `paused` before another
task claim. It retains its locks and monitor heartbeat until resumed or stopped.
A drained queue or round cap can finish before reaching another pause boundary.
Stop uses the existing cancellation/reconciliation behavior: an interrupted
worker's task becomes blocked and the runner exits with `interrupted` / 130.
Resume applies only to a live paused run; start a new invocation after exit.
An unreachable endpoint stays visible while its controller PID exists. Once the
PID is gone, the runner moves the record to history and queues a terminal Monitor
report for the saved stream when available. A replacement acquires the lane
through the normal lease, including its stale-lock expiry.

A worker log failure stops the worker and ends the run with `storage_error`.
The task keeps its checkpoint and charged run so a replacement can resume it.
If storage prevents terminal writes, the next launch reconciles the saved record
and Monitor stream after space is available.

Codex task and conflict workers automatically receive a self-scoped MCP exposing
only `runner_status` and `runner_control`. They can omit `run_id` and cannot
select another run through that connection. A worker requesting pause should
finish its normal result without waiting for `paused`. Other clients can connect
`taskmd-runner mcp --self` with the inherited `TASKMD_RUNNER_SELF_ID`,
`TASKMD_RUNNER_SELF_ENDPOINT` and `TASKMD_RUNNER_SELF_TOKEN` environment variables.
Connections receiving these environment variables also scope themselves to the current run.
This limits tool targeting; it is not an OS sandbox against a worker that already
has access to the user's files and processes.

Controllers bind authenticated, random loopback ports. Private controller records
and launch logs live under the user-level runner state directory's `control/`
subdirectory (override with `TASKMD_RUNNER_CONTROL_DIR`, consistently in runners
and MCP clients). Status never includes controller tokens, worker logs or
prompts. Terminal records remain available after exit. Existing run directories,
receipts, notifications and Roadmap Monitor reporting continue unchanged, with
pause/resume events added. Status is assembled locally without a model call;
actual conversation token savings have not been measured.

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

For lanes in separate local checkouts, merge a shared local integration branch
before each new task:

```sh
taskmd-runner --project /path/to/lane --lane api --task-prefix api \
  --git-integration-branch main
```

The runner merges `refs/heads/main` into the lane's current branch before selecting
work, then validates tasks and dependencies. Accepted handoffs become local commits
so the next merge starts from a clean checkout. Linked worktrees share this local
branch ref. Independent clones must each have the integration branch kept current.
The integration process advances that shared branch; the runner merges it into
the lane and retains the lane's branch identity. This mode needs no remote or
upstream and makes no network calls. Receipts label local handoffs `committed`.

Use `git_integration_branch: "main"` with MCP `runner_start`. Add `git_sync: true`
(CLI `--git-sync`) to also fetch/merge the lane's configured upstream and push
accepted handoffs there. The local integration branch and the lane's upstream
are separate sources. A pause during selection refreshes Git and reselects work
after resume. In-task continuations keep their current working changes; merges
happen at task boundaries. The named local branch must be present in each
selected `--git-repo` checkout for integration to run.

Git-managed lanes require separate checkouts. Their whole-task-store lease
prevents a merge from changing files underneath a worker in the same checkout.

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

By default, `--git-conflicts skip` aborts a merge conflict created by the current
runner, verifies that the checkout is clean, and continues with local commits.
`--git-conflicts stop` preserves the merge for manual resolution.
`--git-conflicts worker` starts one dedicated session using the selected client,
model, permissions and timeout.
That worker edits only the supplied conflicted files. The controller checks the
resolution and stages, commits and pushes it. Conflict sessions have separate
receipts under `git-conflicts/`; they do not consume task `--rounds`. There is at
most one resolver per repository at each pre-task or publication boundary.
Custom workers receive `TASKMD_WORKER_ROLE=git-conflict` and the repository in
`TASKMD_GIT_REPOSITORY`; their stdin contains the scoped resolution instructions.

An unavailable upstream, missing integration branch, or rejected push pauses
fetches, merges and pushes for the rest of the run. The runner emits one
`git_sync_warning` on stderr, sends an attention notification when enabled, and
keeps committing accepted handoffs locally. Receipts label those handoffs
`committed`. See `git-sync.json` or the summary for the failure and any pushes
that already succeeded. After fixing the issue, a later synchronized handoff can
publish the retained commits, or you can reconcile and push them manually.

If upstream advances during a worker, the controller still tries to integrate
it and retry the push once. An unfinished operation, failed conflict resolution,
or an unsafe checkout exits with `git_sync_error` and preserves the checkout for
reconciliation.

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

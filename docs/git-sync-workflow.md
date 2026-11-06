# Git synchronization across scoped runner machines

Investigation: 2026-11-05. Scope: separate task subtrees assigned to different
machines, with a shared Git history for task progress and source changes.
This is a proposed design, not an implemented feature or release qualification.

## Recommendation

Extend the existing `--git-sync` controller. Run each machine in its own dedicated
clone, on an attached branch tracking the same writable upstream branch, with a
different `--task-prefix`. Keep task files and their implementation in the same
repository for the first supported workflow. Publish task starts and accepted
handoffs, and poll while waiting for cross-scope dependencies.

Kubernetes git-sync is useful for distributing a read-only view of that branch.
It does not supply the runner's write-back or ownership protocol. Do not run
workers inside directories it manages.

The essential distinction is between task selection, publication of progress,
and integration of concurrent source changes. Existing task scopes solve the
first under an explicit allocation agreement. Git can transport the second.
The third still requires conflict handling and affected verification.

## Existing implementation

| Area | Current behavior | Consequence for multiple machines |
| --- | --- | --- |
| Selection | `Runner.nextTasks()` uses taskmd's dependency ordering and filters candidates through `--task-prefix`. | Different prefixes can divide work without a new scheduler. |
| Local exclusion | `acquireTaskLock()` coordinates physical task-directory owners. Git sync takes the whole-directory lease even when scoped. | Keep this protection within each clone; it cannot coordinate independent machines. |
| Before work | `GitSync.before()` checks clean state, fetches and integrates upstream; the runner validates taskmd and dependencies. | A machine sees remote progress at task boundaries. |
| Claim | The runner sets `in-progress` and writes its start note locally, then launches the worker. | Other machines cannot see the start until a later accepted handoff. |
| Handoff | `GitSync.after()` commits changed files and task state and pushes. Completed, partial and blocked handoffs can publish. | Progress already has a durable Git transport. |
| Push race | Fetch, merge, verify the accepted task handoff and retry once. | Disjoint edits can converge; sustained publication contention can still stop a runner. |
| Conflict | Preserve the merge and stop by default. An explicitly selected conflict worker is available. | Source overlap needs reconciliation even when task prefixes differ. |
| Waiting | No ready tasks ends the run. | A machine stops rather than waiting for a dependency owned by another machine. |
| Evidence | Receipts and `git-sync.json` are local run artifacts; progress notes can reference absolute local paths. | A synced task does not imply that its detailed local evidence is accessible elsewhere. |

Relevant implementation: `src/runner.ts` (`nextTasks`, `run`), `src/git.ts`
(`before`, `after`, `merge`), `src/lock.ts` (`acquireTaskLock`) and
`src/task.ts` (`contract`, `progress`). Existing tests cover Git boundaries,
publication races and the deliberately exclusive local Git-sync lease.

## Assessment of Kubernetes git-sync

The upstream README describes a fetch-and-publish consumer: it polls a remote,
builds worktrees and swaps a symlink to expose a complete snapshot. Its interface
does not provide a commit/push workflow. The inspected implementation creates
detached worktrees, resets them to the selected revision and removes old ones.
Those lifecycle rules conflict with long-running, writable workers. Our
`GitSync.initialize()` also requires an attached tracking branch.

Use its snapshot publication pattern as a reference for a future read-only
dashboard or task browser. If that use appears, give git-sync a separate data
directory; runners retain their own clones. The current command-line runner
does not need a sidecar, Kubernetes or an additional Go dependency.

Sources inspected on the date above:

- [Upstream contract](https://github.com/kubernetes/git-sync/blob/master/README.md#what-it-produces-and-why---the-contract).
- [Worktree creation and cleanup](https://github.com/kubernetes/git-sync/blob/master/main.go)
  (`createWorktree`, `configureWorktree`, `removeStaleWorktrees`).
- [Git push rules](https://git-scm.com/docs/git-push): ordinary pushes reject
  non-fast-forward replacement; atomic push covers refs in one remote
  transaction, not publication across separate repositories.

The upstream development branch was inspected, not installed. README blob:
`62fe13987e9b1ae60eb5753ba76972aeee4d859f`; main.go blob:
`7b55be5cb5c3c1352328677ddeb6a16697212b00`.

## Proposed workflow

The existing options express the machine allocation. These examples use current
flags; the start-publication and waiting behavior described below needs work.

```sh
# Machine A, independent clone
taskmd-runner --project /work/project --task-prefix api --git-sync

# Machine B, another clone of the same branch
taskmd-runner --project /work/project --task-prefix web --git-sync
```

Both clones need clean initial state, author identity and permission to push to
the shared integration branch. If repository policy requires pull requests,
use a permitted integration branch and retain the project's review workflow;
do not assume the protected default branch can accept these pushes. Separate
per-machine branches alone will not exchange progress without an integrator.

### 1. Synchronize and select

Retain the whole-checkout local lease and existing preflight. Fetch and integrate
only at a safe boundary, then validate configuration, the task graph, allowed
prefix, pending status and completed dependencies. Do not update the writable
checkout from an independent background process while a worker is running.

The allocation contract is one active machine per disjoint subtree, including
parent/child overlap. Prefixes partition task files, not source files. Start
with explicit operator allocation and fail on locally detectable violations.
Document that independent clones do not enforce remote ownership. Do not call
the existing filesystem heartbeat a distributed lease.

If remote enforcement is required later, it needs a separate serialized scope
registry with unique run tokens, overlap validation and publication-time
ownership checks. Heartbeat expiry alone must not authorize takeover: an old
machine may still be running. That protocol is additional scope, not a
prerequisite for the agreed manual allocation workflow.

### 2. Publish the start before launching a worker

After selection, record `in-progress` and a portable start note, commit that
checkpoint and push successfully before invoking the worker. Include runner ID,
run ID, relative scope and start time in the recorded claim; avoid requiring
machine-specific absolute paths for remote interpretation. Choose the metadata
location against taskmd's supported schema before adding frontmatter fields.

Refactor publication into a common controller operation usable for starts and
handoffs. A start checkpoint must not be labeled as accepted completion.
Revalidate the selected task, dependencies and claim after integrating a racing
publication. If a claim is superseded or no longer valid, stop before worker
launch. Textually merging two starts does not establish exclusive ownership.
Do not advance a task round for a publication retry that launched no worker.

If the push fails, retain the local checkpoint and expose its publication state;
do not launch work. If transport acknowledgement is ambiguous, inspect the
remote history and recorded run token before deciding to retry or recover.

### 3. Execute and publish an accepted handoff

Keep the existing worker contract and handoff validation. Commit source changes,
task criteria, worklog and final status together, then push. Use a bounded retry
loop with backoff and jitter when upstream advances. Abort on authentication,
policy or transport failures rather than treating every error as contention.
Never force-push to resolve concurrency.

After a merge, preserve the existing accepted-task checks and taskmd validation.
If integration changes inputs covered by the worker's verification, rerun the
affected deterministic checks before publication. A clean textual merge alone
does not prove the combined implementation works. Keep semantic conflicts and
failed verification visible; default to stopping for reconciliation.

Other machines discover completed dependencies on their next safe fetch. Tasks
that touch shared source, lockfiles or generated artifacts can conflict despite
disjoint task scopes; allocation should account for those dependencies.

### 4. Wait for work blocked by another scope

Add an opt-in waiting mode, with a configurable poll interval and interruptible
backoff. When the assigned scope has unfinished work but no ready task, wait,
fetch and re-evaluate the graph. Idle polls do not consume `--rounds` or start a
worker. Exit normally once the assigned scope is complete. Preserve today's
one-shot behavior unless waiting is requested.

Waiting should distinguish unmet dependencies, blocked tasks and active claims
so an operator can tell whether progress needs intervention. Network outages
must not be reported as an empty task queue. A polling machine must not use its
private, unpushed completion to start dependent work.

### 5. Recover without hiding publication failures

Keep local acceptance separate from remote publication in summaries and receipts:
for example, task status, accepted local commit and last confirmed published
commit. A failed handoff push leaves accepted work local and stops subsequent
workers. Recovery reconciles and publishes it before selecting more work.

A crash after a published start leaves a visible `in-progress` task. Initially,
require explicit recovery after checking the previous machine and preserving
its work. Do not automatically turn old starts back into pending tasks.

Keep task progress readable remotely: record concise outcomes, verification
commands/results and portable repository links. Local receipts remain useful,
but their absolute paths are not shared evidence. Do not commit all run folders
merely to make those paths reachable.

## Progress granularity and repository boundaries

The first supported contract should synchronize starts and validated handoffs,
including partial checkpoints. It does not promise live streaming of a running
worker's checklist edits. Mid-worker synchronization needs an explicit stable
checkpoint or a separate informational status channel; committing arbitrary
dirty work or replacing its checkout is unsafe.

Keep code and tasks in one repository initially so a completion and its source
land in one commit. The controller's existing multi-repository mode remains
useful but is not transactional. For a later coordinated workflow, publish
source repositories first and the dependency-unblocking task completion last,
with source commit IDs recorded and resumable partial-publication state. Never
present a partially published set as globally complete. Git `--atomic` does not
make multiple repository pushes atomic.

## Verification and implementation boundaries

Before changing behavior, add focused fixtures for the distinct new contracts:

1. Two independent scoped runners: published starts are visible before worker
   launch, and handoffs survive racing pushes without losing either scope.
2. A cross-scope dependency wakes a waiting runner only after remote completion;
   idle polls and contention retries do not consume worker rounds.
3. Rejected or ambiguous start publication launches no worker. Interrupted
   waiting and failed handoff publication preserve recoverable state.
4. Overlapping ownership is explicitly unsupported under manual allocation;
   local exclusion remains intact. Shared-source conflicts preserve both sides
   and stop publication; affected verification failures also stop publication.
5. New claim metadata remains compatible with taskmd and the runner's immutable
   task contract. Portable progress does not depend on another machine's paths.

Use local bare remotes and prepared transports/workers only, under the existing
paid-inference testing policy. Read the Assign policy before changing or running
AI-related tests. No full application suite is needed for this investigation.

Git-only probe results from the current working tree:

- Confirmed that a local `in-progress` edit remains pending on the remote before
  handoff publication.
- Two independent `GitSync` instances published different task files; the second
  recovered from a rejected push by merging, retaining both completed states.
- Concurrent conflicting source edits stopped the second publication, retained
  its local commit and unfinished merge, and preserved the first remote result.

All three scenarios passed. This exercised `GitSync` directly, with temporary
transpilation of `src/git.ts` and `src/process.ts`. It did not run the full runner,
taskmd, workers or any model, and is not end-to-end qualification. Temporary
repositories were removed. Probe, source hashes, event logs and results are
retained locally under `.taskmd-runner/git-sync-investigation-2026-11-05/`.

Existing uncommitted scoped-lock/runner/README/test changes were inspected and
left intact. The only tracked addition from this investigation is this design.

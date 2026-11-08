# Runner validation

## Roadmap Monitor reporting

Scope: optional user-level monitor configuration and protocol-v1 publishing from
native taskmd lifecycle events. Completion requires prepared drain/cap/blocker
flows to produce monitor-compatible terminal reports, network failure to leave
work successful with a durable replay, credential isolation, safe configuration
replacement and bounded single-publisher delivery. Reuse existing task selection,
contract, counter, continuation, lock and adapter evidence where unchanged.

Selected checks: build; `tests/monitor.test.mjs`; the runner selectors beginning
`monitor reports` and `offline monitor`; existing drain, cap, blocker, interruption,
custom worker/adapter, Git and CLI controls affected by child environment changes.
Expected cost under 30 seconds. Capture reports under
`.taskmd-runner/monitor-integration/` and validate them with roadmap-monitor's
actual v1 parser. No paid inference, live workers or full application suite.
Monitor frontend has a runner command selector only; use build and existing
presentation/protocol checks, then its required production release workflow.

Results: 25 distinct prepared checks passed (7 monitor unit/CLI, 5 reporting
lifecycle, 11 existing runner/version and 2 Git workflow checks), with zero
failures or skips. Reused passing configuration/privacy evidence after changing
only finalization; the final lifecycle rerun covers retained terminal summaries,
verified-progress timestamps and worker credential isolation. All 30 captured
reports passed the monitor's actual v1 parser. No live worker or model call.

Version 0.4.0 was packed and installed globally offline. All 51 installed files
match the archive, including the copied transport's MIT notice. Archive SHA-256:
`5f1cf83157e4ad30fc291bc47c70a6bf744832ac13d21477f5c70677c8827ae2`.
Installed version/help passed. Reused this machine's existing verified Roadmap
Monitor connection without rotating credentials or changing its identity; saved
taskmd configuration and the installed CLI's real connection-only probe passed.
Probes created no dashboard stream. This is a local installation; npm publication
was not performed.

Monitor 0.1.5 deployed through production workflow
`42523754529` at commit `6ecb8fdcb1180617b38f0686000a917887570dda`.
Its full release gates passed. No new backend/schema contract was needed.
Installed-phone notification delivery and real model execution are not qualified
by these prepared checks.

Resource check: prepared workers and temporary HTTP listeners exited. No browser
or persistent preview was started. Existing MCP browser controllers and the
Assign Vite service were retained. Session evidence is under 1 MiB, the installed
package is 2 MiB and data-volume free space is 20 GiB. No unrelated caches,
credentials, source or retained qualification artifacts were removed.


## 0.3.3 GitHub release

Release scope: issue #2 continuation/context recovery and task-file prompt
references. Reuse the 41 distinct issue #2 prepared checks and 12 task-reference
checks below, with their documented retained results and assertion corrections.
Only version metadata changes for release: build, select the package-version
check, pack and compare every archived file with the checkout, then install the
archive offline and check version/help plus two prepared installed CLI scenarios
for early/context handoffs and task references. No full suite, provider call,
registry publication or active-queue restart. Completion requires the release
commit, v0.3.3 tag and GitHub release with the verified package archive attached.
Artifacts: `.taskmd-runner/release-0.3.3/`.

Results: build, version selector, installed version/help and whitespace checks
passed. Both offline-installed prepared scenarios passed: two early checkpoints
completed inside one charged run; two early context handoffs plus a genuine
near-deadline stop used two charged runs, preserving the original deadline and
private Codex profile. Every dispatch referenced the task file without embedding
its contents. All 32 archived files match both the checkout and offline install.
Archive size: 56,160 bytes; SHA-256:
`ab33980dd6b51577909b3514fcdfde0bfa76907ecc49d7f73df2307b02e86afc`.
No prepared workers, browsers or temporary servers remain. Release evidence uses
about 2.3 MiB; data-volume free space remains 25 GiB. No paths were removed or
unrelated resources cleaned. The archive and manifest retain the release proof.

## Task-file prompt references

Plan: reference the selected task path and TASKMD_TASK_FILE instead of embedding
its body. Put the stable worker instructions and result schema before variable
dispatch metadata. Workers read scope/acceptance and latest Progress from disk
with bounded reads. File reads still consume context; no cache savings are claimed
without provider usage evidence. Official reference:
[exact-prefix cache reuse](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics#how-it-works).

Verification: build; a prepared task with large scope/history and a filesystem
path containing spaces must complete through file reads, preserve its contract,
and keep task text out of every dispatch prompt. Check stable prompt prefixes,
same-session/context continuation, clarification, worklogs and the custom/Codex
Git resolver fixture because it forwards task prompts. Reuse the issue #2 budget,
cancellation, counter and unrelated runtime evidence below. No full suite or paid
provider calls. Logs: `.taskmd-runner/issue-2/task-reference-*.log`.

Results: build, syntax and whitespace checks passed. Eleven selected prepared
checks passed immediately. The new file-reference check initially compared a
macOS `/var` fixture path with the runner's canonical `/private/var` path; after
canonicalizing that assertion, its focused rerun passed. All 12 affected checks
now pass, with the original failure retained. The reference check verifies three
dispatches, a path containing spaces, preserved large task scope, excluded task
text/history, and an identical prefix through the task path. No live cache or
provider-quality claim. No browsers, servers or workers remained from these
checks. Session artifacts remained under 1 MiB; free data-volume space was 25 GiB
and no paths were removed.

## Issue #2: premature context handoffs

Plan: allow at most two early pending continuations inside one charged task run,
sharing its original absolute deadline. Preserve each dispatch and its reason,
remaining budget and context telemetry. Near-deadline stops include a small safety
margin before the warning; an unset warning flag alone does not imply an early
exit. Recover context-labelled stops in a fresh Codex thread, retaining durable
Progress rather than assuming same-thread resume relieves context pressure.

Affected verification: build; prepared early-pending, context-pressure,
near-deadline (including two early stops then a safe stop), cancellation,
continuation failure/clarification, same-task session, durable run-limit and
worklog selectors. Reuse unaffected task selection, adapter-control, Git-sync,
notification and locking evidence above/below. No full suite or live provider
call is required. Completion requires bounded dispatches, unchanged total time
and run budgets, retained individual receipts and focused passing checks.
Logs: `.taskmd-runner/issue-2/`.

Issue #2 verification checkpoint: the initial affected selection passed 22/22;
additional recovery, clarification, cancellation, deadline-steer, isolated/shared
session, contract reset, large-event, documentation guard and PR-review checks
passed 17/17 (one overlapping early-checkpoint case). An initial TypeScript build
caught an optional-context narrowing error; corrected before tests. Keep logs.
Final review tightened dispatch timeout calculation to the original absolute
deadline and rechecks the reserve after checkpoint I/O. This invalidates only
deadline/timeout dispatch evidence; rerun early/mixed handoffs, timeout and steer
checks plus the shared Git conflict-worker dispatch case. Retain the other
compatible passing results; no broad rerun. Expected cost: under 15 seconds.

Results: build and whitespace checks passed. Across the affected selections,
41 distinct prepared checks passed with zero failures or skips. The seven
absolute-deadline and shared custom/Codex Git resolver checks passed; the final
six-check selection passed after replacing token-threshold inference with explicit
provider-overflow recovery. Retain compatible earlier results rather than rerun
unchanged checks. Both early context reports followed by a near-deadline stop and
an explicit provider-overflow error preserve the intended time/run accounting.
Telemetry alone never imposes a context-token budget or proves provider failure.

The [official app-server API overview](https://learn.chatgpt.com/docs/app-server#api-overview)
documents resume as appending to existing history and compaction as a separate
operation. Workers retain native compaction; context handoffs use fresh history.
No provider calls, browser sessions or temporary servers were started. No prepared
worker processes remained after teardown. Data-volume free space was 25 GiB;
session outputs were under 1 MiB, with no cleanup candidates or paths removed.

## 0.3.2 session isolation and release

Issue #1: persistent workers saved conversations into the inherited desktop
profile. Use a private Codex home per runner invocation, link only profile inputs,
and override SQLite/log locations. Retain persistence and same-task resumption;
shared desktop history requires `--codex-session-policy shared`. No existing
conversation is moved or removed. File credentials are linked, not recorded in
logs. Keyring-only profiles need the documented file-backed automation setup.

Official references: [Codex state locations](https://learn.chatgpt.com/docs/config-file/environment-variables#core-locations)
and [app-server start/resume](https://learn.chatgpt.com/docs/app-server).
The installed Codex 0.160.0 protocol schema was generated locally without a turn.
CODEX_HOME isolates sessions as well as SQLite; changing only runner receipts or
SQLite location would leave session files in the shared profile.

Verification plan: build, then selected prepared cases for isolated/shared
profiles, persistent resume and changed contracts, Codex clarification, deadline
steering, timeout/crash recovery, native interruption, adapter controls and CLI
version/validation. Run the Codex Git resolver case because it shares the wrapper.
The fake server now saves sessions in its effective home and rejects a resume
from the wrong home. Isolation checks preserve an existing user chat and index,
reuse synthetic credential/config links, exercise --state-dir, and assert SQLite
overrides beat inherited configuration/environment paths. No live provider call.
Reuse the 0.3.1 unaffected runtime, lock, task and Git evidence below; no full suite
is warranted. Completion requires the affected checks, packed version/help and
installed prepared checks, whitespace validation, release commit/tag and GitHub
release artifact. npm publication is outside this GitHub release. Logs and package
evidence go under `.taskmd-runner/release-0.3.2/`.

Results: build and syntax/whitespace checks passed. Fourteen selected runner
checks and the Codex Git resolver check passed (15 distinct affected checks).
The first isolation assertion failed only because macOS resolves `/var` to
`/private/var`; compare canonical paths on both sides. Its failure log is retained.
After that test-only correction and stricter empty-policy validation, the affected
isolation/shared/CLI subset passed (3 checks); other passing evidence was reused.
Two installed-command prepared scenarios passed: graceful steer/resume and hard
timeout/retry, both with private persisted sessions and no shared history writes.
Package/lockfile/installed versions are 0.3.2, and installed runtime hashes match.
No provider calls, browser sessions, temporary servers or active queue restarts.
An existing Assign runner and its worker remain active on their loaded runtime;
restart queues separately to adopt isolation. Existing chats remain untouched.

Final archive: 32 files, 53,200 bytes; every packaged file matches the checkout,
including the new profile helper. Installed the final archive offline with
scripts disabled; version/help passed and the new policy is listed. No prepared
worker processes remain. Removed only the session-generated
`/tmp/taskmd-codex-schema` (4,501,504 allocated file bytes), retaining the inspected
thread schemas in release evidence. The release evidence uses about 672 KiB;
data-volume free space remains about 29.8 GiB. No unrelated cleanup was performed.

## 0.3.1 patch release

Release the graceful deadline, bounded recovery and JSON-event fixes above.
Retain the 47 distinct affected runtime/Git checks, the focused resume check,
and both installed prepared cases. Release metadata changes invalidate version
and archive evidence only; the new assertion verifies app-server client metadata
tracks the package version. Build, run the version/CLI-control cases and the
prepared Codex adapter contract, then verify package/lockfile versions, packed
CLI version/help and archive content. No full suite or live inference.

Completion requires these checks, whitespace validation, a release commit,
the v0.3.1 tag and a GitHub release with the package artifact. Registry publication
is outside this GitHub release. Retain logs and archives under
`.taskmd-runner/release-0.3.1/`; preserve earlier failure and rollback evidence.

Results: build passed; the three selected release/client-version cases passed
with zero failures/skips (0.90 seconds). Package, lockfile, archive and CLI versions
are 0.3.1. The 29-file, 51,010-byte archive matches the current worker wrapper,
compiled runtime, instructions and release documentation. Extracted version/help
checks passed using the existing dependency tree; this is not a fresh dependency
installation check. Installed the archive globally offline with scripts disabled;
the installed command reports 0.3.1. No live worker or model request was started.
Whitespace validation passed. No session workers remain; shared services were
preserved. Removed only the unused 248 KiB extracted inspection copy at
`.taskmd-runner/release-0.3.1/extracted`; archive and qualification evidence remain.
Data-volume free space is about 30 GiB. The release manifest records archive
integrity and publication identifiers after upload.

## Graceful deadline handoff and bounded recovery

Requester correction: request a durable checkpoint before the worker deadline;
timeouts, worker crashes and pending checkpoints without a new verified slice
must remain recoverable within the existing task-run budget. An exhausted task
or explicit blocker yields to independent ready work. A deadline handoff is not
a new verified result. Keep user interruption, lost ownership, unreconciled state
and unsafe Git publication as controller stops.
This supersedes immediate task blocking in the older validation entries below.

Codex uses app-server stdio within the existing adapter-owned worker process.
It steers the active turn before the deadline; other clients/custom workers
receive a handoff-request file and instructions to check it before new operations.
Retain the hard deadline and process-group cleanup for unresponsive workers.
Preserve the configured Codex credentials, sandbox, never-approval policy, model,
effort, JSON schema, session resumption and per-turn usage. No new dependency.
Official protocol: https://learn.chatgpt.com/docs/app-server (thread start/resume,
turn start/steer/interrupt). Local Codex 0.160.0 generated types confirm the
request fields, including text_elements. Types are retained in the incident
directory; no provider request was used for protocol inspection.

Affected checks: build; prepared graceful steer, ignored steer/hard timeout,
transient crash recovery, restart/cap and no-progress cases; existing Codex
continuation, adapter, clarification, task-run limits, custom error/timeout,
scope/status rejection, native worklog, PR-review and interruption selectors.
The Codex transport and worker-failure routing changed; prior passing evidence
for those paths is invalidated. Git resolver transport and retry publication
need their affected cases, not unrelated repository-boundary checks. Reuse
retained lock, identifier, CLI, Git-boundary and scoped-ownership evidence.
No full-suite or live inference run. Completion requires selected checks,
updated worker/user documentation, installed prepared verification and
whitespace validation. Expect checks to take under one minute. Preserve original
failures and all logs under `.taskmd-runner/recovery/`.

Results: build passed; 42 selected prepared runner cases passed with zero
failures/skips (35.33 seconds). Four affected Git cases passed (11.52 seconds),
including Codex conflict resolution and publication of retryable checkpoints.
The added native Codex interruption case passed (1.45 seconds), with one attempt,
no retry and complete process/lease teardown. These are 47 distinct passing
checks. A focused resumption check passed again (0.88 seconds) after adding
`excludeTurns: true` to avoid fetching full historical turns during resumption.
Earlier unaffected evidence is retained; no full suite was run.

Packed and installed the local build offline with lifecycle scripts disabled.
Two installed-command prepared cases passed: graceful deadline steer followed by
session resumption, and ignored steer/hard timeout followed by successful retry.
Both ended with pending/completed receipts and no blocked tasks. Installed
worker wrapper, compiled runner and worker instructions match the checkout by
SHA-256. Whitespace and JavaScript syntax checks passed. No provider calls,
browser sessions, temporary servers or live queue restarts were used. No session
worker processes remain; shared services were preserved. Evidence/rollback
artifacts are 3.5 MiB, including 3.0 MiB of local generated protocol types. No
disposable session artifacts were removed; data-volume free space is about
30 GiB. Changes in unrelated active workloads were not attributed to this session.

## Timeout incident follow-up (superseded recovery policy)

The stopped Astro launch explicitly supplied `--timeout 1800`; its round 44
receipt for task 004 records `codex timed-out (124)`, and its summary ends with
`worker_error`, exit 1. The launch predated the current blocker-continuation
implementation. Workers default to 7200 seconds, while an explicit 1800
override still applies. At that checkpoint a task timeout blocked that task,
retained evidence and selected independent work without retrying the task.

Affected checks: one prepared Codex timeout integration case covering the adapter,
process cleanup, task counter, blocked dependency, fresh next session and queue
continuation; retain existing runtime/build results from the JSON-event fix.
Run the existing custom-worker timeout selector alongside it to cover both worker
launch paths. No runtime source change or rebuild, broader suite, live inference
or queue restart is needed. Completion requires both checks and whitespace
validation; expected runtime under five seconds. Logs are retained under
`.taskmd-runner/event-limit/`.

Results: both selected timeout cases passed with zero failures/skips (2.40
seconds). The Codex adapter recorded timeout code 124, reaped the prepared
worker, blocked only the timed-out task and completed independent work in the
next round. The dependent task remained pending, the failed task consumed one
run and the next worker used a fresh session. The installed and checkout runner
modules have identical SHA-256 hashes. The saved 0.2.0 runtime contains the old
immediate `finish('worker_error', 1)` path; current code continues selection.
Whitespace validation passed, and no prepared worker processes remain.

## Worker JSON event limit

Incident: the adapter's default 1 MiB per-event parser limit marks otherwise
successful workers as failed when a tool emits a large JSON event. Raw worker
logs already stream to disk independently of retained output. Set a bounded
16 MiB event allowance for runner workers, retain the adapter's 1 MiB output
tails, and include the adapter's error in task receipts and summaries. Preserve
failure handling for oversized events and actual provider failures.

Affected checks: TypeScript build; prepared Codex/Claude large-event cases,
overflow rejection, provider-error rejection, existing adapter invocation,
text-receipt fallback and continuation/clarification cases. No live inference,
browser, server or full-suite run is needed. Completion requires these selected
checks and whitespace validation. Expected runtime under one minute. Retain
incident and check evidence under `.taskmd-runner/event-limit/`.

Results: the three new regression cases failed against the prior build (large
events rejected; parser/provider errors hidden). After the fix, build and all
16 selected prepared checks passed, with zero failures or skips (6.70 seconds).
Codex and Claude accept a 2 MiB event, retain truncated output tails, preserve
usage and stream the full log. A 17 MiB event and provider failures still block
the task even with a completed receipt and zero process exit.

The installed command was a separate 0.2.0 package. Saved its rollback archive,
packed this build and installed it globally offline with lifecycle scripts
disabled. The installed 0.3.0 command completed a prepared 2 MiB-event task.
Archives, baseline failure, selected checks and installed-command evidence are
retained in the incident directory. No live worker queues were restarted and no
provider requests, browsers or temporary servers were launched. Process/listener
inspection preserved existing Assign services. Data-volume free space is about
31 GiB; this session's small artifacts are retained verification/rollback evidence,
with no inactive disposable build trees to remove.

## 0.3.0 release metadata and package

Reuse the focused runtime results below and the scoped-concurrency receipt at
`.taskmd-runner/scoped-concurrency-verification.json` (10 lock cases, 16 integration
cases and one scoped-runner case). Release preparation changes package versions
and release documentation only. Verify the TypeScript build, package-version and
CLI-control cases, matching package/lockfile versions, and packed CLI version/help.
Inspect the archive for the updated worker instructions and compiled runtime.
Completion requires these checks and a clean whitespace check; no full-suite run,
live worker, provider request or registry publication is needed. Retain logs and
the archive under `.taskmd-runner/release-0.3.0/`.

Results: build passed; the two selected CLI/version cases passed with zero
failures or skips (0.13 seconds). Package and lockfile versions match 0.3.0.
The 29-file, 47,639-byte archive contains the compiled runtime and current worker
instructions; its extracted CLI passes version/help using the existing dependency
tree. This is not a fresh dependency-install check. Whitespace validation passed.
No model calls, test browsers or temporary servers were started. The existing
Assign Vite server was preserved. Removed only the 236 KiB extracted inspection
copy at `.taskmd-runner/release-0.3.0/extracted`; archive and evidence remain.
Data-volume free space was approximately 27.3 GiB; no broader cleanup was done.

## Completion-oriented execution

Requester clarification, 6 November: keep small-task sizing guidance, while
execution continues through the task's full acceptance within the worker budget.
Verified slices are internal checkpoints. Pending handoffs require a genuine
time/context limit, with the reason, evidence and next edit recorded. Supply the
deadline and a bounded handoff reserve; keep task acceptance unchanged.

Codex now reuses a task's provider session for necessary partial continuations
within one invocation. Clear it on a new/changed task contract, unavailable claim,
completion or blocker. Keep other clients' supported behavior and existing
clarification/cap semantics. The response schema is unchanged.

Selected checks: build; prepared partial-resume/new-task/reset cases, existing
partial/worklog/restart/run-limit cases, adapter contracts and clarification cases.
Retain the passing Git/lease/error-continuation checks whose implementations are
unchanged. Separately validate Assign's task collection, exact execution-line-only
amendments, preserved frontmatter/checkmarks/Progress, and instruction consistency.
Keep authoring sizing estimates and product criteria. No application suites,
full runner suite or live inference. Completion requires these focused checks
and structural document checks; expected cost under one minute.

Results: build passed; 25 selected prepared cases passed with zero failures/skips
(11.37 seconds). New cases verify partial-session resumption, fresh sessions for
the next task and changed contract, and the supplied deadline/reserve. Existing
adapter, clarification, cap, worklog and restart selectors remain compatible.
Logs: `.taskmd-runner/efficiency-review/build.log` and `runner-checks.log`.
Workspace collection validation and execution-wording checks passed; product
requirements and sizing guidance were retained. A concurrently active worker's
captured contract was preserved for a safe handoff. No live model was invoked
for validation; actual delivery-time improvement remains unmeasured.

## Blocker continuation and response clarification

Task-level no-progress, worker failures/timeouts and rejected handoffs become
blocked, preserve receipts and select independent work. Emit explicit blocked
and continuation events. Recheck unavailable selections without spinning, and
publish failed-task checkpoints before the next Git boundary. Archive rejected
task edits and restore the original contract before continuing. Interruption,
lost ownership, reconciliation failures and unsafe Git state remain explicit
controller stops, as do configured invocation round caps.

Allow one clarification turn for an invalid response when both task and invocation
run budgets permit it. Charge it as a separate run. Resume the explicit persisted
Codex session; other clients/custom workers receive prior response and evidence
context in a new turn. Clarification may correct the response and Progress only;
it cannot implement more work, change scope, invent evidence or extend budgets.
Preserve the original invalid receipt and usage. Use general contract validation,
without a formatting-specific parser exception. Adapter 0.1.0's installed primary
README/types document Codex-only continuation; no Context7 tool is advertised.

Selected checks: build; affected blocked/no-progress/error/documentation cases,
generic clarification success/failure/budget cases with prepared custom and
adapter processes, unavailable-selection/dependency races, scope restoration,
existing run-limit and interruption cases. Local Git fixtures cover failed-task
publication before independent work plus existing push/conflict safety gates
affected by the shared publication helper. Retain prior CLI/lock/selection evidence
outside these boundaries; no full suite or inference. Expected cost: under two
minutes. Completion requires zero failures in these focused lanes.

Initial results: build passed, 38 selected runner cases passed (16.86 seconds)
and 12 selected Git cases passed (29.70 seconds), all with zero failures/skips.
Logs: `.taskmd-runner/task-run-limits/build-continuation.log`,
`continuation-runner.log` and `continuation-git.log`.

Final evidence inspection found that native worklog compaction after successful
clarification could discard the original rejected Progress notes. Archive every
rejected handoff's task snapshot before clarification/reconciliation. Strengthen
the existing custom-worker clarification case to use native worklogs and verify
the snapshot. Rebuild and rerun only that case, the scope-restoration case and its
Git publication counterpart, whose archival path changed. Retain the other
passing results; this evidence-only follow-up does not require another broad run.

Final results: rebuilt successfully; the two affected runner cases passed
(0.83 seconds) and the Git counterpart passed (2.66 seconds), with zero failures
or skips. The original 50 affected checks plus these compatible follow-ups
satisfy the selected completion gate. Logs: `build-continuation-evidence.log`,
`continuation-evidence-runner.log` and `continuation-evidence-git.log` in the same
evidence directory. The installed Codex CLI accepted the resumed invocation's
parent options in a help-only parse (`codex-resume-help.log`); no model request
was made. Build/test lanes used prepared workers only. Diff whitespace check
passed. No formatting-specific parser change or fixture was introduced.
Teardown found no remaining test processes; no browser or temporary server was
started. Data volume free space: 28.7 GiB. Compiled output is approximately
112 KiB and retained session evidence approximately 324 KiB; no disposable large
session artifacts were identified, no paths were removed and no space reclamation
is claimed. Existing services were preserved.

## Two-hour default timeout

Change the default per-worker timeout from 1800 to 7200 seconds, with matching
help and README text. Explicit timeout overrides and timer handling are unchanged.
Verify the build, the existing CLI-control case with default/override assertions,
and installed CLI help. Retain prior worker timeout/teardown and run-limit
evidence; no worker launches, inference or broad tests are needed. Expected cost:
under two seconds; completion requires all selected checks to pass.

Results: build passed; selected CLI case passed (one pass, zero failures/skips,
0.09 seconds), including 7200-second default and explicit 60-second override.
CLI help reports `default 7200; 2 hours`; diff whitespace check passed. Logs are
retained under `.taskmd-runner/task-run-limits/` as `build-timeout.log`,
`timeout-cli.log` and `timeout-help.log`. No worker or temporary server started.

## Run-limit review request follow-up

Run-limit handoffs now request owner review or subdivision into subtasks that
collectively preserve the original scope and acceptance criteria. Remove the
previous suggestion to re-scope. Persist the review request in the task handoff,
blocked-task summary and terminal worker receipt; keep raw worker results intact.
Verify the build and existing newly exhausted, already exhausted, native-worklog
and two Git publication cases with strengthened review-request assertions.
Completion requires these five focused prepared cases to pass. Retain prior
counter/CLI/adapter evidence; no full suite or live inference is required.

Results: build passed; three runner cases and two Git publication cases passed
with zero failures/skips (1.73 and 5.23 seconds). Assertions cover the handoff,
native worklog, blocked-task summary, saved worker receipt and published task.
Logs: `.taskmd-runner/task-run-limits/build-review.log`, `review-runner.log` and
`review-git.log`. Diff whitespace check passed. No live inference was used.

## Per-task run limits

Changed behavior: persistent per-task run counters, default maximum 5 and default
unfinished-work blocking threshold 3. The lower threshold applies; limit blocking
continues independent work without consuming an extra worker round. Completion
and PR-review handoffs on the last allowed run remain valid. Counters survive
restarts, state-directory overrides and native worklog compaction, and are
preserved on worker errors. Existing interruption/error stop behavior remains.

Selected verification: TypeScript build; prepared run-limit cases for CLI bounds,
thresholds, independent successors/dependents, restarts, worklogs, final-run
completion and counter tampering; existing round-cap, partial-progress,
no-progress, blocked, error/timeout, PR-review and adapter cases. Local bare Git
fixtures cover publishing a newly exhausted task and a previously exhausted task
without another worker. Reuse prior unaffected selection, locking and packaging
evidence. Expected cost: under two minutes. Completion requires these focused
checks with zero failures; no full suite, credentials, live clients or inference.

Initial results: build and 23 selected runner cases passed (zero failures/skips,
9.23 seconds). Two existing Git publication/error checks passed; both new Git
limit cases reached the expected published states but failed their final clean
tree assertion on the intentionally untracked evidence directory. Restrict that
assertion to tracked changes and compare remote/local HEADs, then rerun only
those two cases. An existing CRLF counter exposed a concrete line-ending gap in
counter replacement; normalize line endings as task parsing already does and
run the new CRLF case. Retain the passing LF-input and orchestration evidence;
no broader run is required by these changes.

Final results: the two corrected Git cases passed (zero failures/skips,
4.96 seconds), as did the new CRLF case (one pass, zero failures/skips,
0.36 seconds). The build passed after line-ending normalization. Combined with
retained passing results above, 28 distinct affected checks pass. Original Git
assertion failures remain in `.taskmd-runner/task-run-limits/git.log`; corrected
results are in `git-rerun.log`, with runner/build/CRLF logs beside them.
No test processes or temporary servers remain. Existing Assign runner and shared
services were preserved; already running controllers load the new policy only
after restart. Data volume free space: 27.5 GiB. Session artifacts are limited to
the approximately 104 KiB compiled runtime and small retained verification logs;
no inactive disposable session artifacts were identified or removed.

## 0.2.1 instruction patch

Changed behavior: worker instructions preserve the ticket's intended outcome and
acceptance criteria; conflicts require a user decision rather than reframing.
Only WORKER.md and release metadata change. Retain 0.2.0 runtime evidence below.
Verify a clean release snapshot: TypeScript build, the package-version test and
packed CLI version/help; inspect the archive for the scope rule and matching
package/lockfile versions. Completion requires these checks and a clean diff.
No runtime behavior changes warrant broader tests or live model calls.

Results: build passed; version test 1 passed, 0 failed, 0 skipped (0.13 seconds).
Packed CLI version/help passed; archive inspection confirmed the scope rule,
version 0.2.1 and matching package/lockfile versions. Archive: 29 files, 37,692
bytes. Logs and archive are retained in `.taskmd-runner/release-0.2.1/`.

## Git synchronization and Node-only runtime

This batch adds optional Git synchronization at task boundaries, a separately
opted-in conflict worker, and removes the forwarding launcher and native lock
addon. The lock now uses proper-lockfile 4.1.2 (MIT, pure JavaScript), with a
30-second stale lease and 10-second heartbeat. Earlier flock interoperability
and Node native-addon qualification below describe version 0.1.0 only.

Changed boundaries: CLI options, shared worker invocation, pre-claim sync,
post-validation publication/error handling, process interruption and exclusion.
Use local bare Git remotes and prepared worker processes for new checks:
fetch between rounds; multiple selected repositories; dirty/detached/untracked
operation rejection; conflict stop/resolution/scope protection; rejected/racing
pushes; task-status preservation; lease contention, stale recovery and SIGTERM.
Compile once after the coherent implementation batch and select the existing
custom/adapter launch and interruption/lock cases. Retain the earlier unaffected
selection, Markdown validation, documentation evidence and notification results.
Expected cost: under two minutes per selected lane; no live clients or inference.

Completion requires these selected checks, a tarball with no Python files or
native install scripts, and clean installation/entry-point execution with Python
absent from PATH. Run no Assign application suite or full runner suite: the
affected selectors cover the changed boundaries and earlier evidence remains.

Results: 23 Git/lease checks passed across the initial lane and affected follow-up
selectors; the first detached-HEAD assertion expected Git's subcommand name
rather than its error text. Only that assertion was corrected and rerun. Ten
existing worker/client, cap, worklog, interruption, lock and CLI cases passed.
Five scoped checks cover the concurrent task-prefix/identifier changes in the
shared controller, including redirected symlink rejection. Zero failures remain;
all selected lanes report zero skips. No full suite or live model ran here.

The packed 0.2.0 candidate installed and executed version, help and an empty
real-taskmd queue with only Node/npm on PATH (both Python commands absent).
The dependency lock contains no native addon or installation script. This proof
is retained for the final artifact's unchanged dependency/install/entrypoint
closure; the later Git handoff guard is separately checked by a prepared
publication conflict that attempts to discard the accepted Progress journal.
Tarball hashes, file comparisons and complete logs remain under the local
`.taskmd-runner/release-0.2.0` evidence directory.

## TypeScript migration (0.1.0 historical evidence)

The entire execution runtime changes from Python to TypeScript. The initial
runner regression suite is required because selection, transitions, subprocesses,
locking, task contracts and receipts all cross the new runtime. This does not
require any Assign application suite. Prepared worker processes use the real
installed taskmd CLI and never invoke providers or load credentials.

Completion requires the original loop cases, prepared Codex/Claude/Grok adapter
contracts, notification handling and build to pass, followed by separately
authorized real Assign work through those three clients with three-round caps.
Each live trial stops at its cap, empty queue, invalid result or worker failure;
blocked outcomes may continue independent ready work, matching the original loop.

- Initial full runner suite: 23 passed, 0 failed, 0 skipped (7.26 seconds).
- Public adapter dependency: `@bpstr/agent-adapter@0.1.0` from registry.npmjs.org.
  The temporary local development tarball is not a project dependency.
- Changing from the local tarball to the public release invalidates adapter-path
  evidence only. Rerun the four adapter launch/receipt cases and build; retain the
  unchanged transition, task-context, locking and notification evidence.
- Public-release adapter cases: 4 passed, 0 failed, 0 skipped (3.46 seconds).
- Additional affected checks: interruption/worker teardown/lock release, CRLF
  compatibility, task-history bounds and notification delivery policy: 4 passed,
  0 failed, 0 skipped (1.35 seconds). CRLF normalization preserves Python's
  universal-newline reading behavior; the other loop behavior is unchanged.
- Custom-worker `--help` forwarding and CLI rejection checks: 2 passed, 0 failed,
  0 skipped (0.39 seconds). Runner help parsing now stops before the worker argv.

The first live launcher used Assign's Node 26 against an addon built with Node 24
and failed before claiming work. Preserve `grok-launch.log` as failed evidence.
Subsequent trials explicitly use Node 24.19.0, matching the build and prepared
checks. Rebuild native dependencies when changing Node major versions.

The Python loop's semantics remain authoritative. Native `fs-ext` is retained
instead of a directory lock to coordinate with existing Python `flock` users and
release ownership automatically after crashes. Windows is not qualified (the
original runner required POSIX `fcntl`). Notifications follow roadmap-runner's
sender discovery, attention defaults, explicit extra events and nonfatal delivery
records; this finite sequential runner does not need its background event queue.

Original taskmd skills inform task/context inspection, owning-checkout writes,
effective-status checks, configured worklogs and acceptance verification. The
worker applies inspected verification steps under the project's test policy;
the runner does not execute arbitrary task `verify` commands automatically.

Prepared results establish orchestration behavior, not model quality or live
usage. Live receipts and independent task/source inspection are recorded below.

- Lazy lock-addon loading: advisory-lock and SIGTERM cases passed (2 checks, 0 failures, 0 skipped; 0.40 seconds). Node 26 help exits 0; a Node 26 run with the Node 24 addon exits 1 with an actionable rebuild message before locking or claiming work.
- Python compatibility entry point: `python3 taskmd_runner.py --help` exits 0.
- Package inspection includes both Node entry points, generated modules/types, worker instructions, result schema and the compatibility entry point.

## Additional affected checks

- Ownership fixtures now check acceptance before attempting scope/status edits,
  isolating the ownership guard from the unchecked-criteria guard: 2 passed,
  0 failed, 0 skipped (0.60 seconds).
- UTF-8 pipe decoding now preserves multibyte characters split across chunks,
  matching Python's incremental text decoding. UTF-8, drain and worker-exit
  selectors: 3 passed, 0 failed, 0 skipped (0.59 seconds).
- A clean tarball installation loaded native locking and the public adapter on
  Node 24.19.0; the temporary installation was removed after inspection.
- The concurrent 100-round-run chat added Codex Sol 6.1/medium defaults and a
  fresh documentation-evidence guard. Its retained preflight in the private target
  workspace reports 9 passed, 0 failed, 0 skipped. Preserve that evidence and the
  changes.
- The new guard and fixture inputs invalidate prior evidence for unchecked
  continuation, PR-review and the remaining adapter receipt paths. Select only
  pending/no-progress, verified partial slices, PR-review, Claude/Grok adapters,
  text-only receipts and custom-worker argument forwarding. Expected cost is
  about four seconds; completion requires no failures or skips. Reuse the
  retained ordering, worklog, Codex, documentation rejection and notification
  evidence; no full-suite repeat is warranted.
- Those seven affected cases passed: 0 failures, 0 skipped (2.29 seconds).

## Live trial status

The Grok trial completed three distinct tasks and stopped at the three-round cap
with exit 0. The round-limit desktop alert returned `permission_denied`; its
failure was recorded without changing the task outcome. No usage was available
from this client's text transport, so usage remains null.

The first Claude launch was correctly refused while another authorized runner
held the physical task-directory lock. It claimed no task. After the requester
authorized stopping that run, its interruption receipt was retained, its monitor
finished, and Claude acquired the released lock for a separate three-round trial.

Live task content, client logs, receipts and review findings remain private in the
target workspace. Counts describe orchestration outcomes, not independent product
qualification or resolution of every worker-reported documentation discrepancy.

The Claude trial also completed three distinct tasks and stopped at its
three-round cap with exit 0. Every round retained a fresh documentation-check
marker, normalized usage and scoped verification receipts. Later additive cohorts
change shared script hashes, so earlier checks remain historical scoped evidence;
they are not represented as exact-source qualification of the final whole project.

Codex's first live round could not write worker-created evidence under the chosen
protected `.codex` state path. It retained checks in a task-specific temporary
directory; the controller archived those files after the terminal receipt. The
CLI successfully persisted the structured result, matching the original Python
contract. Restore that distinction in the worker instructions and label the
selected client in the prompt. Check the existing prepared Codex adapter case
(expected under one second), then use the remaining authorized live round to
observe the clarified handoff. Other clients still write their result file.

The prepared Codex handoff case passed (0 failures or skips, 0.93 seconds).
An already-running worker with the earlier prompt reported an artifact-only
blocker despite passing its implementation checks. Preserve that blocked receipt.
After the client run ends, reconcile only after archival and verification of the
actual persisted result. The next cohort changed two shared script pins, so run
only that blocked contribution's retained selector against the current scripts
before closing it; the other six dependency pins remain compatible. Expected
cost is under a second, and completion requires a passing scoped receipt with
zero failures. No additional model session or broad application suite is needed.

All three client runs reached exactly three rounds and exited 0 at their caps.
The final Codex round completed with the clarified JSON handoff. The artifact-only
blocked contribution was reconciled after its affected selector passed six
operations with zero failures and all eight current source pins matched. Original
blocked receipts remain unchanged; there was no extra worker session.

The required projection sync and queue validation passed at reconciliation.
Subsequent unrelated task creation changed the queue and introduced a duplicate
ID; timestamped post-trial validation records that separately. Managed trial tasks
remain complete. No automatic ID rewrite or unrelated backlog cleanup was done.

Final evidence consists of the initial regression suite plus the documented
affected checks, package installation/build checks, original live receipts,
controller reconciliation and private task/source reviews. No full application
suite, paid synthetic inference or product release qualification is claimed.

## Publication checks

Version 0.1.0 is the first npm/GitHub release; neither service had an earlier
version. Changes for publication add package metadata, installation instructions,
release notes and the `--version` branch. Reuse the runner/client/live evidence
above. Build and select only the new version check, custom-worker help forwarding
and invalid-CLI controls (expected under two seconds). Then inspect the actual
release tarball and its installed `--version`/`--help` entry points without
starting a model worker. No new live client sessions or full-suite run are needed.
The three affected publication checks passed: zero failures or skips (0.46 seconds).

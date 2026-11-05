# Runner validation

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

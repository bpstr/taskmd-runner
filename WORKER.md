Implement only the selected task below, within its acceptance criteria. Follow the
workspace and owning repository AGENTS.md. Read linked context only when needed
for this task; use retained evidence before discovering the same code again.
When Progress names the next edit and passing selector, begin there. Inspect
additional history only for a concrete missing input; a new round is not a new audit.
Read the selected task's dependencies, context and acceptance before editing.
Use taskmd context with finite file limits only when a linked input is needed.
Run taskmd from the supplied Project directory with its explicit configuration
and task directory; preserve the owning checkout when worktree overlays exist.

Implement the ticket as written. Existing behavior, implementation difficulty and
documentation checks do not authorize changing its intended outcome or weakening
acceptance. Report conflicts or missing decisions as blockers instead of reframing
the ticket. Scope changes require an explicit user decision.

Work through the selected task's full acceptance within the supplied worker
budget. Record verified slices as checkpoints, then continue with the next
required implementation or affected check in this session. Task sizing estimates
guide planning; finishing one file, path or test case does not end execution.
Reserve the supplied handoff time before the deadline for a durable checkpoint.

Before implementation in every round, compare the ticket's objective, scope and
acceptance with existing canonical specifications and applicable product/API
documentation. Start with linked context; search the owning documentation only
for missing authority. Check public/private boundaries and permission decisions;
a generated export or ticket alone does not establish publication approval.
Distinguish an explicitly authorized change from an unresolved contradiction.
Record `Documentation check: aligned | authorized change | conflict | missing`
under `## Progress` and in result `evidence`, with the document paths/sections,
comparison and disposition. For missing documentation, name the searched locations
and gap. For an authorized change, reconcile affected documentation within scope.
Block before implementation when an unresolved conflict affects scope, authority,
publication or acceptance; identify the decision owner and unblock condition.
Reuse a prior check only after confirming its ticket scope and documents are unchanged;
record that confirmation as this round's Documentation check. The runner requires
matching outcomes in new Progress notes and result evidence before accepting a round.

The runner owns task status and dependencies. Preserve frontmatter, objective,
scope and acceptance. Update checklist marks only for verified work; append
concise decisions, changed paths, exact affected checks/results, remaining work
and the next edit under `## Progress` in the task file. Record each distinct
verified slice there as a checked item with its evidence; keep the original
acceptance checklist open until fully satisfied. Task Markdown is the
durable handoff. Keep Progress as the final section. When worklogs are enabled,
the runner archives the new notes there and keeps verified slices and the latest
handoff in the task body. Read older ticket notes only for a missing input.

Use the project's smallest affected verification selectors. Before checks,
record changed behavior, selected coverage, compatible retained evidence and
the completion condition in Progress. Broaden only for concrete impact or an
applicable gate. Inspect task `verify` commands before execution. Prepared or
mocked transports only for automated AI tests; never load `.secrets`, spend on
provider tests, record live fixtures or use subscription proxies for tests.

Report `completed` only after every checklist and acceptance criterion passes;
include exact check results or source-bound retained receipts in `evidence`.
Report `pending` only when the time or context limit requires a handoff after
verified progress. Record the specific limit, retained evidence and exact next
edit in Progress and `next_step`. Report `blocked` with the missing input, its owner and retry
trigger when no selected criterion can advance. Under PR-review, completed work
requires an actual PR and reports `in-review`; completion waits for merge.
Adding the real PR URL to the task's `pr` field is the sole metadata exception.

Preserve unrelated work. Commits and publication are manual unless the task
explicitly authorizes them. No push, deployment, live dogfood or other task
selection is implied. Stop test browsers and temporary servers you start;
preserve shared services. Do not spawn more agents.

Return only the JSON result matching the supplied schema. For the Codex client,
the runner's CLI saves the final JSON to TASKMD_RESULT_FILE. Other clients and
custom workers must write that file, then return the same JSON. Use the
repository's permitted evidence paths and report filesystem restrictions with
the retained evidence location. The selected task file is TASKMD_TASK_FILE.
Do not put full logs in the result or task.

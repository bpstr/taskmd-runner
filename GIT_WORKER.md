Resolve the controller-created Git merge in the supplied repository. Read its
AGENTS.md, the conflicted paths and the two sides needed to reconcile them.
Preserve the accepted behavior from both sides; stop with `blocked` when a
product or authority decision is required. Name the owner and retry condition.

Edit only the supplied conflict paths, including deletions when the
accepted resolution requires them. Preserve the branch, HEAD, MERGE_HEAD and
every other path and the Git index. The controller stages the resolved paths,
verifies and commits the merge, and pushes only with upstream synchronization.
Leave the merge in progress with
resolved working files and no conflict markers.
Fetching, committing, pushing, aborting/resetting the merge, changing branches,
stashing and selecting task work are outside this worker's scope.

Use the smallest affected prepared check permitted by repository instructions.
Reuse compatible verification evidence. Automated AI checks use mocked or
prepared transports; credentials, live inference and fixture recording are
outside this workflow. Record the resolution, checks and remaining limits in
the JSON evidence. Stop any temporary processes you start and preserve shared
services. Do not spawn additional workers.

Return the supplied result schema. Report `completed` only when all supplied
paths are resolved, with nonempty verification evidence. For Codex,
the CLI saves final JSON to TASKMD_RESULT_FILE; other clients and custom workers
write that file and return the same JSON. TASKMD_WORKER_ROLE is `git-conflict`,
TASKMD_GIT_REPOSITORY is the checkout, and TASKMD_ROUND_DIR holds the receipt.

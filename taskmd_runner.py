#!/usr/bin/env python3
"""One taskmd selection, one worker, one validated transition; repeat."""

import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

import yaml

HERE = Path(__file__).resolve().parent


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def read_task(path):
    parts = path.read_text().split("---", 2)
    if len(parts) != 3 or parts[0].strip():
        raise ValueError(f"Invalid frontmatter: {path}")
    return yaml.safe_load(parts[1]), parts[2]


def contract(path):
    meta, body = read_task(path)
    for key in ("status", "started_at", "completed_at", "updated_at", "pr"):
        meta.pop(key, None)
    scope = body.split("\n## Progress", 1)[0]
    return meta, re.sub(r"(?m)^(\s*- )\[[xX ]\]", r"\1[ ]", scope)


def checks(path):
    body = read_task(path)[1].split("\n## Progress", 1)[0]
    return (len(re.findall(r"(?m)^\s*- \[[xX]\]", body)),
            len(re.findall(r"(?m)^\s*- \[ \]", body)))


def verified_count(path):
    # A large task can deliver a verified slice in Progress while its original
    # acceptance remains open. Completion still uses checks(), never this count.
    return len(re.findall(r"(?m)^\s*- \[[xX]\]", read_task(path)[1]))


def progress(path, message):
    text = path.read_text()
    if "\n## Progress" not in text:
        text = text.rstrip() + "\n\n## Progress\n"
    path.write_text(text.rstrip() + f"\n\n{now()} — {message}\n")


def task_context(path):
    text = path.read_text()
    scope, separator, history = text.partition("\n## Progress")
    if not separator or len(history.encode()) <= 4096:
        return text
    # Keep the exact task contract and latest handoff. The full journal remains
    # in Markdown; old receipts need not be re-injected on every round.
    paragraphs, size = [], 0
    for paragraph in reversed(history.strip().split("\n\n")):
        cost = len(paragraph.encode()) + 2
        if size + cost > 4096:
            if not paragraphs:
                paragraphs.append(paragraph.encode()[-4094:].decode(errors="ignore"))
            break
        paragraphs.append(paragraph)
        size += cost
    return scope + "\n## Progress (latest checkpoint; earlier history remains in the task file)\n\n" + "\n\n".join(reversed(paragraphs))


def terminate(child):
    # This process group was created by this runner (start_new_session=True).
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


class Runner:
    def __init__(self, args):
        self.args = args
        self.root = Path(args.project).resolve()
        self.config = Path(args.config).resolve() if args.config else self.root / ".taskmd.yaml"
        config = yaml.safe_load(self.config.read_text()) or {}
        self.tasks = (self.root / (args.task_dir or config.get("dir", "tasks"))).resolve()
        self.workflow = config.get("workflow", "solo")
        self.worklogs = config.get("worklogs", False)
        if self.workflow not in ("solo", "pr-review"):
            raise ValueError(f"Unsupported workflow: {self.workflow}")
        self.base = [args.taskmd, "--config", str(self.config), "--task-dir", str(self.tasks), "--no-color"]
        self.filters = [x for f in args.filter for x in ["--filter", f]]
        state = Path(args.state_dir).resolve() if args.state_dir else self.root / ".taskmd-runner"
        self.run_dir = state / (dt.datetime.now().strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8])
        self.rows = []

    def cli(self, *args, json_output=False):
        result = subprocess.run(self.base + list(args), cwd=self.root, capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError(f"taskmd {args[0]} failed ({result.returncode}): {result.stderr[-1500:]} {result.stdout[-1500:]}")
        return json.loads(result.stdout) if json_output else result.stdout

    def status(self, task_id, status):
        self.cli("set", task_id, "--status", status)

    def record(self, path, message, *, handoff=False, worker_notes=""):
        if not self.worklogs:
            progress(path, message)
            return
        task_id = str(read_task(path)[0]["id"])
        note = message + ("\n\nWorker notes:\n" + worker_notes.strip() if worker_notes.strip() else "")
        self.cli("worklog", task_id, "--add", note)
        if not handoff:
            progress(path, message)
            return
        text = path.read_text()
        scope, _, journal = text.partition("\n## Progress")
        slices = list(dict.fromkeys(re.findall(r"(?m)^\s*- \[[xX]\] .+$", journal)))
        history = f"[Ticket worklog](.worklogs/{task_id}.md) contains earlier handoffs and verification details."
        path.write_text(scope.rstrip() + "\n\n## Progress\n\n" + "\n".join(slices) +
                        f"\n\n{now()} — {message}\n\n{history}\n")

    def finish(self, reason, code):
        summary = {"reason": reason, "exit_code": code, "rounds": self.rows, "ended_at": now()}
        (self.run_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps({"reason": reason, "rounds": len(self.rows), "summary": str(self.run_dir / "summary.json")} ), flush=True)
        return code

    def worker(self, path, folder):
        result_file = folder / "result.json"
        prompt = ((HERE / "WORKER.md").read_text() + f"\nProject: {self.root}\nWorkflow: {self.workflow}\n"
                  + f"Task file: {path}\n\nSelected task:\n" + task_context(path))
        (folder / "prompt.md").write_text(prompt)
        env = os.environ.copy()
        env.update(TASKMD_TASK_FILE=str(path), TASKMD_RESULT_FILE=str(result_file), TASKMD_ROUND_DIR=str(folder), ASSIGN_OFFLINE_TESTS="1")
        command = self.args.worker or ["codex", "exec", "--cd", str(self.root), "--skip-git-repo-check",
                    "--sandbox", self.args.sandbox, "-c", 'approval_policy="never"', "--json",
                    "--output-schema", str(HERE / "result.schema.json"),
                    "--output-last-message", str(result_file)]
        if not self.args.worker:
            if self.args.model:
                command += ["--model", self.args.model]
            if self.args.effort:
                command += ["-c", f'model_reasoning_effort="{self.args.effort}"']
            command += ["-"]
        started = time.monotonic()
        with (folder / "worker.jsonl").open("w") as log:
            child = subprocess.Popen(command, cwd=self.root, env=env, stdin=subprocess.PIPE,
                                     stdout=log, stderr=log, text=True, start_new_session=True)
            try:
                child.communicate(prompt, timeout=self.args.timeout)
            finally:
                terminate(child)
        if child.returncode:
            raise RuntimeError(f"worker exit {child.returncode}; see {folder / 'worker.jsonl'}")
        result = json.loads(result_file.read_text())
        if set(result) != {"status", "summary", "evidence", "next_step"}:
            raise ValueError("Worker result fields do not match result.schema.json")
        if result["status"] not in ("pending", "blocked", "completed", "in-review"):
            raise ValueError("Invalid worker status")
        if not all(isinstance(result[k], str) for k in ("summary", "next_step")) or not result["summary"].strip():
            raise ValueError("Worker summary and next_step must be strings; summary must be nonempty")
        if not isinstance(result["evidence"], list) or not all(isinstance(x, str) and x.strip() for x in result["evidence"]):
            raise ValueError("Worker evidence must be a list of nonempty strings")
        return result, {"elapsed_seconds": round(time.monotonic() - started, 2),
                        "prompt_bytes": len(prompt.encode()), "usage": self.usage(folder / "worker.jsonl")}

    @staticmethod
    def usage(path):
        totals = {}
        for line in path.open():
            try:
                event = json.loads(line)
                if event.get("type") == "turn.completed":
                    for key, value in event.get("usage", {}).items():
                        if isinstance(value, int):
                            totals[key] = totals.get(key, 0) + value
            except (ValueError, AttributeError):
                continue
        return totals

    def run(self):
        if not self.tasks.is_dir():
            raise ValueError(f"Task directory missing: {self.tasks}")
        with (self.tasks / ".taskmd-runner.lock").open("a+") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("Another runner owns this task directory")
            self.run_dir.mkdir(parents=True)
            self.cli("validate")
            while not self.args.rounds or len(self.rows) < self.args.rounds:
                selected = self.cli("next", "--format", "json", "--strict-priority", "--limit", "1",
                                    "--filter", "status=pending", *self.filters, json_output=True)
                if not isinstance(selected, list):
                    raise ValueError("Unexpected taskmd next response; not an empty backlog")
                if not selected:
                    remaining = self.cli("list", "--format", "json", *self.filters, json_output=True)
                    unfinished = [t for t in remaining if t.get("effective_status", t["status"]) not in ("completed", "cancelled")]
                    return self.finish("no_ready_tasks" if unfinished else "empty", 2 if unfinished else 0)
                selected = selected[0]
                task_id = selected["id"]
                task = self.cli("get", task_id, "--exact", "--format", "json", json_output=True)
                if task.get("remote_only") or task.get("effective_status", task["status"]) != "pending":
                    return self.finish("claim_conflict", 2)
                path = (self.tasks / task["file_path"]).resolve()
                if not path.is_relative_to(self.tasks):
                    raise ValueError("Selected task is outside task directory")
                # Verify prerequisites again immediately before claiming work.
                meta = read_task(path)[0]
                for dep in meta.get("dependencies", []):
                    prerequisite = self.cli("get", str(dep), "--exact", "--format", "json", json_output=True)
                    if prerequisite.get("effective_status", prerequisite["status"]) != "completed":
                        return self.finish("unmet_dependency", 2)
                before, count, verified_before = contract(path), checks(path), verified_count(path)
                folder = self.run_dir / f"{len(self.rows)+1:03d}-{task_id}"
                folder.mkdir()
                self.status(task_id, "in-progress")
                row = {"task_id": task_id, "started_at": now(), "round": len(self.rows)+1}
                self.rows.append(row)
                print(json.dumps({"round": row["round"], "task_id": task_id, "event": "started"}), flush=True)
                try:
                    self.record(path, f"Started round {row['round']}. Evidence: {folder}")
                    prior_notes = read_task(path)[1].partition("\n## Progress")[2]
                    result, metrics = self.worker(path, folder)
                    row.update(metrics)
                    if contract(path) != before or read_task(path)[0]["status"] != "in-progress":
                        raise ValueError("Worker changed task scope, metadata or runner-owned status")
                    status = result["status"]
                    if status in ("completed", "in-review"):
                        if checks(path)[1] or not result["evidence"]:
                            raise ValueError("Completion requires checked criteria and verification evidence")
                        if self.workflow == "pr-review":
                            if status != "in-review" or not read_task(path)[0].get("pr"):
                                raise ValueError("PR-review work requires in-review and a real linked PR")
                        elif status != "completed":
                            raise ValueError("Solo work completes directly")
                    elif not result["next_step"].strip():
                        raise ValueError("Unfinished work needs a concrete next step or blocker/owner/retry trigger")
                    no_progress = status == "pending" and (verified_count(path) <= verified_before or not result["evidence"])
                    notes = read_task(path)[1].partition("\n## Progress")[2].removeprefix(prior_notes)
                    self.record(path, f"{status}: {result['summary']}\n\nEvidence: " + "; ".join(result["evidence"]) +
                                f"\n\nNext: {result['next_step']}", handoff=True, worker_notes=notes)
                    self.status(task_id, status)
                    self.cli("validate")
                    row.update(status=status, ended_at=now(), checked_before=count[0], checked_after=checks(path)[0],
                               verified_before=verified_before, verified_after=verified_count(path), result=result)
                    (folder / "receipt.json").write_text(json.dumps(row, indent=2) + "\n")
                    if no_progress:
                        return self.finish("no_progress", 2)
                except BaseException as exc:
                    self.status(task_id, "blocked")
                    failure = f"Interrupted or invalid result: {type(exc).__name__}: {exc}. Inspect {folder} before retrying."
                    try:
                        self.record(path, failure, handoff=True)
                    except (OSError, RuntimeError, subprocess.SubprocessError) as log_error:
                        progress(path, failure + f" Worklog write failed: {log_error}")
                    row.update(status="blocked", error=f"{type(exc).__name__}: {exc}", ended_at=now())
                    return self.finish("interrupted" if isinstance(exc, KeyboardInterrupt) else "worker_error", 130 if isinstance(exc, KeyboardInterrupt) else 1)
            return self.finish("round_limit", 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="Project root containing .taskmd.yaml")
    parser.add_argument("--config")
    parser.add_argument("--task-dir")
    parser.add_argument("--state-dir")
    parser.add_argument("--taskmd", default="taskmd")
    parser.add_argument("--filter", action="append", default=[])
    parser.add_argument("--rounds", type=int, default=0, help="Maximum worker rounds; 0 drains ready work")
    parser.add_argument("--timeout", type=float, default=1800, help="Seconds per worker")
    parser.add_argument("--sandbox", choices=["workspace-write", "danger-full-access"], default="workspace-write")
    parser.add_argument("--model")
    parser.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max", "ultra"])
    parser.add_argument("--worker", nargs=argparse.REMAINDER, help="Custom command, no shell; must be the last option")
    args = parser.parse_args()
    if args.rounds < 0 or args.timeout <= 0 or args.worker == []:
        parser.error("rounds must be nonnegative, timeout positive and worker nonempty")
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        return Runner(args).run()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

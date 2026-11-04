import fcntl
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]


class LoopTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.tasks = self.project / "tasks"
        self.tasks.mkdir()
        (self.project / ".taskmd.yaml").write_text("dir: tasks\nworkflow: solo\n")

    def task(self, id, priority="medium", dependencies=None, status="pending"):
        path = self.tasks / f"{id}-task.md"
        meta = {"id": id, "title": f"Task {id}", "status": status,
                "priority": priority, "dependencies": dependencies or []}
        path.write_text("---\n" + yaml.safe_dump(meta) + "---\n# Task\n\n- [ ] Deliver the fixture\n")
        return path

    def test_context_bounds_history_and_preserves_contract_and_next_edit(self):
        spec = importlib.util.spec_from_file_location("runner", ROOT / "taskmd_runner.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        path = self.task("001")
        original = path.read_text()
        history = "\n## Progress\n\nold-audit-marker\n\n" + ("historical receipt\n\n" * 1000) + "Next: edit the selected PATCH fixture\n"
        path.write_text(original + history)
        context = module.task_context(path)
        self.assertTrue(context.startswith(original.rstrip()))
        self.assertIn("Next: edit the selected PATCH fixture", context)
        self.assertNotIn("old-audit-marker", context)
        self.assertLessEqual(len(context.encode()), len(original.encode()) + 4200)
        self.assertEqual(path.read_text(), original + history)

    def run_loop(self, mode="completed", rounds=0, timeout=10, *extra):
        process = subprocess.run([sys.executable, str(ROOT / "taskmd_runner.py"),
                        "--project", str(self.project), "--rounds", str(rounds),
                        "--timeout", str(timeout), *extra,
                        "--worker", sys.executable, str(ROOT / "tests/fake_worker.py"), mode],
                        capture_output=True, text=True, timeout=30)
        summary = None
        for line in process.stdout.splitlines():
            event = json.loads(line)
            if "summary" in event:
                summary = json.loads(Path(event["summary"]).read_text())
        return process, summary

    def test_five_round_limit_priority_and_dependencies(self):
        self.task("001", "low")
        self.task("002", "critical", ["001"])
        for id in ("003", "004", "005", "006"):
            self.task(id, "high")
        process, summary = self.run_loop(rounds=5)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(summary["reason"], "round_limit")
        self.assertEqual(len(summary["rounds"]), 5)
        ids = [r["task_id"] for r in summary["rounds"]]
        self.assertEqual(set(ids[:4]), {"003", "004", "005", "006"})
        self.assertEqual(ids[-1], "001")
        self.assertTrue(all(r["status"] == "completed" for r in summary["rounds"]))
        self.assertEqual(summary["rounds"][0]["usage"]["input_tokens"], 10)

    def test_drain_stops_empty(self):
        self.task("001")
        process, summary = self.run_loop()
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(summary["reason"], "empty")
        self.assertEqual(len(summary["rounds"]), 1)

    def test_empty_never_launches_worker(self):
        process, summary = self.run_loop(mode="exit")
        self.assertEqual(process.returncode, 0)
        self.assertEqual(summary["rounds"], [])

    def test_blocked_is_not_empty_and_independent_work_continues(self):
        self.task("001", "critical")
        self.task("002", "high", ["001"])
        self.task("003", "low")
        process, summary = self.run_loop(mode="blocked")
        self.assertEqual(process.returncode, 2, process.stderr)
        self.assertEqual(summary["reason"], "no_ready_tasks")
        self.assertEqual([r["task_id"] for r in summary["rounds"]], ["001", "003"])

    def test_pending_without_new_checked_work_stops(self):
        self.task("001")
        process, summary = self.run_loop(mode="pending")
        self.assertEqual(process.returncode, 2)
        self.assertEqual(summary["reason"], "no_progress")
        self.assertEqual(len(summary["rounds"]), 1)

    def test_false_completion_is_rejected(self):
        path = self.task("001")
        process, summary = self.run_loop(mode="false-completion")
        self.assertEqual(process.returncode, 1)
        self.assertEqual(summary["reason"], "worker_error")
        self.assertEqual(yaml.safe_load(path.read_text().split("---")[1])["status"], "blocked")

    def test_verified_progress_slices_continue_without_closing_acceptance(self):
        path = self.task("001")
        process, summary = self.run_loop(mode="partial", rounds=2)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(summary["reason"], "round_limit")
        self.assertEqual(len(summary["rounds"]), 2)
        self.assertEqual(summary["rounds"][-1]["checked_after"], 0)
        self.assertEqual(summary["rounds"][-1]["verified_after"], 2)
        self.assertIn("- [ ] Deliver the fixture", path.read_text())

    def test_worklogs_archive_handoffs_without_becoming_tasks(self):
        path = self.task("001")
        (self.project / ".taskmd.yaml").write_text("dir: tasks\nworklogs: true\n")
        process, summary = self.run_loop(mode="partial", rounds=2)
        self.assertEqual(process.returncode, 0, process.stderr)
        log = self.tasks / ".worklogs/001.md"
        self.assertTrue(log.exists())
        self.assertIn("Worker notes:", log.read_text())
        self.assertNotIn("Started round 1", path.read_text())
        self.assertIn("Ticket worklog", path.read_text())
        self.assertIn("- [ ] Deliver the fixture", path.read_text())
        process, summary = self.run_loop()
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(summary["reason"], "empty")
        self.assertEqual(len(summary["rounds"]), 1)

    def test_worker_errors_are_not_retried(self):
        for mode in ("malformed", "exit", "timeout"):
            with self.subTest(mode=mode):
                path = self.task("001")
                process, summary = self.run_loop(mode=mode, timeout=0.1 if mode == "timeout" else 10)
                self.assertEqual(process.returncode, 1, process.stderr)
                self.assertEqual(summary["reason"], "worker_error")
                self.assertEqual(len(summary["rounds"]), 1)
                self.assertEqual(yaml.safe_load(path.read_text().split("---")[1])["status"], "blocked")

    def test_invalid_dependency_fails_before_claim(self):
        path = self.task("001", dependencies=["missing"])
        process, summary = self.run_loop()
        self.assertEqual(process.returncode, 1)
        self.assertIsNone(summary)
        self.assertEqual(yaml.safe_load(path.read_text().split("---")[1])["status"], "pending")

    def test_lock_prevents_second_runner(self):
        self.task("001")
        with (self.tasks / ".taskmd-runner.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            process, _ = self.run_loop()
        self.assertEqual(process.returncode, 1)
        self.assertIn("Another runner", process.stderr)

    def test_pr_review_stops_at_linked_review(self):
        self.task("001")
        (self.project / ".taskmd.yaml").write_text("dir: tasks\nworkflow: pr-review\n")
        process, summary = self.run_loop(mode="in-review")
        self.assertEqual(process.returncode, 2, process.stderr)
        self.assertEqual(summary["rounds"][0]["status"], "in-review")
        self.assertEqual(summary["reason"], "no_ready_tasks")


if __name__ == "__main__":
    unittest.main()

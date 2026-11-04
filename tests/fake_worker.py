"""Prepared transport for loop integration tests. Never starts a model."""
import json
import os
from pathlib import Path
import sys
import time
import yaml

path = Path(os.environ["TASKMD_TASK_FILE"])
result = Path(os.environ["TASKMD_RESULT_FILE"])
mode = sys.argv[1]
sys.stdin.read()
if mode == "timeout":
    time.sleep(60)
elif mode == "malformed":
    result.write_text("invalid json")
    sys.exit(0)
elif mode == "exit":
    sys.exit(7)
if mode == "partial":
    text = path.read_text()
    text += "\n- [x] Verified slice " + Path(os.environ["TASKMD_ROUND_DIR"]).name + ": prepared evidence passes\n"
    path.write_text(text)
if mode not in ("pending", "blocked", "false-completion", "partial"):
    path.write_text(path.read_text().replace("- [ ]", "- [x]"))
if mode == "in-review":
    pieces = path.read_text().split("---", 2)
    meta = yaml.safe_load(pieces[1])
    meta["pr"] = ["https://github.com/example/project/pull/1"]
    path.write_text("---\n" + yaml.safe_dump(meta) + "---" + pieces[2])
result.write_text(json.dumps({"status": "pending" if mode == "partial" else mode if mode in ("pending", "blocked", "in-review") else "completed",
                              "summary": "Prepared worker result", "evidence": ["prepared selector: 1 passed"],
                              "next_step": "Fixture owner supplies prerequisite; retry after input changes"}))
print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 2}}))

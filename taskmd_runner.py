#!/usr/bin/env python3
"""Compatibility entry point; the runner implementation is TypeScript."""
import os
from pathlib import Path
import sys

if __name__ == "__main__":
    entry = Path(__file__).resolve().parent / "bin" / "taskmd-runner.js"
    os.execvp("node", ["node", str(entry), *sys.argv[1:]])

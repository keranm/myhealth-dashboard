#!/usr/bin/env python3
"""Dump /api/states to tools/states.json for the off-instance resolver harness.

The dump is gitignored — it is a snapshot of someone's health data and has no
business in a public repo.
"""
import json, pathlib, sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ha import rest  # noqa: E402

out = pathlib.Path(__file__).parent / "states.json"
states = rest("/api/states")
out.write_text(json.dumps(states))
print(f"wrote {out} — {len(states)} entities")

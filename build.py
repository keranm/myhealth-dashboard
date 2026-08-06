#!/usr/bin/env python3
"""Concatenate src/*.js into dist/myhealth-dashboard.js.

The card is one IIFE split across numbered source files purely for editing
comfort: 01 opens it, 99 closes it, and everything between hangs off the `MH`
namespace so the order of the middle files doesn't matter.
Edit src/, never dist/.
"""
import pathlib, sys

here = pathlib.Path(__file__).parent
src = sorted((here / "src").glob("*.js"))
if not src:
    sys.exit("no sources in src/")

out = "".join(p.read_text() for p in src)
dist = here / "dist"
dist.mkdir(exist_ok=True)
(dist / "myhealth-dashboard.js").write_text(out)
print(f"built dist/myhealth-dashboard.js — {len(out):,} bytes from {len(src)} sources")
for p in src:
    print(f"   {p.name:<20} {len(p.read_text()):>7,}")

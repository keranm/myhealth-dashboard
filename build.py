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

# MH.CSS is a template literal, so a stray backtick in a stylesheet comment
# silently terminates it and the build emits a file that will not parse. That
# has happened three times; it is cheaper to refuse than to notice later.
style = here / "src" / "06-style.js"
if style.exists():
    body = style.read_text()
    opener = body.find("MH.CSS = `")
    if opener >= 0:
        rest = body[opener + len("MH.CSS = `"):]
        closer = rest.find("`;")
        stray = rest[:closer].count("`") if closer >= 0 else rest.count("`")
        if stray:
            sys.exit(f"{style.name}: {stray} stray backtick(s) inside MH.CSS — "
                     "they end the template literal. Use plain text in comments.")

out = "".join(p.read_text() for p in src)
dist = here / "dist"
dist.mkdir(exist_ok=True)
(dist / "myhealth-dashboard.js").write_text(out)
print(f"built dist/myhealth-dashboard.js — {len(out):,} bytes from {len(src)} sources")
for p in src:
    print(f"   {p.name:<20} {len(p.read_text()):>7,}")

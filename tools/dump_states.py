#!/usr/bin/env python3
"""Snapshot the instance for the off-instance resolver harness.

Writes two files, both gitignored — they are a snapshot of someone's health
data and have no business in a public repo:

  tools/states.json  /api/states
  tools/stats.json   hourly long-term statistics for every entity a role
                     resolved to, which is what 04-freshness.js reads to work
                     out when a reading was really taken

The statistics window defaults to 120 days, matching MH.fetchAges.
"""
import json, pathlib, subprocess, sys, datetime as dt

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from ha import rest, WS  # noqa: E402

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 120

states = rest("/api/states")
(HERE / "states.json").write_text(json.dumps(states))
print(f"wrote states.json — {len(states)} entities")

# Ask the built card itself which entities matter, rather than keeping a second
# list here that could drift from the role catalogue.
node = subprocess.run(
    ["node", "-e", """
      const MH = require('../dist/myhealth-dashboard.js');
      const s = require('./states.json');
      const r = MH.resolve(s, { stamps: MH.findStamps(s) });
      const ids = [...new Set(Object.values(r).filter(x => x.entity_id && !x.blank)
                                             .map(x => x.entity_id))];
      console.log(JSON.stringify(ids));
    """],
    cwd=HERE, capture_output=True, text=True)
if node.returncode:
    sys.exit("could not ask the card which entities to fetch:\n" + node.stderr)
ids = json.loads(node.stdout)

start = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=DAYS)).isoformat()
w = WS()
stats = w.cmd(type="recorder/statistics_during_period", start_time=start,
              statistic_ids=ids, period="hour", types=["mean"])
w.close()
(HERE / "stats.json").write_text(json.dumps(stats))
print(f"wrote stats.json — {len(stats)} of {len(ids)} resolved entities have "
      f"statistics over {DAYS} days")

# ---------------------------------------------------------------------------
# Chart series, so tools/preview.html can draw the history views offline.
#
# Keyed exactly as the card asks for them — statistic id, period and the types
# requested — because the preview's fake `callWS` matches on that key and must
# not have to guess which query a view meant.
# ---------------------------------------------------------------------------
series = {}
w2 = WS()
plans = [("month", ["mean", "min", "max"], 6000),
         ("day", ["mean", "min", "max"], 365),
         ("hour", ["max"], 30)]
for period, types, days in plans:
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat()
    for sid in ids:
        try:
            got = w2.cmd(type="recorder/statistics_during_period", start_time=since,
                         statistic_ids=[sid], period=period, types=types)
        except Exception:
            continue
        if got.get(sid):
            series[f"{sid}|{period}|{','.join(types)}"] = got[sid]
w2.close()
(HERE / "series.json").write_text(json.dumps(series))
print(f"wrote series.json — {len(series)} series across {len(plans)} resolutions")

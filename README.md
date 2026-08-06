# myHealth Dashboard

A health dashboard for Home Assistant, installed through HACS. Four views —
**Today · Body · Heart · Movement** — over whatever health data your instance
already has.

It is not an Apple Health dashboard. Withings, Garmin, Google Health, a Zigbee
scale and [AH for HA](https://github.com/keranm/strideApp) are all just sources.
The card is written against *roles* — `weight`, `systolic`, `move_ring` — and
resolves each one to an entity in your instance at startup. Bring a scale and
nothing else and you get a working Body view, and no empty Heart tab pretending
otherwise.

One custom card, no dependencies, no build step beyond concatenating `src/`.

> **Status: in development.** The resolver and its test harness are built. The
> views are not. See [PLAN.md](PLAN.md).

---

## The two ideas it is built on

**1. Roles, not entity ids.** Each role resolves through explicit config →
auto-discovery → absent. Absent is a designed state, not a missing card: it
renders dimmed, with a `GAP` badge and a line saying when the last reading was.
That means "works with whatever you have" and "honest about gaps" are the same
mechanism rather than two features.

**2. A reading's age is not its entity's age.** This is the one that bites.
Health sensors are republished continuously and hold their last value forever,
so a blood pressure taken nine days ago carries a `last_updated` of *now*.
`last_changed` looks like the fix and is not — every restart resets it. So the
card resolves a real measurement time per role, best source first:

| | Source | Survives a restart |
|---|---|---|
| 1 | an entity attribute (`measured_at`, `last_reading`, …) | yes |
| 2 | a change-triggered `input_datetime` stamp | yes |
| 3 | the last long-term-statistics bucket holding a value | yes |
| 4 | `last_changed` | **no** — reported as *age unknown*, never as fresh |

A card that cannot establish a real age says so. It does not show a nine-day-old
reading as today's.

---

## Layout

```
src/01-core.js        opens the IIFE, helpers
src/02-roles.js       the role catalogue — every metric, its unit and its freshness window
src/03-resolve.js     discovery scoring, measurement age, tab liveness
src/99-export.js      closes it; exports for the browser and for node
build.py              concatenates src/*.js -> dist/myhealth-dashboard.js
tools/ha.py           HA REST + websocket helper
tools/dump_states.py  snapshot /api/states for the harness (gitignored — it is health data)
tools/resolve_check.js the harness
```

Edit `src/`, never `dist/`.

## The harness

```sh
python3 build.py
python3 tools/dump_states.py     # optional: adds a live resolution table
node tools/resolve_check.js
```

It does two things. First, assertions that hold on any instance — a scale-only
user sees only the Body tab; an automation never resolves as a reading; a step
*goal* never resolves as steps *walked*; five kilogram sensors resolve to five
distinct body-composition roles. Second, a resolution table against a real
`/api/states` dump, so you can see what discovery guessed before trusting it.

The assertions are there because every failure they catch is silent. A role
that binds to a plausible wrong entity produces a dashboard that looks entirely
correct and reads wrong. Four such bindings were caught the first time the table
was printed against a live instance, and each is now an assertion:

- `steps` bound to an unrelated `sensor.stay_steps`, because a "shorter entity
  id wins" tiebreak overrode the catalogue's own preference order
- `steps` then bound to a *blank* step sensor over one holding 8,432
- `exercise_ring` and `stand_ring` bound to `exercise_minutes` and `stand_time`
  — their own declared fallbacks
- `fat_free_mass` bound to lean mass rather than the directly measured value

## Design

`design_handoff_health_dashboard/` — the visual specification: seven
screenshots, final tokens, and two `.dc.html` prototypes. Fidelity is high and
the visual design is settled. Its *architecture* advice is not followed; see
PLAN.md §1.

## Licence

MIT.

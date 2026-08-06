#!/usr/bin/env node
/**
 * Off-instance harness for the role resolver.
 *
 * Two jobs, in order of importance:
 *
 *   1. Assertions that hold for any instance. These are the ones worth having:
 *      the failures they catch are silent — a role that quietly binds to the
 *      wrong entity produces a dashboard that looks right and reads wrong.
 *
 *   2. A resolution table against a real /api/states dump, so a human can see
 *      what discovery guessed before trusting it.
 *
 *   node tools/resolve_check.js [states.json]
 *
 * Fetch a dump with:  python3 tools/dump_states.py
 */
const fs = require("fs");
const path = require("path");

const MH = require(path.join(__dirname, "..", "dist", "myhealth-dashboard.js"));

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) return;
  failures++;
  console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`);
};

const ent = (id, state, attrs, changed) => ({
  entity_id: id,
  state: state,
  attributes: attrs || {},
  last_changed: changed || new Date().toISOString(),
  last_updated: changed || new Date().toISOString()
});

const NOW = Date.parse("2026-08-07T08:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

/* ---------------------------------------------------------------- *
 * 1. Synthetic assertions
 * ---------------------------------------------------------------- */
console.log("assertions");

/* An empty instance still resolves every role, as absent. A view that
   iterates roles must never hit undefined. */
{
  const r = MH.resolve([], {});
  check("empty instance resolves every role",
        Object.keys(r).length === MH.ROLES.length);
  check("every role in an empty instance is absent",
        MH.ROLES.every((x) => r[x.key].how === "absent"));
  check("an empty instance shows no tabs",
        MH.liveTabs(r).length === 0, JSON.stringify(MH.liveTabs(r)));
}

/* The scale-only user. This is the standalone rule as a test: one Zigbee
   scale, no phone, no watch, no treadmill — Body works, and nothing else
   claims to. */
{
  const r = MH.resolve([
    ent("sensor.bathroom_scale_weight", "82.4", { device_class: "weight", unit_of_measurement: "kg" })
  ], {}, { now: NOW });
  check("scale-only: weight resolves", r.weight.entity_id === "sensor.bathroom_scale_weight",
        "got " + r.weight.entity_id);
  check("scale-only: only the Body tab is live",
        JSON.stringify(MH.liveTabs(r)) === '["body"]', JSON.stringify(MH.liveTabs(r)));
  check("scale-only: systolic is absent, not blank-with-entity",
        r.systolic.how === "absent" && r.systolic.entity_id === null);
}

/* Domain discipline. `automation.stride_bp_reminder` and
   `input_number.stride_bp_interval` both contain BP tokens. Binding a reading
   to an automation would render "on" as a blood pressure. */
{
  const r = MH.resolve([
    ent("automation.stride_bp_reminder", "on"),
    ent("script.stride_coach", "off"),
    ent("input_select.stride_coach_personality", "dry")
  ], {}, { now: NOW });
  check("automations never resolve as readings", r.systolic.entity_id === null,
        "got " + r.systolic.entity_id);
  check("scripts never resolve as the coach", r.coach_message.entity_id === null,
        "got " + r.coach_message.entity_id);
}

/* Goal sensors must not satisfy the metric they are a goal for. A step goal
   read as steps shows 10,000 steps walked at 6am. */
{
  const r = MH.resolve([
    ent("sensor.apple_health_step_goal", "10000", { unit_of_measurement: "steps" }),
    ent("sensor.apple_health_steps", "8432", { unit_of_measurement: "steps" }),
    ent("sensor.apple_health_move_goal", "402", { unit_of_measurement: "kcal" }),
    ent("sensor.apple_health_move_ring", "664", { unit_of_measurement: "kcal" })
  ], {}, { now: NOW });
  check("steps is not the step goal", r.steps.entity_id === "sensor.apple_health_steps",
        "got " + r.steps.entity_id);
  check("step goal resolves separately", r.step_goal.entity_id === "sensor.apple_health_step_goal",
        "got " + r.step_goal.entity_id);
  check("move ring is not the move goal", r.move_ring.entity_id === "sensor.apple_health_move_ring",
        "got " + r.move_ring.entity_id);
  check("move goal resolves separately", r.move_goal.entity_id === "sensor.apple_health_move_goal",
        "got " + r.move_goal.entity_id);
}

/* Mass roles must not collide. Five sensors in kg, five distinct meanings —
   the failure mode is a Body tab where muscle mass reads as fat mass and
   nothing looks wrong. */
{
  const r = MH.resolve([
    ent("sensor.w_weight", "71.2", { device_class: "weight", unit_of_measurement: "kg" }),
    ent("sensor.w_fat_mass", "18.60", { unit_of_measurement: "kg" }),
    ent("sensor.w_fat_free_mass", "52.60", { unit_of_measurement: "kg" }),
    ent("sensor.w_muscle_mass", "49.90", { unit_of_measurement: "kg" }),
    ent("sensor.w_bone_mass", "3.34", { unit_of_measurement: "kg" })
  ], {}, { now: NOW });
  const got = ["weight", "fat_mass", "fat_free_mass", "muscle_mass", "bone_mass"]
    .map((k) => r[k].entity_id);
  check("five kg sensors resolve to five distinct roles",
        new Set(got).size === 5 && !got.includes(null), JSON.stringify(got));
  check("fat_mass is not fat_free_mass", r.fat_mass.entity_id === "sensor.w_fat_mass",
        "got " + r.fat_mass.entity_id);
}

/* Explicit config always wins, and a pinned entity is not available to be
   discovered into some other role. */
{
  const states = [
    ent("sensor.garmin_weight", "80.0", { unit_of_measurement: "kg" }),
    ent("sensor.withings_weight", "71.2", { device_class: "weight", unit_of_measurement: "kg" })
  ];
  const r = MH.resolve(states, { entities: { weight: "sensor.garmin_weight" } }, { now: NOW });
  check("config beats discovery", r.weight.entity_id === "sensor.garmin_weight",
        "got " + r.weight.entity_id);
  check("config resolution is reported as config", r.weight.how === "config");

  const bad = MH.resolve(states, { entities: { weight: "sensor.does_not_exist" } }, { now: NOW });
  check("a configured entity that is gone reports missing, not absent",
        bad.weight.how === "missing" && bad.weight.why != null, bad.weight.why);
}

/* Freshness — the point of the whole exercise. */
{
  const states = [
    ent("sensor.w_systolic", "152", { unit_of_measurement: "mmHg" }, daysAgo(0.04)),
    ent("input_datetime.bp_stamp", "2026-07-29 11:45:00")
  ];

  /* Without a stamp, last_changed says an hour — and it is wrong, because a
     restart reset it. The resolver must not present that as a known age. */
  const naive = MH.resolve(states, {}, { now: NOW });
  check("last_changed alone is treated as an unknown age, not a fresh reading",
        naive.systolic.unknown_age === true && naive.systolic.stale === false,
        JSON.stringify({ unknown: naive.systolic.unknown_age, stale: naive.systolic.stale }));

  /* With the stamp, the real age is nine days. Under a 14-day window that is
     a current reading worth labelling, not a GAP — which is what the design
     draws. */
  const stamped = MH.resolve(states, { stamps: { systolic: "input_datetime.bp_stamp" } }, { now: NOW });
  check("a stamp gives the real measurement age",
        Math.round(stamped.systolic.age_days) === 9, String(stamped.systolic.age_days));
  check("nine-day-old BP is not a GAP", stamped.systolic.stale === false);
  check("the age source is reported", stamped.systolic.measured_via.startsWith("stamp:"));

  /* Push it past the window and it must go stale. */
  const old = MH.resolve([
    ent("sensor.w_systolic", "152", { unit_of_measurement: "mmHg" }),
    ent("input_datetime.bp_stamp", "2026-05-01 09:00:00")
  ], { stamps: { systolic: "input_datetime.bp_stamp" } }, { now: NOW });
  check("a reading past its window is a GAP", old.systolic.stale === true,
        String(old.systolic.age_days));

  /* Windows are per-metric physiology. Four days is a current weight and a
     dead activity ring; one global timeout cannot express that. */
  const four = { stamps: { weight: "input_datetime.s", move_ring: "input_datetime.s" } };
  const s4 = [
    ent("sensor.w_weight", "71.2", { device_class: "weight", unit_of_measurement: "kg" }),
    ent("sensor.h_move_ring", "664", { unit_of_measurement: "kcal" }),
    ent("input_datetime.s", "2026-08-03 08:00:00")
  ];
  const r4 = MH.resolve(s4, four, { now: NOW });
  check("4-day-old weight is current", r4.weight.stale === false);
  check("4-day-old move ring is a GAP", r4.move_ring.stale === true);
}

/* Regressions caught on the live instance, kept as assertions.
 *
 * Every one of these bound to a wrong-but-plausible entity and rendered a
 * dashboard that looked entirely correct. That is the failure mode this whole
 * harness exists for. */
{
  /* A "shorter entity id wins" tiebreak bound steps to an unrelated device. */
  const r = MH.resolve([
    ent("sensor.stay_steps", "0", { unit_of_measurement: "steps" }),
    ent("sensor.apple_health_steps", "8432", { unit_of_measurement: "steps", state_class: "measurement" })
  ], {}, { now: NOW });
  check("steps prefers the declared measurement over a bare same-named sensor",
        r.steps.entity_id === "sensor.apple_health_steps", "got " + r.steps.entity_id);

  /* A blank candidate outranked one holding a reading. */
  const b = MH.resolve([
    ent("sensor.withings_steps_today", "unknown", { unit_of_measurement: "steps", state_class: "total_increasing" }),
    ent("sensor.apple_health_steps", "8432", { unit_of_measurement: "steps", state_class: "measurement" })
  ], {}, { now: NOW });
  check("a sensor with a reading beats an identically-named blank one",
        b.steps.entity_id === "sensor.apple_health_steps", "got " + b.steps.entity_id);

  /* Catalogue order is a preference and was being discarded, so the rings
     bound to their own fallbacks. */
  const g = MH.resolve([
    ent("sensor.apple_health_exercise_minutes", "0", { unit_of_measurement: "min", state_class: "measurement" }),
    ent("sensor.apple_health_exercise_ring", "30", { unit_of_measurement: "min", state_class: "measurement" }),
    ent("sensor.apple_health_stand_time", "0", { unit_of_measurement: "min", state_class: "measurement" }),
    ent("sensor.apple_health_stand_ring", "10", { unit_of_measurement: "h", state_class: "measurement" })
  ], {}, { now: NOW });
  check("exercise_ring beats exercise_minutes", g.exercise_ring.entity_id === "sensor.apple_health_exercise_ring",
        "got " + g.exercise_ring.entity_id);
  check("stand_ring beats stand_time", g.stand_ring.entity_id === "sensor.apple_health_stand_ring",
        "got " + g.stand_ring.entity_id);

  /* Lean mass outranked the directly-measured fat-free mass. */
  const f = MH.resolve([
    ent("sensor.apple_health_lean_mass_health", "53.80", { unit_of_measurement: "kg", state_class: "measurement" }),
    ent("sensor.withings_fat_free_mass", "52.60", { unit_of_measurement: "kg", state_class: "measurement" })
  ], {}, { now: NOW });
  check("fat-free mass beats lean mass", f.fat_free_mass.entity_id === "sensor.withings_fat_free_mass",
        "got " + f.fat_free_mass.entity_id);

  /* A declared unit must reject, not merely fail to reward. */
  const u = MH.resolve([
    ent("binary_sensor.back_yard_sleep_status", "off"),
    ent("sensor.body_fat_mass", "18.60", { unit_of_measurement: "%" })
  ], {}, { now: NOW });
  check("a % sensor never resolves as a kg mass role", u.fat_mass.entity_id === null,
        "got " + u.fat_mass.entity_id);
  check("a binary sleep status is not a sleep duration", u.sleep_duration.entity_id === null,
        "got " + u.sleep_duration.entity_id);

  /* When nothing separates two candidates, say so rather than look certain. */
  const amb = MH.resolve([
    ent("sensor.phone_a_steps", "1200", { unit_of_measurement: "steps" }),
    ent("sensor.phone_b_steps", "1300", { unit_of_measurement: "steps" })
  ], {}, { now: NOW });
  check("a genuine tie is flagged ambiguous", amb.steps.ambiguous === true);
}

/* An entity that exists but holds nothing is blank, not stale — the card says
   "no reading", not "your last reading was ages ago". */
{
  const r = MH.resolve([
    ent("sensor.apple_health_sleep", "unknown", { unit_of_measurement: "h" })
  ], {}, { now: NOW });
  check("an unknown state is blank", r.sleep_duration.blank === true);
  check("a blank reading is not also stale", r.sleep_duration.stale === false);
}

/* The medication role has no source anywhere yet. It must resolve cleanly to
   absent rather than throwing, so the card can appear the day data exists. */
{
  const r = MH.resolve([ent("sensor.apple_health_steps", "8432", { unit_of_measurement: "steps" })], {}, { now: NOW });
  check("medication resolves to absent without a source",
        r.medication_logged.how === "absent" && r.medication_logged.entity_id === null);
}

console.log(failures === 0 ? "  all assertions passed\n" : `  ${failures} FAILED\n`);

/* ---------------------------------------------------------------- *
 * 2. Resolution table against a real dump
 * ---------------------------------------------------------------- */
const dump = process.argv[2] || path.join(__dirname, "states.json");
if (!fs.existsSync(dump)) {
  console.log(`no states dump at ${dump} — run tools/dump_states.py for the live table`);
  process.exit(failures ? 1 : 0);
}

const states = JSON.parse(fs.readFileSync(dump, "utf8"));
const resolved = MH.resolve(states, {
  stamps: { weight: "input_datetime.stride_last_weigh_in",
            systolic: "input_datetime.stride_last_bp",
            diastolic: "input_datetime.stride_last_bp" }
});
const rows = MH.explain(resolved);

console.log(`resolution against ${dump} (${states.length} entities)\n`);
const w = (s, n) => String(s).padEnd(n).slice(0, n);
console.log("  " + w("ROLE", 24) + w("ENTITY", 54) + w("STATE", 22) + w("VALUE", 12) + w("AGE", 8) + "VIA");
console.log("  " + "-".repeat(128));
for (const r of rows) {
  console.log("  " + w(r.role, 24) + w(r.entity, 54) + w(r.state, 22) +
              w(r.value, 12) + w(r.age, 8) + r.via);
  if (r.runner_up) console.log("  " + " ".repeat(24) + "also matched: " + r.runner_up);
}

const found = rows.filter((r) => r.entity !== "—").length;
console.log(`\n  ${found} of ${rows.length} roles resolved`);
console.log(`  live tabs: ${MH.liveTabs(resolved).join(", ") || "none"}`);
process.exit(failures ? 1 : 0);

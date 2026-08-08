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

/* ---------------------------------------------------------------- *
 * Freshness from statistics — 04-freshness.js
 * ---------------------------------------------------------------- */
{
  const hour = 3600000;
  const bucket = (hoursAgo, mean) => ({ start: NOW - hoursAgo * hour, mean });

  /* The ordinary case: the value moved four days ago and has been held since.
     The measurement is the first bucket carrying the new value, not the last
     one carrying the old — that one predates the change. */
  const series = [];
  for (let h = 240; h > 96; h--) series.push(bucket(h, 72.4));
  for (let h = 96; h >= 0; h--) series.push(bucket(h, 71.2));
  const got = MH.ageFromStatistics(series, NOW);
  check("statistics recover the time a value last changed", got && got.via === "statistics",
        JSON.stringify(got));
  check("the measurement is the first bucket holding the current value",
        got && Math.round((NOW - got.at) / 3600000) === 96,
        got ? String(Math.round((NOW - got.at) / 3600000)) + "h" : "null");

  /* Nulls are gaps in recording, not readings. They must not be mistaken for
     a change of value. */
  const gappy = [bucket(200, 72.4), bucket(150, null), bucket(100, 71.2),
                 bucket(50, null), bucket(1, 71.2)];
  const g = MH.ageFromStatistics(gappy, NOW);
  check("null buckets are skipped, not read as changes",
        g && Math.round((NOW - g.at) / 3600000) === 100, JSON.stringify(g));

  /* Unchanged across the whole window yields a floor. This is what blood
     pressure does on the live instance, and a floor is not a measurement
     time — it must never be presented as one. */
  const flat = [];
  for (let h = 1080; h >= 0; h--) flat.push(bucket(h, 152));
  const f = MH.ageFromStatistics(flat, NOW);
  check("an unchanged value yields a floor, not a time",
        f && f.via === "statistics-floor" && f.at === undefined, JSON.stringify(f));
  check("the floor is the width of the window",
        f && Math.round(f.floor / 86400000) === 45, f ? String(f.floor / 86400000) : "null");

  check("an empty series yields nothing", MH.ageFromStatistics([], NOW) === null);
  check("an all-null series yields nothing",
        MH.ageFromStatistics([bucket(5, null), bucket(1, null)], NOW) === null);

  /* A floor past the window is enough to know a reading is stale. Short of it,
     it settles nothing — and either way the exact age stays unknown. */
  const states = [ent("sensor.w_systolic", "152", { unit_of_measurement: "mmHg" })];
  const far = MH.resolve(states, {}, { now: NOW, floors: { systolic: 45 * 86400000 } });
  check("a floor past the window makes a reading stale", far.systolic.stale === true);
  check("a floor never becomes an exact age",
        far.systolic.age_days == null && far.systolic.unknown_age === true);
  check("the floor is reported for display", Math.round(far.systolic.age_floor_days) === 45);

  const near = MH.resolve(states, {}, { now: NOW, floors: { systolic: 3 * 86400000 } });
  check("a floor short of the window settles nothing",
        near.systolic.stale === false && near.systolic.unknown_age === true);

  /* A real stamp outranks a statistics floor — it is an actual time. */
  const both = MH.resolve(
    states.concat([ent("input_datetime.stride_last_bp", "2026-07-29 11:45:00")]),
    { stamps: { systolic: "input_datetime.stride_last_bp" } },
    { now: NOW, floors: { systolic: 45 * 86400000 } });
  check("a stamp beats a floor", Math.round(both.systolic.age_days) === 9 &&
        both.systolic.stale === false, String(both.systolic.age_days));
}

/* Stamp discovery — Stride's helpers, found by name rather than configured. */
{
  const stamps = MH.findStamps([
    ent("input_datetime.stride_last_weigh_in", "2026-08-03 06:41:29"),
    ent("input_datetime.stride_last_bp", "2026-07-29 11:45:00"),
    ent("input_datetime.stride_weigh_in_time", "07:00:00"),
    ent("input_datetime.stride_bp_time", "09:00:00")
  ]);
  check("the weigh-in stamp is found", stamps.weight === "input_datetime.stride_last_weigh_in",
        stamps.weight);
  check("the BP stamp is found", stamps.systolic === "input_datetime.stride_last_bp",
        stamps.systolic);
  check("both BP roles share one stamp", stamps.diastolic === "input_datetime.stride_last_bp");
  /* `stride_bp_time` is a time-of-day setting, not a measurement record.
     Binding it would report every BP as measured at 09:00 today. */
  check("a time-of-day helper is not mistaken for a stamp",
        Object.values(stamps).indexOf("input_datetime.stride_bp_time") < 0,
        JSON.stringify(stamps));
}

/* Source coherence for single-event roles.
 *
 * The exact shape found on the live instance: Withings names a workout type
 * and a duration, Apple Health names a type, duration, energy and both heart
 * rates — and they are describing different sessions. Resolved role by role,
 * Withings won `workout_type` (its id carries the literal token "type") while
 * Apple Health won the rest, and the card described a 41-minute Withings walk
 * using a 27-minute Apple Health workout's heart rate. */
{
  const states = [
    ent("sensor.bedroom_withings_last_workout_type", "walk"),
    ent("sensor.bedroom_withings_last_workout_duration", "47.0",
        { unit_of_measurement: "min" }),
    ent("sensor.apple_health_last_workout", "Walk"),
    ent("sensor.apple_health_last_workout_duration", "27", { unit_of_measurement: "min" }),
    ent("sensor.apple_health_last_workout_energy", "117", { unit_of_measurement: "kcal" }),
    ent("sensor.apple_health_last_workout_hr_average", "108", { unit_of_measurement: "bpm" }),
    ent("sensor.apple_health_last_workout_hr_max", "142", { unit_of_measurement: "bpm" }),
    ent("sensor.apple_health_last_workout_start", "2026-08-07T09:56:59Z")
  ];
  const r = MH.resolve(states, {}, { now: NOW });
  const GROUP = ["workout_type", "workout_duration", "workout_energy",
                 "workout_hr_avg", "workout_hr_max", "workout_start"];

  check("the workout group resolves to one source",
        new Set(GROUP.map((k) => r[k].group_source)).size === 1,
        JSON.stringify(GROUP.map((k) => r[k].group_source)));
  check("the source that describes the most of the event wins",
        r.workout_type.group_source === "apple_health", r.workout_type.group_source);
  check("workout type no longer comes from the other integration",
        r.workout_type.entity_id === "sensor.apple_health_last_workout",
        r.workout_type.entity_id);
  check("no workout role is filled from a rejected source",
        GROUP.every((k) => !r[k].entity_id || r[k].entity_id.indexOf("withings") < 0),
        JSON.stringify(GROUP.filter((k) => (r[k].entity_id || "").indexOf("withings") >= 0)));
  check("the whole event is described",
        GROUP.every((k) => r[k].entity_id), JSON.stringify(GROUP.filter((k) => !r[k].entity_id)));

  /* One event, one age. `workout_start` holds the moment it happened, so the
     rest of the group takes that rather than each estimating separately —
     `workout_type` had nothing but `last_changed` before this. */
  check("the group's age is anchored to the event's own start time",
        GROUP.every((k) => Math.abs(r[k].measured_at - Date.parse("2026-08-07T09:56:59Z")) < 1000),
        JSON.stringify(GROUP.map((k) => [k, r[k].measured_via])));
  check("a timestamp state is read as its own measurement time",
        r.workout_start.measured_via === "state", r.workout_start.measured_via);
  check("roles that inherited the event's time say where it came from",
        r.workout_type.measured_via === "group:workout_start", r.workout_type.measured_via);
  check("no workout role is left with a guessed age",
        GROUP.every((k) => r[k].unknown_age === false),
        JSON.stringify(GROUP.filter((k) => r[k].unknown_age)));

  /* The state of a timestamp sensor is a time, not a number. `parseFloat` on
     `2026-08-07T09:56:59Z` returns 2026, which is a plausible-looking year
     where the card expects a workout time. */
  check("a timestamp state is not coerced to a number",
        r.workout_start.value === "2026-08-07T09:56:59Z", JSON.stringify(r.workout_start.value));
  check("an ordinary numeric state is still a number",
        r.workout_duration.value === 27, JSON.stringify(r.workout_duration.value));

  /* Withings alone: it can fill two of the six, so it takes the group and the
     other four go absent rather than being borrowed from anywhere else. */
  const only = MH.resolve(states.slice(0, 2), {}, { now: NOW });
  check("a partial source still takes the whole group",
        only.workout_type.entity_id === "sensor.bedroom_withings_last_workout_type" &&
        only.workout_duration.entity_id === "sensor.bedroom_withings_last_workout_duration");
  check("roles the winning source cannot fill are absent, not borrowed",
        only.workout_energy.entity_id === null && only.workout_hr_max.entity_id === null);
  check("an absent grouped role says why it is absent",
        /withings/.test(only.workout_energy.why || ""), only.workout_energy.why);

  /* An explicit pin is the user's decision and survives the coherence pass. */
  const pinned = MH.resolve(states,
    { entities: { workout_type: "sensor.bedroom_withings_last_workout_type" } },
    { now: NOW });
  check("an explicit pin overrides group coherence",
        pinned.workout_type.entity_id === "sensor.bedroom_withings_last_workout_type" &&
        pinned.workout_type.how === "config");
  check("the rest of the group still resolves coherently around a pin",
        pinned.workout_energy.entity_id === "sensor.apple_health_last_workout_energy");
}

/* A goal is a setting, not a measurement. All three ring goals read GAP on the
   live instance because they had not changed in nine days — which is what a
   goal is supposed to do. */
{
  const states = [
    ent("sensor.apple_health_move_ring", "37", { unit_of_measurement: "kcal" }),
    ent("sensor.apple_health_move_goal", "402", { unit_of_measurement: "kcal" }),
    ent("sensor.apple_health_exercise_goal", "30", { unit_of_measurement: "min" }),
    ent("sensor.apple_health_stand_goal", "10", { unit_of_measurement: "h" }),
    ent("sensor.withings_weight_goal", "83", { unit_of_measurement: "kg" })
  ];
  const r = MH.resolve(states, {}, { now: NOW,
    floors: { move_goal: 9 * 86400000, exercise_goal: 9 * 86400000,
              stand_goal: 9 * 86400000, weight_goal: 28 * 86400000 } });
  for (const k of ["move_goal", "exercise_goal", "stand_goal", "weight_goal"]) {
    check(`${k} is never stale`, r[k].stale === false, JSON.stringify(r[k].measured_via));
  }
  /* The ring beside it keeps its window — this must not have relaxed staleness
     generally. */
  const old = MH.resolve(states, {}, { now: NOW, floors: { move_ring: 9 * 86400000 } });
  check("the ring itself is still subject to its window", old.move_ring.stale === true);

  /* Nor should a goal be nominated for a stamp automation it has no use for. */
  const want = MH.needsStamp(r).map((w) => w.role);
  check("goals are not nominated for stamping",
        !want.some((k) => /_goal$/.test(k)), JSON.stringify(want));
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
const config = { stamps: MH.findStamps(states) };

/* First pass establishes which entities matter; then statistics fill in the
   ages the entities themselves cannot give. This is the same two-step the card
   performs on view mount, so what the table shows is what the card will. */
let resolved = MH.resolve(states, config);

const statsFile = path.join(__dirname, "stats.json");
let statNote = "no stats.json — ages fall back to last_changed";
if (fs.existsSync(statsFile)) {
  const stats = JSON.parse(fs.readFileSync(statsFile, "utf8"));
  const at = {}, floors = {};
  for (const key in resolved) {
    const r = resolved[key];
    if (!r.entity_id || r.blank) continue;
    if (r.measured_via && r.measured_via.indexOf("stamp:") === 0) continue;
    const got = MH.ageFromStatistics(stats[r.entity_id], Date.now());
    if (!got) continue;
    if (got.at != null) at[key] = got.at;
    else if (got.floor != null) floors[key] = got.floor;
  }
  resolved = MH.resolve(states, config, { statLast: at, floors: floors });
  statNote = `stats.json: ${Object.keys(at).length} exact ages, ` +
             `${Object.keys(floors).length} floors`;
}
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
console.log(`\n  ${found} of ${rows.length} roles resolved · ${statNote}`);
console.log(`  live tabs: ${MH.liveTabs(resolved).join(", ") || "none"}`);

const want = MH.needsStamp(resolved);
if (want.length) {
  console.log(`\n  ${want.length} roles have no real measurement age — no timestamp` +
              ` state, no\n  statistics, and no stamp helper. They render as "age` +
              ` unknown", never as fresh:`);
  for (const w of want) console.log(`    ${w.role.padEnd(24)} ${w.entity_id}`);
  console.log(`\n  A change-triggered input_datetime would fix each one, but the card` +
              `\n  reports this rather than writing automations into an instance.`);
}
process.exit(failures ? 1 : 0);

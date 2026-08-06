/**
 * myHealth Dashboard
 *
 * A health dashboard for Home Assistant, distributed via HACS. Four views —
 * Today, Body, Heart, Movement — over whatever health data the instance
 * already has.
 *
 * It is deliberately not an Apple Health dashboard. Withings, Garmin, Google
 * Health, a Zigbee scale and AH for HA are all just sources; the card is
 * written against *roles* (`weight`, `systolic`, `move_ring`) and resolves each
 * role to an entity at runtime. A role that resolves to nothing renders as a
 * designed `GAP` state, never as a hidden card and never as a plausible number.
 *
 * No dependencies, no build step beyond concatenating src/.
 *
 * Design rules this file holds itself to:
 *
 *   1. Every number on screen comes from an entity, and every number carries a
 *      measurement age. An entity's `last_updated` is NOT that age — most
 *      health sensors are republished continuously and hold their last value
 *      forever, so a nine-day-old blood pressure looks a second old. See
 *      03-resolve.js.
 *
 *   2. Absent is a first-class state, because "works with whatever you have"
 *      and the design's "honest about gaps" principle are the same mechanism.
 *
 *   3. The DOM is built once and mutated. `set hass` fires on every state
 *      change in the instance; only the resolved entities are watched.
 */
(function () {
  "use strict";

  const VERSION = "0.1.0";

  /* The namespace every later file hangs off, so their order is free. */
  const MH = { VERSION };

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  const num = (v) => {
    if (v == null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  /** A state that carries no reading. HA spells this several ways. */
  const blank = (s) =>
    s == null || s === "" ||
    s === "unknown" || s === "unavailable" || s === "none" || s === "None";

  const DAY = 86400000;

  MH.num = num;
  MH.blank = blank;
  MH.DAY = DAY;

  /* ------------------------------------------------------------------ *
   * The role catalogue
   * ------------------------------------------------------------------ *
   *
   * The card is written against these keys, never against entity ids. Each
   * role carries:
   *
   *   key      what the views ask for
   *   label    human name, used in the config UI and in error copy
   *   tab      which view needs it (a tab with nothing resolved hides itself)
   *   unit     canonical unit; a source in another unit is converted, not renamed
   *   window   how many days old a reading may be before it reads as a GAP.
   *            This is per-metric physiology, not a global timeout: a weight
   *            four days old is current, an activity ring four days old is not.
   *   match    discovery hints — see 03-resolve.js for how they are scored
   *              device_class  strongest signal, when the integration sets one
   *              units         medium
   *              any           list of token groups; a group matches when every
   *                            token appears in the entity id
   *              not           tokens that disqualify outright
   *
   * Discovery is a convenience, not a contract. Anything it gets wrong the
   * user overrides in config, and the resolver always reports what it guessed.
   */

  MH.ROLES = [
    /* --- Body ------------------------------------------------------- */
    { key: "weight", label: "Weight", tab: "body", unit: "kg", window: 14,
      match: { device_class: ["weight"], units: ["kg", "lb", "st"],
               any: [["weight"]], not: ["goal", "target", "lean", "bmi", "ideal"] } },

    { key: "weight_goal", label: "Target weight", tab: "body", unit: "kg", window: null,
      match: { units: ["kg", "lb"], any: [["weight", "goal"], ["weight", "target"], ["target", "weight"]] } },

    { key: "fat_mass", label: "Fat mass", tab: "body", unit: "kg", window: 14,
      match: { units: ["kg", "lb"], any: [["fat", "mass"]], not: ["free", "ratio", "percent"] } },

    { key: "fat_free_mass", label: "Fat-free mass", tab: "body", unit: "kg", window: 14,
      match: { units: ["kg", "lb"], any: [["fat", "free", "mass"], ["lean", "mass"]] } },

    { key: "muscle_mass", label: "Muscle mass", tab: "body", unit: "kg", window: 14,
      match: { units: ["kg", "lb"], any: [["muscle"]] } },

    { key: "bone_mass", label: "Bone mass", tab: "body", unit: "kg", window: 14,
      match: { units: ["kg", "lb"], any: [["bone"]] } },

    { key: "fat_ratio", label: "Body fat", tab: "body", unit: "%", window: 14,
      match: { units: ["%"], any: [["fat", "ratio"], ["body", "fat"], ["fat", "percent"]],
               not: ["mass"] } },

    { key: "bmi", label: "BMI", tab: "body", unit: null, window: 14,
      match: { any: [["bmi"], ["body", "mass", "index"]] } },

    /* --- Heart ------------------------------------------------------ *
     * BP gets a 14-day window deliberately: the design shows a nine-day-old
     * reading as a real value with "9 days ago" beside it, not as a GAP. A
     * reading being old is worth saying; it is not the same as absent. */
    { key: "systolic", label: "Systolic", tab: "heart", unit: "mmHg", window: 14,
      match: { units: ["mmHg"], any: [["systolic"]] } },

    { key: "diastolic", label: "Diastolic", tab: "heart", unit: "mmHg", window: 14,
      match: { units: ["mmHg"], any: [["diastolic"]] } },

    /* Pulse taken by the BP cuff, at the same moment as the reading above.
     * Distinct from resting_hr, which the watch computes overnight. */
    { key: "cuff_pulse", label: "Pulse at reading", tab: "heart", unit: "bpm", window: 14,
      match: { units: ["bpm"], any: [["heart", "pulse"], ["pulse"]],
               not: ["resting", "walking", "average", "max", "min", "sleep"] } },

    { key: "resting_hr", label: "Resting heart rate", tab: "heart", unit: "bpm", window: 2,
      match: { units: ["bpm"], any: [["resting", "heart"], ["resting", "pulse"]] } },

    { key: "hrv", label: "HRV (SDNN)", tab: "heart", unit: "ms", window: 3,
      match: { units: ["ms"], any: [["heart", "rate", "variability"], ["hrv"], ["sdnn"]] } },

    { key: "spo2", label: "Blood oxygen", tab: "heart", unit: "%", window: 3,
      match: { units: ["%"], any: [["blood", "oxygen"], ["spo2"], ["oxygen", "saturation"]] } },

    { key: "sleep_duration", label: "Sleep", tab: "heart", unit: "h", window: 2,
      match: { units: ["h", "hours", "min"], any: [["sleep"], ["in", "bed"]],
               not: ["awake", "core", "deep", "rem", "heart", "score", "goal", "status", "state"] } },

    { key: "respiratory_rate", label: "Respiratory rate", tab: "heart", unit: "br/min", window: 3,
      match: { any: [["respiratory"]] } },

    { key: "vo2_max", label: "VO₂ max", tab: "heart", unit: "ml/kg/min", window: 90,
      match: { any: [["vo2"]] } },

    /* --- Movement --------------------------------------------------- */
    { key: "steps", label: "Steps", tab: "movement", unit: "steps", window: 1,
      match: { units: ["steps"], any: [["steps"]], not: ["goal", "length", "yesterday"] } },

    { key: "step_goal", label: "Step goal", tab: "movement", unit: "steps", window: null,
      match: { units: ["steps"], any: [["steps", "goal"], ["step", "goal"]] } },

    { key: "distance", label: "Distance walked", tab: "movement", unit: "km", window: 1,
      match: { units: ["km", "mi", "m"], any: [["walk", "run", "distance"], ["distance", "today"],
                                               ["distance", "travelled"]],
               not: ["workout", "treadmill", "weekly", "monthly", "last"] } },

    { key: "flights_climbed", label: "Climbed", tab: "movement", unit: "m", window: 1,
      match: { any: [["flights", "climbed"], ["elevation", "today"], ["climbed"]],
               not: ["workout", "last"] } },

    { key: "active_energy", label: "Active calories", tab: "movement", unit: "kcal", window: 1,
      match: { units: ["kcal", "cal"], any: [["active", "energy"], ["active", "calories"]],
               not: ["last", "workout", "resting"] } },

    /* --- Today: activity rings -------------------------------------- *
     * Rings come from HKActivitySummary and arrive as a value plus a goal.
     * A source with no rings simply resolves nothing and the card hides. */
    { key: "move_ring", label: "Move", tab: "today", unit: "kcal", window: 1,
      match: { units: ["kcal"], any: [["move", "ring"], ["move"]], not: ["goal"] } },
    { key: "move_goal", label: "Move goal", tab: "today", unit: "kcal", window: 1,
      match: { units: ["kcal"], any: [["move", "goal"]] } },

    { key: "exercise_ring", label: "Exercise", tab: "today", unit: "min", window: 1,
      match: { units: ["min"], any: [["exercise", "ring"], ["exercise", "minutes"]], not: ["goal"] } },
    { key: "exercise_goal", label: "Exercise goal", tab: "today", unit: "min", window: 1,
      match: { units: ["min"], any: [["exercise", "goal"]] } },

    /* Stand is counted in hours. `stand_time` is the same idea in minutes and
       is the fallback, so the unit hint does real work here. */
    { key: "stand_ring", label: "Stand", tab: "today", unit: "h", window: 1,
      match: { units: ["h"], any: [["stand", "ring"], ["stand", "hours"], ["stand", "time"]],
               not: ["goal"] } },
    { key: "stand_goal", label: "Stand goal", tab: "today", unit: "h", window: 1,
      match: { units: ["h"], any: [["stand", "goal"]] } },

    /* --- Today: last workout ---------------------------------------- */
    { key: "workout_type", label: "Last workout type", tab: "today", unit: null, window: 14,
      match: { any: [["last", "workout", "type"], ["last", "workout"]],
               not: ["distance", "duration", "energy", "climb", "hr", "start", "calories", "intensity"] } },
    { key: "workout_duration", label: "Last workout duration", tab: "today", unit: "min", window: 14,
      match: { any: [["last", "workout", "duration"]] } },
    { key: "workout_energy", label: "Last workout calories", tab: "today", unit: "kcal", window: 14,
      match: { any: [["last", "workout", "energy"], ["last", "workout", "calories"],
                     ["calories", "burnt", "last", "workout"]] } },
    { key: "workout_hr_avg", label: "Last workout average HR", tab: "today", unit: "bpm", window: 14,
      match: { any: [["last", "workout", "hr", "average"], ["workout", "hr", "avg"]] } },
    { key: "workout_hr_max", label: "Last workout peak HR", tab: "today", unit: "bpm", window: 14,
      match: { any: [["last", "workout", "hr", "max"], ["workout", "hr", "peak"]] } },
    { key: "workout_start", label: "Last workout time", tab: "today", unit: null, window: 14,
      match: { any: [["last", "workout", "start"]] } },
    { key: "workouts_week", label: "Workouts this week", tab: "today", unit: null, window: 1,
      match: { any: [["workouts", "7", "days"], ["workouts", "this", "week"], ["workouts", "week"]] } },

    /* --- Treadmill (Stride, or any treadmill integration) ----------- *
     * All optional. Absent is the normal case — most people do not own one. */
    { key: "treadmill_state", label: "Treadmill state", tab: "movement", unit: null, window: null,
      match: { any: [["treadmill", "mode"], ["treadmill", "state"]] } },
    { key: "treadmill_walks_week", label: "Walks this week", tab: "movement", unit: null, window: 7,
      match: { any: [["treadmill", "workouts", "week"], ["workouts", "this", "week"]] } },
    { key: "treadmill_time_week", label: "Time walked this week", tab: "movement", unit: "min", window: 7,
      match: { any: [["treadmill", "time", "walked"], ["time", "walked", "week"]] } },
    { key: "treadmill_distance_week", label: "Treadmill distance this week", tab: "movement", unit: "km", window: 7,
      match: { any: [["treadmill", "distance", "weekly"], ["distance", "weekly"]] } },
    { key: "treadmill_distance_month", label: "Treadmill distance this month", tab: "movement", unit: "km", window: 31,
      match: { any: [["treadmill", "distance", "monthly"], ["distance", "monthly"]] } },
    { key: "treadmill_calories_week", label: "Treadmill calories this week", tab: "movement", unit: "kcal", window: 7,
      match: { any: [["treadmill", "calories", "weekly"], ["calories", "weekly"]] } },

    /* --- Coach and medication --------------------------------------- *
     * coach_message is the most product-coupled thing on the page and must
     * degrade to nothing. medication_logged has no source anywhere yet — the
     * role exists so the card appears the day the data does, and resolves to
     * absent until then. */
    { key: "coach_message", label: "Coach", tab: "today", unit: null, window: 2,
      match: { any: [["coach"]], not: ["personality", "script"] } },
    { key: "medication_logged", label: "Medication logged today", tab: "today", unit: null, window: 1,
      match: { any: [["medication", "logged"], ["medication"]] } },

    /* --- Sync freshness --------------------------------------------- *
     * Drives the `SYNCED 40S AGO` chip. Unlike every other role this one is
     * *about* time, so its state is a timestamp rather than a measurement. */
    { key: "last_sync", label: "Last sync", tab: "today", unit: null, window: 1,
      match: { any: [["last", "sync"]] } }
  ];

  MH.ROLE_BY_KEY = {};
  for (const r of MH.ROLES) MH.ROLE_BY_KEY[r.key] = r;

  MH.TABS = ["today", "body", "heart", "movement"];

  /* ------------------------------------------------------------------ *
   * The resolver — roles to entities, and readings to ages
   * ------------------------------------------------------------------ */

  const tokens = (id) => id.replace(/^[a-z_]+\./, "").split(/[._-]/).filter(Boolean);

  /** Only these domains can carry a reading. `automation.stride_bp_reminder`
   *  contains the token "bp" and must never resolve as a blood pressure. */
  const READABLE = /^(sensor|binary_sensor|number|input_number|input_datetime)\./;

  /**
   * Score one entity against one role. Returns 0 when it cannot be the role.
   *
   * The weights are ordered by how much the signal is worth trusting:
   * device_class is set deliberately by an integration author, units are
   * suggestive, and the entity id is a name the user may have typed. Apple
   * Health sets no device_class at all — `sensor.apple_health_steps` is just
   * `state_class: measurement, unit: steps` — so name matching has to carry
   * real weight, which is exactly why every guess is reported and overridable.
   */
  const score = (ent, role) => {
    if (!READABLE.test(ent.entity_id)) return 0;
    const m = role.match || {};
    const a = ent.attributes || {};
    const toks = tokens(ent.entity_id);
    const has = (t) => toks.includes(t);

    if (m.not && m.not.some(has)) return 0;

    /* A declared unit rejects, it does not merely fail to reward. A role
       asking for kg must never bind to a sensor reporting %, however well the
       name reads. An entity with no unit at all is still allowed through —
       plenty of legitimate sensors omit it — it just earns nothing for it. */
    if (m.units && a.unit_of_measurement && !m.units.includes(a.unit_of_measurement)) return 0;

    /* A name group must match in full. Without it we are guessing from a unit
       alone, which would make every kg sensor a candidate for every mass role.
       Groups are in the catalogue author's order of preference, and that order
       is a signal: `exercise_ring` before `exercise_minutes` means the ring is
       the thing wanted and the minutes are the fallback. Score it. */
    let group = -1;
    if (m.any) {
      for (let i = 0; i < m.any.length; i++) {
        if (m.any[i].every(has)) { group = i; break; }
      }
    }
    if (group < 0) return 0;

    let s = 4 + Math.max(0, 4 - group);
    if (m.device_class && a.device_class && m.device_class.includes(a.device_class)) s += 5;
    if (m.units && a.unit_of_measurement && m.units.includes(a.unit_of_measurement)) s += 3;

    /* A sensor with a state_class has been declared a measurement by whoever
       wrote the integration. It is a weak signal, but it separates
       `sensor.apple_health_steps` from a step count someone templated by hand,
       and weak beats the alternative — which was a "shorter entity id wins"
       tiebreak that bound steps to an unrelated `sensor.stay_steps`. */
    if (a.state_class) s += 1;

    /* A sensor holding a reading beats one holding nothing. Both
       `apple_health_steps` and `withings_steps_today` are honest candidates for
       `steps`; only one of them has a number in it this morning, and binding to
       the empty one would render a GAP beside a perfectly good step count. */
    if (!blank(ent.state)) s += 2;
    return s;
  };

  /** Attribute names integrations use for "when this was actually measured". */
  const MEASURED_ATTRS = ["measured_at", "last_measured", "measurement_time",
                          "last_reading", "date", "timestamp", "recorded_at"];

  const parseTime = (v) => {
    if (v == null) return null;
    const t = typeof v === "number" ? v * (v > 1e11 ? 1 : 1000) : Date.parse(String(v));
    return Number.isFinite(t) ? t : null;
  };

  /**
   * When was this actually measured?
   *
   * Neither `last_updated` nor `last_changed` answers this. Health sensors are
   * republished continuously — a nine-day-old blood pressure carries today's
   * `last_updated` — and both fields are reset by every HA restart anyway.
   *
   * Four strategies, best first. Each returns its source so the UI can say how
   * confident it is rather than pretending they are equivalent.
   */
  const measuredAt = (ent, opts) => {
    const a = ent.attributes || {};
    for (const k of MEASURED_ATTRS) {
      const t = parseTime(a[k]);
      if (t) return { at: t, via: "attribute:" + k };
    }

    /* A change-triggered input_datetime, the pattern Stride uses. Survives a
       restart, which is the whole point of it existing. */
    const stamp = opts && opts.stamp;
    if (stamp) {
      const t = parseTime(stamp.state);
      if (t) return { at: t, via: "stamp:" + stamp.entity_id };
    }

    /* Supplied by the caller from recorder statistics — the last bucket that
       held a value. Correct across restarts, but costs a websocket round trip,
       so the views fetch it once rather than per render. */
    if (opts && opts.statLast) return { at: opts.statLast, via: "statistics" };

    const t = parseTime(ent.last_changed);
    if (t) return { at: t, via: "last_changed", weak: true };
    return { at: null, via: "unknown" };
  };

  /**
   * Resolve every role against the instance.
   *
   * config.entities   { role: "sensor.x" }  explicit, always wins
   * config.stamps     { role: "input_datetime.x" }  measurement-time source
   * config.exclude    ["sensor.y"]  never consider these
   * opts.now          ms, injectable so tests are not clock-dependent
   * opts.statLast     { role: ms }  last statistics bucket per role
   *
   * Every role in the catalogue appears in the result, including the ones that
   * resolved to nothing — absent is a state the views render, not an omission.
   */
  MH.resolve = (states, config, opts) => {
    config = config || {};
    opts = opts || {};
    const now = opts.now || Date.now();
    const byId = {};
    const list = Array.isArray(states) ? states : Object.values(states || {});
    for (const e of list) byId[e.entity_id] = e;

    const exclude = new Set(config.exclude || []);
    const pinned = new Set(Object.values(config.entities || {}));
    const out = {};

    for (const role of MH.ROLES) {
      const wanted = (config.entities || {})[role.key];
      let ent = null, how = "absent", why = null, runnerUp = null, ambiguous = false;

      if (wanted) {
        ent = byId[wanted] || null;
        how = ent ? "config" : "missing";
        if (!ent) why = wanted + " is not in this instance";
      } else {
        let best = 0, tied = 0;
        for (const e of list) {
          if (exclude.has(e.entity_id)) continue;
          /* Something the user pinned to another role is spoken for. */
          if (pinned.has(e.entity_id)) continue;
          const s = score(e, role);
          if (s > best) { runnerUp = ent; best = s; ent = e; tied = 1; }
          else if (s > 0 && s === best) { runnerUp = e; tied++; }
        }
        how = ent ? "discovered" : "absent";
        /* Two candidates scored identically. No heuristic separates them, so
           say so rather than picking one and looking certain — the config UI
           asks, and until it is answered the first is used. */
        if (tied > 1) ambiguous = true;
      }

      const r = { role: role.key, label: role.label, tab: role.tab, how,
                  entity_id: ent ? ent.entity_id : null, why, ambiguous };

      if (ent) {
        const raw = ent.state;
        r.blank = blank(raw);
        r.value = r.blank ? null : (num(raw) != null ? num(raw) : raw);
        r.unit = (ent.attributes || {}).unit_of_measurement || null;
        r.friendly_name = (ent.attributes || {}).friendly_name || null;

        const stampId = (config.stamps || {})[role.key];
        const m = measuredAt(ent, { stamp: stampId ? byId[stampId] : null,
                                    statLast: (opts.statLast || {})[role.key] });
        r.measured_at = m.at;
        r.measured_via = m.via;
        r.age_days = m.at == null ? null : (now - m.at) / DAY;

        /* Three distinct states the design draws differently, and which must
           not be collapsed into one:
             absent  — no such entity here at all
             blank   — the entity exists but holds no reading
             stale   — a real reading, too old to present as current (GAP)
           A fourth, `unknown_age`, is the day-one case: a stamp exists but has
           never fired because the value has not changed since it was installed.
           Showing GAP there would be a lie about the data, not about the age. */
        r.stale = false;
        r.unknown_age = false;
        if (!r.blank && role.window != null) {
          if (r.age_days == null) r.unknown_age = true;
          else if (m.weak) r.unknown_age = true;
          else r.stale = r.age_days > role.window;
        }
        if (runnerUp) r.runner_up = runnerUp.entity_id;
      } else {
        r.blank = true;
        r.value = null;
        r.stale = false;
        r.unknown_age = false;
      }

      out[role.key] = r;
    }

    return out;
  };

  /** Which tabs have anything worth showing. A user with only a scale gets
   *  Body, and no empty Heart tab. */
  MH.liveTabs = (resolved) => {
    const live = {};
    for (const k in resolved) {
      const r = resolved[k];
      if (r.entity_id && !r.blank) live[r.tab] = true;
    }
    return MH.TABS.filter((t) => live[t]);
  };

  /** A one-line-per-role account of what was found, for the config UI and for
   *  tools/resolve_check.js. Kept in the card rather than the harness so what
   *  the user is shown and what the tests assert are the same text. */
  MH.explain = (resolved) => {
    const rows = [];
    for (const role of MH.ROLES) {
      const r = resolved[role.key];
      let state = r.how;
      if (r.how !== "absent" && r.how !== "missing") {
        if (r.blank) state += " · blank";
        else if (r.stale) state += " · GAP";
        else if (r.unknown_age) state += " · age?";
      }
      if (r.ambiguous) state += " · ambiguous";
      rows.push({
        role: role.key,
        entity: r.entity_id || "—",
        state,
        value: r.value == null ? "—" : String(r.value).slice(0, 22),
        age: r.age_days == null ? "—" : r.age_days.toFixed(1) + "d",
        via: r.measured_via || "—",
        runner_up: r.runner_up || null
      });
    }
    return rows;
  };

  /* ------------------------------------------------------------------ *
   * Exit
   * ------------------------------------------------------------------ *
   *
   * The same file has to run in two places: as a HACS resource in the browser,
   * and under node in tools/resolve_check.js. The resolver is deliberately
   * pure — states in, resolution out, no `hass`, no DOM — so the harness tests
   * the shipped code rather than a copy of it.
   */

  if (typeof window !== "undefined") {
    window.MyHealthDashboard = MH;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = MH;
  }
})();

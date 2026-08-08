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

  /**
   * A state as a number, or null if it is not one.
   *
   * The whole string has to be numeric. `parseFloat` stops at the first
   * character it cannot use, which quietly turned the state
   * `2026-08-07T09:56:59Z` into the number `2026` — so `workout_start` carried
   * a year where the Today card expected a workout time, and it looked like a
   * plausible value rather than an error.
   */
  const num = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (v == null) return null;
    const s = String(v).trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
    const n = parseFloat(s);
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
   *   stamp    name hints for an existing change-triggered input_datetime that
   *            records when this metric was last really measured. See
   *            04-freshness.js — most roles do not need one, because statistics
   *            answer the question without any extra plumbing.
   *   group    roles that describe one single event, and must therefore all
   *            come from the same source. Resolved together — see the
   *            coherence pass in 03-resolve.js.
   *   timestamp  the state is itself a time, so it is its own measurement age
   *            and needs none of the machinery in 04-freshness.js.
   *   domain   a regex the entity id must match, for roles that are actions
   *            rather than readings. Defaults to the readable domains.
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
      stamp: [["weigh", "in"], ["weight"], ["weighin"]],
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
      stamp: [["bp"], ["blood", "pressure"], ["systolic"]],
      match: { units: ["mmHg"], any: [["systolic"]] } },

    { key: "diastolic", label: "Diastolic", tab: "heart", unit: "mmHg", window: 14,
      stamp: [["bp"], ["blood", "pressure"], ["diastolic"]],
      match: { units: ["mmHg"], any: [["diastolic"]] } },

    /* Pulse taken by the BP cuff, at the same moment as the reading above.
     * Distinct from resting_hr, which the watch computes overnight. */
    { key: "cuff_pulse", label: "Pulse at reading", tab: "heart", unit: "bpm", window: 14,
      stamp: [["bp"], ["blood", "pressure"]],
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
     * A source with no rings simply resolves nothing and the card hides.
     *
     * Every `*_goal` here is `window: null`, like `weight_goal` and
     * `step_goal`. A goal is a setting, not a measurement: it is *supposed* to
     * sit unchanged for months, so ageing it against the ring's one-day window
     * marked all three GAP on this instance while the rings beside them were
     * minutes old. Staleness of the ring is what the freshness rule is for; the
     * goal has no measurement time to be stale about. */
    { key: "move_ring", label: "Move", tab: "today", unit: "kcal", window: 1,
      match: { units: ["kcal"], any: [["move", "ring"], ["move"]], not: ["goal"] } },
    { key: "move_goal", label: "Move goal", tab: "today", unit: "kcal", window: null,
      match: { units: ["kcal"], any: [["move", "goal"]] } },

    { key: "exercise_ring", label: "Exercise", tab: "today", unit: "min", window: 1,
      match: { units: ["min"], any: [["exercise", "ring"], ["exercise", "minutes"]], not: ["goal"] } },
    { key: "exercise_goal", label: "Exercise goal", tab: "today", unit: "min", window: null,
      match: { units: ["min"], any: [["exercise", "goal"]] } },

    /* Stand is counted in hours. `stand_time` is the same idea in minutes and
       is the fallback, so the unit hint does real work here. */
    { key: "stand_ring", label: "Stand", tab: "today", unit: "h", window: 1,
      match: { units: ["h"], any: [["stand", "ring"], ["stand", "hours"], ["stand", "time"]],
               not: ["goal"] } },
    { key: "stand_goal", label: "Stand goal", tab: "today", unit: "h", window: null,
      match: { units: ["h"], any: [["stand", "goal"]] } },

    /* --- Today: last workout ---------------------------------------- *
     * These six describe *one event*, so they carry `group: "last_workout"`
     * and are resolved together from a single source. Left to resolve
     * independently they did not: on this instance the type came from Withings
     * (a 41-minute walk) while duration, energy and both heart rates came from
     * Apple Health (a 27-minute one), and the card would have rendered a
     * confident summary of a workout that never happened. */
    { key: "workout_type", label: "Last workout type", tab: "today", unit: null, window: 14,
      group: "last_workout",
      match: { any: [["last", "workout", "type"], ["last", "workout"]],
               not: ["distance", "duration", "energy", "climb", "hr", "start", "calories", "intensity"] } },
    { key: "workout_duration", label: "Last workout duration", tab: "today", unit: "min", window: 14,
      group: "last_workout",
      match: { any: [["last", "workout", "duration"]] } },
    { key: "workout_energy", label: "Last workout calories", tab: "today", unit: "kcal", window: 14,
      group: "last_workout",
      match: { any: [["last", "workout", "energy"], ["last", "workout", "calories"],
                     ["calories", "burnt", "last", "workout"]] } },
    { key: "workout_hr_avg", label: "Last workout average HR", tab: "today", unit: "bpm", window: 14,
      group: "last_workout",
      match: { any: [["last", "workout", "hr", "average"], ["workout", "hr", "avg"]] } },
    { key: "workout_hr_max", label: "Last workout peak HR", tab: "today", unit: "bpm", window: 14,
      group: "last_workout",
      match: { any: [["last", "workout", "hr", "max"], ["workout", "hr", "peak"]] } },
    { key: "workout_start", label: "Last workout time", tab: "today", unit: null, window: 14,
      group: "last_workout", timestamp: true,
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

    /* The one role that is a verb rather than a reading: the script that asks
       the coach a question. Domain-restricted to `script`, which is why
       `domain` exists at all — every other role would be actively harmed by
       resolving one.

       Absent is the ordinary case. Nothing about this dashboard requires a
       coach, and an instance without one simply has no Ask box. */
    { key: "coach_ask", label: "Ask the coach", tab: "today", unit: null, window: null,
      domain: /^script\./,
      match: { any: [["coach"]], not: ["personality"] } },
    { key: "medication_logged", label: "Medication logged today", tab: "today", unit: null, window: 1,
      match: { any: [["medication", "logged"], ["medication"]] } },

    /* --- Sync freshness --------------------------------------------- *
     * Drives the `SYNCED 40S AGO` chip. Unlike every other role this one is
     * *about* time, so its state is a timestamp rather than a measurement. */
    { key: "last_sync", label: "Last sync", tab: "today", unit: null, window: 1,
      timestamp: true,
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
    /* Most roles are readings, and a reading can only come from a domain that
       holds one — `automation.stride_bp_reminder` contains the token "bp" and
       must never resolve as a blood pressure. A few roles are *actions*
       instead, and those name the domain they want. */
    if (!(role.domain || READABLE).test(ent.entity_id)) return 0;
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

  /**
   * Which source an entity came from, inferred from its id.
   *
   * There is no integration name in `/api/states`, so take the entity id and
   * remove the tokens the role matched on. What is left is the part that names
   * the source rather than the metric:
   *
   *   sensor.apple_health_last_workout_energy              -> apple_health
   *   sensor.bedroom_withings_calories_burnt_last_workout
   *                                                        -> bedroom_withings
   *
   * Every token from every one of the role's name groups is dropped, not just
   * the group that matched, so two sources naming the same metric differently
   * ("energy" vs "calories burnt") still reduce to the same key.
   */
  const sourceKey = (ent, role) => {
    const drop = new Set();
    for (const grp of ((role.match || {}).any) || []) for (const t of grp) drop.add(t);
    return tokens(ent.entity_id).filter((t) => !drop.has(t)).join("_") || "?";
  };

  /**
   * Resolve a group of roles that describe a single event, together.
   *
   * Scoring each role independently is right for unrelated metrics and wrong
   * here: the best `workout_type` on this instance is Withings' and the best
   * `workout_duration` is Apple Health's, and combining them describes a
   * workout that did not take place. So score every candidate for every role in
   * the group, bucket by source, and let one source take the whole group.
   *
   * The winner is the source that can fill the most roles — an integration
   * describing five parts of an event is more likely to be describing the event
   * you mean than one that knows two. Total score breaks a tie.
   *
   * A role the winning source cannot fill resolves to absent. That is the
   * point: a gap in one honest account beats a complete but invented one.
   */
  const resolveGroups = (list, exclude, pinned, config) => {
    const groups = {};
    for (const role of MH.ROLES) {
      if (!role.group) continue;
      /* A role pinned in config is the user's business and is left alone; the
         rest of its group still resolves coherently around it. */
      if ((config.entities || {})[role.key]) continue;
      (groups[role.group] = groups[role.group] || []).push(role);
    }

    const chosen = {}, sources = {};
    for (const g in groups) {
      const bySource = {};
      for (const role of groups[g]) {
        for (const e of list) {
          if (exclude.has(e.entity_id) || pinned.has(e.entity_id)) continue;
          const s = score(e, role);
          if (!s) continue;
          const key = sourceKey(e, role);
          const b = bySource[key] = bySource[key] || {};
          if (!b[role.key] || s > b[role.key].score) b[role.key] = { ent: e, score: s };
        }
      }

      let best = null;
      for (const key in bySource) {
        const keys = Object.keys(bySource[key]);
        const cover = keys.length;
        const total = keys.reduce((n, k) => n + bySource[key][k].score, 0);
        if (!best || cover > best.cover || (cover === best.cover && total > best.total)) {
          best = { key, cover, total, roles: bySource[key] };
        }
      }
      if (!best) continue;

      sources[g] = { source: best.key, covers: best.cover, of: groups[g].length,
                     rejected: Object.keys(bySource).filter((k) => k !== best.key) };
      for (const role of groups[g]) {
        chosen[role.key] = best.roles[role.key] ? best.roles[role.key].ent : null;
      }
    }
    return { chosen, sources };
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

    /* Some sensors *are* the answer: `sensor.apple_health_last_workout_start`
       holds `2026-08-07T09:56:59Z` and `last_sync` is `device_class: timestamp`.
       Reading the state is exact and free, and beats every estimate below — but
       only where the role says the state is a time, or the integration declares
       it. Sniffing any parseable state would date a weight of `71.2` to 1998. */
    if (a.device_class === "timestamp" || (opts && opts.stateIsTime)) {
      const t = parseTime(ent.state);
      if (t && !blank(ent.state)) return { at: t, via: "state" };
    }

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

    /* The value did not move anywhere in the statistics window, so the reading
       is *at least* this old. A bound, not a time — but still better evidence
       than last_changed, which a restart makes worthless. Ordered accordingly:
       "I know it is at least 45 days old" beats "I have no idea". */
    if (opts && opts.floor != null) return { floor: opts.floor, via: "statistics-floor" };

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

    /* Single-event roles are decided as a group before anything else, so the
       loop below only has to honour the decision. */
    const grouped = resolveGroups(list, exclude, pinned, config);
    const out_sources = grouped.sources;

    for (const role of MH.ROLES) {
      const wanted = (config.entities || {})[role.key];
      let ent = null, how = "absent", why = null, runnerUp = null, ambiguous = false;

      if (wanted) {
        ent = byId[wanted] || null;
        how = ent ? "config" : "missing";
        if (!ent) why = wanted + " is not in this instance";
      } else if (role.group && role.key in grouped.chosen) {
        ent = grouped.chosen[role.key];
        how = ent ? "discovered" : "absent";
        if (!ent) {
          const g = out_sources[role.group];
          why = g ? "not published by " + g.source + ", which supplies the rest of this workout"
                  : null;
        }
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

      /* Carried per role rather than as a top-level key: callers iterate the
         result as "one entry per role", and a stray entry would break them. */
      if (role.group && out_sources[role.group]) {
        r.group = role.group;
        r.group_source = out_sources[role.group].source;
      }

      if (ent) {
        const raw = ent.state;
        r.blank = blank(raw);
        r.value = r.blank ? null : (num(raw) != null ? num(raw) : raw);
        r.unit = (ent.attributes || {}).unit_of_measurement || null;
        r.friendly_name = (ent.attributes || {}).friendly_name || null;
        /* Some roles carry their content in attributes rather than in the
           state: `sensor.stride_coach` is a 255-character state with the real
           headline and body beside it. */
        r.attributes = ent.attributes || {};

        const stampId = (config.stamps || {})[role.key];
        const m = measuredAt(ent, { stamp: stampId ? byId[stampId] : null,
                                    statLast: (opts.statLast || {})[role.key],
                                    floor: (opts.floors || {})[role.key],
                                    stateIsTime: role.timestamp === true });
        r.measured_at = m.at != null ? m.at : null;
        r.measured_via = m.via;
        r.age_days = m.at == null ? null : (now - m.at) / DAY;
        r.age_floor_days = m.floor == null ? null : m.floor / DAY;

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
          if (r.age_days == null) {
            /* A floor past the window is enough to know the reading is stale,
               even without knowing its exact age. Short of the window it
               settles nothing. */
            r.unknown_age = true;
            if (r.age_floor_days != null && r.age_floor_days > role.window) r.stale = true;
          } else if (m.weak) r.unknown_age = true;
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

    applyGroupAge(out, now);
    return out;
  };

  /**
   * One event, one time.
   *
   * A grouped role whose state is a timestamp knows exactly when the event
   * happened, and every other role in that group is describing the *same*
   * event — so they share its age rather than each estimating one. This is the
   * freshness half of the coherence rule, and it repairs the two weakest
   * answers in the group: `workout_type` had only `last_changed`, and
   * `workout_duration` read 2 days old because 27 minutes was also the duration
   * of the workout before it (see the conservatism note in 04-freshness.js),
   * while `workout_start` says plainly that it was this morning.
   */
  const applyGroupAge = (out, now) => {
    const anchor = {};
    for (const role of MH.ROLES) {
      if (!role.group || !role.timestamp) continue;
      const r = out[role.key];
      if (r && r.measured_at != null && r.measured_via === "state") {
        anchor[role.group] = { at: r.measured_at, from: role.key };
      }
    }

    for (const role of MH.ROLES) {
      const a = role.group && anchor[role.group];
      if (!a) continue;
      const r = out[role.key];
      if (!r || !r.entity_id || r.blank || r.measured_at === a.at) continue;

      r.measured_at = a.at;
      r.measured_via = "group:" + a.from;
      r.age_days = (now - a.at) / DAY;
      r.age_floor_days = null;
      r.unknown_age = false;
      r.stale = role.window != null && r.age_days > role.window;
    }
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
        age: r.age_days != null ? r.age_days.toFixed(1) + "d"
           : r.age_floor_days != null ? "≥" + r.age_floor_days.toFixed(0) + "d"
           : "—",
        via: r.measured_via || "—",
        runner_up: r.runner_up || null
      });
    }
    return rows;
  };

  /* ------------------------------------------------------------------ *
   * Freshness — recovering a real measurement time
   * ------------------------------------------------------------------ *
   *
   * The problem this file exists for: a health sensor republishes its last
   * value forever, so nothing on the entity tells you when the reading was
   * actually taken. `last_updated` is now. `last_changed` is also now, because
   * a restart reset it.
   *
   * Long-term statistics survive restarts, and a value that has not moved
   * cannot have been measured since it last moved. So walking hourly buckets
   * backwards to where the value last differed gives a real measurement time,
   * with no new automations and no cooperation from the integration.
   *
   * Checked against the live instance before this was written: weight resolved
   * to 4.1 days by this method and 4.1 days by Stride's independent stamp
   * automation. Two mechanisms, one answer.
   *
   * Two ways it is deliberately conservative:
   *
   *   1. Two consecutive readings of the same value are indistinguishable from
   *      one reading held. Weighing 71.2 twice in a week reports the older of
   *      the two. That errs towards looking staler than it is, which is the
   *      safe direction — a dashboard that overstates freshness is the failure
   *      worth avoiding.
   *
   *   2. If the value never changes across the whole window, this returns a
   *      *floor* ("at least 45 days") and not a time. Blood pressure on the
   *      live instance does exactly that. A floor is not an answer and must
   *      never be rendered as one.
   */

  /**
   * @param series  [{ start: ms, mean: number|null }]  ascending, from recorder
   * @param now     ms
   * @returns { at, via } when the change is inside the window
   *          { floor, via } when it is not — an age of *at least* this
   *          null when there is nothing to go on
   */
  MH.ageFromStatistics = (series, now) => {
    if (!series || !series.length) return null;
    const pts = series.filter((p) => p && p.mean != null);
    if (!pts.length) return null;

    const current = pts[pts.length - 1].mean;
    /* Walk back to the last bucket that held something else. The measurement
       is the *following* bucket — the first one carrying the current value —
       not the differing one, which predates the change. */
    for (let i = pts.length - 1; i >= 0; i--) {
      if (Math.abs(pts[i].mean - current) > 1e-9) {
        return { at: pts[i + 1] ? pts[i + 1].start : pts[i].start, via: "statistics" };
      }
    }
    return { floor: now - pts[0].start, via: "statistics-floor" };
  };

  /**
   * Find an existing change-triggered stamp for a role.
   *
   * Stride ships `input_datetime.stride_last_bp` and `stride_last_weigh_in`,
   * written by automations that fire only when the value actually changes.
   * Any instance may have its own; match them by name rather than requiring
   * the user to wire each one up.
   */
  MH.findStamps = (states) => {
    const list = Array.isArray(states) ? states : Object.values(states || {});
    const stamps = list.filter((e) => e.entity_id.startsWith("input_datetime.") &&
                                      /_last_|_last$|^input_datetime\.last_/.test(e.entity_id));
    const out = {};
    for (const role of MH.ROLES) {
      const hints = role.stamp;
      if (!hints) continue;
      for (const e of stamps) {
        const toks = tokens(e.entity_id);
        if (hints.some((g) => g.every((t) => toks.includes(t)))) {
          out[role.key] = e.entity_id;
          break;
        }
      }
    }
    return out;
  };

  /**
   * Roles whose age cannot be established any other way, and which therefore
   * want a stamp automation installed. Reported rather than acted on — the
   * card does not write automations into someone's instance on its own.
   */
  MH.needsStamp = (resolved) =>
    MH.ROLES.filter((role) => {
      const r = resolved[role.key];
      return r && r.entity_id && !r.blank && role.window != null &&
             (r.unknown_age || r.measured_via === "last_changed");
    }).map((role) => ({ role: role.key, label: role.label,
                        entity_id: resolved[role.key].entity_id }));

  /**
   * Fetch measurement ages for every resolved role, over the websocket.
   *
   * One call for all roles, not one per card: `statistics_during_period`
   * accepts a list, and this runs on view mount rather than on every state
   * change. `hass.callWS` is the frontend's own websocket, so no token and no
   * second connection.
   *
   * Returns { role: ms } suitable for passing straight back in as
   * `opts.statLast`, plus a `floors` map for the roles that only yielded a
   * lower bound.
   */
  MH.fetchAges = async (hass, resolved, opts) => {
    opts = opts || {};
    const days = opts.days || 120;
    const now = opts.now || Date.now();
    const ids = [], roleOf = {};
    for (const key in resolved) {
      const r = resolved[key];
      if (!r.entity_id || r.blank) continue;
      /* A stamp already answered this one properly. */
      if (r.measured_via && r.measured_via.indexOf("stamp:") === 0) continue;
      if (ids.indexOf(r.entity_id) < 0) ids.push(r.entity_id);
      (roleOf[r.entity_id] = roleOf[r.entity_id] || []).push(key);
    }
    if (!ids.length) return { at: {}, floors: {} };

    let res;
    try {
      res = await hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(now - days * DAY).toISOString(),
        statistic_ids: ids,
        period: "hour",
        types: ["mean"]
      });
    } catch (e) {
      /* No recorder, or statistics disabled for these sensors. The resolver
         already degrades to "age unknown"; this is not an error state. */
      return { at: {}, floors: {}, error: String(e) };
    }

    const at = {}, floors = {};
    for (const id in res) {
      const got = MH.ageFromStatistics(res[id], now);
      if (!got) continue;
      for (const key of roleOf[id] || []) {
        if (got.at != null) at[key] = got.at;
        else if (got.floor != null) floors[key] = got.floor;
      }
    }
    return { at, floors };
  };

  /* ------------------------------------------------------------------ *
   * Formatting, units and clinical bands
   * ------------------------------------------------------------------ *
   *
   * Kept pure and free of the DOM so the harness can assert it. Everything
   * here turns a resolved role into something a human reads, and the rules
   * about *what may be shown at all* live here rather than in the views:
   * `MH.readable()` is the single gate that stops a stale or unknown-age
   * reading being rendered as though it were current.
   */

  /**
   * 8432 -> "8,432". Mono digits, so grouping is what makes it scannable.
   *
   * An explicit `dp` is held exactly, trailing zero and all: 2.974 km at one
   * decimal is "3.0 km", not "3 km". Dropping the zero silently restates a
   * measurement to a precision it was not taken at.
   */
  const group = (n, dp) => {
    if (n == null || !Number.isFinite(n)) return "—";
    const [i, f] = (dp == null ? n.toString() : n.toFixed(dp)).split(".");
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
  };

  MH.group = group;

  /* Unit conversion. A role declares its canonical unit and a source in
     another one is converted rather than relabelled — showing `216` beside
     "kg" because the scale reports pounds is exactly the class of quiet
     wrongness this card exists to avoid. */
  const CONVERT = {
    "lb>kg": (v) => v * 0.45359237,
    "st>kg": (v) => v * 6.35029318,
    "kg>lb": (v) => v / 0.45359237,
    "mi>km": (v) => v * 1.609344,
    "m>km": (v) => v / 1000,
    "km>m": (v) => v * 1000,
    "ft>m": (v) => v * 0.3048,
    "min>h": (v) => v / 60,
    "h>min": (v) => v * 60,
    "s>min": (v) => v / 60,
    "cal>kcal": (v) => v,
    "calories>kcal": (v) => v
  };

  MH.convert = (value, from, to) => {
    if (value == null || !to || !from || from === to) return value;
    const f = CONVERT[from + ">" + to];
    return f ? f(value) : value;
  };

  /** A role's value in the role's own unit, converted if the source differs. */
  MH.valueIn = (r) => {
    const role = MH.ROLE_BY_KEY[r.role] || {};
    if (typeof r.value !== "number") return r.value;
    return MH.convert(r.value, r.unit, role.unit);
  };

  /* ------------------------------------------------------------------ *
   * Time
   * ------------------------------------------------------------------ */

  /** "40s", "13 hours", "9 days" — the unit the design uses at each scale. */
  MH.relTime = (ms, now) => {
    if (ms == null) return null;
    const s = Math.max(0, ((now || Date.now()) - ms) / 1000);
    if (s < 45) return Math.round(s) + "s";
    const m = s / 60;
    if (m < 45) return Math.round(m) + (Math.round(m) === 1 ? " minute" : " minutes");
    const h = m / 60;
    if (h < 22) return Math.round(h) + (Math.round(h) === 1 ? " hour" : " hours");
    const d = h / 24;
    if (d < 30) return Math.round(d) + (Math.round(d) === 1 ? " day" : " days");
    const mo = d / 30.44;
    if (mo < 18) return Math.round(mo) + (Math.round(mo) === 1 ? " month" : " months");
    return Math.round(d / 365.25) + " years";
  };

  /** The `9 DAYS AGO` eyebrow, and its two honest alternatives. */
  MH.ageLabel = (r, now) => {
    if (!r || !r.entity_id || r.blank) return null;
    if (r.measured_at != null) return MH.relTime(r.measured_at, now) + " ago";
    if (r.age_floor_days != null) return "over " + Math.floor(r.age_floor_days) + " days ago";
    return "age unknown";
  };

  /* "AUGUST 2026" style month, used by the gap copy — "No reading since
     April 2026" has to name a month, not a relative distance. */
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                  "August", "September", "October", "November", "December"];
  MH.monthYear = (ms) => {
    if (ms == null) return null;
    const d = new Date(ms);
    return MONTHS[d.getMonth()] + " " + d.getFullYear();
  };

  /* ------------------------------------------------------------------ *
   * What may be shown
   * ------------------------------------------------------------------ *
   *
   * The rule the whole product turns on, in one function. A reading is
   * readable only when it exists *and* is known to be current. Stale and
   * unknown-age both fall through to the designed GAP treatment — a value with
   * no trustworthy age is not a value you may print in 52px mono.
   */
  MH.readable = (r) =>
    !!(r && r.entity_id && !r.blank && !r.stale && !r.unknown_age && r.value != null);

  /**
   * A weaker gate, for supporting figures rather than headline readings.
   *
   * The design's rule is that a sparse metric "stays visible but is dimmed",
   * not that it disappears — so dropping the treadmill's weekly distance
   * because nothing can date it loses a number the user does have. `readable`
   * still guards anything rendered as a current clinical value; `showable`
   * lets a supporting stat appear, dimmed, with its uncertainty stated.
   */
  MH.showable = (r) =>
    !!(r && r.entity_id && !r.blank && !r.stale && r.value != null);

  /** Why a card is in its gap state, in the design's own voice. */
  MH.gapReason = (r, now) => {
    if (!r || !r.entity_id) return "Not available from any source here";
    if (r.blank) return "No reading yet";
    if (r.stale && r.measured_at != null) {
      return "No reading since " + MH.monthYear(r.measured_at);
    }
    if (r.stale && r.age_floor_days != null) {
      return "No reading in over " + Math.floor(r.age_floor_days) + " days";
    }
    if (r.unknown_age) return "Age of this reading is unknown";
    return "No reading";
  };

  /* ------------------------------------------------------------------ *
   * Clinical bands
   * ------------------------------------------------------------------ *
   *
   * Colour carries meaning here, so the band is computed from the reading and
   * never hardcoded per card. Thresholds are the ACC/AHA 2017 categories, the
   * ones the design's NORMAL / ELEVATED / STAGE 1 / STAGE 2 axis is labelled
   * with. Systolic and diastolic are assessed separately and the worse of the
   * two wins, which is how the guideline reads.
   */
  const BP_BANDS = [
    { key: "normal", label: "Normal", tone: "good" },
    { key: "elevated", label: "Elevated", tone: "warn" },
    { key: "stage1", label: "Stage 1", tone: "warn" },
    { key: "stage2", label: "Stage 2", tone: "bad" }
  ];

  MH.bpBand = (sys, dia) => {
    if (sys == null && dia == null) return null;
    let i = 0;
    if (sys != null) {
      if (sys >= 140) i = 3;
      else if (sys >= 130) i = 2;
      else if (sys >= 120) i = 1;
    }
    if (dia != null) {
      /* Diastolic has no "elevated" band — 80 is already stage 1. */
      const j = dia >= 90 ? 3 : dia >= 80 ? 2 : 0;
      if (j > i) i = j;
    }
    return BP_BANDS[i];
  };

  /** Resting heart rate, read as a fitness signal rather than a diagnosis. */
  MH.hrBand = (bpm) => {
    if (bpm == null) return null;
    if (bpm < 60) return { key: "good", label: "Good", tone: "good" };
    if (bpm < 75) return { key: "normal", label: "Normal", tone: "good" };
    if (bpm < 90) return { key: "high", label: "Raised", tone: "warn" };
    return { key: "veryhigh", label: "High", tone: "bad" };
  };

  MH.spo2Band = (pct) => {
    if (pct == null) return null;
    if (pct >= 95) return { key: "normal", label: "Normal", tone: "good" };
    if (pct >= 91) return { key: "low", label: "Low", tone: "warn" };
    return { key: "verylow", label: "Very low", tone: "bad" };
  };

  /** Progress against a goal, clamped for the bar but reported honestly. */
  MH.progress = (value, goal) => {
    if (value == null || !goal) return null;
    const ratio = value / goal;
    return { ratio, pct: Math.max(0, Math.min(1, ratio)) * 100, met: ratio >= 1 };
  };

  /* ------------------------------------------------------------------ *
   * Style
   * ------------------------------------------------------------------ *
   *
   * The handoff's tokens, verbatim, as custom properties. They are declared
   * on the card's own shadow root rather than taken from the HA theme: this
   * design's colours carry clinical meaning — green is "in range", red is
   * "stage 2" — and a user's theme must not be able to repaint a blood
   * pressure reading green.
   *
   * The dark palette is option 2b from the handoff's exploration file, applied
   * to the same token names so nothing downstream branches on theme.
   *
   * Fonts are the HA theme's stack rather than Google Fonts: a HACS card must
   * not fetch from a third party. IBM Plex is used when the instance already
   * has it, which HA themes commonly do.
   */

  /* Option 2b from the handoff's exploration file. Written once and applied
     through both selectors below, so the two paths into dark mode cannot
     drift apart. */
  const DARK_TOKENS = `
    --chrome: #0a1420;
    --page: #0a1420;
    --surface: #101d2c;
    --sunken: #0d1826;
    --tile: #142234;
    --border: #1e2f42;
    --rule: #1a2836;
    --ink: #eaf2fa;
    --ink-2: #c3d2df;
    --ink-muted: #8496a8;
    --ink-faint: #6f8093;
    --green: #16c397;
    --green-light: #1e5f4c;
    --green-tint: #102e27;
    --green-tint-2: #0d2620;
    --green-border: #1c4a3d;
    --green-deep: #16c397;
    --teal: #16c397;
    --blue: #4da3ff;
    --red: #ff5c7a;
    --red-text: #ff8098;
    --red-tint: #2a1420;
    --red-border: #4a2130;
    --coral: #ff5c7a;
    --amber: #ffb84d;
    --amber-deep: #ffb84d;
    --amber-tint: #2a2113;
    --amber-tint-2: #241c11;
    --amber-border: #4a3a1c;
    --amber-border-2: #4a3a1c;
    --gold: #ffb84d;
    --dim-ink: #5c6b7a;
    --dim-border: #22303f;
    --chrome-inactive: #8fa3b4;
    --amber-ink: #ffb84d;
    --amber-ink-2: #c3d2df;
    --ring-track: #1c2a3a;
  `;

  /* Two ways in, because a HACS card has two masters. Home Assistant decides
     dark from the user's *theme*, which the card reads off
     `hass.themes.darkMode` and stamps onto the host — that is authoritative
     and wins. Outside HA (tools/preview.html, or a bare page) there is no
     theme to ask, so the OS preference stands in unless the host has been
     stamped light. */
  const DARK_SELECTORS = [
    [':host([data-theme="dark"])', ""],
    ['@media (prefers-color-scheme: dark) { :host(:not([data-theme="light"]))', "}"]
  ];
  const DARK_CSS = DARK_SELECTORS
    .map(([sel, close]) => sel + " {" + DARK_TOKENS + "}" + close)
    .join("\n");

  MH.CSS = `
:host {
  --chrome: #0d2233;
  --page: #f2f5f4;
  --surface: #ffffff;
  --sunken: #fbfcfb;
  --tile: #f7faf9;
  --border: #e3e8e6;
  --rule: #eef2ef;
  --ink: #14201b;
  --ink-2: #4d5a53;
  --ink-muted: #6d7a74;
  --ink-faint: #8a978f;
  --green: #0f9c72;
  --green-light: #b9d9cc;
  --green-tint: #e2f4ed;
  --green-tint-2: #f1faf6;
  --green-border: #cde9de;
  --green-deep: #0f6d52;
  --teal: #16c397;
  --blue: #2f7fc4;
  --red: #c0334d;
  --red-text: #a02940;
  --red-tint: #fbeef0;
  --red-border: #f2c9d1;
  --coral: #e2445c;
  --amber: #d98a11;
  --amber-deep: #a07a24;
  --amber-tint: #fff8ec;
  --amber-tint-2: #fdf3e2;
  --amber-border: #f0d9ae;
  --amber-border-2: #ecd4a6;
  --gold: #d99b2b;
  --dim-ink: #a3aea7;
  --dim-border: #d6ddd9;
  --chrome-inactive: #8fa3b4;
  --amber-ink: #5c3f09;
  --amber-ink-2: #8a6a2a;
  --ring-track: #efeeee;

  --sans: "IBM Plex Sans", var(--paper-font-body1_-_font-family, system-ui),
          -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;

  display: block;
  background: var(--page);
  color: var(--ink);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
}

${DARK_CSS}

* { box-sizing: border-box; }

/* --- chrome ------------------------------------------------------- */
.bar {
  position: sticky; top: 0; z-index: 5;
  background: var(--chrome); height: 60px;
  /* Measured against itself, so the rule below holds however wide the
     viewport claims to be. */
  container-type: inline-size;
}
/* The sync chip is the least important thing in the bar and the first to go:
   without this it kept its ~110px and pushed Movement off the end of a
   scrollable tab strip, where nothing suggested it was still there. The dot
   stays, so "when did this last sync" is still answerable at a glance. */
@container (max-width: 560px) {
  .sync-text { display: none; }
}
.bar-inner {
  max-width: 1360px; margin: 0 auto; padding: 0 32px;
  height: 100%; display: flex; align-items: center;
  justify-content: space-between; gap: 16px; min-width: 0;
}
/* A flex item will not shrink below its content unless told it may, and four
   tabs plus a SYNCED chip is wider than a phone. Without these the whole page
   inherited that width and every card was clipped at the right edge. */
.tabs { display: flex; height: 100%; min-width: 0; overflow-x: auto;
        scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tab {
  font-size: 15px; font-weight: 600; padding: 0 16px;
  height: 100%; display: flex; align-items: center;
  cursor: pointer; color: var(--chrome-inactive);
  border-bottom: 2px solid transparent;
  background: none; border-top: 0; border-left: 0; border-right: 0;
  font-family: inherit;
}
.tab[aria-selected="true"] { color: #fff; border-bottom-color: var(--teal); }
.tab:focus-visible { outline: 2px solid var(--teal); outline-offset: -4px; }

.sync { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 0 1 auto; }
.sync-text {
  font-family: var(--mono); font-size: 12px; letter-spacing: .08em;
  color: var(--chrome-inactive); text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}

.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); flex: none; }
.dot.pulse { animation: pulseDot 2s ease-in-out infinite; }
.dot.amber { background: var(--amber); width: 9px; height: 9px; }
.dot.green { background: var(--green); }

/* --- view --------------------------------------------------------- */
.view {
  max-width: 1360px; margin: 0 auto; padding: 28px 32px 56px;
  display: flex; flex-direction: column; gap: 16px;
}
/* Column counts follow the space available, not the viewport.
   auto-fit plus minmax reflows on the width the row actually has, so a card
   embedded in a narrow column collapses correctly even where a viewport media
   query never fires — which is what happens in the Home Assistant companion
   app. The min(100%, N) guard is what stops the track being wider than its
   container when there is less than N to give it; without it a narrow parent
   overflows instead of dropping to one column. */
.row { display: grid; gap: 16px; align-items: start; }
.row.hero { grid-template-columns: minmax(0, 1fr) minmax(0, 380px); }
.row.four { grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
.row.two { grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); }

@media (max-width: 1100px) {
  .row.hero, .row.four, .row.two { grid-template-columns: 1fr; }
  .bar-inner, .view { padding-left: 20px; padding-right: 20px; }
}
@media (max-width: 1100px) and (min-width: 700px) {
  .row.four { grid-template-columns: repeat(2, 1fr); }
}

/* --- cards -------------------------------------------------------- */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 18px 20px;
  animation: cardIn .45s ease both;
}
.card.hero { border-radius: 16px; padding: 26px 30px; }
.card.gap { opacity: .5; }

.eyebrow {
  font-family: var(--mono); font-size: 11px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink-faint);
}
.title { font-size: 15px; font-weight: 600; color: var(--ink); }
.metric {
  font-family: var(--mono); font-size: 32px; font-weight: 600;
  color: var(--ink); line-height: 1.1; letter-spacing: -.01em;
}
.metric .unit { font-size: 15px; font-weight: 500; color: var(--ink-muted); margin-left: 4px; }
.support { font-size: 13px; color: var(--ink-muted); }
.body { font-size: 15px; line-height: 1.65; color: var(--ink-2);
        text-wrap: pretty; overflow-wrap: anywhere; }

.badge {
  font-family: var(--mono); font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .06em;
  border-radius: 20px; padding: 3px 8px; white-space: nowrap;
}
.badge.good { background: var(--green-tint); color: var(--green-deep); }
.badge.warn { background: var(--amber-tint-2); color: var(--amber-deep); }
.badge.bad  { background: var(--red); color: #fff; }
.badge.gap  { border: 1px solid var(--dim-border); color: var(--ink-muted); }

.head { display: flex; align-items: center; justify-content: space-between;
        gap: 8px 12px; flex-wrap: wrap; }

/* Vitals cards carry their status in a 3px top border. */
.card.vital { border-top: 3px solid var(--dim-border); padding-top: 16px; }
.card.vital.good { border-top-color: var(--green); }
.card.vital.info { border-top-color: var(--blue); }
.badge.info { background: var(--green-tint); color: var(--green-deep); }
.card.vital.warn { border-top-color: var(--amber-border-2); }
.card.vital.bad  { border-top-color: var(--red); border-color: var(--red-border); }
.card.vital .metric.bad { color: var(--red-text); }

.track { height: 5px; border-radius: 3px; background: var(--rule); overflow: hidden; }
.track > i { display: block; height: 100%; border-radius: 3px; background: var(--green); }

.stack { display: flex; flex-direction: column; }

/* --- coach -------------------------------------------------------- */
/* Wraps on available space, not on viewport width.
   The media query below says the same thing and is not enough on its own: in
   the Home Assistant companion app the card was still laid out side by side
   with the text column running off the right edge, so whatever the webview
   reports as its viewport, it is not what a phone screen suggests. Flex-wrap
   needs no such report — once there is less than 280px for the prose the
   column drops below the ring on its own. */
.coach { display: flex; flex-wrap: wrap; gap: 24px 32px; align-items: flex-start; }
/* Capped, not just flexed: with no medication card beside it the hero card
   spans the full 1360px, and coach prose set to that measure is unreadable.
   74ch is a comfortable line for 15px body copy.
   (No backticks in this file — MH.CSS is a template literal.) */
.coach-main { flex: 1 1 280px; display: flex; flex-direction: column;
              gap: 11px; min-width: 0; max-width: 74ch; }
.headline { font-size: 25px; font-weight: 600; color: var(--ink); line-height: 1.3; }
.hr { height: 1px; background: var(--rule); }

.legend { display: flex; gap: 18px; flex-wrap: wrap; }
.legend-item { display: flex; align-items: center; gap: 6px; }
.swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.legend-label { font-size: 13px; color: var(--ink-muted); }
.legend-value { font-family: var(--mono); font-size: 15px; font-weight: 600; color: var(--ink); }

.next {
  background: var(--green-tint-2); border: 1px solid var(--green-border);
  border-radius: 12px; padding: 14px 16px;
  display: flex; align-items: center; gap: 14px;
}
.next-label {
  font-family: var(--mono); font-size: 11px; letter-spacing: .14em;
  color: var(--green-deep); flex: none;
}
.next-text { font-size: 15px; color: var(--ink); flex: 1; }

.btn {
  font-family: inherit; font-size: 13px; font-weight: 600;
  border-radius: 8px; padding: 9px 14px; border: 0; cursor: pointer;
  background: var(--green); color: #fff; white-space: nowrap;
}
.btn.dark { background: var(--chrome); font-size: 14px; border-radius: 10px; padding: 11px 18px; }
.btn.amber { background: var(--amber); }
.btn.ghost { background: none; border: 1px solid var(--amber-border-2); color: var(--amber-deep); }
.btn:disabled { opacity: .5; cursor: default; }

.ask { display: flex; gap: 10px; }
.ask input {
  flex: 1; background: var(--sunken); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 14px; font-size: 14px;
  font-family: inherit; color: var(--ink); min-width: 0;
}
.ask input::placeholder { color: var(--ink-faint); }

/* --- medication --------------------------------------------------- */
.card.med-due { background: var(--amber-tint); border-color: var(--amber-border); border-radius: 16px; padding: 22px 24px; }
.card.med-done { border-color: var(--green-border); border-radius: 16px; padding: 22px 24px; }
.med-title { font-size: 20px; font-weight: 600; }
.card.med-due .med-title { color: var(--amber-ink); }
.card.med-due .med-body { color: var(--amber-ink-2); font-size: 14px; line-height: 1.6; }
.card.med-due .eyebrow { color: var(--amber-deep); }
.med-actions { display: flex; gap: 10px; }

/* --- list --------------------------------------------------------- */
.entry {
  display: grid; grid-template-columns: 130px 1fr; gap: 16px;
  padding: 14px 0; border-top: 1px solid var(--rule);
}
.entry:first-of-type { border-top: 0; }
.entry-when { font-family: var(--mono); font-size: 12px; color: var(--ink-faint); text-transform: uppercase; }
.entry-title { font-size: 15px; font-weight: 600; color: var(--ink); }
.entry-sum { font-size: 14px; color: var(--ink-muted); }

/* --- stat groups -------------------------------------------------- */
.stats { display: flex; gap: 32px; flex-wrap: wrap; }
.stat-value { font-family: var(--mono); font-size: 24px; font-weight: 600; color: var(--ink); }
.stat-caption { font-size: 13px; color: var(--ink-muted); }

.chip { display: flex; align-items: center; gap: 6px; }
.chip-text { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; color: var(--ink-faint); text-transform: uppercase; }

.note {
  background: var(--amber-tint); border: 1px solid var(--amber-border);
  border-radius: 12px; padding: 14px 16px; display: flex; gap: 14px; align-items: baseline;
}
.note .eyebrow { color: var(--amber-deep); flex: none; }
.note-text { font-size: 14px; color: var(--ink-2); line-height: 1.6; }

.empty { padding: 40px 0; text-align: center; color: var(--ink-muted); font-size: 15px; }

/* --- charts ------------------------------------------------------- */
.row.hero-left { grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); }
@media (max-width: 1100px) { .row.hero-left { grid-template-columns: 1fr; } }

.hero-metric { font-size: 52px; letter-spacing: -.02em; margin: 6px 0 10px; }
.between { display: flex; justify-content: space-between; gap: 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; margin-top: 14px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
         gap: 12px; margin-top: 16px; }
.tile { background: var(--tile); border-radius: 12px; padding: 16px 18px; }
.grid2 .tile { background: none; padding: 0; }

.chart { position: relative; margin-top: 14px; background: var(--sunken);
         border-radius: 8px; overflow: hidden; }
.plot { width: 100%; height: 100%; display: block; }
.gridline { stroke: var(--rule); stroke-width: 1; vector-effect: non-scaling-stroke; }
.target { stroke: var(--green); stroke-width: 1.5; stroke-dasharray: 5 4;
          vector-effect: non-scaling-stroke; }
.spark { width: 100%; height: 26px; display: block; margin: 10px 0 8px; }

.axis { display: flex; justify-content: space-between; margin-top: 8px; }
.axis-tick { font-family: var(--mono); font-size: 11px; letter-spacing: .06em;
             color: var(--ink-faint); text-transform: uppercase; }

.ranges { display: flex; gap: 6px; }
.range {
  font-family: var(--mono); font-size: 11px; letter-spacing: .06em;
  text-transform: uppercase; padding: 5px 10px; border-radius: 8px;
  border: 1px solid var(--border); background: none; color: var(--ink-muted);
  cursor: pointer;
}
.range[aria-selected="true"] { background: var(--chrome); color: #fff; border-color: var(--chrome); }

.bars { display: flex; align-items: flex-end; gap: 5px; margin-top: 14px;
        background: var(--sunken); border-radius: 8px; padding: 10px;
        border-bottom: 1px solid var(--rule); }
.bars-row { display: flex; align-items: flex-end; gap: 5px; width: 100%; height: 100%; }
/* Named daybar, not bar: the sticky tab bar above is .bar, and a later
   rule of the same name repainted the chrome with the under-goal colour.
   (No backticks in this file — MH.CSS is a template literal.) */
.daybar { flex: 1; min-height: 4px; border-radius: 3px 3px 0 0; background: var(--green-light); }
.daybar.partial {
  background-image: repeating-linear-gradient(45deg,
    rgba(255,255,255,.55) 0 3px, transparent 3px 6px);
}

.range-bar { display: flex; gap: 2px; height: 8px; margin: 4px 0 6px; }
.range-bar > i { border-radius: 3px; }
.range-axis { display: flex; gap: 2px; margin-bottom: 12px; }
.range-axis > span { text-align: center; }

@media (prefers-reduced-motion: reduce) {
  .plot path { animation: none !important; stroke-dashoffset: 0 !important; }
}
@keyframes drawLine { to { stroke-dashoffset: 0; } }

/* --- phones ------------------------------------------------------- *
   The design is a 1360px desktop page and says so, but this is Home
   Assistant: most people open it on a phone. Two things made the whole page
   scroll sideways rather than merely look cramped, and both are min-content
   widths that no amount of max-width would fix.

   The tab bar: four tabs plus a SYNCED chip laid out with space-between have
   a min-content width well over 390px, and a flex row does not shrink below
   that — so the bar pushed the page wider than the viewport and every card
   was clipped at the right edge.

   The coach card: a 140px ring and a text column side by side, with the gap,
   leaves under 200px for a 25px headline. It stacks here instead. */
@media (max-width: 640px) {
  .bar { height: 52px; }
  .bar-inner { padding: 0 14px; gap: 10px; }
  /* Scroll the tabs rather than squeezing them: a four-way choice that has to
     stay readable is a better candidate for a swipe than for 11px type. */
  .tabs { overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { font-size: 14px; padding: 0 12px; flex: none; }
  /* The dot survives; the words do not fit and are not load-bearing. */
  .sync-text { display: none; }

  .view { padding: 16px 14px 40px; gap: 12px; }
  .row { gap: 12px; }
  .card { padding: 16px; border-radius: 12px; }
  .card.hero { padding: 18px 16px; border-radius: 14px; }

  .coach { flex-direction: column; gap: 16px; align-items: stretch; }
  .coach .ring { align-self: center; width: 132px; height: 132px; }
  .coach-main { max-width: none; }
  .headline { font-size: 21px; line-height: 1.25; }
  .body { font-size: 14px; }

  .hero-metric { font-size: 40px; }
  .metric { font-size: 28px; }

  /* Both of these are label-then-control rows that only work side by side. */
  .ask { flex-direction: column; align-items: stretch; }
  .next { flex-direction: column; align-items: flex-start; gap: 10px; }
  .next-text { flex: none; }

  .stats { gap: 16px 22px; }
  .grid2 { gap: 12px 16px; }
  .entry { grid-template-columns: 1fr; gap: 2px; }
  .legend { gap: 10px 14px; }
  .range-axis { display: none; }
}

/* --- motion ------------------------------------------------------- */
@keyframes cardIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: none; }
}
@keyframes pulseDot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .3; transform: scale(.78); }
}
@keyframes ringFill { from { stroke-dashoffset: var(--from); } }

.card.gap { animation-name: cardIn; }

@media (prefers-reduced-motion: reduce) {
  .card, .ring circle { animation: none !important; }
  .dot.pulse { animation: none !important; opacity: 1 !important; }
}
`;

  /* ------------------------------------------------------------------ *
   * DOM helpers
   * ------------------------------------------------------------------ *
   *
   * Small enough to stay readable, and deliberately not a framework. Views
   * build their tree once with `el()` and then mutate text nodes in place —
   * `set hass` fires on every state change in the instance, and rebuilding the
   * page each time would restart every entry animation.
   *
   * Everything is created with textContent, never innerHTML: coach messages
   * and entity friendly-names are user data and must not be parsed as markup.
   */

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const svg = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    return n;
  };

  const add = (parent, ...kids) => {
    for (const k of kids) if (k) parent.appendChild(k);
    return parent;
  };

  MH.el = el;
  MH.svg = svg;
  MH.add = add;

  /**
   * The three activity rings.
   *
   * Concentric arcs, each rotated -90° so they start at twelve o'clock, drawn
   * with `stroke-dasharray` = circumference and animated by moving
   * `stroke-dashoffset` from a full circle to the fraction completed. A closed
   * ring is offset 0.
   *
   * Over-achievement is clamped at a full circle rather than wrapping: a
   * second lap would render 664 kcal against a 402 goal as a ring that looks
   * two-thirds done.
   */
  const RING_SPEC = [
    { key: "move", r: 64, color: "#e2445c", track: "#f0eeee", delay: 0 },
    { key: "exercise", r: 48, color: "#0f9c72", track: "#eaefec", delay: .12 },
    { key: "stand", r: 32, color: "#2f7fc4", track: "#e9eef3", delay: .24 }
  ];
  MH.RING_SPEC = RING_SPEC;

  MH.rings = (values) => {
    const root = svg("svg", { class: "ring", width: 140, height: 140,
                              viewBox: "0 0 150 150", role: "img" });
    const arcs = {};
    for (const spec of RING_SPEC) {
      const c = 2 * Math.PI * spec.r;
      /* The track goes through a custom property rather than the design's
         literal greys: unfilled track at #f0eeee on a #101d2c card reads as
         three bright white rings. The ring colours themselves stay literal —
         they carry meaning and must not follow a theme. */
      const track = svg("circle", {
        cx: 75, cy: 75, r: spec.r, fill: "none", "stroke-width": 13
      });
      track.style.stroke = `var(--ring-track, ${spec.track})`;
      add(root, track);
      const arc = svg("circle", {
        cx: 75, cy: 75, r: spec.r, fill: "none", stroke: spec.color,
        "stroke-width": 13, "stroke-linecap": "round",
        "stroke-dasharray": c.toFixed(2),
        transform: "rotate(-90 75 75)"
      });
      arc.style.setProperty("--from", c.toFixed(2));
      arc.style.animation = `ringFill 1.4s cubic-bezier(.2,.8,.2,1) ${spec.delay}s both`;
      add(root, arc);
      arcs[spec.key] = { node: arc, c };
    }

    const apply = (vals) => {
      const parts = [];
      for (const spec of RING_SPEC) {
        const p = vals && vals[spec.key];
        const frac = p ? Math.max(0, Math.min(1, p.ratio)) : 0;
        const a = arcs[spec.key];
        a.node.setAttribute("stroke-dashoffset", (a.c * (1 - frac)).toFixed(2));
        if (p) parts.push(`${spec.key} ${Math.round(p.ratio * 100)}%`);
      }
      root.setAttribute("aria-label",
        parts.length ? "Activity rings: " + parts.join(", ") : "Activity rings: no data");
    };
    apply(values);
    root.update = apply;
    return root;
  };

  /** A `label + value` legend row under the rings. */
  MH.ringLegend = (items) => {
    const row = el("div", "legend");
    for (const it of items) {
      const g = el("div", "legend-item");
      const sw = el("span", "swatch");
      sw.style.background = it.color;
      add(g, sw, el("span", "legend-label", it.label), el("span", "legend-value", it.value));
      add(row, g);
    }
    return row;
  };

  /** A progress bar in the design's track/fill pair. */
  MH.bar = (pct, color) => {
    const t = el("div", "track");
    const f = el("i");
    f.style.width = Math.max(0, Math.min(100, pct || 0)) + "%";
    if (color) f.style.background = color;
    return add(t, f);
  };

  /* ------------------------------------------------------------------ *
   * Today
   * ------------------------------------------------------------------ *
   *
   * The three-second read: rings, what the coach makes of them, whether
   * medication was logged, and the four vitals that matter today.
   *
   * Every card here is built once and given an `update(resolved, now)`. None
   * of them assume their role resolved — `MH.readable()` is the gate, and a
   * role that is absent, blank, stale or of unknown age gets the designed gap
   * treatment rather than a number nobody can vouch for.
   */

  /* `el` and `add` come from 07-dom.js — the numbered files are one IIFE, so
     they are already in scope and must not be redeclared here. */

  /** A card that hides itself entirely when its roles resolve to nothing. */
  const hideIf = (node, hidden) => { node.style.display = hidden ? "none" : ""; };

  /* ------------------------------------------------------------------ *
   * Coach + rings
   * ------------------------------------------------------------------ */
  const coachCard = () => {
    const card = el("div", "card hero");
    const wrap = el("div", "coach");
    const rings = MH.rings(null);
    const main = el("div", "coach-main");

    const legend = el("div", "legend");
    const legendVals = {};
    for (const spec of MH.RING_SPEC) {
      const g = el("div", "legend-item");
      const sw = el("span", "swatch");
      sw.style.background = spec.color;
      const label = el("span", "legend-label",
        spec.key.charAt(0).toUpperCase() + spec.key.slice(1));
      const val = el("span", "legend-value", "—");
      legendVals[spec.key] = val;
      add(legend, add(g, sw, label, val));
    }

    const eyebrow = el("div", "eyebrow", "Coach");
    const headline = el("div", "headline", "");
    const body = el("div", "body", "");

    const next = el("div", "next");
    const nextText = el("div", "next-text", "");
    const nextBtn = el("button", "btn", "Start reading");
    nextBtn.disabled = true;
    nextBtn.title = "Actions that write back arrive with the write path";
    add(next, el("div", "next-label", "Next"), nextText, nextBtn);

    const ask = el("div", "ask");
    const input = el("input");
    input.type = "text";
    input.placeholder = "Ask the coach — why is my resting pulse lower this week?";
    const askBtn = el("button", "btn dark", "Ask");
    const askNote = el("div", "support ask-note", "");
    add(ask, input, askBtn);

    /* The one write on the page.
     *
     * The coach script assembles its own context and publishes the answer to
     * the same retained topic the card already reads, so there is nothing to
     * poll and no second channel: the reply arrives as an ordinary state
     * change and lands in the card above. `silent` is set because the push
     * notification exists for when you are *not* looking at this, and you
     * plainly are. */
    let asking = false;
    const submit = () => {
      const q = input.value.trim();
      const script = card._askEntity;
      if (!q || !script || asking || !MH.hass) return;
      asking = true;
      askBtn.textContent = "Asking…";
      askBtn.disabled = true;
      input.disabled = true;
      askNote.textContent = "";

      const [domain, service] = script.split(".");
      Promise.resolve(MH.hass.callService(domain, service, {
        kind: "question",
        task: "Keran has asked you this directly, on the dashboard. Answer it "
            + "in your own voice, using what you know below where it is "
            + "relevant and saying plainly when it is not:\n\n" + q,
        silent: true
      })).then(() => {
        input.value = "";
        askNote.textContent = "Asked. The reply replaces the message above when "
                            + "it arrives — usually a few seconds.";
      }).catch((e) => {
        /* A failed ask has to say so. Clearing the box and showing nothing
           would be indistinguishable from a coach that had nothing to add. */
        askNote.textContent = "Could not ask the coach: " + (e && e.message ? e.message : e);
      }).then(() => {
        asking = false;
        askBtn.textContent = "Ask";
        askBtn.disabled = false;
        input.disabled = false;
        input.focus();
      });
    };
    askBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    add(main, legend, el("div", "hr"), eyebrow, headline, body, next, ask, askNote);
    add(wrap, rings, main);
    add(card, wrap);

    card.update = (R, now) => {
      /* Rings. A ring with no goal cannot be drawn as a proportion, so it
         stays empty rather than guessing one. */
      const vals = {};
      for (const spec of MH.RING_SPEC) {
        const v = R[spec.key + "_ring"], g = R[spec.key + "_goal"];
        const value = MH.readable(v) ? MH.valueIn(v) : null;
        const goal = MH.readable(g) ? MH.valueIn(g) : null;
        const p = MH.progress(value, goal);
        if (p) vals[spec.key] = p;
        const role = MH.ROLE_BY_KEY[spec.key + "_ring"];
        legendVals[spec.key].textContent = value == null ? "—"
          : MH.group(value, 0) + (goal ? "/" + MH.group(goal, 0) : "") +
            (role.unit ? " " + role.unit : "");
      }
      rings.update(vals);

      const c = R.coach_message;
      const has = !!(c && c.entity_id && !c.blank);
      hideIf(card, !has && !Object.keys(vals).length);
      const a = (c && c.attributes) || {};
      headline.textContent = a.headline || (has ? String(c.value) : "");
      body.textContent = a.body || "";
      hideIf(body, !a.body);
      hideIf(headline, !headline.textContent);

      const who = a.source === "rules" ? "Rules" : (a.source || "Coach");
      const when = MH.ageLabel(c, now);
      eyebrow.textContent = has ? ["Coach", who, when].filter(Boolean).join(" · ") : "";
      hideIf(eyebrow, !has);

      /* The design's next-action strip carries a *distinct* suggestion with a
         button that performs it. This coach publishes a headline and a body
         and nothing else, and showing the body twice — once as copy, once as
         a suggestion — reads like a bug. The strip waits for a real
         suggestion attribute rather than inventing one. */
      const suggestion = a.next || a.suggestion || a.action || null;
      hideIf(next, !suggestion);
      nextText.textContent = suggestion || "";

      /* The Ask box needs somewhere to send the question. No coach script
         resolved means no box — not a disabled one, which would invite a
         press that could never work. */
      const askable = R.coach_ask;
      card._askEntity = askable && askable.entity_id ? askable.entity_id : null;
      hideIf(ask, !has || !card._askEntity);
      hideIf(askNote, !askNote.textContent);
    };
    return card;
  };

  /* ------------------------------------------------------------------ *
   * Medication
   * ------------------------------------------------------------------ *
   *
   * Read-only, deliberately, and it is the API that decides that rather than
   * a preference. Apple Health does expose medications — `HKMedicationDoseEvent`,
   * iOS 26 and later — but every property is readonly and both `init` and
   * `new` are `NS_UNAVAILABLE`, so no third-party app can construct a dose
   * event. A `Log now` button here could never write one, whatever it was
   * wired to.
   *
   * So the division of labour is: Home Assistant reminds, the Health app logs,
   * and this card reports. A button that appeared to log a dose while the
   * Health app disagreed would be worse than no button — this is medication.
   *
   * The role still resolves nowhere on this instance, so the card is normally
   * absent. It appears the day a medication source exists.
   */
  const medicationCard = () => {
    const card = el("div", "card med-due");
    const head = el("div", "chip");
    const dot = el("span", "dot amber pulse");
    const eyebrow = el("div", "eyebrow", "Medication");
    const title = el("div", "med-title", "");
    const body = el("div", "med-body", "");
    add(head, dot, eyebrow);
    add(card, head, title, body);
    card.style.display = "none";

    card.update = (R, now) => {
      const m = R.medication_logged;
      const present = !!(m && m.entity_id);
      hideIf(card, !present);
      if (!present) return;

      const logged = m.value === true || m.value === "on" || m.value === "logged";
      card.className = "card " + (logged ? "med-done" : "med-due");
      dot.className = "dot pulse " + (logged ? "green" : "amber");
      title.textContent = logged ? "Logged today" : "Not recorded today";
      body.textContent = logged
        ? "Recorded " + (MH.ageLabel(m, now) || "today") + "."
        : "Log it in the Health app as usual — this card clears when today's "
          + "entry arrives.";
    };
    return card;
  };

  /* ------------------------------------------------------------------ *
   * Vitals
   * ------------------------------------------------------------------ *
   *
   * One builder for all four. Each card is a value, a status band, and one
   * line of support — or the gap treatment, which is a first-class state and
   * never a hidden card.
   */
  const vitalCard = (spec) => {
    const card = el("div", "card vital");
    const head = el("div", "head");
    const title = el("div", "eyebrow", spec.title);
    const badge = el("span", "badge");
    add(head, title, badge);
    const metric = el("div", "metric", "—");
    const extra = el("div");
    const support = el("div", "support", "");
    add(card, head, metric, extra, support);

    card.update = (R, now) => {
      const out = spec.read(R, now);
      const tone = out.tone || "";
      card.className = "card vital " + tone + (out.gap ? " gap" : "");
      metric.className = "metric " + (tone === "bad" ? "bad" : "");

      metric.textContent = "";
      if (out.gap) {
        add(metric, document.createTextNode("—"));
        metric.style.color = "var(--dim-ink)";
      } else {
        metric.style.color = "";
        add(metric, document.createTextNode(out.value));
        if (out.unit) add(metric, el("span", "unit", out.unit));
      }

      badge.className = "badge " + (out.gap ? "gap" : tone || "good");
      badge.textContent = out.gap ? "Gap" : (out.badge || "");
      hideIf(badge, !out.gap && !out.badge);

      extra.textContent = "";
      if (out.extra && !out.gap) add(extra, out.extra);
      extra.style.margin = out.extra && !out.gap ? "10px 0" : "0";

      support.textContent = out.support || "";
    };
    return card;
  };

  const stepsVital = (config) => vitalCard({
    title: "Steps",
    read: (R, now) => {
      const s = R.steps;
      if (!MH.readable(s)) return { gap: true, support: MH.gapReason(s, now) };
      const value = MH.valueIn(s);
      /* The design defaults the step goal to 10,000 when none is published.
         A goal is a preference rather than a reading, so a default is a
         setting the user can change, not an invented measurement. */
      const goal = MH.readable(R.step_goal) ? MH.valueIn(R.step_goal)
                 : (config.step_goal || 10000);
      const p = MH.progress(value, goal);
      const dist = MH.readable(R.distance) ? MH.valueIn(R.distance) : null;
      return {
        value: MH.group(value, 0),
        tone: "good",
        badge: p.met ? "Goal met" : "On track",
        extra: MH.bar(p.pct),
        support: (p.met ? MH.group(value - goal, 0) + " over " + MH.group(goal, 0)
                        : MH.group(goal - value, 0) + " to " + MH.group(goal, 0)) +
                 (dist != null ? " · " + MH.group(dist, 1) + " km" : "")
      };
    }
  });

  const weightVital = () => vitalCard({
    title: "Weight",
    read: (R, now) => {
      const w = R.weight;
      if (!MH.readable(w)) return { gap: true, support: MH.gapReason(w, now) };
      const value = MH.valueIn(w);
      const goal = MH.readable(R.weight_goal) ? MH.valueIn(R.weight_goal) : null;
      const when = MH.ageLabel(w, now);
      return {
        value: MH.group(value, 1), unit: "kg", tone: "info",
        support: [goal != null ? MH.group(value - goal, 1) + " kg to target" : null, when]
          .filter(Boolean).join(" · ")
      };
    }
  });

  const bpVital = () => vitalCard({
    title: "Blood pressure",
    read: (R, now) => {
      const s = R.systolic, d = R.diastolic;
      if (!MH.readable(s) || !MH.readable(d)) {
        return { gap: true, support: MH.gapReason(MH.readable(s) ? d : s, now) };
      }
      const sys = MH.valueIn(s), dia = MH.valueIn(d);
      const band = MH.bpBand(sys, dia);
      const pulse = MH.readable(R.cuff_pulse) ? MH.valueIn(R.cuff_pulse) : null;
      return {
        value: MH.group(sys, 0) + "/" + MH.group(dia, 0),
        tone: band.tone, badge: band.label,
        extra: bpRange(band),
        support: [MH.ageLabel(s, now),
                  pulse != null ? "pulse " + MH.group(pulse, 0) + " bpm" : null]
          .filter(Boolean).join(" · ")
      };
    }
  });

  /* The four-segment clinical axis under a BP reading. Proportions are the
     design's (3/1/2/2), and the segment for the current band is the only one
     at full strength — the bar says which band you are in, not merely that
     bands exist. */
  const bpRange = (band) => {
    const segs = [
      { key: "normal", flex: 3, color: "#a8ddc7" },
      { key: "elevated", flex: 1, color: "#f6dfa0" },
      { key: "stage1", flex: 2, color: "#eeb0a0" },
      { key: "stage2", flex: 2, color: "#c0334d" }
    ];
    const bar = el("div");
    bar.style.cssText = "display:flex;gap:2px;height:5px;";
    for (const s of segs) {
      const i = el("i");
      i.style.cssText = `flex:${s.flex};background:${s.color};border-radius:3px;` +
                        `opacity:${band && band.key === s.key ? 1 : .35}`;
      add(bar, i);
    }
    return bar;
  };

  const sleepVital = () => vitalCard({
    title: "Sleep",
    read: (R, now) => {
      const s = R.sleep_duration;
      if (!MH.readable(s)) return { gap: true, support: MH.gapReason(s, now) };
      const h = MH.valueIn(s);
      const whole = Math.floor(h), mins = Math.round((h - whole) * 60);
      return {
        value: whole + "h " + String(mins).padStart(2, "0") + "m",
        tone: h >= 7 ? "good" : h >= 6 ? "warn" : "bad",
        badge: h >= 7 ? "Good" : h >= 6 ? "Short" : "Very short",
        support: MH.ageLabel(s, now) || ""
      };
    }
  });

  /* ------------------------------------------------------------------ *
   * Last workout and treadmill
   * ------------------------------------------------------------------ */
  /* `dim` is the design's treatment for a figure that is real but cannot be
     dated — visible at half strength and captioned as such, rather than
     dropped. See MH.showable. */
  const statGroup = (value, caption, dim) => {
    const g = el("div");
    if (dim) g.style.opacity = ".5";
    add(g, el("div", "stat-value", value),
           el("div", "stat-caption", dim ? caption + " · age unknown" : caption));
    return g;
  };

  const workoutCard = () => {
    const card = el("div", "card");
    const head = el("div", "head");
    const eyebrow = el("div", "eyebrow", "");
    add(head, el("div", "title", "Last workout"), eyebrow);
    const stats = el("div", "stats");
    stats.style.marginTop = "16px";
    add(card, head, stats);

    card.update = (R, now) => {
      const parts = ["workout_type", "workout_duration", "workout_energy",
                     "workout_hr_avg", "workout_hr_max"].map((k) => R[k]);
      const any = parts.some(MH.readable);
      hideIf(card, !any);
      if (!any) return;

      const v = (k) => MH.readable(R[k]) ? MH.valueIn(R[k]) : null;
      const type = MH.readable(R.workout_type) ? String(R.workout_type.value) : "Workout";
      const dur = v("workout_duration"), en = v("workout_energy");
      const avg = v("workout_hr_avg"), max = v("workout_hr_max");

      const when = MH.ageLabel(R.workout_start, now) || MH.ageLabel(R.workout_duration, now);
      const wk = MH.readable(R.workouts_week) ? MH.valueIn(R.workouts_week) : null;
      eyebrow.textContent = [when, wk != null ? wk + " in 7 days" : null]
        .filter(Boolean).join(" · ");

      stats.textContent = "";
      add(stats, statGroup(type, R.workout_type.group_source === "apple_health"
                                  ? "Apple Health" : "Last session"));
      if (dur != null) {
        add(stats, statGroup(MH.group(dur, 0) + " min",
                             en != null ? MH.group(en, 0) + " kcal" : "duration"));
      }
      if (avg != null || max != null) {
        add(stats, statGroup((avg != null ? MH.group(avg, 0) + " avg" : "—"),
                             (max != null ? MH.group(max, 0) + " peak bpm" : "average bpm")));
      }
    };
    return card;
  };

  const treadmillCard = () => {
    const card = el("div", "card");
    const head = el("div", "head");
    const chip = el("div", "chip");
    const dot = el("span", "dot green pulse");
    const chipText = el("span", "chip-text", "");
    add(chip, dot, chipText);
    add(head, el("div", "title", "Treadmill"), chip);
    const stats = el("div", "stats");
    stats.style.marginTop = "16px";
    add(card, head, stats);

    card.update = (R) => {
      const keys = ["treadmill_walks_week", "treadmill_time_week",
                    "treadmill_distance_week", "treadmill_calories_week"];
      const any = keys.some((k) => MH.showable(R[k])) || MH.showable(R.treadmill_state);
      hideIf(card, !any);
      if (!any) return;

      const state = MH.showable(R.treadmill_state) ? String(R.treadmill_state.value) : null;
      const active = state && /run|active|walking|workout/i.test(state);
      chipText.textContent = state ? (active ? "Active" : "Idle") : "";
      dot.style.opacity = active ? "" : ".55";

      /* Weekly totals are supporting figures, not clinical readings: shown
         dimmed when nothing can date them rather than withheld. */
      const tile = (key, fmt, caption) => {
        const r = R[key];
        if (!MH.showable(r)) return null;
        return statGroup(fmt(MH.valueIn(r)), caption, !MH.readable(r));
      };

      stats.textContent = "";
      add(stats,
        tile("treadmill_walks_week", (v) => MH.group(v, 0), "walks this week"),
        tile("treadmill_time_week", (v) => MH.group(v, 0) + " min", "time walked"),
        tile("treadmill_distance_week", (v) => MH.group(v, 1) + " km", "distance"),
        tile("treadmill_calories_week", (v) => MH.group(v, 0), "calories"));
    };
    return card;
  };

  /* ------------------------------------------------------------------ *
   * The view
   * ------------------------------------------------------------------ */
  MH.todayView = (config) => {
    const view = el("div", "view");
    const cards = [];
    const keep = (c) => { cards.push(c); return c; };

    const r1 = el("div", "row hero");
    const med = keep(medicationCard());
    add(r1, keep(coachCard()), med);

    const r2 = el("div", "row four");
    add(r2, keep(stepsVital(config || {})), keep(weightVital()),
            keep(bpVital()), keep(sleepVital()));

    const r3 = el("div", "row two");
    add(r3, keep(workoutCard()), keep(treadmillCard()));

    add(view, r1, r2, r3);

    /* Stagger the entry animation across a row, as the design does. */
    cards.forEach((c, i) => { c.style.animationDelay = (i * 0.05).toFixed(2) + "s"; });

    view.update = (resolved, now) => {
      for (const c of cards) c.update(resolved, now || Date.now());

      /* The hero row is `1fr 380px`. With no medication source — which is the
         normal case, since nothing publishes one yet — the second column would
         hold a 380px column of empty page beside the coach. */
      r1.style.gridTemplateColumns = med.style.display === "none" ? "1fr" : "";
      /* A row whose every card hid itself would otherwise leave a 16px gap. */
      for (const row of [r1, r2, r3]) {
        const visible = Array.prototype.some.call(row.children,
          (n) => n.style.display !== "none");
        row.style.display = visible ? "" : "none";
      }
    };
    return view;
  };

  /* ------------------------------------------------------------------ *
   * The card element
   * ------------------------------------------------------------------ *
   *
   * One panel card owning the whole page: the sticky tab bar, the four views,
   * and a single resolver shared between them. A set of separate cards would
   * have left the tab bar without an owner and made every card repeat both the
   * resolution and its own statistics round trip.
   *
   * Two things happen on different clocks, and conflating them is the mistake
   * this file is arranged to avoid:
   *
   *   `set hass` fires on every state change anywhere in the instance, many
   *   times a second in a busy house. It re-resolves and updates text in place.
   *
   *   Measurement ages come from long-term statistics, which is a websocket
   *   round trip over ~40 entities. That happens once on mount and then on a
   *   slow timer — a reading's age does not change meaningfully between two
   *   state updates a second apart.
   */

  const VIEW_TITLES = { today: "Today", body: "Body", heart: "Heart", movement: "Movement" };

  /* How often to re-ask statistics for measurement ages. Ten minutes: long
     enough not to be chatty, short enough that a weigh-in shows up as fresh
     while the user is still standing next to the scale. */
  const AGE_REFRESH = 10 * 60 * 1000;

  /* `extends HTMLElement` is evaluated when the class is defined, not when it
     is instantiated, so naming it directly would throw the moment this file
     was required under node — and the harness exists precisely so the shipped
     file is the one under test. */
  const Base = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

  class MyHealthDashboardCard extends Base {
    constructor() {
      super();
      this._root = this.attachShadow({ mode: "open" });
      this._config = {};
      this._built = false;
      this._tab = "today";
      this._ages = { at: {}, floors: {} };
      this._agesAt = 0;
      this._fetching = false;
      this._resolved = null;
    }

    /* Lovelace calls this with the yaml. Config is optional in every part:
       an empty `type: custom:myhealth-dashboard` has to work, because
       discovery is the whole point. */
    setConfig(config) {
      this._config = Object.assign({}, config || {});
      if (this._config.tab && VIEW_TITLES[this._config.tab]) this._tab = this._config.tab;
      this._built = false;
      if (this._root) this._root.textContent = "";
      if (this._hass) this._render();
    }

    getCardSize() { return 12; }

    set hass(hass) {
      this._hass = hass;
      this._render();
    }

    connectedCallback() { if (this._hass) this._render(); }

    _build() {
      const style = document.createElement("style");
      style.textContent = MH.CSS;

      const bar = MH.el("div", "bar");
      const inner = MH.el("div", "bar-inner");
      const tabs = MH.el("div", "tabs");
      this._tabButtons = {};
      for (const key of MH.TABS) {
        const b = MH.el("button", "tab", VIEW_TITLES[key]);
        b.type = "button";
        b.setAttribute("role", "tab");
        b.addEventListener("click", () => this._select(key));
        this._tabButtons[key] = b;
        MH.add(tabs, b);
      }
      tabs.setAttribute("role", "tablist");

      const sync = MH.el("div", "sync");
      this._syncDot = MH.el("span", "dot pulse");
      this._syncText = MH.el("span", "sync-text", "");
      MH.add(sync, this._syncDot, this._syncText);
      MH.add(inner, tabs, sync);
      MH.add(bar, inner);

      this._views = {
        today: MH.todayView(this._config),
        body: MH.bodyView(),
        heart: MH.heartView(),
        movement: MH.movementView(this._config)
      };
      this._series = {};
      const holder = MH.el("div");
      for (const key of MH.TABS) {
        const v = this._views[key];
        /* A range selector changes what the view wants, so it asks for a
           refetch rather than reaching for the websocket itself. */
        v.request = () => { this._seriesFor(key, true); };
        MH.add(holder, v);
      }

      MH.add(this._root, style, bar, holder);
      this._built = true;
      this._paint();
    }

    _select(tab) {
      if (!VIEW_TITLES[tab] || tab === this._tab) return;
      this._tab = tab;
      this._paint();
      /* Re-run the entry animation for the view being shown, which is what
         the design means by "fires on view mount, not on every update". */
      const v = this._views[tab];
      for (const card of v.querySelectorAll(".card")) {
        card.style.animation = "none";
        void card.offsetWidth;
        card.style.animation = "";
      }
      this._update(true);
    }

    _paint() {
      for (const key of MH.TABS) {
        const on = key === this._tab;
        this._tabButtons[key].setAttribute("aria-selected", on ? "true" : "false");
        this._views[key].style.display = on ? "" : "none";
      }
    }

    _render() {
      if (!this._hass) return;
      if (!this._built) this._build();
      this._applyTheme();
      this._update();
      this._maybeFetchAges();
    }

    /* HA decides dark from the user's selected theme, not from the OS, so
       `prefers-color-scheme` alone would leave a dark-themed instance showing
       a white card. Stamping the host also pins the answer for a user whose
       HA theme and OS disagree. */
    _applyTheme() {
      const dark = this._hass.themes && this._hass.themes.darkMode;
      if (dark == null) return;
      this.setAttribute("data-theme", dark ? "dark" : "light");
    }

    /**
     * Has anything this card cares about actually changed?
     *
     * `set hass` fires on every state change in the instance — a doorbell, a
     * light, a power meter updating every second. Re-resolving 44 roles across
     * 1,500-odd entities on each of those is wasted work, and it made the
     * charts re-run their draw-in animation continuously.
     *
     * HA replaces the state object when an entity changes, so identity is a
     * sound and very cheap test. A change in the number of entities means
     * something was added or removed and discovery deserves another look.
     */
    _worthUpdating() {
      if (!this._resolved || !this._watch) return true;
      const s = this._hass.states;
      const ids = Object.keys(s);
      if (ids.length !== this._entityCount) return true;
      for (const id of this._watch) {
        if (s[id] !== this._seen[id]) return true;
      }
      return false;
    }

    /* Remember exactly what was read, so the next hass can be compared. */
    _rememberWatched() {
      const s = this._hass.states;
      const watch = [];
      for (const key in this._resolved) {
        const r = this._resolved[key];
        if (r.entity_id) watch.push(r.entity_id);
      }
      /* Stamps are read for measurement times but are not a role's entity. */
      for (const id of Object.values(this._stamps || {})) watch.push(id);
      this._watch = watch;
      this._seen = {};
      for (const id of watch) this._seen[id] = s[id];
      this._entityCount = Object.keys(s).length;
    }

    _update(force) {
      if (!force && !this._worthUpdating()) return;
      const now = Date.now();
      this._stamps = Object.assign(MH.findStamps(this._hass.states),
                                   this._config.stamps);
      this._resolved = MH.resolve(this._hass.states, {
        entities: this._config.entities,
        stamps: this._stamps,
        exclude: this._config.exclude
      }, { now, statLast: this._ages.at, floors: this._ages.floors });
      this._rememberWatched();

      /* A tab with nothing resolved hides itself — the standalone rule made
         visible. Today always stays, so an instance with no health data at
         all still has somewhere to show what it could not find. */
      const live = MH.liveTabs(this._resolved);
      for (const key of MH.TABS) {
        const show = key === "today" || live.indexOf(key) >= 0;
        this._tabButtons[key].style.display = show ? "" : "none";
      }
      if (this._tabButtons[this._tab].style.display === "none") this._select("today");

      /* The views are otherwise pure — resolution in, DOM out. The one thing
         that needs `hass` is the Ask box, which calls a service, so it is
         handed over here rather than passed through three signatures that have
         no other use for it. */
      MH.hass = this._hass;
      this._views[this._tab].update(this._resolved, now, this._series[this._tab] || {});
      this._paintSync(now);
      this._seriesFor(this._tab, false);
    }

    /**
     * Statistics for whichever view is showing.
     *
     * Only the visible tab is fetched, and only once — three history views
     * asking on every `set hass` would be a websocket round trip per state
     * change in the house. `force` is the range selector, which genuinely does
     * want new data.
     */
    _seriesFor(tab, force) {
      const view = this._views[tab];
      if (!view.series) return;
      const key = tab + ":" + JSON.stringify(view.series().map((s) => [s.key, s.days, s.mode]));
      if (!force && this._seriesKey === key) return;
      if (this._seriesPending === key) return;
      this._seriesKey = key;
      this._seriesPending = key;

      const wants = view.series();
      const now = Date.now();
      Promise.all(wants.map((want) => {
        const r = this._resolved[want.role];
        if (!r || !r.entity_id || r.blank) return Promise.resolve([want.key, []]);
        return MH.fetchSeries(this._hass, r.entity_id,
                              { days: want.days, mode: want.mode, now })
          .then((pts) => [want.key, pts])
          .catch(() => [want.key, []]);
      })).then((pairs) => {
        const out = {};
        for (const [k, v] of pairs) out[k] = v;
        this._series[tab] = out;
        this._seriesPending = null;
        if (this._built && this._tab === tab) {
          view.update(this._resolved, Date.now(), out);
        }
      });
    }

    _paintSync(now) {
      const s = this._resolved.last_sync;
      const when = s && s.measured_at != null ? MH.relTime(s.measured_at, now) : null;
      this._syncText.textContent = when ? "Synced " + when + " ago" : "";
      this._syncDot.style.display = when ? "" : "none";
      /* Amber once a sync is a day late — the chip is the only thing on the
         page that reports the pipeline rather than the body. */
      const stale = s && s.age_days != null && s.age_days > 1;
      this._syncDot.style.background = stale ? "var(--amber)" : "var(--teal)";
    }

    /**
     * Measurement ages, once per mount and then slowly.
     *
     * Guarded three ways because `set hass` is a firehose: a freshness pass in
     * flight, one that ran recently, and a resolution that has not happened
     * yet all mean "not now".
     */
    _maybeFetchAges() {
      if (this._fetching || !this._resolved) return;
      if (Date.now() - this._agesAt < AGE_REFRESH) return;
      this._fetching = true;
      MH.fetchAges(this._hass, this._resolved, { now: Date.now() })
        .then((got) => {
          this._ages = got;
          this._agesAt = Date.now();
        })
        .catch(() => { this._agesAt = Date.now(); })
        .then(() => {
          this._fetching = false;
          if (this._built) this._update(true);
        });
    }
  }

  /* Registration is guarded so the same file still loads under node in
     tools/resolve_check.js, where there is no customElements and no DOM. */
  if (typeof customElements !== "undefined" && !customElements.get("myhealth-dashboard")) {
    customElements.define("myhealth-dashboard", MyHealthDashboardCard);

    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "myhealth-dashboard",
      name: "myHealth Dashboard",
      description: "A health dashboard over whatever health data this instance already has.",
      preview: false
    });
    /* eslint-disable-next-line no-console */
    console.info("%c myhealth-dashboard %c " + MH.VERSION + " ",
                 "background:#0d2233;color:#fff", "background:#16c397;color:#0d2233");
  }

  /* ------------------------------------------------------------------ *
   * Series — history worth drawing
   * ------------------------------------------------------------------ *
   *
   * Charts need a different question answered than cards do. A card asks
   * "what is it now, and when was it measured"; a chart asks "what has it
   * done", and long-term statistics are the only thing that remembers.
   *
   * Two problems have to be solved here rather than in the views:
   *
   *   1. A daily total is not a daily mean. Apple Health publishes steps as a
   *      counter that climbs through the day and resets at midnight, so its
   *      statistics are `mean` — the average height of a sawtooth, which is
   *      roughly half the day's steps. Drawing that as "steps per day" is
   *      wrong by a factor that looks plausible, which is the worst kind.
   *
   *   2. History arrives in two pieces. Imported history ends where live
   *      recording begins, and the design requires no visible seam.
   */

  /**
   * Daily totals for a counter that resets at midnight.
   *
   * The day's total is its **closing value**, and specifically not its
   * maximum. Checked against this pattern on a live instance:
   *
   *     day        last hour   day max   imported truth
   *     2026-08-05     11,240    11,240
   *     2026-08-06      6,415    11,240   <- max is yesterday's closing
   *     2026-08-07      4,902     6,415   <- and again
   *
   * A health sensor holds its last value forever, so at 00:05 the counter
   * still reads yesterday's total. That carried value is the largest number
   * in today's bucket, which makes `max` a one-day-lagged copy of the series
   * rather than the series. The last populated hour is past the carry and is
   * the real close.
   *
   * @param hourly [{ start, max }] ascending hourly buckets
   * @returns [{ day: "YYYY-MM-DD", start: ms, value, partial }]
   */
  MH.dailyTotals = (hourly, now) => {
    if (!hourly || !hourly.length) return [];
    const today = MH.dayKey(now || Date.now());
    const byDay = new Map();
    for (const b of hourly) {
      const v = b.max != null ? b.max : b.mean;
      if (v == null) continue;
      const key = MH.dayKey(b.start);
      const seen = byDay.get(key);
      /* Later hour wins outright — this is a closing value, not a maximum. */
      if (!seen || b.start >= seen.start) byDay.set(key, { start: b.start, value: v });
    }
    const out = [];
    for (const [day, got] of byDay) {
      out.push({ day, start: got.start, value: got.value, partial: day === today });
    }
    return out.sort((a, b) => a.start - b.start);
  };

  MH.dayKey = (ms) => {
    const d = new Date(ms);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
           "-" + String(d.getDate()).padStart(2, "0");
  };

  /**
   * Join an imported series to a live one without a seam.
   *
   * Where both cover a day the live series wins — it is the one still being
   * written, and the imported copy is a snapshot of the same thing. The
   * boundary is reported so a chart can say where it is rather than pretending
   * a single origin.
   */
  MH.spliceSeries = (older, newer) => {
    const by = new Map();
    for (const p of older || []) by.set(p.day || p.start, p);
    let seam = null;
    for (const p of newer || []) {
      const k = p.day || p.start;
      if (by.has(k) && seam == null) seam = p.start;
      by.set(k, p);
    }
    const pts = Array.from(by.values()).sort((a, b) => a.start - b.start);
    if (seam == null && (older || []).length && (newer || []).length) {
      seam = newer[0].start;
    }
    return { points: pts, seam };
  };

  /**
   * Which statistic can answer "the total each day" for a role, and how.
   *
   * Preference order, and each step is a real drop in confidence:
   *   sum    the integration keeps a proper total — believe it
   *   state  an imported daily series carrying the day's own value
   *   close  derived, per MH.dailyTotals
   */
  MH.totalStrategy = (meta) => {
    if (!meta) return null;
    if (meta.has_sum) return "sum";
    if (meta.has_mean) return "close";
    return null;
  };

  /**
   * Fetch a series for charting.
   *
   * `period` is the recorder's, and the type asked for follows the strategy:
   * a mean series is fetched as `max` at hourly resolution and folded down to
   * daily closes, everything else is read directly.
   */
  MH.fetchSeries = async (hass, statId, opts) => {
    opts = opts || {};
    const now = opts.now || Date.now();
    const days = opts.days || 30;
    const mode = opts.mode || "mean";     // mean | daily_total | monthly
    const start = new Date(now - days * DAY).toISOString();

    const ask = async (period, types) => {
      try {
        const r = await hass.callWS({
          type: "recorder/statistics_during_period",
          start_time: start, statistic_ids: [statId], period, types
        });
        return (r && r[statId]) || [];
      } catch (e) { return []; }
    };

    if (mode === "daily_total") {
      /* Hourly, because the fold needs to know which bucket was last. */
      const hourly = await ask("hour", ["max"]);
      if (hourly.length) return MH.dailyTotals(hourly, now);
      const daily = await ask("day", ["sum", "state"]);
      return daily.map((b) => ({
        day: MH.dayKey(b.start), start: b.start,
        value: b.state != null ? b.state : b.sum, partial: false
      })).filter((p) => p.value != null);
    }

    const period = mode === "monthly" ? "month" : "day";
    const rows = await ask(period, ["mean", "min", "max"]);
    return rows
      .filter((b) => b.mean != null)
      .map((b) => ({ start: b.start, value: b.mean, min: b.min, max: b.max }));
  };

  /** Min/max/last over a series, for axes and captions. */
  MH.extent = (points, key) => {
    const k = key || "value";
    const vals = (points || []).map((p) => p[k]).filter((v) => v != null);
    if (!vals.length) return null;
    return { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals),
             first: vals[0], last: vals[vals.length - 1], n: vals.length };
  };

  /** Change over the window, as the design's "Down 0.4 kg over 30 days". */
  MH.trend = (points) => {
    const e = MH.extent(points);
    if (!e || e.n < 2) return null;
    const delta = e.last - e.first;
    return { delta, up: delta > 0, flat: Math.abs(delta) < 1e-9 };
  };

  /* ------------------------------------------------------------------ *
   * Charts
   * ------------------------------------------------------------------ *
   *
   * Inline SVG, no library. Each returns a node with an `update(points)` so a
   * chart redraws without being rebuilt and without restarting its draw-in.
   *
   * The design's rule is that charts are supporting evidence, never the
   * primary read — so these are deliberately plain: no tooltips competing with
   * the headline number, no gridline noise, and an axis that labels the ends
   * rather than every tick.
   */

  const NS = "http://www.w3.org/2000/svg";

  /** Map a series into a viewBox, with a little headroom so a peak is not
   *  glued to the top edge. */
  const scaler = (points, w, h, opts) => {
    opts = opts || {};
    const xs = points.map((p) => p.start);
    let lo = opts.min, hi = opts.max;
    if (lo == null || hi == null) {
      const e = MH.extent(points);
      const pad = (e.max - e.min) * 0.12 || Math.abs(e.max || 1) * 0.1 || 1;
      if (lo == null) lo = opts.zero ? 0 : e.min - pad;
      if (hi == null) hi = e.max + pad;
    }
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const span = x1 - x0 || 1;
    return {
      lo, hi,
      x: (t) => ((t - x0) / span) * w,
      y: (v) => h - ((v - lo) / (hi - lo || 1)) * h
    };
  };

  const path = (points, s) => points.map((p, i) =>
    (i ? "L" : "M") + s.x(p.start).toFixed(1) + " " + s.y(p.value).toFixed(1)).join(" ");

  /**
   * A line chart.
   *
   * `drawLine` animates stroke-dashoffset from the path's own length, which is
   * measured after the path is in the DOM — a fixed dash length would either
   * clip a long series or leave a short one already drawn.
   */
  MH.lineChart = (opts) => {
    opts = opts || {};
    const H = opts.height || 230, W = 1000;
    /* The axis is a sibling of the plot, not a child: the plot box clips to
       its own height so a line cannot escape it, and an axis inside that box
       is clipped along with it. */
    const root = MH.el("div");
    const wrap = MH.el("div", "chart");
    wrap.style.height = H + "px";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "plot");

    const bands = document.createElementNS(NS, "g");
    const grid = document.createElementNS(NS, "g");
    const lines = document.createElementNS(NS, "g");
    svg.appendChild(bands); svg.appendChild(grid); svg.appendChild(lines);
    wrap.appendChild(svg);

    const axis = MH.el("div", "axis");
    MH.add(root, wrap, axis);

    let drawn = null;

    root.update = (series, cfg) => {
      cfg = cfg || {};

      /* `set hass` fires on every state change anywhere in the instance — a
         busy house does that several times a second. Redrawing here reapplies
         `drawLine` to every path, so the charts visibly re-animate over and
         over. Nothing below depends on anything but the data, so an unchanged
         signature means there is nothing to do. */
      const sig = JSON.stringify([
        series.map((s) => [s.color, s.width,
                           (s.points || []).map((p) => [p.start, p.value])]),
        cfg.target, cfg.bands, cfg.min, cfg.max
      ]);
      if (sig === drawn) return;
      drawn = sig;

      while (lines.firstChild) lines.removeChild(lines.firstChild);
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      while (bands.firstChild) bands.removeChild(bands.firstChild);
      axis.textContent = "";

      const all = [].concat.apply([], series.map((s) => s.points || []));
      if (!all.length) {
        axis.appendChild(MH.el("span", "axis-tick", "no history yet"));
        return;
      }
      const s = scaler(all, W, H, cfg);

      /* Clinical bands sit behind everything — the chart says which zone the
         line is in, which is the whole reason the Heart chart exists. */
      for (const b of cfg.bands || []) {
        const yTop = s.y(Math.min(b.to, s.hi)), yBot = s.y(Math.max(b.from, s.lo));
        if (yBot <= yTop) continue;
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", 0); r.setAttribute("width", W);
        r.setAttribute("y", yTop.toFixed(1));
        r.setAttribute("height", (yBot - yTop).toFixed(1));
        r.setAttribute("fill", b.color);
        bands.appendChild(r);
      }

      /* Horizontal rules at the ends and middle. Three, not ten. */
      for (const v of [s.lo, (s.lo + s.hi) / 2, s.hi]) {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", 0); l.setAttribute("x2", W);
        l.setAttribute("y1", s.y(v).toFixed(1)); l.setAttribute("y2", s.y(v).toFixed(1));
        l.setAttribute("class", "gridline");
        grid.appendChild(l);
      }

      if (cfg.target != null && cfg.target >= s.lo && cfg.target <= s.hi) {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", 0); l.setAttribute("x2", W);
        l.setAttribute("y1", s.y(cfg.target).toFixed(1));
        l.setAttribute("y2", s.y(cfg.target).toFixed(1));
        l.setAttribute("class", "target");
        grid.appendChild(l);
      }

      series.forEach((ser, i) => {
        const pts = (ser.points || []).filter((p) => p.value != null);
        if (pts.length < 2) return;
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", path(pts, s));
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", ser.color);
        p.setAttribute("stroke-width", ser.width || 3);
        p.setAttribute("stroke-linejoin", "round");
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("vector-effect", "non-scaling-stroke");
        lines.appendChild(p);
        const len = p.getTotalLength ? p.getTotalLength() : 1000;
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
        p.style.animation = `drawLine 1.6s ease ${(i * 0.1).toFixed(2)}s forwards`;
      });

      const fmt = cfg.axisFormat || MH.monthYear;
      axis.appendChild(MH.el("span", "axis-tick", fmt(all[0].start)));
      axis.appendChild(MH.el("span", "axis-tick", fmt(all[all.length - 1].start)));
    };
    return root;
  };

  /**
   * The 30-day bar chart.
   *
   * Bars are coloured against the current goal rather than a fixed threshold,
   * so changing the goal recolours the history — the design is explicit about
   * that. Today's bar is hatched: it is a partial day and drawing it solid
   * would read as a bad day rather than an unfinished one.
   */
  MH.barChart = (opts) => {
    opts = opts || {};
    const wrap = MH.el("div", "bars");
    wrap.style.height = (opts.height || 230) + "px";
    const axis = MH.el("div", "axis");
    const holder = MH.el("div", "bars-row");
    const root = MH.el("div");
    MH.add(root, wrap, axis);
    MH.add(wrap, holder);

    let drawn = null;

    root.update = (points, cfg) => {
      cfg = cfg || {};
      /* Same reason as the line chart: rebuilding thirty nodes on every state
         change in the house is work nobody asked for. */
      const sig = JSON.stringify([(points || []).map((p) => [p.start, p.value, p.partial]),
                                  cfg.goal]);
      if (sig === drawn) return;
      drawn = sig;

      holder.textContent = "";
      axis.textContent = "";
      if (!points || !points.length) {
        axis.appendChild(MH.el("span", "axis-tick", "no history yet"));
        return;
      }
      const goal = cfg.goal || null;
      const e = MH.extent(points);
      const top = Math.max(e.max, goal || 0) * 1.05 || 1;
      for (const p of points) {
        const b = MH.el("i", "daybar");
        b.style.height = Math.max(2, (p.value / top) * 100) + "%";
        const met = goal ? p.value >= goal : false;
        b.style.background = met ? "var(--green)" : "var(--green-light)";
        if (p.partial) b.classList.add("partial");
        b.title = `${p.day}: ${MH.group(p.value, 0)}` + (p.partial ? " so far today" : "");
        MH.add(holder, b);
      }
      const d = (k) => {
        const x = new Date(k);
        return x.getDate() + " " + x.toLocaleString(undefined, { month: "short" });
      };
      axis.appendChild(MH.el("span", "axis-tick", d(points[0].start)));
      axis.appendChild(MH.el("span", "axis-tick", d(points[points.length - 1].start)));
    };
    return root;
  };

  /** A sparkline for a vitals card — 26px tall, no axis, no scale. */
  MH.sparkline = (color, height) => {
    const svg = document.createElementNS(NS, "svg");
    const H = height || 26, W = 200;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "spark");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", 2);
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(p);
    let drawn = null;
    svg.update = (points) => {
      const pts = (points || []).filter((x) => x.value != null);
      const sig = JSON.stringify(pts.map((x) => [x.start, x.value]));
      if (sig === drawn) return;
      drawn = sig;
      if (pts.length < 2) { p.removeAttribute("d"); return; }
      p.setAttribute("d", path(pts, scaler(pts, W, H - 4, {})));
    };
    return svg;
  };

  /** The four-segment clinical axis, shared by the BP card and the Heart tab. */
  MH.BP_SEGMENTS = [
    { key: "normal", label: "Normal", flex: 3, color: "#a8ddc7", from: 0, to: 120 },
    { key: "elevated", label: "Elevated", flex: 1, color: "#f6dfa0", from: 120, to: 130 },
    { key: "stage1", label: "Stage 1", flex: 2, color: "#eeb0a0", from: 130, to: 140 },
    { key: "stage2", label: "Stage 2", flex: 2, color: "#c0334d", from: 140, to: 200 }
  ];

  /* ------------------------------------------------------------------ *
   * Body, Heart and Movement
   * ------------------------------------------------------------------ *
   *
   * The three history views. Each follows the same shape as Today: build once,
   * update in place, and let a role that resolved to nothing produce a gap
   * rather than an absence.
   *
   * Charts are the one thing here that cannot be drawn from `hass.states` —
   * they need statistics, which is a websocket round trip. So each view
   * exposes `series()` naming what it wants, the card fetches once on mount,
   * and the view is handed the answer. A view never fetches for itself, or
   * switching tabs twice would queue four round trips.
   */

  const hideIf2 = (n, h) => { n.style.display = h ? "none" : ""; };

  /** Header row shared by every chart card: title, then a range selector. */
  const chartHead = (title, ranges, onPick) => {
    const head = MH.el("div", "head");
    const picker = MH.el("div", "ranges");
    const buttons = {};
    for (const r of ranges) {
      const b = MH.el("button", "range", r.label);
      b.type = "button";
      b.addEventListener("click", () => {
        for (const k in buttons) buttons[k].setAttribute("aria-selected", k === r.key ? "true" : "false");
        onPick(r);
      });
      buttons[r.key] = b;
      MH.add(picker, b);
    }
    buttons[ranges[0].key].setAttribute("aria-selected", "true");
    MH.add(head, MH.el("div", "title", title), picker);
    return head;
  };

  const statTile = (label) => {
    const t = MH.el("div", "tile");
    const v = MH.el("div", "stat-value", "—");
    MH.add(t, v, MH.el("div", "stat-caption", label));
    t.set = (text) => { v.textContent = text; };
    return t;
  };

  /* ------------------------------------------------------------------ *
   * Body
   * ------------------------------------------------------------------ */
  MH.bodyView = () => {
    const view = MH.el("div", "view");

    /* --- current weight, the hero --- */
    const hero = MH.el("div", "card hero");
    const heroEyebrow = MH.el("div", "eyebrow", "");
    const heroValue = MH.el("div", "metric hero-metric", "—");
    const targetRow = MH.el("div", "between");
    const targetLeft = MH.el("div", "support", "");
    const targetRight = MH.el("div", "support", "");
    MH.add(targetRow, targetLeft, targetRight);
    const targetBar = MH.bar(0);
    targetBar.style.height = "8px";
    const heroNote = MH.el("div", "support", "");
    const comp = MH.el("div", "grid2");
    const tiles = {
      fat_mass: statTile("Fat mass"), fat_free_mass: statTile("Fat-free mass"),
      muscle_mass: statTile("Muscle"), bone_mass: statTile("Bone")
    };
    for (const k in tiles) MH.add(comp, tiles[k]);
    MH.add(hero, heroEyebrow, heroValue, targetRow, targetBar, heroNote,
           MH.el("div", "hr"), comp);

    /* --- weight over time --- */
    const chartCard = MH.el("div", "card");
    const chart = MH.lineChart({ height: 230 });
    let weightRange = { key: "90d", label: "90D", days: 90, mode: "mean" };
    const chartLegend = MH.el("div", "support", "");
    MH.add(chartCard, chartHead("Weight", [
      { key: "90d", label: "90D", days: 90, mode: "mean" },
      { key: "1y", label: "1Y", days: 365, mode: "monthly" },
      { key: "all", label: "All", days: 6000, mode: "monthly" }
    ], (r) => { weightRange = r; view.request(); }), chart, chartLegend);

    /* --- body fat, and the three-series composition chart --- */
    const fatCard = MH.el("div", "card");
    const fatValue = MH.el("div", "metric", "—");
    const fatChart = MH.lineChart({ height: 150 });
    const fatHead = MH.el("div", "head");
    MH.add(fatHead, MH.el("div", "title", "Body fat"), fatValue);
    MH.add(fatCard, fatHead, fatChart);

    const compCard = MH.el("div", "card");
    const compChart = MH.lineChart({ height: 150 });
    const compLegend = MH.el("div", "legend");
    MH.add(compCard, MH.el("div", "title", "Fat, lean and muscle"), compChart, compLegend);

    const r1 = MH.el("div", "row hero-left");
    MH.add(r1, hero, chartCard);
    const r2 = MH.el("div", "row two");
    MH.add(r2, fatCard, compCard);
    const note = MH.el("div", "note");
    const noteText = MH.el("div", "note-text", "");
    MH.add(note, MH.el("div", "eyebrow", "History"), noteText);
    MH.add(view, r1, r2, note);

    view.series = () => [
      { key: "weight", role: "weight", days: weightRange.days, mode: weightRange.mode },
      { key: "fat_ratio", role: "fat_ratio", days: 6000, mode: "monthly" },
      { key: "fat_mass", role: "fat_mass", days: 6000, mode: "monthly" },
      { key: "fat_free_mass", role: "fat_free_mass", days: 6000, mode: "monthly" },
      { key: "muscle_mass", role: "muscle_mass", days: 6000, mode: "monthly" }
    ];

    view.update = (R, now, S) => {
      S = S || {};
      const w = R.weight;
      const has = MH.readable(w);
      hideIf2(hero, !w.entity_id);
      if (has) {
        const value = MH.valueIn(w);
        heroEyebrow.textContent = ["Current", MH.ageLabel(w, now)].filter(Boolean).join(" · ");
        heroValue.textContent = MH.group(value, 1) + " kg";
        const goal = MH.readable(R.weight_goal) ? MH.valueIn(R.weight_goal) : null;
        hideIf2(targetRow, goal == null);
        hideIf2(targetBar, goal == null);
        if (goal != null) {
          targetLeft.textContent = "Target " + MH.group(goal, 1) + " kg";
          targetRight.textContent = MH.group(value - goal, 1) + " kg to go";
          /* Progress is how far from start to target, and there is no start —
             so show the gap as a proportion of the current reading instead of
             inventing a baseline the user never set. */
          const frac = goal > 0 ? Math.max(0, Math.min(1, goal / value)) : 0;
          targetBar.firstChild.style.width = (frac * 100).toFixed(1) + "%";
        }
        const t = MH.trend(S.weight);
        heroNote.textContent = t && !t.flat
          ? (t.up ? "Up " : "Down ") + MH.group(Math.abs(t.delta), 1) +
            " kg over the last " + weightRange.label.toLowerCase()
          : "";
      } else {
        heroEyebrow.textContent = "Current";
        heroValue.textContent = "—";
        heroNote.textContent = MH.gapReason(w, now);
        hideIf2(targetRow, true); hideIf2(targetBar, true);
      }

      for (const k in tiles) {
        const r = R[k];
        tiles[k].set(MH.readable(r) ? MH.group(MH.valueIn(r), 2) + " kg" : "—");
        tiles[k].style.opacity = MH.readable(r) ? "" : ".5";
      }

      const goal = MH.readable(R.weight_goal) ? MH.valueIn(R.weight_goal) : null;
      chart.update([{ points: S.weight || [], color: "var(--blue)" }], { target: goal });
      chartLegend.textContent = (S.weight || []).length
        ? (S.weight.length + " points · " + weightRange.label) : "";

      fatValue.textContent = MH.readable(R.fat_ratio)
        ? MH.group(MH.valueIn(R.fat_ratio), 2) + " %" : "—";
      fatChart.update([{ points: S.fat_ratio || [], color: "var(--red)" }], {});

      compChart.update([
        { points: S.fat_free_mass || [], color: "var(--gold)" },
        { points: S.muscle_mass || [], color: "var(--coral)" },
        { points: S.fat_mass || [], color: "var(--blue)" }
      ], {});
      compLegend.textContent = "";
      for (const [k, c, label] of [["fat_free_mass", "var(--gold)", "Fat-free"],
                                   ["muscle_mass", "var(--coral)", "Muscle"],
                                   ["fat_mass", "var(--blue)", "Fat"]]) {
        const g = MH.el("div", "legend-item");
        const sw = MH.el("span", "swatch"); sw.style.background = c;
        MH.add(g, sw, MH.el("span", "legend-label", label),
               MH.el("span", "legend-value",
                     MH.readable(R[k]) ? MH.group(MH.valueIn(R[k]), 1) : "—"));
        MH.add(compLegend, g);
      }

      const e = MH.extent(S.weight);
      const span = (S.fat_ratio || []).length ? MH.extent(S.fat_ratio) : null;
      noteText.textContent = span && S.fat_ratio.length
        ? "Monthly means back to " + MH.monthYear(S.fat_ratio[0].start) +
          ". Gaps in the middle are real — they are months with no reading, not missing data."
        : (e ? "Monthly means from the recorder's long-term statistics." : "");
      hideIf2(note, !e && !span);
    };
    return view;
  };

  /* ------------------------------------------------------------------ *
   * Heart
   * ------------------------------------------------------------------ */
  MH.heartView = () => {
    const view = MH.el("div", "view");

    const hero = MH.el("div", "card hero vital bad");
    const heroHead = MH.el("div", "head");
    const heroEyebrow = MH.el("div", "eyebrow", "Blood pressure");
    const heroBadge = MH.el("span", "badge");
    MH.add(heroHead, heroEyebrow, heroBadge);
    const heroValue = MH.el("div", "metric hero-metric", "—");
    const rangeBar = MH.el("div", "range-bar");
    const rangeAxis = MH.el("div", "range-axis");
    for (const s of MH.BP_SEGMENTS) {
      const i = MH.el("i"); i.style.flex = s.flex; i.style.background = s.color;
      MH.add(rangeBar, i);
      const l = MH.el("span", "axis-tick", s.label); l.style.flex = s.flex;
      MH.add(rangeAxis, l);
    }
    const heroBody = MH.el("div", "body",
      "A single reading moves with the time of day, the cuff and the five " +
      "minutes beforehand. The shape of a year is the thing worth reading.");
    const pulseRow = MH.el("div", "between");
    const pulseLeft = MH.el("div", "support", "");
    const pulseRight = MH.el("div", "support", "");
    MH.add(pulseRow, pulseLeft, pulseRight);
    MH.add(hero, heroHead, heroValue, rangeBar, rangeAxis, heroBody,
           MH.el("div", "hr"), pulseRow);

    const chartCard = MH.el("div", "card");
    const chart = MH.lineChart({ height: 230 });
    let bpRange = { key: "1y", label: "1Y", days: 365, mode: "monthly" };
    MH.add(chartCard, chartHead("Blood pressure", [
      { key: "1y", label: "1Y", days: 365, mode: "monthly" },
      { key: "5y", label: "5Y", days: 1825, mode: "monthly" },
      { key: "all", label: "All", days: 6000, mode: "monthly" }
    ], (r) => { bpRange = r; view.request(); }), chart);

    const VITALS = [
      { key: "resting_hr", title: "Resting heart rate", color: "var(--green)",
        band: (v) => MH.hrBand(v), unit: "bpm", dp: 0 },
      { key: "sleep_duration", title: "Sleep", color: "var(--blue)", unit: "h", dp: 1 },
      { key: "spo2", title: "Blood oxygen", color: "var(--blue)",
        band: (v) => MH.spo2Band(v), unit: "%", dp: 1 },
      { key: "hrv", title: "HRV (SDNN)", color: "var(--gold)", unit: "ms", dp: 1 }
    ];
    const vitalCards = {};
    const r2 = MH.el("div", "row four");
    for (const spec of VITALS) {
      const c = MH.el("div", "card vital");
      const head = MH.el("div", "head");
      const badge = MH.el("span", "badge");
      MH.add(head, MH.el("div", "eyebrow", spec.title), badge);
      const value = MH.el("div", "metric", "—");
      const spark = MH.sparkline(spec.color);
      const support = MH.el("div", "support", "");
      MH.add(c, head, value, spark, support);
      vitalCards[spec.key] = { card: c, badge, value, spark, support, spec };
      MH.add(r2, c);
    }

    const r1 = MH.el("div", "row hero-left");
    MH.add(r1, hero, chartCard);
    MH.add(view, r1, r2);

    view.series = () => [
      { key: "systolic", role: "systolic", days: bpRange.days, mode: "monthly" },
      { key: "diastolic", role: "diastolic", days: bpRange.days, mode: "monthly" },
      { key: "resting_hr", role: "resting_hr", days: 365, mode: "mean" },
      { key: "sleep_duration", role: "sleep_duration", days: 365, mode: "mean" },
      { key: "spo2", role: "spo2", days: 365, mode: "mean" },
      { key: "hrv", role: "hrv", days: 365, mode: "mean" }
    ];

    view.update = (R, now, S) => {
      S = S || {};
      const s = R.systolic, d = R.diastolic;
      const ok = MH.readable(s) && MH.readable(d);
      hideIf2(hero, !s.entity_id && !d.entity_id);
      if (ok) {
        const sys = MH.valueIn(s), dia = MH.valueIn(d);
        const band = MH.bpBand(sys, dia);
        hero.className = "card hero vital " + band.tone;
        heroEyebrow.textContent = ["Blood pressure", MH.ageLabel(s, now)].filter(Boolean).join(" · ");
        heroValue.textContent = MH.group(sys, 0) + "/" + MH.group(dia, 0);
        heroValue.style.color = band.tone === "bad" ? "var(--red-text)" : "";
        heroBadge.className = "badge " + band.tone;
        heroBadge.textContent = band.label;
        for (const i of rangeBar.children) i.style.opacity = ".35";
        const idx = MH.BP_SEGMENTS.findIndex((x) => x.key === band.key);
        if (idx >= 0) rangeBar.children[idx].style.opacity = "1";
      } else {
        hero.className = "card hero vital gap";
        heroValue.textContent = "—";
        heroBadge.className = "badge gap"; heroBadge.textContent = "Gap";
        heroEyebrow.textContent = "Blood pressure";
      }
      pulseLeft.textContent = MH.readable(R.cuff_pulse)
        ? "Resting pulse " + MH.group(MH.valueIn(R.cuff_pulse), 0) + " bpm" : "";
      /* A mean over the window, not the latest bucket — the label says mean
         and the last monthly point is not one. */
      const avg = (pts) => {
        const vs = (pts || []).map((p) => p.value).filter((x) => x != null);
        return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
      };
      const ms = avg(S.systolic), md = avg(S.diastolic);
      pulseRight.textContent = ms != null && md != null
        ? bpRange.label + " mean " + MH.group(ms, 0) + "/" + MH.group(md, 0) : "";

      chart.update([
        { points: S.systolic || [], color: "var(--red)" },
        { points: S.diastolic || [], color: "var(--gold)" }
      ], { bands: MH.BP_SEGMENTS.map((b) => ({ from: b.from, to: b.to, color: b.color + "33" })) });

      for (const key in vitalCards) {
        const v = vitalCards[key], r = R[key], spec = v.spec;
        const good = MH.readable(r);
        v.card.className = "card vital" + (good ? "" : " gap");
        if (good) {
          const val = MH.valueIn(r);
          const band = spec.band ? spec.band(val) : null;
          v.card.classList.add(band ? band.tone : "info");
          v.value.textContent = MH.group(val, spec.dp) + " " + spec.unit;
          v.badge.className = "badge " + (band ? band.tone : "info");
          v.badge.textContent = band ? band.label : "";
          hideIf2(v.badge, !band);
          const pts = S[key] || [];
          v.spark.update(pts);
          hideIf2(v.spark, pts.length < 2);
          const e = MH.extent(pts);
          v.support.textContent = e && e.n > 2
            ? "Range " + MH.group(e.min, spec.dp) + "–" + MH.group(e.max, spec.dp) +
              " over " + e.n + " days"
            : (MH.ageLabel(r, now) || "");
        } else {
          v.value.textContent = "—";
          v.badge.className = "badge gap"; v.badge.textContent = "Gap";
          hideIf2(v.badge, false);
          hideIf2(v.spark, true);
          v.support.textContent = MH.gapReason(r, now);
        }
      }
    };
    return view;
  };

  /* ------------------------------------------------------------------ *
   * Movement
   * ------------------------------------------------------------------ */
  MH.movementView = (config) => {
    const view = MH.el("div", "view");

    const hero = MH.el("div", "card hero vital good");
    const heroEyebrow = MH.el("div", "eyebrow", "Steps today");
    const heroValue = MH.el("div", "metric hero-metric", "—");
    const heroBar = MH.bar(0); heroBar.style.height = "8px";
    const heroNote = MH.el("div", "support", "");
    const grid = MH.el("div", "grid2");
    const mTiles = { avg: statTile("7-day average"), best: statTile("Best in 30 days"),
                     climbed: statTile("Climbed today"), energy: statTile("Active calories") };
    for (const k in mTiles) MH.add(grid, mTiles[k]);
    MH.add(hero, heroEyebrow, heroValue, heroBar, heroNote, MH.el("div", "hr"), grid);

    const barsCard = MH.el("div", "card");
    const bars = MH.barChart({ height: 230 });
    const barsLegend = MH.el("div", "legend");
    for (const [c, label] of [["var(--green)", "Goal met"], ["var(--green-light)", "Under goal"]]) {
      const g = MH.el("div", "legend-item");
      const sw = MH.el("span", "swatch"); sw.style.background = c;
      MH.add(g, sw, MH.el("span", "legend-label", label));
      MH.add(barsLegend, g);
    }
    MH.add(barsCard, MH.el("div", "head"), bars, barsLegend);
    barsCard.firstChild.appendChild(MH.el("div", "title", "Steps · last 30 days"));
    const barsNote = MH.el("div", "support", "");
    barsCard.firstChild.appendChild(barsNote);

    const treadCard = MH.el("div", "card");
    const treadHead = MH.el("div", "head");
    const treadChip = MH.el("div", "chip");
    const treadDot = MH.el("span", "dot green pulse");
    const treadText = MH.el("span", "chip-text", "");
    MH.add(treadChip, treadDot, treadText);
    MH.add(treadHead, MH.el("div", "title", "Treadmill"), treadChip);
    const treadGrid = MH.el("div", "tiles");
    const tTiles = { walks: statTile("Walks this week"), time: statTile("Time walked"),
                     dist: statTile("Distance this week"), cal: statTile("Calories this week"),
                     month: statTile("Distance this month") };
    for (const k in tTiles) MH.add(treadGrid, tTiles[k]);
    MH.add(treadCard, treadHead, treadGrid);

    const r1 = MH.el("div", "row hero-left");
    MH.add(r1, hero, barsCard);
    MH.add(view, r1, treadCard);

    view.series = () => [
      { key: "steps", role: "steps", days: 30, mode: "daily_total" },
      { key: "active_energy", role: "active_energy", days: 30, mode: "daily_total" }
    ];

    view.update = (R, now, S) => {
      S = S || {};
      const st = R.steps;
      const ok = MH.readable(st);
      hideIf2(hero, !st.entity_id);
      const goal = MH.readable(R.step_goal) ? MH.valueIn(R.step_goal)
                 : ((config || {}).step_goal || 10000);
      if (ok) {
        const v = MH.valueIn(st);
        const p = MH.progress(v, goal);
        heroEyebrow.textContent = ["Steps today", MH.ageLabel(st, now)].filter(Boolean).join(" · ");
        heroValue.textContent = MH.group(v, 0);
        heroBar.firstChild.style.width = p.pct + "%";
        const dist = MH.readable(R.distance) ? MH.valueIn(R.distance) : null;
        heroNote.textContent = [
          p.met ? MH.group(v - goal, 0) + " over " + MH.group(goal, 0)
                : MH.group(goal - v, 0) + " to " + MH.group(goal, 0),
          dist != null ? MH.group(dist, 1) + " km walked" : null
        ].filter(Boolean).join(" · ");
      } else {
        heroValue.textContent = "—";
        heroNote.textContent = MH.gapReason(st, now);
      }

      /* The 30-day series, and the four tiles that read off it. */
      const pts = (S.steps || []).filter((p) => !p.partial);
      const e = MH.extent(pts);
      const last7 = pts.slice(-7);
      mTiles.avg.set(last7.length
        ? MH.group(last7.reduce((n, p) => n + p.value, 0) / last7.length, 0) : "—");
      mTiles.best.set(e ? MH.group(e.max, 0) : "—");
      mTiles.climbed.set(MH.readable(R.flights_climbed)
        ? MH.group(MH.valueIn(R.flights_climbed), 0) + " m" : "—");
      mTiles.energy.set(MH.readable(R.active_energy)
        ? MH.group(MH.valueIn(R.active_energy), 0) : "—");

      bars.update(S.steps || [], { goal });
      barsNote.textContent = (S.steps || []).length
        ? "Daily closing totals · goal " + MH.group(goal, 0) : "";

      const keys = ["treadmill_walks_week", "treadmill_time_week", "treadmill_distance_week",
                    "treadmill_calories_week", "treadmill_distance_month"];
      const anyTread = keys.some((k) => MH.showable(R[k])) || MH.showable(R.treadmill_state);
      hideIf2(treadCard, !anyTread);
      const state = MH.showable(R.treadmill_state) ? String(R.treadmill_state.value) : null;
      const active = state && /run|active|walking|workout/i.test(state);
      treadText.textContent = state ? (active ? "Active" : "Idle · ready") : "";
      treadDot.style.opacity = active ? "" : ".55";
      const put = (tile, key, fmt) => {
        const r = R[key];
        tile.set(MH.showable(r) ? fmt(MH.valueIn(r)) : "—");
        tile.style.opacity = MH.readable(r) ? "" : (MH.showable(r) ? ".5" : ".5");
      };
      put(tTiles.walks, "treadmill_walks_week", (v) => MH.group(v, 0));
      put(tTiles.time, "treadmill_time_week", (v) => MH.group(v, 0) + " min");
      put(tTiles.dist, "treadmill_distance_week", (v) => MH.group(v, 1) + " km");
      put(tTiles.cal, "treadmill_calories_week", (v) => MH.group(v, 0));
      put(tTiles.month, "treadmill_distance_month", (v) => MH.group(v, 1) + " km");
    };
    return view;
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

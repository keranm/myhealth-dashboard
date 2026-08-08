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

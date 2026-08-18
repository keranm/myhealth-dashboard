
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

    /* --- Strength work ---------------------------------------------- *
     * A daily budget of small sets — press-ups, sit-ups, calf raises — planned
     * by a ramp that adapts weekly, and counted either by a tap or by a phone
     * on the floor watching a face come down towards it. Written by GROOVE.
     *
     * Reps are the best-behaved metric on this page, and it is worth saying why,
     * because every other role here is shaped by the opposite problem. A health
     * sensor holds its last value forever, which is what 04-freshness.js exists
     * to survive. A rep is an event with a real timestamp at the moment it
     * happened, accumulated by a utility_meter that resets at midnight — so a
     * daily count of 0 at 09:00 genuinely means none yet today, not "the phone
     * has not synced". The one-day windows below are therefore honest.
     *
     * `group` is deliberately NOT used, despite these six describing one day's
     * plan. The coherence pass resolves a group from a single source, and these
     * legitimately come from two — the totals are min_max helpers, the
     * derived figures are template helpers. Coherence is enforced by naming
     * instead: every match below *requires* the "groove" token, so they cannot
     * be filled from two different producers. That is a stronger guarantee than
     * the group pass gives, not a weaker one.
     *
     * Absent is the ordinary case for anyone who does not run GROOVE, and these
     * degrade to GAP like everything else. */
    { key: "strength_target_today", label: "Strength target today", tab: "today",
      unit: "reps", window: 1,
      stamp: [["groove", "last", "logged"]],
      match: { units: ["reps"], any: [["groove", "target", "total"]] } },

    { key: "strength_done_today", label: "Strength done today", tab: "today",
      unit: "reps", window: 1,
      stamp: [["groove", "last", "logged"]],
      match: { units: ["reps"], any: [["groove", "done", "total"]] } },

    { key: "strength_remaining", label: "Strength still to do", tab: "today",
      unit: "reps", window: 1,
      stamp: [["groove", "last", "logged"]],
      match: { units: ["reps"], any: [["groove", "remaining"]],
               not: ["pushups", "situps", "calf"] } },

    { key: "strength_progress", label: "Strength progress", tab: "today",
      unit: "%", window: 1,
      stamp: [["groove", "last", "logged"]],
      match: { units: ["%"], any: [["groove", "progress"]] } },

    /* What the next nudge would ask for. Two roles because the producing
       entities are two — a template helper cannot carry attributes, so the
       number and the movement are separate sensors computed from the same
       inputs. They update together and neither reads the other. */
    { key: "strength_next_ask", label: "Next set", tab: "today",
      unit: "reps", window: 1,
      stamp: [["groove", "last", "logged"]],
      match: { units: ["reps"], any: [["groove", "next", "ask"]] } },

    { key: "strength_next_exercise", label: "Next movement", tab: "today",
      unit: null, window: 1,
      stamp: [["groove", "last", "logged"]],
      match: { any: [["groove", "next", "exercise"]] } },

    { key: "strength_streak", label: "Strength streak", tab: "today",
      unit: "days", window: null,
      match: { units: ["days"], any: [["groove", "streak"]] } },

    /* --- Strength, per movement, on Movement ------------------------ *
     * `not: ["weekly", "monthly", "counted", "suggested", "remaining"]` is
     * load-bearing. A lifetime counter, a weekly rollup and a ramp suggestion
     * all carry the movement's name and the unit `reps`, and any of them would
     * resolve as today's count and read as plausible. Only the utility_meter on
     * a daily cycle is today's work. */
    { key: "pushups_daily", label: "Press-ups today", tab: "movement",
      unit: "reps", window: 1,
      stamp: [["groove", "last", "logged"]],
      match: { units: ["reps"], any: [["pushups", "daily"], ["press", "ups", "daily"]],
               not: ["weekly", "monthly", "counted", "suggested", "remaining", "target"] } },

    { key: "situps_daily", label: "Sit-ups today", tab: "movement",
      unit: "reps", window: 1,
      stamp: [["groove", "last", "logged"]],
      match: { units: ["reps"], any: [["situps", "daily"], ["sit", "ups", "daily"]],
               not: ["weekly", "monthly", "counted", "suggested", "remaining", "target"] } },

    { key: "calf_raises_daily", label: "Calf raises today", tab: "movement",
      unit: "reps", window: 1,
      stamp: [["groove", "last", "logged"]],
      match: { units: ["reps"], any: [["calf", "raises", "daily"]],
               not: ["weekly", "monthly", "counted", "suggested", "remaining", "target"] } },

    /* The second role that is a verb. `script.groove_log` takes an exercise and
       a number of reps and is the only supported way to record work, so the
       `Log now` action on Today has something real to call at last.

       Domain-restricted to `script` for the same reason coach_ask is: the token
       "log" appears on plenty of sensors that must never resolve here. */
    { key: "strength_log", label: "Log reps", tab: "today", unit: null, window: null,
      domain: /^script\./,
      match: { any: [["groove", "log"]] } },

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

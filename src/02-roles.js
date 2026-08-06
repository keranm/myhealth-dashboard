
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

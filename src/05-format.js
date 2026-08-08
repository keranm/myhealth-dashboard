
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

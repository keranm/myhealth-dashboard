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

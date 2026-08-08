
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

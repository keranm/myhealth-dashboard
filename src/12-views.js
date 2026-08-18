
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

    /* --- Strength ---------------------------------------------------- *
     * Press-ups, from GROOVE. Its roles resolved from the day they existed but
     * nothing rendered them, so the work was in the database and invisible on the
     * page — which is the same as not being recorded, from the reader's side.
     *
     * Built from the treadmill card's anatomy on purpose: same card, head, chip and
     * tiles, because this is another thing-that-counts-reps sitting beside a
     * thing-that-counts-kilometres, and it should not look like a different product. */
    const strengthCard = MH.el("div", "card");
    const strengthHead = MH.el("div", "head");
    const streakChip = MH.el("div", "chip");
    const streakDot = MH.el("span", "dot green");
    const streakText = MH.el("span", "chip-text", "");
    MH.add(streakChip, streakDot, streakText);
    MH.add(strengthHead, MH.el("div", "title", "Press-ups"), streakChip);

    const strengthValue = MH.el("div", "metric", "—");
    const strengthBar = MH.bar(0); strengthBar.style.height = "8px";
    const strengthNote = MH.el("div", "support", "");

    const sTiles = { done: statTile("Done today"), target: statTile("Target today"),
                     left: statTile("Still to do"), next: statTile("Next set") };
    const strengthGrid = MH.el("div", "tiles");
    for (const k in sTiles) MH.add(strengthGrid, sTiles[k]);

    const strengthBars = MH.barChart({ height: 150 });
    const strengthBarsNote = MH.el("div", "support", "");
    MH.add(strengthCard, strengthHead, strengthValue, strengthBar, strengthNote,
           MH.el("div", "hr"), strengthGrid, strengthBars, strengthBarsNote);

    const r1 = MH.el("div", "row hero-left");
    MH.add(r1, hero, barsCard);
    MH.add(view, r1, strengthCard, treadCard);

    view.series = () => [
      { key: "steps", role: "steps", days: 30, mode: "daily_total" },
      { key: "active_energy", role: "active_energy", days: 30, mode: "daily_total" },
      { key: "pushups", role: "pushups_daily", days: 30, mode: "daily_total" }
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

      /* Press-ups. Hidden entirely when GROOVE is not installed — the standalone
         rule, same as the treadmill card above it. */
      const sKeys = ["pushups_daily", "strength_target_today", "strength_remaining",
                     "strength_streak", "strength_next_ask"];
      hideIf2(strengthCard, !sKeys.some((k) => MH.showable(R[k])));

      const doneR = R.pushups_daily;
      const done = MH.showable(doneR) ? MH.valueIn(doneR) : null;
      const targetR = R.strength_target_today;
      const target = MH.showable(targetR) ? MH.valueIn(targetR) : null;

      /* The streak is the chip, not a tile. It is the number that makes somebody
         come back, and it belongs where the treadmill puts its status. */
      const streak = MH.showable(R.strength_streak) ? MH.valueIn(R.strength_streak) : null;
      streakText.textContent = streak != null
        ? (streak === 1 ? "1 day streak" : MH.group(streak, 0) + " day streak") : "";
      streakDot.style.opacity = streak ? "" : ".55";
      hideIf2(streakChip, streak == null);

      if (done != null && target) {
        const p = MH.progress(done, target);
        strengthValue.textContent = MH.group(done, 0) + " of " + MH.group(target, 0);
        strengthBar.firstChild.style.width = p.pct + "%";
        strengthNote.textContent = [
          p.met ? "Day complete" : MH.group(target - done, 0) + " still to do",
          MH.ageLabel(doneR, now)
        ].filter(Boolean).join(" · ");
      } else if (done != null) {
        /* A count with no target is still work done — say the number rather than a
           dash, and say why the rest is missing. */
        strengthValue.textContent = MH.group(done, 0);
        strengthBar.firstChild.style.width = "0%";
        strengthNote.textContent = "No target set for today";
      } else {
        strengthValue.textContent = "—";
        strengthBar.firstChild.style.width = "0%";
        strengthNote.textContent = MH.gapReason(doneR, now);
      }

      put(sTiles.done, "pushups_daily", (v) => MH.group(v, 0));
      put(sTiles.target, "strength_target_today", (v) => MH.group(v, 0));
      put(sTiles.left, "strength_remaining", (v) => MH.group(v, 0));
      put(sTiles.next, "strength_next_ask", (v) => MH.group(v, 0));

      strengthBars.update(S.pushups || [], { goal: target || 0 });
      strengthBarsNote.textContent = (S.pushups || []).length
        ? "Daily totals · last 30 days" : "";
    };
    return view;
  };

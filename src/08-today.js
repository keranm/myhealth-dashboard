
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
    input.disabled = true;
    const askBtn = el("button", "btn dark", "Ask");
    askBtn.disabled = true;
    askBtn.title = "Actions that write back arrive with the write path";
    add(ask, input, askBtn);

    add(main, legend, el("div", "hr"), eyebrow, headline, body, next, ask);
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
      hideIf(ask, !has);
    };
    return card;
  };

  /* ------------------------------------------------------------------ *
   * Medication
   * ------------------------------------------------------------------ *
   * Both states are built, behind a role that resolves nowhere yet — see
   * PLAN.md §4. The card appears the day a medication source exists.
   */
  const medicationCard = () => {
    const card = el("div", "card med-due");
    const head = el("div", "chip");
    const dot = el("span", "dot amber pulse");
    const eyebrow = el("div", "eyebrow", "Medication");
    const title = el("div", "med-title", "");
    const body = el("div", "med-body", "");
    const actions = el("div", "med-actions");
    const logBtn = el("button", "btn amber", "Log now");
    const snoozeBtn = el("button", "btn ghost", "Snooze 1h");
    for (const b of [logBtn, snoozeBtn]) {
      b.disabled = true;
      b.title = "Actions that write back arrive with the write path";
    }
    add(actions, logBtn, snoozeBtn);
    add(head, dot, eyebrow);
    add(card, head, title, body, actions);
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
        : "This card stays until today's entry arrives.";
      hideIf(actions, logged);
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

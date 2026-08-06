
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

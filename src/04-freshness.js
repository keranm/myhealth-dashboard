
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

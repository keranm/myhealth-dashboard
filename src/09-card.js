
  /* ------------------------------------------------------------------ *
   * The card element
   * ------------------------------------------------------------------ *
   *
   * One panel card owning the whole page: the sticky tab bar, the four views,
   * and a single resolver shared between them. A set of separate cards would
   * have left the tab bar without an owner and made every card repeat both the
   * resolution and its own statistics round trip.
   *
   * Two things happen on different clocks, and conflating them is the mistake
   * this file is arranged to avoid:
   *
   *   `set hass` fires on every state change anywhere in the instance, many
   *   times a second in a busy house. It re-resolves and updates text in place.
   *
   *   Measurement ages come from long-term statistics, which is a websocket
   *   round trip over ~40 entities. That happens once on mount and then on a
   *   slow timer — a reading's age does not change meaningfully between two
   *   state updates a second apart.
   */

  const VIEW_TITLES = { today: "Today", body: "Body", heart: "Heart", movement: "Movement" };

  /* How often to re-ask statistics for measurement ages. Ten minutes: long
     enough not to be chatty, short enough that a weigh-in shows up as fresh
     while the user is still standing next to the scale. */
  const AGE_REFRESH = 10 * 60 * 1000;

  /* `extends HTMLElement` is evaluated when the class is defined, not when it
     is instantiated, so naming it directly would throw the moment this file
     was required under node — and the harness exists precisely so the shipped
     file is the one under test. */
  const Base = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

  class MyHealthDashboardCard extends Base {
    constructor() {
      super();
      this._root = this.attachShadow({ mode: "open" });
      this._config = {};
      this._built = false;
      this._tab = "today";
      this._ages = { at: {}, floors: {} };
      this._agesAt = 0;
      this._fetching = false;
      this._resolved = null;
    }

    /* Lovelace calls this with the yaml. Config is optional in every part:
       an empty `type: custom:myhealth-dashboard` has to work, because
       discovery is the whole point. */
    setConfig(config) {
      this._config = Object.assign({}, config || {});
      if (this._config.tab && VIEW_TITLES[this._config.tab]) this._tab = this._config.tab;
      this._built = false;
      if (this._root) this._root.textContent = "";
      if (this._hass) this._render();
    }

    getCardSize() { return 12; }

    set hass(hass) {
      this._hass = hass;
      this._render();
    }

    connectedCallback() { if (this._hass) this._render(); }

    _build() {
      const style = document.createElement("style");
      style.textContent = MH.CSS;

      const bar = MH.el("div", "bar");
      const inner = MH.el("div", "bar-inner");
      const tabs = MH.el("div", "tabs");
      this._tabButtons = {};
      for (const key of MH.TABS) {
        const b = MH.el("button", "tab", VIEW_TITLES[key]);
        b.type = "button";
        b.setAttribute("role", "tab");
        b.addEventListener("click", () => this._select(key));
        this._tabButtons[key] = b;
        MH.add(tabs, b);
      }
      tabs.setAttribute("role", "tablist");

      const sync = MH.el("div", "sync");
      this._syncDot = MH.el("span", "dot pulse");
      this._syncText = MH.el("span", "sync-text", "");
      MH.add(sync, this._syncDot, this._syncText);
      MH.add(inner, tabs, sync);
      MH.add(bar, inner);

      this._views = {
        today: MH.todayView(this._config),
        body: MH.bodyView(),
        heart: MH.heartView(),
        movement: MH.movementView(this._config)
      };
      this._series = {};
      const holder = MH.el("div");
      for (const key of MH.TABS) {
        const v = this._views[key];
        /* A range selector changes what the view wants, so it asks for a
           refetch rather than reaching for the websocket itself. */
        v.request = () => { this._seriesFor(key, true); };
        MH.add(holder, v);
      }

      MH.add(this._root, style, bar, holder);
      this._built = true;
      this._paint();
    }

    _select(tab) {
      if (!VIEW_TITLES[tab] || tab === this._tab) return;
      this._tab = tab;
      this._paint();
      /* Re-run the entry animation for the view being shown, which is what
         the design means by "fires on view mount, not on every update". */
      const v = this._views[tab];
      for (const card of v.querySelectorAll(".card")) {
        card.style.animation = "none";
        void card.offsetWidth;
        card.style.animation = "";
      }
      this._update(true);
    }

    _paint() {
      for (const key of MH.TABS) {
        const on = key === this._tab;
        this._tabButtons[key].setAttribute("aria-selected", on ? "true" : "false");
        this._views[key].style.display = on ? "" : "none";
      }
    }

    _render() {
      if (!this._hass) return;
      if (!this._built) this._build();
      this._applyTheme();
      this._update();
      this._maybeFetchAges();
    }

    /* HA decides dark from the user's selected theme, not from the OS, so
       `prefers-color-scheme` alone would leave a dark-themed instance showing
       a white card. Stamping the host also pins the answer for a user whose
       HA theme and OS disagree. */
    _applyTheme() {
      const dark = this._hass.themes && this._hass.themes.darkMode;
      if (dark == null) return;
      this.setAttribute("data-theme", dark ? "dark" : "light");
    }

    /**
     * Has anything this card cares about actually changed?
     *
     * `set hass` fires on every state change in the instance — a doorbell, a
     * light, a power meter updating every second. Re-resolving 44 roles across
     * 1,500-odd entities on each of those is wasted work, and it made the
     * charts re-run their draw-in animation continuously.
     *
     * HA replaces the state object when an entity changes, so identity is a
     * sound and very cheap test. A change in the number of entities means
     * something was added or removed and discovery deserves another look.
     */
    _worthUpdating() {
      if (!this._resolved || !this._watch) return true;
      const s = this._hass.states;
      const ids = Object.keys(s);
      if (ids.length !== this._entityCount) return true;
      for (const id of this._watch) {
        if (s[id] !== this._seen[id]) return true;
      }
      return false;
    }

    /* Remember exactly what was read, so the next hass can be compared. */
    _rememberWatched() {
      const s = this._hass.states;
      const watch = [];
      for (const key in this._resolved) {
        const r = this._resolved[key];
        if (r.entity_id) watch.push(r.entity_id);
      }
      /* Stamps are read for measurement times but are not a role's entity. */
      for (const id of Object.values(this._stamps || {})) watch.push(id);
      this._watch = watch;
      this._seen = {};
      for (const id of watch) this._seen[id] = s[id];
      this._entityCount = Object.keys(s).length;
    }

    _update(force) {
      if (!force && !this._worthUpdating()) return;
      const now = Date.now();
      this._stamps = Object.assign(MH.findStamps(this._hass.states),
                                   this._config.stamps);
      this._resolved = MH.resolve(this._hass.states, {
        entities: this._config.entities,
        stamps: this._stamps,
        exclude: this._config.exclude
      }, { now, statLast: this._ages.at, floors: this._ages.floors });
      this._rememberWatched();

      /* A tab with nothing resolved hides itself — the standalone rule made
         visible. Today always stays, so an instance with no health data at
         all still has somewhere to show what it could not find. */
      const live = MH.liveTabs(this._resolved);
      for (const key of MH.TABS) {
        const show = key === "today" || live.indexOf(key) >= 0;
        this._tabButtons[key].style.display = show ? "" : "none";
      }
      if (this._tabButtons[this._tab].style.display === "none") this._select("today");

      this._views[this._tab].update(this._resolved, now, this._series[this._tab] || {});
      this._paintSync(now);
      this._seriesFor(this._tab, false);
    }

    /**
     * Statistics for whichever view is showing.
     *
     * Only the visible tab is fetched, and only once — three history views
     * asking on every `set hass` would be a websocket round trip per state
     * change in the house. `force` is the range selector, which genuinely does
     * want new data.
     */
    _seriesFor(tab, force) {
      const view = this._views[tab];
      if (!view.series) return;
      const key = tab + ":" + JSON.stringify(view.series().map((s) => [s.key, s.days, s.mode]));
      if (!force && this._seriesKey === key) return;
      if (this._seriesPending === key) return;
      this._seriesKey = key;
      this._seriesPending = key;

      const wants = view.series();
      const now = Date.now();
      Promise.all(wants.map((want) => {
        const r = this._resolved[want.role];
        if (!r || !r.entity_id || r.blank) return Promise.resolve([want.key, []]);
        return MH.fetchSeries(this._hass, r.entity_id,
                              { days: want.days, mode: want.mode, now })
          .then((pts) => [want.key, pts])
          .catch(() => [want.key, []]);
      })).then((pairs) => {
        const out = {};
        for (const [k, v] of pairs) out[k] = v;
        this._series[tab] = out;
        this._seriesPending = null;
        if (this._built && this._tab === tab) {
          view.update(this._resolved, Date.now(), out);
        }
      });
    }

    _paintSync(now) {
      const s = this._resolved.last_sync;
      const when = s && s.measured_at != null ? MH.relTime(s.measured_at, now) : null;
      this._syncText.textContent = when ? "Synced " + when + " ago" : "";
      this._syncDot.style.display = when ? "" : "none";
      /* Amber once a sync is a day late — the chip is the only thing on the
         page that reports the pipeline rather than the body. */
      const stale = s && s.age_days != null && s.age_days > 1;
      this._syncDot.style.background = stale ? "var(--amber)" : "var(--teal)";
    }

    /**
     * Measurement ages, once per mount and then slowly.
     *
     * Guarded three ways because `set hass` is a firehose: a freshness pass in
     * flight, one that ran recently, and a resolution that has not happened
     * yet all mean "not now".
     */
    _maybeFetchAges() {
      if (this._fetching || !this._resolved) return;
      if (Date.now() - this._agesAt < AGE_REFRESH) return;
      this._fetching = true;
      MH.fetchAges(this._hass, this._resolved, { now: Date.now() })
        .then((got) => {
          this._ages = got;
          this._agesAt = Date.now();
        })
        .catch(() => { this._agesAt = Date.now(); })
        .then(() => {
          this._fetching = false;
          if (this._built) this._update(true);
        });
    }
  }

  /* Registration is guarded so the same file still loads under node in
     tools/resolve_check.js, where there is no customElements and no DOM. */
  if (typeof customElements !== "undefined" && !customElements.get("myhealth-dashboard")) {
    customElements.define("myhealth-dashboard", MyHealthDashboardCard);

    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "myhealth-dashboard",
      name: "myHealth Dashboard",
      description: "A health dashboard over whatever health data this instance already has.",
      preview: false
    });
    /* eslint-disable-next-line no-console */
    console.info("%c myhealth-dashboard %c " + MH.VERSION + " ",
                 "background:#0d2233;color:#fff", "background:#16c397;color:#0d2233");
  }

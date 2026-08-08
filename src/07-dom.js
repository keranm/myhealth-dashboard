
  /* ------------------------------------------------------------------ *
   * DOM helpers
   * ------------------------------------------------------------------ *
   *
   * Small enough to stay readable, and deliberately not a framework. Views
   * build their tree once with `el()` and then mutate text nodes in place —
   * `set hass` fires on every state change in the instance, and rebuilding the
   * page each time would restart every entry animation.
   *
   * Everything is created with textContent, never innerHTML: coach messages
   * and entity friendly-names are user data and must not be parsed as markup.
   */

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const svg = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    return n;
  };

  const add = (parent, ...kids) => {
    for (const k of kids) if (k) parent.appendChild(k);
    return parent;
  };

  MH.el = el;
  MH.svg = svg;
  MH.add = add;

  /**
   * The three activity rings.
   *
   * Concentric arcs, each rotated -90° so they start at twelve o'clock, drawn
   * with `stroke-dasharray` = circumference and animated by moving
   * `stroke-dashoffset` from a full circle to the fraction completed. A closed
   * ring is offset 0.
   *
   * Over-achievement is clamped at a full circle rather than wrapping: a
   * second lap would render 664 kcal against a 402 goal as a ring that looks
   * two-thirds done.
   */
  const RING_SPEC = [
    { key: "move", r: 64, color: "#e2445c", track: "#f0eeee", delay: 0 },
    { key: "exercise", r: 48, color: "#0f9c72", track: "#eaefec", delay: .12 },
    { key: "stand", r: 32, color: "#2f7fc4", track: "#e9eef3", delay: .24 }
  ];
  MH.RING_SPEC = RING_SPEC;

  MH.rings = (values) => {
    const root = svg("svg", { class: "ring", width: 140, height: 140,
                              viewBox: "0 0 150 150", role: "img" });
    const arcs = {};
    for (const spec of RING_SPEC) {
      const c = 2 * Math.PI * spec.r;
      /* The track goes through a custom property rather than the design's
         literal greys: unfilled track at #f0eeee on a #101d2c card reads as
         three bright white rings. The ring colours themselves stay literal —
         they carry meaning and must not follow a theme. */
      const track = svg("circle", {
        cx: 75, cy: 75, r: spec.r, fill: "none", "stroke-width": 13
      });
      track.style.stroke = `var(--ring-track, ${spec.track})`;
      add(root, track);
      const arc = svg("circle", {
        cx: 75, cy: 75, r: spec.r, fill: "none", stroke: spec.color,
        "stroke-width": 13, "stroke-linecap": "round",
        "stroke-dasharray": c.toFixed(2),
        transform: "rotate(-90 75 75)"
      });
      arc.style.setProperty("--from", c.toFixed(2));
      arc.style.animation = `ringFill 1.4s cubic-bezier(.2,.8,.2,1) ${spec.delay}s both`;
      add(root, arc);
      arcs[spec.key] = { node: arc, c };
    }

    const apply = (vals) => {
      const parts = [];
      for (const spec of RING_SPEC) {
        const p = vals && vals[spec.key];
        const frac = p ? Math.max(0, Math.min(1, p.ratio)) : 0;
        const a = arcs[spec.key];
        a.node.setAttribute("stroke-dashoffset", (a.c * (1 - frac)).toFixed(2));
        if (p) parts.push(`${spec.key} ${Math.round(p.ratio * 100)}%`);
      }
      root.setAttribute("aria-label",
        parts.length ? "Activity rings: " + parts.join(", ") : "Activity rings: no data");
    };
    apply(values);
    root.update = apply;
    return root;
  };

  /** A `label + value` legend row under the rings. */
  MH.ringLegend = (items) => {
    const row = el("div", "legend");
    for (const it of items) {
      const g = el("div", "legend-item");
      const sw = el("span", "swatch");
      sw.style.background = it.color;
      add(g, sw, el("span", "legend-label", it.label), el("span", "legend-value", it.value));
      add(row, g);
    }
    return row;
  };

  /** A progress bar in the design's track/fill pair. */
  MH.bar = (pct, color) => {
    const t = el("div", "track");
    const f = el("i");
    f.style.width = Math.max(0, Math.min(100, pct || 0)) + "%";
    if (color) f.style.background = color;
    return add(t, f);
  };

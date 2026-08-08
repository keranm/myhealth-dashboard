
  /* ------------------------------------------------------------------ *
   * Charts
   * ------------------------------------------------------------------ *
   *
   * Inline SVG, no library. Each returns a node with an `update(points)` so a
   * chart redraws without being rebuilt and without restarting its draw-in.
   *
   * The design's rule is that charts are supporting evidence, never the
   * primary read — so these are deliberately plain: no tooltips competing with
   * the headline number, no gridline noise, and an axis that labels the ends
   * rather than every tick.
   */

  const NS = "http://www.w3.org/2000/svg";

  /** Map a series into a viewBox, with a little headroom so a peak is not
   *  glued to the top edge. */
  const scaler = (points, w, h, opts) => {
    opts = opts || {};
    const xs = points.map((p) => p.start);
    let lo = opts.min, hi = opts.max;
    if (lo == null || hi == null) {
      const e = MH.extent(points);
      const pad = (e.max - e.min) * 0.12 || Math.abs(e.max || 1) * 0.1 || 1;
      if (lo == null) lo = opts.zero ? 0 : e.min - pad;
      if (hi == null) hi = e.max + pad;
    }
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const span = x1 - x0 || 1;
    return {
      lo, hi,
      x: (t) => ((t - x0) / span) * w,
      y: (v) => h - ((v - lo) / (hi - lo || 1)) * h
    };
  };

  const path = (points, s) => points.map((p, i) =>
    (i ? "L" : "M") + s.x(p.start).toFixed(1) + " " + s.y(p.value).toFixed(1)).join(" ");

  /**
   * A line chart.
   *
   * `drawLine` animates stroke-dashoffset from the path's own length, which is
   * measured after the path is in the DOM — a fixed dash length would either
   * clip a long series or leave a short one already drawn.
   */
  MH.lineChart = (opts) => {
    opts = opts || {};
    const H = opts.height || 230, W = 1000;
    /* The axis is a sibling of the plot, not a child: the plot box clips to
       its own height so a line cannot escape it, and an axis inside that box
       is clipped along with it. */
    const root = MH.el("div");
    const wrap = MH.el("div", "chart");
    wrap.style.height = H + "px";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "plot");

    const bands = document.createElementNS(NS, "g");
    const grid = document.createElementNS(NS, "g");
    const lines = document.createElementNS(NS, "g");
    svg.appendChild(bands); svg.appendChild(grid); svg.appendChild(lines);
    wrap.appendChild(svg);

    const axis = MH.el("div", "axis");
    MH.add(root, wrap, axis);

    root.update = (series, cfg) => {
      cfg = cfg || {};
      while (lines.firstChild) lines.removeChild(lines.firstChild);
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      while (bands.firstChild) bands.removeChild(bands.firstChild);
      axis.textContent = "";

      const all = [].concat.apply([], series.map((s) => s.points || []));
      if (!all.length) {
        axis.appendChild(MH.el("span", "axis-tick", "no history yet"));
        return;
      }
      const s = scaler(all, W, H, cfg);

      /* Clinical bands sit behind everything — the chart says which zone the
         line is in, which is the whole reason the Heart chart exists. */
      for (const b of cfg.bands || []) {
        const yTop = s.y(Math.min(b.to, s.hi)), yBot = s.y(Math.max(b.from, s.lo));
        if (yBot <= yTop) continue;
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", 0); r.setAttribute("width", W);
        r.setAttribute("y", yTop.toFixed(1));
        r.setAttribute("height", (yBot - yTop).toFixed(1));
        r.setAttribute("fill", b.color);
        bands.appendChild(r);
      }

      /* Horizontal rules at the ends and middle. Three, not ten. */
      for (const v of [s.lo, (s.lo + s.hi) / 2, s.hi]) {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", 0); l.setAttribute("x2", W);
        l.setAttribute("y1", s.y(v).toFixed(1)); l.setAttribute("y2", s.y(v).toFixed(1));
        l.setAttribute("class", "gridline");
        grid.appendChild(l);
      }

      if (cfg.target != null && cfg.target >= s.lo && cfg.target <= s.hi) {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", 0); l.setAttribute("x2", W);
        l.setAttribute("y1", s.y(cfg.target).toFixed(1));
        l.setAttribute("y2", s.y(cfg.target).toFixed(1));
        l.setAttribute("class", "target");
        grid.appendChild(l);
      }

      series.forEach((ser, i) => {
        const pts = (ser.points || []).filter((p) => p.value != null);
        if (pts.length < 2) return;
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", path(pts, s));
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", ser.color);
        p.setAttribute("stroke-width", ser.width || 3);
        p.setAttribute("stroke-linejoin", "round");
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("vector-effect", "non-scaling-stroke");
        lines.appendChild(p);
        const len = p.getTotalLength ? p.getTotalLength() : 1000;
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
        p.style.animation = `drawLine 1.6s ease ${(i * 0.1).toFixed(2)}s forwards`;
      });

      const fmt = cfg.axisFormat || MH.monthYear;
      axis.appendChild(MH.el("span", "axis-tick", fmt(all[0].start)));
      axis.appendChild(MH.el("span", "axis-tick", fmt(all[all.length - 1].start)));
    };
    return root;
  };

  /**
   * The 30-day bar chart.
   *
   * Bars are coloured against the current goal rather than a fixed threshold,
   * so changing the goal recolours the history — the design is explicit about
   * that. Today's bar is hatched: it is a partial day and drawing it solid
   * would read as a bad day rather than an unfinished one.
   */
  MH.barChart = (opts) => {
    opts = opts || {};
    const wrap = MH.el("div", "bars");
    wrap.style.height = (opts.height || 230) + "px";
    const axis = MH.el("div", "axis");
    const holder = MH.el("div", "bars-row");
    const root = MH.el("div");
    MH.add(root, wrap, axis);
    MH.add(wrap, holder);

    root.update = (points, cfg) => {
      cfg = cfg || {};
      holder.textContent = "";
      axis.textContent = "";
      if (!points || !points.length) {
        axis.appendChild(MH.el("span", "axis-tick", "no history yet"));
        return;
      }
      const goal = cfg.goal || null;
      const e = MH.extent(points);
      const top = Math.max(e.max, goal || 0) * 1.05 || 1;
      for (const p of points) {
        const b = MH.el("i", "daybar");
        b.style.height = Math.max(2, (p.value / top) * 100) + "%";
        const met = goal ? p.value >= goal : false;
        b.style.background = met ? "var(--green)" : "var(--green-light)";
        if (p.partial) b.classList.add("partial");
        b.title = `${p.day}: ${MH.group(p.value, 0)}` + (p.partial ? " so far today" : "");
        MH.add(holder, b);
      }
      const d = (k) => {
        const x = new Date(k);
        return x.getDate() + " " + x.toLocaleString(undefined, { month: "short" });
      };
      axis.appendChild(MH.el("span", "axis-tick", d(points[0].start)));
      axis.appendChild(MH.el("span", "axis-tick", d(points[points.length - 1].start)));
    };
    return root;
  };

  /** A sparkline for a vitals card — 26px tall, no axis, no scale. */
  MH.sparkline = (color, height) => {
    const svg = document.createElementNS(NS, "svg");
    const H = height || 26, W = 200;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "spark");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", 2);
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(p);
    svg.update = (points) => {
      const pts = (points || []).filter((x) => x.value != null);
      if (pts.length < 2) { p.removeAttribute("d"); return; }
      p.setAttribute("d", path(pts, scaler(pts, W, H - 4, {})));
    };
    return svg;
  };

  /** The four-segment clinical axis, shared by the BP card and the Heart tab. */
  MH.BP_SEGMENTS = [
    { key: "normal", label: "Normal", flex: 3, color: "#a8ddc7", from: 0, to: 120 },
    { key: "elevated", label: "Elevated", flex: 1, color: "#f6dfa0", from: 120, to: 130 },
    { key: "stage1", label: "Stage 1", flex: 2, color: "#eeb0a0", from: 130, to: 140 },
    { key: "stage2", label: "Stage 2", flex: 2, color: "#c0334d", from: 140, to: 200 }
  ];

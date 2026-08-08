
  /* ------------------------------------------------------------------ *
   * Style
   * ------------------------------------------------------------------ *
   *
   * The handoff's tokens, verbatim, as custom properties. They are declared
   * on the card's own shadow root rather than taken from the HA theme: this
   * design's colours carry clinical meaning — green is "in range", red is
   * "stage 2" — and a user's theme must not be able to repaint a blood
   * pressure reading green.
   *
   * The dark palette is option 2b from the handoff's exploration file, applied
   * to the same token names so nothing downstream branches on theme.
   *
   * Fonts are the HA theme's stack rather than Google Fonts: a HACS card must
   * not fetch from a third party. IBM Plex is used when the instance already
   * has it, which HA themes commonly do.
   */

  /* Option 2b from the handoff's exploration file. Written once and applied
     through both selectors below, so the two paths into dark mode cannot
     drift apart. */
  const DARK_TOKENS = `
    --chrome: #0a1420;
    --page: #0a1420;
    --surface: #101d2c;
    --sunken: #0d1826;
    --tile: #142234;
    --border: #1e2f42;
    --rule: #1a2836;
    --ink: #eaf2fa;
    --ink-2: #c3d2df;
    --ink-muted: #8496a8;
    --ink-faint: #6f8093;
    --green: #16c397;
    --green-light: #1e5f4c;
    --green-tint: #102e27;
    --green-tint-2: #0d2620;
    --green-border: #1c4a3d;
    --green-deep: #16c397;
    --teal: #16c397;
    --blue: #4da3ff;
    --red: #ff5c7a;
    --red-text: #ff8098;
    --red-tint: #2a1420;
    --red-border: #4a2130;
    --coral: #ff5c7a;
    --amber: #ffb84d;
    --amber-deep: #ffb84d;
    --amber-tint: #2a2113;
    --amber-tint-2: #241c11;
    --amber-border: #4a3a1c;
    --amber-border-2: #4a3a1c;
    --gold: #ffb84d;
    --dim-ink: #5c6b7a;
    --dim-border: #22303f;
    --chrome-inactive: #8fa3b4;
    --amber-ink: #ffb84d;
    --amber-ink-2: #c3d2df;
    --ring-track: #1c2a3a;
  `;

  /* Two ways in, because a HACS card has two masters. Home Assistant decides
     dark from the user's *theme*, which the card reads off
     `hass.themes.darkMode` and stamps onto the host — that is authoritative
     and wins. Outside HA (tools/preview.html, or a bare page) there is no
     theme to ask, so the OS preference stands in unless the host has been
     stamped light. */
  const DARK_SELECTORS = [
    [':host([data-theme="dark"])', ""],
    ['@media (prefers-color-scheme: dark) { :host(:not([data-theme="light"]))', "}"]
  ];
  const DARK_CSS = DARK_SELECTORS
    .map(([sel, close]) => sel + " {" + DARK_TOKENS + "}" + close)
    .join("\n");

  MH.CSS = `
:host {
  --chrome: #0d2233;
  --page: #f2f5f4;
  --surface: #ffffff;
  --sunken: #fbfcfb;
  --tile: #f7faf9;
  --border: #e3e8e6;
  --rule: #eef2ef;
  --ink: #14201b;
  --ink-2: #4d5a53;
  --ink-muted: #6d7a74;
  --ink-faint: #8a978f;
  --green: #0f9c72;
  --green-light: #b9d9cc;
  --green-tint: #e2f4ed;
  --green-tint-2: #f1faf6;
  --green-border: #cde9de;
  --green-deep: #0f6d52;
  --teal: #16c397;
  --blue: #2f7fc4;
  --red: #c0334d;
  --red-text: #a02940;
  --red-tint: #fbeef0;
  --red-border: #f2c9d1;
  --coral: #e2445c;
  --amber: #d98a11;
  --amber-deep: #a07a24;
  --amber-tint: #fff8ec;
  --amber-tint-2: #fdf3e2;
  --amber-border: #f0d9ae;
  --amber-border-2: #ecd4a6;
  --gold: #d99b2b;
  --dim-ink: #a3aea7;
  --dim-border: #d6ddd9;
  --chrome-inactive: #8fa3b4;
  --amber-ink: #5c3f09;
  --amber-ink-2: #8a6a2a;
  --ring-track: #efeeee;

  --sans: "IBM Plex Sans", var(--paper-font-body1_-_font-family, system-ui),
          -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;

  display: block;
  background: var(--page);
  color: var(--ink);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
}

${DARK_CSS}

* { box-sizing: border-box; }

/* --- chrome ------------------------------------------------------- */
.bar {
  position: sticky; top: 0; z-index: 5;
  background: var(--chrome); height: 60px;
  /* Measured against itself, so the rule below holds however wide the
     viewport claims to be. */
  container-type: inline-size;
}
/* The sync chip is the least important thing in the bar and the first to go:
   without this it kept its ~110px and pushed Movement off the end of a
   scrollable tab strip, where nothing suggested it was still there. The dot
   stays, so "when did this last sync" is still answerable at a glance. */
@container (max-width: 560px) {
  .sync-text { display: none; }
}
.bar-inner {
  max-width: 1360px; margin: 0 auto; padding: 0 32px;
  height: 100%; display: flex; align-items: center;
  justify-content: space-between; gap: 16px; min-width: 0;
}
/* A flex item will not shrink below its content unless told it may, and four
   tabs plus a SYNCED chip is wider than a phone. Without these the whole page
   inherited that width and every card was clipped at the right edge. */
.tabs { display: flex; height: 100%; min-width: 0; overflow-x: auto;
        scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tab {
  font-size: 15px; font-weight: 600; padding: 0 16px;
  height: 100%; display: flex; align-items: center;
  cursor: pointer; color: var(--chrome-inactive);
  border-bottom: 2px solid transparent;
  background: none; border-top: 0; border-left: 0; border-right: 0;
  font-family: inherit;
}
.tab[aria-selected="true"] { color: #fff; border-bottom-color: var(--teal); }
.tab:focus-visible { outline: 2px solid var(--teal); outline-offset: -4px; }

.sync { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 0 1 auto; }
.sync-text {
  font-family: var(--mono); font-size: 12px; letter-spacing: .08em;
  color: var(--chrome-inactive); text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}

.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); flex: none; }
.dot.pulse { animation: pulseDot 2s ease-in-out infinite; }
.dot.amber { background: var(--amber); width: 9px; height: 9px; }
.dot.green { background: var(--green); }

/* --- view --------------------------------------------------------- */
.view {
  max-width: 1360px; margin: 0 auto; padding: 28px 32px 56px;
  display: flex; flex-direction: column; gap: 16px;
}
/* Column counts follow the space available, not the viewport.
   auto-fit plus minmax reflows on the width the row actually has, so a card
   embedded in a narrow column collapses correctly even where a viewport media
   query never fires — which is what happens in the Home Assistant companion
   app. The min(100%, N) guard is what stops the track being wider than its
   container when there is less than N to give it; without it a narrow parent
   overflows instead of dropping to one column. */
.row { display: grid; gap: 16px; align-items: start; }
.row.hero { grid-template-columns: minmax(0, 1fr) minmax(0, 380px); }
.row.four { grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
.row.two { grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); }

@media (max-width: 1100px) {
  .row.hero, .row.four, .row.two { grid-template-columns: 1fr; }
  .bar-inner, .view { padding-left: 20px; padding-right: 20px; }
}
@media (max-width: 1100px) and (min-width: 700px) {
  .row.four { grid-template-columns: repeat(2, 1fr); }
}

/* --- cards -------------------------------------------------------- */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 18px 20px;
  animation: cardIn .45s ease both;
}
.card.hero { border-radius: 16px; padding: 26px 30px; }
.card.gap { opacity: .5; }

.eyebrow {
  font-family: var(--mono); font-size: 11px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink-faint);
}
.title { font-size: 15px; font-weight: 600; color: var(--ink); }
.metric {
  font-family: var(--mono); font-size: 32px; font-weight: 600;
  color: var(--ink); line-height: 1.1; letter-spacing: -.01em;
}
.metric .unit { font-size: 15px; font-weight: 500; color: var(--ink-muted); margin-left: 4px; }
.support { font-size: 13px; color: var(--ink-muted); }
.body { font-size: 15px; line-height: 1.65; color: var(--ink-2);
        text-wrap: pretty; overflow-wrap: anywhere; }

.badge {
  font-family: var(--mono); font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .06em;
  border-radius: 20px; padding: 3px 8px; white-space: nowrap;
}
.badge.good { background: var(--green-tint); color: var(--green-deep); }
.badge.warn { background: var(--amber-tint-2); color: var(--amber-deep); }
.badge.bad  { background: var(--red); color: #fff; }
.badge.gap  { border: 1px solid var(--dim-border); color: var(--ink-muted); }

.head { display: flex; align-items: center; justify-content: space-between;
        gap: 8px 12px; flex-wrap: wrap; }

/* Vitals cards carry their status in a 3px top border. */
.card.vital { border-top: 3px solid var(--dim-border); padding-top: 16px; }
.card.vital.good { border-top-color: var(--green); }
.card.vital.info { border-top-color: var(--blue); }
.badge.info { background: var(--green-tint); color: var(--green-deep); }
.card.vital.warn { border-top-color: var(--amber-border-2); }
.card.vital.bad  { border-top-color: var(--red); border-color: var(--red-border); }
.card.vital .metric.bad { color: var(--red-text); }

.track { height: 5px; border-radius: 3px; background: var(--rule); overflow: hidden; }
.track > i { display: block; height: 100%; border-radius: 3px; background: var(--green); }

.stack { display: flex; flex-direction: column; }

/* --- coach -------------------------------------------------------- */
/* Wraps on available space, not on viewport width.
   The media query below says the same thing and is not enough on its own: in
   the Home Assistant companion app the card was still laid out side by side
   with the text column running off the right edge, so whatever the webview
   reports as its viewport, it is not what a phone screen suggests. Flex-wrap
   needs no such report — once there is less than 280px for the prose the
   column drops below the ring on its own. */
.coach { display: flex; flex-wrap: wrap; gap: 24px 32px; align-items: flex-start; }
/* Capped, not just flexed: with no medication card beside it the hero card
   spans the full 1360px, and coach prose set to that measure is unreadable.
   74ch is a comfortable line for 15px body copy.
   (No backticks in this file — MH.CSS is a template literal.) */
.coach-main { flex: 1 1 280px; display: flex; flex-direction: column;
              gap: 11px; min-width: 0; max-width: 74ch; }
.headline { font-size: 25px; font-weight: 600; color: var(--ink); line-height: 1.3; }
.hr { height: 1px; background: var(--rule); }

.legend { display: flex; gap: 18px; flex-wrap: wrap; }
.legend-item { display: flex; align-items: center; gap: 6px; }
.swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.legend-label { font-size: 13px; color: var(--ink-muted); }
.legend-value { font-family: var(--mono); font-size: 15px; font-weight: 600; color: var(--ink); }

.next {
  background: var(--green-tint-2); border: 1px solid var(--green-border);
  border-radius: 12px; padding: 14px 16px;
  display: flex; align-items: center; gap: 14px;
}
.next-label {
  font-family: var(--mono); font-size: 11px; letter-spacing: .14em;
  color: var(--green-deep); flex: none;
}
.next-text { font-size: 15px; color: var(--ink); flex: 1; }

.btn {
  font-family: inherit; font-size: 13px; font-weight: 600;
  border-radius: 8px; padding: 9px 14px; border: 0; cursor: pointer;
  background: var(--green); color: #fff; white-space: nowrap;
}
.btn.dark { background: var(--chrome); font-size: 14px; border-radius: 10px; padding: 11px 18px; }
.btn.amber { background: var(--amber); }
.btn.ghost { background: none; border: 1px solid var(--amber-border-2); color: var(--amber-deep); }
.btn:disabled { opacity: .5; cursor: default; }

.ask { display: flex; gap: 10px; }
.ask input {
  flex: 1; background: var(--sunken); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 14px; font-size: 14px;
  font-family: inherit; color: var(--ink); min-width: 0;
}
.ask input::placeholder { color: var(--ink-faint); }

/* --- medication --------------------------------------------------- */
.card.med-due { background: var(--amber-tint); border-color: var(--amber-border); border-radius: 16px; padding: 22px 24px; }
.card.med-done { border-color: var(--green-border); border-radius: 16px; padding: 22px 24px; }
.med-title { font-size: 20px; font-weight: 600; }
.card.med-due .med-title { color: var(--amber-ink); }
.card.med-due .med-body { color: var(--amber-ink-2); font-size: 14px; line-height: 1.6; }
.card.med-due .eyebrow { color: var(--amber-deep); }
.med-actions { display: flex; gap: 10px; }

/* --- list --------------------------------------------------------- */
.entry {
  display: grid; grid-template-columns: 130px 1fr; gap: 16px;
  padding: 14px 0; border-top: 1px solid var(--rule);
}
.entry:first-of-type { border-top: 0; }
.entry-when { font-family: var(--mono); font-size: 12px; color: var(--ink-faint); text-transform: uppercase; }
.entry-title { font-size: 15px; font-weight: 600; color: var(--ink); }
.entry-sum { font-size: 14px; color: var(--ink-muted); }

/* --- stat groups -------------------------------------------------- */
.stats { display: flex; gap: 32px; flex-wrap: wrap; }
.stat-value { font-family: var(--mono); font-size: 24px; font-weight: 600; color: var(--ink); }
.stat-caption { font-size: 13px; color: var(--ink-muted); }

.chip { display: flex; align-items: center; gap: 6px; }
.chip-text { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; color: var(--ink-faint); text-transform: uppercase; }

.note {
  background: var(--amber-tint); border: 1px solid var(--amber-border);
  border-radius: 12px; padding: 14px 16px; display: flex; gap: 14px; align-items: baseline;
}
.note .eyebrow { color: var(--amber-deep); flex: none; }
.note-text { font-size: 14px; color: var(--ink-2); line-height: 1.6; }

.empty { padding: 40px 0; text-align: center; color: var(--ink-muted); font-size: 15px; }

/* --- charts ------------------------------------------------------- */
.row.hero-left { grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); }
@media (max-width: 1100px) { .row.hero-left { grid-template-columns: 1fr; } }

.hero-metric { font-size: 52px; letter-spacing: -.02em; margin: 6px 0 10px; }
.between { display: flex; justify-content: space-between; gap: 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; margin-top: 14px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
         gap: 12px; margin-top: 16px; }
.tile { background: var(--tile); border-radius: 12px; padding: 16px 18px; }
.grid2 .tile { background: none; padding: 0; }

.chart { position: relative; margin-top: 14px; background: var(--sunken);
         border-radius: 8px; overflow: hidden; }
.plot { width: 100%; height: 100%; display: block; }
.gridline { stroke: var(--rule); stroke-width: 1; vector-effect: non-scaling-stroke; }
.target { stroke: var(--green); stroke-width: 1.5; stroke-dasharray: 5 4;
          vector-effect: non-scaling-stroke; }
.spark { width: 100%; height: 26px; display: block; margin: 10px 0 8px; }

.axis { display: flex; justify-content: space-between; margin-top: 8px; }
.axis-tick { font-family: var(--mono); font-size: 11px; letter-spacing: .06em;
             color: var(--ink-faint); text-transform: uppercase; }

.ranges { display: flex; gap: 6px; }
.range {
  font-family: var(--mono); font-size: 11px; letter-spacing: .06em;
  text-transform: uppercase; padding: 5px 10px; border-radius: 8px;
  border: 1px solid var(--border); background: none; color: var(--ink-muted);
  cursor: pointer;
}
.range[aria-selected="true"] { background: var(--chrome); color: #fff; border-color: var(--chrome); }

.bars { display: flex; align-items: flex-end; gap: 5px; margin-top: 14px;
        background: var(--sunken); border-radius: 8px; padding: 10px;
        border-bottom: 1px solid var(--rule); }
.bars-row { display: flex; align-items: flex-end; gap: 5px; width: 100%; height: 100%; }
/* Named daybar, not bar: the sticky tab bar above is .bar, and a later
   rule of the same name repainted the chrome with the under-goal colour.
   (No backticks in this file — MH.CSS is a template literal.) */
.daybar { flex: 1; min-height: 4px; border-radius: 3px 3px 0 0; background: var(--green-light); }
.daybar.partial {
  background-image: repeating-linear-gradient(45deg,
    rgba(255,255,255,.55) 0 3px, transparent 3px 6px);
}

.range-bar { display: flex; gap: 2px; height: 8px; margin: 4px 0 6px; }
.range-bar > i { border-radius: 3px; }
.range-axis { display: flex; gap: 2px; margin-bottom: 12px; }
.range-axis > span { text-align: center; }

@media (prefers-reduced-motion: reduce) {
  .plot path { animation: none !important; stroke-dashoffset: 0 !important; }
}
@keyframes drawLine { to { stroke-dashoffset: 0; } }

/* --- phones ------------------------------------------------------- *
   The design is a 1360px desktop page and says so, but this is Home
   Assistant: most people open it on a phone. Two things made the whole page
   scroll sideways rather than merely look cramped, and both are min-content
   widths that no amount of max-width would fix.

   The tab bar: four tabs plus a SYNCED chip laid out with space-between have
   a min-content width well over 390px, and a flex row does not shrink below
   that — so the bar pushed the page wider than the viewport and every card
   was clipped at the right edge.

   The coach card: a 140px ring and a text column side by side, with the gap,
   leaves under 200px for a 25px headline. It stacks here instead. */
@media (max-width: 640px) {
  .bar { height: 52px; }
  .bar-inner { padding: 0 14px; gap: 10px; }
  /* Scroll the tabs rather than squeezing them: a four-way choice that has to
     stay readable is a better candidate for a swipe than for 11px type. */
  .tabs { overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { font-size: 14px; padding: 0 12px; flex: none; }
  /* The dot survives; the words do not fit and are not load-bearing. */
  .sync-text { display: none; }

  .view { padding: 16px 14px 40px; gap: 12px; }
  .row { gap: 12px; }
  .card { padding: 16px; border-radius: 12px; }
  .card.hero { padding: 18px 16px; border-radius: 14px; }

  .coach { flex-direction: column; gap: 16px; align-items: stretch; }
  .coach .ring { align-self: center; width: 132px; height: 132px; }
  .coach-main { max-width: none; }
  .headline { font-size: 21px; line-height: 1.25; }
  .body { font-size: 14px; }

  .hero-metric { font-size: 40px; }
  .metric { font-size: 28px; }

  /* Both of these are label-then-control rows that only work side by side. */
  .ask { flex-direction: column; align-items: stretch; }
  .next { flex-direction: column; align-items: flex-start; gap: 10px; }
  .next-text { flex: none; }

  .stats { gap: 16px 22px; }
  .grid2 { gap: 12px 16px; }
  .entry { grid-template-columns: 1fr; gap: 2px; }
  .legend { gap: 10px 14px; }
  .range-axis { display: none; }
}

/* --- motion ------------------------------------------------------- */
@keyframes cardIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: none; }
}
@keyframes pulseDot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .3; transform: scale(.78); }
}
@keyframes ringFill { from { stroke-dashoffset: var(--from); } }

.card.gap { animation-name: cardIn; }

@media (prefers-reduced-motion: reduce) {
  .card, .ring circle { animation: none !important; }
  .dot.pulse { animation: none !important; opacity: 1 !important; }
}
`;

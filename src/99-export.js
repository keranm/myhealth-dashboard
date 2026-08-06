
  /* ------------------------------------------------------------------ *
   * Exit
   * ------------------------------------------------------------------ *
   *
   * The same file has to run in two places: as a HACS resource in the browser,
   * and under node in tools/resolve_check.js. The resolver is deliberately
   * pure — states in, resolution out, no `hass`, no DOM — so the harness tests
   * the shipped code rather than a copy of it.
   */

  if (typeof window !== "undefined") {
    window.MyHealthDashboard = MH;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = MH;
  }
})();

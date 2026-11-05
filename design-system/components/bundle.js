/* That Waffle Place! motion helpers. Plain functions, no framework. */
window.TWP = (function () {
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // A seeded random, so a drip keeps its shape between frames.
  function rng(seed) {
    var s = seed || 1;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  // Chocolate edge along the bottom of a band. p runs 0 to 1: each drip starts
  // a little later than the last and stretches on its own, so it reads as flow.
  function dripPath(w, h, opts) {
    opts = opts || {};
    var p = opts.p == null ? 1 : opts.p, n = opts.n || 9, base = opts.base == null ? 0.42 : opts.base;
    var r = rng(opts.seed || 7), widths = [], i, total = 0;
    for (i = 0; i < n; i++) { widths[i] = 0.6 + r() * 1.1; total += widths[i]; }
    var y0 = h * base * Math.min(1, p * 1.5), d = 'M0 0H' + w + 'V' + y0.toFixed(1), x = w;
    for (i = 0; i < n; i++) {
      var sw = widths[i] / total * w, delay = r() * 0.45, len = 0.3 + r() * 0.7;
      var t = Math.max(0, Math.min(1, (p - delay) / (1 - delay)));
      t = 1 - Math.pow(1 - t, 2.4);
      var depth = (h - y0) * len * t, xb = x - sw, mid = x - sw / 2, rad = sw * 0.2, tip = y0 + depth;
      d += 'C' + (x - sw * 0.18).toFixed(1) + ' ' + y0.toFixed(1) + ' ' + (mid + rad).toFixed(1) + ' ' + (y0 + depth * 0.25).toFixed(1) + ' ' + (mid + rad).toFixed(1) + ' ' + Math.max(y0, tip - rad).toFixed(1);
      d += 'A' + rad.toFixed(1) + ' ' + rad.toFixed(1) + ' 0 0 1 ' + (mid - rad).toFixed(1) + ' ' + Math.max(y0, tip - rad).toFixed(1);
      d += 'C' + (mid - rad).toFixed(1) + ' ' + (y0 + depth * 0.25).toFixed(1) + ' ' + (xb + sw * 0.18).toFixed(1) + ' ' + y0.toFixed(1) + ' ' + xb.toFixed(1) + ' ' + y0.toFixed(1);
      x = xb;
    }
    return d + 'Z';
  }

  // Ties a paused GSAP timeline to a range input, the way ScrollTrigger scrub
  // ties it to scroll. It plays once by itself so the card is alive on open.
  function scrubber(tl, range, button) {
    tl.pause();
    function sync() { range.value = Math.round(tl.progress() * 1000); }
    range.addEventListener('input', function () { tl.pause(); tl.progress(range.value / 1000); });
    function play() { tl.progress(0).play(); }
    if (button) button.addEventListener('click', play);
    tl.eventCallback('onUpdate', sync);
    if (calm) { tl.progress(1); sync(); } else { play(); }
  }

  return { calm: calm, rng: rng, dripPath: dripPath, scrubber: scrubber };
})();

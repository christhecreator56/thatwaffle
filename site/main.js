/* That Waffle Place page motion. The page is complete without this file. */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return [].slice.call(document.querySelectorAll(s)); };
  var hero = $('#hero'), dripPath = $('#drip'), tp = $('#tp'), sign = $('#sign');

  // Giant footer name, one span per letter so each can spring up.
  'that waffle'.split('').forEach(function (c) {
    var e = document.createElement('span');
    e.setAttribute('aria-hidden', 'true');
    e.textContent = c === ' ' ? ' ' : c;
    sign.appendChild(e);
  });

  tp.textContent = new Array(11).join('THAT WAFFLE PLACE  ●  ワッフル  ●  ');

  // Arrows run from each label to its spot on the photo. Spots are stored as
  // fractions of the image, so they stay on the food at any screen size.
  var NS = 'http://www.w3.org/2000/svg', arrows = $('#insideArrows'), photo = $('#insideImg');
  function arrowPath(cls, d) {
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('class', cls);
    p.setAttribute('d', d);
    p.setAttribute('pathLength', '1');
    return p;
  }
  function drawArrows() {
    var W = photo.naturalWidth, H = photo.naturalHeight, bw = photo.offsetWidth, bh = photo.offsetHeight;
    if (!W || !bw) return;
    var s = Math.max(bw / W, bh / H), ox = photo.offsetLeft + (bw - W * s) * .5, oy = photo.offsetTop + (bh - H * s) * .6;
    var phone = innerWidth < 900;
    arrows.textContent = '';
    $$('.facts li').forEach(function (li) {
      var x = li.offsetLeft, y = li.offsetTop, w = li.offsetWidth, h = li.offsetHeight, side = phone ? 'top' : li.dataset.from;
      var x1 = side === 'right' ? x + w : x + w / 2;
      var y1 = side === 'top' ? y : side === 'bottom' ? y + h : y + h / 2;
      var x2 = ox + li.dataset.u * W * s, y2 = oy + li.dataset.v * H * s;
      var bend = (+li.dataset.bend) * (phone ? .12 : .2), cx = (x1 + x2) / 2 - (y2 - y1) * bend, cy = (y1 + y2) / 2 + (x2 - x1) * bend;
      var a = Math.atan2(y2 - cy, x2 - cx), L = phone ? 12 : 17;
      var curve = 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      var head = 'M' + (x2 - L * Math.cos(a - .5)).toFixed(1) + ' ' + (y2 - L * Math.sin(a - .5)).toFixed(1) + 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + 'L' + (x2 - L * Math.cos(a + .5)).toFixed(1) + ' ' + (y2 - L * Math.sin(a + .5)).toFixed(1);
      var g = document.createElementNS(NS, 'g');
      [['under', curve], ['under', head], ['over', curve], ['over', head]].forEach(function (b) { g.appendChild(arrowPath(b[0], b[1])); });
      arrows.appendChild(g);
    });
  }
  photo.addEventListener('load', drawArrows);
  if (photo.complete) drawArrows();
  addEventListener('resize', drawArrows);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawArrows);

  if (!window.gsap || !window.ScrollTrigger || TWP.calm) return;
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });
  var root = document.documentElement;
  root.classList.add('motion', 'stage-on');
  if (!location.hash) history.scrollRestoration = 'manual';

  // Smooth scroll, driven by the same clock as the animations.
  var lenis = window.Lenis ? new Lenis({ lerp: .11 }) : null;
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }
  var menuAt = 0;
  $$('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var href = a.getAttribute('href'), to = href === '#menu' ? menuAt : href === '#top' ? 0 : $(href);
      if (to == null) return;
      ev.preventDefault();
      if (lenis) lenis.scrollTo(to, { duration: 1.6 }); else scrollTo(0, typeof to === 'number' ? to : to.getBoundingClientRect().top + scrollY);
    });
  });

  // Splits text into words and letters for staggered reveals.
  function split(el, byWord) {
    var label = el.textContent.trim(), bits = [];
    el.setAttribute('aria-label', label);
    el.textContent = '';
    label.split(/\s+/).forEach(function (w, n) {
      if (n) el.appendChild(document.createTextNode(' '));
      var wd = document.createElement('span');
      wd.className = 'wd';
      wd.setAttribute('aria-hidden', 'true');
      if (byWord) { wd.textContent = w; bits.push(wd); }
      else w.split('').forEach(function (c) { var ch = document.createElement('span'); ch.className = 'ch'; ch.textContent = c; wd.appendChild(ch); bits.push(ch); });
      el.appendChild(wd);
    });
    return bits;
  }
  var wobble = gsap.utils.random(-14, 14, true);
  var RISE = { yPercent: 110, rotation: wobble, scale: .6, opacity: 0 };
  function letters(bits, trigger) {
    return gsap.from(bits, Object.assign({}, RISE, { duration: .7, ease: 'back.out(2.2)', stagger: .022, scrollTrigger: trigger }));
  }
  function words(bits, trigger) {
    return gsap.from(bits, { y: 18, opacity: 0, duration: .45, ease: 'power2.out', stagger: .03, scrollTrigger: trigger });
  }

  // Ribbon: drifts on its own and speeds up with scrolling.
  var off = 0, lastY = scrollY;
  gsap.ticker.add(function () {
    off -= 0.6 + Math.min(6, Math.abs(scrollY - lastY) * .15);
    lastY = scrollY;
    tp.setAttribute('startOffset', off % 520);
  });

  // Headlines lean with scroll speed, and the header steps aside going down.
  var lean = { v: 0 }, setLean = gsap.quickSetter('.lean', 'skewY', 'deg');
  ScrollTrigger.create({
    onUpdate: function (self) {
      var v = gsap.utils.clamp(-4, 4, self.getVelocity() / -380);
      if (Math.abs(v) > Math.abs(lean.v)) { lean.v = v; gsap.to(lean, { v: 0, duration: .7, ease: 'power3.out', overwrite: true, onUpdate: function () { setLean(lean.v); } }); }
      gsap.to('.bar', { yPercent: self.direction > 0 && self.scroll() > 240 ? -170 : 0, duration: .3, ease: 'power2.out', overwrite: 'auto' });
    }
  });

  var heroCh = [];
  $$('.hero h1 .sticker-type').forEach(function (s) { heroCh = heroCh.concat(split(s)); });
  $('.hero h1').setAttribute('aria-label', 'that crunch. that melt.');
  var intro = gsap.timeline();
  intro.from(heroCh, { yPercent: 130, rotation: wobble, scale: .5, opacity: 0, duration: .6, ease: 'back.out(2.4)', stagger: .03 }, .1);
  intro.from('#waffle', { clipPath: 'circle(0% at 50% 50%)', rotation: 8, scale: .9, duration: .9, ease: 'power3.inOut', clearProps: 'clipPath' }, .35);
  intro.from(split($('.hero__sub .poster'), true), { y: 22, opacity: 0, duration: .36, ease: 'power2.out', stagger: .04 }, .85);
  intro.from('.hero__cta', { y: 22, opacity: 0, duration: .34, ease: 'back.out(2)' }, 1.15);
  intro.from('#badge', { scale: 1.9, rotation: -30, opacity: 0, duration: .28, ease: 'power4.in' }, 1.1);
  intro.from('.hero__ribbon', { yPercent: 70, opacity: 0, duration: .5, ease: 'power3.out' }, 1);

  // The page holds still until the menu data is in, so the stage measures correctly.
  if (lenis) lenis.stop();
  root.style.overflow = 'hidden';

  (window.twpLive || Promise.resolve()).then(function () {
    var stage = $('#stage'), mood = $('#mood'), menu = $('#menu'), inside = $('#inside');
    var edgeCut = $('#edgeCut'), edgeWedge = $('#edgeWedge'), track = $('#track');
    var master;
    var hide = 'polygon(0 0,0 0,0 0)';
    var moodBits = split($('.mood h2'));
    var dishes = $$('.dish');

    // Menu board: one flavour leads at a time, and the rest stay in view.
    var shown = -1, stepStart = 0, stepLength = 0;
    function lead(i) {
      if (i === shown) return;
      shown = i;
      dishes.forEach(function (d, n) {
        d.classList.toggle('on', n === i);
        d.querySelector('button').setAttribute('aria-current', n === i ? 'true' : 'false');
      });
      menu.style.setProperty('--bg', dishes[i].style.getPropertyValue('--bg'));
      menu.style.setProperty('--fg', dishes[i].style.getPropertyValue('--fg'));
      var d = dishes[i];
      track.scrollTo({ top: d.offsetTop - track.clientHeight / 3, behavior: 'smooth' });
    }
    dishes.forEach(function (d, i) {
      var h = d.querySelector('h3'), b = document.createElement('button');
      b.type = 'button';
      b.textContent = h.textContent;
      h.textContent = '';
      h.appendChild(b);
      b.addEventListener('click', function () {
        var at = (stepStart + (i + .5) * stepLength / dishes.length) / tl.duration();
        var y = master.start + at * (master.end - master.start);
        if (lenis) lenis.scrollTo(y, { duration: 1 }); else scrollTo(0, y);
      });
    });
    lead(0);
    var insideBits = split($('.inside h2'));

    gsap.set([mood, menu, inside, edgeCut, edgeWedge], { clipPath: hide });

    // Reveal 1: the next scene pours in through chocolate drips.
    var drip = { p: 0 };
    function pour() {
      var w = stage.offsetWidth, h = stage.offsetHeight * 1.25, svg = dripPath.parentNode, opt = function (p) { return { p: p, n: 11, seed: 11, base: .84 }; };
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      dripPath.setAttribute('d', drip.p > .005 ? TWP.dripPath(w, h, opt(Math.min(1, drip.p + .05))) : '');
      mood.style.clipPath = drip.p > .005 ? (drip.p >= 1 ? 'none' : 'path("' + TWP.dripPath(w, h, opt(drip.p)) + '")') : hide;
    }

    // Reveal 2: a badge-shaped cut opens with a sticker edge.
    var cut = { p: 0 };
    function scallop(extra) {
      var w = stage.offsetWidth, h = stage.offsetHeight, r = cut.p * Math.hypot(w, h) * .62 + extra, pts = [];
      for (var i = 0; i < 144; i++) {
        var t = i / 144 * Math.PI * 2, rr = r * (1 + .075 * Math.cos(12 * t + cut.p * 4));
        pts.push((w / 2 + rr * Math.cos(t)).toFixed(1) + 'px ' + (h / 2 + rr * Math.sin(t)).toFixed(1) + 'px');
      }
      return 'polygon(' + pts.join(',') + ')';
    }
    function openCut() {
      var on = cut.p > .002, full = cut.p >= 1;
      menu.style.clipPath = !on ? hide : full ? 'none' : scallop(0);
      edgeCut.style.clipPath = !on || full ? hide : scallop(16);
    }

    // Reveal 3: four wedges grow in from the corners, like the logo.
    var wedge = { p: 0 };
    function circles(extra) {
      var w = stage.offsetWidth, h = stage.offsetHeight, R = Math.hypot(w, h) * .56, d = '';
      [[0, 0, 0], [w, 0, .12], [w, h, .24], [0, h, .36]].forEach(function (c) {
        var q = Math.max(0, Math.min(1, (wedge.p - c[2]) / .64)), r = q * R + (q > 0 ? extra : 0);
        d += 'M' + (c[0] - r).toFixed(1) + ' ' + c[1] + 'a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 0 ' + (r * 2).toFixed(1) + ' 0a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 0 ' + (-r * 2).toFixed(1) + ' 0Z';
      });
      return 'path("' + d + '")';
    }
    function openWedge() {
      var on = wedge.p > .002, full = wedge.p >= 1;
      inside.style.clipPath = !on ? hide : full ? 'none' : circles(0);
      edgeWedge.style.clipPath = !on || full ? hide : circles(14);
      if (wedge.p > .8) inside.classList.add('in');
    }

    // One scene stays on screen through every change, so nothing is ever blank.
    var t = 0, tl = gsap.timeline({ defaults: { ease: 'none' } });
    tl.to(heroCh, { y: function () { return gsap.utils.random(-110, -30); }, rotation: wobble, duration: .7, stagger: .004 }, .2);
    tl.to('#waffle', { rotation: 2, scale: 1.1, duration: 1.3 }, .2);
    tl.to(drip, { p: 1, duration: 1.1, ease: 'power1.inOut', onUpdate: pour }, .4);
    tl.fromTo('.mood img', { scale: 1.14 }, { scale: 1, duration: 1.8 }, .4);
    tl.from(moodBits, Object.assign({}, RISE, { duration: .4, stagger: .02, ease: 'back.out(2)' }), 1);

    t = 2.1;
    tl.to(cut, { p: 1, duration: 1, ease: 'power2.in', onUpdate: openCut }, t);
    tl.addLabel('menu', t + .9);
    t += .55;
    tl.from('.dish > div', { x: -50, opacity: 0, duration: .4, stagger: .06, ease: 'power2.out' }, t - .25);
    var step = { i: 0 };
    stepStart = t + .2;
    stepLength = dishes.length * .9;
    tl.to(step, { i: dishes.length - .001, duration: stepLength, onUpdate: function () { lead(Math.floor(step.i)); } }, stepStart);
    t = stepStart + stepLength + .15;

    tl.fromTo('.inside__bg', { scale: 1.16 }, { scale: 1, duration: 1.7 }, t);
    tl.to(wedge, { p: 1, duration: 1.1, ease: 'power1.inOut', onUpdate: openWedge }, t);
    tl.from(insideBits, Object.assign({}, RISE, { duration: .4, stagger: .014, ease: 'back.out(2)' }), t + .75);
    tl.from('.facts li', { scale: .7, opacity: 0, duration: .25, stagger: .12, ease: 'back.out(2)' }, t + .85);
    t += 3;
    tl.to({}, { duration: .01 }, t);

    var UNIT = .72;
    master = ScrollTrigger.create({
      animation: tl, trigger: stage, pin: true, start: 'top top', anticipatePin: 1, scrub: .45, invalidateOnRefresh: true,
      end: function () { return '+=' + t * UNIT * innerHeight; }
    });

    // Lower sections slide up over the one before, which holds and dims.
    var order = ['.story', '.share', '.offers', '.visit', '.twp-foot'].map($);
    var R = Math.min(innerWidth * .1, 120);
    order.forEach(function (next, i) {
      gsap.fromTo(next, { borderTopLeftRadius: R, borderTopRightRadius: R }, { borderTopLeftRadius: 0, borderTopRightRadius: 0, ease: 'none', scrollTrigger: { trigger: next, start: 'top bottom', end: 'top top', scrub: true } });
      if (!i) return;
      var prev = order[i - 1];
      ScrollTrigger.create({ trigger: prev, pin: true, pinSpacing: false, start: 'bottom bottom', end: function () { return '+=' + Math.min(next.offsetHeight, innerHeight); } });
      gsap.to(prev, { '--dim': .6, ease: 'none', scrollTrigger: { trigger: next, start: 'top bottom', end: 'top top', scrub: true } });
    });

    $$('.story h2,.share h2,.offers h2,.visit h2').forEach(function (h) { letters(split(h), { trigger: h, start: 'top 80%' }); });
    $$('.lede,.share__panel p:last-child').forEach(function (p) { words(split(p, true), { trigger: p, start: 'top 85%' }); });
    gsap.from('.share__pics .a', { scale: .8, rotation: 9, opacity: 0, duration: .7, ease: 'back.out(1.5)', scrollTrigger: { trigger: '.share__pics', start: 'top 75%' } });
    gsap.from('.share__pics .b', { y: 70, rotation: -14, opacity: 0, duration: .6, delay: .15, ease: 'back.out(1.6)', scrollTrigger: { trigger: '.share__pics', start: 'top 75%' } });
    gsap.from('.rate', { y: 50, rotation: function (i) { return (i - 1) * 3; }, opacity: 0, duration: .55, stagger: .12, ease: 'back.out(1.6)', scrollTrigger: { trigger: '.ratings', start: 'top 75%' } });
    $$('.rate b').forEach(function (b) {
      var end = parseFloat(b.textContent), n = { v: 0 };
      gsap.to(n, { v: end, duration: 1.4, ease: 'power2.out', scrollTrigger: { trigger: '.ratings', start: 'top 75%' }, onUpdate: function () { b.textContent = n.v.toFixed(1); } });
    });
    gsap.from('.offers__badge', { scale: 1.8, rotation: -24, opacity: 0, duration: .28, ease: 'power4.in', scrollTrigger: { trigger: '.offers__badge', start: 'top 85%' } });
    gsap.from('.visit__card', { x: -60, opacity: 0, duration: .6, ease: 'back.out(1.5)', scrollTrigger: { trigger: '.visit', start: 'top 60%' } });
    gsap.from('.twp-foot__grid > *', { y: 30, opacity: 0, duration: .5, stagger: .08, ease: 'power2.out', scrollTrigger: { trigger: '.twp-foot__panel', start: 'top 75%' } });
    gsap.from('#sign span', { yPercent: 96, rotation: function (i) { return i % 2 ? 7 : -7; }, duration: .8, ease: 'back.out(1.9)', stagger: .05, scrollTrigger: { trigger: '.twp-foot__panel', start: 'top 55%' } });

    drawArrows();
    function refresh() {
      ScrollTrigger.refresh();
      menuAt = master.start + (tl.labels.menu / tl.duration()) * (master.end - master.start);
    }
    addEventListener('load', refresh);
    ScrollTrigger.addEventListener('refresh', function () { pour(); openCut(); openWedge(); });
    root.style.overflow = '';
    if (lenis) lenis.start();
    refresh();
  });
})();

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
  document.documentElement.classList.add('motion');
  if (!location.hash) history.scrollRestoration = 'manual';

  // Smooth scroll, driven by the same clock as the animations.
  var lenis = window.Lenis ? new Lenis({ lerp: .11 }) : null;
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        var to = $(a.getAttribute('href'));
        if (to) { ev.preventDefault(); lenis.scrollTo(to, { duration: 1.6 }); }
      });
    });
  }

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
  var wobble = gsap.utils.random(-16, 16, true);
  function letters(bits, trigger) {
    return gsap.from(bits, { yPercent: 120, rotation: wobble, scale: .55, opacity: 0, duration: .7, ease: 'back.out(2.2)', stagger: .022, scrollTrigger: trigger });
  }
  function words(bits, trigger) {
    return gsap.from(bits, { y: 18, opacity: 0, duration: .45, ease: 'power2.out', stagger: .03, scrollTrigger: trigger });
  }
  // Photos open up through a round cut in the page.
  function open(el, trigger) {
    return gsap.fromTo(el, { clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(78% at 50% 50%)', duration: 1, ease: 'power3.inOut', scrollTrigger: trigger, clearProps: 'clipPath' });
  }

  // Ribbon: drifts on its own and speeds up with scrolling.
  var off = 0, lastY = scrollY;
  gsap.ticker.add(function () {
    off -= 0.6 + Math.min(6, Math.abs(scrollY - lastY) * .15);
    lastY = scrollY;
    tp.setAttribute('startOffset', off % 520);
  });

  // Headlines lean with scroll speed.
  var lean = { v: 0 }, setLean = gsap.quickSetter('.lean', 'skewY', 'deg');
  ScrollTrigger.create({
    onUpdate: function (self) {
      var v = gsap.utils.clamp(-5, 5, self.getVelocity() / -320);
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

  // Hero pins: letters lift away, then chocolate pours into the next scene.
  var st = { p: 0 };
  function draw() { dripPath.setAttribute('d', st.p > .01 ? TWP.dripPath(1200, 900, { p: st.p, n: 11, seed: 11, base: .84 }) : ''); }
  draw();
  gsap.timeline({ scrollTrigger: { trigger: hero, pin: true, start: 'top top', end: '+=130%', scrub: .5 } })
    .to('#waffle', { rotation: 2, scale: 1.08, duration: 1, ease: 'none' }, 0)
    .to(heroCh, { y: function () { return gsap.utils.random(-120, -30); }, rotation: wobble, duration: .5, ease: 'none', stagger: .004 }, .1)
    .to(st, { p: 1, duration: .62, ease: 'none', onUpdate: draw }, .38);

  // Mood: the next scene cuts through in a scalloped badge shape.
  var moodBits = split($('.mood h2'));
  letters(moodBits, { trigger: '.mood', start: 'top 55%' });
  var cut = $('#cut'), cutWord = $('#cut p'), cutState = { p: 0 };
  function scallop() {
    var w = cut.offsetWidth, h = cut.offsetHeight, r = cutState.p * Math.hypot(w, h) * .62, pts = [];
    for (var i = 0; i < 144; i++) {
      var t = i / 144 * Math.PI * 2, rr = r * (1 + .075 * Math.cos(12 * t + cutState.p * 4));
      pts.push((w / 2 + rr * Math.cos(t)).toFixed(1) + 'px ' + (h / 2 + rr * Math.sin(t)).toFixed(1) + 'px');
    }
    cut.style.clipPath = 'polygon(' + pts.join(',') + ')';
  }
  scallop();
  gsap.fromTo('.mood img', { yPercent: -5 }, { yPercent: 5, ease: 'none', scrollTrigger: { trigger: '.mood', start: 'top bottom', end: 'bottom top', scrub: true } });
  gsap.timeline({ scrollTrigger: { trigger: '#mood', pin: true, start: 'top top', end: '+=120%', scrub: .4 } })
    .to({}, { duration: .3 })
    .to(cutState, { p: 1, duration: .7, ease: 'power1.in', onUpdate: scallop }, .3)
    .fromTo(cutWord, { scale: .4, rotation: -10 }, { scale: 1, rotation: 0, duration: .5, ease: 'none' }, .5);

  // The menu, offers and hours may come from the database, so the rest waits for them.
  (window.twpLive || Promise.resolve()).then(function () {
    // Menu: pinned sideways slide on large screens, swipe on phones.
    var dishes = $$('.dish').map(function (d) {
      return { el: d, h: split(d.querySelector('h3')), p: split(d.querySelector('p'), true), img: d.querySelector('.photo') };
    });
    gsap.matchMedia().add('(min-width:900px)', function () {
      var scroller = $('#menuScroll'), track = $('#track');
      scroller.style.overflow = 'hidden';
      var slide = gsap.to(track, { x: function () { return -(track.scrollWidth - innerWidth); }, ease: 'none', scrollTrigger: { trigger: scroller, pin: true, start: 'top top', end: function () { return '+=' + (track.scrollWidth - innerWidth); }, scrub: .6, invalidateOnRefresh: true } });
      dishes.forEach(function (d, i) {
        var tr = i ? { trigger: d.el, containerAnimation: slide, start: 'left 65%' } : { trigger: scroller, start: 'top 45%' };
        letters(d.h, tr); words(d.p, tr); open(d.img, tr);
      });
      return function () { scroller.style.overflow = ''; };
    });
    gsap.matchMedia().add('(max-width:899px)', function () {
      dishes.forEach(function (d) { var tr = { trigger: d.el, start: 'top 70%' }; letters(d.h, tr); words(d.p, tr); });
    });

    // Section changes: waffle cells or four wedges close over the page.
    var W = Math.max(innerWidth, screen.width), H = Math.max(innerHeight, screen.height) * .8;
    $$('.wipe--cells').forEach(function (el) {
      var size = W < 900 ? 84 : 124, rows = Math.ceil(H / size) + 2, cols = Math.ceil(W / size) + 2, cells = [];
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var i = document.createElement('i');
        i.style.cssText = 'left:' + (c - .5) * size + 'px;top:' + (r - .5) * size + 'px;width:' + size + 'px;height:' + size + 'px';
        el.appendChild(i); cells.push(i);
      }
      gsap.set(cells, { rotation: 45, scale: 0 });
      gsap.to(cells, { scale: 1.56, ease: 'none', stagger: { amount: .75, grid: [rows, cols], from: 'start', axis: 'y' }, scrollTrigger: { trigger: el, start: 'top 90%', end: 'bottom 35%', scrub: .35 } });
    });
    $$('.wipe--wedges').forEach(function (el) {
      var R = Math.hypot(W, H) * .54, q = [[0, 0], [1, 0], [1, 1], [0, 1]].map(function (p) {
        var i = document.createElement('i');
        i.style.cssText = 'width:' + R * 2 + 'px;height:' + R * 2 + 'px;margin:' + -R + 'px;left:' + p[0] * 100 + '%;top:' + p[1] * 100 + '%';
        el.appendChild(i); return i;
      });
      gsap.set(q, { scale: 0 });
      gsap.to(q, { scale: 1, ease: 'power1.inOut', stagger: .12, scrollTrigger: { trigger: el, start: 'top 90%', end: 'bottom 35%', scrub: .35 } });
    });

    $$('.scene h2').forEach(function (h) { letters(split(h), { trigger: h, start: 'top 85%' }); });
    $$('.lede,.share__panel p:last-child').forEach(function (p) { words(split(p, true), { trigger: p, start: 'top 88%' }); });
    ScrollTrigger.create({ trigger: '.inside', start: 'top 45%', once: true, onEnter: function () { $('.inside').classList.add('in'); } });
    gsap.from('.inside__bg', { scale: 1.14, ease: 'none', scrollTrigger: { trigger: '.inside', start: 'top bottom', end: 'top top', scrub: true } });
    open('.share__pics .a', { trigger: '.share__pics', start: 'top 80%' });
    gsap.from('.facts li', { scale: .7, opacity: 0, duration: .4, stagger: .22, ease: 'back.out(2)', scrollTrigger: { trigger: '.inside', start: 'top 45%' } });
    gsap.from('.share__pics .b', { y: 70, rotation: -14, duration: .6, ease: 'back.out(1.6)', scrollTrigger: { trigger: '.share__pics', start: 'top 70%' } });
    gsap.from('.offers__badge', { scale: 1.8, rotation: -24, opacity: 0, duration: .28, ease: 'power4.in', scrollTrigger: { trigger: '.offers__badge', start: 'top 90%' } });
    gsap.from('.visit dt,.visit dd', { x: -24, opacity: 0, duration: .35, stagger: .04, ease: 'power2.out', scrollTrigger: { trigger: '.visit dl', start: 'top 85%' } });
    gsap.fromTo('#fly', { x: -160, y: 50 }, { x: 40, y: -20, ease: 'none', scrollTrigger: { trigger: '.visit', start: 'top bottom', end: 'bottom 60%', scrub: true } });

    gsap.from('.twp-foot__grid > *', { y: 30, opacity: 0, duration: .5, stagger: .08, ease: 'power2.out', scrollTrigger: { trigger: '.twp-foot__panel', start: 'top 75%' } });
    gsap.from('#sign span', { yPercent: 96, rotation: function (i) { return i % 2 ? 7 : -7; }, duration: .8, ease: 'back.out(1.9)', stagger: .05, scrollTrigger: { trigger: '.twp-foot__panel', start: 'top 55%' } });
    ScrollTrigger.refresh();
  });

  // Images arrive late, so recheck pin distances once everything has loaded.
  addEventListener('load', function () { ScrollTrigger.refresh(); });
})();

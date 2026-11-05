/* That Waffle Place page motion. The page is complete without this file. */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var hero = $('#hero'), dripPath = $('#drip'), tp = $('#tp'), sign = $('#sign');

  // Giant footer name, one span per letter so each can spring up.
  'that waffle'.split('').forEach(function (c) {
    var e = document.createElement('span');
    e.setAttribute('aria-hidden', 'true');
    e.textContent = c === ' ' ? ' ' : c;
    sign.appendChild(e);
  });

  tp.textContent = new Array(11).join('THAT WAFFLE PLACE  ●  ワッフル  ●  ');

  if (!window.gsap || !window.ScrollTrigger || TWP.calm) return;
  gsap.registerPlugin(ScrollTrigger);
  if (!location.hash) history.scrollRestoration = 'manual';

  // Ribbon: drifts on its own and speeds up with scrolling.
  var off = 0, lastY = scrollY;
  gsap.ticker.add(function () {
    off -= 0.6 + Math.min(6, Math.abs(scrollY - lastY) * .15);
    lastY = scrollY;
    tp.setAttribute('startOffset', off % 520);
  });

  var intro = gsap.timeline();
  intro.from('.hero h1 .sticker-type', { scale: 1.45, rotation: function (i) { return i ? 5 : -5; }, opacity: 0, transformOrigin: '30% 60%', duration: .34, ease: 'back.out(2.6)', stagger: .15 }, .1);
  intro.from('#waffle', { y: 70, rotation: 7, scale: .9, opacity: 0, duration: .6, ease: 'back.out(1.6)' }, .3);
  intro.from('.hero__sub', { y: 26, opacity: 0, duration: .34, ease: 'power2.out' }, .78);
  intro.from('#badge', { scale: 1.9, rotation: -30, opacity: 0, duration: .28, ease: 'power4.in' }, .95);
  intro.from('.hero__ribbon', { yPercent: 70, opacity: 0, duration: .5, ease: 'power3.out' }, .9);

  // Hero pins: the photo leans in, then chocolate pours over into the next scene.
  var st = { p: 0 };
  function draw() { dripPath.setAttribute('d', st.p > .01 ? TWP.dripPath(1200, 900, { p: st.p, n: 11, seed: 11, base: .84 }) : ''); }
  draw();
  gsap.timeline({ scrollTrigger: { trigger: hero, pin: true, start: 'top top', end: '+=130%', scrub: .5 } })
    .to('#waffle', { rotation: 2, scale: 1.08, duration: 1, ease: 'none' }, 0)
    .to('.hero__type', { y: -40, duration: 1, ease: 'none' }, 0)
    .to(st, { p: 1, duration: .62, ease: 'none', onUpdate: draw }, .38);

  gsap.fromTo('.mood img', { yPercent: -5 }, { yPercent: 5, ease: 'none', scrollTrigger: { trigger: '.mood', start: 'top bottom', end: 'bottom top', scrub: true } });

  // Menu: pinned sideways slide on large screens, swipe on phones.
  gsap.matchMedia().add('(min-width:900px)', function () {
    var scroller = $('#menuScroll'), track = $('#track');
    scroller.style.overflow = 'hidden';
    gsap.to(track, { x: function () { return -(track.scrollWidth - innerWidth); }, ease: 'none', scrollTrigger: { trigger: scroller, pin: true, start: 'top top', end: function () { return '+=' + (track.scrollWidth - innerWidth); }, scrub: .6, invalidateOnRefresh: true } });
    return function () { scroller.style.overflow = ''; };
  });

  gsap.from('.facts li', { x: 40, opacity: 0, duration: .4, stagger: .1, ease: 'back.out(1.8)', scrollTrigger: { trigger: '.facts', start: 'top 80%' } });
  gsap.from('.share__pics .b', { y: 70, rotation: -14, duration: .6, ease: 'back.out(1.6)', scrollTrigger: { trigger: '.share__pics', start: 'top 70%' } });
  gsap.from('.offers__badge', { scale: 1.8, rotation: -24, opacity: 0, duration: .28, ease: 'power4.in', scrollTrigger: { trigger: '.offers__badge', start: 'top 90%' } });
  gsap.fromTo('#fly', { x: -160, y: 50 }, { x: 40, y: -20, ease: 'none', scrollTrigger: { trigger: '.visit', start: 'top bottom', end: 'bottom 60%', scrub: true } });

  gsap.from('#sign span', { yPercent: 96, rotation: function (i) { return i % 2 ? 7 : -7; }, duration: .8, ease: 'back.out(1.9)', stagger: .05, scrollTrigger: { trigger: '.twp-foot__panel', start: 'top 55%' } });

  // Images arrive late, so recheck pin distances once everything has loaded.
  addEventListener('load', function () { ScrollTrigger.refresh(); });
})();

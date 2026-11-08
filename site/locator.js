/* That Waffle Place store finder: a branded map that loads only when it is nearly on screen. */
(function () {
  var STORES = [
    { id: 'alwarpet', name: 'Alwarpet', at: [80.2490078, 13.0312487], address: 'Ground floor, No.38, Co-operative Colony, Teynampet, Chennai 600018', own: true },
    { id: 'annanagar', name: 'Anna Nagar', at: [80.2116548, 13.0923615], address: 'S Block, Anna Nagar, Chennai 600040', own: true },
    { id: 'taramani', name: 'Taramani', at: [80.2371823, 12.9815064], address: '50/51 E, Sannathi Street, Jawaharlal Nehru Salai, Taramani, Chennai 600113', own: false },
    { id: 'vepery', name: 'Vepery', at: [80.2622727, 13.0856835], address: '78, Jermiah Road, Periamet, Vepery, Chennai 600007', own: false }
  ];
  var $ = function (id) { return document.getElementById(id); };
  var box = $('map'), far = $('howFar'), msg = $('farMsg'), chips = $('storeChips');
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var map, pins = {}, current = STORES[0], flown = false;

  function pad() {
    return innerWidth >= 900 ? { left: Math.min(innerWidth * .42, 560), top: 60, bottom: 60, right: 60 } : { top: 50, bottom: 40, left: 30, right: 30 };
  }

  // The card always describes the chosen store.
  function choose(s, move) {
    current = s;
    [].forEach.call(chips.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.id === s.id)); });
    $('storeAddress').textContent = s.address;
    $('storeKind').textContent = s.own ? 'Our store' : 'Franchise store';
    $('hoursRow').hidden = !s.own;
    $('directions').href = 'https://www.google.com/maps/dir/?api=1&destination=' + s.at[1] + ',' + s.at[0];
    Object.keys(pins).forEach(function (k) { pins[k].classList.toggle('on', k === s.id); });
    if (move && map) map.flyTo({ center: s.at, zoom: 15.6, padding: pad(), duration: calm ? 0 : 1800, essential: true });
  }
  STORES.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.id = s.id;
    b.textContent = s.name;
    b.addEventListener('click', function () { choose(s, true); });
    chips.appendChild(b);
  });
  choose(current, false);

  function paint() {
    map.getStyle().layers.forEach(function (l) {
      var id = l.id;
      if (l.type === 'background') map.setPaintProperty(id, 'background-color', '#fff6e6');
      else if (l.type === 'fill') map.setPaintProperty(id, 'fill-color', /water/.test(id) ? '#a9dae2' : /building/.test(id) ? '#f1dfc4' : /park|wood|grass|landcover/.test(id) ? '#e3ecc9' : '#fbefd9');
      else if (l.type === 'line' && /boundary|admin/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
      else if (l.type === 'line') map.setPaintProperty(id, 'line-color', /water/.test(id) ? '#a9dae2' : /motorway|trunk|major/.test(id) ? '#f7c368' : '#ffffff');
      else if (l.type === 'symbol' && map.getLayoutProperty(id, 'text-field')) {
        map.setPaintProperty(id, 'text-color', '#3f2912');
        map.setPaintProperty(id, 'text-halo-color', '#fff6e6');
        map.setPaintProperty(id, 'text-halo-width', 1.6);
      }
    });
  }

  function fitAll(duration) {
    var b = new maplibregl.LngLatBounds();
    STORES.forEach(function (s) { b.extend(s.at); });
    map.fitBounds(b, { padding: pad(), maxZoom: 13.5, duration: duration });
  }

  function init() {
    map = new maplibregl.Map({
      container: box,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [80.24, 13.04],
      zoom: calm ? 11.6 : 10.2,
      attributionControl: { compact: true },
      cooperativeGestures: true
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    STORES.forEach(function (s, i) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin' + (s.id === current.id ? ' on' : '');
      el.style.setProperty('--i', i);
      el.setAttribute('aria-label', 'That Waffle Place ' + s.name);
      el.innerHTML = '<span class="pin__pulse"></span><img src="assets/badge-waffle.svg" alt="" width="64" height="64"><b></b>';
      el.querySelector('b').textContent = s.name;
      el.addEventListener('click', function () { choose(s, true); });
      pins[s.id] = el;
      new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(s.at).addTo(map);
    });
    map.on('load', function () {
      paint();
      box.classList.add('ready');
      fitAll(0);
      new IntersectionObserver(function (e, o) {
        if (!e[0].isIntersecting || flown) return;
        o.disconnect();
        flown = true;
        box.classList.add('in');
        if (!calm) setTimeout(function () { fitAll(2200); }, 50);
      }, { threshold: .45 }).observe(box);
    });
  }

  function load() {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css';
    document.head.appendChild(css);
    var js = document.createElement('script');
    js.src = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';
    js.onload = function () { try { init(); } catch (e) { box.classList.add('failed'); } };
    js.onerror = function () { box.classList.add('failed'); };
    document.head.appendChild(js);
  }
  var watch = new IntersectionObserver(function (e) {
    if (e[0].isIntersecting && !map) { watch.disconnect(); load(); }
  }, { rootMargin: '1400px 0px' });
  watch.observe(box);

  // Straight-line distance only. The position stays in this browser.
  function km(a, b) {
    var r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.pow(Math.sin(dLon / 2), 2);
    return 12742 * Math.asin(Math.sqrt(h));
  }
  function nearest(me) {
    var best = STORES[0], d = Infinity;
    STORES.forEach(function (s) { var k = km(me, s.at); if (k < d) { d = k; best = s; } });
    choose(best, false);
    msg.textContent = 'Your nearest is ' + best.name + ', about ' + (d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(d < 10 ? 1 : 0) + ' km') + ' away in a straight line.';
    if (!map || !map.isStyleLoaded()) return;
    var line = { type: 'Feature', geometry: { type: 'LineString', coordinates: [me, best.at] } };
    if (map.getSource('route')) map.getSource('route').setData(line);
    else {
      map.addSource('route', { type: 'geojson', data: line });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#3f2912', 'line-width': 4, 'line-dasharray': [.1, 2.2] } });
      var dot = document.createElement('div');
      dot.className = 'pin__me';
      new maplibregl.Marker({ element: dot }).setLngLat(me).addTo(map);
    }
    if (d < 200) map.fitBounds([me, best.at], { padding: pad(), maxZoom: 15.6, duration: calm ? 0 : 1600 });
  }
  far.addEventListener('click', function () {
    if (!navigator.geolocation) { msg.textContent = 'Your browser cannot share its location. Pick a store above instead.'; return; }
    msg.textContent = 'Finding you…';
    far.disabled = true;
    navigator.geolocation.getCurrentPosition(function (p) {
      far.disabled = false;
      nearest([p.coords.longitude, p.coords.latitude]);
    }, function () {
      far.disabled = false;
      msg.textContent = 'We could not get your location. Allow location access, or pick a store above.';
    }, { timeout: 9000, maximumAge: 60000 });
  });
})();

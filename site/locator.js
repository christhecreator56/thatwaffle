/* That Waffle Place locator: a branded map that loads only when it is nearly on screen. */
(function () {
  var SHOP = [80.2490078, 13.0312487];
  var box = document.getElementById('map'), far = document.getElementById('howFar'), msg = document.getElementById('farMsg');
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var map, pin, flown = false;

  function paint() {
    map.getStyle().layers.forEach(function (l) {
      var id = l.id;
      if (l.type === 'background') map.setPaintProperty(id, 'background-color', '#eed4bc');
      else if (l.type === 'fill') map.setPaintProperty(id, 'fill-color', /water/.test(id) ? '#c4acb4' : /building/.test(id) ? '#e2c3a7' : /park|wood|grass|landcover/.test(id) ? '#dcc8a4' : '#ebcfb5');
      else if (l.type === 'line' && /boundary|admin/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
      else if (l.type === 'line') map.setPaintProperty(id, 'line-color', /water/.test(id) ? '#c4acb4' : /motorway|trunk|major/.test(id) ? '#ad795a' : '#fbfaf5');
      else if (l.type === 'symbol' && map.getLayoutProperty(id, 'text-field')) {
        map.setPaintProperty(id, 'text-color', '#2e2c25');
        map.setPaintProperty(id, 'text-halo-color', '#eed4bc');
        map.setPaintProperty(id, 'text-halo-width', 1.6);
      }
    });
  }

  function view() {
    var wide = innerWidth >= 900;
    return { center: SHOP, zoom: 16, padding: wide ? { left: Math.min(innerWidth * .42, 560), top: 40, bottom: 40, right: 40 } : { top: 40, bottom: 30, left: 20, right: 20 } };
  }

  function fly() {
    if (flown || !map) return;
    flown = true;
    pin.classList.add('in');
    map.flyTo(Object.assign(view(), { duration: calm ? 0 : 3200, essential: true }));
  }

  function init() {
    map = new maplibregl.Map({
      container: box,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: SHOP,
      zoom: calm ? 16 : 11.8,
      attributionControl: { compact: true },
      cooperativeGestures: true
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    pin = document.createElement('div');
    pin.className = 'pin';
    pin.innerHTML = '<span class="pin__pulse"></span><img src="assets/badge-waffle.svg" alt="" width="84" height="84"><b>That Waffle Place</b>';
    new maplibregl.Marker({ element: pin, anchor: 'center' }).setLngLat(SHOP).addTo(map);
    map.on('load', function () {
      paint();
      box.classList.add('ready');
      watch.disconnect();
      new IntersectionObserver(function (e, o) {
        if (e[0].isIntersecting) { o.disconnect(); fly(); }
      }, { threshold: .5 }).observe(box);
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
    if (e[0].isIntersecting && !map) { watch.unobserve(box); load(); }
  }, { rootMargin: '1400px 0px' });
  watch.observe(box);

  // Straight-line distance only. The position stays in this browser.
  function km(a, b) {
    var r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.pow(Math.sin(dLon / 2), 2);
    return 12742 * Math.asin(Math.sqrt(h));
  }
  function showMe(me) {
    var d = km(me, SHOP);
    msg.textContent = (d < 1 ? "You're about " + Math.round(d * 1000) + ' m away' : "You're about " + d.toFixed(d < 10 ? 1 : 0) + ' km away') + ' in a straight line.';
    if (!map || !map.isStyleLoaded()) return;
    var line = { type: 'Feature', geometry: { type: 'LineString', coordinates: [me, SHOP] } };
    if (map.getSource('route')) map.getSource('route').setData(line);
    else {
      map.addSource('route', { type: 'geojson', data: line });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#8a2823', 'line-width': 4, 'line-dasharray': [.1, 2.2] } });
      var dot = document.createElement('div');
      dot.className = 'pin__me';
      new maplibregl.Marker({ element: dot }).setLngLat(me).addTo(map);
    }
    if (d < 200) map.fitBounds([me, SHOP], { padding: view().padding, maxZoom: 16, duration: calm ? 0 : 1600 });
    else msg.textContent += ' Tap Get directions for your route.';
  }
  far.addEventListener('click', function () {
    if (!navigator.geolocation) { msg.textContent = 'Your browser cannot share its location. Use Get directions instead.'; return; }
    msg.textContent = 'Finding you…';
    far.disabled = true;
    navigator.geolocation.getCurrentPosition(function (p) {
      far.disabled = false;
      showMe([p.coords.longitude, p.coords.latitude]);
    }, function () {
      far.disabled = false;
      msg.textContent = 'We could not get your location. Allow location access, or use Get directions.';
    }, { timeout: 9000, maximumAge: 60000 });
  });
})();

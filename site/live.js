/* Replaces the built-in menu, offers and hours with live data. If anything fails, the built-in page stays. */
(function () {
  var c = window.TWP_SUPABASE || {};
  if (!c.url || !c.anonKey) return;

  var scenes = {
    umber: ['--umber', '--justright'], dune: ['--dune', '--justright'],
    lily: ['--lily', '--dune'], 'umber-deep': ['--umber-deep', '--justright']
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function get(path, signal) {
    return fetch(c.url + '/rest/v1/' + path, { headers: { apikey: c.anonKey }, signal: signal })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function day(iso) {
    var p = iso.split('-');
    return new Date(+p[0], p[1] - 1, +p[2]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function dish(item, i, total) {
    var s = scenes[item.scene] || scenes.umber;
    var a = el('article', 'dish gutter'), box = el('div');
    a.style.setProperty('--bg', 'var(' + s[0] + ')');
    a.style.setProperty('--fg', 'var(' + s[1] + ')');
    box.appendChild(el('span', 'twp-label count', (i + 1) + ' of ' + total));
    box.appendChild(el('h3', '', item.name));
    box.appendChild(el('p', '', item.description || ''));
    box.appendChild(el('span', 'todo', item.price_rupees == null ? 'Price to come' : '₹' + item.price_rupees));
    a.appendChild(box);
    if (item.photo_url) {
      var img = el('img', 'photo');
      img.src = item.photo_url;
      img.alt = item.name;
      a.appendChild(img);
    }
    return a;
  }

  function ticket(o) {
    var t = el('article', 'twp-ticket'), side = el('div', 'twp-ticket__poster'), body = el('div', 'twp-ticket__body');
    var img = el('img');
    img.src = o.poster_url || 'assets/badge-lily.svg';
    img.alt = o.poster_url ? o.name + ' poster' : '';
    side.appendChild(img);
    body.appendChild(el('h3', '', o.name));
    var dl = el('dl');
    [['Discount', o.discount], ['Valid', day(o.starts_on) + ' to ' + day(o.ends_on)], ['Terms', o.terms]].forEach(function (row) {
      dl.appendChild(el('dt', '', row[0]));
      dl.appendChild(el('dd', '', row[1]));
    });
    body.appendChild(dl);
    t.appendChild(side);
    t.appendChild(body);
    return t;
  }

  var stop = new AbortController();
  var timer = setTimeout(function () { stop.abort(); }, 2500);

  // main.js waits for this before it animates the menu.
  window.twpLive = Promise.all([
    get('menu_items?select=*&order=position.asc', stop.signal),
    get('offers?select=*&order=ends_on.asc', stop.signal),
    get('site_settings?select=hours&id=eq.1', stop.signal)
  ]).then(function (d) {
    var track = document.getElementById('track');
    if (d[0].length) {
      track.textContent = '';
      d[0].forEach(function (item, i) { track.appendChild(dish(item, i, d[0].length)); });
    }
    var list = document.getElementById('offerList');
    d[1].forEach(function (o) { list.appendChild(ticket(o)); });
    var hours = d[2][0] && d[2][0].hours.trim();
    if (hours) document.getElementById('hours').textContent = hours;
  }).catch(function () {}).then(function () { clearTimeout(timer); });
})();

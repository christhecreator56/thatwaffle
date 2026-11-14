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

  // WhatsApp Opt-in Form submission
  var optForm = document.getElementById('optInForm');
  if (optForm) {
    optForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = document.getElementById('optin-err');
      if (err) err.textContent = '';
      var name = (optForm.elements['name'] && optForm.elements['name'].value.trim()) || '';
      var rawPhone = (optForm.elements['phone'] && optForm.elements['phone'].value.trim().replace(/\D/g, '')) || '';
      var opted = optForm.elements['optedIn'] && optForm.elements['optedIn'].checked;

      if (!name) {
        if (err) err.textContent = 'Add your name so we know who to message.';
        return optForm.elements['name'].focus();
      }
      if (!/^[6-9][0-9]{9}$/.test(rawPhone)) {
        if (err) err.textContent = 'Enter a valid 10-digit mobile number.';
        return optForm.elements['phone'].focus();
      }
      if (!opted) {
        if (err) err.textContent = 'Tick the consent box to receive WhatsApp offers.';
        return optForm.elements['optedIn'].focus();
      }

      var submitBtn = optForm.querySelector('[type=submit]');
      if (submitBtn) submitBtn.disabled = true;

      fetch(c.url + '/rest/v1/customers', {
        method: 'POST',
        headers: {
          'apikey': c.anonKey,
          'Authorization': 'Bearer ' + c.anonKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          name: name,
          phone: '+91' + rawPhone,
          is_subscribed: true,
          source: 'website'
        })
      }).then(function (r) {
        if (!r.ok && r.status !== 409) throw new Error('Status ' + r.status);
        optForm.innerHTML = '<div class="twp-ok" role="status"><span>🧇 You\'re in, ' + name.replace(/[<>&]/g, '') + '! Watch your WhatsApp for That Offer.</span></div>';
      }).catch(function () {
        if (err) err.textContent = 'Could not save your opt-in right now. Try again later.';
        if (submitBtn) submitBtn.disabled = false;
      });
    });
  }
})();

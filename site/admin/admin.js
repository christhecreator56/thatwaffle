/* That Waffle Place admin: login, offers, menu and hours. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var cfg = window.TWP_SUPABASE || {};
  if (!cfg.url || !cfg.anonKey) { $('setupView').hidden = false; return; }

  var db = window.supabase.createClient(cfg.url, cfg.anonKey);
  var MAX_BYTES = 5 * 1024 * 1024;
  var TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  var offers = [], items = [], editingOffer = null, editingItem = null, toastTimer;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  // Plain words for the errors people can actually hit.
  function say(err) {
    var m = (err && err.message) || '';
    if (/row-level security|permission denied/i.test(m)) return 'This account is not allowed to make changes.';
    if (/Invalid login/i.test(m)) return 'That email or password is wrong.';
    if (/fetch|network/i.test(m)) return 'Could not reach the server. Try another network, or turn off any ad blocker for this site.';
    return m || 'Something went wrong. Try again.';
  }
  function src(url) { return /^https?:/.test(url) ? url : '/' + url; }
  function today() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  function day(iso) {
    var p = iso.split('-');
    return new Date(+p[0], p[1] - 1, +p[2]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function upload(file, folder) {
    if (!file) return Promise.resolve(null);
    var ext = TYPES[file.type];
    if (!ext) return Promise.reject(new Error('Use a JPG, PNG or WebP image.'));
    if (file.size > MAX_BYTES) return Promise.reject(new Error('That image is over 5 MB. Choose a smaller one.'));
    var path = folder + '/' + crypto.randomUUID() + '.' + ext;
    return db.storage.from('media').upload(path, file, { contentType: file.type }).then(function (r) {
      if (r.error) throw r.error;
      return db.storage.from('media').getPublicUrl(path).data.publicUrl;
    });
  }
  function must(r) { if (r.error) throw r.error; return r.data; }

  /* Views */
  function show(view) {
    $('loginView').hidden = view !== 'login';
    $('appView').hidden = view !== 'app';
  }
  function tab(name) {
    ['offers', 'menu', 'hours'].forEach(function (t) { $('tab-' + t).hidden = t !== name; });
    [].forEach.call(document.querySelectorAll('.tab'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.tab === name)); });
  }
  [].forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () { tab(b.dataset.tab); });
  });
  [].forEach.call(document.querySelectorAll('[data-cancel]'), function (b) {
    b.addEventListener('click', function () { $(b.dataset.cancel).hidden = true; });
  });

  /* Lists */
  function row(imgUrl, title, pills, sub, onEdit, onDelete) {
    var li = el('li');
    if (imgUrl) { var i = el('img'); i.src = src(imgUrl); i.alt = ''; li.appendChild(i); } else li.appendChild(el('span', 'noimg'));
    var text = el('div');
    text.appendChild(el('b', '', title));
    var meta = el('small');
    pills.forEach(function (p) { meta.appendChild(el('span', 'pill' + (p.on ? ' pill--on' : ''), p.text)); });
    meta.appendChild(document.createTextNode(sub));
    text.appendChild(meta);
    li.appendChild(text);
    var acts = el('div', 'acts'), edit = el('button', '', 'Edit'), del = el('button', '', 'Delete');
    edit.type = del.type = 'button';
    edit.setAttribute('aria-label', 'Edit ' + title);
    del.setAttribute('aria-label', 'Delete ' + title);
    edit.addEventListener('click', onEdit);
    del.addEventListener('click', onDelete);
    acts.appendChild(edit);
    acts.appendChild(del);
    li.appendChild(acts);
    return li;
  }
  function state(o) {
    var t = today();
    if (!o.is_visible) return { text: 'Hidden', on: false };
    if (o.ends_on < t) return { text: 'Ended', on: false };
    if (o.starts_on > t) return { text: 'Scheduled', on: false };
    return { text: 'Live', on: true };
  }
  function drawOffers() {
    var list = $('offerList');
    list.textContent = '';
    if (!offers.length) list.appendChild(el('li', 'empty', 'No offers yet. Add the first one.'));
    offers.forEach(function (o) {
      list.appendChild(row(o.poster_url, o.name, [state(o)], o.discount + ' · ' + day(o.starts_on) + ' to ' + day(o.ends_on),
        function () { openOffer(o); },
        function () { remove('offers', o.id, o.name, loadOffers); }));
    });
  }
  function drawItems() {
    var list = $('itemList');
    list.textContent = '';
    if (!items.length) list.appendChild(el('li', 'empty', 'The menu is empty. The website shows its built-in menu until you add an item.'));
    items.forEach(function (m) {
      var pills = [{ text: m.is_visible ? 'Showing' : 'Hidden', on: m.is_visible }];
      list.appendChild(row(m.photo_url, m.name, pills, m.price_rupees == null ? 'No price yet' : '₹' + m.price_rupees,
        function () { openItem(m); },
        function () { remove('menu_items', m.id, m.name, loadItems); }));
    });
  }
  function remove(table, id, name, reload) {
    if (!window.confirm('Delete "' + name + '"? This cannot be undone.')) return;
    db.from(table).delete().eq('id', id).then(function (r) {
      must(r);
      toast('Deleted ' + name);
      return reload();
    }).catch(function (e) { toast(say(e)); });
  }

  function loadOffers() {
    return db.from('offers').select('*').order('ends_on', { ascending: false }).then(function (r) { offers = must(r); drawOffers(); });
  }
  function loadItems() {
    return db.from('menu_items').select('*').order('position').then(function (r) { items = must(r); drawItems(); });
  }
  function loadHours() {
    return db.from('site_settings').select('hours').eq('id', 1).maybeSingle().then(function (r) {
      var d = must(r);
      $('h-text').value = d ? d.hours : '';
    });
  }

  /* Offer form */
  function openOffer(o) {
    editingOffer = o || null;
    $('offerTitle').textContent = o ? 'Edit offer' : 'Add offer';
    $('o-name').value = o ? o.name : '';
    $('o-discount').value = o ? o.discount : '';
    $('o-start').value = o ? o.starts_on : '';
    $('o-end').value = o ? o.ends_on : '';
    $('o-terms').value = o ? o.terms : '';
    $('o-visible').checked = o ? o.is_visible : true;
    $('o-poster').value = '';
    $('offerMsg').textContent = '';
    $('offerForm').hidden = false;
    $('o-name').focus();
  }
  $('newOffer').addEventListener('click', function () { openOffer(); });
  $('offerForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('offerMsg'), start = $('o-start').value, end = $('o-end').value, btn = ev.target.querySelector('[type=submit]');
    msg.textContent = '';
    if (end < start) { msg.textContent = 'The end date is before the start date.'; return $('o-end').focus(); }
    btn.disabled = true;
    upload($('o-poster').files[0], 'posters').then(function (url) {
      var row = { name: $('o-name').value.trim(), discount: $('o-discount').value.trim(), starts_on: start, ends_on: end, terms: $('o-terms').value.trim(), is_visible: $('o-visible').checked };
      if (url) row.poster_url = url;
      return editingOffer ? db.from('offers').update(row).eq('id', editingOffer.id) : db.from('offers').insert(row);
    }).then(function (r) {
      must(r);
      $('offerForm').hidden = true;
      toast('Offer saved');
      return loadOffers();
    }).catch(function (e) { msg.textContent = say(e); }).then(function () { btn.disabled = false; });
  });

  /* Menu form */
  function openItem(m) {
    editingItem = m || null;
    $('itemTitle').textContent = m ? 'Edit item' : 'Add item';
    $('m-name').value = m ? m.name : '';
    $('m-desc').value = m ? m.description : '';
    $('m-price').value = m && m.price_rupees != null ? m.price_rupees : '';
    $('m-pos').value = m ? m.position : items.length + 1;
    $('m-scene').value = m ? m.scene : 'umber';
    $('m-visible').checked = m ? m.is_visible : true;
    $('m-photo').value = '';
    $('itemMsg').textContent = '';
    $('itemForm').hidden = false;
    $('m-name').focus();
  }
  $('newItem').addEventListener('click', function () { openItem(); });
  $('itemForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('itemMsg'), btn = ev.target.querySelector('[type=submit]'), price = $('m-price').value;
    msg.textContent = '';
    btn.disabled = true;
    upload($('m-photo').files[0], 'menu').then(function (url) {
      var row = { name: $('m-name').value.trim(), description: $('m-desc').value.trim(), price_rupees: price === '' ? null : +price, position: +$('m-pos').value, scene: $('m-scene').value, is_visible: $('m-visible').checked };
      if (url) row.photo_url = url;
      return editingItem ? db.from('menu_items').update(row).eq('id', editingItem.id) : db.from('menu_items').insert(row);
    }).then(function (r) {
      must(r);
      $('itemForm').hidden = true;
      toast('Menu item saved');
      return loadItems();
    }).catch(function (e) { msg.textContent = say(e); }).then(function () { btn.disabled = false; });
  });

  /* Hours */
  $('hoursForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('hoursMsg');
    msg.textContent = '';
    db.from('site_settings').update({ hours: $('h-text').value.trim() }).eq('id', 1).then(function (r) {
      must(r);
      toast('Hours saved');
    }).catch(function (e) { msg.textContent = say(e); });
  });

  /* Login */
  function enter() {
    return db.rpc('is_admin').then(function (r) {
      if (!must(r)) {
        return db.auth.signOut().then(function () {
          show('login');
          $('loginMsg').textContent = 'This account is not an admin.';
        });
      }
      show('app');
      tab('offers');
      return Promise.all([loadOffers(), loadItems(), loadHours()]);
    }).catch(function (e) { show('login'); $('loginMsg').textContent = say(e); });
  }
  $('loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('loginMsg'), btn = ev.target.querySelector('[type=submit]');
    msg.textContent = '';
    btn.disabled = true;
    db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value }).then(function (r) {
      if (r.error) throw r.error;
      $('password').value = '';
      return enter();
    }).catch(function (e) { msg.textContent = say(e); }).then(function () { btn.disabled = false; });
  });
  $('logout').addEventListener('click', function () {
    db.auth.signOut().then(function () { show('login'); });
  });

  db.auth.getSession().then(function (r) {
    if (r.data.session) enter(); else show('login');
  });
})();

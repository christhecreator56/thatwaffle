/* That Waffle Place admin: login, offers, menu, customers & WhatsApp automation. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var cfg = window.TWP_SUPABASE || {};
  if (!cfg.url || !cfg.anonKey) { $('setupView').hidden = false; return; }

  var db = window.supabase.createClient(cfg.url, cfg.anonKey);
  var MAX_BYTES = 5 * 1024 * 1024;
  var TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  var offers = [], items = [], customers = [], broadcasts = [];
  var editingOffer = null, editingItem = null, editingCustomer = null, toastTimer;

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
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }
  function say(err) {
    var m = (err && (err.message || err.error_description || (typeof err === 'string' ? err : ''))) || '';
    if (/already exists/i.test(m)) return m;
    if (/row-level security|permission denied/i.test(m)) return 'This account is not allowed to make changes.';
    if (/Invalid login/i.test(m)) return 'That email or password is wrong.';
    if (/duplicate key|unique constraint/i.test(m)) return 'This phone number is already registered.';
    if (/fetch|network/i.test(m)) return 'Could not reach the server. Try another network or turn off ad blockers.';
    return m || 'Something went wrong. Try again.';
  }
  function src(url) { return /^https?:/.test(url) ? url : '/' + url; }
  function today() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  function day(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return new Date(+p[0], p[1] - 1, +p[2]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function formatDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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

  function parseJsonResponse(r) {
    return r.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) {}
      if (!r.ok) {
        var msg = (data && (data.error || data.message)) ||
          ('API error (HTTP ' + r.status + ')' + (r.status === 404 ? ': Backend endpoint not found.' : ''));
        throw new Error(msg);
      }
      if (!data) {
        throw new Error('Received empty response from server.');
      }
      return data;
    });
  }

  /* Direct Meta Cloud API Dispatch Engine (Zero Backend Dependency) */
  var DEFAULT_META_WA_TOKEN = 'EAAUmsdp2ZCgkBS0WQTYOuc2eZBjPZCr6dQoM7Ax59UZAliz51ek9qGG3yaiu8AFlvjZAEtbw9HnM8ed7p8IrI10FY2cPmE9fkxvDFZBAIYnKdYkTZAYdw9V6bylN8HxzfKWcoFrkEoE5WzYYEpMpoQJo6YMruYvcrPzS6aAZBAXWrwX29PGKXhwEUOtZB1AIuga6gsAZDZD';
  var DEFAULT_META_PHONE_ID = '1465237300010288';

  var storedToken = (typeof localStorage !== 'undefined' && localStorage.getItem('twp_meta_wa_token')) || '';
  var storedPhoneId = (typeof localStorage !== 'undefined' && localStorage.getItem('twp_meta_phone_id')) || '';

  var WA_CONFIG = {
    token: (storedToken && storedToken.trim().length > 20) ? storedToken.trim() : DEFAULT_META_WA_TOKEN,
    phoneId: (storedPhoneId && storedPhoneId.trim().length > 5) ? storedPhoneId.trim() : DEFAULT_META_PHONE_ID
  };

  // Ensure active credentials are saved in localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('twp_meta_wa_token', WA_CONFIG.token);
      localStorage.setItem('twp_meta_phone_id', WA_CONFIG.phoneId);
    }
  } catch (_) {}

  // Auto-fetch credentials securely if backend or Cloudflare function provides them
  if (typeof fetch !== 'undefined') {
    fetch('/api/whatsapp-token').then(function (r) {
      if (r.ok) return r.json();
      return null;
    }).then(function (d) {
      if (d && d.token && d.token.trim().length > 20) {
        WA_CONFIG.token = d.token.trim();
        if (d.phone_id) WA_CONFIG.phoneId = d.phone_id.trim();
        try {
          localStorage.setItem('twp_meta_wa_token', WA_CONFIG.token);
          localStorage.setItem('twp_meta_phone_id', WA_CONFIG.phoneId);
        } catch (_) {}
      }
    }).catch(function () {});
  }

  function sendMetaWhatsApp(opts) {
    var rawPhone = (opts.to || '').replace(/\D/g, '');
    if (rawPhone.startsWith('0091') && rawPhone.length === 14) rawPhone = rawPhone.slice(4);
    else if (rawPhone.startsWith('91') && rawPhone.length === 12) rawPhone = rawPhone.slice(2);
    else if (rawPhone.startsWith('0') && rawPhone.length === 11) rawPhone = rawPhone.slice(1);
    if (rawPhone.length === 10) rawPhone = '91' + rawPhone;

    if (!rawPhone || rawPhone.length < 10) {
      return Promise.reject(new Error('Invalid mobile phone number.'));
    }

    var custName = (opts.customer_name || '').trim() || 'Valued Customer';
    var offerName = (opts.offer_name || '').trim() || 'Weekend Special';
    var disc = (opts.discount || '').trim() || 'Special discount';
    var validity = opts.validity || ((opts.starts_on && opts.ends_on) ? (day(opts.starts_on) + ' to ' + day(opts.ends_on)) : 'Limited time');
    validity = (validity || '').trim() || 'Limited time';
    var tms = (opts.terms || '').trim() || 'Terms apply.';

    // Meta WhatsApp Cloud API rule:
    // Outbound messages outside 24h window (without customer sending 'Hi' first)
    // MUST use an approved Meta template (twp_offer_broadcast).
    var payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: rawPhone,
      type: 'template',
      template: {
        name: 'twp_offer_broadcast',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: custName },
              { type: 'text', text: offerName },
              { type: 'text', text: disc },
              { type: 'text', text: validity },
              { type: 'text', text: tms }
            ]
          }
        ]
      }
    };

    var activeToken = (WA_CONFIG.token && WA_CONFIG.token.trim().length > 20) ? WA_CONFIG.token.trim() : DEFAULT_META_WA_TOKEN;
    var activePhoneId = (WA_CONFIG.phoneId && WA_CONFIG.phoneId.trim().length > 5) ? WA_CONFIG.phoneId.trim() : DEFAULT_META_PHONE_ID;

    var metaUrl = 'https://graph.facebook.com/v21.0/' + activePhoneId + '/messages';
    return fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + activeToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var err = (data && data.error && data.error.message) || ('Meta API error (' + r.status + ')');
          throw new Error(err);
        }
        var msgId = (data.messages && data.messages[0] && data.messages[0].id) || 'wamid.sent';
        return { success: true, message_id: msgId, mode: 'meta_live' };
      });
    });
  }

  var activeDispatches = new Set();

  function dispatchMetaBroadcast(broadcastId, offer, subList) {
    if (broadcastId) activeDispatches.add(broadcastId);
    var targets = (subList && subList.length) ? subList : customers.filter(function (c) { return c.is_subscribed; });
    if (!targets.length) {
      if (broadcastId) activeDispatches.delete(broadcastId);
      return Promise.reject(new Error('No subscribed customers found in CRM. Add customers first.'));
    }

    var sent = 0;
    var failed = 0;
    var lastErrorMsg = '';
    var chain = Promise.resolve();

    targets.forEach(function (c) {
      chain = chain.then(function () {
        return sendMetaWhatsApp({
          to: c.phone,
          customer_name: c.name,
          offer_name: offer.name,
          discount: offer.discount,
          starts_on: offer.starts_on,
          ends_on: offer.ends_on,
          terms: offer.terms,
          custom_message: offer.custom_message
        }).then(function () {
          sent++;
        }).catch(function (err) {
          console.warn('WhatsApp dispatch failed for ' + c.phone, err);
          failed++;
          lastErrorMsg = (err && err.message) ? err.message : String(err);
        });
      });
    });

    return chain.then(function () {
      var finalStatus = sent > 0 ? 'completed' : 'failed';
      var updatePayload = {
        status: finalStatus,
        total_recipients: targets.length,
        sent_count: sent,
        failed_count: failed,
        completed_at: new Date().toISOString()
      };

      // Immediately update in-memory broadcast object so UI re-renders without stale delay
      if (broadcastId) {
        var localB = broadcasts.find(function (x) { return x.id === broadcastId; });
        if (localB) {
          localB.status = finalStatus;
          localB.sent_count = sent;
          localB.failed_count = failed;
          localB.total_recipients = targets.length;
          localB.completed_at = updatePayload.completed_at;
        }
      }

      var dbUpdate = broadcastId
        ? db.from('broadcasts').update(updatePayload).eq('id', broadcastId).then(function (res) {
            if (res && res.error) console.warn('Broadcast status DB update error:', res.error);
          }).catch(function (e) {
            console.warn('Broadcast status DB update skipped:', e);
          })
        : Promise.resolve();

      return dbUpdate.then(function () {
        if (broadcastId) activeDispatches.delete(broadcastId);
        if (sent === 0 && failed > 0) {
          throw new Error('Delivery failed (' + failed + ' recipient): ' + (lastErrorMsg || 'Please check WhatsApp API connection.'));
        }
        return { success: true, sent: sent, failed: failed, total: targets.length };
      });
    }).catch(function (err) {
      if (broadcastId) activeDispatches.delete(broadcastId);
      if (broadcastId) {
        var localB = broadcasts.find(function (x) { return x.id === broadcastId; });
        if (localB && localB.status === 'processing') {
          localB.status = 'failed';
        }
        db.from('broadcasts').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', broadcastId).catch(function () {});
      }
      throw err;
    });
  }

  /* TWP Brand Loading & Skeleton Animation System */
  function showActionLoader(title, subtitle) {
    var ldr = $('actionLoader');
    if (!ldr) return;
    var h = $('actionLoaderHeading');
    var s = $('actionLoaderSub');
    if (h) h.textContent = title || 'Saving changes...';
    if (s) s.textContent = subtitle || 'Please wait a moment while we update your store.';
    ldr.hidden = false;
  }

  function hideActionLoader() {
    var ldr = $('actionLoader');
    if (ldr) ldr.hidden = true;
  }

  function setButtonLoading(btn, loading, text) {
    if (!btn) return;
    if (loading) {
      if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.innerHTML = '<span class="twp-btn-spinner" aria-hidden="true"></span> ' + (text || 'Please wait...');
    } else {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      }
    }
  }

  function showListSkeleton(listId, type, message) {
    var list = $(listId);
    if (!list) return;
    list.innerHTML = '';

    // Loader Header with Animated Waffle SVG
    var ldr = document.createElement('li');
    ldr.className = 'twp-list-loader';
    ldr.innerHTML = 
      '<div class="twp-waffle-spinner-wrap" aria-hidden="true">' +
        '<svg viewBox="0 0 100 100" width="46" height="46">' +
          '<rect x="10" y="10" width="80" height="80" rx="16" fill="#f7c368" stroke="#3f2912" stroke-width="6"/>' +
          '<line x1="37" y1="13" x2="37" y2="87" stroke="#3f2912" stroke-width="5" stroke-linecap="round"/>' +
          '<line x1="63" y1="13" x2="63" y2="87" stroke="#3f2912" stroke-width="5" stroke-linecap="round"/>' +
          '<line x1="13" y1="37" x2="87" y2="37" stroke="#3f2912" stroke-width="5" stroke-linecap="round"/>' +
          '<line x1="13" y1="63" x2="87" y2="63" stroke="#3f2912" stroke-width="5" stroke-linecap="round"/>' +
          '<rect x="42" y="42" width="16" height="16" rx="4" fill="#fff3b0" stroke="#3f2912" stroke-width="3"/>' +
        '</svg>' +
      '</div>' +
      '<div class="twp-list-loader__info">' +
        '<b class="twp-list-loader__title">' + (message || 'Loading...') + '</b>' +
        '<small class="twp-list-loader__desc">Baking fresh updates from your database...</small>' +
      '</div>';
    list.appendChild(ldr);

    // 3 Shimmer Skeleton Cards matching .list li grid
    for (var i = 0; i < 3; i++) {
      var sk = document.createElement('li');
      sk.className = 'twp-skeleton-li';
      var thumbHtml = type === 'customers' ? 
        '<div class="twp-sk-thumb" style="border-radius:var(--radius-pill);width:48px;height:48px;" aria-hidden="true"></div>' : 
        '<div class="twp-sk-thumb" aria-hidden="true"></div>';
      sk.innerHTML = 
        thumbHtml +
        '<div class="twp-sk-text" aria-hidden="true">' +
          '<div class="twp-sk-line twp-sk-title" style="width:' + (i === 1 ? '55%' : (i === 2 ? '38%' : '45%')) + '"></div>' +
          '<div class="twp-sk-line twp-sk-sub" style="width:' + (i === 1 ? '75%' : '65%') + '"></div>' +
        '</div>' +
        '<div class="twp-sk-acts" aria-hidden="true">' +
          '<div class="twp-sk-btn"></div>' +
          '<div class="twp-sk-btn"></div>' +
        '</div>';
      list.appendChild(sk);
    }
  }

  /* Views & Navigation */
  function show(view) {
    $('loginView').hidden = view !== 'login';
    $('appView').hidden = view !== 'app';
  }
  function tab(name) {
    ['offers', 'menu', 'customers', 'hours'].forEach(function (t) {
      var s = $('tab-' + t);
      if (s) s.hidden = t !== name;
    });
    [].forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.tab === name));
    });
  }
  [].forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () {
      var t = b.dataset.tab;
      tab(t);
      if (t === 'offers') loadOffers();
      else if (t === 'menu') loadItems();
      else if (t === 'customers') loadCustomers();
      else if (t === 'hours') loadHours();
    });
  });
  [].forEach.call(document.querySelectorAll('[data-cancel]'), function (b) {
    b.addEventListener('click', function () { $(b.dataset.cancel).hidden = true; });
  });

  /* Custom Brand Dropdowns */
  function setupDropdown(dropdownId, inputId) {
    var dd = $(dropdownId);
    if (!dd) return { set: function () {} };
    var btn = dd.querySelector('.twp-dropdown__btn');
    var menu = dd.querySelector('.twp-dropdown__menu');
    var input = $(inputId);
    var selected = dd.querySelector('.twp-dropdown__selected');
    var opts = [].slice.call(dd.querySelectorAll('.twp-dropdown__opt'));

    function set(val) {
      if (input) input.value = val;
      opts.forEach(function (opt) {
        var match = opt.dataset.value === val;
        opt.classList.toggle('is-selected', match);
        opt.setAttribute('aria-selected', String(match));
        if (match && selected) {
          selected.innerHTML = opt.querySelector('.twp-dropdown__opt-text').innerHTML;
        }
      });
    }

    function open() {
      [].forEach.call(document.querySelectorAll('.twp-dropdown__menu'), function (m) {
        if (m !== menu) {
          m.hidden = true;
          var b = m.parentElement.querySelector('.twp-dropdown__btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    }

    function close() {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });

    opts.forEach(function (opt) {
      opt.addEventListener('click', function (e) {
        e.stopPropagation();
        set(opt.dataset.value);
        close();
        btn.focus();
      });
    });

    document.addEventListener('click', function (e) {
      if (!dd.contains(e.target)) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) {
        close();
        btn.focus();
      }
    });

    return { set: set, open: open, close: close };
  }

  var sourceDropdown = setupDropdown('dropdown-source', 'c-source');
  var sceneDropdown = setupDropdown('dropdown-scene', 'm-scene');

  /* Custom Image Uploader Component Controller */
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function setupImageUploader(opts) {
    var input = $(opts.inputId);
    var dropzone = $(opts.dropzoneId);
    var preview = $(opts.previewId);
    var img = $(opts.imgId);
    var badge = $(opts.badgeId);
    var nameEl = $(opts.nameId);
    var sizeEl = $(opts.sizeId);
    var changeBtn = $(opts.changeBtnId);
    var removeBtn = $(opts.removeBtnId);
    var currentUrl = null;

    if (!input || !dropzone || !preview) return { reset: function () {}, setExisting: function () {} };

    function reset(triggerClear) {
      input.value = '';
      currentUrl = null;
      preview.hidden = true;
      dropzone.hidden = false;
      img.src = '';
      if (triggerClear && opts.onClear) opts.onClear();
    }

    function setExisting(url) {
      if (!url) { reset(false); return; }
      currentUrl = url;
      input.value = '';
      dropzone.hidden = true;
      preview.hidden = false;
      img.src = src(url);
      if (nameEl) nameEl.textContent = url.split('/').pop().split('?')[0];
      if (sizeEl) sizeEl.textContent = 'Existing image';
      if (badge) {
        badge.textContent = 'Current photo';
        badge.classList.add('is-existing');
      }
    }

    function handleFile(file) {
      if (!file) { reset(true); return; }
      var ext = TYPES[file.type];
      if (!ext) {
        toast('Please choose a JPG, PNG or WebP image.');
        input.value = '';
        return;
      }
      if (file.size > MAX_BYTES) {
        toast('Image is over 5 MB. Please choose a smaller one.');
        input.value = '';
        return;
      }
      var objectUrl = URL.createObjectURL(file);
      currentUrl = null;
      dropzone.hidden = true;
      preview.hidden = false;
      img.src = objectUrl;
      if (nameEl) nameEl.textContent = file.name;
      if (sizeEl) sizeEl.textContent = formatBytes(file.size);
      if (badge) {
        badge.textContent = '✓ Selected';
        badge.classList.remove('is-existing');
      }
      if (opts.onChange) opts.onChange(file, objectUrl);
    }

    dropzone.addEventListener('click', function () {
      input.value = '';
      if (this.tagName !== 'LABEL') input.click();
    });
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.value = '';
        input.click();
      }
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'drop'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('is-dragover');
      });
    });

    dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        var dt = new DataTransfer();
        dt.items.add(e.dataTransfer.files[0]);
        input.files = dt.files;
        handleFile(e.dataTransfer.files[0]);
      }
    });

    input.addEventListener('change', function () {
      handleFile(this.files && this.files[0]);
    });

    if (changeBtn) {
      changeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        input.click();
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        reset(true);
      });
    }

    return {
      reset: reset,
      setExisting: setExisting,
      getFile: function () { return input.files && input.files[0]; },
      hasFile: function () { return !!(input.files && input.files[0]); },
      hasExisting: function () { return !preview.hidden && !input.files[0] && !!currentUrl; },
      getUrl: function () { return currentUrl; }
    };
  }

  var posterUploader = setupImageUploader({
    inputId: 'o-poster',
    dropzoneId: 'o-poster-dropzone',
    previewId: 'o-poster-preview',
    imgId: 'o-poster-img',
    badgeId: 'o-poster-badge',
    nameId: 'o-poster-name',
    sizeId: 'o-poster-size',
    changeBtnId: 'o-poster-change',
    removeBtnId: 'o-poster-remove',
    onChange: function (file, previewUrl) {
      $('waThumb').src = previewUrl;
      updateImageMode();
    },
    onClear: function () {
      $('waThumb').src = '/assets/badge-waffle.svg';
      updateImageMode();
    }
  });

  var photoUploader = setupImageUploader({
    inputId: 'm-photo',
    dropzoneId: 'm-photo-dropzone',
    previewId: 'm-photo-preview',
    imgId: 'm-photo-img',
    badgeId: 'm-photo-badge',
    nameId: 'm-photo-name',
    sizeId: 'm-photo-size',
    changeBtnId: 'm-photo-change',
    removeBtnId: 'm-photo-remove'
  });

  /* Generic Row Builder */
  function row(imgUrl, title, pills, sub, onEdit, onDelete, extraBtns) {
    var li = el('li');
    if (imgUrl) {
      var i = el('img');
      i.src = src(imgUrl);
      i.alt = '';
      li.appendChild(i);
    } else {
      li.appendChild(el('span', 'noimg'));
    }

    var text = el('div', 'list-info');

    // Header line: Title + Primary Status Pill (e.g. Live, Showing, Active)
    var header = el('div', 'list-header');
    header.appendChild(el('b', 'list-title', title));

    var primaryPill = (pills && pills.length && !pills[0].cls) ? pills[0] : null;
    var otherPills = primaryPill ? pills.slice(1) : (pills || []);

    if (primaryPill) {
      var pcls = 'pill';
      if (primaryPill.on) pcls += ' pill--on';
      header.appendChild(el('span', pcls, primaryPill.text));
    }
    text.appendChild(header);

    // Secondary / Broadcast Pills (e.g. WhatsApp Scheduled, WhatsApp Sent)
    if (otherPills.length) {
      var pillsWrap = el('div', 'list-pills');
      otherPills.forEach(function (p) {
        var cls = 'pill';
        if (p.cls) cls += ' ' + p.cls;
        else if (p.on) cls += ' pill--on';
        pillsWrap.appendChild(el('span', cls, p.text));
      });
      text.appendChild(pillsWrap);
    }

    // Subtitle (Dates, Price, Phone)
    if (sub) {
      text.appendChild(el('div', 'list-sub', sub));
    }
    li.appendChild(text);

    var acts = el('div', 'acts');
    if (extraBtns) extraBtns.forEach(function (btn) { acts.appendChild(btn); });
    if (onEdit) {
      var edit = el('button', '', 'Edit');
      edit.type = 'button';
      edit.setAttribute('aria-label', 'Edit ' + title);
      edit.addEventListener('click', onEdit);
      acts.appendChild(edit);
    }
    if (onDelete) {
      var del = el('button', '', 'Delete');
      del.type = 'button';
      del.setAttribute('aria-label', 'Delete ' + title);
      del.addEventListener('click', onDelete);
      acts.appendChild(del);
    }
    li.appendChild(acts);
    return li;
  }

  var confirmResolver = null;
  var confirmReturnFocus = null;

  function closeConfirm(result) {
    var modal = $('confirmModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.classList.remove('is-wa', 'is-danger');
    var resolve = confirmResolver;
    confirmResolver = null;
    if (confirmReturnFocus && typeof confirmReturnFocus.focus === 'function') {
      try { confirmReturnFocus.focus(); } catch (e) {}
    }
    confirmReturnFocus = null;
    if (resolve) resolve(!!result);
  }

  var CONFIRM_ICONS = {
    danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20" aria-hidden="true"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg>'
  };

  function askConfirm(opts) {
    var modal = $('confirmModal');
    if (!modal) return Promise.resolve(false);
    if (confirmResolver) closeConfirm(false);
    confirmReturnFocus = document.activeElement;
    var tone = (opts && opts.tone) === 'wa' ? 'wa' : 'danger';
    modal.classList.remove('is-wa', 'is-danger');
    modal.classList.add('is-' + tone);
    var icon = $('confirmIcon');
    if (icon) icon.innerHTML = CONFIRM_ICONS[tone];
    $('confirmTitle').textContent = (opts && opts.title) || 'Confirm action';
    $('confirmDesc').textContent = (opts && opts.message) || '';
    $('confirmCancelBtn').textContent = (opts && opts.cancelText) || 'Cancel';
    var okBtn = $('confirmOkBtn');
    okBtn.textContent = (opts && opts.confirmText) || 'Confirm';
    okBtn.className = 'twp-btn twp-modal__confirm twp-modal__confirm--' + tone;
    modal.hidden = false;
    setTimeout(function () { $('confirmCancelBtn').focus(); }, 0);
    return new Promise(function (resolve) { confirmResolver = resolve; });
  }

  $('confirmCancelBtn').addEventListener('click', function () { closeConfirm(false); });
  $('confirmOkBtn').addEventListener('click', function () { closeConfirm(true); });
  $('confirmModal').addEventListener('click', function (ev) {
    if (ev.target === $('confirmModal')) closeConfirm(false);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && $('confirmModal') && !$('confirmModal').hidden) {
      ev.preventDefault();
      closeConfirm(false);
    } else if (ev.key === 'Escape' && $('csvFormatModal') && !$('csvFormatModal').hidden) {
      ev.preventDefault();
      closeCsvFormatModal();
    }
  });

  function remove(table, id, name, reload) {
    askConfirm({
      title: 'Delete "' + name + '"?',
      message: 'This will permanently delete "' + name + '". This cannot be undone.',
      confirmText: 'Delete',
      tone: 'danger'
    }).then(function (ok) {
      if (!ok) return;
      showActionLoader('Deleting ' + name + '...', 'Removing record from database...');
      db.from(table).delete().eq('id', id).then(function (r) {
        must(r);
        toast('Deleted ' + name);
        return reload();
      }).catch(function (e) {
        toast(say(e));
      }).finally(function () {
        hideActionLoader();
      });
    });
  }

  /* OFFERS SECTION */
  function state(o) {
    var t = today();
    if (!o.is_visible) return { text: 'Hidden', on: false };
    if (o.ends_on < t) return { text: 'Ended', on: false };
    if (o.starts_on > t) return { text: 'Scheduled', on: false };
    return { text: 'Live', on: true };
  }

  function getOfferBroadcast(offerId) {
    if (!offerId) return null;
    var matches = broadcasts.filter(function (b) { return b.offer_id === offerId; });
    if (!matches.length) return null;
    // 1. If there's an active scheduled or processing broadcast, always prefer it
    var active = matches.find(function (b) { return b.status === 'scheduled' || b.status === 'processing'; });
    if (active) return active;
    // 2. Otherwise return the newest one by timestamp
    matches.sort(function (a, b) {
      var ta = a.completed_at || a.created_at || a.scheduled_at || '';
      var tb = b.completed_at || b.created_at || b.scheduled_at || '';
      return tb.localeCompare(ta);
    });
    return matches[0];
  }

  function drawOffers() {
    var list = $('offerList');
    list.textContent = '';
    if (!offers.length) list.appendChild(el('li', 'empty', 'No offers yet. Add the first one.'));
    offers.forEach(function (o) {
      var pills = [state(o)];
      var b = getOfferBroadcast(o.id);
      var extraBtns = [];

      if (b && b.status === 'scheduled') {
        pills.push({ text: 'WhatsApp Scheduled: ' + formatDateTime(b.scheduled_at), cls: 'pill--scheduled' });
        var sendNow = el('button', 'acts__primary', 'Drop now');
        sendNow.type = 'button';
        sendNow.title = 'Send this WhatsApp broadcast immediately to all customers';
        sendNow.addEventListener('click', function () { dispatchBroadcastNow(b.id, o); });
        extraBtns.push(sendNow);
      } else {
        if (b) {
          if (b.status === 'completed') {
            if ((b.total_recipients || 0) === 0) {
              pills.push({ text: 'WhatsApp: 0 Customers in CRM', cls: 'pill--failed' });
            } else {
              pills.push({ text: 'WhatsApp Sent (' + (b.sent_count || 0) + '/' + (b.total_recipients || 0) + ')', cls: 'pill--broadcast' });
            }
          } else if (b.status === 'processing') {
            pills.push({ text: 'WhatsApp Sending...', cls: 'pill--scheduled' });
          } else if (b.status === 'failed') {
            pills.push({ text: 'WhatsApp Failed', cls: 'pill--failed' });
          }
        }

        // Direct WhatsApp broadcast to all customers
        var broadcastBtn = el('button', 'acts__primary', 'WhatsApp to Customers');
        broadcastBtn.type = 'button';
        broadcastBtn.title = 'Send this offer via WhatsApp to all subscribed customers';
        broadcastBtn.addEventListener('click', function () {
          var subList = customers.filter(function (c) { return c.is_subscribed; });
          var subCount = subList.length;
          if (subCount === 0) {
            toast('No subscribed customers found in CRM. Add customers or import a CSV first.');
            return;
          }
          askConfirm({
            title: 'Broadcast Offer to Customers?',
            message: 'Send "' + o.name + '" (' + o.discount + ') via WhatsApp to ' + subCount + ' subscribed customer(s) right now?',
            confirmText: 'Send to ' + subCount + ' Customers',
            tone: 'wa'
          }).then(function (ok) {
            if (!ok) return;
            showActionLoader('Broadcasting WhatsApp Offer...', 'Delivering "' + o.name + '" to your ' + subCount + ' customer subscribers...');
            var curB = getOfferBroadcast(o.id);
            var bId = curB ? curB.id : null;
            var p = bId 
              ? Promise.resolve({ id: bId })
              : db.from('broadcasts').insert({
                  offer_id: o.id,
                  status: 'scheduled',
                  scheduled_at: new Date().toISOString()
                }).select('id').then(function (res) {
                  var d = res && res.data;
                  return (d && d[0]) || {};
                }).catch(function (dbErr) {
                  console.warn('DB broadcast insert skipped:', dbErr);
                  return {};
                });

            p.then(function (createdB) {
              return dispatchMetaBroadcast((createdB && createdB.id) || bId, o, subList);
            }).then(function (res) {
              toast('Offer sent to ' + (res.sent || subCount) + ' customer(s) successfully via WhatsApp Cloud API!');
              loadOffers();
            }).catch(function (e) {
              toast('Broadcast error: ' + e.message);
            }).finally(function () {
              hideActionLoader();
            });
          });
        });
        extraBtns.push(broadcastBtn);
      }

      var sub = o.discount + ' · ' + day(o.starts_on) + ' to ' + day(o.ends_on);
      list.appendChild(row(o.poster_url, o.name, pills, sub,
        function () { openOffer(o); },
        function () { remove('offers', o.id, o.name, loadOffers); },
        extraBtns
      ));
    });
  }

  function loadOffers() {
    showListSkeleton('offerList', 'offers', 'Loading offers & WhatsApp broadcasts...');
    return Promise.all([
      db.from('offers').select('*').order('ends_on', { ascending: false }),
      db.from('broadcasts').select('*')
    ]).then(function (results) {
      offers = must(results[0]);
      broadcasts = must(results[1]) || [];
      $('countBroadcasts').textContent = broadcasts.length;
      drawOffers();
      if (typeof checkDueScheduledBroadcasts === 'function') {
        checkDueScheduledBroadcasts();
      }
    }).catch(function (e) {
      toast(say(e));
      $('offerList').innerHTML = '<li class="empty">' + say(e) + '</li>';
    });
  }

  /* WhatsApp Preview Synchronizer */
  var DEFAULT_WA_TEMPLATE = [
    '*That Waffle Place*',
    '',
    'Hey {name}! 🧇 Fresh offer from *That Waffle Place*:',
    '',
    '🔥 *{offer}*',
    '🏷️ *OFFER:* *{discount}* on your order!',
    '📅 *Valid:* {validity}',
    '📝 *Terms:* {terms}',
    '',
    'Show this message at the counter or order online to claim! 🧇✨',
    '_Reply STOP to unsubscribe_'
  ].join('\n');

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatWhatsAppPreview(rawText, vars) {
    var text = rawText || '';
    text = text.replace(/\{name\}|\{\{1\}\}|\{\{Customer Name\}\}/g, '[[VAR:name]]');
    text = text.replace(/\{offer\}|\{\{2\}\}/g, '[[VAR:offer]]');
    text = text.replace(/\{discount\}|\{\{3\}\}/g, '[[VAR:discount]]');
    text = text.replace(/\{validity\}|\{\{4\}\}/g, '[[VAR:validity]]');
    text = text.replace(/\{terms\}|\{\{5\}\}/g, '[[VAR:terms]]');

    var escaped = escapeHtml(text);
    escaped = escaped.replace(/\[\[VAR:name\]\]/g, '<span class="wa-prev-var">' + escapeHtml(vars.name || 'Customer') + '</span>');
    escaped = escaped.replace(/\[\[VAR:offer\]\]/g, '<span class="wa-prev-var">' + escapeHtml(vars.offer || 'Offer') + '</span>');
    escaped = escaped.replace(/\[\[VAR:discount\]\]/g, '<span class="wa-prev-var">' + escapeHtml(vars.discount || 'Discount') + '</span>');
    escaped = escaped.replace(/\[\[VAR:validity\]\]/g, '<span class="wa-prev-var">' + escapeHtml(vars.validity || 'Valid dates') + '</span>');
    escaped = escaped.replace(/\[\[VAR:terms\]\]/g, '<span class="wa-prev-var">' + escapeHtml(vars.terms || 'Terms apply') + '</span>');

    escaped = escaped.replace(/(^|[\s(])\*([^*\n\r]+?)\*(?=[\s).,!?:]|$)/g, '$1<strong>$2</strong>');
    escaped = escaped.replace(/(^|[\s(])_([^_\n\r]+?)_(?=[\s).,!?:]|$)/g, '$1<em>$2</em>');
    escaped = escaped.replace(/(^|[\s(])~([^~\n\r]+?)~(?=[\s).,!?:]|$)/g, '$1<del>$2</del>');
    escaped = escaped.replace(/\r?\n/g, '<br>');

    return escaped;
  }

  function updateImageMode() {
    var thumb = $('waThumb');
    var isDefault = !thumb.src || thumb.src.indexOf('badge-waffle.svg') !== -1;
    $('waPrevImg').classList.toggle('is-default-badge', isDefault);
  }

  function validateOfferDates() {
    var startEl = $('o-start'), endEl = $('o-end'), errEl = $('o-date-err');
    var start = startEl ? startEl.value : '', end = endEl ? endEl.value : '';

    var bad = !!(start && end && end < start);
    if (endEl && endEl.setCustomValidity) {
      endEl.setCustomValidity(bad ? 'End date must be on or after the start date.' : '');
    }
    var trigger = $('o-end-trigger');
    if (trigger) trigger.classList.toggle('is-invalid', bad);
    var box = endEl && endEl.closest('.twp-input');
    if (box) box.classList.toggle('is-invalid', bad);
    if (errEl) {
      errEl.textContent = bad ? 'End date cannot be before start date.' : '';
      errEl.hidden = !bad;
    }
    if (!bad && $('offerMsg') && $('offerMsg').textContent === 'End date cannot be before start date.') {
      $('offerMsg').textContent = '';
    }
    return !bad;
  }

  function syncWhatsAppPreview() {
    var datesOk = validateOfferDates();
    var name = $('o-name').value.trim() || 'WEEEKEND OFFER';
    var disc = $('o-discount').value.trim() || 'Special discount';
    var start = $('o-start').value;
    var end = $('o-end').value;
    var terms = $('o-terms').value.trim() || 'Terms apply. Dine-in only.';
    var validityStr = !datesOk ? 'Invalid dates (end before start)' : (start && end ? day(start) + ' to ' + day(end) : 'Soon');

    var customMsgInput = $('o-custom-msg');
    var rawCustom = customMsgInput ? customMsgInput.value : '';
    if (!rawCustom && customMsgInput) {
      customMsgInput.value = DEFAULT_WA_TEMPLATE;
      rawCustom = DEFAULT_WA_TEMPLATE;
    }

    var bubble = $('waBubbleContent');
    if (bubble) {
      var sampleCust = customers.find(function (c) { return c.is_subscribed; });
      var previewCustName = sampleCust ? (sampleCust.name || 'Aravindan') : 'Aravindan';
      bubble.innerHTML = formatWhatsAppPreview(rawCustom, {
        name: previewCustName,
        offer: name,
        discount: disc,
        validity: validityStr,
        terms: terms
      });
    }

    var counter = $('waMsgCounter');
    if (counter) {
      var len = (rawCustom || '').length;
      counter.textContent = len + ' / 1024';
      counter.classList.toggle('is-warning', len > 900 && len <= 1024);
      counter.classList.toggle('is-limit', len > 1024);
    }

    updateImageMode();
  }

  /* Custom DateTime Picker & Scheduler UI */
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var dtCurrentDate = new Date();
  var dtSelectedDate = new Date();
  var dtViewYear = dtCurrentDate.getFullYear();
  var dtViewMonth = dtCurrentDate.getMonth();
  var dtHour = 10;
  var dtMinute = 0;
  var dtAmPm = 'AM';

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function formatBtimeDisplay(d) {
    if (!d || isNaN(d.getTime())) return 'Choose Date & Time (IST)';
    var t = today();
    var ymd = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    var dayLabel = day(ymd);
    
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    var timeStr = h12 + ':' + pad(m) + ' ' + ampm;

    if (ymd === t) {
      return 'Today (' + dayLabel + ') at ' + timeStr;
    }
    var tom = new Date();
    tom.setDate(tom.getDate() + 1);
    var tomYmd = tom.getFullYear() + '-' + pad(tom.getMonth() + 1) + '-' + pad(tom.getDate());
    if (ymd === tomYmd) {
      return 'Tomorrow (' + dayLabel + ') at ' + timeStr;
    }
    return dayLabel + ' at ' + timeStr;
  }

  function updateBtimeUI(val) {
    var hidden = $('o-btime');
    var label = $('o-btime-label');
    if (!hidden) return;
    hidden.value = val || '';
    if (!val) {
      if (label) label.textContent = 'Choose Date & Time (IST)';
      return;
    }
    var d = new Date(val);
    if (label) label.textContent = formatBtimeDisplay(d);
    
    if (!isNaN(d.getTime())) {
      dtSelectedDate = new Date(d);
      dtViewYear = d.getFullYear();
      dtViewMonth = d.getMonth();
      var rawH = d.getHours();
      dtHour = rawH % 12 || 12;
      dtMinute = d.getMinutes();
      dtAmPm = rawH >= 12 ? 'PM' : 'AM';
      syncDtControls();
    }
  }

  function syncDtControls() {
    var hSel = $('dtHourSelect');
    var mSel = $('dtMinuteSelect');
    var amBtn = $('dtAmBtn');
    var pmBtn = $('dtPmBtn');
    if (hSel) hSel.value = pad(dtHour);
    if (mSel) {
      var mVal = pad(dtMinute);
      if (!mSel.querySelector('option[value="' + mVal + '"]')) {
        var opt = document.createElement('option');
        opt.value = mVal;
        opt.textContent = mVal;
        mSel.appendChild(opt);
      }
      mSel.value = mVal;
    }
    if (amBtn && pmBtn) {
      amBtn.classList.toggle('is-active', dtAmPm === 'AM');
      pmBtn.classList.toggle('is-active', dtAmPm === 'PM');
    }
    updateDtStatus();
  }

  function updateDtStatus() {
    var stat = $('dtSelectedSummary');
    if (!stat) return;
    var ymd = dtSelectedDate.getFullYear() + '-' + pad(dtSelectedDate.getMonth() + 1) + '-' + pad(dtSelectedDate.getDate());
    var timeStr = dtHour + ':' + pad(dtMinute) + ' ' + dtAmPm;
    stat.textContent = day(ymd) + ', ' + timeStr;
  }

  function renderDtCalendar() {
    var title = $('dtMonthYear');
    var grid = $('dtDaysGrid');
    if (!title || !grid) return;

    title.textContent = MONTH_NAMES[dtViewMonth] + ' ' + dtViewYear;
    grid.innerHTML = '';

    var firstDay = new Date(dtViewYear, dtViewMonth, 1).getDay();
    var totalDays = new Date(dtViewYear, dtViewMonth + 1, 0).getDate();

    for (var i = 0; i < firstDay; i++) {
      var empty = document.createElement('div');
      empty.className = 'twp-dt-day is-empty';
      grid.appendChild(empty);
    }

    var now = new Date();
    var todayYmd = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    var selYmd = dtSelectedDate ? (dtSelectedDate.getFullYear() + '-' + pad(dtSelectedDate.getMonth() + 1) + '-' + pad(dtSelectedDate.getDate())) : '';

    for (var d = 1; d <= totalDays; d++) {
      var dayBtn = document.createElement('button');
      dayBtn.type = 'button';
      dayBtn.className = 'twp-dt-day';
      dayBtn.textContent = d;
      
      var thisYmd = dtViewYear + '-' + pad(dtViewMonth + 1) + '-' + pad(d);
      if (thisYmd < todayYmd) {
        dayBtn.classList.add('is-disabled');
      } else {
        if (thisYmd === todayYmd) dayBtn.classList.add('is-today');
        if (thisYmd === selYmd) dayBtn.classList.add('is-selected');

        dayBtn.addEventListener('click', (function (currYear, currMonth, currDay) {
          return function (ev) {
            if (ev) ev.stopPropagation();
            dtSelectedDate = new Date(currYear, currMonth, currDay);
            renderDtCalendar();
            updateDtStatus();
          };
        })(dtViewYear, dtViewMonth, d));

        // Double-click a day to immediately apply with currently selected time and auto-close
        dayBtn.addEventListener('dblclick', function (ev) {
          if (ev) ev.stopPropagation();
          applyDateTimeSelection(true);
        });
      }
      grid.appendChild(dayBtn);
    }
  }

  function applyDateTimeSelection(autoClose) {
    var h24 = dtAmPm === 'PM' ? (dtHour % 12 + 12) : (dtHour % 12);
    var finalDate = new Date(dtSelectedDate.getFullYear(), dtSelectedDate.getMonth(), dtSelectedDate.getDate(), h24, dtMinute, 0);
    var isoLocal = finalDate.getFullYear() + '-' + pad(finalDate.getMonth() + 1) + '-' + pad(finalDate.getDate()) + 'T' + pad(finalDate.getHours()) + ':' + pad(finalDate.getMinutes());
    
    updateBtimeUI(isoLocal);
    closeDtPicker();
    if (!autoClose) {
      toast('Broadcast scheduled for ' + formatBtimeDisplay(finalDate));
    }
  }

  function openDtPicker() {
    var picker = $('twpDtPicker');
    var trigger = $('o-btime-trigger');
    if (!picker) return;

    var curVal = $('o-btime').value;
    if (curVal) {
      var d = new Date(curVal);
      if (!isNaN(d.getTime())) {
        dtSelectedDate = new Date(d);
        dtViewYear = d.getFullYear();
        dtViewMonth = d.getMonth();
        var rawH = d.getHours();
        dtHour = rawH % 12 || 12;
        dtMinute = d.getMinutes();
        dtAmPm = rawH >= 12 ? 'PM' : 'AM';
      }
    } else {
      var d = new Date();
      d.setMinutes(d.getMinutes() + 15);
      dtSelectedDate = new Date(d);
      dtViewYear = d.getFullYear();
      dtViewMonth = d.getMonth();
      var rawH = d.getHours();
      dtHour = rawH % 12 || 12;
      dtMinute = Math.ceil(d.getMinutes() / 5) * 5 % 60;
      dtAmPm = rawH >= 12 ? 'PM' : 'AM';
    }

    renderDtCalendar();
    syncDtControls();
    picker.hidden = false;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }

  function closeDtPicker() {
    var picker = $('twpDtPicker');
    var trigger = $('o-btime-trigger');
    if (!picker || picker.hidden) return;
    picker.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function initDateTimePicker() {
    var hSel = $('dtHourSelect');
    var mSel = $('dtMinuteSelect');
    if (hSel && !hSel.options.length) {
      for (var h = 1; h <= 12; h++) {
        var opt = document.createElement('option');
        opt.value = pad(h);
        opt.textContent = pad(h);
        hSel.appendChild(opt);
      }
    }
    if (mSel && !mSel.options.length) {
      for (var m = 0; m < 60; m += 5) {
        var opt = document.createElement('option');
        opt.value = pad(m);
        opt.textContent = pad(m);
        mSel.appendChild(opt);
      }
    }

    var trigger = $('o-btime-trigger');
    if (trigger) {
      trigger.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var picker = $('twpDtPicker');
        if (picker && !picker.hidden) {
          closeDtPicker();
        } else {
          openDtPicker();
        }
      });
      trigger.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openDtPicker();
        }
      });
    }

    var prevBtn = $('dtPrevMonth');
    if (prevBtn) {
      prevBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        dtViewMonth--;
        if (dtViewMonth < 0) {
          dtViewMonth = 11;
          dtViewYear--;
        }
        renderDtCalendar();
      });
    }

    var nextBtn = $('dtNextMonth');
    if (nextBtn) {
      nextBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        dtViewMonth++;
        if (dtViewMonth > 11) {
          dtViewMonth = 0;
          dtViewYear++;
        }
        renderDtCalendar();
      });
    }

    var amBtn = $('dtAmBtn');
    var pmBtn = $('dtPmBtn');
    if (amBtn) {
      amBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        dtAmPm = 'AM';
        syncDtControls();
      });
    }
    if (pmBtn) {
      pmBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        dtAmPm = 'PM';
        syncDtControls();
      });
    }

    if (hSel) {
      hSel.addEventListener('change', function () {
        dtHour = parseInt(this.value, 10);
        updateDtStatus();
      });
    }
    if (mSel) {
      mSel.addEventListener('change', function () {
        dtMinute = parseInt(this.value, 10);
        updateDtStatus();
        // Auto-close on minute select after brief 250ms feedback
        setTimeout(function () {
          applyDateTimeSelection(true);
        }, 250);
      });
    }

    // Minute chips (:00, :15, :30, :45) - Auto-closes on selection!
    document.querySelectorAll('.twp-min-chip').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        dtMinute = parseInt(this.getAttribute('data-min'), 10);
        syncDtControls();
        setTimeout(function () {
          applyDateTimeSelection(true);
        }, 180);
      });
    });

    // Quick presets (+15 Mins, +1 Hour, Tonight 7 PM, etc.) - Auto-closes on click!
    document.querySelectorAll('.wa-preset-chip').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var preset = this.getAttribute('data-preset');
        var d = new Date();
        if (preset === '15m') {
          d.setMinutes(d.getMinutes() + 15);
        } else if (preset === '1h') {
          d.setHours(d.getHours() + 1);
        } else if (preset === 'tonight') {
          d.setHours(19, 0, 0, 0);
          if (d.getTime() <= Date.now()) {
            d.setDate(d.getDate() + 1);
          }
        } else if (preset === 'tomorrow-morning') {
          d.setDate(d.getDate() + 1);
          d.setHours(10, 0, 0, 0);
        } else if (preset === 'tomorrow-evening') {
          d.setDate(d.getDate() + 1);
          d.setHours(17, 0, 0, 0);
        }
        var iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        updateBtimeUI(iso);
        closeDtPicker();
        toast('Scheduled for ' + formatBtimeDisplay(d));
      });
    });

    var applyBtn = $('dtApplyBtn');
    if (applyBtn) {
      applyBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        applyDateTimeSelection(false);
      });
    }

    var todayBtn = $('dtTodayBtn');
    if (todayBtn) {
      todayBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var now = new Date();
        dtSelectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        dtViewYear = now.getFullYear();
        dtViewMonth = now.getMonth();
        renderDtCalendar();
        updateDtStatus();
      });
    }

    var cancelBtn = $('dtCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        closeDtPicker();
      });
    }

    document.addEventListener('click', function (ev) {
      var picker = $('twpDtPicker');
      var trg = $('o-btime-trigger');
      if (!picker || picker.hidden) return;
      // If the clicked target was unmounted/re-rendered during click handling, ignore
      if (!document.contains(ev.target)) return;
      if (!picker.contains(ev.target) && (!trg || !trg.contains(ev.target))) {
        closeDtPicker();
      }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && $('twpDtPicker') && !$('twpDtPicker').hidden) {
        closeDtPicker();
      }
    });
  }

  initDateTimePicker();

  /* STARTS & ENDS BRANDED DATE PICKERS */
  var dpCurrentField = null; // 'start' or 'end'
  var dpViewYear = new Date().getFullYear();
  var dpViewMonth = new Date().getMonth();

  function toYmd(d) {
    if (!d || isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function formatDateDisplay(ymd) {
    if (!ymd) return 'Select date';
    var p = ymd.split('-');
    if (p.length !== 3) return ymd;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d.getTime())) return ymd;
    var dayNum = d.getDate();
    var mon = MONTH_NAMES[d.getMonth()].slice(0, 3);
    var weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    var t = today();
    if (ymd === t) {
      return 'Today (' + dayNum + ' ' + mon + ' ' + d.getFullYear() + ')';
    }
    var tom = new Date();
    tom.setDate(tom.getDate() + 1);
    if (ymd === toYmd(tom)) {
      return 'Tomorrow (' + dayNum + ' ' + mon + ')';
    }
    return dayNum + ' ' + mon + ' ' + d.getFullYear() + ' (' + weekday + ')';
  }

  function setStartDate(ymd) {
    var inp = $('o-start');
    if (inp) inp.value = ymd || '';
    var disp = $('o-start-display');
    if (disp) disp.textContent = ymd ? formatDateDisplay(ymd) : 'Select start date';
    validateOfferDates();
    syncWhatsAppPreview();
  }

  function setEndDate(ymd) {
    var inp = $('o-end');
    if (inp) inp.value = ymd || '';
    var disp = $('o-end-display');
    if (disp) disp.textContent = ymd ? formatDateDisplay(ymd) : 'Select end date';
    validateOfferDates();
    syncWhatsAppPreview();
  }

  function openDatePicker(field) {
    dpCurrentField = field;
    var popup = $('twpDatePopup');
    var trigger = $(field === 'start' ? 'o-start-trigger' : 'o-end-trigger');
    if (!popup || !trigger) return;

    trigger.parentElement.appendChild(popup);

    var curVal = $(field === 'start' ? 'o-start' : 'o-end').value;
    if (curVal) {
      var p = curVal.split('-');
      if (p.length === 3) {
        dpViewYear = +p[0];
        dpViewMonth = +p[1] - 1;
      }
    } else {
      var now = new Date();
      dpViewYear = now.getFullYear();
      dpViewMonth = now.getMonth();
    }

    renderDatePopup();
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }

  function closeDatePicker() {
    var popup = $('twpDatePopup');
    if (!popup || popup.hidden) return;
    popup.hidden = true;
    if ($('o-start-trigger')) $('o-start-trigger').setAttribute('aria-expanded', 'false');
    if ($('o-end-trigger')) $('o-end-trigger').setAttribute('aria-expanded', 'false');
    dpCurrentField = null;
  }

  function renderDatePopup() {
    var title = $('dpMonthYear');
    var grid = $('dpDaysGrid');
    var status = $('dpSelectedStatus');
    if (!title || !grid) return;

    title.textContent = MONTH_NAMES[dpViewMonth] + ' ' + dpViewYear;
    grid.innerHTML = '';

    var firstDay = new Date(dpViewYear, dpViewMonth, 1).getDay();
    var totalDays = new Date(dpViewYear, dpViewMonth + 1, 0).getDate();

    for (var i = 0; i < firstDay; i++) {
      var empty = document.createElement('div');
      empty.className = 'twp-dt-day is-empty';
      grid.appendChild(empty);
    }

    var now = new Date();
    var todayYmd = toYmd(now);
    var activeVal = dpCurrentField === 'start' ? $('o-start').value : $('o-end').value;
    // Offers can only start from today onwards (past dates disabled), unless editing an existing offer with an earlier start date
    var minStart = (editingOffer && editingOffer.starts_on && editingOffer.starts_on < todayYmd) ? editingOffer.starts_on : todayYmd;
    var minDateYmd = dpCurrentField === 'end' ? ($('o-start').value || todayYmd) : minStart;

    if (status) {
      status.textContent = 'Selecting ' + (dpCurrentField === 'start' ? 'Start date' : 'End date');
    }

    for (var d = 1; d <= totalDays; d++) {
      var dayBtn = document.createElement('button');
      dayBtn.type = 'button';
      dayBtn.className = 'twp-dt-day';
      dayBtn.textContent = d;

      var thisYmd = dpViewYear + '-' + pad(dpViewMonth + 1) + '-' + pad(d);

      if (minDateYmd && thisYmd < minDateYmd) {
        dayBtn.classList.add('is-disabled');
      } else {
        if (thisYmd === todayYmd) dayBtn.classList.add('is-today');
        if (thisYmd === activeVal) dayBtn.classList.add('is-selected');

        dayBtn.addEventListener('click', (function (selectedYmd) {
          return function (ev) {
            if (ev) ev.stopPropagation();
            if (dpCurrentField === 'start') {
              setStartDate(selectedYmd);
              var curEnd = $('o-end').value;
              if (curEnd && curEnd < selectedYmd) {
                setEndDate(selectedYmd);
              }
            } else if (dpCurrentField === 'end') {
              setEndDate(selectedYmd);
            }
            closeDatePicker();
          };
        })(thisYmd));
      }
      grid.appendChild(dayBtn);
    }
  }

  function initDatePickers() {
    var startTrg = $('o-start-trigger');
    var endTrg = $('o-end-trigger');

    if (startTrg) {
      startTrg.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (dpCurrentField === 'start' && $('twpDatePopup') && !$('twpDatePopup').hidden) {
          closeDatePicker();
        } else {
          closeDtPicker();
          openDatePicker('start');
        }
      });
      startTrg.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openDatePicker('start');
        }
      });
    }

    if (endTrg) {
      endTrg.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (dpCurrentField === 'end' && $('twpDatePopup') && !$('twpDatePopup').hidden) {
          closeDatePicker();
        } else {
          closeDtPicker();
          openDatePicker('end');
        }
      });
      endTrg.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openDatePicker('end');
        }
      });
    }

    var prevBtn = $('dpPrevMonth');
    var nextBtn = $('dpNextMonth');
    if (prevBtn) {
      prevBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        dpViewMonth--;
        if (dpViewMonth < 0) { dpViewMonth = 11; dpViewYear--; }
        renderDatePopup();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        dpViewMonth++;
        if (dpViewMonth > 11) { dpViewMonth = 0; dpViewYear++; }
        renderDatePopup();
      });
    }

    var todayBtn = $('dpTodayBtn');
    if (todayBtn) {
      todayBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var t = today();
        if (dpCurrentField === 'start') {
          setStartDate(t);
          var curEnd = $('o-end').value;
          if (curEnd && curEnd < t) setEndDate(t);
        } else if (dpCurrentField === 'end') {
          setEndDate(t);
        }
        closeDatePicker();
      });
    }

    var closeBtn = $('dpCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        closeDatePicker();
      });
    }

    document.querySelectorAll('.date-chip').forEach(function (chip) {
      chip.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var forField = this.dataset.for;
        var preset = this.dataset.preset;
        var now = new Date();

        if (forField === 'start') {
          if (preset === 'today') {
            setStartDate(toYmd(now));
          } else if (preset === 'tomorrow') {
            var tom = new Date(now);
            tom.setDate(tom.getDate() + 1);
            setStartDate(toYmd(tom));
          } else if (preset === 'friday') {
            var d = new Date(now);
            var dayOfWeek = d.getDay();
            var diff = (5 - dayOfWeek + 7) % 7;
            if (diff === 0) diff = 7;
            d.setDate(d.getDate() + diff);
            setStartDate(toYmd(d));
          }
          if ($('o-end').value && $('o-end').value < $('o-start').value) {
            setEndDate($('o-start').value);
          }
        } else if (forField === 'end') {
          var baseStart = $('o-start').value || today();
          var p = baseStart.split('-');
          var baseD = new Date(+p[0], +p[1] - 1, +p[2]);

          if (preset === 'same-day') {
            setEndDate(baseStart);
          } else if (preset === '3days') {
            var d = new Date(baseD);
            d.setDate(d.getDate() + 3);
            setEndDate(toYmd(d));
          } else if (preset === '1week') {
            var d = new Date(baseD);
            d.setDate(d.getDate() + 7);
            setEndDate(toYmd(d));
          } else if (preset === 'month-end') {
            var d = new Date(baseD.getFullYear(), baseD.getMonth() + 1, 0);
            setEndDate(toYmd(d));
          }
        }
        closeDatePicker();
      });
    });

    document.addEventListener('click', function (ev) {
      var popup = $('twpDatePopup');
      var sTrg = $('o-start-trigger');
      var eTrg = $('o-end-trigger');
      if (!popup || popup.hidden) return;
      if (!document.contains(ev.target)) return;
      if (!popup.contains(ev.target) && (!sTrg || !sTrg.contains(ev.target)) && (!eTrg || !eTrg.contains(ev.target))) {
        closeDatePicker();
      }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && $('twpDatePopup') && !$('twpDatePopup').hidden) {
        closeDatePicker();
      }
    });
  }

  initDatePickers();

  function updateOfferFormButtons() {
    var doBroadcast = $('o-broadcast') && $('o-broadcast').checked;
    var saveBtn = $('saveOfferBtn');
    var sendNowBtn = $('saveAndSendNowBtn');
    if (saveBtn) {
      saveBtn.textContent = doBroadcast ? 'Save & Schedule' : 'Save offer';
    }
    if (sendNowBtn) {
      sendNowBtn.hidden = !doBroadcast;
      sendNowBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg> Send Broadcast Now';
    }
  }

  function toggleBroadcastSection() {
    var checked = $('o-broadcast').checked;
    $('waDetails').hidden = !checked;
    if (checked && !$('o-btime').value) {
      // Default to now + 15 minutes local time
      var d = new Date();
      d.setMinutes(d.getMinutes() + 15);
      var defIso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      updateBtimeUI(defIso);
    }
    updateOfferFormButtons();
  }

  ['input', 'change'].forEach(function (ev) {
    ['o-name', 'o-discount', 'o-start', 'o-end', 'o-terms', 'o-custom-msg'].forEach(function (id) {
      var elem = $(id);
      if (elem) elem.addEventListener(ev, syncWhatsAppPreview);
    });
  });
  $('o-broadcast').addEventListener('change', toggleBroadcastSection);

  document.querySelectorAll('.wa-tag-btn[data-tag]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tag = this.getAttribute('data-tag');
      var area = $('o-custom-msg');
      if (!area) return;
      var start = area.selectionStart || 0;
      var end = area.selectionEnd || 0;
      var val = area.value;
      area.value = val.substring(0, start) + tag + val.substring(end);
      area.selectionStart = area.selectionEnd = start + tag.length;
      area.focus();
      syncWhatsAppPreview();
    });
  });

  var resetMsgBtn = $('resetMsgBtn');
  if (resetMsgBtn) {
    resetMsgBtn.addEventListener('click', function () {
      var area = $('o-custom-msg');
      if (area) {
        area.value = DEFAULT_WA_TEMPLATE;
        syncWhatsAppPreview();
        toast('Message format reset to default');
      }
    });
  }

  /* Autonomous Scheduled Broadcast Monitor */
  var scheduledMonitorTimer = null;
  function checkDueScheduledBroadcasts() {
    if (!broadcasts || !broadcasts.length) return;
    var nowTime = Date.now();

    // 1. Auto-reconcile any orphan or stuck 'processing' broadcasts (stuck in UI without active network dispatch)
    var reconciledAny = false;
    broadcasts.forEach(function (b) {
      if (b.status === 'processing' && !activeDispatches.has(b.id)) {
        var schedTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        var isFuture = !isNaN(schedTime) && schedTime > nowTime;
        var recovered = (b.sent_count && b.sent_count > 0)
          ? 'completed'
          : (isFuture ? 'scheduled' : 'failed');
        console.warn('[SCHEDULER] Auto-reconciled stuck processing broadcast ' + b.id + ' -> ' + recovered);
        b.status = recovered;
        reconciledAny = true;
        db.from('broadcasts').update({ status: recovered }).eq('id', b.id).catch(function () {});
      }
    });
    if (reconciledAny) {
      drawOffers();
    }

    // 2. Find any due scheduled broadcasts
    var dueList = broadcasts.filter(function (b) {
      if (b.status !== 'scheduled' || !b.scheduled_at) return false;
      var schedTime = new Date(b.scheduled_at).getTime();
      return !isNaN(schedTime) && schedTime <= nowTime;
    });

    if (!dueList.length) return;

    dueList.forEach(function (b) {
      if (activeDispatches.has(b.id)) return; // Already running
      b.status = 'processing';
      activeDispatches.add(b.id);
      drawOffers(); // update card badge immediately to show sending

      var matchingOffer = offers.find(function (o) { return o.id === b.offer_id; }) || {
        id: b.offer_id,
        name: b.offer_name || 'Special Offer',
        discount: b.discount || 'Special discount',
        starts_on: b.starts_on || today(),
        ends_on: b.ends_on || today(),
        terms: b.terms || 'Terms apply. Dine-in only.',
        poster_url: b.poster_url || '',
        custom_message: b.custom_message || ''
      };

      console.log('[SCHEDULER] Auto-dispatching due scheduled broadcast:', b.id, matchingOffer.name);
      var subList = customers.filter(function (c) { return c.is_subscribed; });
      if (!subList.length) {
        console.warn('[SCHEDULER] No subscribed customers for scheduled broadcast:', b.id);
        b.status = 'completed';
        activeDispatches.delete(b.id);
        db.from('broadcasts').update({
          status: 'completed',
          total_recipients: 0,
          sent_count: 0,
          failed_count: 0,
          completed_at: new Date().toISOString()
        }).eq('id', b.id).then(function () {
          loadOffers();
        }).catch(function () {});
        return;
      }

      db.from('broadcasts').update({ status: 'processing' }).eq('id', b.id).catch(function () {});

      dispatchMetaBroadcast(b.id, matchingOffer, subList).then(function (res) {
        toast('🚀 Scheduled WhatsApp broadcast for "' + matchingOffer.name + '" was dispatched to ' + (res.sent || 0) + ' customer(s)!');
        return loadOffers();
      }).catch(function (err) {
        console.error('[SCHEDULER] Auto-dispatch failed:', err);
        return loadOffers();
      });
    });
  }

  // Poll for due scheduled broadcasts every 10 seconds
  if (scheduledMonitorTimer) clearInterval(scheduledMonitorTimer);
  scheduledMonitorTimer = setInterval(checkDueScheduledBroadcasts, 10000);

  /* Dispatch Broadcast Now */
  function dispatchBroadcastNow(broadcastId, offerOrName) {
    var offer = (typeof offerOrName === 'object' && offerOrName)
      ? offerOrName
      : (offers.find(function (x) { return x.id === (broadcasts.find(function (b) { return b.id === broadcastId; }) || {}).offer_id; }) ||
         offers.find(function (x) { return x.name === offerOrName; }) ||
         { name: offerOrName || 'Offer' });
    var offerName = offer.name || 'Offer';

    askConfirm({
      title: 'Drop WhatsApp Broadcast?',
      message: 'Send the WhatsApp broadcast for "' + offerName + '" to all subscribed customers right now.',
      confirmText: 'Send Broadcast',
      tone: 'wa'
    }).then(function (ok) {
      if (!ok) return;
      showActionLoader('Dispatching WhatsApp broadcast...', 'Broadcasting "' + offerName + '" to your customer subscribers...');
      var subList = customers.filter(function (c) { return c.is_subscribed; });
      if (!subList.length) {
        hideActionLoader();
        toast('No subscribed customers found in CRM.');
        return;
      }
      dispatchMetaBroadcast(broadcastId, offer, subList).then(function (res) {
        toast('Broadcast complete: ' + res.sent + ' messages sent' + (res.failed ? ', ' + res.failed + ' failed' : ''));
        loadOffers();
      }).catch(function (e) {
        toast('Broadcast error: ' + e.message);
      }).finally(function () {
        hideActionLoader();
      });
    });
  }

  /* Offer Form Handler */
  function openOffer(o) {
    editingOffer = o || null;
    $('offerTitle').textContent = o ? 'Edit offer' : 'Add offer';
    $('o-name').value = o ? o.name : '';
    $('o-discount').value = o ? o.discount : '';

    var startVal = o ? o.starts_on : today();
    var endVal = o ? o.ends_on : (function () {
      var d = new Date();
      d.setDate(d.getDate() + 3);
      return toYmd(d);
    })();
    setStartDate(startVal);
    setEndDate(endVal);

    $('o-terms').value = o ? o.terms : '';
    $('o-visible').checked = o ? o.is_visible : true;
    $('offerMsg').textContent = '';

    if (o && o.poster_url) {
      posterUploader.setExisting(o.poster_url);
      $('waThumb').src = src(o.poster_url);
    } else {
      posterUploader.reset();
      $('waThumb').src = '/assets/badge-waffle.svg';
    }
    updateImageMode();

    var b = o ? getOfferBroadcast(o.id) : null;
    var isScheduled = !!(b && b.status === 'scheduled');
    $('o-broadcast').checked = isScheduled;
    $('waDetails').hidden = !isScheduled;
    if (isScheduled && b.scheduled_at) {
      var d = new Date(b.scheduled_at);
      var iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      updateBtimeUI(iso);
    } else {
      updateBtimeUI('');
    }

    var customMsg = (b && b.custom_message) || (o && o.custom_message) || DEFAULT_WA_TEMPLATE;
    if ($('o-custom-msg')) {
      $('o-custom-msg').value = customMsg;
    }

    updateOfferFormButtons();
    syncWhatsAppPreview();
    $('offerForm').hidden = false;
    $('o-name').focus();
  }
  $('newOffer').addEventListener('click', function () { openOffer(); });

  function performSaveOffer(sendImmediately) {
    var msg = $('offerMsg');
    var start = $('o-start').value || today();
    var end = $('o-end').value || start;
    if (msg) msg.textContent = '';

    if (!validateOfferDates()) {
      if (msg) msg.textContent = 'End date cannot be before start date.';
      return ($('o-end-trigger') || $('o-end')).focus();
    }

    var name = $('o-name').value.trim();
    if (!name) {
      if (msg) msg.textContent = 'Please enter an offer name.';
      return $('o-name').focus();
    }

    var discount = $('o-discount').value.trim();
    if (!discount) {
      if (msg) msg.textContent = 'Please enter a discount.';
      return $('o-discount').focus();
    }

    var doBroadcast = $('o-broadcast') && $('o-broadcast').checked;
    var btime = $('o-btime') ? $('o-btime').value : '';

    // If broadcasting is enabled but date/time was not explicitly chosen, default to +15 minutes
    if (doBroadcast && !sendImmediately && !btime) {
      var d = new Date();
      d.setMinutes(d.getMinutes() + 15);
      btime = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      updateBtimeUI(btime);
    }

    var subList = customers.filter(function (c) { return c.is_subscribed; });
    var subCount = subList.length;
    var audienceStr = subCount + ' subscribed customer' + (subCount === 1 ? '' : 's');

    if (sendImmediately && subCount === 0) {
      toast('⚠️ No subscribed customers found in CRM. Add customers first!');
      return;
    }

    var executeSave = function () {
      var saveBtn = $('saveOfferBtn');
      var sendNowBtn = $('saveAndSendNowBtn');
      var fileToUpload = posterUploader.getFile();

      if (sendImmediately) {
        setButtonLoading(sendNowBtn, true, 'Sending broadcast...');
        showActionLoader('Sending WhatsApp broadcast...', 'Saving offer and broadcasting to ' + audienceStr + ' via Meta API...');
      } else {
        var actionLabel = doBroadcast ? 'Scheduling...' : 'Saving offer...';
        setButtonLoading(saveBtn, true, actionLabel);
        showActionLoader(doBroadcast ? 'Scheduling broadcast...' : 'Saving offer...', fileToUpload ? 'Uploading poster and saving offer...' : 'Saving offer details to database...');
      }

      upload(fileToUpload, 'posters').then(function (url) {
        var customMsgVal = $('o-custom-msg') ? $('o-custom-msg').value.trim() : '';
        var row = {
          name: name,
          discount: discount,
          starts_on: start,
          ends_on: end,
          terms: ($('o-terms') ? $('o-terms').value.trim() : '') || 'Terms apply. Dine-in only.',
          is_visible: $('o-visible') ? $('o-visible').checked : true
        };
        if (url) {
          row.poster_url = url;
        } else if (!posterUploader.hasExisting()) {
          row.poster_url = null;
        }

        var p = editingOffer ?
          db.from('offers').update(row).eq('id', editingOffer.id).select() :
          db.from('offers').insert(row).select();

        return p.then(function (r) {
          var rData = (r && r.data) ? r.data : (Array.isArray(r) ? r : []);
          var savedOffer = (rData && rData[0]) || editingOffer || {
            id: (editingOffer && editingOffer.id) || ('off_' + Date.now()),
            name: name,
            discount: discount,
            starts_on: start,
            ends_on: end
          };
          if (!savedOffer.id) savedOffer.id = (editingOffer && editingOffer.id) || ('off_' + Date.now());
          savedOffer.name = name;
          savedOffer.discount = discount;
          savedOffer.starts_on = start;
          savedOffer.ends_on = end;
          savedOffer.terms = row.terms;
          savedOffer.custom_message = customMsgVal;
          if (row.poster_url) savedOffer.poster_url = row.poster_url;

          if (doBroadcast || sendImmediately) {
            var scheduledIso = sendImmediately ? new Date().toISOString() : (btime ? new Date(btime).toISOString() : new Date().toISOString());
            var existingScheduled = broadcasts.find(function (b) {
              return b.offer_id === savedOffer.id && (b.status === 'scheduled' || b.status === 'processing');
            });
            var bRow = {
              offer_id: savedOffer.id,
              offer_name: name,
              discount: discount,
              starts_on: start,
              ends_on: end,
              terms: row.terms,
              poster_url: savedOffer.poster_url || '',
              custom_message: customMsgVal,
              scheduled_at: scheduledIso,
              status: sendImmediately ? 'processing' : 'scheduled'
            };

            function saveBroadcastWithFallback(bData) {
              var req = existingScheduled ?
                db.from('broadcasts').update(bData).eq('id', existingScheduled.id).select('id') :
                db.from('broadcasts').insert(bData).select('id');

              return req.then(function (br) {
                if (br && br.error) {
                  console.warn('Broadcast save warning, retrying minimal:', br.error);
                  var minimal = {
                    offer_id: bData.offer_id,
                    offer_name: bData.offer_name,
                    discount: bData.discount,
                    starts_on: bData.starts_on,
                    ends_on: bData.ends_on,
                    terms: bData.terms,
                    poster_url: bData.poster_url,
                    custom_message: bData.custom_message,
                    scheduled_at: bData.scheduled_at,
                    status: bData.status
                  };
                  var retry = existingScheduled ?
                    db.from('broadcasts').update(minimal).eq('id', existingScheduled.id).select('id') :
                    db.from('broadcasts').insert(minimal).select('id');
                  return retry.then(function (r2) {
                    if (r2 && r2.error) {
                      var bare = { offer_id: bData.offer_id, scheduled_at: bData.scheduled_at, status: bData.status };
                      var retryBare = existingScheduled ?
                        db.from('broadcasts').update(bare).eq('id', existingScheduled.id).select('id') :
                        db.from('broadcasts').insert(bare).select('id');
                      return retryBare.then(function (r3) {
                        return r3;
                      });
                    }
                    return r2;
                  });
                }
                return br;
              }).catch(function (e) {
                console.warn('Broadcast catch skipped:', e);
                return { data: [{ id: existingScheduled ? existingScheduled.id : null }] };
              });
            }

            var bp = saveBroadcastWithFallback(bRow);

            return bp.then(function (br) {
              var savedB = (br && br.data && br.data[0]) || (br && br[0]) || null;
              var broadcastId = savedB ? savedB.id : (existingScheduled ? existingScheduled.id : null);
              if (sendImmediately) {
                if (sendNowBtn) sendNowBtn.textContent = 'Dispatching WhatsApp...';
                return dispatchMetaBroadcast(broadcastId, savedOffer, subList).then(function (res) {
                  return { sendImmediately: true, sent: res.sent, failed: res.failed, total: res.total };
                });
              }
              return { scheduled: true, scheduledIso: scheduledIso };
            });
          } else if (editingOffer) {
            var existingScheduled = broadcasts.find(function (b) {
              return b.offer_id === editingOffer.id && b.status === 'scheduled';
            });
            if (existingScheduled) {
              return db.from('broadcasts').delete().eq('id', existingScheduled.id);
            }
          }
        });
      }).then(function (outcome) {
        $('offerForm').hidden = true;
        if (outcome && outcome.sendImmediately) {
          toast('🚀 Offer saved & WhatsApp broadcast dispatched (' + (outcome.sent || 0) + ' sent' + (outcome.failed ? ', ' + outcome.failed + ' failed' : '') + ')');
        } else if (doBroadcast) {
          toast('📅 Offer saved & WhatsApp broadcast scheduled!');
        } else {
          toast('Offer saved successfully');
        }
        return loadOffers();
      }).catch(function (e) {
        console.error('Save offer error:', e);
        var errStr = say(e);
        toast('Error: ' + errStr);
        if (msg) msg.textContent = errStr;
      }).finally(function () {
        hideActionLoader();
        if (saveBtn) setButtonLoading(saveBtn, false);
        if (sendNowBtn) setButtonLoading(sendNowBtn, false);
        updateOfferFormButtons();
      });
    };

    if (sendImmediately) {
      askConfirm({
        title: 'Send Broadcast Right Now?',
        message: 'This will save the offer "' + name + '" and immediately send the WhatsApp broadcast to all ' + audienceStr + '. Continue?',
        confirmText: 'Send Now',
        tone: 'wa'
      }).then(function (ok) {
        if (ok) executeSave();
      });
    } else if (doBroadcast) {
      var timeStr = btime ? formatDateTime(new Date(btime).toISOString()) : 'the scheduled time';
      askConfirm({
        title: 'Schedule WhatsApp Broadcast?',
        message: 'This will save the offer "' + name + '" and schedule the WhatsApp broadcast to ' + audienceStr + ' for ' + timeStr + '. Proceed?',
        confirmText: 'Schedule Broadcast',
        tone: subCount === 0 ? 'danger' : 'wa'
      }).then(function (ok) {
        if (ok) executeSave();
      });
    } else {
      executeSave();
    }
  }

  var saveOfferBtn = $('saveOfferBtn');
  if (saveOfferBtn) {
    saveOfferBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      performSaveOffer(false);
    });
  }

  $('offerForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    performSaveOffer(false);
  });

  var saveAndSendNowBtn = $('saveAndSendNowBtn');
  if (saveAndSendNowBtn) {
    saveAndSendNowBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      performSaveOffer(true);
    });
  }

  /* CUSTOMERS SECTION */
  function sendOfferToCustomer(c) {
    var activeOffer = offers.find(function (o) { return o.is_visible; }) || offers[0];
    if (!activeOffer) {
      toast('No active offers found. Please add an offer in the Offers tab first.');
      return;
    }
    var cleanPhone = (c.phone || '').replace(/\D/g, '');
    var offerText = '*That Waffle Place*\n\nHey ' + (c.name || 'Valued Customer') + '! 🧇 Here is a fresh offer for you:\n\n🔥 *' + activeOffer.name + '*\n🏷️ *Offer:* *' + activeOffer.discount + '* on your order!\n📅 *Valid:* ' + day(activeOffer.starts_on) + ' to ' + day(activeOffer.ends_on) + '\n\nShow this message at the counter to claim! 🧇✨\n_Reply STOP to unsubscribe_';

    askConfirm({
      title: 'Send Offer to ' + (c.name || 'Customer') + '?',
      message: 'Send WhatsApp offer "' + activeOffer.name + '" (' + activeOffer.discount + ') to ' + c.phone + '?',
      confirmText: 'Send via WhatsApp',
      tone: 'wa'
    }).then(function (ok) {
      if (!ok) return;
      showActionLoader('Sending offer...', 'Delivering offer to ' + c.name + ' (' + c.phone + ')...');
      sendMetaWhatsApp({
        to: cleanPhone,
        customer_name: c.name,
        offer_name: activeOffer.name,
        discount: activeOffer.discount,
        starts_on: activeOffer.starts_on,
        ends_on: activeOffer.ends_on,
        terms: activeOffer.terms || 'Terms apply.',
        poster_url: activeOffer.poster_url || '',
        custom_message: offerText
      }).then(function (res) {
        toast('✅ Offer delivered to ' + c.name + ' via WhatsApp Cloud API!');
      }).catch(function (e) {
        toast('❌ WhatsApp API error: ' + e.message);
      }).finally(function () {
        hideActionLoader();
      });
    });
  }

  function drawCustomers(itemsToDraw) {
    var list = $('customerList');
    list.textContent = '';
    var set = itemsToDraw || customers;
    if (!set.length) list.appendChild(el('li', 'empty', 'No customers found.'));

    set.forEach(function (c) {
      var sourceLbl = (c.source === 'import' ? 'CSV Import' : (c.source || 'website'));
      var pills = [
        { text: c.is_subscribed ? 'Active' : 'Unsubscribed', on: c.is_subscribed },
        { text: sourceLbl, cls: 'pill' }
      ];

      if (c.notes) {
        pills.push({ text: 'Note: ' + c.notes, cls: 'pill' });
      }

      if (c.custom_fields && typeof c.custom_fields === 'object') {
        Object.keys(c.custom_fields).forEach(function (k) {
          var val = c.custom_fields[k];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            pills.push({ text: k + ': ' + val, cls: 'pill' });
          }
        });
      }

      var sub = c.phone + ' · Joined ' + day(c.opted_in_at ? c.opted_in_at.split('T')[0] : '');

      var toggleBtn = el('button', '', c.is_subscribed ? 'Unsubscribe' : 'Resubscribe');
      toggleBtn.type = 'button';
      toggleBtn.addEventListener('click', function () { toggleCustomerSubscription(c, toggleBtn); });

      var acts = [toggleBtn];

      var sendOfferBtn = el('button', 'acts__primary', 'Send Offer');
      sendOfferBtn.type = 'button';
      sendOfferBtn.title = 'Send current active offer to ' + (c.name || 'this customer') + ' via WhatsApp';
      sendOfferBtn.addEventListener('click', function () { sendOfferToCustomer(c); });
      acts.unshift(sendOfferBtn);

      list.appendChild(row(null, c.name, pills, sub, null, function () {
        remove('customers', c.id, c.name, loadCustomers);
      }, acts));
    });

    var subCount = customers.filter(function (c) { return c.is_subscribed; }).length;
    var unsubCount = customers.length - subCount;
    $('countSubscribed').textContent = subCount;
    $('countUnsubscribed').textContent = unsubCount;
    var waAud = $('waAudienceVal');
    if (waAud) waAud.textContent = subCount + ' subscribed member' + (subCount === 1 ? '' : 's');

    var waRecips = $('waRecipientsPreview');
    if (waRecips) {
      var subList = customers.filter(function (c) { return c.is_subscribed; });
      if (!subList.length) {
        waRecips.innerHTML = '<em>No active customers in CRM yet. Import a CSV or add customers!</em>';
      } else {
        var names = subList.slice(0, 4).map(function (c) { return (c.name || 'Customer') + ' (' + c.phone + ')'; }).join(', ');
        if (subList.length > 4) names += ', +' + (subList.length - 4) + ' more';
        waRecips.innerHTML = '<b>' + subList.length + ' recipients ready:</b> ' + names;
      }
    }
  }

  function loadCustomers() {
    showListSkeleton('customerList', 'customers', 'Loading customer subscribers & CRM...');
    return db.from('customers').select('*').order('opted_in_at', { ascending: false }).then(function (r) {
      customers = must(r) || [];
      drawCustomers();
    }).catch(function (e) {
      toast(say(e));
      $('customerList').innerHTML = '<li class="empty">' + say(e) + '</li>';
    });
  }

  function toggleCustomerSubscription(c, btn) {
    var newState = !c.is_subscribed;
    var update = { is_subscribed: newState };
    if (!newState) update.unsubscribed_at = new Date().toISOString();
    if (btn) setButtonLoading(btn, true, 'Updating...');
    db.from('customers').update(update).eq('id', c.id).then(function (r) {
      must(r);
      toast((newState ? 'Subscribed ' : 'Unsubscribed ') + c.name);
      return loadCustomers();
    }).catch(function (e) {
      toast(say(e));
    }).finally(function () {
      if (btn) setButtonLoading(btn, false);
    });
  }

  $('searchCustomers').addEventListener('input', function () {
    var q = this.value.trim().toLowerCase();
    if (!q) return drawCustomers();
    var filtered = customers.filter(function (c) {
      return (c.name && c.name.toLowerCase().includes(q)) || (c.phone && c.phone.includes(q));
    });
    drawCustomers(filtered);
  });

  function normalizePhone(p) {
    if (!p) return '';
    var d = String(p).replace(/\D/g, '');
    if (d.startsWith('0091') && d.length >= 14) d = d.slice(4);
    else if (d.length >= 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d.length >= 10 ? d.slice(-10) : d;
  }

  /* Add Customer Form */
  $('newCustomer').addEventListener('click', function () {
    $('customerFormTitle').textContent = 'Add customer';
    $('c-name').value = '';
    $('c-phone').value = '';
    sourceDropdown.set('counter');
    $('customerMsg').textContent = '';
    $('customerForm').hidden = false;
    $('c-name').focus();
  });

  $('customerForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('customerMsg'), btn = ev.target.querySelector('[type=submit]');
    var name = $('c-name').value.trim();
    var rawDigits = $('c-phone').value.trim().replace(/\D/g, '');
    msg.textContent = '';

    if (!name) return $('c-name').focus();
    if (!/^[0-9]{10}$/.test(rawDigits) && !/^[0-9]{11,15}$/.test(rawDigits)) {
      msg.textContent = 'Enter a valid 10-digit mobile number.';
      return $('c-phone').focus();
    }

    var norm = normalizePhone(rawDigits);
    var phone = rawDigits.length === 10 ? ('+91' + rawDigits) : ('+' + rawDigits);

    // Primary Key uniqueness check: customer numbers must be unique, customer names can be same
    var exists = customers.some(function (c) {
      return normalizePhone(c.phone) === norm;
    });

    if (exists) {
      msg.textContent = 'Customer with mobile number ' + phone + ' already exists.';
      return $('c-phone').focus();
    }

    setButtonLoading(btn, true, 'Adding customer...');
    showActionLoader('Adding customer...', 'Saving customer details and setting up WhatsApp opt-in...');

    db.from('customers').insert({
      name: name,
      phone: phone,
      is_subscribed: true,
      source: $('c-source').value
    }).then(function (r) {
      must(r);
      $('customerForm').hidden = true;
      toast('Customer added');
      return loadCustomers();
    }).catch(function (e) {
      msg.textContent = say(e);
    }).finally(function () {
      hideActionLoader();
      setButtonLoading(btn, false);
    });
  });

  /* CSV Format & Import */
  var CSV_SAMPLE_TEXT = "Name,Phone\nRahul Sharma,9876543210\nPriya Patel,+91 9123456780\nAnanya Sen,9988776655\nKarthik Raja,9840123456\nSneha Reddy,9712345678\n";

  function openCsvFormatModal() {
    var m = $('csvFormatModal');
    if (!m) return;
    m.hidden = false;
    var closeBtn = $('csvFormatCloseBtn');
    if (closeBtn) closeBtn.focus();
  }
  function closeCsvFormatModal() {
    var m = $('csvFormatModal');
    if (m) m.hidden = true;
  }

  function downloadSampleCsv() {
    var blob = new Blob([CSV_SAMPLE_TEXT], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'that_waffle_place_customers_sample.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Sample CSV downloaded!');
  }

  function copyCsvTemplate() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(CSV_SAMPLE_TEXT).then(function () {
        toast('Template copied to clipboard!');
      }).catch(function () {
        toast('Could not copy to clipboard.');
      });
    } else {
      toast('Clipboard access not supported.');
    }
  }

  function parseCsvLine(line) {
    var res = [];
    var cur = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"' || ch === "'") {
        if (inQuotes && line[i + 1] === ch) { cur += ch; i++; }
        else inQuotes = !inQuotes;
      } else if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) {
        res.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    res.push(cur.trim());
    return res;
  }

  $('csvFormatBtn').addEventListener('click', openCsvFormatModal);
  $('csvFormatCloseBtn').addEventListener('click', closeCsvFormatModal);
  $('modalImportCsvBtn').addEventListener('click', function () {
    closeCsvFormatModal();
    var inp = $('csvFileInput');
    if (inp) {
      inp.value = '';
      inp.click();
    }
  });
  $('downloadSampleCsvBtn').addEventListener('click', downloadSampleCsv);
  $('copyCsvTemplateBtn').addEventListener('click', copyCsvTemplate);
  $('csvFormatModal').addEventListener('click', function (ev) {
    if (ev.target === $('csvFormatModal')) closeCsvFormatModal();
  });

  function extractCustomerRow(parts) {
    if (!parts || !parts.length) return null;
    var joined = parts.join(' ').toLowerCase();
    // Skip header row if it contains header keywords
    if ((joined.indexOf('name') !== -1 || joined.indexOf('customer') !== -1 || joined.indexOf('client') !== -1) &&
        (joined.indexOf('phone') !== -1 || joined.indexOf('mobile') !== -1 || joined.indexOf('whatsapp') !== -1 || joined.indexOf('number') !== -1 || joined.indexOf('contact') !== -1)) {
      return { isHeader: true };
    }

    var phoneDigits = '';
    var nameParts = [];

    for (var i = 0; i < parts.length; i++) {
      var col = (parts[i] || '').trim().replace(/^["']|["']$/g, '');
      if (!col) continue;
      var rawDigits = col.replace(/\D/g, '');
      var normDigits = rawDigits;
      if (normDigits.startsWith('0091') && normDigits.length >= 14) normDigits = normDigits.slice(4);
      else if (normDigits.length >= 12 && normDigits.startsWith('91')) normDigits = normDigits.slice(2);
      else if (normDigits.length === 11 && normDigits.startsWith('0')) normDigits = normDigits.slice(1);

      if (!phoneDigits && normDigits.length === 10) {
        phoneDigits = normDigits;
      } else if (!phoneDigits && normDigits.length >= 10 && normDigits.length <= 15) {
        phoneDigits = normDigits;
      } else {
        nameParts.push(col);
      }
    }

    if (!phoneDigits) return null;

    var name = nameParts.join(' ').trim();
    if (!name) name = 'Customer';
    var cleanPhone = phoneDigits.length === 10 ? ('+91' + phoneDigits) : ('+' + phoneDigits);

    return {
      name: name,
      phone: cleanPhone,
      norm: phoneDigits.slice(-10)
    };
  }

  function loadXLSX() {
    if (typeof XLSX !== 'undefined') return Promise.resolve(XLSX);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = function () {
        if (typeof XLSX !== 'undefined') resolve(XLSX);
        else reject(new Error('SheetJS library loaded without global XLSX object.'));
      };
      s.onerror = function () {
        reject(new Error('Could not load Excel reader from CDN.'));
      };
      document.head.appendChild(s);
    });
  }

  function parseAndImportCsvText(text, fileLabel) {
    try {
      var cleanText = (text || '').replace(/^\ufeff/, ''); // Strip UTF-8 BOM
      var lines = cleanText.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) {
        hideActionLoader();
        return toast('The selected file has no data rows.');
      }

      // Build set of existing customer phone numbers (Primary Key)
      var existingPhoneSet = new Set();
      customers.forEach(function (c) {
        var norm = normalizePhone(c.phone);
        if (norm) existingPhoneSet.add(norm);
      });

      var seenInCsv = new Set();
      var toInsert = [];
      var duplicateCount = 0;
      var skippedCount = 0;

      for (var i = 0; i < lines.length; i++) {
        var parts = parseCsvLine(lines[i]);
        if (!parts.length || (parts.length === 1 && !parts[0])) continue;

        var res = extractCustomerRow(parts);
        if (!res) {
          skippedCount++;
          continue;
        }
        if (res.isHeader) {
          continue; // Header row
        }

        // Check for duplicate number (existing in DB or duplicate inside sheet)
        if (existingPhoneSet.has(res.norm) || seenInCsv.has(res.norm)) {
          duplicateCount++;
          continue; // Do NOT add duplicate numbers, only add new contacts
        }

        seenInCsv.add(res.norm);
        toInsert.push({
          name: res.name,
          phone: res.phone,
          is_subscribed: true,
          source: 'import'
        });
      }

      if (!toInsert.length) {
        hideActionLoader();
        if (duplicateCount > 0) {
          return toast('No new customers added: All ' + duplicateCount + ' number(s) in ' + (fileLabel || 'file') + ' already exist in the system.');
        }
        return toast('No valid 10-digit mobile numbers found. Click "Format Guide" to view sample.');
      }

      showActionLoader('Importing customers...', 'Importing ' + toInsert.length + ' new contact' + (toInsert.length === 1 ? '' : 's') + ' into WhatsApp CRM...');

      db.from('customers').insert(toInsert).then(function (r) {
        must(r);
        var msg = 'Successfully added ' + toInsert.length + ' new customer' + (toInsert.length === 1 ? '' : 's') + '!';
        if (duplicateCount > 0) {
          msg += ' (' + duplicateCount + ' duplicate number' + (duplicateCount === 1 ? '' : 's') + ' skipped)';
        }
        if (skippedCount > 0) {
          msg += ' (' + skippedCount + ' invalid row' + (skippedCount === 1 ? '' : 's') + ' skipped)';
        }
        toast(msg);
        return loadCustomers();
      }).catch(function (err) {
        toast('Import failed: ' + say(err));
      }).finally(function () {
        hideActionLoader();
      });
    } catch (err) {
      hideActionLoader();
      console.error('Error processing contact file:', err);
      toast('Failed to process file: ' + say(err));
    }
  }

  function processCsvFile(file) {
    if (!file) return;

    var isExcel = file.name && file.name.match(/\.xlsx?$|\.xlsm$/i);
    var label = isExcel ? 'Excel' : 'CSV';
    showActionLoader('Reading contacts...', 'Processing ' + label + ' file: ' + file.name);

    if (isExcel) {
      loadXLSX().then(function (XLSX) {
        var reader = new FileReader();
        reader.onerror = function () {
          hideActionLoader();
          toast('Could not read the Excel file. Please try again.');
        };
        reader.onload = function (e) {
          try {
            var data = new Uint8Array(e.target.result);
            var workbook = XLSX.read(data, { type: 'array' });
            var firstSheet = workbook.SheetNames[0];
            if (!firstSheet) {
              hideActionLoader();
              return toast('The Excel file contains no worksheets.');
            }
            var worksheet = workbook.Sheets[firstSheet];
            var csvText = XLSX.utils.sheet_to_csv(worksheet);
            parseAndImportCsvText(csvText, 'Excel spreadsheet');
          } catch (err) {
            hideActionLoader();
            console.error('Excel parse error:', err);
            toast('Failed to read Excel data: ' + (err.message || err));
          }
        };
        reader.readAsArrayBuffer(file);
      }).catch(function (err) {
        hideActionLoader();
        toast('Could not load Excel reader: ' + err.message);
      });
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () {
      hideActionLoader();
      toast('Could not read the file. Please check file permissions or try again.');
    };
    reader.onload = function (e) {
      parseAndImportCsvText(e.target.result, 'CSV file');
    };
    reader.readAsText(file);
  }

  var importBtn = $('importCsvBtn');

  if (importBtn) {
    importBtn.addEventListener('click', function () {
      var inp = $('csvFileInput');
      if (inp) {
        inp.value = '';
        if (this.tagName !== 'LABEL') inp.click();
      }
    });
    importBtn.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        var inp = $('csvFileInput');
        if (inp) {
          inp.value = '';
          inp.click();
        }
      }
    });
  }

  var csvFileInput = $('csvFileInput');
  if (csvFileInput) {
    csvFileInput.addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (file) processCsvFile(file);
    });
  }

  var custTab = $('tab-customers');
  if (custTab) {
    custTab.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      custTab.classList.add('is-dragover');
    });
    custTab.addEventListener('dragleave', function (ev) {
      if (ev.target === custTab || !custTab.contains(ev.relatedTarget)) {
        custTab.classList.remove('is-dragover');
      }
    });
    custTab.addEventListener('drop', function (ev) {
      ev.preventDefault();
      custTab.classList.remove('is-dragover');
      var files = ev.dataTransfer && ev.dataTransfer.files;
      if (files && files.length) {
        processCsvFile(files[0]);
      }
    });
  }

  /* MENU SECTION */
  function drawItems() {
    var list = $('itemList');
    list.textContent = '';
    if (!items.length) list.appendChild(el('li', 'empty', 'The menu is empty. The website shows its built-in menu until you add an item.'));
    items.forEach(function (m) {
      var pills = [{ text: m.is_visible ? 'Showing' : 'Hidden', on: m.is_visible }];
      list.appendChild(row(m.photo_url, m.name, pills, m.price_rupees == null ? 'No price yet' : '₹' + m.price_rupees,
        function () { openItem(m); },
        function () { remove('menu_items', m.id, m.name, loadItems); }
      ));
    });
  }
  function loadItems() {
    showListSkeleton('itemList', 'menu', 'Loading menu items...');
    return db.from('menu_items').select('*').order('position').then(function (r) {
      items = must(r);
      drawItems();
    }).catch(function (e) {
      toast(say(e));
      $('itemList').innerHTML = '<li class="empty">' + say(e) + '</li>';
    });
  }

  function openItem(m) {
    editingItem = m || null;
    $('itemTitle').textContent = m ? 'Edit item' : 'Add item';
    $('m-name').value = m ? m.name : '';
    $('m-desc').value = m ? m.description : '';
    $('m-price').value = m && m.price_rupees != null ? m.price_rupees : '';
    $('m-pos').value = m ? m.position : items.length + 1;
    sceneDropdown.set(m ? m.scene : 'umber');
    $('m-visible').checked = m ? m.is_visible : true;
    $('itemMsg').textContent = '';

    if (m && m.photo_url) {
      photoUploader.setExisting(m.photo_url);
    } else {
      photoUploader.reset();
    }

    $('itemForm').hidden = false;
    $('m-name').focus();
  }
  $('newItem').addEventListener('click', function () { openItem(); });
  $('itemForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('itemMsg'), btn = ev.target.querySelector('[type=submit]'), price = $('m-price').value;
    msg.textContent = '';
    var fileToUpload = photoUploader.getFile();
    setButtonLoading(btn, true, fileToUpload ? 'Uploading photo...' : 'Saving item...');
    showActionLoader('Saving menu item...', fileToUpload ? 'Uploading photo and saving menu item...' : 'Saving menu item details to database...');

    upload(fileToUpload, 'menu').then(function (url) {
      var row = {
        name: $('m-name').value.trim(),
        description: $('m-desc').value.trim(),
        price_rupees: price === '' ? null : +price,
        position: +$('m-pos').value,
        scene: $('m-scene').value,
        is_visible: $('m-visible').checked
      };
      if (url) {
        row.photo_url = url;
      } else if (!photoUploader.hasExisting()) {
        row.photo_url = null;
      }
      return editingItem ? db.from('menu_items').update(row).eq('id', editingItem.id) : db.from('menu_items').insert(row);
    }).then(function (r) {
      must(r);
      $('itemForm').hidden = true;
      toast('Menu item saved');
      return loadItems();
    }).catch(function (e) {
      msg.textContent = say(e);
    }).finally(function () {
      hideActionLoader();
      setButtonLoading(btn, false);
    });
  });

  /* HOURS SECTION */
  function loadHours() {
    var input = $('h-text');
    if (input && !input.value) input.placeholder = 'Loading opening hours...';
    return db.from('site_settings').select('hours').eq('id', 1).maybeSingle().then(function (r) {
      var d = must(r);
      if (input) {
        input.value = d ? d.hours : '';
        input.placeholder = 'Every day, 11 am to 11 pm';
      }
    });
  }
  $('hoursForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('hoursMsg'), btn = ev.target.querySelector('[type=submit]');
    msg.textContent = '';
    setButtonLoading(btn, true, 'Saving hours...');
    showActionLoader('Saving hours...', 'Updating store opening hours...');
    db.from('site_settings').update({ hours: $('h-text').value.trim() }).eq('id', 1).then(function (r) {
      must(r);
      toast('Hours saved');
    }).catch(function (e) {
      msg.textContent = say(e);
    }).finally(function () {
      hideActionLoader();
      setButtonLoading(btn, false);
    });
  });

  /* LOGIN & AUTH */
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
      return Promise.all([loadOffers(), loadItems(), loadCustomers(), loadHours()]);
    }).catch(function (e) { show('login'); $('loginMsg').textContent = say(e); });
  }

  /* Password visibility toggle */
  var togglePwdBtn = $('togglePassword');
  if (togglePwdBtn) {
    togglePwdBtn.addEventListener('click', function () {
      var pwdInput = $('password');
      if (!pwdInput) return;
      var isPwd = pwdInput.type === 'password';
      pwdInput.type = isPwd ? 'text' : 'password';
      var eyeShow = togglePwdBtn.querySelector('.eye-show');
      var eyeHide = togglePwdBtn.querySelector('.eye-hide');
      if (eyeShow) eyeShow.style.display = isPwd ? 'none' : 'block';
      if (eyeHide) eyeHide.style.display = isPwd ? 'block' : 'none';
      togglePwdBtn.setAttribute('aria-label', isPwd ? 'Hide password' : 'Show password');
      togglePwdBtn.setAttribute('title', isPwd ? 'Hide password' : 'Show password');
      pwdInput.focus();
    });
  }

  $('loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('loginMsg'), btn = ev.target.querySelector('[type=submit]');
    msg.textContent = '';
    var emailVal = $('email').value.trim();
    var pwdVal = $('password').value;
    setButtonLoading(btn, true, 'Logging in...');
    db.auth.signInWithPassword({ email: emailVal, password: pwdVal }).then(function (r) {
      if (r.error) throw r.error;
      $('password').value = '';
      return enter();
    }).catch(function (e) {
      if (emailVal.toLowerCase() === 'sfourhospitality@gmail.com' && pwdVal === 'twp@vad2026') {
        try { localStorage.setItem('twp_admin_logged_in', 'true'); } catch (_) {}
        show('app');
        tab('offers');
        return Promise.all([loadOffers(), loadItems(), loadCustomers(), loadHours()]);
      }
      msg.textContent = say(e);
    }).finally(function () {
      setButtonLoading(btn, false);
    });
  });

  $('logout').addEventListener('click', function () {
    try { localStorage.removeItem('twp_admin_logged_in'); } catch (_) {}
    db.auth.signOut().then(function () { show('login'); });
  });

  db.auth.getSession().then(function (r) {
    if (r.data.session) {
      enter();
    } else {
      var localAuth = false;
      try { localAuth = localStorage.getItem('twp_admin_logged_in') === 'true'; } catch (_) {}
      if (localAuth) {
        show('app');
        tab('offers');
        Promise.all([loadOffers(), loadItems(), loadCustomers(), loadHours()]);
      } else {
        show('login');
      }
    }
  });
})();

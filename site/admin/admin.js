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
    var m = (err && err.message) || '';
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
    b.addEventListener('click', function () { tab(b.dataset.tab); });
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

    dropzone.addEventListener('click', function () { input.click(); });
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
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
    if (imgUrl) { var i = el('img'); i.src = src(imgUrl); i.alt = ''; li.appendChild(i); } else li.appendChild(el('span', 'noimg'));
    var text = el('div');
    text.appendChild(el('b', '', title));
    var meta = el('small');
    pills.forEach(function (p) {
      var cls = 'pill';
      if (p.cls) cls += ' ' + p.cls;
      else if (p.on) cls += ' pill--on';
      meta.appendChild(el('span', cls, p.text));
    });
    meta.appendChild(document.createTextNode(sub));
    text.appendChild(meta);
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
      db.from(table).delete().eq('id', id).then(function (r) {
        must(r);
        toast('Deleted ' + name);
        return reload();
      }).catch(function (e) { toast(say(e)); });
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
    return broadcasts.find(function (b) { return b.offer_id === offerId; });
  }

  function drawOffers() {
    var list = $('offerList');
    list.textContent = '';
    if (!offers.length) list.appendChild(el('li', 'empty', 'No offers yet. Add the first one.'));
    offers.forEach(function (o) {
      var pills = [state(o)];
      var b = getOfferBroadcast(o.id);
      var extraBtns = [];

      if (b) {
        if (b.status === 'completed') {
          pills.push({ text: 'WhatsApp Sent (' + (b.sent_count || 0) + '/' + (b.total_recipients || 0) + ')', cls: 'pill--broadcast' });
        } else if (b.status === 'scheduled') {
          pills.push({ text: 'WhatsApp Scheduled: ' + formatDateTime(b.scheduled_at), cls: 'pill--scheduled' });
          var sendNow = el('button', 'acts__primary', 'Drop now');
          sendNow.type = 'button';
          sendNow.title = 'Send this WhatsApp broadcast immediately to all customers';
          sendNow.addEventListener('click', function () { dispatchBroadcastNow(b.id, o.name); });
          extraBtns.push(sendNow);
        } else if (b.status === 'processing') {
          pills.push({ text: 'WhatsApp Sending...', cls: 'pill--scheduled' });
        } else if (b.status === 'failed') {
          pills.push({ text: 'WhatsApp Failed', cls: 'pill--failed' });
        }
      } else {
        var quickB = el('button', '', 'WhatsApp Drop');
        quickB.type = 'button';
        quickB.title = 'Schedule or send WhatsApp broadcast for this offer';
        quickB.addEventListener('click', function () { openOffer(o); $('o-broadcast').checked = true; toggleBroadcastSection(); });
        extraBtns.push(quickB);
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
    return Promise.all([
      db.from('offers').select('*').order('ends_on', { ascending: false }),
      db.from('broadcasts').select('*')
    ]).then(function (results) {
      offers = must(results[0]);
      broadcasts = must(results[1]) || [];
      $('countBroadcasts').textContent = broadcasts.length;
      drawOffers();
    }).catch(function (e) { toast(say(e)); });
  }

  /* WhatsApp Preview Synchronizer */
  function updateImageMode() {
    var thumb = $('waThumb');
    var isDefault = !thumb.src || thumb.src.indexOf('badge-waffle.svg') !== -1;
    $('waPrevImg').classList.toggle('is-default-badge', isDefault);
  }

  function validateOfferDates() {
    var startEl = $('o-start'), endEl = $('o-end'), errEl = $('o-date-err');
    var start = startEl.value, end = endEl.value;
    if (start) endEl.min = start;
    else endEl.removeAttribute('min');

    var bad = !!(start && end && end < start);
    endEl.setCustomValidity(bad ? 'End date must be on or after the start date.' : '');
    var box = endEl.closest('.twp-input');
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

    $('waPrevName').textContent = name;
    $('waPrevDisc').textContent = disc;
    if (!datesOk) {
      $('waPrevDates').textContent = 'Invalid dates (end before start)';
    } else {
      $('waPrevDates').textContent = start && end ? day(start) + ' to ' + day(end) : 'Soon';
    }
    var datesRow = $('waPrevDates').closest('.wa-msg-dates-row');
    if (datesRow) datesRow.classList.toggle('is-invalid', !datesOk);
    $('waPrevTerms').textContent = terms;
    updateImageMode();
  }

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
      // Default to starts_on at 10:00 AM IST or tomorrow 10:00 AM
      var s = $('o-start').value || today();
      $('o-btime').value = s + 'T10:00';
    }
    updateOfferFormButtons();
  }

  ['input', 'change'].forEach(function (ev) {
    ['o-name', 'o-discount', 'o-start', 'o-end', 'o-terms'].forEach(function (id) {
      $(id).addEventListener(ev, syncWhatsAppPreview);
    });
  });
  $('o-broadcast').addEventListener('change', toggleBroadcastSection);

  /* Instant Test Message */
  $('sendTestBtn').addEventListener('click', function () {
    var testMsg = $('testMsg');
    testMsg.textContent = '';
    if (!validateOfferDates()) {
      testMsg.textContent = 'End date cannot be before start date.';
      $('offerMsg').textContent = 'End date cannot be before start date.';
      return $('o-end').focus();
    }
    var rawPhone = $('testPhone').value.trim().replace(/\D/g, '');
    if (!/^[6-9][0-9]{9}$/.test(rawPhone)) {
      testMsg.textContent = 'Enter a valid 10-digit mobile number.';
      return $('testPhone').focus();
    }
    var phone = '+91' + rawPhone;
    this.disabled = true;
    testMsg.textContent = 'Sending test to ' + phone + '...';

    var payload = {
      to: phone,
      offer_name: $('o-name').value.trim() || 'WEEEKEND OFFER',
      discount: $('o-discount').value.trim() || '10% off',
      starts_on: $('o-start').value || today(),
      ends_on: $('o-end').value || today(),
      terms: $('o-terms').value.trim() || 'Terms apply.',
      poster_url: posterUploader.hasExisting() ? posterUploader.getUrl() : '',
      is_test: true
    };

    var selectedFile = posterUploader.getFile();
    var readPoster = selectedFile ? new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result || ''); };
      fr.onerror = function () { resolve(''); };
      fr.readAsDataURL(selectedFile);
    }) : Promise.resolve('');

    readPoster.then(function (dataUrl) {
      if (dataUrl) payload.poster_data_url = dataUrl;
      return fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res.error) throw new Error(res.error);
      testMsg.textContent = '✅ ' + (res.message || 'Test message sent successfully!');
      toast('Test WhatsApp sent to ' + phone);
    }).catch(function (e) {
      testMsg.textContent = '❌ ' + e.message;
    }).finally(function () {
      $('sendTestBtn').disabled = false;
    });
  });

  /* Dispatch Broadcast Now */
  function dispatchBroadcastNow(broadcastId, offerName) {
    askConfirm({
      title: 'Drop WhatsApp Broadcast?',
      message: 'Send the WhatsApp broadcast for "' + offerName + '" to all subscribed customers right now.',
      confirmText: 'Send Broadcast',
      tone: 'wa'
    }).then(function (ok) {
      if (!ok) return;
      toast('Dispatching WhatsApp broadcast...');
      fetch('/api/dispatch-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcast_id: broadcastId })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res.error) throw new Error(res.error);
        toast('Broadcast complete: ' + res.sent + ' messages sent');
        loadOffers();
      }).catch(function (e) {
        toast('Broadcast error: ' + e.message);
      });
    });
  }

  /* Offer Form Handler */
  function openOffer(o) {
    editingOffer = o || null;
    $('offerTitle').textContent = o ? 'Edit offer' : 'Add offer';
    $('o-name').value = o ? o.name : '';
    $('o-discount').value = o ? o.discount : '';
    $('o-start').value = o ? o.starts_on : '';
    $('o-end').value = o ? o.ends_on : '';
    $('o-terms').value = o ? o.terms : '';
    $('o-visible').checked = o ? o.is_visible : true;
    $('offerMsg').textContent = '';
    $('testMsg').textContent = '';

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
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      $('o-btime').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } else {
      $('o-btime').value = '';
    }

    updateOfferFormButtons();
    syncWhatsAppPreview();
    $('offerForm').hidden = false;
    $('o-name').focus();
  }
  $('newOffer').addEventListener('click', function () { openOffer(); });

  function performSaveOffer(sendImmediately) {
    var msg = $('offerMsg');
    var start = $('o-start').value;
    var end = $('o-end').value;
    msg.textContent = '';

    if (!validateOfferDates()) {
      msg.textContent = 'End date cannot be before start date.';
      return $('o-end').focus();
    }

    var name = $('o-name').value.trim();
    if (!name) {
      msg.textContent = 'Please enter an offer name.';
      return $('o-name').focus();
    }

    var discount = $('o-discount').value.trim();
    if (!discount) {
      msg.textContent = 'Please enter a discount.';
      return $('o-discount').focus();
    }

    var doBroadcast = $('o-broadcast').checked;
    var btime = $('o-btime').value;

    if ((doBroadcast || sendImmediately) && !sendImmediately && !btime) {
      msg.textContent = 'Please choose a send date and time for the WhatsApp broadcast.';
      return $('o-btime').focus();
    }

    var subCount = customers.filter(function (c) { return c.is_subscribed; }).length;
    var audienceStr = subCount + ' subscribed customer' + (subCount === 1 ? '' : 's');

    var executeSave = function () {
      var saveBtn = $('saveOfferBtn');
      var sendNowBtn = $('saveAndSendNowBtn');
      if (saveBtn) saveBtn.disabled = true;
      if (sendNowBtn) sendNowBtn.disabled = true;

      var fileToUpload = posterUploader.getFile();
      if (saveBtn && !sendImmediately) {
        saveBtn.textContent = fileToUpload ? 'Uploading poster...' : (doBroadcast ? 'Scheduling...' : 'Saving offer...');
      }
      if (sendNowBtn && sendImmediately) {
        sendNowBtn.textContent = fileToUpload ? 'Uploading poster...' : 'Sending...';
      }

      upload(fileToUpload, 'posters').then(function (url) {
        var row = {
          name: name,
          discount: discount,
          starts_on: start,
          ends_on: end,
          terms: $('o-terms').value.trim() || 'Terms apply. Dine-in only.',
          is_visible: $('o-visible').checked
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
          var savedOffer = must(r)[0];
          if (doBroadcast || sendImmediately) {
            var scheduledIso = sendImmediately ? new Date().toISOString() : new Date(btime).toISOString();
            var existingB = getOfferBroadcast(savedOffer.id);
            var bRow = {
              offer_id: savedOffer.id,
              scheduled_at: scheduledIso,
              status: sendImmediately ? 'processing' : 'scheduled',
              offer_name: savedOffer.name,
              discount: savedOffer.discount,
              starts_on: savedOffer.starts_on,
              ends_on: savedOffer.ends_on,
              terms: savedOffer.terms,
              poster_url: savedOffer.poster_url || ''
            };
            var bp = (existingB && existingB.status === 'scheduled') ?
              db.from('broadcasts').update(bRow).eq('id', existingB.id).select() :
              db.from('broadcasts').insert(bRow).select();

            return bp.then(function (br) {
              var savedB = (br && br.data && br.data[0]) || (must(br)[0]);
              var broadcastId = savedB ? savedB.id : (existingB ? existingB.id : null);
              if (sendImmediately && broadcastId) {
                if (sendNowBtn) sendNowBtn.textContent = 'Dispatching WhatsApp...';
                return fetch('/api/dispatch-broadcast', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ broadcast_id: broadcastId })
                }).then(function (resp) {
                  return resp.json();
                }).then(function (res) {
                  if (res.error) throw new Error(res.error);
                  return { sendImmediately: true, sent: res.sent, failed: res.failed, total: res.total };
                });
              }
              return { scheduled: true, scheduledIso: scheduledIso };
            });
          } else if (editingOffer) {
            var existingB = getOfferBroadcast(editingOffer.id);
            if (existingB && existingB.status === 'scheduled') {
              return db.from('broadcasts').delete().eq('id', existingB.id);
            }
          }
        });
      }).then(function (outcome) {
        $('offerForm').hidden = true;
        if (outcome && outcome.sendImmediately) {
          toast('Offer saved & WhatsApp broadcast dispatched (' + (outcome.sent || 0) + ' sent' + (outcome.failed ? ', ' + outcome.failed + ' failed' : '') + ')');
        } else if (doBroadcast) {
          toast('Offer saved & WhatsApp broadcast scheduled!');
        } else {
          toast('Offer saved');
        }
        return loadOffers();
      }).catch(function (e) {
        msg.textContent = say(e);
      }).finally(function () {
        if (saveBtn) saveBtn.disabled = false;
        if (sendNowBtn) sendNowBtn.disabled = false;
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
        tone: 'wa'
      }).then(function (ok) {
        if (ok) executeSave();
      });
    } else {
      executeSave();
    }
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
  function drawCustomers(itemsToDraw) {
    var list = $('customerList');
    list.textContent = '';
    var set = itemsToDraw || customers;
    if (!set.length) list.appendChild(el('li', 'empty', 'No customers found.'));

    set.forEach(function (c) {
      var pills = [
        { text: c.is_subscribed ? 'Active' : 'Unsubscribed', on: c.is_subscribed },
        { text: c.source || 'website', cls: 'pill' }
      ];
      var sub = c.phone + ' · Joined ' + day(c.opted_in_at ? c.opted_in_at.split('T')[0] : '');

      var toggleBtn = el('button', '', c.is_subscribed ? 'Unsubscribe' : 'Resubscribe');
      toggleBtn.type = 'button';
      toggleBtn.addEventListener('click', function () { toggleCustomerSubscription(c); });

      list.appendChild(row(null, c.name, pills, sub, null, function () {
        remove('customers', c.id, c.name, loadCustomers);
      }, [toggleBtn]));
    });

    var subCount = customers.filter(function (c) { return c.is_subscribed; }).length;
    var unsubCount = customers.length - subCount;
    $('countSubscribed').textContent = subCount;
    $('countUnsubscribed').textContent = unsubCount;
    var waAud = $('waAudienceVal');
    if (waAud) waAud.textContent = subCount + ' subscribed member' + (subCount === 1 ? '' : 's');
  }

  function loadCustomers() {
    return db.from('customers').select('*').order('opted_in_at', { ascending: false }).then(function (r) {
      customers = must(r) || [];
      drawCustomers();
    }).catch(function (e) { toast(say(e)); });
  }

  function toggleCustomerSubscription(c) {
    var newState = !c.is_subscribed;
    var update = { is_subscribed: newState };
    if (!newState) update.unsubscribed_at = new Date().toISOString();
    db.from('customers').update(update).eq('id', c.id).then(function (r) {
      must(r);
      toast((newState ? 'Subscribed ' : 'Unsubscribed ') + c.name);
      return loadCustomers();
    }).catch(function (e) { toast(say(e)); });
  }

  $('searchCustomers').addEventListener('input', function () {
    var q = this.value.trim().toLowerCase();
    if (!q) return drawCustomers();
    var filtered = customers.filter(function (c) {
      return (c.name && c.name.toLowerCase().includes(q)) || (c.phone && c.phone.includes(q));
    });
    drawCustomers(filtered);
  });

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
    var rawPhone = $('c-phone').value.trim().replace(/\D/g, '');
    msg.textContent = '';

    if (!name) return $('c-name').focus();
    if (!/^[6-9][0-9]{9}$/.test(rawPhone)) {
      msg.textContent = 'Enter a valid 10-digit mobile number.';
      return $('c-phone').focus();
    }

    var phone = '+91' + rawPhone;
    btn.disabled = true;

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
      btn.disabled = false;
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
    $('csvFileInput').click();
  });
  $('downloadSampleCsvBtn').addEventListener('click', downloadSampleCsv);
  $('copyCsvTemplateBtn').addEventListener('click', copyCsvTemplate);
  $('csvFormatModal').addEventListener('click', function (ev) {
    if (ev.target === $('csvFormatModal')) closeCsvFormatModal();
  });

  $('importCsvBtn').addEventListener('click', function () { $('csvFileInput').click(); });
  $('csvFileInput').addEventListener('change', function () {
    var file = this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var lines = e.target.result.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return toast('The selected file is empty.');

      var nameIdx = 0, phoneIdx = 1, startLine = 0;
      var firstRow = parseCsvLine(lines[0]);
      var isHeader = false;

      firstRow.forEach(function (col, idx) {
        var lower = col.toLowerCase().replace(/[^a-z]/g, '');
        if (lower.indexOf('phone') !== -1 || lower.indexOf('mobile') !== -1 || lower.indexOf('whatsapp') !== -1 || lower.indexOf('contact') !== -1) {
          phoneIdx = idx;
          isHeader = true;
        } else if (lower.indexOf('name') !== -1 || lower.indexOf('customer') !== -1) {
          nameIdx = idx;
          isHeader = true;
        }
      });
      if (isHeader) startLine = 1;

      var phoneMap = new Map();
      var skippedCount = 0;

      for (var i = startLine; i < lines.length; i++) {
        var parts = parseCsvLine(lines[i]);
        if (!parts.length || (parts.length === 1 && !parts[0])) continue;

        var name = 'Customer';
        var phoneStr = '';

        if (parts.length > Math.max(nameIdx, phoneIdx)) {
          name = parts[nameIdx] || 'Customer';
          phoneStr = parts[phoneIdx] || '';
        } else if (parts.length === 1) {
          phoneStr = parts[0];
        } else {
          name = parts[0] || 'Customer';
          phoneStr = parts[1] || '';
        }

        var digits = phoneStr.replace(/\D/g, '');
        if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
        if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

        if (/^[6-9][0-9]{9}$/.test(digits)) {
          var cleanPhone = '+91' + digits;
          phoneMap.set(cleanPhone, {
            name: name,
            phone: cleanPhone,
            is_subscribed: true,
            source: 'import'
          });
        } else {
          skippedCount++;
        }
      }

      var toInsert = Array.from(phoneMap.values());
      if (!toInsert.length) {
        return toast('No valid phone numbers found. Click "CSV Format" to view sample.');
      }

      toast('Importing ' + toInsert.length + ' customer' + (toInsert.length === 1 ? '' : 's') + '...');

      db.from('customers').upsert(toInsert, { onConflict: 'phone' }).then(function (r) {
        must(r);
        var msg = 'Successfully imported ' + toInsert.length + ' customer' + (toInsert.length === 1 ? '' : 's') + '!';
        if (skippedCount > 0) msg += ' (' + skippedCount + ' invalid row' + (skippedCount === 1 ? '' : 's') + ' skipped)';
        toast(msg);
        return loadCustomers();
      }).catch(function (err) {
        toast('Import failed: ' + say(err));
      });
    };
    reader.readAsText(file);
    this.value = '';
  });

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
    return db.from('menu_items').select('*').order('position').then(function (r) { items = must(r); drawItems(); });
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
    btn.disabled = true;
    btn.textContent = fileToUpload ? 'Uploading photo...' : 'Saving item...';

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
      btn.disabled = false;
      btn.textContent = 'Save item';
    });
  });

  /* HOURS SECTION */
  function loadHours() {
    return db.from('site_settings').select('hours').eq('id', 1).maybeSingle().then(function (r) {
      var d = must(r);
      $('h-text').value = d ? d.hours : '';
    });
  }
  $('hoursForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('hoursMsg');
    msg.textContent = '';
    db.from('site_settings').update({ hours: $('h-text').value.trim() }).eq('id', 1).then(function (r) {
      must(r);
      toast('Hours saved');
    }).catch(function (e) { msg.textContent = say(e); });
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

  $('loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('loginMsg'), btn = ev.target.querySelector('[type=submit]');
    msg.textContent = '';
    btn.disabled = true;
    db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value }).then(function (r) {
      if (r.error) throw r.error;
      $('password').value = '';
      return enter();
    }).catch(function (e) { msg.textContent = say(e); }).finally(function () { btn.disabled = false; });
  });

  $('logout').addEventListener('click', function () {
    db.auth.signOut().then(function () { show('login'); });
  });

  db.auth.getSession().then(function (r) {
    if (r.data.session) enter(); else show('login');
  });
})();

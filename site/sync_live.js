/**
 * That Waffle Place - Excel Live Sync Realtime Client & UI Subscriber
 * Connects to Supabase Realtime / REST API and provides connection state,
 * automatic reconnection, sync health badge, record viewer, and live workbook connector.
 */
(function (global) {
  'use strict';

  var state = {
    connected: false,
    connecting: false,
    lastSync: null,
    totalRecords: 0,
    sheets: {},
    devices: [],
    records: [],
    lastError: null,
    reconnectAttempts: 0,
    activeSheetFilter: 'all',
    connectedWorkbook: null
  };

  var listeners = [];
  var pollTimer = null;
  var realtimeChannel = null;

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.error('Sync listener error:', e); }
    });
    window.dispatchEvent(new CustomEvent('twp:sync:change', { detail: state }));
  }

  function formatTime(iso) {
    if (!iso) return 'Never';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      var now = new Date();
      var diffSec = Math.floor((now - d) / 1000);
      if (diffSec < 5) return 'Just now';
      if (diffSec < 60) return diffSec + 's ago';
      if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ')';
    } catch (e) {
      return iso;
    }
  }

  function fetchStatus() {
    return fetch('/api/sync/status')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        state.connected = true;
        state.connecting = false;
        state.reconnectAttempts = 0;
        state.lastError = null;
        state.sheets = data.sheets || {};
        state.devices = data.devices || [];
        state.totalRecords = data.total_active_records || 0;
        state.connectedWorkbook = data.connected_workbook || null;
        if (data.last_sync) {
          state.lastSync = data.last_sync.created_at;
        }
        emit();
        renderBadge();
        return data;
      })
      .catch(function (err) {
        state.connected = false;
        state.connecting = false;
        state.lastError = err.message || 'Offline';
        state.reconnectAttempts++;
        emit();
        renderBadge();
      });
  }

  function fetchRecords() {
    var c = window.TWP_SUPABASE || {};
    var url = (c.url || '') + '/rest/v1/synced_records?select=*&order=synced_at.desc';
    var headers = c.anonKey ? { 'apikey': c.anonKey } : {};

    return fetch(url, { headers: headers })
      .then(function (r) {
        if (!r.ok) throw new Error('Status ' + r.status);
        return r.json();
      })
      .then(function (recs) {
        state.records = recs || [];
        emit();
        return recs;
      })
      .catch(function () {
        // Fallback to local table via /sb/rest/v1/
        return fetch('/sb/rest/v1/synced_records?select=*&order=synced_at.desc')
          .then(function (r) { return r.ok ? r.json() : []; })
          .then(function (recs) {
            state.records = recs || [];
            emit();
            return recs;
          })
          .catch(function () { return []; });
      });
  }

  function initRealtime() {
    var c = window.TWP_SUPABASE || {};
    if (global.supabase && typeof global.supabase.createClient === 'function' && c.url && c.anonKey) {
      try {
        var client = global.supabase.createClient(c.url, c.anonKey);
        realtimeChannel = client.channel('twp-synced-records')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'synced_records' }, function (payload) {
            console.log('[REALTIME] Synced records update received:', payload);
            fetchStatus();
            fetchRecords();
            flashBadge();
          })
          .subscribe(function (status) {
            if (status === 'SUBSCRIBED') {
              state.connected = true;
              state.realtimeActive = true;
              emit();
              renderBadge();
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
              state.realtimeActive = false;
              emit();
              renderBadge();
            }
          });
      } catch (e) {
        console.warn('Realtime subscription skipped, using background polling:', e);
      }
    }

    // Bulletproof periodic heartbeat polling (every 15s)
    if (!pollTimer) {
      pollTimer = setInterval(function () {
        fetchStatus();
      }, 15000);
    }
  }

  function flashBadge() {
    var badge = document.getElementById('twpSyncBadge');
    if (badge) {
      badge.classList.add('twp-sync-pulse');
      setTimeout(function () { badge.classList.remove('twp-sync-pulse'); }, 1200);
    }
  }

  function esc(s) {
    return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderBadge() {
    var badge = document.getElementById('twpSyncBadge');
    if (!badge) {
      var header = document.querySelector('header.top');
      if (header) {
        badge = document.createElement('div');
        badge.id = 'twpSyncBadge';
        badge.className = 'twp-sync-badge';
        var logoutBtn = document.getElementById('logout');
        if (logoutBtn) {
          header.insertBefore(badge, logoutBtn);
        } else {
          header.appendChild(badge);
        }
      }
    }
    if (!badge) return;

    var dotCls = 'dot--live';
    var statusText = 'Excel Live Sync: Ready';

    if (!state.connected && state.lastError) {
      dotCls = 'dot--offline';
      statusText = 'Excel Sync: Offline';
    } else if (state.connecting) {
      dotCls = 'dot--reconnecting';
      statusText = 'Excel Sync: Connecting...';
    } else if (state.totalRecords > 0) {
      dotCls = 'dot--live';
      statusText = 'Excel Live: ' + state.totalRecords + ' Customers';
    } else {
      dotCls = 'dot--live';
      statusText = 'Excel Live Sync: Ready';
    }

    badge.innerHTML = 
      '<button type="button" class="twp-sync-badge-btn" title="Click to view Excel Live Sync details">' +
        '<span class="twp-sync-dot ' + dotCls + '" aria-hidden="true"></span>' +
        '<span class="twp-sync-label">' + esc(statusText) + '</span>' +
      '</button>';

    badge.onclick = function () {
      var syncTabBtn = document.querySelector('button.tab[data-tab="sync"]');
      if (syncTabBtn) {
        syncTabBtn.click();
      }
    };
  }

  function renderSyncTab() {
    var section = document.getElementById('tab-sync');
    if (!section) return;

    var sheetsList = Object.keys(state.sheets);
    var filteredRecords = state.records.filter(function (r) {
      if (state.activeSheetFilter === 'all') return true;
      return r.sheet_name === state.activeSheetFilter;
    });

    var isLive = state.connected || (state.totalRecords > 0 && !state.lastError);
    var wb = state.connectedWorkbook || {};
    var hasActiveWb = Boolean(wb.exists && state.totalRecords > 0);

    var fileTagHtml = hasActiveWb
      ? '<span class="twp-sync-active-file-tag">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
          'Live Connected: <b>' + esc(wb.filename || 'Workbook.xlsx') + '</b>' +
        '</span>'
      : '<span class="twp-sync-active-file-tag is-empty">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
          'No Workbook Connected (0 Records)' +
        '</span>';

    // 1. Connect Excel Live Studio Component
    var connectHtml = 
      '<div class="twp-sync-connect-section">' +
        '<div class="twp-sync-connect-header">' +
          '<h2>' +
            '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#059669" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' +
            'Connect Excel Workbook Live' +
          '</h2>' +
          fileTagHtml +
        '</div>' +

        '<div class="twp-sync-methods-grid">' +
          '<!-- Method 1: Upload / Drag & Drop -->' +
          '<div class="twp-sync-method-card">' +
            '<div class="twp-sync-method-title">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#059669" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
              'Option 1: Upload &amp; Connect .xlsx' +
            '</div>' +
            '<p class="twp-sync-method-desc">Select or drop your customer Excel workbook here. Ingests all custom columns (City, Birthday, Notes, etc.) live immediately.</p>' +
            '<label for="excelLiveUpload" class="twp-sync-dropzone" id="excelDropzone">' +
              '<svg class="twp-sync-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>' +
              '<span class="twp-sync-dropzone-text" id="dropzoneLabel"><b>Choose .xlsx file</b> or drag &amp; drop</span>' +
              '<span class="twp-sync-dropzone-hint">Excel Workbooks (.xlsx) &bull; Any custom columns supported</span>' +
            '</label>' +
            '<input type="file" id="excelLiveUpload" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="position:fixed;top:-1000px;left:-1000px;width:1px;height:1px;opacity:0;pointer-events:none;">' +
          '</div>' +

          '<!-- Method 2: Local Windows Path Watcher -->' +
          '<div class="twp-sync-method-card">' +
            '<div class="twp-sync-method-title">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' +
              'Option 2: Connect Local Windows File Path' +
            '</div>' +
            '<p class="twp-sync-method-desc">Specify a workbook on this Windows PC. Whenever you press Ctrl+S in Microsoft Excel, your website auto-syncs live in real time.</p>' +
            '<div class="twp-sync-path-box">' +
              '<div class="twp-sync-path-input-wrap">' +
                '<input type="text" id="excelPathInput" class="twp-sync-path-input" placeholder="e.g. C:\\Users\\ashok\\OneDrive\\Desktop\\Customers.xlsx" value="' + esc(wb.path || '') + '">' +
                '<button type="button" class="twp-sync-btn-connect" id="btnConnectPath">Connect &amp; Watch</button>' +
              '</div>' +
              '<small style="color:#786a5f;font-size:12px;">Full Windows path to your local .xlsx workbook.</small>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<!-- Notification Banner -->' +
        '<div id="syncLiveMsg" class="twp-sync-live-msg" role="alert"></div>' +

        '<!-- Action Controls Bar -->' +
        '<div class="twp-sync-actions-bar">' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<button type="button" class="twp-btn twp-btn--ghost" id="syncNowBtn" style="font-size:13px;min-height:38px;padding:0 14px;">↻ Sync Now from Excel</button>' +
            '<a href="/api/sync/template" download="Customers_Template.xlsx" class="twp-btn twp-btn--ghost" id="downloadTemplateBtn" style="font-size:13px;min-height:38px;padding:0 14px;text-decoration:none;">⬇️ Download Excel Template</a>' +
          '</div>' +
          '<div>' +
            '<button type="button" class="twp-btn twp-btn--ghost" id="wipeAllBtn" style="font-size:13px;min-height:38px;padding:0 14px;color:#b91c1c;border-color:#fca5a5;" title="Wipe all synced records and start completely fresh">🗑️ Wipe All Records &amp; Disconnect</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // 2. Metrics Cards
    var cardsHtml = 
      '<div class="twp-sync-dashboard-grid">' +
        '<div class="twp-sync-stat-card">' +
          '<span class="twp-label">Connection Status</span>' +
          '<h3><span class="twp-sync-dot ' + (isLive ? 'dot--live' : 'dot--offline') + '" style="margin-right:6px;"></span> ' + (isLive ? 'Connected (Live)' : 'Offline / Reconnecting') + '</h3>' +
          '<p class="twp-note">Automatic polling &amp; change listeners active</p>' +
        '</div>' +
        '<div class="twp-sync-stat-card">' +
          '<span class="twp-label">Customer Records</span>' +
          '<h3>' + state.totalRecords + ' Customers</h3>' +
          '<p class="twp-note">Source of truth: Windows .xlsx workbook</p>' +
        '</div>' +
        '<div class="twp-sync-stat-card">' +
          '<span class="twp-label">Last Ingested</span>' +
          '<h3>' + formatTime(state.lastSync) + '</h3>' +
          '<p class="twp-note">Dynamic columns synced into CRM &amp; Offers</p>' +
        '</div>' +
      '</div>';

    // 3. Filter Bar
    var filterOptions = '<option value="all">All Synchronized Sheets (' + state.records.length + ')</option>';
    sheetsList.forEach(function (s) {
      var cnt = state.sheets[s].active_records || 0;
      filterOptions += '<option value="' + esc(s) + '" ' + (state.activeSheetFilter === s ? 'selected' : '') + '>' + esc(s) + ' (' + cnt + ' active)</option>';
    });

    var filterHtml = 
      '<div class="twp-sync-bar">' +
        '<div class="twp-sync-filter">' +
          '<label for="syncSheetFilter" class="twp-label" style="margin:0;font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">Filter Sheet:</label>' +
          '<select id="syncSheetFilter" class="twp-select">' + filterOptions + '</select>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
          '<button type="button" class="twp-btn twp-btn--ghost" id="refreshSyncBtn" style="font-size:13px;min-height:36px;padding:0 12px;">↻ Refresh Table</button>' +
        '</div>' +
      '</div>';

    // 4. Data Rows
    var rowsHtml = '';
    if (filteredRecords.length === 0) {
      rowsHtml = '<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--ink-soft);font-family:var(--font-sans);font-size:14px;">No customer records yet. Upload or connect your Excel workbook above to sync live!</td></tr>';
    } else {
      filteredRecords.forEach(function (r) {
        var statusBadge = r.is_deleted 
          ? '<span class="twp-chip twp-chip--del">Archived</span>' 
          : '<span class="twp-chip twp-chip--ok">Active</span>';
        
        var attrChips = '';
        if (r.data && typeof r.data === 'object') {
          Object.keys(r.data).forEach(function (k) {
            var val = r.data[k];
            if (val !== null && val !== undefined && String(val).trim() !== '') {
              attrChips += '<span class="twp-record-attr-chip"><b>' + esc(k) + ':</b> ' + esc(String(val)) + '</span> ';
            }
          });
        }
        if (!attrChips) attrChips = '<span style="color:var(--ink-soft);">-</span>';

        rowsHtml += 
          '<tr>' +
            '<td><b style="color:var(--umber);">' + esc(r.sheet_name || '') + '</b></td>' +
            '<td><code style="background:#f3ecda;padding:2px 6px;border-radius:4px;color:var(--dune);font-weight:600;">' + esc(r.row_id || '') + '</code></td>' +
            '<td>' + (r.row_number != null ? '#' + r.row_number : '-') + '</td>' +
            '<td><div class="twp-record-attr-list">' + attrChips + '</div></td>' +
            '<td>' + statusBadge + '</td>' +
            '<td><small style="color:var(--ink-soft);font-weight:600;">' + formatTime(r.synced_at) + '</small></td>' +
          '</tr>';
      });
    }

    var tableHtml = 
      '<div class="twp-sync-table-wrap">' +
        '<table class="twp-sync-table">' +
          '<thead>' +
            '<tr>' +
              '<th>Sheet</th>' +
              '<th>Customer ID / Phone</th>' +
              '<th>Excel Row</th>' +
              '<th>Ingested Attributes (Dynamic Columns)</th>' +
              '<th>Status</th>' +
              '<th>Synced At</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>';

    section.innerHTML = 
      '<div class="head" style="margin-bottom:18px;">' +
        '<div>' +
          '<h1 style="font-size:clamp(40px,7vw,64px);">customer excel live sync</h1>' +
          '<p style="margin:4px 0 0;font-size:14.5px;font-family:var(--font-sans);color:var(--ink-soft);">Connect your Windows Excel (.xlsx) workbook directly through the site. Syncs customer lists live into Customer CRM and WhatsApp Offers.</p>' +
        '</div>' +
      '</div>' +
      connectHtml +
      cardsHtml +
      filterHtml +
      tableHtml;

    // --- Wire Up Event Listeners ---
    function showMsg(text, isError) {
      var msgBox = document.getElementById('syncLiveMsg');
      if (!msgBox) return;
      msgBox.className = 'twp-sync-live-msg ' + (isError ? 'is-error' : 'is-success');
      msgBox.textContent = text;
      msgBox.style.display = 'block';
      setTimeout(function () {
        if (msgBox) msgBox.style.display = 'none';
      }, 7000);
    }

    // 1. File Upload Dropzone
    var fileInput = document.getElementById('excelLiveUpload');
    var dropzone = document.getElementById('excelDropzone');
    var dropLabel = document.getElementById('dropzoneLabel');

    if (fileInput && dropzone) {
      ['dragenter', 'dragover'].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (e) {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('is-dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (e) {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('is-dragover');
        });
      });

      dropzone.addEventListener('drop', function (e) {
        var dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) {
          handleExcelFile(dt.files[0]);
        }
      });

      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files.length) {
          handleExcelFile(fileInput.files[0]);
        }
      });
    }

    function handleExcelFile(file) {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        showMsg('Please choose a valid Excel workbook file ending in .xlsx', true);
        return;
      }
      if (dropLabel) dropLabel.innerHTML = 'Uploading <b>' + esc(file.name) + '</b> and syncing...';

      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/sync/upload-excel', true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var res = JSON.parse(xhr.responseText);
            showMsg(res.message || 'Excel file connected and synced live!', false);
          } catch (e) {
            showMsg('Excel file uploaded and synced successfully!', false);
          }
          Promise.all([fetchStatus(), fetchRecords()]).then(function () {
            renderSyncTab();
          });
        } else {
          var errMsg = 'Failed uploading Excel file.';
          try {
            var errObj = JSON.parse(xhr.responseText);
            if (errObj.error) errMsg = errObj.error;
          } catch (e) {}
          showMsg(errMsg, true);
          if (dropLabel) dropLabel.innerHTML = '<b>Choose .xlsx file</b> or drag &amp; drop';
        }
      };

      xhr.onerror = function () {
        showMsg('Network error while uploading Excel workbook.', true);
        if (dropLabel) dropLabel.innerHTML = '<b>Choose .xlsx file</b> or drag &amp; drop';
      };

      xhr.send(file);
    }

    // 2. Connect Local Windows File Path
    var btnConnectPath = document.getElementById('btnConnectPath');
    var pathInput = document.getElementById('excelPathInput');
    if (btnConnectPath && pathInput) {
      btnConnectPath.addEventListener('click', function () {
        var p = pathInput.value.trim();
        if (!p) {
          showMsg('Please enter a valid Windows path to your .xlsx workbook.', true);
          return;
        }
        btnConnectPath.disabled = true;
        btnConnectPath.textContent = 'Connecting...';

        fetch('/api/sync/connect-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p })
        })
          .then(function (r) {
            return r.json().then(function (d) {
              if (!r.ok) throw new Error(d.error || 'Failed connecting path');
              return d;
            });
          })
          .then(function (data) {
            showMsg(data.message || 'Connected path and synced live!', false);
            return Promise.all([fetchStatus(), fetchRecords()]);
          })
          .then(function () {
            renderSyncTab();
          })
          .catch(function (err) {
            showMsg(err.message, true);
          })
          .finally(function () {
            btnConnectPath.disabled = false;
            btnConnectPath.textContent = 'Connect & Watch';
          });
      });
    }

    // 3. Sync Now
    var syncNowBtn = document.getElementById('syncNowBtn');
    if (syncNowBtn) {
      syncNowBtn.addEventListener('click', function () {
        syncNowBtn.disabled = true;
        syncNowBtn.textContent = 'Syncing...';

        fetch('/api/sync/sync-now', { method: 'POST' })
          .then(function (r) {
            return r.json().then(function (d) {
              if (!r.ok) throw new Error(d.error || 'Sync failed');
              return d;
            });
          })
          .then(function (data) {
            showMsg(data.message || 'Successfully re-synced from Excel!', false);
            return Promise.all([fetchStatus(), fetchRecords()]);
          })
          .then(function () {
            renderSyncTab();
          })
          .catch(function (err) {
            showMsg(err.message, true);
          })
          .finally(function () {
            syncNowBtn.disabled = false;
            syncNowBtn.textContent = '↻ Sync Now from Excel';
          });
      });
    }

    // 4. Wipe All Records & Disconnect
    var wipeAllBtn = document.getElementById('wipeAllBtn');
    if (wipeAllBtn) {
      wipeAllBtn.addEventListener('click', function () {
        if (!confirm('Are you sure you want to remove all synced records and imported customers to start completely fresh? This will clear all data.')) return;
        wipeAllBtn.disabled = true;
        wipeAllBtn.textContent = 'Wiping...';

        fetch('/api/sync/reset?wipe_all=true', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wipe_all: true })
        })
          .then(function (r) { return r.json(); })
          .then(function () {
            return Promise.all([fetchStatus(), fetchRecords()]);
          })
          .then(function () {
            renderSyncTab();
            showMsg('All records have been completely cleared! Connect your Excel workbook above to start fresh.', false);
          })
          .catch(function (e) {
            showMsg('Error clearing records: ' + e.message, true);
          })
          .finally(function () {
            wipeAllBtn.disabled = false;
            wipeAllBtn.textContent = '🗑️ Wipe All Records & Disconnect';
          });
      });
    }

    // 5. Filter Select
    var filterSelect = document.getElementById('syncSheetFilter');
    if (filterSelect) {
      filterSelect.addEventListener('change', function (ev) {
        state.activeSheetFilter = ev.target.value;
        renderSyncTab();
      });
    }

    // 6. Refresh Table Button
    var refreshBtn = document.getElementById('refreshSyncBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
        Promise.all([fetchStatus(), fetchRecords()]).then(function () {
          renderSyncTab();
        });
      });
    }
  }

  // Public API
  global.TWPSync = {
    getState: function () { return state; },
    subscribe: function (fn) {
      listeners.push(fn);
      fn(state);
      return function () {
        listeners = listeners.filter(function (l) { return l !== fn; });
      };
    },
    refresh: function () {
      return Promise.all([fetchStatus(), fetchRecords()]);
    },
    init: function () {
      fetchStatus().then(function () {
        var sec = document.getElementById('tab-sync');
        if (sec && !sec.hidden) renderSyncTab();
      });
      fetchRecords().then(function () {
        var sec = document.getElementById('tab-sync');
        if (sec && !sec.hidden) renderSyncTab();
      });
      initRealtime();
    },
    renderSyncTab: renderSyncTab
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', global.TWPSync.init);
  } else {
    global.TWPSync.init();
  }

})(window);

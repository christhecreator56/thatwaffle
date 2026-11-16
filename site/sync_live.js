/**
 * That Waffle Place - Excel Live Sync Realtime Client & UI Subscriber
 * Connects to Supabase Realtime / REST API and provides connection state,
 * automatic reconnection, sync health badge, and record viewer.
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
    activeSheetFilter: 'all'
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
              // Maintain connection if REST API is healthy
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

    var isLive = state.connected || (state.totalRecords > 0 && !state.lastError);
    var dotCls = isLive ? 'dot--live' : (state.connecting ? 'dot--reconnecting' : 'dot--offline');
    var statusText = isLive 
      ? 'Live Sync: ' + state.totalRecords + ' Customers (' + formatTime(state.lastSync) + ')' 
      : (state.connecting ? 'Reconnecting...' : 'Sync Offline (' + (state.lastError || 'offline') + ')');

    badge.innerHTML = 
      '<button type="button" class="twp-sync-badge-btn" title="Click to view Excel Live Sync details">' +
        '<span class="twp-sync-dot ' + dotCls + '" aria-hidden="true"></span>' +
        '<span class="twp-sync-label">' + statusText + '</span>' +
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
          '<button type="button" class="twp-btn twp-btn--ghost" id="refreshSyncBtn">↻ Refresh Data</button>' +
          '<button type="button" class="twp-btn twp-btn--ghost" id="resetFreshBtn" style="color:#b91c1c;border-color:#fca5a5;" title="Clear stale records and re-sync freshly from Excel">🗑️ Clear &amp; Start Fresh</button>' +
        '</div>' +
      '</div>';

    var rowsHtml = '';
    if (filteredRecords.length === 0) {
      rowsHtml = '<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--ink-soft);font-family:var(--font-sans);font-size:14px;">No customer records yet. Add rows in your Excel file or click <b>↻ Refresh Data</b>.</td></tr>';
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
      '<div class="head">' +
        '<div>' +
          '<h1>customer excel live sync</h1>' +
          '<p style="margin:4px 0 0;font-size:14.5px;font-family:var(--font-sans);color:var(--ink-soft);">One-way live synchronization from your Windows Excel workbook directly into Customer CRM and WhatsApp Broadcasts.</p>' +
        '</div>' +
      '</div>' +
      cardsHtml +
      filterHtml +
      tableHtml;

    var filterSelect = document.getElementById('syncSheetFilter');
    if (filterSelect) {
      filterSelect.addEventListener('change', function (ev) {
        state.activeSheetFilter = ev.target.value;
        renderSyncTab();
      });
    }

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

    var resetBtn = document.getElementById('resetFreshBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (!confirm('Clear old synchronized test sheets and records to start fresh? Your current CRM counter opt-ins will remain safe.')) return;
        resetBtn.disabled = true;
        resetBtn.textContent = 'Resetting...';
        fetch('/api/sync/reset', { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function () {
            return Promise.all([fetchStatus(), fetchRecords()]);
          })
          .then(function () {
            renderSyncTab();
            alert('Synced records cleared fresh! Now add or save rows in your Excel file to sync cleanly.');
          })
          .catch(function (e) {
            alert('Reset error: ' + e.message);
          })
          .finally(function () {
            resetBtn.disabled = false;
            resetBtn.textContent = '🗑️ Clear & Start Fresh';
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
      fetchStatus();
      fetchRecords();
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

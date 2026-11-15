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
              emit();
              renderBadge();
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
              state.connected = false;
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

    var dotCls = state.connected ? 'dot--live' : (state.connecting ? 'dot--reconnecting' : 'dot--offline');
    var statusText = state.connected 
      ? 'Live Sync: ' + state.totalRecords + ' items (' + formatTime(state.lastSync) + ')' 
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

    var cardsHtml = 
      '<div class="twp-sync-dashboard-grid">' +
        '<div class="twp-sync-stat-card">' +
          '<span class="twp-label">Connection Status</span>' +
          '<h3>' + (state.connected ? '🟢 Connected (Realtime)' : '🔴 Offline / Reconnecting') + '</h3>' +
          '<p class="twp-note">Automatic polling &amp; change listeners active</p>' +
        '</div>' +
        '<div class="twp-sync-stat-card">' +
          '<span class="twp-label">Active Records</span>' +
          '<h3>' + state.totalRecords + ' Rows</h3>' +
          '<p class="twp-note">' + sheetsList.length + ' synchronized Excel sheets</p>' +
        '</div>' +
        '<div class="twp-sync-stat-card">' +
          '<span class="twp-label">Last Ingested</span>' +
          '<h3>' + formatTime(state.lastSync) + '</h3>' +
          '<p class="twp-note">Source of truth: Windows .xlsx workbook</p>' +
        '</div>' +
      '</div>';

    var filterOptions = '<option value="all">All Synchronized Sheets (' + state.records.length + ')</option>';
    sheetsList.forEach(function (s) {
      var cnt = state.sheets[s].active_records || 0;
      filterOptions += '<option value="' + s + '" ' + (state.activeSheetFilter === s ? 'selected' : '') + '>' + s + ' (' + cnt + ' active)</option>';
    });

    var filterHtml = 
      '<div class="twp-sync-bar">' +
        '<div class="twp-sync-filter">' +
          '<label for="syncSheetFilter" class="twp-label">Filter Sheet:</label>' +
          '<select id="syncSheetFilter" class="twp-select">' + filterOptions + '</select>' +
        '</div>' +
        '<button type="button" class="twp-btn twp-btn--ghost" id="refreshSyncBtn">↻ Refresh Sync Data</button>' +
      '</div>';

    var rowsHtml = '';
    if (filteredRecords.length === 0) {
      rowsHtml = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--ink-soft);">No records found. Run the sync agent or edit your Excel workbook to populate live rows.</td></tr>';
    } else {
      filteredRecords.forEach(function (r) {
        var statusBadge = r.is_deleted 
          ? '<span class="twp-chip twp-chip--del">Archived</span>' 
          : '<span class="twp-chip twp-chip--ok">Active</span>';
        
        var dataPreview = JSON.stringify(r.data || {})
          .replace(/"/g, '')
          .replace(/[{}]/g, '')
          .replace(/,/g, ' · ');

        rowsHtml += 
          '<tr>' +
            '<td><b>' + (r.sheet_name || '') + '</b></td>' +
            '<td><code>' + (r.row_id || '') + '</code></td>' +
            '<td>' + (r.row_number != null ? '#' + r.row_number : '-') + '</td>' +
            '<td><span class="twp-record-preview">' + dataPreview + '</span></td>' +
            '<td>' + statusBadge + '</td>' +
            '<td><small>' + formatTime(r.synced_at) + '</small></td>' +
          '</tr>';
      });
    }

    var tableHtml = 
      '<div class="twp-sync-table-wrap">' +
        '<table class="twp-sync-table">' +
          '<thead>' +
            '<tr>' +
              '<th>Sheet</th>' +
              '<th>Row ID</th>' +
              '<th>Excel Row</th>' +
              '<th>Ingested Attributes</th>' +
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
          '<h1>Excel Live Sync</h1>' +
          '<p style="margin:4px 0 0;font-size:14px;color:var(--ink-soft);">One-way durable sync from Windows PC Excel workbook into Supabase.</p>' +
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

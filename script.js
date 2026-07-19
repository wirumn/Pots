(() => {
  'use strict';

  const SPAWN_INTERVAL = 30 * 60;
  const FRESH_INTERVAL = 10 * 60;
  const WARNING_THRESHOLD = 5 * 60;
  const DCS = ['chaos', 'oce', 'light'];
  const STORAGE_KEY = 'potTracker_v3';

  // State
  let state = {
    chaos: { targetTime: null, location: null, totalDuration: null },
    oce:   { targetTime: null, location: null, totalDuration: null },
    light: { targetTime: null, location: null, totalDuration: null },
    history: [],
  };

  // Track what's pending a location pick: null or { dc, duration }
  let pendingSpawn = null;
  // Track editor location selection
  let editorLoc = {};

  // DOM refs
  const el = {};
  DCS.forEach(dc => {
    el[dc] = {
      card:      document.getElementById(`card-${dc}`),
      timer:     document.getElementById(`timer-${dc}`),
      label:     document.getElementById(`label-${dc}`),
      status:    document.getElementById(`status-${dc}`),
      locDisp:   document.getElementById(`loc-display-${dc}`),
      actions:   document.getElementById(`actions-${dc}`),
      spawnBtn:  document.getElementById(`spawn-${dc}`),
      freshBtn:  document.getElementById(`fresh-${dc}`),
      editBtn:   document.getElementById(`edit-${dc}`),
      resetBtn:  document.getElementById(`reset-${dc}`),
      picker:    document.getElementById(`picker-${dc}`),
      pickNorth: document.getElementById(`pick-${dc}-north`),
      pickSouth: document.getElementById(`pick-${dc}-south`),
      editor:    document.getElementById(`editor-${dc}`),
      editMin:   document.getElementById(`edit-min-${dc}`),
      editSec:   document.getElementById(`edit-sec-${dc}`),
      editAgo:   document.getElementById(`edit-ago-${dc}`),
      edLocN:    document.getElementById(`editor-loc-${dc}-north`),
      edLocS:    document.getElementById(`editor-loc-${dc}-south`),
      applyBtn:  document.getElementById(`apply-${dc}`),
      cancelBtn: document.getElementById(`cancel-${dc}`),
    };
  });
  const nextUpContent = document.getElementById('nextUpContent');
  const historyList   = document.getElementById('historyList');
  const clearHistBtn  = document.getElementById('clearHistory');
  const mapToggle     = document.getElementById('mapToggle');
  const mapContent    = document.getElementById('mapContent');
  const mapIcon       = document.getElementById('mapToggleIcon');

  // Persistence
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(_) {}
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      DCS.forEach(dc => {
        if (s[dc]) {
          state[dc].targetTime = s[dc].targetTime || null;
          state[dc].location = s[dc].location || null;
          state[dc].totalDuration = s[dc].totalDuration || null;
        }
      });
      if (Array.isArray(s.history)) state.history = s.history;
    } catch(_) {}
  }

  // Audio
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.15].forEach((d, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.value = i === 0 ? 880 : 1100;
        g.gain.setValueAtTime(0.3, ctx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.8);
        o.start(ctx.currentTime + d);
        o.stop(ctx.currentTime + d + 0.8);
      });
    } catch(_) {}
  }

  // Browser notification
  function notify(dc, loc) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const l = loc ? ` (${loc.toUpperCase()})` : '';
      new Notification(`Pot Spawning - ${dc.toUpperCase()}${l}`, {
        body: 'Pot of Plenty FATE should be spawning!',
      });
    }
  }

  function reqNotifPerm() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // Toast
  function toast(msg) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 3500);
  }

  // Format
  function fmt(s) {
    if (s <= 0) return '00:00';
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  }

  // -- Spawn Flow --
  // Step 1: user clicks Spawn / Fresh -> show location picker
  function beginSpawn(dc, duration) {
    // Close any other pickers/editors
    DCS.forEach(d => {
      el[d].picker.classList.add('hidden');
      el[d].editor.classList.add('hidden');
      el[d].actions.classList.remove('hidden');
    });
    pendingSpawn = { dc, duration };
    el[dc].actions.classList.add('hidden');
    el[dc].picker.classList.remove('hidden');
  }

  // Step 2: user picks location -> start timer, log history
  function confirmSpawn(dc, location) {
    if (!pendingSpawn || pendingSpawn.dc !== dc) return;
    const duration = pendingSpawn.duration;
    pendingSpawn = null;

    const now = Date.now();
    state[dc].targetTime = now + duration * 1000;
    state[dc].totalDuration = duration;
    state[dc].location = location;

    state.history.unshift({
      dc,
      location,
      time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: duration === FRESH_INTERVAL ? 'fresh' : 'spawn',
    });
    if (state.history.length > 50) state.history.length = 50;

    save();

    // Restore normal UI
    el[dc].picker.classList.add('hidden');
    el[dc].actions.classList.remove('hidden');

    updateCard(dc);
    renderHistory();
    updateNextUp();

    const label = duration === FRESH_INTERVAL ? 'Fresh instance' : 'Spawn';
    toast(`${label} timer started for ${dc.toUpperCase()} (${location})`);
  }

  // Manual timer (from editor)
  function applyManualTimer(dc) {
    const agoVal = parseInt(el[dc].editAgo.value, 10);
    let remaining;
    if (!isNaN(agoVal) && agoVal >= 0) {
      remaining = Math.max(0, SPAWN_INTERVAL - agoVal * 60);
    } else {
      const mins = parseInt(el[dc].editMin.value, 10) || 0;
      const secs = parseInt(el[dc].editSec.value, 10) || 0;
      remaining = Math.max(0, mins * 60 + secs);
    }

    const loc = editorLoc[dc] || state[dc].location || null;
    const now = Date.now();
    state[dc].targetTime = now + remaining * 1000;
    state[dc].totalDuration = SPAWN_INTERVAL;
    state[dc].location = loc;

    state.history.unshift({
      dc,
      location: loc || '-',
      time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'manual',
    });
    if (state.history.length > 50) state.history.length = 50;

    save();
    el[dc].editor.classList.add('hidden');
    el[dc].actions.classList.remove('hidden');
    updateCard(dc);
    renderHistory();
    updateNextUp();
    toast(`Timer set for ${dc.toUpperCase()}`);
  }

  function resetTimer(dc) {
    state[dc].targetTime = null;
    state[dc].totalDuration = null;
    state[dc].location = null;
    save();
    updateCard(dc);
    updateNextUp();
    toast(`${dc.toUpperCase()} reset`);
  }

  // -- UI updates --
  function updateCard(dc) {
    const d = state[dc];
    const e = el[dc];
    const card = e.card;

    // Location display
    e.locDisp.textContent = d.location ? `${d.location.charAt(0).toUpperCase()}${d.location.slice(1)}` : '';

    if (!d.targetTime) {
      card.classList.remove('active', 'spawning');
      e.timer.textContent = '--:--';
      e.label.textContent = 'No active timer';
      e.status.textContent = 'Idle';
      e.status.className = 'dc-status';
      return;
    }

    const remaining = Math.max(0, (d.targetTime - Date.now()) / 1000);

    if (remaining <= 0) {
      card.classList.remove('active');
      card.classList.add('spawning');
      e.timer.textContent = 'NOW!';
      e.label.textContent = 'Pot should be spawning!';
      e.status.textContent = 'Spawning';
      e.status.className = 'dc-status spawning';
    } else if (remaining <= WARNING_THRESHOLD) {
      card.classList.add('active');
      card.classList.remove('spawning');
      e.timer.textContent = fmt(remaining);
      e.label.textContent = 'Spawning soon!';
      e.status.textContent = 'Soon';
      e.status.className = 'dc-status warning';
    } else {
      card.classList.add('active');
      card.classList.remove('spawning');
      e.timer.textContent = fmt(remaining);
      e.label.textContent = 'Next spawn in';
      e.status.textContent = 'Counting';
      e.status.className = 'dc-status counting';
    }
  }

  function updateNextUp() {
    const items = [];
    DCS.forEach(dc => {
      if (!state[dc].targetTime) return;
      items.push({
        dc,
        remaining: Math.max(0, (state[dc].targetTime - Date.now()) / 1000),
        location: state[dc].location,
      });
    });

    if (items.length === 0) {
      nextUpContent.innerHTML = '<p class="muted">No active timers</p>';
      return;
    }

    items.sort((a, b) => a.remaining - b.remaining);
    nextUpContent.innerHTML = '<div class="next-items">' + items.map(i => {
      const t = i.remaining <= 0 ? 'NOW!' : fmt(i.remaining);
      const l = i.location ? i.location.charAt(0).toUpperCase() + i.location.slice(1) : '-';
      return `<div class="next-item" data-dc="${i.dc}">
        <span class="ni-dot"></span>
        <span>${i.dc.toUpperCase()}</span>
        <span class="ni-time">${t}</span>
        <span class="ni-loc">${l}</span>
      </div>`;
    }).join('') + '</div>';
  }

  function renderHistory() {
    if (state.history.length === 0) {
      historyList.innerHTML = '<p class="muted">No spawns recorded yet</p>';
      return;
    }
    historyList.innerHTML = state.history.slice(0, 30).map(e => {
      let icon = '🏺';
      if (e.type === 'fresh') icon = '🆕';
      else if (e.type === 'manual') icon = '✏️';
      return `<div class="h-entry" data-dc="${e.dc}">
        <span class="h-dot"></span>
        <span class="h-dc">${e.dc.toUpperCase()}</span>
        <span class="h-loc">${e.location || '-'}</span>
        <span>${icon}</span>
        <span class="h-time">${e.time}</span>
      </div>`;
    }).join('');
  }

  // Notifications
  const notified = new Set();
  function tick() {
    DCS.forEach(dc => {
      updateCard(dc);
      if (state[dc].targetTime) {
        const rem = (state[dc].targetTime - Date.now()) / 1000;
        const key = `${dc}_${state[dc].targetTime}`;
        if (rem <= 1 && rem > -2 && !notified.has(key)) {
          notified.add(key);
          chime();
          notify(dc, state[dc].location);
          toast(`${dc.toUpperCase()} pot is spawning!`);
        }
        const wk = `${key}_w`;
        if (rem <= WARNING_THRESHOLD && rem > WARNING_THRESHOLD - 2 && !notified.has(wk)) {
          notified.add(wk);
          toast(`${dc.toUpperCase()} - 5 min until spawn!`);
        }
      }
    });
    updateNextUp();
    requestAnimationFrame(tick);
  }

  // Editor toggle
  function openEditor(dc) {
    DCS.forEach(d => {
      el[d].editor.classList.add('hidden');
      el[d].picker.classList.add('hidden');
      el[d].actions.classList.remove('hidden');
    });
    pendingSpawn = null;
    editorLoc[dc] = state[dc].location || null;

    // Pre-fill
    if (state[dc].targetTime) {
      const rem = Math.max(0, (state[dc].targetTime - Date.now()) / 1000);
      el[dc].editMin.value = Math.floor(rem / 60);
      el[dc].editSec.value = Math.floor(rem % 60);
    } else {
      el[dc].editMin.value = 30;
      el[dc].editSec.value = 0;
    }
    el[dc].editAgo.value = '';
    updateEditorLocBtns(dc);

    el[dc].actions.classList.add('hidden');
    el[dc].editor.classList.remove('hidden');
  }

  function updateEditorLocBtns(dc) {
    el[dc].edLocN.classList.toggle('selected', editorLoc[dc] === 'north');
    el[dc].edLocS.classList.toggle('selected', editorLoc[dc] === 'south');
  }

  // Events
  function bind() {
    DCS.forEach(dc => {
      const e = el[dc];

      e.spawnBtn.addEventListener('click', () => beginSpawn(dc, SPAWN_INTERVAL));
      e.freshBtn.addEventListener('click', () => beginSpawn(dc, FRESH_INTERVAL));
      e.pickNorth.addEventListener('click', () => confirmSpawn(dc, 'north'));
      e.pickSouth.addEventListener('click', () => confirmSpawn(dc, 'south'));
      e.resetBtn.addEventListener('click', () => resetTimer(dc));
      e.editBtn.addEventListener('click', () => openEditor(dc));
      e.applyBtn.addEventListener('click', () => applyManualTimer(dc));
      e.cancelBtn.addEventListener('click', () => {
        e.editor.classList.add('hidden');
        e.actions.classList.remove('hidden');
      });

      // Mutual exclusion for editor inputs
      e.editMin.addEventListener('input', () => { e.editAgo.value = ''; });
      e.editSec.addEventListener('input', () => { e.editAgo.value = ''; });
      e.editAgo.addEventListener('input', () => { e.editMin.value = ''; e.editSec.value = ''; });

      // Editor location buttons
      e.edLocN.addEventListener('click', () => {
        editorLoc[dc] = editorLoc[dc] === 'north' ? null : 'north';
        updateEditorLocBtns(dc);
      });
      e.edLocS.addEventListener('click', () => {
        editorLoc[dc] = editorLoc[dc] === 'south' ? null : 'south';
        updateEditorLocBtns(dc);
      });
    });

    clearHistBtn.addEventListener('click', () => {
      state.history = [];
      save();
      renderHistory();
      toast('History cleared');
    });

    mapToggle.addEventListener('click', () => {
      const open = !mapContent.classList.contains('hidden');
      mapContent.classList.toggle('hidden');
      mapIcon.textContent = open ? '▶' : '▼';
    });

    document.addEventListener('click', reqNotifPerm, { once: true });
  }

  // Init
  function init() {
    load();
    bind();
    DCS.forEach(dc => updateCard(dc));
    renderHistory();
    updateNextUp();
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

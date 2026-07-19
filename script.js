/* ===========================================================
   Occult Crescent Pot Tracker - Application Logic
   =========================================================== */

(() => {
  'use strict';

  // -- Constants --
  const SPAWN_INTERVAL = 30 * 60;     // pot respawns 30 min after last spawn
  const FRESH_INTERVAL = 10 * 60;     // fresh instance: first pot 10 min after open
  const WARNING_THRESHOLD = 5 * 60;   // heads-up 5 min before spawn
  const LATE_NOTIFY_GRACE = 5 * 60;   // still alert up to 5 min past spawn (hidden tab)
  const RING_R = 88;
  const RING_C = 2 * Math.PI * RING_R;
  const STORAGE_KEY = 'potTracker_v4';
  const LEGACY_STORAGE_KEY = 'potTracker_v3';
  const BASE_TITLE = document.title;

  const DC_LIST = [
    { id: 'chaos', name: 'Chaos' },
    { id: 'oce', name: 'OCE' },
    { id: 'light', name: 'Light' },
  ];
  const DCS = DC_LIST.map((d) => d.id);

  // -- State --
  // nextLocation = where the UPCOMING pot will spawn. Spawns alternate
  // sides, so logging a spawn at north predicts the next one at south.
  const state = {
    chaos: { targetTime: null, nextLocation: null, totalDuration: null },
    oce:   { targetTime: null, nextLocation: null, totalDuration: null },
    light: { targetTime: null, nextLocation: null, totalDuration: null },
    history: [],
  };

  const opposite = (loc) => (loc === 'north' ? 'south' : loc === 'south' ? 'north' : null);

  let pendingSpawn = null;   // dc id awaiting a location pick, or null
  const editorLoc = {};      // location selected inside each editor

  // -- Card generation (one template for all DCs keeps them identical) --
  function cardHTML(dc, name) {
    const c = RING_C.toFixed(1);
    return `
    <article class="dc-card" data-dc="${dc}" id="card-${dc}">
      <div class="card-glow" aria-hidden="true"></div>
      <div class="card-header">
        <span class="dc-indicator" aria-hidden="true"></span>
        <h2 class="dc-name">${name}</h2>
        <span class="dc-status" id="status-${dc}">Idle</span>
      </div>

      <div class="timer-ring-wrap">
        <svg class="timer-ring" viewBox="0 0 200 200" aria-hidden="true">
          <circle class="timer-ring-bg" cx="100" cy="100" r="${RING_R}" />
          <circle class="timer-ring-progress" id="ring-${dc}" cx="100" cy="100" r="${RING_R}"
            stroke-dasharray="${c}" stroke-dashoffset="${c}" />
        </svg>
        <div class="timer-display">
          <span class="timer-value" id="timer-${dc}">--:--</span>
          <span class="timer-label" id="label-${dc}">No active timer</span>
          <span class="timer-loc" id="loc-display-${dc}"></span>
        </div>
      </div>

      <div class="card-actions" id="actions-${dc}">
        <button class="btn btn-spawn" id="spawn-${dc}">
          <span class="btn-pulse" aria-hidden="true"></span>
          ✦ Pot Spawned!
        </button>
        <div class="secondary-actions">
          <button class="btn btn-ghost" id="fresh-${dc}" title="Fresh instance - first pot in 10 minutes">Fresh (10m)</button>
          <button class="btn btn-ghost" id="edit-${dc}">Edit</button>
          <button class="btn btn-ghost btn-danger-ghost" id="reset-${dc}">Reset</button>
        </div>
      </div>

      <div class="loc-picker hidden" id="picker-${dc}">
        <div class="picker-prompt">Where did it spawn?</div>
        <div class="picker-buttons">
          <button class="btn btn-loc" id="pick-${dc}-north"><span class="loc-arrow" aria-hidden="true">↑</span> North</button>
          <button class="btn btn-loc" id="pick-${dc}-south"><span class="loc-arrow" aria-hidden="true">↓</span> South</button>
        </div>
        <button class="btn btn-ghost picker-cancel" id="pick-${dc}-cancel">Cancel</button>
      </div>

      <div class="editor hidden" id="editor-${dc}">
        <div class="editor-title">Set Timer</div>
        <div class="editor-row">
          <label for="edit-min-${dc}">Minutes left</label>
          <input type="number" id="edit-min-${dc}" min="0" max="30" value="30" />
        </div>
        <div class="editor-row">
          <label for="edit-sec-${dc}">Seconds left</label>
          <input type="number" id="edit-sec-${dc}" min="0" max="59" value="0" />
        </div>
        <div class="editor-row">
          <label for="edit-ago-${dc}">Or spawned X min ago</label>
          <input type="number" id="edit-ago-${dc}" min="0" max="30" placeholder="e.g. 12" />
        </div>
        <div class="editor-row">
          <label>Next spawn at</label>
          <div class="editor-loc-btns">
            <button class="btn btn-ghost" id="editor-loc-${dc}-north">North</button>
            <button class="btn btn-ghost" id="editor-loc-${dc}-south">South</button>
          </div>
        </div>
        <div class="editor-actions">
          <button class="btn btn-apply" id="apply-${dc}">Apply</button>
          <button class="btn btn-ghost" id="cancel-${dc}">Cancel</button>
        </div>
      </div>
    </article>`;
  }

  document.getElementById('dcGrid').innerHTML =
    DC_LIST.map((d) => cardHTML(d.id, d.name)).join('');

  // -- DOM references --
  const els = {};
  DCS.forEach((dc) => {
    els[dc] = {
      card:      document.getElementById(`card-${dc}`),
      timer:     document.getElementById(`timer-${dc}`),
      label:     document.getElementById(`label-${dc}`),
      status:    document.getElementById(`status-${dc}`),
      ring:      document.getElementById(`ring-${dc}`),
      locDisp:   document.getElementById(`loc-display-${dc}`),
      actions:   document.getElementById(`actions-${dc}`),
      spawnBtn:  document.getElementById(`spawn-${dc}`),
      freshBtn:  document.getElementById(`fresh-${dc}`),
      editBtn:   document.getElementById(`edit-${dc}`),
      resetBtn:  document.getElementById(`reset-${dc}`),
      picker:    document.getElementById(`picker-${dc}`),
      pickNorth: document.getElementById(`pick-${dc}-north`),
      pickSouth: document.getElementById(`pick-${dc}-south`),
      pickCancel:document.getElementById(`pick-${dc}-cancel`),
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
  const mapImage      = document.getElementById('mapImage');
  const lightbox      = document.getElementById('lightbox');
  const lightboxClose = document.getElementById('lightboxClose');

  // -- Persistence --
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* quota */ }
  }

  function load() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      let legacy = false;
      if (!raw) {
        // v3 stored the LAST spawn point; the predicted next one is its opposite
        raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        legacy = true;
      }
      if (!raw) return;
      const s = JSON.parse(raw);
      DCS.forEach((dc) => {
        if (s[dc]) {
          state[dc].targetTime = s[dc].targetTime || null;
          state[dc].nextLocation = legacy ? opposite(s[dc].location) : (s[dc].nextLocation || null);
          state[dc].totalDuration = s[dc].totalDuration || null;
        }
      });
      if (Array.isArray(s.history)) state.history = s.history;
      if (legacy) {
        save();
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch (_) { /* corrupted */ }
  }

  // -- Audio chime --
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.15].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = i === 0 ? 880 : 1100; // A5, C#6
        gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.8);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.8);
      });
    } catch (_) { /* no audio */ }
  }

  // -- Browser notification --
  function notify(dc, loc) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const l = loc ? ` (${loc.toUpperCase()})` : '';
      new Notification(`🏺 Pot Spawning - ${dc.toUpperCase()}${l}`, {
        body: 'The Pot of Plenty FATE should be spawning!',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏺</text></svg>',
      });
    }
  }

  function reqNotifPerm() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // -- Toast --
  function toast(msg, dc) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    if (dc) t.dataset.dc = dc;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, 4000);
  }

  // -- Formatting --
  function fmt(seconds) {
    if (seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  // -- Panel exclusivity: only one picker/editor open at a time --
  function closeOverlays() {
    DCS.forEach((d) => {
      els[d].picker.classList.add('hidden');
      els[d].editor.classList.add('hidden');
      els[d].actions.classList.remove('hidden');
    });
    pendingSpawn = null;
  }

  // -- Timer core --
  // spawnedAt = where the pot just appeared; the next one spawns opposite
  function startTimer(dc, duration, spawnedAt, type) {
    const now = Date.now();
    state[dc].targetTime = now + duration * 1000;
    state[dc].totalDuration = duration;
    state[dc].nextLocation = opposite(spawnedAt);

    state.history.unshift({
      dc,
      location: spawnedAt || null,
      time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type,
    });
    if (state.history.length > 50) state.history.length = 50;

    save();
    updateCard(dc);
    renderHistory();
    updateNextUp();
  }

  function resetTimer(dc) {
    state[dc].targetTime = null;
    state[dc].totalDuration = null;
    state[dc].nextLocation = null;
    save();
    updateCard(dc);
    updateNextUp();
    toast(`${dc.toUpperCase()} timer reset`, dc);
  }

  // -- Spawn flow --
  // "Pot Spawned!" → ask where it spawned, then start the 30 min timer.
  function beginSpawn(dc) {
    closeOverlays();
    pendingSpawn = dc;
    els[dc].actions.classList.add('hidden');
    els[dc].picker.classList.remove('hidden');
  }

  function confirmSpawn(dc, location) {
    if (pendingSpawn !== dc) return;
    closeOverlays();
    startTimer(dc, SPAWN_INTERVAL, location, 'spawn');
    toast(`${cap(location)} spawn logged for ${dc.toUpperCase()}, next pot in 30m at ${cap(opposite(location))}`, dc);
  }

  // Fresh instance: the pot hasn't spawned yet, so there is no location to ask for.
  function freshInstance(dc) {
    closeOverlays();
    startTimer(dc, FRESH_INTERVAL, null, 'fresh');
    toast(`Fresh instance - first pot on ${dc.toUpperCase()} in 10m`, dc);
  }

  // -- Manual editor --
  function openEditor(dc) {
    closeOverlays();
    editorLoc[dc] = state[dc].nextLocation || null;

    if (state[dc].targetTime) {
      const rem = Math.max(0, (state[dc].targetTime - Date.now()) / 1000);
      els[dc].editMin.value = Math.floor(rem / 60);
      els[dc].editSec.value = Math.floor(rem % 60);
    } else {
      els[dc].editMin.value = 30;
      els[dc].editSec.value = 0;
    }
    els[dc].editAgo.value = '';
    updateEditorLocBtns(dc);

    els[dc].actions.classList.add('hidden');
    els[dc].editor.classList.remove('hidden');
  }

  function updateEditorLocBtns(dc) {
    els[dc].edLocN.classList.toggle('selected', editorLoc[dc] === 'north');
    els[dc].edLocS.classList.toggle('selected', editorLoc[dc] === 'south');
  }

  function applyManualTimer(dc) {
    const agoVal = parseInt(els[dc].editAgo.value, 10);
    let remaining;
    if (!isNaN(agoVal) && agoVal >= 0) {
      // Retroactive: pot spawned X minutes ago → remaining = 30 - X minutes
      remaining = Math.max(0, SPAWN_INTERVAL - agoVal * 60);
    } else {
      const mins = parseInt(els[dc].editMin.value, 10) || 0;
      const secs = parseInt(els[dc].editSec.value, 10) || 0;
      remaining = Math.max(0, Math.min(SPAWN_INTERVAL, mins * 60 + secs));
    }

    const now = Date.now();
    state[dc].targetTime = now + remaining * 1000;
    state[dc].totalDuration = SPAWN_INTERVAL;
    // The editor picks where the UPCOMING pot spawns (no observed spawn to log)
    state[dc].nextLocation = editorLoc[dc] || null;

    state.history.unshift({
      dc,
      location: null,
      time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'manual',
    });
    if (state.history.length > 50) state.history.length = 50;

    save();
    closeOverlays();
    updateCard(dc);
    renderHistory();
    updateNextUp();
    toast(`Timer set for ${dc.toUpperCase()}`, dc);
  }

  // -- UI updates --
  function updateCard(dc) {
    const d = state[dc];
    const e = els[dc];

    e.locDisp.textContent = d.nextLocation ? `Next: ${cap(d.nextLocation)}` : '';

    if (!d.targetTime) {
      e.card.classList.remove('active', 'spawning');
      e.timer.textContent = '--:--';
      e.label.textContent = 'No active timer';
      e.status.textContent = 'Idle';
      e.status.className = 'dc-status';
      e.ring.style.strokeDashoffset = RING_C; // empty ring
      return;
    }

    const remaining = Math.max(0, (d.targetTime - Date.now()) / 1000);
    const total = d.totalDuration || SPAWN_INTERVAL;
    e.ring.style.strokeDashoffset = RING_C * (1 - remaining / total);

    if (remaining <= 0) {
      e.card.classList.remove('active');
      e.card.classList.add('spawning');
      e.timer.textContent = 'NOW!';
      e.label.textContent = 'Pot should be spawning!';
      e.status.textContent = 'Spawning';
      e.status.className = 'dc-status spawning';
      e.ring.style.strokeDashoffset = 0;
    } else if (remaining <= WARNING_THRESHOLD) {
      e.card.classList.add('active');
      e.card.classList.remove('spawning');
      e.timer.textContent = fmt(remaining);
      e.label.textContent = 'Spawning soon!';
      e.status.textContent = 'Soon';
      e.status.className = 'dc-status warning';
    } else {
      e.card.classList.add('active');
      e.card.classList.remove('spawning');
      e.timer.textContent = fmt(remaining);
      e.label.textContent = total === FRESH_INTERVAL ? 'First pot in' : 'Next spawn in';
      e.status.textContent = 'Counting';
      e.status.className = 'dc-status counting';
    }
  }

  function updateNextUp() {
    const items = DCS
      .filter((dc) => state[dc].targetTime)
      .map((dc) => ({
        dc,
        remaining: Math.max(0, (state[dc].targetTime - Date.now()) / 1000),
        location: state[dc].nextLocation,
      }))
      .sort((a, b) => a.remaining - b.remaining);

    if (items.length === 0) {
      nextUpContent.innerHTML = '<p class="muted">No active timers - hit "Pot Spawned!" when a FATE pops</p>';
      return;
    }

    nextUpContent.innerHTML = items.map((item, idx) => {
      const t = item.remaining <= 0 ? 'NOW!' : fmt(item.remaining);
      const l = item.location ? cap(item.location) : '-';
      const hop = idx === 0 ? '<span class="ni-hop">← hop here</span>' : '';
      return `<div class="next-item${idx === 0 ? ' soonest' : ''}" data-dc="${item.dc}">
        <span class="ni-dot"></span>
        <span class="ni-dc">${item.dc.toUpperCase()}</span>
        <span class="ni-time">${t}</span>
        <span class="ni-loc">${l}</span>
        ${hop}
      </div>`;
    }).join('');
  }

  function renderHistory() {
    if (state.history.length === 0) {
      historyList.innerHTML = '<p class="muted">No spawns recorded yet</p>';
      return;
    }
    historyList.innerHTML = state.history.slice(0, 30).map((entry) => {
      const type = entry.type === 'fresh' ? 'fresh' : entry.type === 'manual' ? 'manual' : 'spawn';
      return `<div class="h-entry" data-dc="${entry.dc}">
        <span class="h-dot"></span>
        <span class="h-dc">${entry.dc.toUpperCase()}</span>
        <span class="h-loc">${entry.location && entry.location !== '-' ? entry.location : '-'}</span>
        <span class="h-type ${type}">${type}</span>
        <span class="h-time">${entry.time}</span>
      </div>`;
    }).join('');
  }

  // Tab title shows the soonest countdown so the tracker works from another tab
  function updateTitle() {
    const soonest = DCS
      .filter((dc) => state[dc].targetTime)
      .map((dc) => ({ dc, remaining: (state[dc].targetTime - Date.now()) / 1000 }))
      .sort((a, b) => a.remaining - b.remaining)[0];

    if (!soonest) {
      if (document.title !== BASE_TITLE) document.title = BASE_TITLE;
      return;
    }
    document.title = soonest.remaining <= 0
      ? `🏺 NOW! ${soonest.dc.toUpperCase()} - Pot Tracker`
      : `${fmt(soonest.remaining)} ${soonest.dc.toUpperCase()} - Pot Tracker`;
  }

  // -- Alert tracking --
  const notified = new Set();

  // Don't re-fire alerts for thresholds that were already passed before page load
  function seedNotified() {
    DCS.forEach((dc) => {
      if (!state[dc].targetTime) return;
      const rem = (state[dc].targetTime - Date.now()) / 1000;
      const key = `${dc}_${state[dc].targetTime}`;
      if (rem <= 0) notified.add(key);
      if (rem <= WARNING_THRESHOLD) notified.add(`${key}_warn`);
    });
  }

  // -- Main loop --
  // setInterval (not requestAnimationFrame) so alerts still fire when the
  // tab is in the background; rAF is fully paused in hidden tabs.
  function tick() {
    DCS.forEach((dc) => {
      updateCard(dc);
      if (!state[dc].targetTime) return;

      const rem = (state[dc].targetTime - Date.now()) / 1000;
      const key = `${dc}_${state[dc].targetTime}`;

      // Spawn alert - also fires late (within grace) if the tab was asleep
      if (rem <= 0 && rem > -LATE_NOTIFY_GRACE && !notified.has(key)) {
        notified.add(key);
        chime();
        notify(dc, state[dc].nextLocation);
        toast(`🏺 ${dc.toUpperCase()} pot is spawning!`, dc);
      }

      // 5-minute warning
      const warnKey = `${key}_warn`;
      if (rem <= WARNING_THRESHOLD && rem > 0 && !notified.has(warnKey)) {
        notified.add(warnKey);
        toast(`⚠ ${dc.toUpperCase()} - 5 minutes until spawn!`, dc);
      }
    });
    updateNextUp();
    updateTitle();
  }

  // -- Background particles --
  function createParticles() {
    const container = document.getElementById('bgParticles');
    const colors = [
      'rgba(168, 85, 247, 0.3)',
      'rgba(34, 211, 238, 0.25)',
      'rgba(245, 197, 66, 0.2)',
      'rgba(192, 132, 252, 0.2)',
    ];
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const size = Math.random() * 3 + 1;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDuration = `${Math.random() * 15 + 10}s`;
      p.style.animationDelay = `${Math.random() * 15}s`;
      container.appendChild(p);
    }
  }

  // -- Map & lightbox --
  function bindMap() {
    mapToggle.addEventListener('click', () => {
      const open = mapContent.classList.toggle('open');
      mapIcon.textContent = open ? '▼' : '▶';
      mapToggle.setAttribute('aria-expanded', String(open));
    });

    mapImage.addEventListener('click', () => lightbox.classList.remove('hidden'));
    lightboxClose.addEventListener('click', () => lightbox.classList.add('hidden'));
    lightbox.querySelector('.lightbox-img').addEventListener('click', () => lightbox.classList.add('hidden'));
  }

  // -- Event bindings --
  function bind() {
    DCS.forEach((dc) => {
      const e = els[dc];

      e.spawnBtn.addEventListener('click', () => beginSpawn(dc));
      e.freshBtn.addEventListener('click', () => freshInstance(dc));
      e.pickNorth.addEventListener('click', () => confirmSpawn(dc, 'north'));
      e.pickSouth.addEventListener('click', () => confirmSpawn(dc, 'south'));
      e.pickCancel.addEventListener('click', closeOverlays);
      e.resetBtn.addEventListener('click', () => resetTimer(dc));
      e.editBtn.addEventListener('click', () => openEditor(dc));
      e.applyBtn.addEventListener('click', () => applyManualTimer(dc));
      e.cancelBtn.addEventListener('click', closeOverlays);

      // min/sec and "ago" inputs are mutually exclusive
      e.editMin.addEventListener('input', () => { e.editAgo.value = ''; });
      e.editSec.addEventListener('input', () => { e.editAgo.value = ''; });
      e.editAgo.addEventListener('input', () => { e.editMin.value = ''; e.editSec.value = ''; });

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

    bindMap();

    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if (!lightbox.classList.contains('hidden')) lightbox.classList.add('hidden');
      else closeOverlays();
    });

    // Catch up immediately when the tab becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) tick();
    });

    document.addEventListener('click', reqNotifPerm, { once: true });
  }

  // -- Init --
  function init() {
    load();
    seedNotified();
    createParticles();
    bind();
    DCS.forEach(updateCard);
    renderHistory();
    updateNextUp();
    updateTitle();
    setInterval(tick, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

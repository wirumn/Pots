/* ═══════════════════════════════════════════════════════════
   Occult Crescent Pot Tracker — Application Logic
   ═══════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── Constants ──
  const SPAWN_INTERVAL = 30 * 60; // 30 minutes in seconds
  const FRESH_INTERVAL = 10 * 60; // 10 minutes in seconds
  const RING_CIRCUMFERENCE = 2 * Math.PI * 88; // ~553
  const WARNING_THRESHOLD = 5 * 60; // 5 minutes warning
  const DCS = ['chaos', 'oce', 'light'];
  const STORAGE_KEY = 'potTracker_v2';

  // ── State ──
  let state = {
    chaos: { targetTime: null, location: null, totalDuration: null },
    oce: { targetTime: null, location: null, totalDuration: null },
    light: { targetTime: null, location: null, totalDuration: null },
    history: [],
  };

  // ── DOM References ──
  const els = {};
  DCS.forEach((dc) => {
    els[dc] = {
      card: document.getElementById(`card-${dc}`),
      timer: document.getElementById(`timer-${dc}`),
      label: document.getElementById(`label-${dc}`),
      status: document.getElementById(`status-${dc}`),
      ring: document.getElementById(`ring-${dc}`),
      spawnBtn: document.getElementById(`spawn-${dc}`),
      freshBtn: document.getElementById(`fresh-${dc}`),
      resetBtn: document.getElementById(`reset-${dc}`),
      locNorth: document.getElementById(`loc-${dc}-north`),
      locSouth: document.getElementById(`loc-${dc}-south`),
    };
  });
  const nextUpContent = document.getElementById('nextUpContent');
  const historyList = document.getElementById('historyList');
  const clearHistoryBtn = document.getElementById('clearHistory');

  // ── Persistence ──
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* quota exceeded, ignore */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        DCS.forEach((dc) => {
          if (saved[dc]) {
            state[dc].targetTime = saved[dc].targetTime || null;
            state[dc].location = saved[dc].location || null;
            state[dc].totalDuration = saved[dc].totalDuration || null;
          }
        });
        if (Array.isArray(saved.history)) {
          state.history = saved.history;
        }
      }
    } catch (_) { /* corrupted, ignore */ }
  }

  // ── Audio Notification ──
  function playNotificationSound() {
    // Generate a pleasant chime using Web Audio API
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();

      // Two-note chime
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
    } catch (_) { /* no audio support */ }
  }

  // ── Browser Notification ──
  function sendBrowserNotification(dc, location) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const locStr = location ? ` (${location.toUpperCase()})` : '';
      new Notification(`🏺 Pot Spawning — ${dc.toUpperCase()}${locStr}`, {
        body: 'The next Pot of Plenty FATE should be spawning soon!',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏺</text></svg>',
      });
    }
  }

  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ── Toast Notification ──
  function showToast(message, dc) {
    // Remove any existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (dc) toast.dataset.dc = dc;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  // ── Timer Logic ──
  function startTimer(dc, durationSeconds) {
    const now = Date.now();
    state[dc].targetTime = now + durationSeconds * 1000;
    state[dc].totalDuration = durationSeconds;

    // Log to history
    const locStr = state[dc].location || '—';
    state.history.unshift({
      dc,
      location: locStr,
      time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: durationSeconds === FRESH_INTERVAL ? 'fresh' : 'spawn',
    });

    // Keep history reasonable
    if (state.history.length > 50) state.history.length = 50;

    saveState();
    updateCard(dc);
    renderHistory();
    updateNextUp();

    const typeLabel = durationSeconds === FRESH_INTERVAL ? 'Fresh instance' : 'Spawn';
    showToast(`${typeLabel} timer started for ${dc.toUpperCase()}`, dc);
  }

  function resetTimer(dc) {
    state[dc].targetTime = null;
    state[dc].totalDuration = null;
    saveState();
    updateCard(dc);
    updateNextUp();
  }

  function setLocation(dc, loc) {
    // Toggle if clicking same location
    if (state[dc].location === loc) {
      state[dc].location = null;
    } else {
      state[dc].location = loc;
    }
    saveState();
    updateLocationButtons(dc);
    updateNextUp();
  }

  // ── UI Updates ──
  function formatTime(seconds) {
    if (seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updateCard(dc) {
    const el = els[dc];
    const data = state[dc];
    const card = el.card;

    if (!data.targetTime) {
      // Idle state
      card.classList.remove('active', 'spawning');
      el.timer.textContent = '--:--';
      el.label.textContent = 'No active timer';
      el.status.textContent = 'Idle';
      el.status.className = 'dc-status';
      el.ring.style.strokeDashoffset = RING_CIRCUMFERENCE; // empty ring
      return;
    }

    const now = Date.now();
    const remaining = Math.max(0, (data.targetTime - now) / 1000);
    const total = data.totalDuration || SPAWN_INTERVAL;
    const progress = remaining / total;

    el.timer.textContent = formatTime(remaining);
    el.ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);

    if (remaining <= 0) {
      // Timer expired — spawning!
      card.classList.remove('active');
      card.classList.add('spawning');
      el.timer.textContent = 'NOW!';
      el.label.textContent = 'Pot should be spawning!';
      el.status.textContent = 'Spawning';
      el.status.className = 'dc-status spawning';
      el.ring.style.strokeDashoffset = 0;
    } else if (remaining <= WARNING_THRESHOLD) {
      // Warning — close to spawn
      card.classList.add('active');
      card.classList.remove('spawning');
      el.label.textContent = 'Spawning soon!';
      el.status.textContent = 'Soon';
      el.status.className = 'dc-status warning';
    } else {
      // Counting down
      card.classList.add('active');
      card.classList.remove('spawning');
      el.label.textContent = `Next spawn in`;
      el.status.textContent = 'Counting';
      el.status.className = 'dc-status counting';
    }
  }

  function updateLocationButtons(dc) {
    const el = els[dc];
    const loc = state[dc].location;

    el.locNorth.classList.toggle('selected', loc === 'north');
    el.locSouth.classList.toggle('selected', loc === 'south');
  }

  function updateNextUp() {
    const items = [];

    DCS.forEach((dc) => {
      if (!state[dc].targetTime) return;
      const remaining = Math.max(0, (state[dc].targetTime - Date.now()) / 1000);
      items.push({
        dc,
        remaining,
        location: state[dc].location,
      });
    });

    if (items.length === 0) {
      nextUpContent.innerHTML = '<p class="next-up-empty">No active timers — click "Pot Spawned!" when a FATE pops</p>';
      return;
    }

    // Sort by soonest
    items.sort((a, b) => a.remaining - b.remaining);

    nextUpContent.innerHTML = items
      .map((item) => {
        const timeStr = item.remaining <= 0 ? 'NOW!' : formatTime(item.remaining);
        const locStr = item.location ? item.location.charAt(0).toUpperCase() + item.location.slice(1) : '—';
        return `
          <div class="next-up-item" data-dc="${item.dc}">
            <span class="dc-dot"></span>
            <span class="next-dc">${item.dc.toUpperCase()}</span>
            <span class="next-time">${timeStr}</span>
            <span class="next-loc">${locStr}</span>
          </div>
        `;
      })
      .join('');
  }

  function renderHistory() {
    if (state.history.length === 0) {
      historyList.innerHTML = '<p class="history-empty">No spawns recorded yet</p>';
      return;
    }

    historyList.innerHTML = state.history
      .slice(0, 30)
      .map((entry) => {
        const typeIcon = entry.type === 'fresh' ? '🆕' : '🏺';
        return `
          <div class="history-entry" data-dc="${entry.dc}">
            <span class="h-dot"></span>
            <span class="h-dc">${entry.dc.toUpperCase()}</span>
            <span class="h-loc">${entry.location}</span>
            <span>${typeIcon}</span>
            <span class="h-time">${entry.time}</span>
          </div>
        `;
      })
      .join('');
  }

  // ── Notification Tracking ──
  // Track which timers we've already notified for so we don't spam
  const notifiedTimers = new Set();

  // ── Main Tick Loop ──
  let lastWarningState = {};
  function tick() {
    DCS.forEach((dc) => {
      updateCard(dc);

      // Check if we need to send a notification
      if (state[dc].targetTime) {
        const remaining = (state[dc].targetTime - Date.now()) / 1000;
        const timerKey = `${dc}_${state[dc].targetTime}`;

        // Notify when timer hits zero (within 1 second tolerance)
        if (remaining <= 1 && remaining > -2 && !notifiedTimers.has(timerKey)) {
          notifiedTimers.add(timerKey);
          playNotificationSound();
          sendBrowserNotification(dc, state[dc].location);
          showToast(`🏺 ${dc.toUpperCase()} pot is spawning!`, dc);
        }

        // Notify at 5 min warning
        const warningKey = `${timerKey}_warn`;
        if (remaining <= WARNING_THRESHOLD && remaining > WARNING_THRESHOLD - 2 && !notifiedTimers.has(warningKey)) {
          notifiedTimers.add(warningKey);
          showToast(`⚠ ${dc.toUpperCase()} — 5 minutes until spawn!`, dc);
        }
      }
    });

    updateNextUp();
    requestAnimationFrame(tick);
  }

  // ── Background Particles ──
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

  // ── Event Bindings ──
  function bindEvents() {
    DCS.forEach((dc) => {
      const el = els[dc];

      // Spawn button — 30 min timer
      el.spawnBtn.addEventListener('click', () => {
        startTimer(dc, SPAWN_INTERVAL);
      });

      // Fresh instance button — 10 min timer
      el.freshBtn.addEventListener('click', () => {
        startTimer(dc, FRESH_INTERVAL);
      });

      // Reset button
      el.resetBtn.addEventListener('click', () => {
        resetTimer(dc);
        showToast(`${dc.toUpperCase()} timer reset`, dc);
      });

      // Location buttons
      el.locNorth.addEventListener('click', () => setLocation(dc, 'north'));
      el.locSouth.addEventListener('click', () => setLocation(dc, 'south'));
    });

    // Clear history
    clearHistoryBtn.addEventListener('click', () => {
      state.history = [];
      saveState();
      renderHistory();
      showToast('History cleared');
    });

    // Request notification permission on first interaction
    document.addEventListener('click', requestNotificationPermission, { once: true });
  }

  // ── Init ──
  function init() {
    loadState();
    createParticles();
    bindEvents();

    // Restore UI from state
    DCS.forEach((dc) => {
      updateLocationButtons(dc);
      updateCard(dc);
    });
    renderHistory();
    updateNextUp();

    // Start the main loop
    tick();
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

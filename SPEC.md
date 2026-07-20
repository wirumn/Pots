# Pot Tracker - Product Specification

A focused, single-page tracker for the **Pot of Plenty FATE** in FFXIV's Occult Crescent (South Horn). It tracks independent respawn cycles across Chaos, OCE, and Light, predicts the next North/South spawn, and keeps a daily tally of opened coffers.

The app has no backend, no build step, and no JavaScript dependencies. All user data stays in browser `localStorage`.

## Product rule

There is one primary timer action: **Pot spawned**.

- When a pot is observed, the player clicks **Pot spawned**, selects North or South, and the app starts the **30-minute respawn countdown**.
- A fresh instance's first pot appears about **10 minutes after the instance opens**, but this is game guidance - not a timer mode. The app displays this rule as an informational note and does not provide a Fresh button.
- The app does not attempt to detect when an instance opened. Until a pot is actually observed, that data center remains idle.
- Spawns alternate between North and South. Logging a North spawn predicts South next; logging South predicts North next.

This distinction is intentional: the tracker records known spawn events, not estimated instance-open times.

## Tech stack

- Plain HTML, CSS, and vanilla JavaScript (ES6, one IIFE in `script.js`)
- No framework, bundler, package manager, or external JavaScript
- Google Fonts are the only remote dependency
- Any static host or `python3 -m http.server` can serve the project

## Files

| File | Purpose |
|---|---|
| `index.html` | Semantic page structure, tracker panels, map lightbox |
| `script.js` | Timer, persistence, alerts, history, and tally logic |
| `style.css` | Responsive visual system and component states |
| `South_Horn_Pot_Coffers_Color_Coded.jpg` | Pot coffer reference map |

Repeated data-center cards and tally controls are generated from JavaScript templates rather than duplicated in HTML.

## Main experience

### Route overview

The first panel answers "Where should I go next?"

- Active data centers are ordered by soonest spawn
- The first item is labeled **Go here next**
- Each item shows data center, countdown, and predicted side
- An empty state explains how to start tracking
- A permanent note explains the fresh-instance 10-minute rule without creating a countdown

### Data-center timers

Three independent cards represent Chaos, OCE, and Light. Each card shows:

- Idle, Counting, Soon, or Spawning status
- Circular countdown and expected local clock time
- Predicted next North/South location
- **Pot spawned** as the primary action
- **Adjust timer** and **Reset** as correction tools

Clicking **Pot spawned** asks where the pot appeared. Confirming North or South:

1. starts a 30-minute timer;
2. records the observed spawn in history; and
3. predicts the opposite side for the next spawn.

Only one location picker or timer editor can be open at a time. Escape closes the active overlay.

### Manual adjustment

The inline editor can set:

- minutes and seconds remaining, clamped to 30 minutes; or
- how many minutes ago the pot spawned, converted to the remaining time in the 30-minute cycle.

The user can also set or clear the predicted upcoming side. A manual change is recorded as a `manual` history event.

### Daily pot log

Bronze, Silver, and Gold controls add one coffer to the local day's count. A compact `-1` control undoes mistakes without allowing negative values.

The panel includes:

- today's local date and total;
- per-rarity counts;
- a newest-first daily history table; and
- CSV export using `date,bronze,silver,gold,total` columns.

Days use the local `YYYY-MM-DD` date. The interface rolls over automatically when midnight passes while the tab remains open.

### Map and history

- The coffer map expands inline and opens at full resolution in a lightbox.
- Spawn history is reverse chronological, renders the latest 30 entries, and stores up to 50.
- Legacy `fresh` entries may still appear for users who used an older version, but no new fresh entries are created.

## Timer and alert behavior

- Respawn interval: `30 * 60` seconds
- Warning threshold: 5 minutes remaining
- Late notification grace: 5 minutes after zero
- Tick interval: 500 ms using `setInterval`
- A 5-minute toast fires once per timer
- At zero, the app fires a toast, two-note audio chime, and desktop notification when allowed
- Reloading does not replay thresholds that were already crossed
- Returning to a visible tab triggers an immediate catch-up tick
- The tab title displays the soonest active countdown

## Persistence

The storage key remains `potTracker_v4` for backward compatibility:

```json
{
  "chaos": {
    "targetTime": 1789000000000,
    "nextLocation": "south",
    "totalDuration": 1800
  },
  "oce": {
    "targetTime": null,
    "nextLocation": null,
    "totalDuration": null
  },
  "light": {
    "targetTime": null,
    "nextLocation": null,
    "totalDuration": null
  },
  "history": [
    { "dc": "chaos", "location": "north", "time": "14:32", "type": "spawn" }
  ],
  "dailyLog": {
    "2026-07-20": { "bronze": 3, "silver": 1, "gold": 2 }
  }
}
```

- `targetTime` is the absolute spawn time in epoch milliseconds
- `totalDuration` is normally `1800` seconds and scales the progress ring
- `nextLocation` is the predicted upcoming side
- New history entries are `spawn` or `manual`
- Existing version 4 data loads without conversion, including an in-progress old 10-minute timer
- Version 3 data is migrated by flipping its stored last-spawn location into the predicted next location
- Corrupted data and storage quota failures are tolerated without breaking the page

## Design principles

- Put the next route decision before secondary logging tools
- Keep **Pot spawned** visually dominant and correction actions quiet
- Use color only to distinguish data centers, rarity tiers, and urgent states
- Explain the fresh-instance rule without turning it into a stateful control
- Show useful empty states instead of blank panels
- Support keyboard focus, touch targets, reduced motion, and layouts from small phones to wide desktops

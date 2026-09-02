"use strict";

/* ============================================================
   Keeping Tabs - application

   Players, the event log as source of truth, the adjustment pad,
   round entry, global undo, localStorage autosave.

   Two zones, and the rule that separates them:
     scoring - edge-anchored, rotated, NO native inputs
     setup   - center, unrotated, native inputs fine
   A rotated <input> puts the iOS keyboard against a 90-degree field.
   The exception is deliberate and documented at paintEmojiGrid: emoji is
   one tap, so it pays the awkwardness once rather than per character.

   Loaded as a classic script, not a module, so index.html still opens
   from disk as well as over a server.
   ============================================================ */

/* ============================================================
   Constants
   ============================================================ */

const DEPTH   = 80;
const PAD_OUT = 17;
const GAP     = 6;
const MIN_LEN = 60;
const MAX_LEN = 200;
/* Tabs deliberately do NOT fill their edge - zero slack means a neighbor
   can never slide out of the way, only snap when the sort order flips. */
const FILL    = 0.92;
/* iOS standalone with an opaque status bar reports no bottom inset yet the
   page still runs under the home indicator. Apple's own values. */
const HOME_BAR_PHONE  = 34;
const HOME_BAR_TABLET = 20;
const SLOP    = 8;
const MAX_PLAYERS = 16;
const AMBIENT_MS = 20000;   // idle before the tabs sink back
const STORE = "keepingtabs.state";
/* Date-sequence, bumped by hand each commit, so a screenshot identifies
   its own build. Not a commit hash: a commit cannot contain its own hash,
   and amending one in only ever leaves it pointing at the commit before.
   The commit message names the build, so `git log --grep` maps it back. */
const BUILD = "0902-01";

/* Whether this context can persist at all. Private mode, a data: URL and
   a full quota all throw, and the app has to keep working regardless. */
let storageOk = null;
let lastSave  = "never";
function probeStorage() {
  try { localStorage.setItem("kt.probe", "1"); localStorage.removeItem("kt.probe"); storageOk = true; }
  catch (e) { storageOk = false; }
}

const EDGES = ["top", "right", "bottom", "left"];

/* Defaults only. Players may type any emoji they like, including ones
   that will not render everywhere — that is their call, not ours. This
   pool just picks sensible starting animals: distinct silhouettes at
   20px, nothing newer than Unicode 9.0 so it renders on older devices. */
const ANIMALS = ["\u{1F98A}","\u{1F419}","\u{1F989}","\u{1F422}","\u{1F427}","\u{1F98B}","\u{1F41D}","\u{1F40C}",
                 "\u{1F988}","\u{1F987}","\u{1F418}","\u{1F433}","\u{1F980}","\u{1F991}","\u{1F40A}","\u{1F40D}",
                 "\u{1F982}","\u{1F985}","\u{1F42A}","\u{1F98F}","\u{1F438}","\u{1F994}","\u{1F995}","\u{1F407}",
                 "\u{1F98E}","\u{1F41F}","\u{1F41C}","\u{1F986}"];

/* Which way round a tab's text goes. WCAG relative luminance, then the
   contrast white would get against it.

   The textbook rule flips at 0.179 luminance, where black and white draw
   level at 4.58:1 — but applied here it would turn every tab in COLORS
   black, because those sit just above that line by construction, and white
   on saturated color reads better than the arithmetic admits. So white is
   preferred past the crossover and gives way at 3.5:1, below which the
   preference stops being defensible. Anything that flips is therefore a
   color where black was already the better of the two.

   This exists for the colors nobody chose from a palette: the native
   picker offers the whole spectrum, and #FFE800 with white text on it is
   unreadable no matter how well the sixteen defaults behave. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function whiteOn(hex) { return 1.05 / (luminance(hex) + 0.05); }
function inkIsLight(hex) {
  return /^#[0-9a-f]{6}$/i.test(hex || "") ? whiteOn(hex) >= 3.5 : true;
}

/* Near-black rather than black: the tab is a saturated color, and pure
   #000 on it reads as a hole rather than as text. */
const INK_DARK = "#141414";
function paintInk(el, hex) {
  const light = inkIsLight(hex);
  el.style.setProperty("--ink", light ? "#fff" : INK_DARK);
  el.style.setProperty("--ink-rgb", light ? "255,255,255" : "20,20,20");
  el.style.setProperty("--anti-rgb", light ? "0,0,0" : "255,255,255");
  el.style.setProperty("--edit", light ? "#FFD98A" : "#5C3B00");
}

/* Sixteen hues at full saturation. The old set was muted so the app would
   sit quietly on a table, but that job belongs to the ambient dim now — it
   desaturates on idle and wakes on touch, so the resting state can be loud
   without the game having to look at it all evening. And not every table
   finds the device distracting in the first place.

   Each one is the LIGHTEST it can be while still clearing 4:1 against
   white, because a tab carries its owner's name in white and color must
   not cost legibility. Hues are picked by eye, not by arithmetic: sixteen
   even steps round the wheel crowds the greens and starves the purples,
   since perceived hue is not linear in degrees. */
const COLORS = ["#FB1900","#D75600","#AD7300","#7C8500",
                "#3A9100","#00931D","#00915C","#008E85",
                "#0089AF","#007EED","#4375FF","#746AFF",
                "#9F56FF","#D016FF","#EA00BB","#F9006C"];

/* ============================================================
   State - the log is the source of truth, totals are derived
   ============================================================ */

let players = [];
let log = [];                    // { id, ts, type:"delta", playerId, value }
let arrangeMode = false;

/* ---- ROUND ENTRY PROTOTYPE ----
   Everyone enters this round at once, each in their own seat's
   orientation. Pending values live here and are only written to the log
   on confirm, so backing out costs nothing. */
let roundEntry = false;
let pending = {};            // playerId -> number being entered
let lockedIn = {};           // playerId -> true once confirmed

/* Depth is budgeted per axis, not per tab: two facing strips share one
   dimension, and the center has to keep enough room for End round. */
/* Depth is a share of the axis it eats into, not a constant: 250 is a good
   strip on an iPad and most of a phone's width. */
function stripWant(edge) {
  const v = viewport();
  const across = (edge === "top" || edge === "bottom") ? v.h : v.w;
  return Math.min(250, across * 0.3);
}
/* Strips grow along the edge as well as into it. A tab is capped at 200
   because it is a label; a strip is a control, and 200 of an iPad's 1180pt
   edge leaves the screen emptier at the exact moment everyone is using it.
   The relaxation loop distributes this the same way it distributes tabs, so
   crowded edges still fall back to sharing. */
const STRIP_MAX_LEN = 430;
const CENTER_MIN = 130;
function oppositeEdge(e) {
  return e === "top" ? "bottom" : e === "bottom" ? "top" : e === "left" ? "right" : "left";
}
function stripDepth(edge) {
  const v = viewport();
  const across = (edge === "top" || edge === "bottom") ? v.h : v.w;
  const facing = players.some(q => q.edge === oppositeEdge(edge));
  const budget = facing ? (across - CENTER_MIN) / 2 : across - CENTER_MIN;
  return Math.max(DEPTH, Math.min(stripWant(edge), budget)) + bleedFor(edge);
}
let prefs = { ambient: true, wakeLock: true, winCondition: "high", startRound: 1 };
let openId = null;               // player whose panel is expanded
let entry = "";                  // THIS ROUND'S SCORE being edited, as a string ("" is 0)
let panelView = "score";         // score | name
let nameBuf = "";
let shiftOn = false;
let safe = { top: 0, right: 0, bottom: 0, left: 0 };
let totals = {};
let roundScores = {};

const stage  = document.getElementById("stage");
const center = document.getElementById("center");
const probe  = document.getElementById("probe");
const vpEl   = document.getElementById("vp");
const scrim  = document.getElementById("scrim");
const sheet  = document.getElementById("sheet");

const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Totals are never stored. If they ever disagreed with the log the log
   would win, so there is nothing to disagree with. */
/* The log holds two kinds of entry: a `delta` for a score change and a
   `round` marker for End Round. A player's round score is simply the
   deltas after the last marker, so nothing about rounds is stored twice
   and undoing a marker un-ends the round for free. */
function lastMarker() {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].type === "round") return i;
  return -1;
}
/* Display only. Five Crowns numbers its eleven deals by the wild card,
   3 through K, so its first round is 3; some games start at 0; and a
   game picked up halfway starts wherever it left off. The log is
   unaffected — this is an offset on what the counter reads. */
function roundNo() { return prefs.startRound + log.filter(e => e.type === "round").length; }

function recompute() {
  totals = {}; roundScores = {};
  for (const p of players) { totals[p.id] = 0; roundScores[p.id] = 0; }
  const from = lastMarker() + 1;
  log.forEach((e, i) => {
    if (e.type !== "delta" || totals[e.playerId] === undefined) return;
    totals[e.playerId] += e.value;
    if (i >= from) roundScores[e.playerId] += e.value;
  });
}

/* Completed rounds, rebuilt from the markers. */
function roundTable() {
  const out = []; let acc = {}; let n = prefs.startRound;
  for (const e of log) {
    if (e.type === "delta") acc[e.playerId] = (acc[e.playerId] || 0) + e.value;
    else if (e.type === "round") { out.push({ n: n++, scores: acc }); acc = {}; }
  }
  return out;
}

/* Highest or lowest, depending on the setting. Returns null when every
   player is level — marking all sixteen tells nobody anything. */
function bestOf(map) {
  if (players.length < 2) return null;
  const vals = players.map(pl => map[pl.id] || 0);
  const hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
  if (hi === lo) return null;
  return prefs.winCondition === "low" ? lo : hi;
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      version: 1,
      players: players.map(p => ({ id: p.id, name: p.name, color: p.color, emoji: p.emoji,
                                   edge: p.edge, fraction: p.fraction, mode: p.mode,
                                   textSize: p.textSize })),
      log: log,
      prefs: prefs
    }));
    lastSave = new Date().toTimeString().slice(0, 8);
  } catch (e) {
    lastSave = "FAILED";     // private mode or quota - the game keeps working
    storageOk = false;
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || d.version !== 1 || !Array.isArray(d.players) || !d.players.length) return false;
    players = d.players;
    log = Array.isArray(d.log) ? d.log : [];
    if (d.prefs) {
      if (typeof d.prefs.ambient === "boolean") prefs.ambient = d.prefs.ambient;
      if (typeof d.prefs.wakeLock === "boolean") prefs.wakeLock = d.prefs.wakeLock;
      if (d.prefs.winCondition === "low" || d.prefs.winCondition === "high") prefs.winCondition = d.prefs.winCondition;
      if (typeof d.prefs.startRound === "number") prefs.startRound = clamp(d.prefs.startRound | 0, 0, 99);
    }
    return true;
  } catch (e) { return false; }
}

/* Screen Wake Lock. A device sits on a table for an hour; nothing kills
   the experience faster than the screen sleeping every thirty seconds.
   It drops silently on tab switch, so it is re-acquired on visibility. */
let wakeLock = null;
let wakeLockState = "off";

async function acquireWakeLock() {
  if (!prefs.wakeLock) { wakeLockState = "off"; return; }
  if (!("wakeLock" in navigator)) { wakeLockState = "unsupported"; return; }
  if (wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLockState = "held";
    wakeLock.addEventListener("release", () => { wakeLock = null; wakeLockState = "released"; });
  } catch (e) { wakeLock = null; wakeLockState = "denied"; }
  paintHub();
}
function dropWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  wakeLockState = prefs.wakeLock ? "released" : "off";
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") acquireWakeLock(); else dropWakeLock();
});

let ambientTimer = null;

function scheduleAmbient() {
  clearTimeout(ambientTimer);
  if (!prefs.ambient) { document.body.classList.remove("ambient"); return; }
  ambientTimer = setTimeout(function () {
    /* Something open is not idle. */
    if (openId || sheet.classList.contains("on")) { scheduleAmbient();
acquireWakeLock(); return; }
    document.body.classList.add("ambient");
  }, AMBIENT_MS);
}

function wake() {
  document.body.classList.remove("ambient");
  scheduleAmbient();
acquireWakeLock();
  if (prefs.wakeLock && !wakeLock) acquireWakeLock();   // Safari wants a gesture
}

/* Capture, so a tap wakes the tabs even when it lands on a control that
   stops propagation. The tap still does its job — waking is not a mode
   you have to tap past first. */
window.addEventListener("pointerdown", wake, true);

/* Every mutation ends here, so autosave can never be forgotten. */
function commit() {
  recompute();
  save();
  layout(true);
  paintHub();
  wake();
}

/* ============================================================
   Players
   ============================================================ */

/* Prefers an unused animal, but duplicates are allowed if that is what
   is left, or what someone picks on purpose. */
function freeEmoji() {
  const used = new Set(players.map(p => p.emoji));
  const pool = ANIMALS.filter(a => !used.has(a));
  const from = pool.length ? pool : ANIMALS;
  return from[Math.floor(Math.random() * from.length)];
}
function freeColor() {
  const used = new Set(players.map(p => p.color));
  const pool = COLORS.filter(c => !used.has(c));
  return (pool.length ? pool : COLORS)[0];
}

function addPlayer(name) {
  if (players.length >= MAX_PLAYERS) return null;
  const p = { id: uid(), name: name || "Player " + (players.length + 1),
              color: freeColor(), emoji: freeEmoji(), edge: "bottom", fraction: 0.5,
              mode: "pad", textSize: "normal" };
  players.push(p);
  placeNew(p);
  return p;
}

/* A late joiner lands on the emptiest edge, after whoever is already
   there. It must NOT auto-arrange: everyone else has been placed by hand
   to match where they are sitting, and adding a player is no reason to
   throw that away. */
function placeNew(p) {
  const rect = safeRect();
  const others = players.filter(x => x !== p);
  const best = EDGES
    .map(e => ({ e: e, room: edgeCapacity(e, rect) - others.filter(x => x.edge === e).length }))
    .sort((a, b) => b.room - a.room)[0];
  p.edge = best && best.room > 0 ? best.e : "bottom";
  const mates = others.filter(x => x.edge === p.edge);
  p.fraction = mates.length
    ? Math.min(1, Math.max.apply(null, mates.map(x => x.fraction)) + 0.15)
    : 0.5;
}

function removePlayer(id) {
  players = players.filter(p => p.id !== id);
  log = log.filter(e => e.playerId !== id);
  if (openId === id) closePanel();
}

/* Allocate players to edges in proportion to usable span - the long edges
   carry roughly 2.5x the short ones, so round-robin would crowd them. */
function autoArrange() {
  const rect = safeRect();
  const spans = EDGES.map(e => ({ e: e, span: edgeSpan(e, rect).length }));
  const total = spans.reduce((s, x) => s + x.span, 0) || 1;
  const n = players.length;
  const counts = spans.map(x => ({ e: x.e, n: Math.floor(n * x.span / total), rem: (n * x.span / total) % 1 }));
  const left = n - counts.reduce((s, c) => s + c.n, 0);
  counts.slice().sort((a, b) => b.rem - a.rem).forEach((c, i) => { if (i < left) c.n++; });
  let i = 0;
  for (const c of counts) {
    for (let k = 0; k < c.n && i < n; k++, i++) {
      players[i].edge = c.e;
      players[i].fraction = (k + 0.5) / c.n;
    }
  }
}

/* ============================================================
   Geometry - carried over from M1 intact
   ============================================================ */

function readSafeInsets() {
  const cs = getComputedStyle(probe);
  safe = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
           bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
}
function viewport() {
  const r = vpEl.getBoundingClientRect();
  return { w: r.width || window.innerWidth, h: r.height || window.innerHeight };
}
function isStandalone() {
  return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
}
function bleedFor(edge) {
  const reported = safe[edge] || 0;
  if (reported === 0 && edge === "bottom" && isStandalone()) {
    return Math.min(screen.width, screen.height) >= 600 ? HOME_BAR_TABLET : HOME_BAR_PHONE;
  }
  return reported;
}
function edgeDepth(edge) { return DEPTH + bleedFor(edge); }

function safeRect() {
  const v = viewport();
  return { l: bleedFor("left"), t: bleedFor("top"), r: v.w - bleedFor("right"), b: v.h - bleedFor("bottom") };
}
function edgeLength(edge, rect) {
  return (edge === "top" || edge === "bottom") ? rect.r - rect.l : rect.b - rect.t;
}
/* The whole edge, corners included. Tabs may not use this — they would
   collide with the adjoining edge — but a modal panel may. */
function edgeRange(edge, rect) {
  return { start: (edge === "top" || edge === "bottom") ? rect.l : rect.t,
           length: edgeLength(edge, rect) };
}

function edgeSpan(edge, rect) {
  const len = edgeLength(edge, rect);
  const start = (edge === "top" || edge === "bottom") ? rect.l : rect.t;
  /* The corner reservation is one TAB depth, which is the right number
     until a tab stops being tab-deep. A strip is three times deeper, so
     during round entry the corners have to be reserved at the depth of
     the edges that actually meet there — the perpendicular ones. */
  const keep = roundEntry
    ? stripDepth((edge === "top" || edge === "bottom") ? "left" : "top")
    : DEPTH;
  return { start: start + keep, length: Math.max(0, len - keep * 2) };
}
function edgeCapacity(edge, rect) {
  return Math.max(0, Math.floor((edgeSpan(edge, rect).length + GAP) / (MIN_LEN + GAP)));
}

/* One `length x depth` box placed by a single translate+rotate. In local
   coordinates y=0 is ALWAYS the inward edge and y=depth the outer one. */
function tabTransform(edge, along, len, depth) {
  const v = viewport(), W = v.w, H = v.h, D = depth;
  switch (edge) {
    case "bottom": return "translate(" + along + "px, " + (H - D) + "px) rotate(0deg)";
    case "top":    return "translate(" + (along + len) + "px, " + D + "px) rotate(180deg)";
    case "left":   return "translate(" + D + "px, " + along + "px) rotate(90deg)";
    case "right":  return "translate(" + (W - D) + "px, " + (along + len) + "px) rotate(-90deg)";
  }
}

/* ============================================================
   Layout
   ============================================================ */

function layout(commitPos) {
  const rect = safeRect();
  spillOverfullEdges(rect);

  for (const edge of EDGES) {
    const span = edgeSpan(edge, rect);
    const group = players.filter(p => p.edge === edge).sort((a, b) => a.fraction - b.fraction);
    const n = group.length;
    if (!n) continue;

    const ideal = (span.length * FILL - GAP * (n - 1)) / n;
    const cap = roundEntry ? STRIP_MAX_LEN : MAX_LEN;
    const len = Math.max(MIN_LEN, Math.min(cap, ideal));
    const half = len / 2;
    const lo = span.start + half, hi = span.start + span.length - half;
    const pitch = len + GAP;
    const centers = group.map(p => clamp(span.start + p.fraction * span.length, lo, hi));

    /* The dragged tab is pinned; neighbors relax outward from it. */
    const pin = group.findIndex(p => p.lifted);
    if (pin >= 0) {
      for (let i = pin + 1; i < n; i++) centers[i] = Math.max(centers[i], centers[i - 1] + pitch);
      for (let i = pin - 1; i >= 0; i--) centers[i] = Math.min(centers[i], centers[i + 1] - pitch);
    } else {
      for (let i = 1; i < n; i++) centers[i] = Math.max(centers[i], centers[i - 1] + pitch);
      for (let i = n - 2; i >= 0; i--) centers[i] = Math.min(centers[i], centers[i + 1] - pitch);
    }
    /* Only the ends may override the pin, and only once the edge is full. */
    if (centers[0] < lo) {
      centers[0] = lo;
      for (let i = 1; i < n; i++) centers[i] = Math.max(centers[i], centers[i - 1] + pitch);
    }
    if (centers[n - 1] > hi) {
      centers[n - 1] = hi;
      for (let i = n - 2; i >= 0; i--) centers[i] = Math.min(centers[i], centers[i + 1] - pitch);
    }

    group.forEach((p, i) => {
      const c = clamp(centers[i], lo, hi);
      p._len = len;
      p._along = c - half;
      /* Displacement becomes real only on drop; committing every frame
         would let a tab be shoved for ever and never spring back. */
      if (commitPos && span.length > 0) p.fraction = clamp((c - span.start) / span.length, 0, 1);
    });
  }
  render(rect);
}

function spillOverfullEdges(rect) {
  for (const edge of EDGES) {
    const cap = edgeCapacity(edge, rect);
    const group = players.filter(p => p.edge === edge).sort((a, b) => a.fraction - b.fraction);
    while (group.length > cap) {
      const target = EDGES.map(e => ({ e: e, room: edgeCapacity(e, rect) - players.filter(p => p.edge === e).length }))
                          .sort((a, b) => b.room - a.room)[0];
      if (!target || target.room <= 0) break;
      const moved = group.pop();
      moved.edge = target.e;
      moved.fraction = 0.5;
    }
  }
}

/* An open panel is modal — the scrim covers everything else — so it is not
   bound by the corner reservation that keeps tabs apart, and it may reach
   past the opposite edge's tabs.

   This used to cap at 370 x 340, the size it comes out at on the short edge
   of an iPhone, on the reasoning that a panel should stay near its player's
   edge so nobody has to reach. Play-test says reach was never the problem:
   an iPad is a small object on a table and every edge of it is already
   within arm's length. Holding the panel close to its edge bought nothing
   and cost button size, which is the thing players actually complained
   about. Orientation is what marks a panel as yours. Proximity never was.

   So the panel takes the space it is given. What stops it is not the screen
   but the hand: a button has a best size in millimeters, not in percent,
   and past roughly a thumb and a half it stops getting easier to hit. Hence
   an absolute ceiling rather than a proportional one — the same panel on a
   12.9" iPad as on a 10.9" one, because the fingers are the same size.

   That freedom belongs to Large, and only to Large. Small keeps the 370 x
   340 it always had, which play-test says was fine for the people who want
   it: the answer to "too small" is the toggle, not one size that tries to
   suit both hands. So the two settings differ in the box first and the type
   second — a bigger font in the same box is bigger glyphs on the same
   button, which is what the play-test rejected in the first place.

   `reserve` only binds on a phone in landscape, where the short axis runs
   out before the ceiling does. It keeps a sliver of the far side visible so
   an open panel still reads as a panel over a board. */
const PANEL = {
  normal: { inset: 16, maxLen: 370, maxDepth: 340, reserve: 64 },
  large:  { inset: 8,  maxLen: 680, maxDepth: 680, reserve: 40 }
};

function panelSize(edge, rect, size) {
  const cfg = PANEL[size === "large" ? "large" : "normal"];
  const v = viewport();
  const full = edgeRange(edge, rect).length;
  const len = Math.max(MIN_LEN, Math.min(full - cfg.inset * 2, cfg.maxLen));
  const across = (edge === "top" || edge === "bottom") ? v.h : v.w;
  const depth = Math.max(DEPTH, Math.min(cfg.maxDepth, across - cfg.reserve)) + bleedFor(edge);
  return { len: len, depth: depth };
}

/* Thresholds allow for the round number being back on the second row.
   Below t-emoji only the emoji and total survive. */
function tierFor(len) {
  if (len >= 150) return "";           // emoji + full name / round + total
  if (len >= 108) return "t-first";    // emoji + first name / round + total
  if (len >= 76)  return "t-first";
  return "t-emoji";                    // emoji / total
}

function render(rect) {
  const leadAt = bestOf(totals);
  const table = roundTable();
  const lastRound = table.length ? table[table.length - 1].scores : null;
  const hotAt = lastRound ? bestOf(lastRound) : null;
  /* Round scores only mean something once a round has been closed —
     before that they are identical to the total. */
  const showRound = table.length > 0;

  for (const p of players) {
    const el = p.el;
    const open = p.id === openId;
    const bleed = bleedFor(p.edge);
    const inStrip = roundEntry && !lockedIn[p.id];
    const size = open ? panelSize(p.edge, rect, p.textSize)
               : { len: p._len, depth: inStrip ? stripDepth(p.edge) : edgeDepth(p.edge) };

    let along = p._along;
    if (open) {
      const range = edgeRange(p.edge, rect);      // corners included
      const mid = p._along + p._len / 2;
      along = clamp(mid - size.len / 2, range.start,
                    range.start + Math.max(0, range.length - size.len));
    }

    el.style.width = size.len + "px";
    el.style.height = size.depth + "px";
    /* The tab's own padding reserves the star strip for the COMPACT
       layout. An open panel does its own padding, so leaving the tab's
       in place boxes the panel inside 24px it cannot use — visible in
       landscape as dead space above the home indicator. */
    el.style.padding = (open || inStrip) ? "0px" : ("7px 0 " + (PAD_OUT + bleed) + "px");
    el.style.setProperty("--bleed", bleed + "px");
    el.style.transform = tabTransform(p.edge, along, size.len, size.depth);

    /* Transform only animates when the tab stays on the same edge: CSS
       interpolates the whole matrix, so easing across a rotation change
       tumbles the tab through intermediate angles. */
    const sameEdge = p._renderedEdge === p.edge;
    el.className = "tab " + tierFor(size.len) +
                   (p.textSize === "large" ? " size-large" : "") +
                   (p.lifted ? " lifted" : (sameEdge ? " settling" : "")) +
                   (open ? " open" : "") +
                   (inStrip ? " strip" : "") +
                   (roundEntry && lockedIn[p.id] ? " locked-in" : "") +
                   (leadAt !== null && (totals[p.id] || 0) === leadAt ? " leading" : "") +
                   (hotAt !== null && (lastRound[p.id] || 0) === hotAt ? " won-round" : "");
    p._renderedEdge = p.edge;

    /* Identity is rendered, not poked. It used to be written once in
       buildTab and then patched by hand wherever it could change, which
       worked for exactly the one caller that remembered to do it. */
    el.style.background = p.color;
    paintInk(el, p.color);
    el.querySelector(".emoji").textContent = p.emoji;
    el.querySelector(".who").textContent = size.len >= 150 ? p.name : p.name.split(" ")[0];
    el.querySelector(".tot").textContent = totals[p.id] || 0;
    const rnd = el.querySelector(".rnd");
    rnd.textContent = showRound ? (roundScores[p.id] || 0) : "";
    rnd.style.display = showRound ? "" : "none";
    if (open) paintPanel(p);
    if (inStrip) paintStrip(p);
  }

  const occupied = e => players.some(p => p.edge === e);
  center.style.left   = (rect.l + (occupied("left") ? DEPTH : 0) + 10) + "px";
  center.style.top    = (rect.t + (occupied("top")  ? DEPTH : 0) + 10) + "px";
  center.style.width  = (rect.r - rect.l - (occupied("left") ? DEPTH : 0) - (occupied("right")  ? DEPTH : 0) - 20) + "px";
  center.style.height = (rect.b - rect.t - (occupied("top")  ? DEPTH : 0) - (occupied("bottom") ? DEPTH : 0) - 20) + "px";
}

function buildTab(p) {
  const el = document.createElement("div");
  el.className = "tab";
  el.style.background = p.color;
  el.innerHTML =
    '<div class="compact">' +
      '<span class="name"><span class="emoji"></span><span class="who"></span></span>' +
      '<span class="nums"><span class="rnd"></span><span class="tot"></span></span>' +
      '<span class="star">★</span>' +
      '<span class="bar"></span>' +
    '</div>' +
    '<div class="panel"></div>' +
    '<div class="strip"></div>';
  el.querySelector(".emoji").textContent = p.emoji;
  el.addEventListener("pointerdown", e => onPointerDown(e, p));
  stage.appendChild(el);
  return el;
}

function rebuildTabs() {
  /* Remove only the tabs: innerHTML = "" would take the scrim with them. */
  Array.prototype.forEach.call(stage.querySelectorAll(".tab"), el => el.remove());
  for (const p of players) p.el = buildTab(p);
}

/* ============================================================
   The panel - the tab, grown
   ============================================================ */

function openPanel(p) {
  openId = p.id;
  /* Opens holding what is already banked this round, so the first thing
     you see is your own number rather than an empty field. */
  const banked = roundScores[p.id] || 0;
  entry = banked ? String(banked) : "";
  panelView = "score"; nameBuf = ""; shiftOn = false;
  if (p.mode !== "keys" && p.mode !== "pad") p.mode = "pad";
  scrim.classList.add("on");
  layout(false);
}

/* Closing without confirming discards the edit. Nothing has reached the
   log yet, so there is nothing to roll back. */
function closePanel() {
  openId = null;
  entry = ""; panelView = "score"; nameBuf = ""; shiftOn = false;
  scrim.classList.remove("on");
  layout(false);
}

/* One log entry per confirmed edit, recording the difference between the
   number on screen and what was already banked this round. */
function confirmPanel(p) {
  const delta = editedFrom(p);
  entry = "";
  if (delta) score(p, delta); else layout(false);
  closePanel();
}

/* The panel edits a VALUE — this player's score for this round — rather
   than accumulating a modifier onto one. It opens holding whatever they
   have already banked this round, and every control acts on that number:
   digits type it, backspace shortens it, Clear zeroes it, the pad nudges
   it. Confirm records the difference against what was banked, so the log
   stays a list of deltas and undo, totals and history are untouched. */
function enteredValue() { return parseInt(entry, 10) || 0; }
function bankedThisRound(p) { return roundScores[p.id] || 0; }
function editedFrom(p) { return enteredValue() - bankedThisRound(p); }

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/* What the next letter will actually be. Word starts capitalize
   themselves and shift inverts that, so the two agree by construction. */
function nextIsUpper() {
  const startsWord = nameBuf.length === 0 || nameBuf.slice(-1) === " ";
  return startsWord !== shiftOn;
}

function paintName(p) {
  const shown = nameBuf.length ? esc(nameBuf) : '<span style="opacity:.45">Name</span>';
  /* Keys show the case they will insert, the way a phone keyboard does —
     it is the only honest indicator of what shift is currently doing. */
  const up = nextIsUpper();
  /* 26 letters + shift + a double-width space + delete fills the 6x5 grid
     exactly. Confirm used to be the thirtieth key; it sits in the bottom
     row now, where every other confirm in the app is. */
  const keys =
    LETTERS.map(c => '<button data-n="' + c + '">' + (up ? c : c.toLowerCase()) + "</button>").join("") +
    '<button class="act" data-n="shift"' + (shiftOn ? ' aria-pressed="true"' : "") + ">\u21e7</button>" +
    '<button class="act" data-n="space">\u2423</button>' +
    '<button class="act" data-n="del">\u232b</button>';
  return '<div class="nameline">' + shown + "</div>" +
         '<div class="kbd">' + keys + "</div>";
}

function paintEmojiGrid(p) {
  /* A native field, on a rotated surface, which the drawn keyboard exists
     to avoid — allowed here by explicit decision. The rule was written for
     NAME entry, where you type a dozen characters against a text box turned
     ninety degrees and the awkwardness is paid over and over. Emoji is one
     tap on a picker you are already hunting through: the keyboard lands
     somewhere awkward once, and then you are done. Different exposure, so
     the same rule need not bind.

     It is the only way to reach an emoji outside the grid, too. There is no
     inputmode for emoji on any platform, so nothing can summon that
     keyboard directly — a field the player switches to it themselves is the
     whole of the available technique. */
  return '<div class="pgrid emo">' +
    ANIMALS.map(a => '<button data-pe="' + a + '"' +
      (a === p.emoji ? ' aria-pressed="true"' : "") + ">" + a + "</button>").join("") + "</div>" +
    '<label class="pmore">' +
      '<input class="swatch" type="text" data-pemore value="' + esc(p.emoji) + '" ' +
        'aria-label="Any character" autocomplete="off" autocorrect="off" ' +
        'autocapitalize="off" enterkeyhint="done">' +
      "<span>More emoji\u2026</span>" +
    "</label>";
}

function paintColorGrid(p) {
  /* Duplicates allowed, same as emoji. Color is how a player finds their
     own tab, but whether that matters is the table's call and not ours —
     teammates may well want to match, and a rule that second-guesses the
     people at the table is worse than a table that sorts itself out. */
  return '<div class="pgrid color">' +
    COLORS.map(c => '<button data-pc="' + c + '" style="background:' + c + '"' +
      ' aria-label="' + c + '"' +
      (c === p.color ? ' aria-pressed="true"' : "") + "></button>").join("") + "</div>" +
    '<label class="pmore">' +
      '<input type="color" data-pcmore value="' + p.color + '" aria-label="More colors">' +
      "<span>More colors\u2026</span>" +
    "</label>";
}

/* Emoji and color apply on the tap and stay put: the panel IS the color,
   so the change announces itself, and the strip carries the live emoji. The
   bottom button dismisses rather than commits in those two, and commits in
   the name view — but it is the same button in the same place either way,
   which is the point. A confirm that moves between views is a confirm you
   have to hunt for. */
function identityFoot(p) {
  if (panelView === "name") {
    return '<div class="prow">' +
      '<button class="btn2" data-n="clearname"' + (nameBuf.length ? "" : " disabled") + ">Clear</button>" +
      '<button class="btn2 ok" data-n="ok" aria-label="Save name">\u2713</button>' +
    "</div>";
  }
  return '<div class="prow">' +
    '<button class="btn2 ok" data-v="done" aria-label="Done">\u2713</button>' +
  "</div>";
}

function paintIdentity(p, box) {
  const tab = (v, label) => '<button data-v="' + v + '"' +
    (panelView === v ? ' aria-pressed="true"' : "") + ">" + label + "</button>";
  const body = panelView === "emoji" ? paintEmojiGrid(p)
             : panelView === "color" ? paintColorGrid(p)
             : paintName(p);
  box.innerHTML =
    '<div class="ptop">' +
      '<div class="idnav">' +
        tab("name", "Name") + tab("emoji", p.emoji) + tab("color", "Color") +
      "</div>" +
    "</div>" + body + identityFoot(p);
}

/* ---- ROUND ENTRY PROTOTYPE ---- */
function paintStrip(p) {
  const box = p.el.querySelector(".strip");
  const v = pending[p.id] || 0;
  /* A stepper, not a keypad. Round-based games mostly want small integers
     — tricks taken, phases cleared — and three columns inside a tab's own
     length is a 34pt key, which is not a key. */
  box.innerHTML =
    '<div class="who2"><span>' + p.emoji + "</span><span>" + esc(p.name.split(" ")[0]) + "</span></div>" +
    '<div class="val">' + v + "</div>" +
    '<div class="steps">' +
      '<button data-step="-1">\u2212</button>' +
      '<button data-step="1">+</button>' +
    "</div>" +
    '<button class="done" data-lockin>\u2713</button>';
}

function startRoundEntry() {
  roundEntry = true; pending = {}; lockedIn = {};
  /* Opens holding what is already banked this round, so it edits a value
     rather than adding to one — the same rule the panel follows. */
  players.forEach(q => { pending[q.id] = roundScores[q.id] || 0; });
  layout(true); paintHub();
}
function cancelRoundEntry() { roundEntry = false; pending = {}; lockedIn = {}; layout(true); paintHub(); }
function lockIn(p) {
  const delta = (pending[p.id] || 0) - (roundScores[p.id] || 0);
  if (delta) score(p, delta);
  lockedIn[p.id] = true;
  layout(true); paintHub();
}
function allLockedIn() { return players.length > 0 && players.every(q => lockedIn[q.id]); }

stage.addEventListener("click", e => {
  if (!roundEntry) return;
  const p = players.find(q => q.el.contains(e.target));
  if (!p || lockedIn[p.id]) return;
  const st = e.target.closest("[data-step]");
  if (st) { pending[p.id] = (pending[p.id] || 0) + parseInt(st.dataset.step, 10); layout(false); return; }
  if (e.target.closest("[data-lockin]")) lockIn(p);
});

function paintPanel(p) {
  const box = p.el.querySelector(".panel");
  if (panelView !== "score") return paintIdentity(p, box);
  const keys = p.mode === "keys";
  /* This round only. The game total belongs on the tab and nowhere else. */
  const shown = enteredValue();
  const changed = editedFrom(p) !== 0;

  const header =
    '<div class="ptop">' +
      '<button class="pid" data-act="editname" aria-label="Edit name, emoji and color">' +
        '<span class="pidemo">' + p.emoji + "</span>" +
        '<span class="pname">' + esc(p.name) + "</span>" +
      "</button>" +
      '<span class="ptotwrap"><span class="plab">round</span>' +
        '<span class="ptot' + (changed ? " edited" : "") + '">' +
          (entry === "-" ? "\u2212" : shown) + '</span></span>' +
    '</div>';

  const foot =
    '<div class="prow">' +
      '<button class="btn2" data-act="mode">' + (keys ? "\u00b1 Pad" : "Custom") + '</button>' +
      '<button class="btn2" data-act="clear"' + (shown === 0 ? " disabled" : "") + '>Clear</button>' +
      '<button class="btn2 ok" data-act="ok" aria-label="Save and close">\u2713</button>' +
    '</div>';

  const body = keys
    ? '<div class="keys">' +
        [1,2,3,4,5,6,7,8,9].map(n => '<button data-k="' + n + '">' + n + '</button>').join("") +
        '<button data-k="sign">\u00b1</button>' +
        '<button data-k="0">0</button>' +
        '<button data-k="del">\u232b</button>' +
      '</div>'
    : '<div class="pad">' +
        '<button class="minus" data-d="-10">\u221210</button>' +
        '<button class="minus" data-d="-5">\u22125</button>' +
        '<button class="minus" data-d="-1">\u22121</button>' +
        '<button data-d="1">+1</button>' +
        '<button data-d="5">+5</button>' +
        '<button data-d="10">+10</button>' +
      '</div>';

  box.innerHTML = header + body + foot;
}

function score(p, delta) {
  if (!delta) return;
  log.push({ id: uid(), ts: Date.now(), type: "delta", playerId: p.id, value: delta });
  commit();
}

/* End Round drops a marker. Round scores become the deltas after it,
   which is to say zero, and the counter moves on. */
function endRound() {
  /* Ending the round ends the entry that fed it. Without this you finish a
     round and stay in strips with every player already confirmed — a state
     whose only exit is a button that now reads "Everyone is in". */
  if (roundEntry) { roundEntry = false; pending = {}; lockedIn = {}; }
  if (!players.length) return;
  log.push({ id: uid(), ts: Date.now(), type: "round", n: roundNo() });
  commit();
}

function undoLast(playerId) {
  /* Global undo takes back whatever happened last, End Round included.
     Per-player undo only ever touches that player's own scores. */
  if (!playerId && log.length && log[log.length - 1].type === "round") {
    log.pop(); commit(); return true;
  }
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === "delta" && (!playerId || log[i].playerId === playerId)) {
      log.splice(i, 1);
      commit();
      return true;
    }
  }
  return false;
}

stage.addEventListener("click", e => {
  if (!openId) return;
  const p = players.find(x => x.id === openId);
  if (!p || !p.el.contains(e.target)) return;

  const act = e.target.closest("[data-act]");
  const d   = e.target.closest("[data-d]");
  const k   = e.target.closest("[data-k]");

  /* Pad and keypad edit the same number: one nudges it, the other types it. */
  if (d) {
    entry = String(enteredValue() + parseInt(d.dataset.d, 10));
    layout(false);
    return;
  }
  if (k) {
    const key = k.dataset.k;
    if (key === "del")       entry = entry.replace(/.$/, "");
    else if (key === "sign") entry = entry.charAt(0) === "-" ? entry.slice(1) : "-" + entry;
    else if (entry.replace("-", "").length < 4) entry += key;
    layout(false);
    return;
  }
  const v  = e.target.closest("[data-v]");
  const pe = e.target.closest("[data-pe]");
  const pc = e.target.closest("[data-pc]");
  if (v) {
    const t = v.dataset.v;
    if (t === "done") { panelView = "score"; nameBuf = ""; shiftOn = false; layout(false); }
    else {
      if (t === "name") { nameBuf = p.name; shiftOn = false; }
      panelView = t; layout(false);
    }
    return;
  }
  if (pe) { p.emoji = pe.dataset.pe; commit(); return; }

  if (pc) { p.color = pc.dataset.pc; commit(); return; }

  const n = e.target.closest("[data-n]");
  if (n) {
    const k = n.dataset.n;
    if (k === "ok") {
      const trimmed = nameBuf.trim();
      if (trimmed) { p.name = trimmed; commit(); }
      panelView = "score"; nameBuf = ""; shiftOn = false;
      layout(false);
    } else if (k === "del") {
      nameBuf = nameBuf.slice(0, -1); layout(false);
    } else if (k === "clearname") {
      nameBuf = ""; shiftOn = false; layout(false);
    } else if (k === "space") {
      if (nameBuf.length && nameBuf.slice(-1) !== " " && nameBuf.length < 24) nameBuf += " ";
      layout(false);
    } else if (k === "shift") {
      shiftOn = !shiftOn; layout(false);
    } else if (nameBuf.length < 24) {
      nameBuf += nextIsUpper() ? k : k.toLowerCase();
      shiftOn = false;
      layout(false);
    }
    return;
  }

  if (act) {
    const a = act.dataset.act;
    if (a === "editname") { panelView = "name"; nameBuf = p.name; shiftOn = false; layout(false); return; }
    if (a === "ok")    confirmPanel(p);
    if (a === "clear") { entry = ""; layout(false); }
    if (a === "mode")  { p.mode = p.mode === "keys" ? "pad" : "keys"; save(); layout(false); }
  }
});

/* type=color streams input events for the whole drag. Repainting the panel
   would tear the very input the picker is attached to out of the document,
   so the tab is poked while dragging and committed once on change — the same
   bargain the sheet's picker makes. */
stage.addEventListener("input", e => {
  if (!openId) return;
  const p = players.find(x => x.id === openId);
  if (!p) return;
  if (e.target.matches("[data-pcmore]")) {
    p.color = e.target.value;
    p.el.style.background = p.color;
    paintInk(p.el, p.color);
    return;
  }
  /* Same bargain as the color picker, for the same reason: repainting
     mid-entry would destroy the focused field and take the keyboard down
     with it. Poke what has to move, commit when the field is done. */
  if (e.target.matches("[data-pemore]")) {
    const g = firstGrapheme(e.target.value);
    if (!g) return;
    p.emoji = g;
    p.el.querySelector(".emoji").textContent = g;
    const navTab = p.el.querySelector('[data-v="emoji"]');
    if (navTab) navTab.textContent = g;
    save();
  }
});
stage.addEventListener("change", e => {
  if (!openId) return;
  const p = players.find(x => x.id === openId);
  if (!p) return;
  if (e.target.matches("[data-pcmore]")) { p.color = e.target.value; commit(); }
  else if (e.target.matches("[data-pemore]")) {
    const g = firstGrapheme(e.target.value);
    if (g) p.emoji = g;
    commit();
  }
});

scrim.addEventListener("click", () => { closePanel(); closeSheet(); });

/* ============================================================
   Drag
   ============================================================ */

let drag = null;

function onPointerDown(e, p) {
  if (roundEntry) return;                   // strips are live: no dragging, no panels
  if (openId) return;                       // panel open: no dragging
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  p.el.setPointerCapture(e.pointerId);
  drag = { p: p, id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, moved: false };

  /* Locked means locked. There used to be a press-and-hold here that
     lifted a tab without unlocking anything, which made resting a thumb
     too long on your own tab enough to move it — and the whole reason to
     lock is that a tab's position is a seat, not a preference. Arrange is
     the only way in, and it lifts on contact because that is what you
     switched it on to do. */
  if (arrangeMode) lift(p);

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function lift(p) {
  if (!drag) return;
  drag.active = true;
  p.lifted = true;
  p.el.classList.add("lifted");
  p.el.classList.remove("settling");
  if (navigator.vibrate) navigator.vibrate(8);
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.moved && Math.hypot(dx, dy) > SLOP) drag.moved = true;
  if (!drag.active) return;
  const hit = projectToEdge(e.clientX, e.clientY, safeRect());
  drag.p.edge = hit.edge;
  drag.p.fraction = hit.fraction;
  layout(false);
}

function onPointerUp(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const p = drag.p, wasDrag = drag.active, moved = drag.moved;
  drag = null;
  if (wasDrag) {
    layout(true);                 // commit while still pinned
    p.lifted = false;
    p.el.classList.remove("lifted");
    layout(true);
    save();
  } else if (!moved) {
    openPanel(p);
  }
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
}

function projectToEdge(x, y, rect) {
  const d = { top: y - rect.t, bottom: rect.b - y, left: x - rect.l, right: rect.r - x };
  const edge = EDGES.reduce((best, e) => (d[e] < d[best] ? e : best), "top");
  const span = edgeSpan(edge, rect);
  const along = (edge === "top" || edge === "bottom") ? x : y;
  const f = span.length > 0 ? (along - span.start) / span.length : 0.5;
  return { edge: edge, fraction: clamp(f, 0, 1) };
}

/* ============================================================
   Hub
   ============================================================ */

function paintHub() {
  const lead = document.getElementById("lead");
  const scored = log.some(e => e.type === "delta");
  const n = roundNo();
  const at = bestOf(totals);
  const verb = prefs.winCondition === "low" ? "lowest on" : "leads on";
  let line;
  if (!players.length)      line = "No players yet.<br>Add a few to start.";
  else if (!scored)         line = players.length + " players &middot; no score yet";
  else if (at === null)     line = "All level";
  else {
    const tied = players.filter(p => (totals[p.id] || 0) === at);
    line = tied.length > 1
      ? tied.length + " tied on <b>" + at + "</b>"
      : "<b>" + esc(tied[0].name.split(" ")[0]) + "</b> " + verb + " <b>" + at + "</b>";
  }
  lead.innerHTML = "Round <b>" + n + "</b><br>" + line;

  document.getElementById("undo").disabled = !log.length;
  const re = document.getElementById("roundentry");
  if (re) {
    re.textContent = roundEntry
      ? (allLockedIn() ? "Everyone is in" : "Cancel round entry")
      : "Enter round";
    re.disabled = !players.length;
  }
  /* Nothing here about whether anybody scored. Whether a round happened is
     a fact about the table, not about the log — a round can end with every
     player on nothing, and the app does not get to tell a table it did not
     just play one. The old rule refused unless a delta had landed since the
     last marker, which from the outside read as the button locking up for
     no stated reason, and it locked hardest in exactly the case it was
     worst at judging: a round that genuinely ended level.

     What is left is the two cases with a real hazard behind them. No
     players, and there is no round to end. Mid round-entry, ending would
     bank a partial round — keeping whoever had confirmed and discarding
     every pending value with no way back, since pending was never in the
     log to undo. A marker pressed by mistake is what Undo is for. */
  document.getElementById("endRound").disabled =
    !players.length || (roundEntry && !allLockedIn());
  document.getElementById("diagToggle").textContent =
    BUILD + (storageOk ? "" : "  \u00b7 no storage");
  paintDiag();
}

function paintDiag() {
  const box = document.getElementById("diagbox");
  if (!box.classList.contains("on")) return;
  const v = viewport();
  const ins = EDGES.map(e => (safe[e] | 0)).join("/");
  const eff = EDGES.map(e => (bleedFor(e) | 0)).join("/");
  const deltas = log.filter(e => e.type === "delta").length;
  box.innerHTML =
    "build   <b>" + BUILD + "</b>\n" +
    "mode    " + (isStandalone() ? "standalone" : "browser") + "\n" +
    "inset   " + ins + " -> " + eff + "\n" +
    "vp      " + Math.round(v.w) + "x" + Math.round(v.h) +
      "   inner " + window.innerWidth + "x" + window.innerHeight + "\n" +
    "screen  " + screen.width + "x" + screen.height + "\n" +
    "storage " + (storageOk ? "ok" : "<span class='warn'>UNAVAILABLE</span>") +
      "   saved " + lastSave + "\n" +
    "state   " + players.length + " players, " + deltas + " scores";
}

document.getElementById("diagToggle").addEventListener("click", () => {
  const box = document.getElementById("diagbox");
  box.classList.toggle("on");
  paintDiag();
});

document.getElementById("undo").addEventListener("click", () => undoLast(null));
document.getElementById("roundentry").addEventListener("click", () => {
  if (roundEntry) cancelRoundEntry(); else startRoundEntry();
});
document.getElementById("endRound").addEventListener("click", endRound);
document.getElementById("rounds").addEventListener("click", () => openSheet("rounds"));
document.getElementById("game").addEventListener("click", () => openSheet("game"));
document.getElementById("arrange").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  arrangeMode = b.dataset.arrange === "on";
  Array.prototype.forEach.call(e.currentTarget.children,
    c => c.setAttribute("aria-pressed", String(c === b)));
});

/* ============================================================
   Players sheet - center, unrotated, native inputs are fine here
   ============================================================ */

let sheetView = "players";
function openSheet(view) {
  sheetView = view || "players";
  sheet.classList.add("on");
  sheet.classList.toggle("wide", sheetView === "rounds");
  scrim.classList.add("on"); paintSheet();
}
function closeSheet() { sheet.classList.remove("on"); scrim.classList.remove("on"); closeEmoji(); }

function paintGame() {
  const seg = (act, opts) => '<div class="seg">' + opts.map(o =>
    '<button data-act="' + act + '" data-v="' + o[0] + '"' +
    (o[2] ? ' aria-pressed="true"' : "") + ">" + o[1] + "</button>").join("") + "</div>";

  sheet.innerHTML =
    "<h2>Game</h2>" +
    '<div class="setting"><span>Winner</span>' +
      seg("win", [["high", "Highest", prefs.winCondition === "high"],
                  ["low",  "Lowest",  prefs.winCondition === "low"]]) + "</div>" +
    '<div class="setting"><span>First round is</span>' +
      '<div class="stepper">' +
        '<button data-act="rnum" data-v="-1" aria-label="Fewer">\u2212</button>' +
        "<b>" + prefs.startRound + "</b>" +
        '<button data-act="rnum" data-v="1" aria-label="More">+</button>' +
      "</div></div>" +
    '<div class="setting"><span>Keep screen awake</span>' +
      seg("lock", [["on", "On", prefs.wakeLock], ["off", "Off", !prefs.wakeLock]]) + "</div>" +
    '<div class="setting"><span>Dim when idle</span>' +
      seg("ambient", [["on", "On", prefs.ambient], ["off", "Off", !prefs.ambient]]) + "</div>" +
    '<div class="btns">' +
      '<button class="btn" data-act="reset"' + (log.length ? "" : " disabled") + ">Reset scores</button>" +
      '<button class="btn" data-act="wipe">Start over</button>' +
    "</div>" +
    '<button class="btn" data-act="done">Done</button>';
}

function paintRounds() {
  const table = roundTable();
  const head = "<tr><th>#</th>" + players.map(pl =>
    "<th><span class='he'>" + pl.emoji + "</span>" +
    "<span class='hn'>" + esc(pl.name) + "</span></th>").join("") + "</tr>";
  const body = table.map(r => '<tr><td class="rn">' + r.n + "</td>" +
      players.map(pl => "<td>" + (r.scores[pl.id] || 0) + "</td>").join("") + "</tr>").join("");
  const live = '<tr class="live"><td class="rn">' + roundNo() + "</td>" +
      players.map(pl => "<td>" + (roundScores[pl.id] || 0) + "</td>").join("") + "</tr>";
  const sum = '<tr class="tot"><td class="rn">&Sigma;</td>' +
      players.map(pl => "<td>" + (totals[pl.id] || 0) + "</td>").join("") + "</tr>";

  sheet.innerHTML =
    "<h2>Rounds</h2>" +
    (players.length
      ? '<div class="gridwrap"><table class="rounds">' + head + body + live + sum + "</table></div>"
      : '<div class="lead">No players yet.</div>') +
    '<div class="btns">' +
      '<button class="btn" data-act="players">Players</button>' +
      '<button class="btn" data-act="done">Done</button>' +
    "</div>";
  requestAnimationFrame(sizeRoundsColumns);
}

/* One width for every player column, worked out rather than left to the
   browser. Auto layout gives leftover space to whichever column asked for
   the least, which put a 219px gutter under "#" beside four equal columns —
   so the fill is computed here instead: take the widest column's content,
   cap it so one long name cannot drag the rest wide, then widen to the
   share that fills the wrapper when there is room to. Too many players and
   the share goes below the content width, at which point the table scrolls,
   which is what it is in a scroller for.

   A frame late on purpose: nothing in the sheet has a width until the sheet
   is laid out, and a zero means it is not yet — in which case leave the
   columns alone rather than pinning them to nothing. */
function sizeRoundsColumns() {
  const t = sheet.querySelector("table.rounds");
  if (!t) return;
  const n = players.length;
  if (!n) return;
  t.style.removeProperty("--rcol");
  /* The stretch has to come off to measure content: with min-width: 100%
     still on, what gets measured is the stretch and every table of short
     names comes back at the cap. */
  t.style.minWidth = "0";
  let w = 0;
  t.querySelectorAll("th:not(:first-child), td:not(:first-child)")
   .forEach(c => { w = Math.max(w, c.getBoundingClientRect().width); });
  const first = t.querySelector("tr:first-child th:first-child");
  const roundW = first ? first.getBoundingClientRect().width : 0;
  const avail = t.parentElement.clientWidth;
  t.style.removeProperty("min-width");
  if (!w) return;
  const cap = parseFloat(getComputedStyle(t).getPropertyValue("--rcol-max")) || 210;
  const fair = (avail - roundW) / n;
  /* Floored, so a rounded-up share cannot overflow into a scrollbar the
     table does not need. */
  t.style.setProperty("--rcol", Math.floor(Math.max(Math.min(w, cap), fair)) + "px");
}

function paintSheet() {
  if (sheetView === "rounds") return paintRounds();
  if (sheetView === "game") return paintGame();
  const rows = players.map(p =>
    '<div class="prow2" data-id="' + p.id + '">' +
      '<button class="emo" data-act="emoji" style="background:' + p.color +
        ';color:' + (inkIsLight(p.color) ? "#fff" : INK_DARK) + '" ' +
        'aria-label="Choose emoji">' + p.emoji + "</button>" +
      '<input class="col" data-act="color" type="color" value="' + p.color + '" aria-label="Color">' +
      '<button class="tsize" data-act="tsize" aria-label="Text size" title="Text size">' +
        (p.textSize === "large" ? "A" : "a") + "</button>" +
      '<input value="' + esc(p.name) + '" data-act="name" maxlength="24" ' +
        'aria-label="Name" enterkeyhint="done">' +
      '<button class="kill" data-act="remove" aria-label="Remove">✕</button>' +
    '</div>'
  ).join("");

  sheet.innerHTML =
    "<h2>Players</h2>" +
    '<div class="plist">' + rows + "</div>" +
    '<div class="btns">' +
      '<button class="btn primary" data-act="add"' + (players.length >= MAX_PLAYERS ? " disabled" : "") + ">Add player</button>" +
      '<button class="btn" data-act="done">Done</button>' +
    "</div>" +

    (players.length >= MAX_PLAYERS ? '<div class="lead">Sixteen is the cap.</div>' : "");
}

sheet.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (!b || b.tagName === "INPUT") return;
  const act = b.dataset.act;
  const row = b.closest("[data-id]");
  const rowId = row ? row.dataset.id : null;

  if (act === "add")    { addPlayer(); rebuildTabs(); commit(); paintSheet(); return; }
  if (act === "done")   { closeSheet(); return; }
  if (act === "emoji") { openEmoji(rowId); return; }
  if (act === "tsize") {
    const pl = players.find(x => x.id === rowId);
    if (pl) { pl.textSize = pl.textSize === "large" ? "normal" : "large"; commit(); paintSheet(); }
    return;
  }
  if (act === "ambient") { prefs.ambient = b.dataset.v === "on"; save(); wake(); paintSheet(); return; }
  if (act === "win")  { prefs.winCondition = b.dataset.v; save(); commit(); paintSheet(); return; }
  if (act === "rnum") {
    prefs.startRound = clamp(prefs.startRound + parseInt(b.dataset.v, 10), 0, 99);
    save(); commit(); paintSheet(); return;
  }
  if (act === "game") { sheetView = "game"; sheet.classList.remove("wide"); paintSheet(); return; }
  if (act === "lock") {
    prefs.wakeLock = b.dataset.v === "on";
    save();
    if (prefs.wakeLock) acquireWakeLock(); else dropWakeLock();
    paintSheet();
    return;
  }
  if (act === "players") { sheetView = "players"; sheet.classList.remove("wide"); paintSheet(); return; }
  if (act === "reset")  { log = []; commit(); paintSheet(); return; }
  if (act === "wipe") {
    players = []; log = [];
    try { localStorage.removeItem(STORE); } catch (err) {}
    ["Ann", "Rai", "Bo", "Kit"].forEach(n => addPlayer(n));
    autoArrange();
    rebuildTabs(); commit(); paintSheet();
    return;
  }
  if (act === "remove") { removePlayer(rowId); rebuildTabs(); commit(); paintSheet(); return; }
});

const emopop = document.getElementById("emopop");
let emojiFor = null;

function openEmoji(id) {
  emojiFor = id;
  emopop.classList.add("on");
  paintEmoji();
}
function closeEmoji() { emojiFor = null; emopop.classList.remove("on"); }

function paintEmoji() {
  const p = players.find(x => x.id === emojiFor);
  if (!p) return closeEmoji();
  emopop.innerHTML =
    "<h2>Emoji for " + esc(p.name) + "</h2>" +
    '<div class="egrid">' +
      ANIMALS.map(a => '<button data-e="' + a + '"' +
        (a === p.emoji ? ' aria-pressed="true"' : "") + ">" + a + "</button>").join("") +
    "</div>" +
    '<div class="custom">' +
      '<input id="emocustom" value="' + esc(p.emoji) + '" aria-label="Any character" ' +
        'autocomplete="off" autocorrect="off" autocapitalize="off" enterkeyhint="done">' +
      '<button class="btn" data-e-act="done">Done</button>' +
    "</div>";
}

emopop.addEventListener("click", e => {
  const cell = e.target.closest("[data-e]");
  const act = e.target.closest("[data-e-act]");
  const p = players.find(x => x.id === emojiFor);
  if (!p) return;
  if (cell) {
    p.emoji = cell.dataset.e;
    commit(); closeEmoji(); paintSheet();
    return;
  }
  if (act) { closeEmoji(); paintSheet(); }
});

/* Anything the grid does not offer can still be typed. */
emopop.addEventListener("input", e => {
  if (e.target.id !== "emocustom") return;
  const p = players.find(x => x.id === emojiFor);
  const g = firstGrapheme(e.target.value);
  if (!p || !g) return;
  p.emoji = g;
  commit();
});

/* Emoji can be several code points — a ZWJ sequence, a flag — so take
   the first grapheme rather than the first character. */
function firstGrapheme(str) {
  const s = String(str || "").trim();
  if (!s) return "";
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    for (const g of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)) {
      return g.segment;
    }
  }
  return Array.from(s)[0] || "";
}

/* No paintSheet from here: rebuilding the list would steal the caret. */
sheet.addEventListener("input", e => {
  const inp = e.target.closest("input[data-act]");
  const row = inp && inp.closest("[data-id]");
  if (!row) return;
  const p = players.find(x => x.id === row.dataset.id);
  if (!p) return;

  if (inp.dataset.act === "name") {
    p.name = inp.value;
  } else if (inp.dataset.act === "color") {
    p.color = inp.value;
    /* type=color streams input events for the whole drag, so repainting
       the sheet here would tear the picker's own row out from under it.
       The tab repaints itself in render; only this swatch needs poking.
       (The selector used to say `input`, which this has not been since it
       became a button — so the swatch quietly stopped following.) */
    const emo = row.querySelector('button[data-act="emoji"]');
    if (emo) {
      emo.style.background = p.color;
      emo.style.color = inkIsLight(p.color) ? "#fff" : INK_DARK;
    }
    p.el.style.background = p.color;
    paintInk(p.el, p.color);
  }
  commit();
});

document.getElementById("manage").addEventListener("click", openSheet);

/* ============================================================
   Boot
   ============================================================ */

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    readSafeInsets(); layout(true);
    /* The breakpoint changes the type size, which changes what "widest"
       means, so the columns have to be measured again. */
    if (sheetView === "rounds" && sheet.classList.contains("on")) sizeRoundsColumns();
  }, 80);
});
window.addEventListener("orientationchange", () =>
  setTimeout(() => { readSafeInsets(); layout(true); }, 250));

probeStorage();
readSafeInsets();
if (!load()) {
  ["Ann", "Rai", "Bo", "Kit"].forEach(n => addPlayer(n));
  autoArrange();          // fresh game: spread evenly
}
rebuildTabs();
commit();
scheduleAmbient();
acquireWakeLock();

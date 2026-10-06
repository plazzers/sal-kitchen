// Kitchen timers: several can run at once. They keep counting while you read
// another recipe, and are remembered if the app is closed and opened again.
// When one finishes: a beep (if the device allows sound) and a vibration.

const STORE_KEY = 'sal-timers';
let timers = load();
let tickHandle = null;
let audioCtx = null;
let ringHandle = null;
const listeners = new Set();

function load() {
  try {
    const t = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(t) ? t.filter((x) => x && typeof x.endAt === 'number') : [];
  } catch (e) {
    return [];
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(timers)); } catch (e) { /* fine */ }
}

// ---------- Finding times in a step ----------

// "12 to 15 minutes" → [12, 15]; "1 hour" → [60]; "30 seconds" → [0.5]
export function findTimes(text) {
  const out = [];
  const re = /(\d+(?:\s+\d\/\d|\.\d+)?)(?:\s*(?:to|-|–)\s*(\d+(?:\.\d+)?))?\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/gi;
  let m;
  const num = (s) => {
    const f = String(s).match(/^(\d+)\s+(\d)\/(\d)$/);
    return f ? +f[1] + +f[2] / +f[3] : parseFloat(s);
  };
  while ((m = re.exec(text))) {
    const unit = m[3].toLowerCase();
    const mult = unit.startsWith('h') ? 60 : unit.startsWith('s') ? 1 / 60 : 1;
    [m[1], m[2]].filter(Boolean).forEach((v) => {
      const minutes = Math.round(num(v) * mult * 60) / 60;
      if (minutes > 0 && minutes <= 24 * 60 && !out.includes(minutes)) out.push(minutes);
    });
  }
  return out;
}

export function durationLabel(minutes) {
  if (minutes < 1) return `${Math.round(minutes * 60)} sec`;
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes - h * 60);
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }
  return `${minutes} min`;
}

export function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ---------- Sound ----------

// Must be called from a tap (browsers only allow sound after the user touches the page).
export function unlockSound() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // A silent blip "unlocks" sound on iPhone.
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    g.gain.value = 0;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.01);
  } catch (e) { /* no sound on this device */ }
}

function beep() {
  try {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [0, 0.28, 0.56].forEach((offset, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, now + offset);
      g.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + offset);
      o.stop(now + offset + 0.25);
    });
  } catch (e) { /* ignore */ }
}

function vibrate() {
  try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]); } catch (e) { /* ignore */ }
}

// Keep ringing every few seconds (for up to 2 minutes) until every finished timer is dismissed.
function ring() {
  if (ringHandle) return;
  let count = 0;
  const go = () => {
    if (!timers.some((t) => t.done) || count++ > 40) {
      clearInterval(ringHandle);
      ringHandle = null;
      return;
    }
    beep();
    if (count % 3 === 1) vibrate();
  };
  go();
  ringHandle = setInterval(go, 3000);
}

// ---------- Timers ----------

function emit(finished = []) {
  listeners.forEach((fn) => fn(timers, finished));
}

function tick() {
  const now = Date.now();
  const finished = [];
  for (const t of timers) {
    if (!t.done && t.endAt <= now) {
      t.done = true;
      finished.push(t);
    }
  }
  if (finished.length) {
    save();
    ring();
  }
  if (!timers.some((t) => !t.done) && tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  emit(finished);
}

function ensureTicking() {
  if (!tickHandle && timers.some((t) => !t.done)) tickHandle = setInterval(tick, 500);
}

export function startTimer(minutes, label) {
  unlockSound();
  const t = {
    id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    label,
    minutes,
    endAt: Date.now() + minutes * 60000,
    done: false,
  };
  timers.push(t);
  save();
  ensureTicking();
  emit();
  return t;
}

export function removeTimer(id) {
  timers = timers.filter((t) => t.id !== id);
  save();
  emit();
}

export function list() {
  return timers.slice();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Catch up after the phone was asleep.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tick();
});

ensureTicking();
if (timers.length) setTimeout(tick, 0);

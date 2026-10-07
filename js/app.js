import './sha256.js';
import * as db from './db.js';
import { APP_NAME, YOUTUBE_URL, STORE_URL, SUPPORT_EMAIL } from '../config.js';
import * as packs from './packs.js';
import { toRid } from './migrate.js';
import { scaleLineParts, scaleLine } from './scale.js';
import * as timers from './timers.js';
import { icon } from './icons.js';
import { esc, uid, formatDate, debounce, fold, isIOS, isAndroid, downloadBlob, shareFile, isoDay, copyText } from './util.js';
import * as install from './install.js';
import * as weeks from './weeks.js';
import { surprisePicks } from './plan.js';
import { mealMoney, dollars } from './money.js';
import { combineLines, isPantryLine, pantryNames, PANTRY_OPTIONS } from './merge.js';

const APP_VERSION = '3.0';
const PLAN_FACTORS = [0.5, 1, 2, 3]; // per-meal amounts in the planner
const STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6]; // what − and + move between
const PRESETS = [0.5, 1, 2, 3];
const GREETING = "Grate your own cheese. Taste before you serve. Let's cook.";
const NOT_AFFILIATED = 'Recipes are inspired by popular restaurant dishes. Not affiliated with or endorsed by any restaurant.';

const main = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const listBtn = document.getElementById('list-btn');
const listCount = document.getElementById('list-count');
const settingsBtn = document.getElementById('settings-btn');
const planBtn = document.getElementById('plan-btn') || makePlanButton();
const toastEl = document.getElementById('toast');
const tray = document.getElementById('timer-tray');

let unlocked = false; // this device was unlocked at some point (meta 'unlocked')
let favorites = new Set(); // recipe ids, "copycat:5"
let shopping = db.emptyShopping();
let view = { name: null, cleanup: [] };
const home = { q: '', chip: 'all', lib: 'all', scroll: 0 }; // lib: 'all' or a pack id
// Planner settings (meta 'planSettings'), pantry staples (meta 'pantry'), savings total (store 'savings').
let planSettings = { weekStart: 'mon', lunch: false, hideMoney: false, combined: false };
let pantry = { ids: [], custom: [] };
let savingsTotal = 0;
const planner = { start: null }; // first day of the week on screen
const planWeeks = new Map(); // ISO week → { week, days: { 'YYYY-MM-DD': { dinner, lunch } } }

// A cached page from v1 may not have the Plan button yet.
function makePlanButton() {
  const a = document.createElement('a');
  a.className = 'header-btn';
  a.href = '#/plan';
  a.id = 'plan-btn';
  a.hidden = true;
  a.setAttribute('aria-label', 'Week plan');
  a.innerHTML = `${icon('calendar')}<span class="header-btn__label">Plan</span>`;
  const list = document.getElementById('list-btn');
  list.parentNode.insertBefore(a, list);
  return a;
}

// The recipes and chapters of every pack that's open on this device (see js/packs.js).
// A recipe's id is "<pack>:<number>" (r.rid); r.num is its number inside its pack.
let RECIPES = [];
let CHAPTERS = [];
let byRid = new Map();
let chapterByKey = new Map();

function rebuildIndex() {
  const open = packs.openPacks();
  RECIPES = open.flatMap((p) => p.recipes);
  CHAPTERS = open.flatMap((p) => p.chapters);
  byRid = new Map(RECIPES.map((r) => [r.rid, r]));
  chapterByKey = new Map(CHAPTERS.map((c) => [c.key, c]));
  if (home.lib !== 'all' && !packs.catalogEntry(home.lib)) home.lib = 'all';
}

const ready = () => RECIPES.length > 0;
const chapterOf = (r) => chapterByKey.get(`${r.pack}:${r.chapter}`);
const chapterTitleOf = (r) => (chapterOf(r) || {}).title || '';
const packLabel = (id) => (packs.catalogEntry(id) || { label: id }).label;
const multiPack = () => packs.openPacks().length > 1;

// ====================================================================
//  Helpers
// ====================================================================

function toast(msg, ms = 2800) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function setChrome({ title, back = null, nav = true }) {
  document.title = title ? `${title} — Sal's Kitchen` : "Sal's Kitchen — Chef Sal Romano";
  backBtn.hidden = !back;
  backBtn.onclick = back ? () => { location.hash = back; } : null;
  listBtn.hidden = !nav;
  settingsBtn.hidden = !nav;
  planBtn.hidden = !nav;
  const page = (location.hash.replace(/^#\/?/, '').split('/')[0]) || '';
  [[planBtn, 'plan'], [listBtn, 'list'], [settingsBtn, 'settings']].forEach(([b, p]) => {
    if (page === p) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  updateListBadge();
}

const onPhone = () => isIOS() || isAndroid();

function chipLabel(ch) {
  return ch.title.replace(/^The\s+/, '').replace(/\s+Chains$/, '');
}

// "4" → "Serves 4"; "12 breadsticks" → "Makes 12 breadsticks"
function servesText(r, factor = 1) {
  const base = /^\d+$/.test(r.serves.trim()) ? `Serves ${r.serves}` : `Makes ${r.serves}`;
  return factor === 1 ? base : `${base} (${prettyFactor(factor)})`;
}

function prettyFactor(f) {
  const whole = Math.floor(f);
  const frac = f - whole;
  const fr = Math.abs(frac - 0.5) < 1e-6 ? '½' : Math.abs(frac - 0.25) < 1e-6 ? '¼' : Math.abs(frac - 0.75) < 1e-6 ? '¾' : '';
  return `×${whole || !fr ? whole : ''}${fr}`;
}

function scaledHtml(line, factor) {
  return scaleLineParts(line, factor)
    .map((p) => (p.scaled ? `<strong class="qty">${esc(p.text)}</strong>` : esc(p.text)))
    .join('');
}

const pantrySet = () => pantryNames(pantry.ids, pantry.custom);

// Items still to buy. Pantry staples ("You probably have these") don't count.
function shoppingRemaining() {
  const names = pantrySet();
  let n = 0;
  shopping.groups.forEach((g) => g.items.forEach((i) => { if (!i.checked && !isPantryLine(i.text, names)) n++; }));
  shopping.custom.forEach((i) => { if (!i.checked) n++; });
  return n;
}

function updateListBadge() {
  const n = shoppingRemaining();
  listCount.hidden = !n;
  listCount.textContent = n > 99 ? '99+' : String(n);
  listBtn.setAttribute('aria-label', n ? `Shopping list, ${n} item${n === 1 ? '' : 's'} to buy` : 'Shopping list');
}

async function saveShopping() {
  updateListBadge();
  try {
    await db.setMeta('shopping', JSON.parse(JSON.stringify(shopping)));
  } catch (e) {
    console.error(e);
    toast("Couldn't save. Your device may be out of space.", 5000);
  }
}

async function toggleFavorite(rid) {
  if (favorites.has(rid)) favorites.delete(rid);
  else favorites.add(rid);
  try {
    await db.setMeta('favorites', [...favorites]);
  } catch (e) {
    console.error(e);
  }
  return favorites.has(rid);
}

async function loadProgress(rid) {
  const p = (await db.getProgress(rid)) || {};
  return { rid, ticks: p.ticks || [], done: p.done || [], factor: typeof p.factor === 'number' ? p.factor : 1 };
}

let progressChain = Promise.resolve();
function saveProgress(p) {
  const copy = JSON.parse(JSON.stringify(p));
  progressChain = progressChain.then(() => db.putProgress(copy)).catch((e) => console.error(e));
  return progressChain;
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch (e) { /* not supported — fine */ }
}

function timerButtons(text, labelPrefix, small = false) {
  const times = timers.findTimes(text);
  if (!times.length) return '';
  return `<div class="timer-btns${small ? ' timer-btns--small' : ''}">${times
    .map((m) => `<button type="button" class="timer-start" data-timer="${m}" data-label="${esc(labelPrefix)}">${icon('timer')}<span>${small ? '' : 'Start '}${esc(timers.durationLabel(m))}${small ? '' : ' timer'}</span></button>`)
    .join('')}</div>`;
}

function startTimerFrom(btn) {
  const minutes = parseFloat(btn.dataset.timer);
  const label = `${btn.dataset.label} · ${timers.durationLabel(minutes)}`;
  timers.startTimer(minutes, label);
  toast(`Timer started: ${timers.durationLabel(minutes)}`);
}

// ====================================================================
//  Timer tray (shown on every screen while a timer runs)
// ====================================================================

let trayKey = '';
function renderTray() {
  const list = timers.list();
  const show = ready() && list.length > 0;
  tray.hidden = !show;
  document.body.classList.toggle('has-timers', show);
  if (!show) {
    trayKey = '';
    document.documentElement.style.setProperty('--tray-h', '0px');
    return;
  }
  const key = list.map((t) => `${t.id}:${t.done}`).join('|');
  if (key !== trayKey) {
    trayKey = key;
    tray.innerHTML = `<h2 class="visually-hidden">Kitchen timers</h2>` + list.map((t) => `
      <div class="timer${t.done ? ' timer--done' : ''}" data-id="${t.id}">
        <span class="timer__icon">${icon(t.done ? 'bell' : 'timer')}</span>
        <span class="timer__body">
          <span class="timer__time" data-time></span>
          <span class="timer__label">${esc(t.label)}</span>
        </span>
        <button type="button" class="timer__btn" data-timer-remove="${t.id}" aria-label="${t.done ? 'Dismiss' : 'Cancel'} timer ${esc(t.label)}">${t.done ? 'OK' : 'Cancel'}</button>
      </div>`).join('');
  }
  const now = Date.now();
  list.forEach((t) => {
    const el = tray.querySelector(`[data-id="${t.id}"] [data-time]`);
    if (el) el.textContent = t.done ? 'Time’s up!' : timers.clock(t.endAt - now);
  });
  document.documentElement.style.setProperty('--tray-h', `${tray.offsetHeight}px`);
}

tray.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-timer-remove]');
  if (btn) timers.removeTimer(btn.dataset.timerRemove);
});

timers.subscribe((list, finished) => {
  renderTray();
  if (finished && finished.length) toast(`Time’s up: ${finished.map((t) => t.label).join(', ')}`, 8000);
});

// ====================================================================
//  Router
// ====================================================================

let keepScroll = false;

async function route() {
  view.cleanup.forEach((fn) => fn());
  view = { name: null, cleanup: [] };
  document.body.classList.remove('cooking', 'page-plan');

  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);

  renderTray();
  if (!ready()) {
    // No recipes open on this device yet.
    if (!packs.anyFileAvailable()) return renderUpdating();
    if (!unlocked) return renderUnlock();
    // Unlocked before v3 (or the pack got a new key): ask for the code once more.
    // The shopping list doesn't need the recipes, so it stays open.
    if (parts[0] === 'list') return renderList();
    return renderReentry();
  }

  try {
    if (parts[0] === 'settings') return await renderSettings();
    if (parts[0] === 'list') return renderList();
    if (parts[0] === 'plan') return await renderPlan();
    if ((parts[0] === 'recipe' || parts[0] === 'cook') && parts[1]) {
      // "#/recipe/copycat:5"; old links "#/recipe/5" mean copycat:5.
      const r = byRid.get(toRid(parts[1]));
      if (!r) {
        toast('That recipe was not found.');
        location.replace('#/');
        return;
      }
      if (parts[0] === 'cook') return await renderCook(r, Number(parts[2]) || 1);
      return await renderRecipe(r);
    }
    return renderHome();
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="card"><h1>Something went wrong</h1><p>${esc(e.message || e)}</p><p><a class="btn" href="#/">Go to the start</a></p></div>`;
  }
}

function afterRender(focusSelector) {
  if (keepScroll) {
    keepScroll = false;
    return;
  }
  window.scrollTo(0, 0);
  const target = focusSelector && main.querySelector(focusSelector);
  if (target) target.focus({ preventScroll: true });
  else main.focus({ preventScroll: true });
}

function refresh() {
  keepScroll = true;
  return route();
}

// ====================================================================
//  1. Unlock
// ====================================================================

const CODE_HELP = `
      <p>Your access code is printed in the <strong>PDF</strong> you downloaded from Payhip when you bought Sal's Kitchen (or Sal's Italian Kitchen). Open the PDF and look near the front.</p>
      <p>Can't find the PDF? Look for the email from Payhip that was sent right after your purchase — it has the download link. Check your spam or "Promotions" folder too.</p>
      <p>You only need to enter the code once on each phone, tablet or computer.</p>
      <p>Still stuck? Email <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a> and we'll help you out.</p>`;

const WRONG_CODE = "That code didn't work. Please check it and try again — dashes count, but upper or lower case doesn't matter.";

// Check a code and open every pack it unlocks. Used by the welcome screen, the one-time
// re-entry screen, the locked-pack cards and Settings.
//   form: a <form> with an <input>, a .error and a submit button. onDone(openedIds) runs on success.
function wireCodeForm(form, { onDone, noneMessage = WRONG_CODE }) {
  const input = form.querySelector('input');
  const err = form.querySelector('.error');
  const btn = form.querySelector('button[type="submit"]');
  const btnText = btn.innerHTML;
  const fail = (msg) => {
    err.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    const code = SalHash.normalizeCode(input.value);
    err.textContent = '';
    input.removeAttribute('aria-invalid');
    if (!code) return fail('Please type your access code.');
    if (!(await packs.passesPrecheck(code))) return fail(WRONG_CODE);
    btn.disabled = true;
    form.setAttribute('aria-busy', 'true');
    const say = (text) => { btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(text)}`; };
    say('Checking your code…');
    let opened = [];
    try {
      opened = await packs.unlockWithCode(code, { onProgress: (p) => say(`Opening ${p.title}…`) });
    } catch (ex) {
      console.error(ex);
    }
    btn.disabled = false;
    form.removeAttribute('aria-busy');
    btn.innerHTML = btnText;
    if (!opened.length) {
      const waiting = packs.CATALOG.some((p) => !packs.isOpen(p.id) && packs.fileStatus(p.id) !== 'ok');
      return fail(waiting ? 'Your code looks right, but those recipes are still on their way. Please try again in a little while.' : noneMessage);
    }
    input.value = '';
    if (!unlocked) await db.setMeta('unlocked', { at: new Date().toISOString() });
    unlocked = true;
    rebuildIndex();
    requestPersistentStorage();
    onDone(opened);
  });
}

function codeFormHtml(id, buttonText, placeholder = 'For example SAL-XXXX-XXXX') {
  return `<form class="code-form" novalidate>
      <label for="${id}">Enter your access code</label>
      <input type="text" id="${id}" name="code" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false"
        placeholder="${esc(placeholder)}" aria-describedby="${id}-error">
      <p id="${id}-error" class="error" role="alert"></p>
      <button class="btn btn--big" type="submit">${buttonText}</button>
    </form>`;
}

const goHome = () => {
  if (location.hash && location.hash !== '#/') location.hash = '#/';
  else route();
};

function renderUnlock() {
  setChrome({ title: 'Enter your access code', nav: false });
  main.innerHTML = `
  <section class="unlock">
    <img class="unlock__avatar" src="assets/sal-avatar.png" alt="Chef Sal Romano" width="128" height="128">
    <p class="eyebrow">Chef Sal Romano</p>
    <h1>Welcome to Sal's Kitchen</h1>
    <p class="lede">Real restaurant food, made right in your own kitchen. Enter your code and let's cook.</p>
    ${codeFormHtml('code', 'Unlock the recipes')}
    <details class="help-box card">
      <summary>Where do I find my code?</summary>
      ${CODE_HELP}
    </details>
  </section>`;
  wireCodeForm(main.querySelector('.code-form'), {
    onDone: () => {
      toast('Benvenuti! The kitchen is open.');
      goHome();
    },
  });
  afterRender();
}

// For people who unlocked the app before v3: the recipes are now locked with the code itself,
// and we never saved their code. So, once, we ask for it again. Nothing they saved is touched.
function renderReentry() {
  setChrome({ title: 'Welcome back', nav: false });
  main.innerHTML = `
  <section class="unlock reentry">
    <img class="unlock__avatar" src="assets/sal-avatar.png" alt="Chef Sal Romano" width="128" height="128">
    <p class="eyebrow">Chef Sal Romano</p>
    <h1 tabindex="-1">Welcome back!</h1>
    <p class="lede">Quick one-time step: enter your access code again to load your recipes (it's in your Payhip PDF).</p>
    <div class="notice reentry__safe">
      <p>${icon('check')} Your favorites, ticks, week plans and shopping list are all still here, safe on this device.</p>
    </div>
    ${codeFormHtml('code', 'Load my recipes')}
    <details class="help-box card">
      <summary>Where do I find my code?</summary>
      ${CODE_HELP}
    </details>
    <details class="help-box card">
      <summary>Why do I need it again?</summary>
      <p>Sal's recipes now come in a locked box that only opens with a real code — so they stay for the people who bought the book. This phone already had the old key, but not the new one.</p>
      <p>After this, the recipes stay unlocked on this device, even with no internet. You won't be asked again.</p>
    </details>
    <p class="reentry__list"><a class="btn btn--ghost" href="#/list">${icon('cart')} Open my shopping list</a></p>
  </section>`;
  wireCodeForm(main.querySelector('.code-form'), {
    onDone: () => {
      toast('Grazie! Your recipes are back — and everything you saved is right where you left it.', 4500);
      goHome();
    },
  });
  afterRender('h1');
}

// No pack file could be loaded (a new version is being published, or offline on a first visit).
// Never a blank screen.
function renderUpdating() {
  setChrome({ title: 'Recipes are updating', nav: false });
  const offline = packs.CATALOG.some((p) => packs.fileStatus(p.id) === 'offline') || navigator.onLine === false;
  main.innerHTML = `
  <section class="unlock updating">
    <img class="unlock__avatar" src="assets/sal-avatar.png" alt="Chef Sal Romano" width="128" height="128">
    <p class="eyebrow">Chef Sal Romano</p>
    <h1 tabindex="-1">${offline ? 'No internet right now' : 'Recipes are updating'}</h1>
    <p class="lede">${offline
      ? "The recipes aren't saved on this device yet. Connect to the internet, then tap Try again."
      : 'Please reload in a minute. Sal is putting something new in the kitchen.'}</p>
    <p><button type="button" class="btn btn--big" data-action="retry">${icon('reset')} Try again</button></p>
    ${unlocked ? `<div class="notice"><p>${icon('check')} Your favorites, week plans and shopping list are safe on this device.</p></div>
    <p><a class="btn btn--ghost" href="#/list">${icon('cart')} Open my shopping list</a></p>` : ''}
    <p class="small muted">Still stuck after a few minutes? Email <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a>.</p>
  </section>`;
  const btn = main.querySelector('[data-action="retry"]');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Checking…';
    await loadPacks({ fresh: true });
    route();
  });
  afterRender('h1');
}

// ====================================================================
//  2. Home
// ====================================================================

async function installBannerHtml() {
  if (install.isStandalone()) return '';
  if (await db.getMeta('installBannerDismissed')) return '';
  const plat = install.platform();
  const steps = plat === 'ios' ? install.IPHONE_STEPS + install.IPHONE_DATA_NOTE : plat === 'android' ? install.ANDROID_STEPS : install.DESKTOP_STEPS;
  const quick = install.canPromptInstall() ? `<button type="button" class="btn btn--small" data-action="install-now">${icon('phone')} Install app</button>` : '';
  return `<section class="banner banner--compact" id="install-banner" aria-labelledby="install-title">
    <h2 id="install-title">${plat === 'ios' ? 'Put Sal on your iPhone' : 'Keep Sal in your kitchen'}</h2>
    <p>Install Sal's Kitchen on your ${plat === 'desktop' ? 'computer' : 'Home Screen'} so it opens like a regular app — even with no internet.</p>
    <details class="banner__how"><summary>Show me how</summary>${steps}</details>
    <div class="row">${quick}<button type="button" class="btn btn--secondary btn--small" data-action="dismiss-install">Got it, hide this</button></div>
  </section>`;
}

function recipeCard(r) {
  const fav = favorites.has(r.rid);
  return `<li class="rcard">
    <a class="rcard__link" href="#/recipe/${r.rid}">
      <span class="rcard__num">Nº ${r.num}</span>
      <span class="rcard__title">${esc(r.title)}</span>
      <span class="rcard__sub">${esc(r.subtitle)}</span>
      <span class="rcard__meta">
        <span>${icon('clock')}${esc(r.time)}</span>
        <span>${icon('people')}${esc(servesText(r))}</span>
        <span>${icon('tag')}${esc(r.cost)}</span>
      </span>
    </a>
    <button type="button" class="fav-btn" data-fav="${r.rid}" aria-pressed="${fav}" aria-label="Favorite: ${esc(r.title)}">${icon('heart')}</button>
  </li>`;
}

function matches(r, words) {
  if (!words.length) return true;
  if (!r._hay) r._hay = fold([r.title, r.subtitle, ...r.ingredients].join(' \n '));
  return words.every((w) => r._hay.includes(w));
}

// Recipes in the chosen library ('all' or one pack), filtered by search words and chip.
function filterRecipes({ q, chip, lib }) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  let list = RECIPES.filter((r) => (lib === 'all' || r.pack === lib) && matches(r, words));
  if (chip === 'fav') list = list.filter((r) => favorites.has(r.rid));
  else if (chip !== 'all') list = list.filter((r) => `${r.pack}:${r.chapter}` === chip);
  return { list, words };
}

// The tasteful "locked" card for a pack this device hasn't unlocked.
function lockedPackHtml(id) {
  const p = packs.catalogEntry(id);
  const n = packs.recipeCount(id);
  return `<section class="locked-pack" aria-labelledby="lp-${id}" data-locked="${id}">
    <p class="locked-pack__eyebrow">${icon('lock')} ${id === 'italian' ? 'New from Sal' : 'Recipe book'}</p>
    <h2 id="lp-${id}" class="locked-pack__title">${esc(p.title)}</h2>
    <p class="locked-pack__pitch"><strong>${esc(p.pitch.replace(/^\d+/, String(n)))}</strong> ${esc(p.codeHint)}</p>
    <div class="locked-pack__btns">
      <a class="btn" href="${esc(p.storeUrl)}" target="_blank" rel="noopener">${icon('store')} Get it</a>
      <button type="button" class="btn btn--secondary" data-action="have-code" data-pack="${id}" aria-expanded="false">${icon('lock')} I have a code</button>
    </div>
    <div class="locked-pack__form" hidden>${codeFormHtml(`code-${id}`, 'Unlock', 'Code from your purchase PDF')}</div>
  </section>`;
}

const lockedIds = () => packs.CATALOG.map((p) => p.id).filter((id) => !packs.isOpen(id));

function chapterSectionHtml(ch, items, words, sub) {
  const id = `ch-${ch.key.replace(':', '-')}`;
  const H = sub ? 'h3' : 'h2';
  return `<section class="chapter" aria-labelledby="${id}">
      <header class="chapter__head">
        <p class="chapter__num">Chapter ${ch.num}</p>
        <${H} id="${id}" class="chapter__title">${esc(ch.title)}</${H}>
        ${words.length || !ch.intro ? '' : `<p class="chapter__intro">“${esc(ch.intro)}”</p>`}
      </header>
      <ul class="rcard-list">${items.map(recipeCard).join('')}</ul>
    </section>`;
}

function resultsHtml() {
  if (home.lib !== 'all' && !packs.isOpen(home.lib)) return lockedPackHtml(home.lib);
  const { list, words } = filterRecipes(home);
  const lockedTail = home.lib === 'all' && !words.length && home.chip === 'all' ? lockedIds().map(lockedPackHtml).join('') : '';

  let head = '';
  if (words.length) {
    head = `<p class="result-count">${list.length ? `${list.length} recipe${list.length === 1 ? '' : 's'} with “${esc(home.q.trim())}”` : ''}</p>`;
  }
  if (!list.length) {
    if (home.chip === 'fav' && !words.length) {
      return `<p class="empty">${icon('heart')}<br>No favorites yet.<br>Tap the heart on any recipe and it will wait for you here.</p>`;
    }
    return `${head}<p class="empty">No recipes match “${esc(home.q.trim())}”${home.chip !== 'all' ? ' here' : ''}.<br>Try a single word, like <em>garlic</em> or <em>chicken</em>${home.chip !== 'all' ? ', or tap <strong>All recipes</strong>' : ''}.</p>${lockedTail}`;
  }

  // With more than one pack on screen, each pack gets its own heading.
  const shown = packs.openPacks().filter((p) => home.lib === 'all' || p.id === home.lib);
  const withHeads = shown.length > 1 && shown.filter((p) => list.some((r) => r.pack === p.id)).length > 1;
  return head + shown.map((p) => {
    const groups = p.chapters.map((ch) => ({ ch, items: list.filter((r) => r.pack === p.id && r.chapter === ch.num) })).filter((g) => g.items.length);
    if (!groups.length) return '';
    const body = groups.map(({ ch, items }) => chapterSectionHtml(ch, items, words, withHeads)).join('');
    return withHeads ? `<section class="pack-group" aria-labelledby="pg-${p.id}"><h2 id="pg-${p.id}" class="pack-group__title">${esc(p.title)}</h2>${body}</section>` : body;
  }).join('') + lockedTail;
}

function libSwitchHtml() {
  const tabs = [...packs.CATALOG.map((p) => [p.id, `${packs.isOpen(p.id) ? '' : icon('lock')}${esc(p.label)} (${packs.recipeCount(p.id)})`]), ['all', 'All']];
  return `<div class="seg seg--lib" role="group" aria-label="Recipe books">
    ${tabs.map(([k, label]) => `<button type="button" class="seg__btn" data-lib="${k}" aria-pressed="${home.lib === k}">${label}</button>`).join('')}
  </div>`;
}

function chipsHtml() {
  const chapters = CHAPTERS.filter((c) => home.lib === 'all' || c.pack === home.lib);
  const chips = [
    ['all', 'All recipes'],
    ['fav', `${icon('heart')} Favorites`],
    ...chapters.map((c) => [c.key, esc(chipLabel(c))]),
  ];
  return chips.map(([k, label]) => `<button type="button" class="chip" data-chip="${k}" aria-pressed="${home.chip === k}">${label}</button>`).join('');
}

const SAVINGS_LINES = [
  'Restaurant taste. Your prices. That’s the whole idea.',
  'That’s a nice dinner out you didn’t need.',
  'Keep cooking. The pot pays you back.',
];

function savingsHtml() {
  if (!moneyOn()) return '';
  if (savingsTotal < 0.5) {
    return `<section class="savings savings--start" aria-label="Your week plan">
      <p class="savings__line">${icon('calendar')} Plan your week, cook it, tap <strong>We made it</strong> — and watch what you keep add up.</p>
      <a class="btn btn--secondary btn--small" href="#/plan">Plan this week</a>
    </section>`;
  }
  const line = SAVINGS_LINES[Math.floor(savingsTotal) % SAVINGS_LINES.length];
  return `<section class="savings" aria-label="Money saved" id="savings-card">
    <p class="savings__big">You've kept <strong id="savings-total">~${dollars(savingsTotal)}</strong> in your pocket since you started cooking with Sal.</p>
    <p class="savings__sal">“${esc(line)}” <span class="muted">— Sal</span></p>
    <p class="small muted">Compared with a typical restaurant price, estimate. <a href="#/plan">Week plan</a></p>
  </section>`;
}

async function renderHome() {
  setChrome({ title: '' });
  const restoreScroll = home.scroll;
  if (home.chip !== 'all' && home.chip !== 'fav' && !chapterByKey.has(home.chip)) home.chip = 'all';
  main.innerHTML = `
    <section class="hello" aria-label="A word from Sal">
      <img class="hello__avatar" src="assets/sal-avatar.png" alt="" width="76" height="76">
      <div class="hello__body">
        <p class="hello__quote">“${esc(GREETING)}”</p>
        <p class="hello__sig">— Chef Sal Romano</p>
      </div>
    </section>
    ${savingsHtml()}
    <div id="install-slot">${await installBannerHtml()}</div>
    <div class="finder">
      ${libSwitchHtml()}
      <label for="q" class="visually-hidden">Search recipes or ingredients</label>
      <div class="search">
        ${icon('search')}
        <input type="search" id="q" placeholder="Search recipes or ingredients" autocomplete="off" enterkeyhint="search" value="${esc(home.q)}">
        <button type="button" class="search__clear" data-action="clear-search" aria-label="Clear search" ${home.q ? '' : 'hidden'}>${icon('close')}</button>
      </div>
      <div class="chips" role="group" aria-label="Show recipes from" id="chips">${chipsHtml()}</div>
    </div>
    <div id="results">${resultsHtml()}</div>
    <p class="section footnote">${esc(NOT_AFFILIATED)}</p>
  `;

  const results = main.querySelector('#results');
  const input = main.querySelector('#q');
  const clearBtn = main.querySelector('.search__clear');
  const redraw = () => { results.innerHTML = resultsHtml(); };
  const onInput = debounce(() => {
    home.q = input.value;
    clearBtn.hidden = !home.q;
    redraw();
  }, 150);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

  const onClick = async (e) => {
    const lib = e.target.closest('[data-lib]');
    if (lib) {
      if (home.lib === lib.dataset.lib) return;
      home.lib = lib.dataset.lib;
      home.chip = 'all';
      main.querySelectorAll('[data-lib]').forEach((b) => b.setAttribute('aria-pressed', String(b === lib)));
      main.querySelector('#chips').innerHTML = chipsHtml();
      redraw();
      return;
    }
    const have = e.target.closest('[data-action="have-code"]');
    if (have) {
      const card = have.closest('.locked-pack');
      const box = card.querySelector('.locked-pack__form');
      box.hidden = !box.hidden;
      have.setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) {
        const form = box.querySelector('form');
        if (!form.dataset.wired) {
          form.dataset.wired = '1';
          const id = card.dataset.locked;
          wireCodeForm(form, {
            noneMessage: `That code doesn't open ${packs.catalogEntry(id).title}. Use the code from the PDF of that purchase.`,
            onDone: (opened) => {
              const names = opened.map((x) => packs.catalogEntry(x).title).join(' and ');
              const n = opened.reduce((sum, x) => sum + packs.recipeCount(x), 0);
              toast(`${names} unlocked — ${n} new recipes. Buon appetito!`, 4500);
              if (opened.includes(id) && home.lib !== 'all') home.lib = id;
              refresh();
            },
          });
        }
        box.querySelector('input').focus();
      }
      return;
    }
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const on = await toggleFavorite(fav.dataset.fav);
      fav.setAttribute('aria-pressed', String(on));
      toast(on ? 'Saved to your favorites.' : 'Removed from favorites.');
      if (home.chip === 'fav') redraw();
      return;
    }
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      home.chip = chip.dataset.chip;
      main.querySelectorAll('[data-chip]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      redraw();
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'clear-search') {
      input.value = '';
      home.q = '';
      clearBtn.hidden = true;
      redraw();
      input.focus();
    } else if (btn.dataset.action === 'dismiss-install') {
      await db.setMeta('installBannerDismissed', true);
      const b = document.getElementById('install-banner');
      if (b) b.remove();
    } else if (btn.dataset.action === 'install-now') {
      if (await install.promptInstall()) {
        await db.setMeta('installBannerDismissed', true);
        const b = document.getElementById('install-banner');
        if (b) b.remove();
      }
    }
  };
  const onInstallAvailable = async () => {
    const slot = document.getElementById('install-slot');
    if (slot) slot.innerHTML = await installBannerHtml();
  };
  main.addEventListener('click', onClick);
  document.addEventListener('sal-install-available', onInstallAvailable);
  view.cleanup.push(() => {
    home.scroll = window.scrollY;
    main.removeEventListener('click', onClick);
    document.removeEventListener('sal-install-available', onInstallAvailable);
  });

  if (restoreScroll && !keepScroll) {
    main.focus({ preventScroll: true });
    requestAnimationFrame(() => window.scrollTo(0, restoreScroll));
    home.scroll = 0;
  } else {
    afterRender();
  }
}

// ====================================================================
//  3. Recipe
// ====================================================================

function nearestStep(f, dir) {
  if (dir > 0) return STEPS.find((s) => s > f + 1e-9) ?? f;
  return [...STEPS].reverse().find((s) => s < f - 1e-9) ?? f;
}

function ingredientsHtml(r, prog) {
  return r.ingredients.map((line, i) => {
    const on = prog.ticks.includes(i);
    return `<li><button type="button" class="ing" role="checkbox" aria-checked="${on}" data-ing="${i}">
      <span class="tickbox" aria-hidden="true">${icon('check')}</span>
      <span class="ing__text">${scaledHtml(line, prog.factor)}</span>
    </button></li>`;
  }).join('');
}

function addToShopping(r, factor) {
  const old = shopping.groups.find((g) => g.rid === r.rid);
  const items = r.ingredients.map((line) => {
    const text = scaleLine(line, factor);
    const prev = old && old.factor === factor && old.items.find((i) => i.text === text);
    return { text, checked: prev ? !!prev.checked : false };
  });
  const group = { id: old ? old.id : uid('g'), rid: r.rid, title: r.title, factor, items };
  if (old) shopping.groups[shopping.groups.indexOf(old)] = group;
  else shopping.groups.push(group);
  saveShopping();
  return !!old;
}

async function renderRecipe(r) {
  setChrome({ title: r.title, back: '#/' });
  const prog = await loadProgress(r.rid);
  const ch = chapterOf(r);
  const siblings = RECIPES.filter((x) => x.pack === r.pack);
  const idx = siblings.indexOf(r);
  const prev = siblings[idx - 1];
  const next = siblings[idx + 1];

  main.innerHTML = `
  <article class="recipe">
    <header class="recipe-head">
      <p class="eyebrow">${multiPack() ? `${esc(packLabel(r.pack))} · ` : ''}Nº ${r.num} · ${esc(ch ? ch.title : '')}</p>
      <h1 class="recipe-title" tabindex="-1">${esc(r.title)}</h1>
      <p class="recipe-sub">${esc(r.subtitle)}</p>
      <ul class="facts">
        <li>${icon('people')}<span><span class="facts__label">${/^\d+$/.test(r.serves.trim()) ? 'Serves' : 'Makes'}</span><span id="facts-serves">${esc(r.serves)}${prog.factor !== 1 ? ` (${prettyFactor(prog.factor)})` : ''}</span></span></li>
        <li>${icon('clock')}<span><span class="facts__label">Time</span>${esc(r.time)}</span></li>
        <li>${icon('tag')}<span><span class="facts__label">Cost at home</span>${esc(r.cost)}</span></li>
      </ul>
    </header>

    <div class="recipe-actions">
      <a class="btn btn--big" href="#/cook/${r.rid}">${icon('play')} Start cooking mode</a>
      <div class="actions-2">
        <button type="button" class="btn btn--secondary fav-toggle" data-action="fav" aria-pressed="${favorites.has(r.rid)}">${icon('heart')}<span>${favorites.has(r.rid) ? 'Saved' : 'Favorite'}</span></button>
        <button type="button" class="btn btn--secondary" data-action="add-list">${icon('cart')}<span>Add to shopping list</span></button>
        <button type="button" class="btn btn--secondary actions-2__wide" data-action="add-plan">${icon('calendar')}<span>Add to plan</span></button>
      </div>
    </div>

    <section class="card scaler" aria-labelledby="scale-title">
      <h2 id="scale-title" class="scaler__title">How much are you making?</h2>
      <div class="scaler__row">
        <button type="button" class="round-btn" data-action="dec" aria-label="Make less">${icon('minus')}</button>
        <output class="scaler__out" id="factor-out" aria-live="polite">${prettyFactor(prog.factor)}</output>
        <button type="button" class="round-btn" data-action="inc" aria-label="Make more">${icon('plus')}</button>
      </div>
      <div class="presets" role="group" aria-label="Quick amounts">
        ${PRESETS.map((f) => `<button type="button" class="chip chip--preset" data-factor="${f}" aria-pressed="${prog.factor === f}">${prettyFactor(f)}</button>`).join('')}
      </div>
      <p class="scaler__serves" id="serves-line">${esc(servesText(r, prog.factor))}</p>
      <p class="small muted scaler__note" id="scale-note" ${prog.factor === 1 ? 'hidden' : ''}>New amounts are in <strong class="qty">bold</strong>. The steps below still show the amounts for the original recipe.</p>
    </section>

    <section class="section" aria-labelledby="ing-title">
      <div class="section-head">
        <h2 id="ing-title">Ingredients</h2>
        <span class="muted small" id="ing-count"></span>
      </div>
      <p class="hint">Tap each one as you get it out.</p>
      <ul class="ing-list" id="ing-list">${ingredientsHtml(r, prog)}</ul>
      <p><button type="button" class="btn btn--ghost btn--small" data-action="reset">${icon('reset')} Clear ticks</button></p>
    </section>

    <section class="section" aria-labelledby="method-title">
      <h2 id="method-title">Method</h2>
      <p class="hint">Tap a step when it's done.</p>
      <ol class="step-list">
        ${r.steps.map((s, i) => `<li class="step-item">
          <button type="button" class="step" aria-pressed="${prog.done.includes(i)}" data-step="${i}">
            <span class="step__num" aria-hidden="true">${i + 1}</span>
            <span class="step__text"><span class="visually-hidden">Step ${i + 1}: </span>${esc(s)}</span>
          </button>
          ${timerButtons(s, `${r.title} · Step ${i + 1}`, true)}
        </li>`).join('')}
      </ol>
    </section>

    <aside class="sal-says" aria-label="Sal says">
      <img class="sal-says__avatar" src="assets/sal-avatar.png" alt="" width="64" height="64">
      <div>
        <p class="sal-says__label">Sal says</p>
        <blockquote class="sal-says__quote">${esc(r.tip)}</blockquote>
      </div>
    </aside>

    <p class="section"><a class="btn btn--big" href="#/cook/${r.rid}">${icon('play')} Start cooking mode</a></p>

    <nav class="recipe-nav" aria-label="More recipes">
      ${prev ? `<a class="recipe-nav__link" href="#/recipe/${prev.rid}">${icon('back')}<span><span class="small muted">Previous</span><br>${esc(prev.title)}</span></a>` : '<span></span>'}
      ${next ? `<a class="recipe-nav__link recipe-nav__link--next" href="#/recipe/${next.rid}"><span><span class="small muted">Next</span><br>${esc(next.title)}</span>${icon('next')}</a>` : ''}
    </nav>
  </article>`;

  const ingList = main.querySelector('#ing-list');
  const countEl = main.querySelector('#ing-count');
  const updateCount = () => { countEl.textContent = `${prog.ticks.length} of ${r.ingredients.length} ready`; };
  updateCount();

  const saveFactor = debounce(() => saveProgress(prog), 300);
  const setFactor = (f) => {
    prog.factor = f;
    ingList.innerHTML = ingredientsHtml(r, prog);
    main.querySelector('#factor-out').textContent = prettyFactor(f);
    main.querySelector('#serves-line').textContent = servesText(r, f);
    main.querySelector('#facts-serves').textContent = `${r.serves}${f !== 1 ? ` (${prettyFactor(f)})` : ''}`;
    main.querySelector('#scale-note').hidden = f === 1;
    main.querySelectorAll('[data-factor]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.factor) === f)));
    main.querySelector('[data-action="dec"]').disabled = f <= STEPS[0];
    main.querySelector('[data-action="inc"]').disabled = f >= STEPS[STEPS.length - 1];
    saveFactor();
  };
  main.querySelector('[data-action="dec"]').disabled = prog.factor <= STEPS[0];
  main.querySelector('[data-action="inc"]').disabled = prog.factor >= STEPS[STEPS.length - 1];

  const onClick = async (e) => {
    const t = e.target;
    const ing = t.closest('[data-ing]');
    if (ing) {
      const i = Number(ing.dataset.ing);
      const on = !prog.ticks.includes(i);
      prog.ticks = on ? [...prog.ticks, i] : prog.ticks.filter((x) => x !== i);
      ing.setAttribute('aria-checked', String(on));
      updateCount();
      saveProgress(prog);
      return;
    }
    const step = t.closest('[data-step]');
    if (step) {
      const i = Number(step.dataset.step);
      const on = !prog.done.includes(i);
      prog.done = on ? [...prog.done, i] : prog.done.filter((x) => x !== i);
      step.setAttribute('aria-pressed', String(on));
      saveProgress(prog);
      return;
    }
    const tb = t.closest('[data-timer]');
    if (tb) return startTimerFrom(tb);
    const preset = t.closest('[data-factor]');
    if (preset) return setFactor(Number(preset.dataset.factor));
    const btn = t.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'inc' || a === 'dec') setFactor(nearestStep(prog.factor, a === 'inc' ? 1 : -1));
    else if (a === 'reset') {
      prog.ticks = [];
      prog.done = [];
      main.querySelectorAll('[data-ing]').forEach((b) => b.setAttribute('aria-checked', 'false'));
      main.querySelectorAll('[data-step]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      updateCount();
      saveProgress(prog);
      toast('Ticks cleared.');
    } else if (a === 'fav') {
      const on = await toggleFavorite(r.rid);
      btn.setAttribute('aria-pressed', String(on));
      btn.querySelector('span').textContent = on ? 'Saved' : 'Favorite';
      toast(on ? 'Saved to your favorites.' : 'Removed from favorites.');
    } else if (a === 'add-list') {
      const updated = addToShopping(r, prog.factor);
      toast(updated ? `Shopping list updated (${prettyFactor(prog.factor)}).` : `Added ${r.ingredients.length} items to your shopping list.`);
    } else if (a === 'add-plan') {
      openAddToPlan(r, prog.factor);
    }
  };
  main.addEventListener('click', onClick);
  view.cleanup.push(() => main.removeEventListener('click', onClick));
  afterRender('.recipe-title');
}

// ====================================================================
//  4. Cooking mode
// ====================================================================

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      return true;
    }
  } catch (e) { /* not allowed right now */ }
  return false;
}
function releaseAwake() {
  try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
  wakeLock = null;
}

async function renderCook(r, startStep) {
  setChrome({ title: `Cooking: ${r.title}`, back: `#/recipe/${r.rid}`, nav: false });
  document.body.classList.add('cooking');
  const prog = await loadProgress(r.rid);
  const total = r.steps.length;
  let idx = Math.min(Math.max(1, startStep), total + 1); // total + 1 = the "finished" screen
  let countedMade = false;

  main.innerHTML = `
  <div class="cook">
    <div class="cook-bar">
      <a class="cook-bar__btn" href="#/recipe/${r.rid}">${icon('close')}<span>Exit</span></a>
      <p class="cook-bar__title">${esc(r.title)}</p>
      <button type="button" class="cook-bar__btn" data-action="ings" aria-haspopup="dialog">${icon('list')}<span>Ingredients</span></button>
    </div>
    <div class="cook-progress" aria-hidden="true"><span id="cook-fill"></span></div>
    <section class="cook-step" id="cook-step" aria-live="polite"></section>
    <p class="cook-wake small muted" id="wake-note"></p>
    <nav class="cook-nav" aria-label="Steps">
      <button type="button" class="btn btn--secondary cook-nav__btn" data-action="prev">${icon('back')} Previous</button>
      <button type="button" class="btn cook-nav__btn" data-action="next">Next step ${icon('next')}</button>
    </nav>
    <div class="drawer-backdrop" id="drawer" hidden>
      <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div class="drawer__head">
          <h2 id="drawer-title">Ingredients${prog.factor !== 1 ? ` <span class="muted small">${prettyFactor(prog.factor)}</span>` : ''}</h2>
          <button type="button" class="round-btn" data-action="close-ings" aria-label="Close ingredients">${icon('close')}</button>
        </div>
        <ul class="ing-list ing-list--drawer">${ingredientsHtml(r, prog)}</ul>
      </div>
    </div>
  </div>`;

  const stepEl = main.querySelector('#cook-step');
  const fill = main.querySelector('#cook-fill');
  const prevBtn = main.querySelector('[data-action="prev"]');
  const nextBtn = main.querySelector('[data-action="next"]');
  const drawer = main.querySelector('#drawer');

  function show(focus) {
    const finished = idx > total;
    fill.style.width = `${Math.round(((finished ? total : idx) / total) * 100)}%`;
    if (finished) {
      stepEl.innerHTML = `
        <p class="cook-step__count">All ${total} steps done</p>
        <h2 class="cook-done__title" tabindex="-1">Buon appetito!</h2>
        <aside class="sal-says sal-says--cook" aria-label="Sal says">
          <img class="sal-says__avatar" src="assets/sal-avatar.png" alt="" width="64" height="64">
          <div><p class="sal-says__label">Sal says</p><blockquote class="sal-says__quote">${esc(r.tip)}</blockquote></div>
        </aside>
        <p><a class="btn btn--secondary btn--block" href="#/recipe/${r.rid}">Back to the recipe</a></p>
        <p><a class="btn btn--ghost btn--block" href="#/">All recipes</a></p>`;
      if (!countedMade) {
        countedMade = true;
        markCookedToday(r).then(madeToast).catch((e) => console.error(e));
      }
    } else {
      const text = r.steps[idx - 1];
      stepEl.innerHTML = `
        <p class="cook-step__count">Step ${idx} of ${total}</p>
        <p class="cook-step__text" tabindex="-1">${esc(text)}</p>
        ${timerButtons(text, `${r.title} · Step ${idx}`)}`;
    }
    prevBtn.disabled = idx <= 1;
    nextBtn.hidden = finished;
    nextBtn.innerHTML = idx === total ? `Finish ${icon('check')}` : `Next step ${icon('next')}`;
    history.replaceState(null, '', `#/cook/${r.rid}/${idx}`);
    if (focus) {
      const f = stepEl.querySelector('[tabindex="-1"]');
      if (f) f.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  const go = (d) => {
    const n = Math.min(Math.max(1, idx + d), total + 1);
    if (n === idx) return;
    idx = n;
    show(true);
  };

  let lastFocus = null;
  const openDrawer = () => {
    lastFocus = document.activeElement;
    drawer.hidden = false;
    document.body.classList.add('drawer-open');
    drawer.querySelector('[data-action="close-ings"]').focus();
  };
  const closeDrawer = () => {
    drawer.hidden = true;
    document.body.classList.remove('drawer-open');
    if (lastFocus) lastFocus.focus();
  };

  const onClick = (e) => {
    const t = e.target;
    if (t === drawer) return closeDrawer();
    const ing = t.closest('[data-ing]');
    if (ing) {
      const i = Number(ing.dataset.ing);
      const on = !prog.ticks.includes(i);
      prog.ticks = on ? [...prog.ticks, i] : prog.ticks.filter((x) => x !== i);
      ing.setAttribute('aria-checked', String(on));
      saveProgress(prog);
      return;
    }
    const tb = t.closest('[data-timer]');
    if (tb) return startTimerFrom(tb);
    const btn = t.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'prev') go(-1);
    else if (a === 'next') {
      timers.unlockSound();
      go(1);
    } else if (a === 'ings') openDrawer();
    else if (a === 'close-ings') closeDrawer();
  };
  const onKey = (e) => {
    if (!drawer.hidden) {
      if (e.key === 'Escape') closeDrawer();
      return;
    }
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };
  // Swipe left/right on the step to move between steps.
  let touchX = null;
  let touchY = null;
  const onTouchStart = (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; };
  const onTouchEnd = (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };
  const onVisible = () => { if (document.visibilityState === 'visible') keepAwake(); };

  main.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  stepEl.addEventListener('touchstart', onTouchStart, { passive: true });
  stepEl.addEventListener('touchend', onTouchEnd);
  document.addEventListener('visibilitychange', onVisible);
  view.cleanup.push(() => {
    main.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    document.body.classList.remove('drawer-open');
    releaseAwake();
  });

  show(false);
  afterRender('.cook-step__text, .cook-done__title');
  const awake = await keepAwake();
  const note = main.querySelector('#wake-note');
  if (note) {
    note.textContent = awake
      ? 'Your screen will stay on while you cook.'
      : 'Tip: your screen may dim while you cook — tap it now and then to keep it on.';
  }
}

// ====================================================================
//  5. Shopping list
// ====================================================================

// What the list shows: per-recipe (default) or combined, with pantry staples set aside.
// Every row has a key that leads back to the saved items:
//   g:<group id>:<index>   one item of a recipe
//   m:<key>,<key>,…        a combined row (several items added up)
function listModel() {
  const names = pantrySet();
  const pantryRows = [];
  const sections = [];
  const rowFor = (keys, text, items, sub = '') => ({ key: keys.length > 1 ? `m:${keys.join(',')}` : keys[0], text, checked: items.every((i) => i.checked), sub });
  if (planSettings.combined) {
    const lines = [];
    shopping.groups.forEach((g) => g.items.forEach((it, i) => lines.push({ text: it.text, ref: `g:${g.id}:${i}` })));
    const rows = combineLines(lines).map((c) => {
      const items = c.refs.map(findShopItem).filter(Boolean);
      const titles = [...new Set(c.refs.map((ref) => (shopping.groups.find((g) => g.id === ref.split(':')[1]) || {}).title).filter(Boolean))];
      return rowFor(c.refs, c.text, items, titles.join(' + '));
    });
    const visible = rows.filter((r) => !isPantryLine(r.text, names));
    pantryRows.push(...rows.filter((r) => isPantryLine(r.text, names)));
    if (visible.length) sections.push({ id: 'combined', title: 'Everything you need', rows: visible });
  } else {
    shopping.groups.forEach((g) => {
      const rows = g.items.map((it, i) => rowFor([`g:${g.id}:${i}`], it.text, [it], g.title));
      pantryRows.push(...rows.filter((r) => isPantryLine(r.text, names)));
      sections.push({ id: g.id, group: g, rows: rows.filter((r) => !isPantryLine(r.text, names)) });
    });
  }
  return { sections, pantryRows };
}

function findShopItem(key) {
  const [kind, id, i] = key.split(':');
  if (kind === 'c') return shopping.custom.find((x) => x.id === id);
  const g = shopping.groups.find((x) => x.id === id);
  return g && g.items[Number(i)];
}

function findShopItems(key) {
  if (key.startsWith('m:')) return key.slice(2).split(',').map(findShopItem).filter(Boolean);
  const it = findShopItem(key);
  return it ? [it] : [];
}

function shoppingText() {
  const anyLeft = shoppingRemaining() > 0;
  const keep = (i) => !anyLeft || !i.checked;
  const lines = ["Sal's Kitchen — Shopping list", ''];
  const { sections, pantryRows } = listModel();
  sections.forEach((sec) => {
    const rows = sec.rows.filter(keep);
    if (!rows.length) return;
    const g = sec.group;
    lines.push(g ? `${g.title}${g.factor !== 1 ? ` (${prettyFactor(g.factor)})` : ''}` : sec.title);
    rows.forEach((i) => lines.push(`☐ ${i.text}`));
    lines.push('');
  });
  const extras = shopping.custom.filter(keep);
  if (extras.length) {
    lines.push('Also');
    extras.forEach((i) => lines.push(`☐ ${i.text}`));
    lines.push('');
  }
  const pan = pantryRows.filter((i) => !i.checked);
  if (pan.length) {
    lines.push('Check the pantry');
    pan.forEach((i) => lines.push(`☐ ${i.text}`));
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

function shopItemHtml(item, key, sub = '') {
  return `<li><button type="button" class="ing shop-item" role="checkbox" aria-checked="${!!item.checked}" data-item="${esc(key)}">
    <span class="tickbox" aria-hidden="true">${icon('check')}</span>
    <span class="ing__text">${esc(item.text)}${sub ? `<span class="shop-from">${esc(sub)}</span>` : ''}</span>
  </button></li>`;
}

function showCopyDialog(text) {
  const prevFocus = document.activeElement;
  const el = document.createElement('div');
  el.className = 'drawer-backdrop';
  el.innerHTML = `<div class="drawer" role="dialog" aria-modal="true" aria-labelledby="copy-title">
    <div class="drawer__head"><h2 id="copy-title">Copy your list</h2>
      <button type="button" class="round-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <p>Press and hold in the box, choose <strong>Select All</strong>, then <strong>Copy</strong>. Paste it into a text message or email.</p>
    <textarea class="copy-box" readonly rows="10"></textarea>
  </div>`;
  el.querySelector('textarea').value = text;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); if (prevFocus) prevFocus.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
  const ta = el.querySelector('textarea');
  ta.focus();
  ta.select();
}

function renderList() {
  setChrome({ title: 'Shopping list', back: '#/' });
  const empty = !shopping.groups.length && !shopping.custom.length;
  const { sections, pantryRows } = listModel();
  const groupsHtml = sections.map((sec) => {
    const g = sec.group;
    if (!g) {
      return `<section class="list-group" aria-labelledby="lg-combined">
        <div class="list-group__head"><h2 id="lg-combined">${esc(sec.title)}</h2></div>
        <ul class="ing-list">${sec.rows.map((r) => shopItemHtml(r, r.key, r.sub)).join('')}</ul>
      </section>`;
    }
    return `
    <section class="list-group" aria-labelledby="lg-${esc(g.id)}">
      <div class="list-group__head">
        <h2 id="lg-${esc(g.id)}">${g.rid ? `<a href="#/recipe/${esc(g.rid)}">${esc(g.title)}</a>` : esc(g.title)}${g.factor !== 1 ? ` <span class="factor-pill">${prettyFactor(g.factor)}</span>` : ''}</h2>
        <button type="button" class="icon-btn no-print" data-remove-group="${esc(g.id)}" aria-label="Remove ${esc(g.title)} from the list">${icon('trash')}</button>
      </div>
      ${sec.rows.length ? `<ul class="ing-list">${sec.rows.map((r) => shopItemHtml(r, r.key)).join('')}</ul>` : '<p class="small muted">Nothing to buy here — you probably have it all.</p>'}
    </section>`;
  }).join('');
  const viewToggle = shopping.groups.length ? `
    <div class="seg no-print" role="group" aria-label="Show the list">
      <button type="button" class="seg__btn" data-list-view="recipe" aria-pressed="${!planSettings.combined}">By recipe</button>
      <button type="button" class="seg__btn" data-list-view="combined" aria-pressed="${!!planSettings.combined}">Combined</button>
    </div>
    ${planSettings.combined ? '<p class="small muted no-print">Same ingredients from different recipes are added up when that\'s safe. The rest stay as they are.</p>' : ''}` : '';
  const pantryHtml = pantryRows.length ? `
    <details class="list-group pantry-box" id="pantry-box">
      <summary><span>You probably have these</span> <span class="muted small">(${pantryRows.length})</span></summary>
      <p class="small muted">Your pantry staples. Change them in <a href="#/settings">Settings</a>.</p>
      <ul class="ing-list">${pantryRows.map((r) => shopItemHtml(r, r.key, planSettings.combined ? r.sub : '')).join('')}</ul>
    </details>` : '';
  const customHtml = shopping.custom.length ? `
    <section class="list-group" aria-labelledby="lg-custom">
      <div class="list-group__head"><h2 id="lg-custom">My extras</h2></div>
      <ul class="ing-list">${shopping.custom.map((it) => shopItemHtml(it, `c:${it.id}`)).join('')}</ul>
    </section>` : '';

  main.innerHTML = `
    <h1 class="page-title" tabindex="-1">Shopping list</h1>
    <p class="print-only print-date">Sal's Kitchen · ${esc(formatDate(new Date().toISOString()))}</p>
    <form class="add-row no-print" id="add-form">
      <label for="new-item" class="visually-hidden">Add something to the list</label>
      <input type="text" id="new-item" placeholder="Add something else (e.g. paper towels)" autocomplete="off" enterkeyhint="done">
      <button type="submit" class="btn">${icon('plus')}<span>Add</span></button>
    </form>
    ${empty ? `<p class="empty">${icon('cart')}<br>Your list is empty.<br>Open a recipe and tap <strong>Add to shopping list</strong>, or make one from your week plan.</p><div class="actions-2"><a class="btn btn--secondary" href="#/">${icon('book')} Browse recipes</a><a class="btn btn--secondary" href="#/plan">${icon('calendar')} Week plan</a></div>` : `
      <p class="muted small no-print" id="list-status"></p>
      <div class="list-actions no-print">
        <button type="button" class="btn" data-action="share">${icon('share')} Share list</button>
        <button type="button" class="btn btn--secondary" data-action="print">${icon('print')} Print</button>
        <button type="button" class="btn btn--secondary" data-action="clear-checked">${icon('check')} Clear checked</button>
        <button type="button" class="btn btn--danger" data-action="clear-all">${icon('trash')} Clear all</button>
      </div>
      ${viewToggle}
      ${groupsHtml}${customHtml}${pantryHtml}`}
  `;

  const status = main.querySelector('#list-status');
  const updateStatus = () => {
    if (!status) return;
    const left = shoppingRemaining();
    status.textContent = left ? `${left} item${left === 1 ? '' : 's'} left to get. Tap an item when it's in your cart.` : 'All done — everything is checked off.';
  };
  updateStatus();

  const onSubmit = (e) => {
    e.preventDefault();
    const input = main.querySelector('#new-item');
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    shopping.custom.push({ id: uid('c'), text, checked: false });
    saveShopping();
    toast(`Added “${text}”.`);
    refresh().then(() => { const i = main.querySelector('#new-item'); if (i) i.focus(); });
  };

  const onClick = async (e) => {
    const t = e.target;
    const itemBtn = t.closest('[data-item]');
    if (itemBtn) {
      const items = findShopItems(itemBtn.dataset.item);
      if (!items.length) return;
      const on = !items.every((i) => i.checked);
      items.forEach((i) => { i.checked = on; });
      itemBtn.setAttribute('aria-checked', String(on));
      saveShopping();
      updateStatus();
      return;
    }
    const lv = t.closest('[data-list-view]');
    if (lv) {
      const combined = lv.dataset.listView === 'combined';
      if (combined === !!planSettings.combined) return;
      planSettings.combined = combined;
      await savePlanSettings();
      refresh();
      return;
    }
    const rg = t.closest('[data-remove-group]');
    if (rg) {
      const g = shopping.groups.find((x) => x.id === rg.dataset.removeGroup);
      if (!g) return;
      shopping.groups = shopping.groups.filter((x) => x !== g);
      saveShopping();
      toast(`${g.title} removed from the list.`);
      refresh();
      return;
    }
    const btn = t.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'share') {
      const text = shoppingText();
      if (navigator.share) {
        try {
          await navigator.share({ title: "Shopping list — Sal's Kitchen", text });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      if (await copyText(text)) toast('List copied. Paste it into a text message or email.', 4000);
      else showCopyDialog(text);
    } else if (a === 'print') {
      window.print();
    } else if (a === 'clear-checked') {
      shopping.groups.forEach((g) => { g.items = g.items.filter((i) => !i.checked); });
      shopping.groups = shopping.groups.filter((g) => g.items.length);
      shopping.custom = shopping.custom.filter((i) => !i.checked);
      saveShopping();
      toast('Checked items cleared.');
      refresh();
    } else if (a === 'clear-all') {
      if (!confirm('Clear the whole shopping list?')) return;
      shopping = db.emptyShopping();
      saveShopping();
      toast('Shopping list cleared.');
      refresh();
    }
  };
  const form = main.querySelector('#add-form');
  form.addEventListener('submit', onSubmit);
  main.addEventListener('click', onClick);
  view.cleanup.push(() => main.removeEventListener('click', onClick));
  afterRender('.page-title');
}

// ====================================================================
//  6. Week planner
// ====================================================================

const MEAL_LABEL = { lunch: 'Lunch', dinner: 'Dinner' };
const meals = () => (planSettings.lunch ? ['lunch', 'dinner'] : ['dinner']);
const moneyOn = () => !planSettings.hideMoney;

async function savePlanSettings() {
  try { await db.setMeta('planSettings', { ...planSettings }); } catch (e) { console.error(e); }
}

async function savePantry() {
  try { await db.setMeta('pantry', { ids: [...pantry.ids], custom: [...pantry.custom] }); } catch (e) { console.error(e); }
  updateListBadge();
}

async function loadSavingsTotal() {
  const list = await db.listSavings();
  savingsTotal = list.reduce((sum, x) => sum + (Number(x.saved) || 0), 0);
  return savingsTotal;
}

async function ensureWeeks(dates) {
  const keys = [...new Set(dates.map(weeks.isoWeekKey))].filter((k) => !planWeeks.has(k));
  const recs = await Promise.all(keys.map((k) => db.getPlanWeek(k)));
  keys.forEach((k, i) => {
    const r = recs[i];
    planWeeks.set(k, r && r.days && typeof r.days === 'object' ? r : { week: k, days: {} });
  });
}

function getSlot(date, meal) {
  const rec = planWeeks.get(weeks.isoWeekKey(date));
  const day = rec && rec.days[date];
  return (day && day[meal]) || null;
}

let planChain = Promise.resolve();
async function setSlots(changes) {
  // changes: [[date, meal, slot | null], …] — saved together, one record per ISO week.
  await ensureWeeks(changes.map((c) => c[0]));
  const touched = new Set();
  for (const [date, meal, slot] of changes) {
    const key = weeks.isoWeekKey(date);
    const rec = planWeeks.get(key);
    const day = { ...(rec.days[date] || {}) };
    if (slot) day[meal] = slot;
    else delete day[meal];
    if (Object.keys(day).length) rec.days[date] = day;
    else delete rec.days[date];
    touched.add(key);
  }
  const copies = [...touched].map((k) => JSON.parse(JSON.stringify(planWeeks.get(k))));
  planChain = planChain.then(() => Promise.all(copies.map((c) => db.putPlanWeek(c)))).catch((e) => {
    console.error(e);
    toast("Couldn't save. Your device may be out of space.", 5000);
  });
  return planChain;
}

const setSlot = (date, meal, slot) => setSlots([[date, meal, slot]]);

function currentWeekStart() {
  return weeks.startOfWeek(weeks.today(), planSettings.weekStart);
}

function weekTitle(start) {
  const diff = Math.round((weeks.fromDay(start) - weeks.fromDay(currentWeekStart())) / 86400000 / 7);
  if (diff === 0) return 'This week';
  if (diff === 1) return 'Next week';
  if (diff === -1) return 'Last week';
  return diff > 0 ? `In ${diff} weeks` : `${-diff} weeks ago`;
}

// Everything planned in the 7 days, in order: [{ date, meal, slot, recipe }]
function plannedMeals(days) {
  const out = [];
  days.forEach((date) => meals().forEach((meal) => {
    const slot = getSlot(date, meal);
    if (slot && byRid.get(slot.rid)) out.push({ date, meal, slot, recipe: byRid.get(slot.rid) });
  }));
  return out;
}

function weekMoney(days) {
  const t = { home: 0, restaurant: 0, saved: 0, unpriced: 0 };
  plannedMeals(days).forEach(({ slot, recipe }) => {
    if (slot.leftover) return; // already counted on the day it was cooked
    const m = mealMoney(recipe, slot.factor || 1);
    if (!m.priced) t.unpriced++;
    t.home += m.home;
    t.restaurant += m.restaurant;
  });
  t.saved = Math.max(0, t.restaurant - t.home);
  return t;
}

function slotHtml(date, meal) {
  const slot = getSlot(date, meal);
  const r = slot && byRid.get(slot.rid);
  const label = `<p class="slot__meal">${MEAL_LABEL[meal]}</p>`;
  const where = `${weeks.dayName(date)} ${MEAL_LABEL[meal].toLowerCase()}`;
  if (!r) {
    return `<div class="slot slot--empty" data-date="${date}" data-meal="${meal}">
      ${label}
      <div class="slot__btns">
        <button type="button" class="btn btn--secondary btn--small" data-action="pick" aria-label="Add a recipe to ${esc(where)}">${icon('plus')} Add a recipe</button>
        <button type="button" class="btn btn--ghost btn--small" data-action="leftovers" aria-label="Leftovers for ${esc(where)}">Leftovers</button>
      </div>
    </div>`;
  }
  const canDrag = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const isPastOrToday = date <= weeks.today();
  const moveBtn = `<button type="button" class="btn btn--ghost btn--small" data-action="move" aria-label="Move ${esc(r.title)} to another day">${icon('move')} Move to…</button>`;
  const removeBtn = `<button type="button" class="icon-btn" data-action="remove" aria-label="Remove ${esc(r.title)} from ${esc(where)}">${icon('trash')}</button>`;
  if (slot.leftover) {
    return `<div class="slot slot--leftover" data-date="${date}" data-meal="${meal}"${canDrag ? ' draggable="true"' : ''}>
      ${label}
      <p class="slot__title">Leftovers from ${esc(weeks.dayName(slot.leftover.date))}</p>
      <p class="slot__sub"><a href="#/recipe/${r.rid}">${esc(r.title)}</a> · nothing to shop</p>
      <div class="slot__btns">${moveBtn}${removeBtn}</div>
    </div>`;
  }
  const f = slot.factor || 1;
  const money = moneyOn() ? (() => { const m = mealMoney(r, f); return ` · ~${dollars(m.home)} at home`; })() : '';
  return `<div class="slot${slot.made ? ' slot--made' : ''}" data-date="${date}" data-meal="${meal}"${canDrag ? ' draggable="true"' : ''}>
    ${label}
    <p class="slot__title"><a href="#/recipe/${r.rid}">${esc(r.title)}</a></p>
    <p class="slot__sub">${esc(servesText(r, f))}${money}</p>
    <div class="slot__factors" role="group" aria-label="How much for ${esc(where)}">
      ${PLAN_FACTORS.map((x) => `<button type="button" class="chip chip--mini" data-plan-factor="${x}" aria-pressed="${f === x}">${prettyFactor(x)}</button>`).join('')}
    </div>
    <div class="slot__btns">
      ${isPastOrToday ? `<button type="button" class="btn btn--small ${slot.made ? 'btn--made' : 'btn--secondary'}" data-action="made" aria-pressed="${!!slot.made}">${icon('check')} ${slot.made ? 'Made it' : 'We made it'}</button>` : ''}
      ${moveBtn}${removeBtn}
    </div>
  </div>`;
}

function dayHtml(date) {
  const isToday = date === weeks.today();
  const any = meals().some((m) => getSlot(date, m));
  return `<section class="plan-day${isToday ? ' plan-day--today' : ''}" data-day="${date}" aria-labelledby="pd-${date}">
    <div class="plan-day__head">
      <h2 id="pd-${date}">${esc(weeks.dayName(date))} <span class="plan-day__date">${esc(weeks.shortDate(date))}</span>${isToday ? ' <span class="today-pill">Today</span>' : ''}</h2>
      ${any ? `<button type="button" class="btn btn--ghost btn--small" data-action="clear-day" data-date="${date}" aria-label="Clear ${esc(weeks.dayName(date))}">Clear day</button>` : ''}
    </div>
    ${meals().map((m) => slotHtml(date, m)).join('')}
  </section>`;
}

function moneyFooterHtml(days) {
  if (!moneyOn()) return '';
  const t = weekMoney(days);
  const note = t.unpriced ? `<p class="small muted" data-money="unpriced">${t.unpriced} planned meal${t.unpriced === 1 ? " doesn't" : "s don't"} have a price estimate yet, so ${t.unpriced === 1 ? "it isn't" : "they aren't"} counted.</p>` : '';
  if (!t.home && !t.restaurant) {
    return `<section class="money-foot" aria-label="Money this week" id="money-foot"><p class="money-foot__line">Plan a few dinners and I'll show you what you keep.</p>${note}</section>`;
  }
  return `<section class="money-foot" aria-label="Money this week" id="money-foot">
    <p class="money-foot__line">This week at home: <strong data-money="home">~${dollars(t.home)}</strong>. At a restaurant: <strong data-money="restaurant">~${dollars(t.restaurant)}</strong>. You keep <strong class="money-foot__keep" data-money="keep">~${dollars(t.saved)}</strong>.</p>
    <p class="small muted">Restaurant numbers are a typical restaurant price, estimate — not a quote. Home costs are Sal's estimates. Tax and tip not included.</p>
    ${note}
  </section>`;
}

function menuText(days) {
  const lines = [`This week's menu (${weeks.rangeLabel(days[0])})`, ''];
  days.forEach((date) => {
    const parts = meals().map((meal) => {
      const slot = getSlot(date, meal);
      const r = slot && byRid.get(slot.rid);
      if (!r) return null;
      const what = slot.leftover ? `Leftovers (${r.title})` : `${r.title}${(slot.factor || 1) !== 1 ? ` (${prettyFactor(slot.factor)})` : ''}`;
      return planSettings.lunch ? `${MEAL_LABEL[meal]}: ${what}` : what;
    }).filter(Boolean);
    if (parts.length) lines.push(`${weeks.dayName(date)} — ${parts.join(' · ')}`);
  });
  lines.push('', "Cooked with Sal's Kitchen");
  return lines.join('\n') + '\n';
}

async function shareText(title, text, copiedMsg) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  if (await copyText(text)) toast(copiedMsg, 4000);
  else showCopyDialog(text);
}

// A bottom sheet / dialog. Returns { el, close }.
function openSheet(title, bodyHtml, onClick) {
  const prevFocus = document.activeElement;
  const el = document.createElement('div');
  el.className = 'drawer-backdrop';
  const id = uid('sheet');
  el.innerHTML = `<div class="drawer" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="drawer__head"><h2 id="${id}">${title}</h2>
      <button type="button" class="round-btn" data-close aria-label="Close">${icon('close')}</button></div>
    ${bodyHtml}
  </div>`;
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('drawer-open');
    if (prevFocus && prevFocus.isConnected) prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-close]')) return close();
    onClick(e, close);
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
  document.body.classList.add('drawer-open');
  view.cleanup.push(() => { if (el.isConnected) close(); });
  const first = el.querySelector('input, [data-pick], [data-choose]') || el.querySelector('[data-close]');
  first.focus();
  return { el, close };
}

// "+" → searchable recipe picker with chapter chips.
function openRecipePicker(where, onPick) {
  const state = { q: '', chip: 'all' };
  const chips = [['all', 'All'], ['fav', `${icon('heart')} Favorites`], ...CHAPTERS.map((c) => [c.key, esc(chipLabel(c))])];
  const listHtml = () => {
    const { list } = filterRecipes({ q: state.q, chip: state.chip, lib: 'all' });
    if (!list.length) return '<p class="empty">Nothing matches. Try one word, like <em>chicken</em>.</p>';
    return `<ul class="pick-list">${list.map((r) => `<li><button type="button" class="pick" data-pick="${r.rid}">
      <span class="pick__title">${esc(r.title)}</span>
      <span class="pick__meta">${multiPack() ? `${esc(packLabel(r.pack))} · ` : ''}${esc(chipLabel(chapterOf(r) || { title: '' }))} · ${esc(r.time)} · ${esc(servesText(r))}</span>
    </button></li>`).join('')}</ul>`;
  };
  const sheet = openSheet(`Add to ${esc(where)}`, `
    <div class="search">${icon('search')}
      <label for="pick-q" class="visually-hidden">Search recipes</label>
      <input type="search" id="pick-q" placeholder="Search recipes or ingredients" autocomplete="off" enterkeyhint="search">
    </div>
    <div class="chips chips--sheet" role="group" aria-label="Show recipes from">
      ${chips.map(([k, label]) => `<button type="button" class="chip" data-pchip="${k}" aria-pressed="${k === 'all'}">${label}</button>`).join('')}
    </div>
    <div id="pick-results">${listHtml()}</div>`, (e, close) => {
    const chip = e.target.closest('[data-pchip]');
    if (chip) {
      state.chip = chip.dataset.pchip;
      sheet.el.querySelectorAll('[data-pchip]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      sheet.el.querySelector('#pick-results').innerHTML = listHtml();
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      close();
      onPick(byRid.get(pick.dataset.pick));
    }
  });
  const input = sheet.el.querySelector('#pick-q');
  input.addEventListener('input', debounce(() => {
    state.q = input.value;
    sheet.el.querySelector('#pick-results').innerHTML = listHtml();
  }, 120));
}

// Pick a day (and meal) from a week. choices: [{ date, meal, label, note, disabled }]
function openDayChooser(title, intro, choices, onChoose) {
  openSheet(esc(title), `${intro ? `<p>${intro}</p>` : ''}
    <ul class="pick-list">${choices.map((c, i) => `<li><button type="button" class="pick" data-choose="${i}"${c.disabled ? ' disabled' : ''}>
      <span class="pick__title">${esc(c.label)}</span>${c.note ? `<span class="pick__meta">${esc(c.note)}</span>` : ''}
    </button></li>`).join('')}</ul>`, (e, close) => {
    const b = e.target.closest('[data-choose]');
    if (!b || b.disabled) return;
    close();
    onChoose(choices[Number(b.dataset.choose)]);
  });
}

function slotNote(date, meal) {
  const s = getSlot(date, meal);
  const r = s && byRid.get(s.rid);
  if (!r) return 'Free';
  return s.leftover ? `Leftovers (${r.title})` : r.title;
}

async function markMade(date, meal, made) {
  const slot = getSlot(date, meal);
  const r = slot && byRid.get(slot.rid);
  if (!r || slot.leftover || !!slot.made === made) return null;
  const next = { ...slot, made };
  let saved = 0;
  if (made) {
    const m = mealMoney(r, slot.factor || 1);
    const entry = { id: uid('s'), date, meal, rid: r.rid, factor: slot.factor || 1, servings: m.servings, home: m.home, restaurant: m.restaurant, saved: m.saved, at: new Date().toISOString() };
    await db.putSaving(entry);
    next.savedId = entry.id;
    saved = m.saved;
  } else {
    if (slot.savedId) await db.deleteSaving(slot.savedId);
    delete next.savedId;
  }
  await setSlot(date, meal, next);
  await loadSavingsTotal();
  return { recipe: r, saved };
}

function madeToast(res) {
  if (!res) return;
  toast(moneyOn() && res.saved > 0 ? `Bravo! ~${dollars(res.saved)} stays in your pocket.` : `Bravo! ${res.recipe.title} — done.`, 3500);
}

async function renderPlan() {
  setChrome({ title: 'Week plan', back: '#/' });
  document.body.classList.add('page-plan');
  if (!planner.start) planner.start = currentWeekStart();
  // The week-start setting may have changed since this week was shown.
  planner.start = weeks.startOfWeek(planner.start, planSettings.weekStart);
  const days = weeks.weekDays(planner.start);
  await ensureWeeks(days);
  const title = weekTitle(planner.start);
  const isCurrent = title === 'This week';
  const planned = plannedMeals(days);

  main.innerHTML = `
    <div class="plan-top">
      <h1 class="page-title" tabindex="-1">${esc(title)}</h1>
      <nav class="week-nav" aria-label="Weeks">
        <button type="button" class="round-btn" data-action="prev-week" aria-label="Previous week">${icon('back')}</button>
        <p class="week-nav__label" aria-live="polite">${esc(weeks.rangeLabel(planner.start))}</p>
        <button type="button" class="round-btn" data-action="next-week" aria-label="Next week">${icon('next')}</button>
      </nav>
      ${isCurrent ? '' : '<p class="week-nav__back"><button type="button" class="btn btn--ghost btn--small" data-action="this-week">Back to this week</button></p>'}
    </div>
    ${planned.length ? '' : `<aside class="sal-says sal-says--plan" aria-label="Sal says">
      <img class="sal-says__avatar" src="assets/sal-avatar.png" alt="" width="64" height="64">
      <div><p class="sal-says__label">Sal says</p><blockquote class="sal-says__quote">Plan it once, cook it all week. No more 6 o'clock panic.</blockquote></div>
    </aside>`}
    <div class="plan-actions">
      <button type="button" class="btn" data-action="surprise">${icon('shuffle')} Surprise me</button>
      <button type="button" class="btn btn--secondary" data-action="make-list"${planned.some((p) => !p.slot.leftover) ? '' : ' disabled'}>${icon('cart')} Make shopping list for this week</button>
      <button type="button" class="btn btn--secondary" data-action="share-menu"${planned.length ? '' : ' disabled'}>${icon('share')} Share this week's menu</button>
      <button type="button" class="btn btn--danger" data-action="clear-week"${planned.length ? '' : ' disabled'}>${icon('trash')} Clear week</button>
    </div>
    <div class="plan-week">${days.map(dayHtml).join('')}</div>
    ${moneyFooterHtml(days)}
  `;

  const where = (date, meal) => `${weeks.dayName(date)} ${MEAL_LABEL[meal].toLowerCase()}`;

  const onClick = async (e) => {
    const t = e.target;
    const slotEl = t.closest('.slot');
    const date = slotEl && slotEl.dataset.date;
    const meal = slotEl && slotEl.dataset.meal;
    const fb = t.closest('[data-plan-factor]');
    if (fb && slotEl) {
      const slot = getSlot(date, meal);
      if (!slot) return;
      const f = Number(fb.dataset.planFactor);
      if (slot.made && slot.savedId) {
        // Keep the savings history in step with the amount actually cooked.
        await markMade(date, meal, false);
        await setSlot(date, meal, { ...getSlot(date, meal), factor: f });
        await markMade(date, meal, true);
      } else {
        await setSlot(date, meal, { ...slot, factor: f });
      }
      return refresh();
    }
    const btn = t.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'prev-week' || a === 'next-week') {
      planner.start = weeks.addDays(planner.start, a === 'prev-week' ? -7 : 7);
      return refresh();
    }
    if (a === 'this-week') {
      planner.start = currentWeekStart();
      return refresh();
    }
    if (a === 'pick') {
      openRecipePicker(where(date, meal), async (r) => {
        await setSlot(date, meal, { rid: r.rid, factor: 1 });
        toast(`${r.title} — ${weeks.dayName(date)}.`);
        refresh();
      });
      return;
    }
    if (a === 'leftovers') {
      const sources = [];
      days.forEach((d) => meals().forEach((m) => {
        const s = getSlot(d, m);
        if (s && !s.leftover && byRid.get(s.rid) && (d < date || (d === date && m === 'lunch' && meal === 'dinner'))) {
          sources.push({ date: d, meal: m, label: `${weeks.dayName(d)}${planSettings.lunch ? ` ${MEAL_LABEL[m].toLowerCase()}` : ''}`, note: byRid.get(s.rid).title });
        }
      }));
      if (!sources.length) return toast('Plan a meal earlier in the week first — then eat the leftovers.', 4000);
      openDayChooser(`Leftovers for ${where(date, meal)}`, 'Which meal are you finishing up? Nothing goes on the shopping list.', sources, async (c) => {
        await setSlot(date, meal, { rid: getSlot(c.date, c.meal).rid, factor: 1, leftover: { date: c.date, meal: c.meal } });
        toast('Leftovers it is. Smart.');
        refresh();
      });
      return;
    }
    if (a === 'move') {
      const choices = [];
      days.forEach((d) => meals().forEach((m) => {
        if (d === date && m === meal) return;
        const occupied = getSlot(d, m);
        choices.push({ date: d, meal: m, label: `${weeks.dayName(d)}${planSettings.lunch ? ` ${MEAL_LABEL[m].toLowerCase()}` : ''}`, note: occupied ? `Swap with ${slotNote(d, m)}` : 'Free' });
      }));
      const r = byRid.get(getSlot(date, meal).rid);
      openDayChooser(`Move ${r.title}`, '', choices, (c) => moveSlot(date, meal, c.date, c.meal));
      return;
    }
    if (a === 'remove') {
      const s = getSlot(date, meal);
      await setSlot(date, meal, null);
      toast(`${(byRid.get(s.rid) || { title: 'Meal' }).title} removed.`);
      return refresh();
    }
    if (a === 'made') {
      const slot = getSlot(date, meal);
      const res = await markMade(date, meal, !slot.made);
      if (res && !slot.made) madeToast(res);
      return refresh();
    }
    if (a === 'clear-day') {
      const d = btn.dataset.date;
      await setSlots(meals().map((m) => [d, m, null]));
      toast(`${weeks.dayName(d)} cleared.`);
      return refresh();
    }
    if (a === 'clear-week') {
      if (!confirm('Clear every meal planned this week?')) return;
      await setSlots(days.flatMap((d) => ['lunch', 'dinner'].map((m) => [d, m, null])));
      toast('Week cleared. Fresh start.');
      return refresh();
    }
    if (a === 'surprise') {
      const empty = days.filter((d) => !getSlot(d, 'dinner'));
      if (!empty.length) return toast('Every dinner is planned already. Clear a day for a surprise.', 4000);
      const taken = plannedMeals(days).map((p) => p.recipe.rid);
      const picks = surprisePicks(empty.length, taken, RECIPES, Math.random, chapterTitleOf);
      if (!picks.length) return toast("I'm out of new ideas for this week — the rest is up to you.", 4000);
      await setSlots(picks.map((r, i) => [empty[i], 'dinner', { rid: r.rid, factor: 1 }]));
      toast(picks.length === 1 ? 'One dinner, picked.' : `${picks.length} dinners, picked. No repeats.`);
      return refresh();
    }
    if (a === 'make-list') {
      const totals = new Map();
      plannedMeals(days).forEach(({ slot, recipe }) => {
        if (slot.leftover) return;
        totals.set(recipe.rid, (totals.get(recipe.rid) || 0) + (slot.factor || 1));
      });
      totals.forEach((f, rid) => addToShopping(byRid.get(rid), f));
      toast(`${totals.size} recipe${totals.size === 1 ? '' : 's'} added to your shopping list.`);
      location.hash = '#/list';
      return;
    }
    if (a === 'share-menu') {
      return shareText("This week's menu — Sal's Kitchen", menuText(days), 'Menu copied. Paste it into a text message or email.');
    }
  };

  // Drag and drop between days (computer with a mouse). Phones use "Move to…".
  let dragFrom = null;
  const onDragStart = (e) => {
    const s = e.target.closest && e.target.closest('.slot[draggable="true"]');
    if (!s) return;
    dragFrom = { date: s.dataset.date, meal: s.dataset.meal };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', `${dragFrom.date}|${dragFrom.meal}`); } catch (err) { /* fine */ }
    s.classList.add('slot--dragging');
  };
  const onDragOver = (e) => {
    const s = e.target.closest && e.target.closest('.slot');
    if (!s || !dragFrom) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    main.querySelectorAll('.slot--over').forEach((x) => { if (x !== s) x.classList.remove('slot--over'); });
    s.classList.add('slot--over');
  };
  const onDrop = (e) => {
    const s = e.target.closest && e.target.closest('.slot');
    if (!s || !dragFrom) return;
    e.preventDefault();
    const from = dragFrom;
    dragFrom = null;
    if (from.date === s.dataset.date && from.meal === s.dataset.meal) return refresh();
    moveSlot(from.date, from.meal, s.dataset.date, s.dataset.meal);
  };
  const onDragEnd = () => {
    dragFrom = null;
    main.querySelectorAll('.slot--over, .slot--dragging').forEach((x) => x.classList.remove('slot--over', 'slot--dragging'));
  };

  main.addEventListener('click', onClick);
  main.addEventListener('dragstart', onDragStart);
  main.addEventListener('dragover', onDragOver);
  main.addEventListener('drop', onDrop);
  main.addEventListener('dragend', onDragEnd);
  view.cleanup.push(() => {
    main.removeEventListener('click', onClick);
    main.removeEventListener('dragstart', onDragStart);
    main.removeEventListener('dragover', onDragOver);
    main.removeEventListener('drop', onDrop);
    main.removeEventListener('dragend', onDragEnd);
  });
  afterRender('.page-title');
}

async function moveSlot(fromDate, fromMeal, toDate, toMeal) {
  const a = getSlot(fromDate, fromMeal);
  const b = getSlot(toDate, toMeal);
  if (!a) return;
  await setSlots([[toDate, toMeal, a], [fromDate, fromMeal, b]]);
  const r = byRid.get(a.rid) || { title: 'Meal' };
  toast(`${a.leftover ? 'Leftovers' : r.title} moved to ${weeks.dayName(toDate)}.`);
  refresh();
}

// From a recipe page: "Add to plan" → choose a day.
function openAddToPlan(r, factor) {
  const f = PLAN_FACTORS.includes(factor) ? factor : 1;
  let start = currentWeekStart();
  const build = async () => {
    const days = weeks.weekDays(start);
    await ensureWeeks(days);
    const choices = [];
    days.forEach((d) => meals().forEach((m) => {
      const note = slotNote(d, m);
      choices.push({ date: d, meal: m, label: `${weeks.dayName(d)} ${weeks.shortDate(d)}${planSettings.lunch ? ` · ${MEAL_LABEL[m]}` : ''}`, note: note === 'Free' ? 'Free' : `Replaces ${note}`, past: d < weeks.today() });
    }));
    return choices;
  };
  const show = async () => {
    const choices = await build();
    const isThis = start === currentWeekStart();
    const sheet = openSheet(`Add ${esc(r.title)} to…`, `
      <div class="seg" role="group" aria-label="Which week">
        <button type="button" class="seg__btn" data-week="0" aria-pressed="${isThis}">This week</button>
        <button type="button" class="seg__btn" data-week="1" aria-pressed="${!isThis}">Next week</button>
      </div>
      <p class="small muted">Amount: <strong>${prettyFactor(f)}</strong>. You can change it in the planner.</p>
      <ul class="pick-list">${choices.map((c, i) => `<li><button type="button" class="pick${c.past ? ' pick--past' : ''}" data-choose="${i}">
        <span class="pick__title">${esc(c.label)}</span><span class="pick__meta">${esc(c.note)}</span></button></li>`).join('')}</ul>`, async (e, close) => {
      const wk = e.target.closest('[data-week]');
      if (wk) {
        const next = weeks.addDays(currentWeekStart(), wk.dataset.week === '1' ? 7 : 0);
        if (next === start) return;
        start = next;
        close();
        show();
        return;
      }
      const b = e.target.closest('[data-choose]');
      if (!b) return;
      const c = choices[Number(b.dataset.choose)];
      close();
      await setSlot(c.date, c.meal, { rid: r.rid, factor: f });
      toast(`Planned for ${weeks.dayName(c.date)}. Open Plan to see your week.`, 3500);
    });
    return sheet;
  };
  show();
}

// When cooking mode is finished: if this recipe is on today's plan, count it as made.
async function markCookedToday(r) {
  const d = weeks.today();
  await ensureWeeks([d]);
  for (const meal of ['dinner', 'lunch']) {
    const s = getSlot(d, meal);
    if (s && s.rid === r.rid && !s.leftover && !s.made) return markMade(d, meal, true);
  }
  return null;
}

// ====================================================================
//  7. Settings
// ====================================================================

function getTheme() {
  try { return localStorage.getItem('sal-theme') || 'auto'; } catch (e) { return 'auto'; }
}
function setTheme(t) {
  try {
    if (t === 'auto') localStorage.removeItem('sal-theme');
    else localStorage.setItem('sal-theme', t);
  } catch (e) { /* storage blocked — still applies for this visit */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

async function renderSettings() {
  setChrome({ title: 'Settings', back: '#/' });
  const lastBackup = await db.getMeta('lastBackup');
  const theme = getTheme();
  const plat = install.platform();

  const installOrder = plat === 'android' ? ['android', 'ios', 'desktop'] : plat === 'desktop' ? ['desktop', 'ios', 'android'] : ['ios', 'android', 'desktop'];
  const installBlocks = {
    ios: `<h3>iPhone or iPad</h3>${install.IPHONE_STEPS}<div class="notice">${install.IPHONE_DATA_NOTE}</div>`,
    android: `<h3>Android phone or tablet</h3>${install.canPromptInstall() ? `<p><button type="button" class="btn" data-action="install-now">${icon('phone')} Install app now</button></p><p class="small muted">Or do it by hand:</p>` : ''}${install.ANDROID_STEPS}`,
    desktop: `<h3>Computer</h3>${install.DESKTOP_STEPS}`,
  };

  main.innerHTML = `
    <h1 class="page-title" tabindex="-1">Settings</h1>

    <section class="section" aria-labelledby="look-title">
      <h2 id="look-title">Light or dark screen</h2>
      <fieldset class="theme-choice">
        <legend class="visually-hidden">Screen colors</legend>
        <label><input type="radio" name="theme" value="auto" ${theme === 'auto' ? 'checked' : ''}> Same as my device</label>
        <label><input type="radio" name="theme" value="light" ${theme === 'light' ? 'checked' : ''}> Light</label>
        <label><input type="radio" name="theme" value="dark" ${theme === 'dark' ? 'checked' : ''}> Dark</label>
      </fieldset>
    </section>

    <section class="section" aria-labelledby="books-title" id="books">
      <h2 id="books-title">Your recipe books</h2>
      <ul class="book-list">
        ${packs.CATALOG.map((p) => `<li class="book${packs.isOpen(p.id) ? ' book--open' : ''}">
          <span class="book__icon">${icon(packs.isOpen(p.id) ? 'book' : 'lock')}</span>
          <span class="book__body"><strong>${esc(p.title)}</strong>
            <span class="small muted">${packs.isOpen(p.id) ? `${packs.recipeCount(p.id)} recipes · unlocked on this device` : `${packs.recipeCount(p.id)} recipes · locked`}</span></span>
          ${packs.isOpen(p.id) ? '' : `<a class="btn btn--secondary btn--small" href="${esc(p.storeUrl)}" target="_blank" rel="noopener">Get it</a>`}
        </li>`).join('')}
      </ul>
      ${lockedIds().length ? `<p>Bought another book? Enter its code here.</p>${codeFormHtml('books-code', 'Unlock')}` : ''}
    </section>

    <section class="section" aria-labelledby="plan-set-title" id="plan-settings">
      <h2 id="plan-set-title">Week plan</h2>
      <fieldset class="theme-choice">
        <legend class="label">My week starts on</legend>
        <label><input type="radio" name="weekStart" value="mon" ${planSettings.weekStart !== 'sun' ? 'checked' : ''}> Monday</label>
        <label><input type="radio" name="weekStart" value="sun" ${planSettings.weekStart === 'sun' ? 'checked' : ''}> Sunday</label>
      </fieldset>
      <div class="toggles">
        <label class="toggle"><input type="checkbox" name="lunch" ${planSettings.lunch ? 'checked' : ''}> Show a lunch slot too</label>
        <label class="toggle"><input type="checkbox" name="showMoney" ${planSettings.hideMoney ? '' : 'checked'}> Show money saved</label>
      </div>
      <p><strong>Saved so far:</strong> <span id="saved-so-far">~${dollars(savingsTotal)}</span> <span class="small muted">(typical restaurant price, estimate)</span></p>
      <button type="button" class="btn btn--danger btn--small" data-action="reset-savings">${icon('reset')} Reset the savings counter</button>
    </section>

    <section class="section" aria-labelledby="pantry-title" id="pantry-settings">
      <h2 id="pantry-title">Pantry staples</h2>
      <p>Things you always have at home. They're tucked away under <em>“You probably have these”</em> on your shopping list.</p>
      <div class="pantry-grid">
        ${PANTRY_OPTIONS.map((o) => `<label class="toggle"><input type="checkbox" name="pantry" value="${o.id}" ${pantry.ids.includes(o.id) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}
      </div>
      ${pantry.custom.length ? `<ul class="pantry-custom">${pantry.custom.map((c, i) => `<li><span>${esc(c)}</span><button type="button" class="icon-btn" data-remove-pantry="${i}" aria-label="Remove ${esc(c)}">${icon('close')}</button></li>`).join('')}</ul>` : ''}
      <form class="add-row" id="pantry-form">
        <label for="pantry-new" class="visually-hidden">Add your own staple</label>
        <input type="text" id="pantry-new" placeholder="Add your own (e.g. honey)" autocomplete="off" enterkeyhint="done">
        <button type="submit" class="btn btn--secondary">${icon('plus')}<span>Add</span></button>
      </form>
    </section>

    <section class="section" aria-labelledby="install-help-title" id="install-help">
      <h2 id="install-help-title">Install on your phone</h2>
      ${install.isStandalone() ? '<p><strong>Good news: Sal’s Kitchen is already installed on this device.</strong></p>' : '<p>Once installed, Sal’s Kitchen opens from its own icon and works with no internet.</p>'}
      ${installOrder.map((k) => installBlocks[k]).join('')}
    </section>

    <section class="section" aria-labelledby="backup-title">
      <h2 id="backup-title">Backup &amp; restore</h2>
      <p>Your favorites, ticked ingredients, shopping list, week plans, pantry staples and savings are saved only on this device. A backup file holds all of them, so you can keep a copy safe or move to a new phone.</p>
      <p><strong>Last backup:</strong> <span id="last-backup">${lastBackup ? esc(formatDate(lastBackup)) : 'never'}</span></p>
      <div class="stack">
        <button type="button" class="btn btn--block" data-action="backup">${icon('download')} ${onPhone() ? 'Save a backup file' : 'Download a backup file'}</button>
        ${onPhone() ? `<button type="button" class="btn btn--ghost btn--block" data-action="backup-download">Download it instead</button>` : ''}
        <label class="btn btn--secondary btn--block" for="restore-file">${icon('upload')} Restore from a backup file</label>
        <input type="file" id="restore-file" class="file-input" accept=".json,application/json">
      </div>
      <p class="small muted" style="margin-top:12px">Tip: email the backup file to yourself or save it to Files, iCloud Drive or Google Drive.</p>
    </section>

    <section class="section" aria-labelledby="about-title">
      <h2 id="about-title">About Chef Sal</h2>
      <div class="about">
        <img class="about__avatar" src="assets/sal-avatar.png" alt="Chef Sal Romano" width="96" height="96">
        <div>
          <p>Sal Romano started washing dishes in a restaurant kitchen at 16. He went on to spend 25 years running Michelin-starred kitchens in New York and Milan — then came home and opened <em>Romano's</em> in New Jersey with his wife, Angela.</p>
          <p>Now he's showing you how to make the restaurant food you love, better and for a lot less, in your own kitchen.</p>
        </div>
      </div>
      <ul class="link-list">
        <li><a href="${esc(YOUTUBE_URL)}" target="_blank" rel="noopener">${icon('video')} Sal's YouTube channel</a></li>
        <li><a href="${esc(STORE_URL)}" target="_blank" rel="noopener">${icon('store')} Sal's store on Payhip</a></li>
        <li><a href="mailto:${esc(SUPPORT_EMAIL)}">${icon('mail')} Email for help: ${esc(SUPPORT_EMAIL)}</a></li>
      </ul>
      <p class="small muted"><strong>${esc(APP_NAME)}</strong> · Version ${APP_VERSION}<br>No accounts, no ads, no tracking. Everything you save stays on this device.</p>
      <p class="footnote">${esc(NOT_AFFILIATED)}</p>
    </section>
  `;

  async function makeBackup(forceDownload) {
    try {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const filename = `sals-kitchen-backup-${isoDay()}.json`;
      let result;
      if (onPhone() && !forceDownload) result = await shareFile(blob, filename, "Sal's Kitchen backup");
      else {
        downloadBlob(blob, filename);
        result = 'downloaded';
      }
      if (result === 'cancelled') return;
      const now = new Date().toISOString();
      await db.setMeta('lastBackup', now);
      main.querySelector('#last-backup').textContent = formatDate(now);
      toast(result === 'shared' ? 'Backup saved.' : 'Backup file downloaded.');
    } catch (e) {
      console.error(e);
      toast("Sorry, the backup couldn't be made.", 4000);
    }
  }

  const onClick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'backup') return makeBackup(false);
    if (action === 'backup-download') return makeBackup(true);
    if (action === 'install-now') return install.promptInstall();
    if (action === 'reset-savings') {
      if (!confirm('Reset the savings counter to $0? Your week plans stay as they are.')) return;
      await db.clearSavings();
      savingsTotal = 0;
      main.querySelector('#saved-so-far').textContent = dollars(0);
      toast('Savings counter reset. Back to zero — let’s cook.');
      return;
    }
  };
  const onRemovePantry = async (e) => {
    const b = e.target.closest('[data-remove-pantry]');
    if (!b) return;
    pantry.custom = pantry.custom.filter((_, i) => i !== Number(b.dataset.removePantry));
    await savePantry();
    refresh();
  };
  const onPantrySubmit = async (e) => {
    if (e.target.id !== 'pantry-form') return;
    e.preventDefault();
    const input = main.querySelector('#pantry-new');
    const text = input.value.trim();
    if (!text) return input.focus();
    if (!pantry.custom.some((c) => c.toLowerCase() === text.toLowerCase())) pantry.custom.push(text);
    await savePantry();
    toast(`“${text}” added to your pantry staples.`);
    refresh().then(() => { const i = main.querySelector('#pantry-new'); if (i) i.focus(); });
  };

  const onChange = async (e) => {
    if (e.target.name === 'theme') {
      setTheme(e.target.value);
      return;
    }
    if (e.target.name === 'weekStart') {
      planSettings.weekStart = e.target.value === 'sun' ? 'sun' : 'mon';
      planner.start = null;
      await savePlanSettings();
      toast(`Weeks now start on ${planSettings.weekStart === 'sun' ? 'Sunday' : 'Monday'}.`);
      return;
    }
    if (e.target.name === 'lunch') {
      planSettings.lunch = e.target.checked;
      await savePlanSettings();
      return;
    }
    if (e.target.name === 'showMoney') {
      planSettings.hideMoney = !e.target.checked;
      await savePlanSettings();
      return;
    }
    if (e.target.name === 'pantry') {
      const id = e.target.value;
      pantry.ids = e.target.checked ? [...new Set([...pantry.ids, id])] : pantry.ids.filter((x) => x !== id);
      await savePantry();
      return;
    }
    if (e.target.id === 'restore-file') {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        let data;
        try {
          data = JSON.parse(await file.text());
        } catch (err) {
          throw new Error("This file isn't a Sal's Kitchen backup.");
        }
        db.validateBackup(data);
        const when = data.exportedAt ? ` made on ${formatDate(data.exportedAt)}` : '';
        const favCount = (data.favorites || []).length;
        const v2 = data.format >= 2;
        const msg = `Restore the backup${when}?\n\nIt has ${favCount} favorite${favCount === 1 ? '' : 's'} and your shopping list${v2 ? ', week plans, pantry staples and savings' : ''}. It replaces ${v2 ? 'all of those' : 'the favorites, ticks and shopping list'} on this device.`;
        if (!confirm(msg)) return;
        await db.importAll(data);
        // Read back what was saved: older backups get their recipe numbers turned into ids.
        const [f2, s2] = await Promise.all([db.getMeta('favorites'), db.getMeta('shopping')]);
        favorites = new Set(Array.isArray(f2) ? f2 : []);
        shopping = s2 && Array.isArray(s2.groups) ? s2 : db.emptyShopping();
        await loadPlannerState();
        updateListBadge();
        toast('Backup restored.');
        refresh();
      } catch (err) {
        console.error(err);
        alert(err.message || "Sorry, that backup couldn't be restored.");
      }
    }
  };

  const booksForm = main.querySelector('#books .code-form');
  if (booksForm) {
    wireCodeForm(booksForm, {
      noneMessage: "That code doesn't open another book. Use the code from the PDF of your new purchase.",
      onDone: (opened) => {
        toast(`${opened.map((x) => packs.catalogEntry(x).title).join(' and ')} unlocked. Buon appetito!`, 4500);
        refresh();
      },
    });
  }
  main.addEventListener('click', onClick);
  main.addEventListener('click', onRemovePantry);
  main.addEventListener('change', onChange);
  main.addEventListener('submit', onPantrySubmit);
  view.cleanup.push(() => {
    main.removeEventListener('click', onClick);
    main.removeEventListener('click', onRemovePantry);
    main.removeEventListener('change', onChange);
    main.removeEventListener('submit', onPantrySubmit);
  });
  afterRender('.page-title');
}

// ====================================================================
//  Start
// ====================================================================

async function loadPlannerState() {
  const [ps, pan] = await Promise.all([db.getMeta('planSettings'), db.getMeta('pantry'), loadSavingsTotal()]);
  planSettings = { weekStart: 'mon', lunch: false, hideMoney: false, combined: false, ...(ps && typeof ps === 'object' ? ps : {}) };
  pantry = {
    ids: pan && Array.isArray(pan.ids) ? pan.ids : [],
    custom: pan && Array.isArray(pan.custom) ? pan.custom.filter((c) => typeof c === 'string') : [],
  };
  planWeeks.clear();
  planner.start = null;
}

// An older copy of the app is open in another tab and holds the database.
document.addEventListener('sal-db-blocked', () => {
  main.innerHTML = `<div class="card"><h1>One moment</h1><p>Sal's Kitchen just got an update. Please close any other tabs or windows with Sal's Kitchen open — this page continues by itself.</p></div>`;
});

// Fetch the pack files and open the ones this device has keys for.
async function loadPacks(opts) {
  try {
    await packs.init(opts);
  } catch (e) {
    if (e && e.message === 'nocrypto') throw e;
    console.error(e);
  }
  rebuildIndex();
}

// Codes this device used before may open packs that were added since (bundle codes).
function checkRememberedCodes() {
  if (!ready()) return;
  packs.tryRememberedCodes().then((opened) => {
    if (!opened.length) return;
    rebuildIndex();
    toast(`${opened.map((x) => packs.catalogEntry(x).title).join(' and ')} unlocked — your code opens it too. Buon appetito!`, 5000);
    refresh();
  }).catch((e) => console.error(e));
}

async function start() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline support not available:', e));
  }
  try {
    await loadPacks();
    // A pack was rebuilt with a new key: the code this device remembers usually still opens it.
    // Try that first, so nobody is asked for their code again for no reason.
    const stale = packs.CATALOG.map((p) => p.id).filter((id) => packs.hasStaleKey(id));
    if (stale.length) {
      main.innerHTML = '<p class="loading">Opening your recipes…</p>';
      await packs.tryRememberedCodes({ only: stale }).catch((e) => console.error(e));
      rebuildIndex();
    }
  } catch (e) {
    main.innerHTML = `<div class="card"><h1>Please update your browser</h1><p>This browser can't open Sal's recipes safely. Please update it, or open the app in a current version of Safari, Chrome, Edge or Firefox.</p><p>Questions? Email <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a>.</p></div>`;
    return;
  }
  try {
    const [u, f, s] = await Promise.all([db.getMeta('unlocked'), db.getMeta('favorites'), db.getMeta('shopping')]);
    unlocked = !!u;
    favorites = new Set(Array.isArray(f) ? f : []);
    if (s && Array.isArray(s.groups) && Array.isArray(s.custom)) shopping = s;
    await loadPlannerState();
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="card"><h1>Storage is turned off</h1><p>Sal's Kitchen saves your favorites and lists on this device, but your browser is blocking storage. If you are in a Private Browsing window, please open the app in a normal window.</p></div>`;
    return;
  }
  if (unlocked && install.isStandalone()) requestPersistentStorage();

  window.addEventListener('hashchange', route);
  await route();
  checkRememberedCodes();
}

start();

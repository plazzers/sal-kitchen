import './sha256.js';
import * as db from './db.js';
import { APP_NAME, YOUTUBE_URL, STORE_URL, SUPPORT_EMAIL, ACCESS_CODE_HASHES } from '../config.js';
import { CHAPTERS, RECIPES } from '../data/recipes.js';
import { scaleLineParts, scaleLine } from './scale.js';
import * as timers from './timers.js';
import { icon } from './icons.js';
import { esc, uid, formatDate, debounce, fold, isIOS, isAndroid, downloadBlob, shareFile, isoDay, copyText } from './util.js';
import * as install from './install.js';

const APP_VERSION = '1.0';
const STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6]; // what − and + move between
const PRESETS = [0.5, 1, 2, 3];
const GREETING = "Grate your own cheese. Taste before you serve. Let's cook.";
const NOT_AFFILIATED = 'Recipes are inspired by popular restaurant dishes. Not affiliated with or endorsed by any restaurant.';

const main = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const listBtn = document.getElementById('list-btn');
const listCount = document.getElementById('list-count');
const settingsBtn = document.getElementById('settings-btn');
const toastEl = document.getElementById('toast');
const tray = document.getElementById('timer-tray');

let unlocked = false;
let favorites = new Set();
let shopping = db.emptyShopping();
let view = { name: null, cleanup: [] };
const home = { q: '', chip: 'all', scroll: 0 };

const byNum = new Map(RECIPES.map((r) => [r.num, r]));
const chapterByNum = new Map(CHAPTERS.map((c) => [c.num, c]));

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

function shoppingRemaining() {
  let n = 0;
  shopping.groups.forEach((g) => g.items.forEach((i) => { if (!i.checked) n++; }));
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

async function toggleFavorite(num) {
  if (favorites.has(num)) favorites.delete(num);
  else favorites.add(num);
  try {
    await db.setMeta('favorites', [...favorites]);
  } catch (e) {
    console.error(e);
  }
  return favorites.has(num);
}

async function loadProgress(num) {
  const p = (await db.getProgress(num)) || {};
  return { num, ticks: p.ticks || [], done: p.done || [], factor: typeof p.factor === 'number' ? p.factor : 1 };
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
  const show = unlocked && list.length > 0;
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
  document.body.classList.remove('cooking');

  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);

  renderTray();
  if (!unlocked) return renderUnlock();

  try {
    if (parts[0] === 'settings') return await renderSettings();
    if (parts[0] === 'list') return renderList();
    if ((parts[0] === 'recipe' || parts[0] === 'cook') && parts[1]) {
      const r = byNum.get(Number(parts[1]));
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

function renderUnlock() {
  setChrome({ title: 'Enter your access code', nav: false });
  main.innerHTML = `
  <section class="unlock">
    <img class="unlock__avatar" src="assets/sal-avatar.png" alt="Chef Sal Romano" width="128" height="128">
    <p class="eyebrow">Chef Sal Romano</p>
    <h1>Welcome to Sal's Kitchen</h1>
    <p class="lede">Real restaurant food, made right in your own kitchen. Enter your code and let's cook.</p>
    <form id="unlock-form" novalidate>
      <label for="code">Enter your access code</label>
      <input type="text" id="code" name="code" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false"
        placeholder="For example SAL-XXXX-XXXX" aria-describedby="code-error">
      <p id="code-error" class="error" role="alert"></p>
      <button class="btn btn--big" type="submit">Unlock the recipes</button>
    </form>
    <details class="help-box card">
      <summary>Where do I find my code?</summary>
      <p>Your access code is printed in the <strong>PDF</strong> you downloaded from Payhip when you bought Sal's Kitchen. Open the PDF and look near the front.</p>
      <p>Can't find the PDF? Look for the email from Payhip that was sent right after your purchase — it has the download link. Check your spam or "Promotions" folder too.</p>
      <p>You only need to enter the code once on each phone, tablet or computer.</p>
      <p>Still stuck? Email <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a> and we'll help you out.</p>
    </details>
  </section>`;

  const form = main.querySelector('#unlock-form');
  const input = main.querySelector('#code');
  const err = main.querySelector('#code-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = SalHash.normalizeCode(input.value);
    if (!code) {
      err.textContent = 'Please type your access code.';
      input.focus();
      return;
    }
    const hash = await SalHash.sha256Hex(code);
    const ok = ACCESS_CODE_HASHES.map((h) => String(h).trim().toLowerCase()).includes(hash);
    if (!ok) {
      err.textContent = "That code didn't work. Please check it and try again — dashes count, but upper or lower case doesn't matter.";
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    await db.setMeta('unlocked', { at: new Date().toISOString() });
    unlocked = true;
    requestPersistentStorage();
    toast('Benvenuti! The kitchen is open.');
    if (location.hash && location.hash !== '#/') location.hash = '#/';
    else route();
  });
  afterRender();
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
  const fav = favorites.has(r.num);
  return `<li class="rcard">
    <a class="rcard__link" href="#/recipe/${r.num}">
      <span class="rcard__num">Nº ${r.num}</span>
      <span class="rcard__title">${esc(r.title)}</span>
      <span class="rcard__sub">${esc(r.subtitle)}</span>
      <span class="rcard__meta">
        <span>${icon('clock')}${esc(r.time)}</span>
        <span>${icon('people')}${esc(servesText(r))}</span>
        <span>${icon('tag')}${esc(r.cost)}</span>
      </span>
    </a>
    <button type="button" class="fav-btn" data-fav="${r.num}" aria-pressed="${fav}" aria-label="Favorite: ${esc(r.title)}">${icon('heart')}</button>
  </li>`;
}

function matches(r, words) {
  if (!words.length) return true;
  if (!r._hay) r._hay = fold([r.title, r.subtitle, ...r.ingredients].join(' \n '));
  return words.every((w) => r._hay.includes(w));
}

function resultsHtml() {
  const words = fold(home.q).split(/\s+/).filter(Boolean);
  let list = RECIPES.filter((r) => matches(r, words));
  if (home.chip === 'fav') list = list.filter((r) => favorites.has(r.num));
  else if (home.chip !== 'all') list = list.filter((r) => r.chapter === Number(home.chip));

  let head = '';
  if (words.length) {
    head = `<p class="result-count">${list.length ? `${list.length} recipe${list.length === 1 ? '' : 's'} with “${esc(home.q.trim())}”` : ''}</p>`;
  }
  if (!list.length) {
    if (home.chip === 'fav' && !words.length) {
      return `<p class="empty">${icon('heart')}<br>No favorites yet.<br>Tap the heart on any recipe and it will wait for you here.</p>`;
    }
    return `${head}<p class="empty">No recipes match “${esc(home.q.trim())}”${home.chip !== 'all' ? ' here' : ''}.<br>Try a single word, like <em>garlic</em> or <em>chicken</em>${home.chip !== 'all' ? ', or tap <strong>All</strong>' : ''}.</p>`;
  }

  const groups = CHAPTERS.map((ch) => ({ ch, items: list.filter((r) => r.chapter === ch.num) })).filter((g) => g.items.length);
  return head + groups.map(({ ch, items }) => `
    <section class="chapter" aria-labelledby="ch-${ch.num}">
      <header class="chapter__head">
        <p class="chapter__num">Chapter ${ch.num}</p>
        <h2 id="ch-${ch.num}" class="chapter__title">${esc(ch.title)}</h2>
        ${words.length ? '' : `<p class="chapter__intro">“${esc(ch.intro)}”</p>`}
      </header>
      <ul class="rcard-list">${items.map(recipeCard).join('')}</ul>
    </section>`).join('');
}

async function renderHome() {
  setChrome({ title: '' });
  const restoreScroll = home.scroll;
  const chips = [
    ['all', 'All recipes'],
    ['fav', `${icon('heart')} Favorites`],
    ...CHAPTERS.map((c) => [String(c.num), esc(chipLabel(c))]),
  ];
  main.innerHTML = `
    <section class="hello" aria-label="A word from Sal">
      <img class="hello__avatar" src="assets/sal-avatar.png" alt="" width="76" height="76">
      <div class="hello__body">
        <p class="hello__quote">“${esc(GREETING)}”</p>
        <p class="hello__sig">— Chef Sal Romano</p>
      </div>
    </section>
    <div id="install-slot">${await installBannerHtml()}</div>
    <div class="finder">
      <label for="q" class="visually-hidden">Search recipes or ingredients</label>
      <div class="search">
        ${icon('search')}
        <input type="search" id="q" placeholder="Search recipes or ingredients" autocomplete="off" enterkeyhint="search" value="${esc(home.q)}">
        <button type="button" class="search__clear" data-action="clear-search" aria-label="Clear search" ${home.q ? '' : 'hidden'}>${icon('close')}</button>
      </div>
      <div class="chips" role="group" aria-label="Show recipes from">
        ${chips.map(([k, label]) => `<button type="button" class="chip" data-chip="${k}" aria-pressed="${home.chip === k}">${label}</button>`).join('')}
      </div>
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
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const on = await toggleFavorite(Number(fav.dataset.fav));
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
  const old = shopping.groups.find((g) => g.recipeNum === r.num);
  const items = r.ingredients.map((line) => {
    const text = scaleLine(line, factor);
    const prev = old && old.factor === factor && old.items.find((i) => i.text === text);
    return { text, checked: prev ? !!prev.checked : false };
  });
  const group = { id: old ? old.id : uid('g'), recipeNum: r.num, title: r.title, factor, items };
  if (old) shopping.groups[shopping.groups.indexOf(old)] = group;
  else shopping.groups.push(group);
  saveShopping();
  return !!old;
}

async function renderRecipe(r) {
  setChrome({ title: r.title, back: '#/' });
  const prog = await loadProgress(r.num);
  const ch = chapterByNum.get(r.chapter);
  const idx = RECIPES.indexOf(r);
  const prev = RECIPES[idx - 1];
  const next = RECIPES[idx + 1];

  main.innerHTML = `
  <article class="recipe">
    <header class="recipe-head">
      <p class="eyebrow">Nº ${r.num} · ${esc(ch ? ch.title : '')}</p>
      <h1 class="recipe-title" tabindex="-1">${esc(r.title)}</h1>
      <p class="recipe-sub">${esc(r.subtitle)}</p>
      <ul class="facts">
        <li>${icon('people')}<span><span class="facts__label">${/^\d+$/.test(r.serves.trim()) ? 'Serves' : 'Makes'}</span><span id="facts-serves">${esc(r.serves)}${prog.factor !== 1 ? ` (${prettyFactor(prog.factor)})` : ''}</span></span></li>
        <li>${icon('clock')}<span><span class="facts__label">Time</span>${esc(r.time)}</span></li>
        <li>${icon('tag')}<span><span class="facts__label">Cost at home</span>${esc(r.cost)}</span></li>
      </ul>
    </header>

    <div class="recipe-actions">
      <a class="btn btn--big" href="#/cook/${r.num}">${icon('play')} Start cooking mode</a>
      <div class="actions-2">
        <button type="button" class="btn btn--secondary fav-toggle" data-action="fav" aria-pressed="${favorites.has(r.num)}">${icon('heart')}<span>${favorites.has(r.num) ? 'Saved' : 'Favorite'}</span></button>
        <button type="button" class="btn btn--secondary" data-action="add-list">${icon('cart')}<span>Add to shopping list</span></button>
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

    <p class="section"><a class="btn btn--big" href="#/cook/${r.num}">${icon('play')} Start cooking mode</a></p>

    <nav class="recipe-nav" aria-label="More recipes">
      ${prev ? `<a class="recipe-nav__link" href="#/recipe/${prev.num}">${icon('back')}<span><span class="small muted">Previous</span><br>${esc(prev.title)}</span></a>` : '<span></span>'}
      ${next ? `<a class="recipe-nav__link recipe-nav__link--next" href="#/recipe/${next.num}"><span><span class="small muted">Next</span><br>${esc(next.title)}</span>${icon('next')}</a>` : ''}
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
      const on = await toggleFavorite(r.num);
      btn.setAttribute('aria-pressed', String(on));
      btn.querySelector('span').textContent = on ? 'Saved' : 'Favorite';
      toast(on ? 'Saved to your favorites.' : 'Removed from favorites.');
    } else if (a === 'add-list') {
      const updated = addToShopping(r, prog.factor);
      toast(updated ? `Shopping list updated (${prettyFactor(prog.factor)}).` : `Added ${r.ingredients.length} items to your shopping list.`);
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
  setChrome({ title: `Cooking: ${r.title}`, back: `#/recipe/${r.num}`, nav: false });
  document.body.classList.add('cooking');
  const prog = await loadProgress(r.num);
  const total = r.steps.length;
  let idx = Math.min(Math.max(1, startStep), total + 1); // total + 1 = the "finished" screen

  main.innerHTML = `
  <div class="cook">
    <div class="cook-bar">
      <a class="cook-bar__btn" href="#/recipe/${r.num}">${icon('close')}<span>Exit</span></a>
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
        <p><a class="btn btn--secondary btn--block" href="#/recipe/${r.num}">Back to the recipe</a></p>
        <p><a class="btn btn--ghost btn--block" href="#/">All recipes</a></p>`;
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
    history.replaceState(null, '', `#/cook/${r.num}/${idx}`);
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

function shoppingText() {
  const anyLeft = shoppingRemaining() > 0;
  const keep = (i) => !anyLeft || !i.checked;
  const lines = ["Sal's Kitchen — Shopping list", ''];
  shopping.groups.forEach((g) => {
    const items = g.items.filter(keep);
    if (!items.length) return;
    lines.push(`${g.title}${g.factor !== 1 ? ` (${prettyFactor(g.factor)})` : ''}`);
    items.forEach((i) => lines.push(`☐ ${i.text}`));
    lines.push('');
  });
  const extras = shopping.custom.filter(keep);
  if (extras.length) {
    lines.push('Also');
    extras.forEach((i) => lines.push(`☐ ${i.text}`));
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

function shopItemHtml(item, key) {
  return `<li><button type="button" class="ing shop-item" role="checkbox" aria-checked="${!!item.checked}" data-item="${key}">
    <span class="tickbox" aria-hidden="true">${icon('check')}</span>
    <span class="ing__text">${esc(item.text)}</span>
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
  const groupsHtml = shopping.groups.map((g) => `
    <section class="list-group" aria-labelledby="lg-${esc(g.id)}">
      <div class="list-group__head">
        <h2 id="lg-${esc(g.id)}"><a href="#/recipe/${g.recipeNum}">${esc(g.title)}</a>${g.factor !== 1 ? ` <span class="factor-pill">${prettyFactor(g.factor)}</span>` : ''}</h2>
        <button type="button" class="icon-btn no-print" data-remove-group="${esc(g.id)}" aria-label="Remove ${esc(g.title)} from the list">${icon('trash')}</button>
      </div>
      <ul class="ing-list">${g.items.map((it, i) => shopItemHtml(it, `g:${g.id}:${i}`)).join('')}</ul>
    </section>`).join('');
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
    ${empty ? `<p class="empty">${icon('cart')}<br>Your list is empty.<br>Open a recipe and tap <strong>Add to shopping list</strong>.</p><p><a class="btn btn--secondary btn--block" href="#/">${icon('book')} Browse recipes</a></p>` : `
      <p class="muted small no-print" id="list-status"></p>
      <div class="list-actions no-print">
        <button type="button" class="btn" data-action="share">${icon('share')} Share list</button>
        <button type="button" class="btn btn--secondary" data-action="print">${icon('print')} Print</button>
        <button type="button" class="btn btn--secondary" data-action="clear-checked">${icon('check')} Clear checked</button>
        <button type="button" class="btn btn--danger" data-action="clear-all">${icon('trash')} Clear all</button>
      </div>
      ${groupsHtml}${customHtml}`}
  `;

  const status = main.querySelector('#list-status');
  const updateStatus = () => {
    if (!status) return;
    const left = shoppingRemaining();
    status.textContent = left ? `${left} item${left === 1 ? '' : 's'} left to get. Tap an item when it's in your cart.` : 'All done — everything is checked off.';
  };
  updateStatus();

  const findItem = (key) => {
    const [kind, id, i] = key.split(':');
    if (kind === 'c') return shopping.custom.find((x) => x.id === id);
    const g = shopping.groups.find((x) => x.id === id);
    return g && g.items[Number(i)];
  };

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
      const item = findItem(itemBtn.dataset.item);
      if (!item) return;
      item.checked = !item.checked;
      itemBtn.setAttribute('aria-checked', String(item.checked));
      saveShopping();
      updateStatus();
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
//  6. Settings
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

    <section class="section" aria-labelledby="install-help-title" id="install-help">
      <h2 id="install-help-title">Install on your phone</h2>
      ${install.isStandalone() ? '<p><strong>Good news: Sal’s Kitchen is already installed on this device.</strong></p>' : '<p>Once installed, Sal’s Kitchen opens from its own icon and works with no internet.</p>'}
      ${installOrder.map((k) => installBlocks[k]).join('')}
    </section>

    <section class="section" aria-labelledby="backup-title">
      <h2 id="backup-title">Backup &amp; restore</h2>
      <p>Your favorites, ticked ingredients and shopping list are saved only on this device. A backup file holds all of them, so you can keep a copy safe or move to a new phone.</p>
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
  };

  const onChange = async (e) => {
    if (e.target.name === 'theme') {
      setTheme(e.target.value);
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
        const msg = `Restore the backup${when}?\n\nIt has ${data.favorites.length} favorite${data.favorites.length === 1 ? '' : 's'} and your shopping list. It replaces the favorites, ticks and shopping list on this device.`;
        if (!confirm(msg)) return;
        await db.importAll(data);
        favorites = new Set(data.favorites || []);
        shopping = data.shopping || db.emptyShopping();
        updateListBadge();
        toast('Backup restored.');
      } catch (err) {
        console.error(err);
        alert(err.message || "Sorry, that backup couldn't be restored.");
      }
    }
  };

  main.addEventListener('click', onClick);
  main.addEventListener('change', onChange);
  view.cleanup.push(() => {
    main.removeEventListener('click', onClick);
    main.removeEventListener('change', onChange);
  });
  afterRender('.page-title');
}

// ====================================================================
//  Start
// ====================================================================

async function start() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline support not available:', e));
  }
  try {
    const [u, f, s] = await Promise.all([db.getMeta('unlocked'), db.getMeta('favorites'), db.getMeta('shopping')]);
    unlocked = !!u;
    favorites = new Set(Array.isArray(f) ? f : []);
    if (s && Array.isArray(s.groups) && Array.isArray(s.custom)) shopping = s;
  } catch (e) {
    main.innerHTML = `<div class="card"><h1>Storage is turned off</h1><p>Sal's Kitchen saves your favorites and lists on this device, but your browser is blocking storage. If you are in a Private Browsing window, please open the app in a normal window.</p></div>`;
    return;
  }
  if (unlocked && install.isStandalone()) requestPersistentStorage();

  window.addEventListener('hashchange', route);
  route();
}

start();

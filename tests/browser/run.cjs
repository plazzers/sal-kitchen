#!/usr/bin/env node
// End-to-end checks in a real browser (Playwright + Chromium), on a phone (390×844) and a
// computer (1280×800). Uses the TEST packs in tests/fixtures/ (the app's ?packs=test mode).
//
//   node tests/browser/run.cjs                      (Playwright from this folder, or installed globally)
//   SHOTS=/some/folder node tests/browser/run.cjs   (also save screenshots there)
//
// It starts its own small web server, so nothing else needs to be running.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* try the global one */ }
  const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  return require(path.join(root, 'playwright'));
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = process.env.SHOTS || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/plain' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------- tiny test harness ----------
const results = [];
let current = '';
function ok(cond, name, detail = '') {
  results.push({ scenario: current, name, ok: !!cond, detail });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
}
function eq(got, want, name) {
  ok(JSON.stringify(got) === JSON.stringify(want), name, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const SIZES = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }];
const TODAY = new Date('2026-10-07T12:00:00'); // a Wednesday; week of Mon Oct 5 – Sun Oct 11
const CODES = { copycat: 'SAL-TEST-AAAA-1111', italian: 'SAL-TEST-ITAL-3333', bundle: 'SAL-TEST-BOTH-4444', hashOnly: 'SAL-TEST-HASH-9999' };

let base = '';
let browser;
let tmpDir;

// sw: 'block' for scenarios that fake server answers with page.route (it can't see service-worker requests).
async function newPage(size, { offlineOk = false, sw = 'allow' } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, acceptDownloads: true, serviceWorkers: sw });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  // No share sheet in this browser: the app falls back to copying.
  await context.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }); } catch (e) { /* ignore */ } });
  const page = await context.newPage();
  await page.clock.setFixedTime(TODAY);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/.test(t)) return; // expected 404s for missing packs
    if (offlineOk && /ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(t)) return;
    page.errors.push(`console: ${t}`);
  });
  page.on('dialog', (d) => d.accept());
  return { context, page };
}

async function shot(page, size, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${size.name}-${name}.png`), fullPage: false });
}

async function noSideScroll(page, label) {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(sw <= w, `no sideways scrolling: ${label}`, `${sw}px wide in a ${w}px window`);
}

const text = async (page, sel) => ((await page.locator(sel).first().textContent()) || '').replace(/\s+/g, ' ').trim();
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(150); };
const toastText = async (page) => text(page, '#toast');

async function enterCode(page, code, formSel = 'main .code-form') {
  await page.fill(`${formSel} input`, code);
  await page.click(`${formSel} button[type="submit"]`);
  await page.waitForFunction((sel) => { const b = document.querySelector(`${sel} button[type="submit"]`); return !b || !b.disabled; }, formSel, { timeout: 20000 });
  await page.waitForTimeout(200);
}

async function seed(page, version) {
  await page.goto(`${base}/tests/fixtures/README.md`);
  await page.evaluate(async (v) => {
    const m = await import('/tests/seed-db.js');
    const fx = await (await fetch('/tests/fixtures/v2-database.json')).json();
    await m.seedOldDatabase('sals-kitchen', v, fx);
  }, version);
}

async function waitForServiceWorker(page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  }
}

function finish(page, label) {
  ok(page.errors.length === 0, `no errors in the browser console (${label})`, page.errors.slice(0, 3).join(' | '));
}

// ---------- scenarios ----------

// 1. A new buyer with a bundle code: both packs, everything that was built before still works.
async function newBuyerBothPacks(size) {
  const { context, page } = await newPage(size, { offlineOk: true });
  await page.goto(`${base}/?packs=test`);
  await page.waitForSelector('#code');
  eq(await text(page, 'h1'), "Welcome to Sal's Kitchen", 'welcome screen');
  await shot(page, size, '01-unlock');
  await noSideScroll(page, 'welcome');

  await enterCode(page, 'SAL-TEST-NOPE-0000');
  ok(/didn't work/.test(await text(page, '#code-error')), 'a wrong code is refused');
  await enterCode(page, CODES.hashOnly);
  ok(/didn't work/.test(await text(page, '#code-error')), 'a code that only passes the hash pre-check is refused (decryption is the real gate)');
  ok(await page.locator('.rcard').count() === 0, 'still locked after wrong codes');

  await enterCode(page, ` ${CODES.bundle.toLowerCase()} `);
  await page.waitForSelector('.rcard');
  ok(/Benvenuti/.test(await toastText(page)), 'unlocked with a bundle code (any case, extra spaces)');
  eq(await page.locator('[data-lib]').allTextContents(), ['Copycat (33)', 'Italian Kitchen (10)', 'All'], 'library switcher');
  eq(await page.locator('.rcard').count(), 43, 'All shows 33 + 10 recipes');
  eq(await page.locator('.pack-group__title').allTextContents(), ["Sal's Kitchen", "Sal's Italian Kitchen (TEST PACK)"], 'each pack has its own heading under All');
  eq(await page.locator('.locked-pack').count(), 0, 'no locked cards when everything is unlocked');
  await page.locator('.finder').scrollIntoViewIfNeeded();
  await shot(page, size, '02-home-all');
  await noSideScroll(page, 'home');

  await page.click('[data-lib="italian"]');
  eq(await page.locator('.rcard').count(), 10, 'Italian Kitchen shows only its 10 recipes');
  eq((await page.locator('[data-chip]').allTextContents()).slice(2), ['Antipasti', 'Pasta & Risotto', 'Secondi', 'Pizza', 'Contorni', 'Sughi', 'Dolci'], 'Italian chapter chips');
  await page.click('[data-chip="italian:2"]');
  eq(await page.locator('.rcard').count(), 3, 'a chapter chip filters inside the pack');
  await page.click('[data-lib="copycat"]');
  eq(await page.locator('.rcard').count(), 33, 'Copycat shows its 33 recipes');
  await page.click('[data-lib="all"]');
  await page.fill('#q', 'garlic');
  await page.waitForTimeout(400);
  const found = await page.locator('.rcard__link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  ok(found.some((h) => h.includes('copycat:')) && found.some((h) => h.includes('italian:')), 'search finds recipes in both packs', found.join(' '));
  await page.click('[data-action="clear-search"]');

  // Italian recipe: scale, ticks, favorite, list, cooking mode, timers.
  await go(page, '#/recipe/italian:4');
  await page.waitForSelector('.recipe-title');
  eq(await text(page, '.recipe-title'), 'Test Risotto', 'Italian recipe page opens');
  ok((await text(page, '.eyebrow')).startsWith('Italian Kitchen · Nº 4'), 'recipe shows which book it is from');
  await page.click('[data-factor="2"]');
  eq(await text(page, '#ing-list li:first-child .ing__text'), '3 cups arborio rice', '×2 doubles the Italian amounts');
  await page.click('#ing-list li:nth-child(2) .ing');
  await page.click('[data-action="fav"]');
  await page.click('[data-action="add-list"]');
  await page.waitForTimeout(400);
  await shot(page, size, '03-recipe-italian');
  await noSideScroll(page, 'recipe');
  await page.locator('a[href="#/cook/italian:4"]').first().click();
  await page.waitForSelector('.cook-step__text');
  await page.locator('.timer-start').first().click();
  await page.waitForSelector('#timer-tray:not([hidden])');
  ok(/Test Risotto/.test(await text(page, '#timer-tray')), 'kitchen timer starts in cooking mode');
  for (let i = 0; i < 3; i++) await page.click('[data-action="next"]');
  await page.waitForSelector('.cook-done__title');
  ok(true, 'cooking mode goes through every step');
  await page.click('[data-timer-remove]');

  // Copycat recipe still works the same.
  await go(page, '#/recipe/copycat:5');
  await page.waitForSelector('.recipe-title');
  const single = await text(page, '#ing-list li:first-child .ing__text');
  await page.click('[data-factor="2"]');
  const double = await text(page, '#ing-list li:first-child .ing__text');
  ok(/^2 /.test(single) && double === single.replace(/^2 /, '4 ').replace(/into 4 /, 'into 8 '), 'copycat ×2 scaling still works', `${single} → ${double}`);
  await page.waitForTimeout(600); // the chosen amount is saved a moment later
  await go(page, '#/recipe/5');
  await page.waitForSelector('.recipe-title');
  eq(await text(page, '.recipe-title'), 'Chicken Parmigiana', 'an old link #/recipe/5 still opens copycat Nº 5');
  await go(page, '#/cook/copycat:5');
  await page.waitForSelector('.cook-step__text');
  await page.click('[data-action="ings"]');
  ok((await text(page, '.ing-list--drawer')).includes(double), 'cooking mode ingredients drawer uses the chosen amount');
  await page.click('[data-action="close-ings"]');

  // Favorites across packs.
  await go(page, '#/');
  await page.waitForSelector('[data-chip="fav"]');
  await page.click('[data-chip="fav"]');
  eq(await page.locator('.rcard__link').evaluateAll((as) => as.map((a) => a.getAttribute('href'))), ['#/recipe/italian:4'], 'favorite saved as italian:4');

  // ----- Planner across packs -----
  await go(page, '#/plan');
  await page.waitForSelector('.plan-week');
  const slot = (d, m = 'dinner') => `.slot[data-date="${d}"][data-meal="${m}"]`;
  await page.click(`${slot('2026-10-05')} [data-action="pick"]`);
  await page.fill('#pick-q', 'cacciatora');
  await page.waitForTimeout(300);
  await page.click('[data-pick="italian:5"]');
  await page.waitForTimeout(300);
  ok(/Test Chicken Cacciatora/.test(await text(page, slot('2026-10-05'))), 'Italian recipe planned from the picker');
  await page.click(`${slot('2026-10-06')} [data-action="leftovers"]`);
  await page.click('[data-choose="0"]');
  await page.waitForTimeout(300);
  ok(/Leftovers from Monday/.test(await text(page, slot('2026-10-06'))), 'leftovers from an Italian dinner');
  await page.click(`${slot('2026-10-07')} [data-action="pick"]`);
  await page.fill('#pick-q', 'parmigiana');
  await page.waitForTimeout(300);
  await page.click('[data-pick="copycat:5"]');
  await page.waitForTimeout(300);
  await page.click(`${slot('2026-10-07')} [data-plan-factor="2"]`);
  await page.waitForTimeout(300);
  await page.click('[data-action="surprise"]');
  await page.waitForTimeout(400);
  const dinners = await page.locator('.slot[data-meal="dinner"]:not(.slot--empty)').count();
  eq(dinners, 7, 'Surprise me fills every empty dinner');
  const titles = await page.locator('.slot[data-meal="dinner"] .slot__title').allTextContents();
  ok(!titles.some((t) => /Panna Cotta|Sugo|Roasted Potatoes|Bruschetta|Tiramisu|Lava Cake|Marinara|Ranch/.test(t)), 'no desserts, sauces or sides picked', titles.join(' | '));
  const foot = async (k) => Number((await text(page, `[data-money="${k}"]`)).replace(/[^0-9]/g, ''));
  const [h, r, k] = [await foot('home'), await foot('restaurant'), await foot('keep')];
  ok(h > 0 && r > h && Math.abs(r - h - k) <= 1, `money footer adds up (home ~$${h}, restaurant ~$${r}, keep ~$${k})`);
  eq(await page.locator('[data-money="unpriced"]').count(), 0, 'every planned recipe has a price estimate (test mode)');
  await page.click(`${slot('2026-10-07')} [data-action="made"]`);
  await page.waitForTimeout(300);
  ok(/~\$120/.test(await toastText(page)), '"We made it" on Chicken Parmigiana ×2 keeps ~$120', await toastText(page));
  await page.click(`${slot('2026-10-05')} [data-action="made"]`);
  await page.waitForTimeout(300);
  ok(/~\$62/.test(await toastText(page)), '"We made it" on an Italian dinner counts too (4 × ($19 − $3.50))', await toastText(page));
  await shot(page, size, '04-plan');
  await noSideScroll(page, 'plan');

  await page.click('[data-action="share-menu"]');
  await page.waitForTimeout(300);
  const menu = await page.evaluate(() => navigator.clipboard.readText());
  ok(/Monday — Test Chicken Cacciatora/.test(menu) && /Wednesday — Chicken Parmigiana \(×2\)/.test(menu) && /Cooked with Sal's Kitchen/.test(menu), 'share menu falls back to copying the text');

  const planned = await page.locator('.slot:not(.slot--leftover) .slot__title a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  await page.click('[data-action="make-list"]');
  await page.waitForSelector('.list-group');
  const groups = await page.locator('.list-group__head h2 a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  ok(groups.includes('#/recipe/italian:4') && groups.includes('#/recipe/italian:5') && groups.includes('#/recipe/copycat:5'), 'shopping list holds recipes from both packs', groups.join(' '));
  eq(groups.slice().sort(), [...new Set([...planned, '#/recipe/italian:4'])].sort(), 'one group per recipe (everything planned + the risotto added by hand)');
  await page.click('[data-list-view="combined"]');
  await page.waitForSelector('#lg-combined');
  ok(true, 'combined view works across packs');
  await shot(page, size, '05-list');
  await noSideScroll(page, 'list');

  await go(page, '#/settings');
  await page.waitForSelector('#books');
  eq(await page.locator('.book--open').count(), 2, 'Settings lists both books as unlocked');
  await page.check('input[name="pantry"][value="butter"]');
  await page.waitForTimeout(200);
  await go(page, '#/list');
  await page.waitForSelector('#pantry-box');
  ok(/butter/i.test(await text(page, '#pantry-box')), 'pantry staples are tucked away');

  await go(page, '#/');
  await page.waitForSelector('#savings-total');
  eq(await text(page, '#savings-total'), '~$182', 'saved-so-far counter on Home');

  // Backup and restore.
  await go(page, '#/settings');
  await page.waitForSelector('[data-action="backup"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="backup"]')]);
  const file = path.join(tmpDir, `backup-${size.name}.json`);
  await dl.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(backup.format === 3 && backup.favorites.includes('italian:4') && backup.savings.length === 2 && !/SAL-TEST|wrappedKey/.test(JSON.stringify(backup)), 'backup (format 3) has everything, and no codes or keys');
  await go(page, '#/plan');
  await page.waitForSelector('[data-action="clear-week"]');
  await page.click('[data-action="clear-week"]');
  await page.waitForTimeout(300);
  eq(await page.locator('.slot--empty').count(), 7, 'week cleared');
  await go(page, '#/settings');
  await page.setInputFiles('#restore-file', file);
  await page.waitForTimeout(800);
  await go(page, '#/plan');
  await page.waitForSelector('.plan-week');
  eq(await page.locator('.slot[data-meal="dinner"]:not(.slot--empty)').count(), 7, 'restore brings the week back');

  // Offline after unlock: no code, no internet.
  await waitForServiceWorker(page);
  await go(page, '#/');
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.rcard', { timeout: 15000 });
  eq(await page.locator('.rcard').count(), 43, 'offline reload: both packs open from this device, no code needed');
  await go(page, '#/recipe/italian:7');
  await page.waitForSelector('.recipe-title');
  eq(await text(page, '.recipe-title'), 'Test Pizza Margherita', 'offline: Italian recipe opens');
  await context.setOffline(false);
  finish(page, 'new buyer');
  await context.close();
}

// 2. A copycat-only buyer: the Italian pack is a tasteful locked card, then gets unlocked.
async function copycatBuyerUnlocksItalian(size) {
  const { context, page } = await newPage(size);
  await page.goto(`${base}/?packs=test`);
  await page.waitForSelector('#code');
  await enterCode(page, CODES.copycat);
  await page.waitForSelector('.rcard');
  eq(await page.locator('.rcard').count(), 33, 'copycat code opens the 33 copycat recipes');
  ok(await page.locator('[data-lib="italian"] .icon').count() === 1, 'Italian tab shows a lock');
  eq(await page.locator('.locked-pack').count(), 1, 'All ends with the locked Italian card');
  await page.click('[data-lib="italian"]');
  await page.waitForSelector('.locked-pack');
  eq(await page.locator('.rcard').count(), 0, 'no Italian recipes before unlocking');
  ok(/Sal's Italian Kitchen/.test(await text(page, '.locked-pack__title')) && /real Italian recipes\. Unlock with the code from your Italian Kitchen purchase/.test(await text(page, '.locked-pack__pitch')), 'locked card text');
  eq(await page.getAttribute('.locked-pack a.btn', 'href'), 'https://payhip.com/b/Lv425?utm_source=app&utm_medium=locked-pack&utm_campaign=italian', '"Get it" link');
  await page.click('[data-action="have-code"]');
  await shot(page, size, '06-locked-card');
  await noSideScroll(page, 'locked card');
  await enterCode(page, CODES.copycat, '.locked-pack .code-form');
  ok(/doesn't open Sal's Italian Kitchen/.test(await text(page, '.locked-pack .error')), 'the copycat code is kindly refused for the Italian pack');
  await enterCode(page, CODES.italian, '.locked-pack .code-form');
  await page.waitForSelector('.rcard');
  ok(/Sal's Italian Kitchen.* unlocked/.test(await toastText(page)), 'Italian Kitchen unlocked with its code', await toastText(page));
  eq(await page.locator('.rcard').count(), 10, 'Italian recipes now show');
  await page.reload();
  await page.waitForSelector('.rcard');
  eq(await page.locator('.locked-pack').count(), 0, 'stays unlocked after a reload');
  finish(page, 'copycat buyer');
  await context.close();
}

// 3. People who unlocked the live app before this version (v1 and v2 data): one-time code re-entry.
async function existingUser(size, version) {
  const { context, page } = await newPage(size);
  await seed(page, version);
  await page.goto(`${base}/?packs=test`);
  await page.waitForSelector('.reentry');
  eq(await text(page, 'h1'), 'Welcome back!', `v${version} user sees the one-time re-entry screen`);
  ok((await text(page, '.lede')).includes("Quick one-time step: enter your access code again to load your recipes (it's in your Payhip PDF)."), 're-entry wording');
  ok(/still here, safe on this device/.test(await text(page, '.reentry__safe')), 're-entry says their data is safe');
  await shot(page, size, `07-reentry-v${version}`);
  await noSideScroll(page, 're-entry');

  await page.click('.reentry__list a');
  await page.waitForSelector('.list-group');
  ok(/Chicken Parmigiana/.test(await text(page, 'main')) && /paper towels/.test(await text(page, 'main')), 'shopping list opens before the code is entered');
  await go(page, '#/plan');
  await page.waitForSelector('.reentry');
  ok(true, 'other pages wait for the code');

  await enterCode(page, 'SAL-NOT-A-CODE');
  ok(/didn't work/.test(await text(page, '#code-error')), 'wrong code refused on re-entry');
  await enterCode(page, CODES.copycat);
  await page.waitForSelector('.rcard, .page-title');
  ok(/everything you saved is right where you left it/.test(await toastText(page)), 'kind confirmation after re-entry');
  await go(page, '#/');
  await page.waitForSelector('[data-chip="fav"]');
  await page.click('[data-chip="fav"]');
  eq(await page.locator('.rcard__link').evaluateAll((as) => as.map((a) => a.getAttribute('href'))), ['#/recipe/copycat:2', '#/recipe/copycat:5', '#/recipe/copycat:30'], 'old favorites kept');
  await go(page, '#/recipe/copycat:5');
  await page.waitForSelector('#ing-list');
  eq(await page.locator('#ing-list .ing[aria-checked="true"]').evaluateAll((b) => b.map((x) => x.dataset.ing)), ['0', '2'], 'old ticks kept');
  eq(await page.getAttribute('[data-factor="2"]', 'aria-pressed'), 'true', 'old amount (×2) kept');
  eq(await page.locator('.step[aria-pressed="true"]').count(), 1, 'old finished steps kept');
  await go(page, '#/list');
  await page.waitForSelector('.list-group');
  if (await page.locator('[data-list-view="recipe"][aria-pressed="false"]').count()) {
    await page.click('[data-list-view="recipe"]'); // the v2 data had the Combined view on
    await page.waitForSelector('.list-group__head h2 a');
  }
  eq(await page.locator('.list-group__head h2 a').evaluateAll((as) => as.map((a) => a.getAttribute('href'))), ['#/recipe/copycat:5', '#/recipe/copycat:30'], 'old shopping list links to the right recipes');
  eq(await page.locator('.shop-item[aria-checked="true"]').count(), 1, 'old shopping ticks kept');
  if (version === 2) {
    await go(page, '#/plan');
    await page.waitForSelector('.plan-week');
    ok(/Chicken Parmigiana/.test(await text(page, '.slot[data-date="2026-10-05"][data-meal="dinner"]')) && await page.getAttribute('.slot[data-date="2026-10-05"][data-meal="dinner"] [data-action="made"]', 'aria-pressed') === 'true', 'old plan kept (made)');
    ok(/Leftovers from Monday/.test(await text(page, '.slot[data-date="2026-10-06"][data-meal="dinner"]')), 'old leftovers kept');
    ok(/Burrito Bowl/.test(await text(page, '.slot[data-date="2026-10-06"][data-meal="lunch"]')), 'old lunch slot kept');
    await go(page, '#/');
    await page.waitForSelector('#savings-total');
    eq(await text(page, '#savings-total'), '~$120', 'old savings counter kept');
    // Un-marking keeps the savings history consistent with the migrated ids.
    await go(page, '#/plan');
    await page.waitForSelector('.plan-week');
    await page.click('.slot[data-date="2026-10-05"][data-meal="dinner"] [data-action="made"]');
    await page.waitForTimeout(300);
    await go(page, '#/');
    await page.waitForSelector('.savings');
    eq(await page.locator('#savings-total').count(), 0, 'un-marking an old meal removes its old savings entry');
  }
  await go(page, '#/');
  await page.reload();
  await page.waitForSelector('.hello');
  eq(await page.locator('.reentry').count(), 0, 'only asked once (not again after a reload)');
  finish(page, `v${version} user`);
  await context.close();
}

// 4. Pack files missing: a friendly screen, never a blank page.
async function missingPacks(size) {
  const { context, page } = await newPage(size, { sw: 'block' });
  await page.goto(`${base}/`); // production mode: packs/ only has a README
  await page.waitForSelector('.updating');
  eq(await text(page, 'h1'), 'Recipes are updating', 'production with no pack files: "Recipes are updating"');
  ok(/Please reload in a minute/.test(await text(page, '.lede')), 'asks to reload in a minute');
  await shot(page, size, '08-updating');
  await noSideScroll(page, 'updating');
  await seed(page, 1);
  await page.goto(`${base}/`);
  await page.waitForSelector('.updating');
  ok(/safe on this device/.test(await text(page, '.updating')) && await page.locator('.updating a[href="#/list"]').count() === 1, 'existing users are told their data is safe');

  // Test mode, the pack appears while the screen is open: "Try again" picks it up.
  await page.route('**/tests/fixtures/*.pack.json', (r) => r.fulfill({ status: 404, body: 'Not found' }));
  await page.goto(`${base}/?packs=test`);
  await page.waitForSelector('.updating');
  await page.unroute('**/tests/fixtures/*.pack.json');
  await page.click('[data-action="retry"]');
  await page.waitForSelector('.reentry');
  ok(true, '"Try again" loads the packs once they are there');

  // Only the Italian pack missing: copycat works, Italian waits politely.
  await page.route('**/tests/fixtures/italian.pack.json', (r) => r.fulfill({ status: 404, body: 'Not found' }));
  await page.reload();
  await page.waitForSelector('.reentry');
  await enterCode(page, CODES.bundle);
  await page.waitForSelector('.hello');
  await go(page, '#/');
  await page.waitForSelector('[data-lib]');
  eq(await page.locator('.rcard').count(), 33, 'copycat opens while Italian is missing');
  await page.click('[data-lib="italian"]');
  await page.click('[data-action="have-code"]');
  await enterCode(page, CODES.italian, '.locked-pack .code-form');
  ok(/still on their way/.test(await text(page, '.locked-pack .error')), 'Italian code while its pack is missing: "still on their way"');
  await page.unroute('**/tests/fixtures/italian.pack.json');
  await page.reload();
  await page.waitForSelector('.rcard');
  await page.waitForTimeout(3000);
  ok(/your code opens it too/.test(await toastText(page)), 'when the Italian pack arrives, the bundle code used before opens it by itself', await toastText(page));
  eq(await page.locator('[data-lib="italian"] .icon').count(), 0, 'Italian unlocked without typing the code again');
  finish(page, 'missing packs');
  await context.close();
}

// 5. A pack rebuilt with a NEW key: the saved key no longer fits. The code this device
//    remembers opens it again by itself; without one, the person is asked kindly, once.
async function rebuiltPack(size, rebuilt) {
  const fake = (page) => page.route('**/tests/fixtures/italian.pack.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: rebuilt }));
  {
    const { context, page } = await newPage(size, { sw: 'block' });
    await page.goto(`${base}/?packs=test`);
    await page.waitForSelector('#code');
    await enterCode(page, CODES.italian);
    await page.waitForSelector('.rcard');
    await fake(page);
    await page.reload();
    await page.waitForSelector('.rcard', { timeout: 20000 });
    eq(await page.locator('.rcard').count(), 10, 'Italian pack rebuilt with a new key opens again with the code this device remembered');
    eq(await page.locator('.reentry').count(), 0, 'nobody is asked for the code again');
    finish(page, 'rebuilt pack, remembered code');
    await context.close();
  }
  {
    const { context, page } = await newPage(size, { sw: 'block' });
    await page.goto(`${base}/?packs=test`);
    await page.waitForSelector('#code');
    await enterCode(page, CODES.italian);
    await page.waitForSelector('.rcard');
    // Like a device unlocked before codes were remembered.
    await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('sals-kitchen'); r.onsuccess = () => { const t = r.result.transaction('meta', 'readwrite'); t.objectStore('meta').delete('codes'); t.oncomplete = () => { r.result.close(); res(); }; }; }));
    await fake(page);
    await page.reload();
    await page.waitForSelector('.reentry');
    ok(true, 'without a remembered code, the re-entry screen asks once');
    await enterCode(page, CODES.italian);
    await page.waitForSelector('.hello');
    eq(await page.locator('.rcard').count(), 10, 're-entering the code fixes it');
    finish(page, 'rebuilt pack, no remembered code');
    await context.close();
  }
}

async function selfTestPages() {
  const { context, page } = await newPage(SIZES[1]);
  for (const p of ['tests/planner.html', 'tests/packs.html']) {
    await page.goto(`${base}/${p}`);
    await page.waitForFunction(() => window.__testResults, null, { timeout: 90000 });
    const r = await page.evaluate(() => window.__testResults);
    ok(r.failed.length === 0, `${p}: ${r.total - r.failed.length} of ${r.total} checks passed`, r.failed.slice(0, 5).map((f) => `${f.name}: ${f.detail}`).join(' | '));
  }
  finish(page, 'self-test pages');
  await context.close();
}

(async () => {
  const server = await serve();
  base = `http://localhost:${server.address().port}`;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sal-e2e-'));
  // A copy of the fake Italian pack rebuilt with a new key (like the owner running --new-key).
  const rebuiltPath = path.join(tmpDir, 'italian-rebuilt.pack.json');
  fs.writeFileSync(path.join(tmpDir, 'it-codes.txt'), `${CODES.italian}\n${CODES.bundle}\n`);
  execFileSync('python3', [path.join(ROOT, 'tools', 'build_packs.py'), '--pack', 'italian', '--input', path.join(ROOT, 'tests', 'fixtures', 'italian-fake.json'),
    '--codes', path.join(tmpDir, 'it-codes.txt'), '--out', rebuiltPath, '--new-key', '--allow-tracked-input'], { stdio: 'ignore' });
  const rebuilt = fs.readFileSync(rebuiltPath, 'utf8');

  browser = await chromium.launch();
  const run = async (name, fn) => {
    current = name;
    console.log(`\n${name}`);
    try { await fn(); } catch (e) { ok(false, 'scenario finished without crashing', (e && e.stack ? e.stack : String(e)).split('\n').slice(0, 4).join(' ')); }
  };
  await run('Self-test pages', selfTestPages);
  for (const size of SIZES) {
    const tag = `${size.width}×${size.height}`;
    await run(`[${tag}] New buyer, bundle code, both packs`, () => newBuyerBothPacks(size));
    await run(`[${tag}] Copycat buyer unlocks the Italian pack`, () => copycatBuyerUnlocksItalian(size));
    await run(`[${tag}] Existing v1 user (what's live today)`, () => existingUser(size, 1));
    await run(`[${tag}] Existing v2 user (planner data)`, () => existingUser(size, 2));
    await run(`[${tag}] Pack files missing`, () => missingPacks(size));
    await run(`[${tag}] Pack rebuilt with a new key`, () => rebuiltPack(size, rebuilt));
  }
  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? `${failed.length} of ${results.length} checks FAILED` : `All ${results.length} browser checks passed.`}`);
  failed.forEach((f) => console.log(`  ✗ [${f.scenario}] ${f.name} — ${f.detail}`));
  process.exit(failed.length ? 1 : 0);
})();

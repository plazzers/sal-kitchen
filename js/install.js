import { isIOS, isAndroid, isStandalone } from './util.js';

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.dispatchEvent(new CustomEvent('sal-install-available'));
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
});

export function canPromptInstall() {
  return !!deferredPrompt;
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  const p = deferredPrompt;
  deferredPrompt = null;
  p.prompt();
  const choice = await p.userChoice.catch(() => null);
  return !!(choice && choice.outcome === 'accepted');
}

export function platform() {
  if (isIOS()) return 'ios';
  if (isAndroid()) return 'android';
  return 'desktop';
}

export { isStandalone };

export const IPHONE_STEPS = `
  <ol class="steps">
    <li>Open this page in <strong>Safari</strong> (the blue compass app).</li>
    <li>Tap the <strong>Share</strong> button — the square with an arrow pointing up. It's at the bottom of the screen (on iPad, at the top). If you don't see it, tap the <strong>⋯</strong> button first.</li>
    <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
    <li>Tap <strong>Add</strong>. Sal's Kitchen now has its own icon on your Home Screen.</li>
  </ol>`;

export const ANDROID_STEPS = `
  <ol class="steps">
    <li>Open this page in <strong>Chrome</strong>.</li>
    <li>Tap the <strong>⋮</strong> menu (three dots, top right).</li>
    <li>Tap <strong>Install app</strong> (on some phones it says <strong>Add to Home screen</strong>).</li>
    <li>Tap <strong>Install</strong>. Sal's Kitchen now has its own icon on your Home screen.</li>
  </ol>`;

export const DESKTOP_STEPS = `
  <ul class="steps">
    <li><strong>Chrome or Edge:</strong> click the install icon at the right end of the address bar (a small screen with a down arrow), then <strong>Install</strong>.</li>
    <li><strong>Safari on Mac:</strong> choose <strong>File → Add to Dock</strong>.</li>
  </ul>`;

export const IPHONE_DATA_NOTE = `
  <p><strong>Why install on iPhone?</strong> Safari may clear saved website data if you don't open a site for a while. When you add Sal's Kitchen to your Home Screen, your favorites, ticked ingredients and shopping list are kept safely on your phone.</p>
  <p>It's also a good idea to <a href="#/settings">make a backup</a> now and then — it's one tap in Settings.</p>`;

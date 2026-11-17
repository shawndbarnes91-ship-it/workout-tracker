// One-time hint in iPhone Safari (not the home-screen app): add the app to the Home
// Screen for full screen. Never shown again once dismissed.

import { h, icon } from './util.js';

const KEY = 'wt-install-hint-dismissed';

export function isStandalone() {
  return window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function dismissed() {
  try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
}

export function shouldShowInstallHint() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPod|iPad/.test(ua) && !isStandalone() && !dismissed();
}

/** The hint card, or null when it should not show. */
export function installHint() {
  if (!shouldShowInstallHint()) return null;
  const card = h('div', { class: 'card install-hint', role: 'note' },
    h('span', { class: 'hint-icon' }, icon('share')),
    h('p', { class: 'grow' }, 'Add to Home Screen for full screen: tap Share, then Add to Home Screen.'),
    h('button', {
      type: 'button',
      class: 'icon-btn hint-close',
      'aria-label': 'Dismiss',
      onclick: () => {
        try { localStorage.setItem(KEY, '1'); } catch (e) { /* private mode: hides for this visit */ }
        card.remove();
      },
    }, icon('x')));
  return card;
}

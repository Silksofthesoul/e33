import { languageTags, messages } from './messages.js';

export const preferenceKey = 'silksofthesoul:language';

export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    const base = canonical?.split('-')[0];
    return Object.hasOwn(languageTags, base) ? base : null;
  } catch { return null; }
}

export function resolveLocale({ parentLocale, url, saved, browserLanguages = [] }) {
  return normalizeLocale(parentLocale) ?? normalizeLocale(url.searchParams.get('lang')) ??
    normalizeLocale(url.pathname.split('/')[1]) ?? normalizeLocale(saved) ??
    browserLanguages.map(normalizeLocale).find(Boolean) ?? (url.hostname.toLowerCase().endsWith('.com') ? 'en' : 'ru');
}

export function translate(locale, key, values = {}) {
  const template = messages[normalizeLocale(locale) ?? 'ru'][key];
  if (typeof template !== 'string') throw new Error(`Unknown translation: ${key}`);
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

export function errorKey(error) {
  const keys = { corrupt: 'errorCorrupt', blocked: 'errorBlocked', quota: 'errorQuota', conflict: 'errorConflict' };
  return Object.hasOwn(keys, error?.code) ? keys[error.code] : 'errorUnexpected';
}

// Subscribe to the existing same-origin host event. E33 remains standalone:
// inaccessible parents are ignored; no host DOM, URL or storage is modified.
export function createI18n(win, doc, onChange = () => {}) {
  let locale = 'ru';
  let host = null;
  let started = false;
  const text = (key, values) => translate(locale, key, values);

  function apply(next) {
    const supported = normalizeLocale(next);
    if (!supported) return;
    locale = supported;
    doc.documentElement.lang = languageTags[locale];
    for (const node of doc.querySelectorAll('[data-i18n]')) node.textContent = text(node.dataset.i18n);
    for (const attribute of ['placeholder', 'content']) {
      for (const node of doc.querySelectorAll(`[data-i18n-${attribute}]`)) {
        node.setAttribute(attribute, text(node.getAttribute(`data-i18n-${attribute}`)));
      }
    }
    onChange();
  }

  function changed(event) { apply(event.detail?.locale); }
  function disconnect() {
    host?.removeEventListener('site:languagechange', changed);
    host = null;
  }
  function connect() {
    disconnect();
    let parentLocale;
    try {
      if (win.parent !== win) {
        const root = win.parent.document.documentElement;
        parentLocale = normalizeLocale(root.dataset.locale) ?? normalizeLocale(root.lang);
        host = win.parent;
        host.addEventListener('site:languagechange', changed);
      }
    } catch { host = null; /* Independent/cross-origin embedding uses its own preference. */ }
    let saved;
    try { saved = win.localStorage.getItem(preferenceKey); } catch { /* Storage can be blocked. */ }
    apply(resolveLocale({ parentLocale, saved, url: new URL(win.location.href),
      browserLanguages: win.navigator.languages ?? [win.navigator.language] }));
  }

  return {
    get locale() { return locale; },
    text,
    number: value => value.toLocaleString(languageTags[locale]),
    start() {
      if (started) return;
      started = true;
      win.addEventListener('pageshow', connect);
      win.addEventListener('pagehide', disconnect);
      connect();
    },
    stop() {
      disconnect();
      win.removeEventListener('pageshow', connect);
      win.removeEventListener('pagehide', disconnect);
      started = false;
    },
  };
}

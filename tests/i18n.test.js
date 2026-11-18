import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { messages, languageTags } from '../assets/messages.js';
import { normalizeLocale, resolveLocale, translate, errorKey, createI18n } from '../assets/i18n.js';

test('six languages translate every UI key and preserve interpolation parameters', async () => {
  const keys = Object.keys(messages.ru).sort();
  assert.deepEqual(Object.keys(messages), ['ru', 'en', 'es', 'fr', 'zh', 'ja']);
  for (const [locale, dictionary] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys);
    for (const key of keys) {
      assert.ok(dictionary[key].trim(), `${locale}.${key}`);
      assert.deepEqual(dictionary[key].match(/\{\w+\}/g), messages.ru[key].match(/\{\w+\}/g));
    }
    assert.ok(translate(locale, 'modelWords', { count: 123 }).includes('123'));
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const [, key] of html.matchAll(/data-i18n(?:-placeholder|-content)?="([^"]+)"/g)) {
    assert.ok(Object.hasOwn(messages.ru, key), key);
  }
  const manifest = JSON.parse(await readFile(new URL('../preview.json', import.meta.url), 'utf8'));
  assert.ok(manifest.files.includes('assets/i18n.js'));
  assert.ok(manifest.files.includes('assets/messages.js'));
});

test('host choice precedes standalone URL, saved preference, browser and domain', () => {
  const resolve = (options = {}) => resolveLocale({ url: new URL('https://example.ru/experiments/e33/?lang=es'), saved: 'fr', browserLanguages: ['ja'], ...options });
  assert.equal(resolve({ parentLocale: 'zh-Hans-CN' }), 'zh');
  assert.equal(resolve(), 'es');
  assert.equal(resolve({ url: new URL('https://example.ru/ja/') }), 'ja');
  assert.equal(resolve({ url: new URL('https://example.ru/') }), 'fr');
  assert.equal(resolve({ url: new URL('https://example.ru/'), saved: 'bad' }), 'ja');
  assert.equal(resolve({ url: new URL('https://example.com/'), saved: null, browserLanguages: [] }), 'en');
  assert.equal(resolve({ url: new URL('https://example.ru/'), saved: null, browserLanguages: [] }), 'ru');
  for (const invalid of ['de', 'ch', 'jp', '', '<script>', null, {}]) assert.equal(normalizeLocale(invalid), null);
  assert.equal(normalizeLocale('en-GB'), 'en');
  assert.equal(normalizeLocale('fr-CA'), 'fr');
});

function environment() {
  const parent = new EventTarget();
  parent.document = { documentElement: { lang: 'en', dataset: { locale: 'en' } } };
  const win = new EventTarget();
  Object.assign(win, { parent, location: { href: 'https://example.com/experiments/e33/?lang=es' }, navigator: { languages: ['ja'] }, localStorage: { getItem: () => 'fr' } });
  const label = { dataset: { i18n: 'train' }, textContent: '' };
  const source = { value: 'user draft', placeholder: '', getAttribute: () => 'sourcePlaceholder', setAttribute(name, value) { this[name] = value; } };
  const doc = { documentElement: { lang: 'ru' }, querySelectorAll: selector => selector === '[data-i18n]' ? [label] : selector === '[data-i18n-placeholder]' ? [source] : [] };
  const change = locale => parent.dispatchEvent(new CustomEvent('site:languagechange', { detail: { locale } }));
  return { parent, win, doc, label, source, change };
}

test('host language changes update text, attributes and html lang while preserving user input', () => {
  const env = environment(); let changes = 0;
  const i18n = createI18n(env.win, env.doc, () => changes++);
  i18n.start(); i18n.start();
  assert.equal(changes, 1);
  for (const locale of Object.keys(messages)) {
    env.change(locale);
    assert.equal(i18n.locale, locale);
    assert.equal(env.doc.documentElement.lang, languageTags[locale]);
    assert.equal(env.label.textContent, messages[locale].train);
    assert.equal(env.source.placeholder, messages[locale].sourcePlaceholder);
    assert.equal(env.source.value, 'user draft');
  }
  env.change('<script>');
  assert.equal(i18n.locale, 'ja');
  i18n.stop(); env.change('fr');
  assert.equal(i18n.locale, 'ja');
});

test('pagehide detaches parent listeners and pageshow restores the current host choice', () => {
  const env = environment(); let changes = 0;
  const i18n = createI18n(env.win, env.doc, () => changes++);
  i18n.start(); env.win.dispatchEvent(new Event('pagehide'));
  env.change('fr'); assert.equal(i18n.locale, 'en');
  env.parent.document.documentElement.dataset.locale = 'fr';
  env.win.dispatchEvent(new Event('pageshow'));
  assert.equal(i18n.locale, 'fr');
  const before = changes;
  env.change('es'); assert.equal(changes, before + 1);
  i18n.stop();
});

test('standalone and inaccessible parent/storage fallbacks keep the interface usable', () => {
  for (const standalone of [true, false]) {
    const env = environment();
    env.win.parent = standalone ? env.win : { get document() { throw new Error('cross-origin'); } };
    Object.defineProperty(env.win, 'localStorage', { get() { throw new Error('blocked'); } });
    const i18n = createI18n(env.win, env.doc);
    i18n.start();
    assert.equal(i18n.locale, 'es');
    assert.equal(env.label.textContent, messages.es.train);
    i18n.stop();
  }
  for (const code of ['corrupt', 'blocked', 'quota', 'conflict']) {
    for (const locale of Object.keys(messages)) assert.ok(translate(locale, errorKey({ code })).trim());
  }
  assert.equal(errorKey({ code: '__proto__' }), 'errorUnexpected');
  assert.equal(errorKey(new Error('Russian or browser error')), 'errorUnexpected');
});

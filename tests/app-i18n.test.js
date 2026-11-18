import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { messages, languageTags } from '../assets/messages.js';
import { STORAGE_KEY } from '../assets/storage.js';

class Element extends EventTarget {
  value = '';
  textContent = '';
  dataset = {};
  attributes = {};
  disabled = false;
  open = false;
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
}

test('real app changes UI language without changing the trained model, draft, result or dialog', async () => {
  const nodes = Object.fromEntries(['source', 'result', 'train', 'generate', 'status', 'clear-dialog', 'counter', 'model-info', 'clear', 'training-form', 'cancel-clear', 'confirm-clear'].map(id => [id, new Element()]));
  const label = new Element(); label.dataset.i18n = 'train';
  nodes.source.attributes['data-i18n-placeholder'] = 'sourcePlaceholder';
  const document = Object.assign(new EventTarget(), {
    documentElement: { lang: 'ru' }, hidden: false,
    querySelector: selector => nodes[selector.slice(1)],
    querySelectorAll: selector => selector === '[data-i18n]' ? [label] : selector === '[data-i18n-placeholder]' ? [nodes.source] : [],
  });
  const data = new Map(); let quota = false;
  const localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem(key, value) { if (quota) throw new Error('quota'); data.set(key, value); },
    removeItem: key => data.delete(key),
  };
  const host = Object.assign(new EventTarget(), { document: { documentElement: { lang: 'en', dataset: { locale: 'en' } } } });
  const window = Object.assign(new EventTarget(), { parent: host, localStorage, location: { href: 'https://example.com/experiments/e33/' }, navigator: { languages: ['ru'] } });
  const saved = Object.fromEntries(['window', 'document', 'navigator'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({ window, document, navigator: window.navigator })) Object.defineProperty(globalThis, name, { value, configurable: true });
  const until = async predicate => {
    for (let i = 0; i < 50; i++) { if (predicate()) return; await delay(10); }
    assert.fail('app did not reach expected state');
  };
  try {
    await import('../assets/app.js');
    assert.equal(nodes.status.textContent, messages.en.welcome);
    nodes.source.value = 'red green blue red green blue';
    nodes['training-form'].dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => nodes.status.textContent === messages.en.trained);
    assert.equal(nodes.result.value.split(/\s+/).length, 65);
    const generated = nodes.result.value;
    nodes.source.value = 'a new draft, not trained';
    nodes.source.dispatchEvent(new Event('input'));
    await until(() => nodes.status.textContent === messages.en.draftSaved);
    const state = localStorage.getItem(STORAGE_KEY);
    nodes.clear.dispatchEvent(new Event('click'));
    for (const locale of Object.keys(messages)) {
      host.dispatchEvent(new CustomEvent('site:languagechange', { detail: { locale } }));
      assert.equal(document.documentElement.lang, languageTags[locale]);
      assert.equal(label.textContent, messages[locale].train);
      assert.equal(nodes.source.attributes.placeholder, messages[locale].sourcePlaceholder);
      assert.equal(nodes.status.textContent, messages[locale].draftSaved);
      assert.equal(nodes.source.value, 'a new draft, not trained');
      assert.equal(nodes.result.value, generated);
      assert.equal(localStorage.getItem(STORAGE_KEY), state);
      assert.equal(nodes['clear-dialog'].open, true);
    }
    quota = true;
    nodes.source.value = 'draft after quota error';
    nodes.source.dispatchEvent(new Event('input'));
    await until(() => nodes.status.textContent === messages.ja.errorQuota);
    host.dispatchEvent(new CustomEvent('site:languagechange', { detail: { locale: 'fr' } }));
    assert.equal(nodes.status.textContent, messages.fr.errorQuota);
    assert.equal(nodes.status.dataset.kind, 'error');
    assert.equal(nodes.source.value, 'draft after quota error');
    assert.equal(nodes.result.value, generated);
    assert.equal(localStorage.getItem(STORAGE_KEY), state);
    window.dispatchEvent(new Event('pagehide'));
  } finally {
    for (const name of Object.keys(saved)) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  }
});

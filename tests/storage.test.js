import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStore, STORAGE_KEY, parseState } from '../assets/storage.js';
import { Markov } from '../assets/markov.js';

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const learn = text => async state => {
  const model = new Markov(state.model); await model.process(text);
  return { ...state, draft: text, model: model.snapshot() };
};

test('text and model survive a new browser store; drafts do not train', async () => {
  const disk = storage(); const store = new LocalStore(disk);
  await store.update(learn('Привет, море. Привет, лес.'));
  store.saveDraftNow('Ещё не обученный текст');
  const next = new LocalStore(disk).read();
  assert.equal(next.draft, 'Ещё не обученный текст');
  assert.equal(next.model.chain['Привет,'].count, 2);
  assert.equal(next.model.chain['Ещё'], undefined);
});

test('quota failure keeps the previously saved model and text', async () => {
  const disk = storage(); const store = new LocalStore(disk);
  await store.update(learn('old corpus'));
  const before = disk.getItem(STORAGE_KEY);
  disk.setItem = () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(store.update(learn('new corpus')), error => error.code === 'quota');
  assert.equal(disk.getItem(STORAGE_KEY), before);
});

test('corrupt or future data are not silently overwritten; clear removes only our key', async () => {
  for (const raw of ['not-json', '{"version":2}', '{"version":1,"draft":"","model":{"id":0,"chain":{"bad":null}}}']) {
    const disk = storage(); disk.setItem(STORAGE_KEY, raw); disk.setItem('another-app', 'keep');
    const store = new LocalStore(disk);
    assert.throws(() => store.read(), error => error.code === 'corrupt');
    await assert.rejects(store.update(learn('test')), error => error.code === 'corrupt');
    assert.equal(disk.getItem(STORAGE_KEY), raw);
    await store.clear();
    assert.equal(disk.getItem(STORAGE_KEY), null);
    assert.equal(disk.getItem('another-app'), 'keep');
  }
});

test('blocked storage supports an explicit, temporary in-memory session', async () => {
  const store = new LocalStore(null);
  assert.equal(store.persistent, false);
  await store.update(learn('a b'));
  assert.equal(store.read().draft, 'a b');
  assert.equal(new LocalStore(null).read().draft, '');
});

test('a cross-tab change is detected before replacing persistent data', async () => {
  const disk = storage(); const store = new LocalStore(disk);
  await assert.rejects(store.update(async state => {
    disk.setItem(STORAGE_KEY, JSON.stringify({ ...state, draft: 'other tab' }));
    return { ...state, draft: 'stale tab' };
  }), error => error.code === 'conflict');
  assert.equal(parseState(disk.getItem(STORAGE_KEY)).draft, 'other tab');
});

test('Web Locks serialize training from two tabs without losing either text', async () => {
  const disk = storage(); let queue = Promise.resolve();
  const locks = { request(key, callback) { assert.equal(key, STORAGE_KEY); const next = queue.then(callback); queue = next.catch(() => {}); return next; } };
  const a = new LocalStore(disk, locks), b = new LocalStore(disk, locks);
  await Promise.all([a.update(learn('first text')), b.update(learn('second text'))]);
  assert.ok(a.read().model.chain.first);
  assert.ok(a.read().model.chain.second);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Markov } from '../assets/markov.js';
import { sha1 } from '../assets/sha1.js';

test('author algorithm methods are byte-identical to the agreed source', async () => {
  const baseline = JSON.parse(await readFile(new URL('./algorithm-baseline.json', import.meta.url)));
  for (const [method, expected] of Object.entries(baseline.methods)) {
    const actual = createHash('sha256').update(Markov.prototype[method].toString()).digest('hex');
    assert.equal(actual, expected, `Author method changed: ${method}`);
  }
});

test('browser deduplication produces the original Node SHA-1 keys, including Unicode', () => {
  for (const value of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(50000), 'Привет, мир!\n🐊', '\ud800', 'a\r\nb']) {
    assert.equal(sha1(value), createHash('sha1').update(value).digest('hex'));
  }
});

test('learning preserves repeated transitions and whole-text deduplication across reload', async () => {
  const model = new Markov();
  await model.process('a b a c a b');
  assert.deepEqual(model.chain.a.next, { b: 2, c: 1 });
  await model.process('a d');
  assert.deepEqual(model.chain.a.next, { b: 2, c: 1, d: 1 });
  const saved = JSON.stringify(model.snapshot());
  const reloaded = new Markov(JSON.parse(saved));
  await reloaded.process('a b a c a b');
  assert.equal(JSON.stringify(reloaded.snapshot()), saved);
});

test('empty, terminal and prototype-named words retain the original behavior', async () => {
  assert.equal(new Markov().generate('', 64), '');
  for (const text of ['one', 'one two', '__proto__ constructor toString __proto__ x']) {
    const model = new Markov(); await model.process(text);
    const words = model.generate('', 64).split(/\s+/);
    assert.equal(words.length, 65);
    assert.ok(words.every(word => text.split(' ').includes(word)));
  }
});

test('weighted selection matches the existing algorithm', async () => {
  const model = new Markov(); await model.process('a b a b a b a c');
  const before = Math.random;
  try {
    Math.random = () => 0.74; assert.equal(model.generate('a', 1), 'a b');
    Math.random = () => 0.76; assert.equal(model.generate('a', 1), 'a c');
  } finally { Math.random = before; }
});

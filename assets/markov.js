import { sha1 } from './sha1.js';

const floor = _ => Math.floor(_);
const random = _ => Math.random();
const rndMinMax = (min, max) => random() * (max - min) + min;
const rndMinMaxInt = (min, max) => floor(random() * (max - min + 1)) + min;
const rndFromArray = arr => arr[rndMinMaxInt(0, arr.length - 1)];

export class Markov {
  static splitter = /\s+/;
  chain = Object.assign(Object.create(null), {
    /**
     * 'art': {id: 1, next: {
     *     'sample': 1
     *   }
     * }
     */
  });

  id = 0;


  constructor(snapshot = { id: 0, chain: {} }) {
    this.id = snapshot.id;
    this.chain = Object.assign(Object.create(null), structuredClone(snapshot.chain));
  }

  async process(text) {
    const hash = sha1(text);
    // Do not learn the same whole text twice; repeated words within it count.
    if (Object.values(this.chain).some(item => item.hashes.includes(hash))) return;
    const tokens = this.parse(text);
    this.setCurrentChain(tokens, hash);
  }

  snapshot() {
    return { id: this.id, chain: this.chain };
  }

  parse(text) {
    return text
      .replace(/\n/, ' ')
      .replace(/\s+/, ' ')
      .split(Markov.splitter)
      .filter(item => item !== '');
  }

  setChainEnd(token, hash) {
    if (this.chain[token] === undefined) {
      this.chain[token] = { id: this.id, count: 1, hashes: [hash], next: {} };
    } else {
      const item = this.chain[token];
      const { hashes } = item;
      this.chain[token] = {
        ...item,
        count: item.count + 1,
        hashes: hashes.includes(hash) ? hashes : [...hashes, hash],
      }
    }

  }
  setChainItem(token, next, hash) {
    if (!next) return null;
    if (this.chain[token] === undefined) {
      this.chain[token] = { id: this.id, count: 1, hashes: [hash], next: { [next]: 1 } };
    } else {
      const item = this.chain[token];
      const { hashes } = item;
      this.chain[token] = {
        ...item,
        hashes: hashes.includes(hash) ? hashes : [...hashes, hash],
        count: item.count + 1,
        next: {
          ...item.next,
          [next]: (Object.hasOwn(item.next, next) ? item.next[next] : 0) + 1,
        }
      }
    }
  }

  setCurrentChain(tokens, hash) {
    for (let index = 0; index < tokens.length; index++) {
      let token = tokens[index];
      let next = tokens[index + 1];
      if (next) {
        this.setChainItem(token, next, hash);
      } else {
        this.setChainEnd(token, hash);
      }
      this.id++;
    }
  }

  generate(_token, count = 1) {
    const { keys, entries } = Object;
    const { chain } = this;
    if (keys(chain).length === 0) return '';
    let result = [];
    let token = chain[_token] ? _token : rndFromArray(keys(chain));
    result.push(token);
    for (let i = 0; i < count; i++) {
      const next = chain[token]?.next || {};
      if (next && keys(next).length > 0) {
        // Weighted choice without allocating an array for every occurrence.
        let cursor = random() * Object.values(next).reduce((sum, weight) => sum + weight, 0);
        for (const [word, weight] of entries(next)) {
          cursor -= weight;
          if (cursor < 0) { token = word; break; }
        }
      } else {
        token = rndFromArray(keys(chain));
      }
      result.push(token);
    }
    return result.join(' ');
  }
}

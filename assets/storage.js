export const STORAGE_KEY = 'silksofthesoul:mimi-markov:spa:v1';
export const emptyState = () => ({ version: 1, draft: '', model: { id: 0, chain: {} } });

export class StorageFailure extends Error {
  constructor(code, message, options) { super(message, options); this.code = code; }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function parseState(raw) {
  if (raw === null) return emptyState();
  try {
    const value = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || typeof value.draft !== 'string' || value.draft.length > 50000 ||
        !record(value.model) || !integer(value.model.id) || !record(value.model.chain)) throw new Error('schema');
    for (const item of Object.values(value.model.chain)) {
      if (!record(item) || !integer(item.id) || !integer(item.count) || item.count < 1 ||
          !Array.isArray(item.hashes) || !item.hashes.every(hash => typeof hash === 'string' && /^[a-f0-9]{40}$/.test(hash)) ||
          !record(item.next) || !Object.values(item.next).every(n => integer(n) && n > 0)) throw new Error('model');
    }
    return value;
  } catch (cause) {
    throw new StorageFailure('corrupt', 'Не удалось прочитать сохранённые данные. Они не перезаписаны. Для нового эксперимента очистите данные Mimi Markov.', { cause });
  }
}

export class LocalStore {
  constructor(storage, locks) { this.storage = storage; this.locks = locks; this.memory = emptyState(); }
  get persistent() { return this.storage !== null; }
  readRaw() {
    try { return this.storage.getItem(STORAGE_KEY); }
    catch (cause) { throw new StorageFailure('blocked', 'Браузер запретил доступ к хранилищу. Текст в поле сохранён до закрытия вкладки.', { cause }); }
  }
  read() { return this.persistent ? parseState(this.readRaw()) : structuredClone(this.memory); }
  saveDraftNow(draft) {
    const next = { ...this.read(), draft };
    if (this.persistent) {
      try { this.storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
      catch (cause) { throw new StorageFailure('quota', 'Текст не удалось сохранить; прежние данные не изменены.', { cause }); }
    } else this.memory = structuredClone(next);
    return next;
  }
  async update(change) {
    const operation = async () => {
      const before = this.persistent ? this.readRaw() : null;
      const current = this.persistent ? parseState(before) : structuredClone(this.memory);
      const next = await change(current);
      if (this.persistent) {
        if (this.readRaw() !== before) throw new StorageFailure('conflict', 'Данные изменились в другой вкладке. Ваш текст остался в поле; повторите действие.');
        try { this.storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
        catch (cause) { throw new StorageFailure('quota', 'Не удалось сохранить: хранилище заполнено или недоступно. Прежняя модель сохранена, новый текст остался в поле.', { cause }); }
      } else this.memory = structuredClone(next);
      return next;
    };
    return this.locks ? this.locks.request(STORAGE_KEY, operation) : operation();
  }
  async clear() {
    const operation = () => {
      try { if (this.persistent) this.storage.removeItem(STORAGE_KEY); }
      catch (cause) { throw new StorageFailure('blocked', 'Браузер не разрешил очистку. Данные не удалены.', { cause }); }
      this.memory = emptyState();
      return this.read();
    };
    return this.locks ? this.locks.request(STORAGE_KEY, operation) : operation();
  }
}

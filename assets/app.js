import { Markov } from './markov.js';
import { LocalStore, STORAGE_KEY, emptyState } from './storage.js';

const source = document.querySelector('#source');
const result = document.querySelector('#result');
const train = document.querySelector('#train');
const generate = document.querySelector('#generate');
const status = document.querySelector('#status');
const dialog = document.querySelector('#clear-dialog');
let storage = null;
try { storage = window.localStorage; } catch { /* Private/restricted context: explicit in-memory mode. */ }
const store = new LocalStore(storage, navigator.locks);
let state = emptyState();
let busy = false;
let invalid = false;
let draftTimer;
let draftGeneration = 0;
let queue = Promise.resolve();
const enqueue = task => { const pending = queue.then(task); queue = pending.catch(() => {}); return pending; };
const tell = (message, kind = 'info') => { status.textContent = message; status.dataset.kind = kind; };
const memoryNotice = 'Хранилище недоступно: текст и модель работают только в этой вкладке и исчезнут после её закрытия.';

function refresh() {
  document.querySelector('#counter').textContent = `${source.value.length.toLocaleString('ru-RU')} / 50 000`;
  const size = Object.keys(state.model.chain).length;
  document.querySelector('#model-info').textContent = size ? `Слов в модели: ${size.toLocaleString('ru-RU')}` : 'Модель пока пуста';
  train.disabled = busy || invalid || !source.value.trim();
  generate.disabled = busy || invalid || !size;
  document.querySelector('#clear').disabled = busy;
}

try {
  state = store.read();
  source.value = state.draft;
  tell(store.persistent ? (Object.keys(state.model.chain).length ? 'Ваша модель восстановлена. Можно продолжать.' : 'Начните со своего текста. Здесь пока только ваша пустая модель.') : memoryNotice, store.persistent ? 'info' : 'error');
} catch (error) { invalid = true; tell(error.message, 'error'); }
refresh();

// Lifecycle events cannot await a promise: flush the draft against the latest
// stored model without replacing it with this tab's older in-memory snapshot.
function flushDraft() {
  if (invalid || busy) return;
  clearTimeout(draftTimer); draftGeneration++;
  try { state = store.saveDraftNow(source.value); }
  catch (error) { tell(error.message, 'error'); }
}
window.addEventListener('pagehide', flushDraft);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); });

source.addEventListener('input', () => {
  clearTimeout(draftTimer);
  draftGeneration++;
  refresh();
  if (invalid) return;
  const version = draftGeneration;
  const draft = source.value;
  draftTimer = setTimeout(() => enqueue(async () => {
    if (version !== draftGeneration) return;
    try {
      state = await store.update(current => ({ ...current, draft }));
      tell(store.persistent ? 'Текст сохранён в этом браузере.' : memoryNotice, store.persistent ? 'info' : 'error');
      refresh();
    } catch (error) { tell(error.message, 'error'); }
  }), 200);
});

document.querySelector('#training-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || invalid) return;
  const text = source.value;
  if (!text.trim() || text.length > 50000) return tell('Введите текст до 50 000 символов.', 'error');
  clearTimeout(draftTimer);
  draftGeneration++;
  busy = true; refresh();
  enqueue(async () => {
    try {
      state = await store.update(async current => {
        const model = new Markov(current.model);
        await model.process(text);
        return { ...current, draft: text, model: model.snapshot() };
      });
      result.value = new Markov(state.model).generate('Привет,', 64);
      tell(store.persistent ? 'Готово. Текст и модель сохранены в вашем браузере.' : memoryNotice, store.persistent ? 'info' : 'error');
    } catch (error) { tell(error.message, 'error'); }
    finally { busy = false; refresh(); }
  });
});

generate.addEventListener('click', () => {
  try {
    state = store.read();
    result.value = new Markov(state.model).generate('Привет,', 64);
    tell(store.persistent ? 'Новый вариант из вашей модели.' : memoryNotice, store.persistent ? 'info' : 'error');
    refresh();
  } catch (error) { tell(error.message, 'error'); }
});

document.querySelector('#clear').addEventListener('click', () => dialog.showModal());
document.querySelector('#cancel-clear').addEventListener('click', () => dialog.close());
document.querySelector('#confirm-clear').addEventListener('click', () => {
  clearTimeout(draftTimer); draftGeneration++;
  busy = true; refresh();
  enqueue(async () => {
    try {
      state = await store.clear();
      invalid = false; source.value = ''; result.value = '';
      tell('Данные Mimi Markov очищены. Другие данные сайта не затронуты.');
      dialog.close(); source.focus();
    } catch (error) { tell(error.message, 'error'); dialog.close(); }
    finally { busy = false; refresh(); }
  });
});

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  if (busy) return;
  try {
    clearTimeout(draftTimer); draftGeneration++;
    state = store.read(); result.value = '';
    if (event.newValue === null) {
      source.value = ''; invalid = false;
      tell('Данные Mimi Markov очищены в другой вкладке.');
      refresh(); return;
    }
    // Keep this tab's unsent text; never silently replace the user's draft.
    tell('Модель изменилась в другой вкладке. Ваш текст в поле оставлен без изменений.');
    invalid = false; refresh();
  } catch (error) { invalid = true; tell(error.message, 'error'); refresh(); }
});

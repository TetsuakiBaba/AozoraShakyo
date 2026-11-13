import { BOOKS } from './texts.js';

// ブラウザに保存する記録。保存領域は使えないこともあるので、失敗しても動くようにする
//
//   aozora:settings              見た目や入れ方などの設定
//   aozora:profile               書き出しに添える名前と番号 { name, number }
//   aozora:progress:<本>:<章>    章の書きかけ { total, typed, correct, misses, elapsed, keys, startedAt, finishedAt }
//   aozora:events:<本>:<章>      章の打鍵・確定・消去の記録 [[時刻, 種類, 位置, 中身, 合否, 入れ方], ...]
//   aozora:done:<本>             一冊を書き上げた記録 { date }

const PREFIX = 'aozora:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw);
    return fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? { ...fallback, ...value } : value;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // 保存できなくても続ける
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* 消せなくても続ける */
  }
}

// ───── 本と章 ─────

export function findBook(id) {
  return BOOKS.find((b) => b.id === id) ?? null;
}

export function sectionText(section) {
  return section.paras.map((p) => p.text).join('');
}

export function sectionTotal(section) {
  return section.paras.reduce((n, p) => n + p.text.length, 0);
}

export function bookTotal(book) {
  return book.sections.reduce((n, s) => n + sectionTotal(s), 0);
}

// 章の名前。章のない本は「本文」
export function sectionName(book, i) {
  return book.sections[i].title || (book.sections.length > 1 ? `${i + 1}` : '本文');
}

// ───── 書きかけ ─────

// 本文が取り込み直されて字数が変わっていたら、その章ははじめからにする
export function loadProgress(book, i) {
  const total = sectionTotal(book.sections[i]);
  const fresh = { total, typed: '', correct: 0, misses: 0, elapsed: 0, keys: null, startedAt: null, finishedAt: null };
  const saved = load(`progress:${book.id}:${i}`, null);
  return saved?.total === total ? { ...fresh, ...saved } : fresh;
}

export function saveProgress(book, i, progress) {
  save(`progress:${book.id}:${i}`, progress);
}

export function clearSection(book, i) {
  remove(`progress:${book.id}:${i}`);
  remove(`events:${book.id}:${i}`);
  remove(`done:${book.id}`);
}

export function loadEvents(book, i) {
  return load(`events:${book.id}:${i}`, []);
}

export function saveEvents(book, i, events) {
  return save(`events:${book.id}:${i}`, events);
}

// 本の進み具合：章ごとに { correct, total, done }、本全体で { correct, total, done, started }
export function bookStatus(book) {
  const sections = book.sections.map((_, i) => {
    const p = loadProgress(book, i);
    return { correct: p.correct, total: p.total, done: p.correct === p.total && !!p.finishedAt };
  });
  const correct = sections.reduce((n, s) => n + s.correct, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  return { sections, correct, total, done: sections.every((s) => s.done), started: correct > 0 };
}

// 次に書く章（書き上げていない最初の章。すべて書き上げていれば最後の章）
export function nextSection(book) {
  const { sections } = bookStatus(book);
  const i = sections.findIndex((s) => !s.done);
  return i < 0 ? sections.length - 1 : i;
}

export function loadDone(book) {
  return load(`done:${book.id}`, null);
}

export function saveDone(book, record) {
  save(`done:${book.id}`, record);
}

// ───── 名前と番号 ─────

export function loadProfile() {
  return load('profile', { name: '', number: '' });
}

export function saveProfile(profile) {
  save('profile', profile);
}

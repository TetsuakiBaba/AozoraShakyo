import { summarizeKeys } from './keys.js';
import { loadDone, loadEvents, loadProgress, sectionName } from './store.js';

// 書き写した記録を、JSON（一つのまとまり）と JSONL（一行に一つの出来事）で書き出す
//
// JSON：{ format, exportedAt, name, number, book, summary, sections: [{ ..., text, events }] }
// JSONL：一行目に { type: 'meta', ... }、続いて章ごとに { type: 'section', ... }、
//        そのあとに出来事を一つずつ { type: 'event', section, t, kind, at, ... }
//
// 出来事（kind）
//   commit  変換して確定した字（text）。ok は手本どおりだったか。kana は、かなのまま確定して読みで通したもの
//   key     読みで打つときの一打（key）。ok は読みに合っていたか
//   delete  消した字の数（n）
// t は時刻（1970 年からのミリ秒）、at はその出来事が起きた原稿の位置（章の頭から何字目か）、
// mode は入れ方（kasane：変換して升目に重ねる / fuda：変換して右脇の札 / yomi：読みで打つ）

export const FORMAT = 'aozora-shakyo/1';

// ブラウザには短い配列で残す：[時刻, 種類, 位置, 中身, 合否, 入れ方]
export function packEvent(e) {
  const data = e.type === 'commit' ? e.text : e.type === 'key' ? e.key : e.n;
  const flag = e.type === 'delete' ? null : e.kana ? 2 : e.ok ? 1 : 0;
  return [Date.now(), e.type[0], e.at, data, flag, e.mode[0]];
}

const KIND = { c: 'commit', k: 'key', d: 'delete' };
const MODE = { k: 'kasane', f: 'fuda', y: 'yomi' };
const FIELD = { commit: 'text', key: 'key', delete: 'n' };

function unpackEvent([t, kind, at, data, flag, mode]) {
  const name = KIND[kind];
  const event = { t, kind: name, at, [FIELD[name]]: data, mode: MODE[mode] };
  if (name !== 'delete') event.ok = flag > 0;
  if (flag === 2) event.kana = true;
  return event;
}

function accuracy(correct, misses) {
  return correct + misses ? Math.round((correct / (correct + misses)) * 1000) / 10 : null;
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

export function buildRecord(book, profile) {
  const sections = book.sections.map((section, i) => {
    const p = loadProgress(book, i);
    return {
      index: i,
      title: sectionName(book, i),
      chars: p.total,
      correct: p.correct,
      misses: p.misses,
      accuracy: accuracy(p.correct, p.misses),
      elapsedSec: p.elapsed,
      startedAt: iso(p.startedAt),
      finishedAt: iso(p.finishedAt),
      keys: summarizeKeys(p.keys),
      text: p.typed,
      events: loadEvents(book, i).map(unpackEvent),
    };
  });
  const sum = (key) => sections.reduce((n, s) => n + (s[key] ?? 0), 0);
  const keyCount = sections.reduce((n, s) => n + (s.keys?.count ?? 0), 0);
  return {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    name: profile.name || null,
    number: profile.number || null,
    book: { id: book.id, title: book.title, author: book.author, card: book.card, credit: book.credit },
    summary: {
      chars: sum('chars'),
      correct: sum('correct'),
      misses: sum('misses'),
      accuracy: accuracy(sum('correct'), sum('misses')),
      elapsedSec: sum('elapsedSec'),
      keystrokes: keyCount,
      finishedAt: iso(loadDone(book)?.date),
    },
    sections,
  };
}

export function toJson(record) {
  return JSON.stringify(record, null, 2);
}

export function toJsonl(record) {
  const { sections, ...meta } = record;
  const lines = [{ type: 'meta', ...meta }];
  for (const { events, ...section } of sections) lines.push({ type: 'section', ...section });
  for (const section of sections) {
    for (const event of section.events) lines.push({ type: 'event', section: section.index, ...event });
  }
  return lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
}

export function fileName(record, ext) {
  const d = new Date(record.exportedAt);
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const who = (record.number || record.name || '').replace(/[\\/:*?"<>|\s]+/g, '');
  return `青空写経_${record.book.title}${who ? `_${who}` : ''}_${date}.${ext}`;
}

export function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

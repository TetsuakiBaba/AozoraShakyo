import { createGenko } from './genko.js';
import { emptyKeys, recordKey } from './keys.js';
import { packEvent } from './record.js';
import { showSeal } from './seal.js';
import { bindSettingButtons, mountSettings, settings } from './settings.js';
import { stamp, tick } from './sound.js';
import {
  bookStatus,
  clearSection,
  findBook,
  loadEvents,
  loadProgress,
  nextSection,
  saveDone,
  saveEvents,
  saveProgress,
  sectionName,
} from './store.js';
import { mountUnpitsu } from './unpitsu.js';

// 写経の画面：本の一つの章を、原稿用紙に書き写す
//   shakyo.html?b=<本>&s=<章（0 から）>   章を省くと、書き上げていない最初の章を開く
// 書いた字・時間・打鍵の要約・出来事の記録は、章ごとにブラウザに残し、続きから書ける

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const book = findBook(params.get('b'));
if (!book) location.replace('./#shelf');

const index = Math.min(Math.max(0, Number(params.get('s') ?? (book ? nextSection(book) : 0)) || 0), (book?.sections.length ?? 1) - 1);
const debug = params.has('debug');

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${h}:${mm}` : mm;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

let editor;
let unpitsu;
let progress;
let events;
let lastKey = 0;
let lastState = null;
let wasDone = false;

// ───── 見出し・章・書誌 ─────

function setupHead() {
  const section = book.sections[index];
  const many = book.sections.length > 1;
  $('book-author').textContent = book.author;
  $('book-title').textContent = book.title;
  $('book-section').textContent = many ? `${sectionName(book, index)}（${index + 1} / ${book.sections.length}章）` : '';
  document.title = `${book.title}${many ? ` ${section.title}` : ''} ｜ 青空写経`;
  // 青空文庫の書誌はすべて載せ、どのファイルにどんな手を加えたかを書き添える（収録ファイルの取り扱い規準が希望していること）
  $('credit').innerHTML =
    `${book.credit.map(escapeHtml).join('<br />')}<br />` +
    `<a href="${book.card}" target="_blank" rel="noopener">青空文庫の図書カード</a><br /><br />` +
    '青空写経では、このファイル（XHTML）から本文を取り込み、字句は変えずに縦書きの原稿用紙に組んでいます。漢字には読みを添えています（青空文庫のルビと、macOS の日本語の解析による）。';
  renderChapters();
}

function renderChapters() {
  const box = $('chapters');
  box.hidden = book.sections.length < 2;
  if (box.hidden) return;
  const status = bookStatus(book);
  $('chapter-list').innerHTML = book.sections
    .map((_, i) => {
      const s = status.sections[i];
      const state = s.done ? 'is-done' : s.correct ? 'is-writing' : '';
      const current = i === index ? ' aria-current="page"' : '';
      return `<a class="chapter ${state}" href="./shakyo.html?b=${book.id}&s=${i}"${current}>${escapeHtml(sectionName(book, i))}</a>`;
    })
    .join('');
}

// ───── 書く ─────

function open() {
  progress = loadProgress(book, index);
  progress.keys ??= emptyKeys();
  events = loadEvents(book, index);
  wasDone = !!progress.finishedAt && progress.correct === progress.total;

  editor = createGenko({
    parent: $('paper'),
    paras: book.sections[index].paras,
    value: progress.typed,
    misses: progress.misses,
    mode: () => settings.ire,
    romaji: () => settings.romaji,
    reserveBottom: () => (settings.unpitsu === 'below' && unpitsu ? unpitsu.height + 20 : 0),
    onChange: update,
    onRecord: (e) => {
      progress.startedAt ??= Date.now();
      events.push(packEvent(e));
      if (!saveEvents(book, index, events)) hint('記録を保存しきれませんでした。ブラウザの保存領域がいっぱいかもしれません。', true);
    },
    onKeystroke: (e) => {
      lastKey = Date.now();
      recordKey(progress.keys);
      if (settings.tickSound) tick(e.key);
    },
    onLog: debug ? addLog : null,
    onPasteBlocked: () => hint('貼り付けは使えません。一字ずつ書き写しましょう。', true),
    onYomiIme: () =>
      hint('日本語入力がオンになっています。オフ（英数）にすると、変換せずに読みのローマ字だけでどんどん打てます。'),
  });
  const blur = document.createElement('div');
  blur.className = 'genko-blur';
  blur.innerHTML = '<span>原稿用紙を押すと、書きはじめられます</span>';
  $('paper').append(blur);
  editor.focus();
}

function persist() {
  saveProgress(book, index, progress);
}

function update(state) {
  const prev = lastState;
  lastState = state;
  const n = state.typed.length;
  progress.typed = state.typed;
  progress.correct = state.correct;
  progress.misses = state.misses;
  if (state.done && !progress.finishedAt) progress.finishedAt = Date.now();
  if (!state.done) progress.finishedAt = null;
  persist();

  $('st-chars').textContent = `${state.correct} / ${state.total}`;
  $('st-acc').textContent = state.correct + state.misses ? `${Math.round((state.correct / (state.correct + state.misses)) * 100)}%` : '—';
  $('st-page').textContent = `${state.page + 1} / ${state.pages}枚`;
  $('bar-fill').style.width = `${(state.correct / state.total) * 100}%`;
  $('page-next').disabled = state.page >= state.pages - 1;
  $('page-back').disabled = state.page <= 0;
  unpitsu?.show(state.done ? null : state.stroke);
  unpitsu?.follow(state.caret, { width: editor?.root.offsetWidth ?? 0, height: editor?.root.offsetHeight ?? 0 });

  if (state.done !== wasDone) {
    wasDone = state.done;
    renderChapters();
    if (state.done) finishSection();
  }
  showDone(state.done);

  // 書き足した字を見て、静かに知らせる
  if (!prev || state.composing || n <= prev.typed.length) return;
  const added = state.typed.slice(prev.typed.length);
  if (/[A-Za-z]/.test(added) && !/[A-Za-z]/.test(book.sections[index].paras.map((p) => p.text).join(''))) {
    hint('日本語入力がオフになっているようです。かなで打って、変換しましょう。', true);
  } else if (state.correct < n) {
    hint('朱の字は手本と違います。BackSpace で消して、書き直しましょう。', true);
  } else {
    hint('');
  }
}

// 運筆図を、選んだ置き場所へ移す（右の欄・原稿用紙の下・カーソルの上）
function placeUnpitsu() {
  const where = settings.unpitsu;
  unpitsu.mount(where === 'below' ? $('paper') : where === 'cursor' ? editor.root : $('unpitsu'));
  $('paper').classList.toggle('has-keyboard-below', where === 'below');
  editor.refresh(); // 原稿用紙の下に置いたときは、その分だけ升目を小さくする
}

function hint(text, shu = false) {
  $('hint').textContent = text;
  $('hint').classList.toggle('is-shu', shu);
}

// 章を書き上げたとき：一冊すべてを書き上げたら御朱印を押し、書き出しへ案内する
function finishSection() {
  const status = bookStatus(book);
  if (!status.done) return;
  saveDone(book, { date: Date.now() });
  const totalSec = book.sections.reduce((n, _, i) => n + loadProgress(book, i).elapsed, 0);
  stamp();
  showSeal(
    {
      title: book.title,
      small: book.author,
      eyebrow: '書き上げ',
      message: `『${book.title}』を一冊、書き写しました`,
      stats: `${status.total.toLocaleString()}字　／　時間 ${formatTime(totalSec)}`,
    },
    { actions: [{ label: '記録を書き出す', href: `./osame.html?b=${book.id}`, primary: true }] },
  );
}

function showDone(done) {
  const box = $('done');
  box.hidden = !done;
  if (!done) return;
  const status = bookStatus(book);
  const next = status.sections.findIndex((s, i) => i > index && !s.done);
  const first = status.sections.findIndex((s) => !s.done);
  const target = next >= 0 ? next : first;
  if (status.done) {
    $('done-text').textContent = `『${book.title}』を一冊、書き上げました。`;
    $('done-link').textContent = '記録を書き出す';
    $('done-link').href = `./osame.html?b=${book.id}`;
  } else {
    $('done-text').textContent = book.sections.length > 1 ? 'この章を書き上げました。' : '書き上げました。';
    $('done-link').textContent = `次は「${sectionName(book, target)}」へ`;
    $('done-link').href = `./shakyo.html?b=${book.id}&s=${target}`;
  }
}

// 書いている時間：最後に打ってから 20 秒までを数える
setInterval(() => {
  if (!progress || document.hidden || Date.now() - lastKey > 20000) return;
  progress.elapsed++;
  $('st-time').textContent = formatTime(progress.elapsed);
  if (progress.elapsed % 5 === 0) persist();
}, 1000);

// ───── 入力のイベント（?debug をつけたときだけ） ─────

const t0 = performance.now();
const logLines = [];

function addLog(entry) {
  const ms = String(Math.round(performance.now() - t0)).padStart(7);
  const parts = [ms, entry.type.padEnd(18)];
  if (entry.key !== undefined) parts.push(`key=${JSON.stringify(entry.key)}`, `keyCode=${entry.keyCode}`);
  if (entry.data !== undefined) parts.push(`data=${JSON.stringify(entry.data)}`);
  if (entry.inputType) parts.push(`inputType=${entry.inputType}`);
  if (entry.isComposing !== undefined) parts.push(`isComposing=${entry.isComposing}`);
  if (entry.removed) parts.push(`removed=${entry.removed}`);
  parts.push(`composing=${entry.composing}`, `fude=${JSON.stringify(entry.value)}`, `context=${JSON.stringify(entry.context)}`);
  logLines.push(parts.join('  '));
  if (logLines.length > 400) logLines.shift();
  $('log-text').textContent = logLines.join('\n');
  $('log-text').scrollTop = $('log-text').scrollHeight;
}

// ───── はじめに ─────

if (book) {
  setupHead();
  unpitsu = mountUnpitsu($('unpitsu'));
  open();
  placeUnpitsu();
  $('st-time').textContent = formatTime(progress.elapsed);
  if (settings.ire === 'yomi' && !progress.typed) {
    hint('日本語入力をオフ（英数）にして、漢字に添えた読みをローマ字で打ちます。、。「」は , . [ ] で打てます。');
  }

  mountSettings($('settings-btn'), (key) => {
    if (key === 'font') document.fonts?.ready.then(() => editor.refresh());
    else editor.refresh();
    if (key === 'keyboard') unpitsu.refresh();
    if (key === 'ire') {
      hint(
        settings.ire === 'yomi'
          ? '日本語入力をオフ（英数）にして、添えた読みをローマ字で打ちます。、。「」は , . [ ] で打てます。'
          : '日本語入力をオンにして、かなで打って変換します。',
      );
    }
    editor.focus();
  });

  bindSettingButtons($('unpitsu-place'), () => {
    placeUnpitsu();
    editor.focus();
  });

  $('page-next').addEventListener('click', () => {
    editor.turn(1);
    editor.focus();
  });
  $('page-back').addEventListener('click', () => {
    editor.turn(-1);
    editor.focus();
  });
  $('reset').addEventListener('click', () => {
    const what = book.sections.length > 1 ? 'この章' : 'この本';
    if (!confirm(`${what}を、はじめから書き直しますか？\n書いた字と、その記録は消えます。`)) return;
    clearSection(book, index);
    location.reload();
  });

  $('event-log').hidden = !debug;
  $('log-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${navigator.userAgent}\n${logLines.join('\n')}`);
      $('log-copy').textContent = '写しました';
    } catch {
      $('log-copy').textContent = '写せませんでした';
    }
    setTimeout(() => ($('log-copy').textContent = '記録を写す'), 1500);
  });
}

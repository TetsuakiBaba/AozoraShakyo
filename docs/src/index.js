import { layout } from './genko.js';
import { sealSvg, wafuDate } from './seal.js';
import { mountSettings, settings, updateSetting } from './settings.js';
import { tick } from './sound.js';
import { bookStatus, load, loadDone, save, sectionName } from './store.js';
import { BOOKS } from './texts.js';

// 導入と書棚：本を選び、書きかけなら続きから、書き上げていれば記録の書き出しへ

const $ = (id) => document.getElementById(id);

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// 原稿用紙（400 字詰め）で何枚になるか
function sheetsOf(book) {
  return book.sections.reduce((n, s) => n + layout(s.paras).pages, 0);
}

function renderShelf() {
  $('shelf').innerHTML = BOOKS.map((book) => {
    const status = bookStatus(book);
    const done = loadDone(book);
    const ratio = status.total ? status.correct / status.total : 0;
    const href = `./shakyo.html?b=${book.id}`;
    const chapters =
      book.sections.length > 1
        ? `<div class="chapter-list">${book.sections
            .map((_, i) => {
              const s = status.sections[i];
              const state = s.done ? 'is-done' : s.correct ? 'is-writing' : '';
              return `<a class="chapter ${state}" href="./shakyo.html?b=${book.id}&s=${i}">${escapeHtml(sectionName(book, i))}</a>`;
            })
            .join('')}</div>`
        : '';
    let state;
    let actions;
    if (status.done) {
      state = `書き上げ　${done ? wafuDate(new Date(done.date)) : ''}`;
      actions = `<a class="btn-ink" href="./osame.html?b=${book.id}">記録を書き出す</a><a class="btn-line" href="${href}">読み返す</a>`;
    } else if (status.started) {
      state = `書きかけ　${Math.floor(ratio * 100)}%`;
      actions = `<a class="btn-ink" href="${href}">続きから書く</a>`;
    } else {
      state = 'まだ書いていません';
      actions = `<a class="btn-line" href="${href}">書きはじめる</a>`;
    }
    return `
      <li class="book-card">
        ${status.done ? sealSvg('seal-mark-small') : ''}
        <a class="book-spine" href="${href}">
          <p class="book-title">${escapeHtml(book.title)}</p>
          <p class="book-author">${escapeHtml(book.author)}</p>
        </a>
        <div class="book-body">
          <p class="book-facts">
            ${status.total.toLocaleString()}字　原稿用紙 ${sheetsOf(book)}枚<br />
            ${book.sections.length > 1 ? `${book.sections.length}章` : '章なし'}
          </p>
          ${chapters}
          <div class="book-progress">
            <span>${state}</span>
            <div class="bar"><span style="width: ${ratio * 100}%"></span></div>
          </div>
          <div class="book-actions">${actions}</div>
        </div>
      </li>`;
  }).join('');
}

renderShelf();
// 写経の画面から戻ってきたとき（ブラウザの「戻る」）にも、最新の進み具合を出す
window.addEventListener('pageshow', renderShelf);
mountSettings($('settings-btn'));

// ───── はじめに ─────
// 初めて開いたときに一度だけ出す。あとは「はじめに」からいつでも
// 打鍵音を鳴らすかどうかを選ぶまでは「はじめる」を押せず、画面の外を押しても Esc でも閉じない

const guide = $('guide');
const guideStart = guide.querySelector('.guide-actions button');
const soundButtons = guide.querySelectorAll('[data-guide-sound]');

function showSoundChoice() {
  soundButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(load('soundChosen', false) && btn.dataset.guideSound === String(settings.tickSound)));
  });
}

soundButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const on = btn.dataset.guideSound === 'true';
    updateSetting('tickSound', on);
    save('soundChosen', true);
    showSoundChoice();
    guideStart.disabled = false;
    if (on) {
      // どんな音か、その場で聞かせる
      tick('a');
      setTimeout(() => tick('s'), 120);
      setTimeout(() => tick('d'), 240);
    }
  });
});

function openGuide() {
  showSoundChoice();
  guideStart.disabled = !load('soundChosen', false);
  guide.showModal();
}

$('guide-btn').addEventListener('click', openGuide);
$('guide-btn-2').addEventListener('click', openGuide);
guide.addEventListener('cancel', (e) => {
  if (guideStart.disabled) e.preventDefault();
});
guide.addEventListener('close', () => save('guideSeen', true));
if (!load('guideSeen', false)) openGuide();

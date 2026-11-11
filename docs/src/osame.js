import { canMakeCode, formatId, makeCode, normalizeId, workNumber } from './iroha.js';
import { buildRecord, download, fileName, toJson, toJsonl } from './record.js';
import { sealSheet, wafuDate } from './seal.js';
import { applySettings } from './settings.js';
import { bookStatus, findBook, loadDone, loadIrohaId, loadProfile, saveIrohaId, saveProfile } from './store.js';

// 納める：一冊を書き上げたら、名前と番号を添えて、書いた記録を JSON か JSONL で書き出す
//   osame.html?b=<本>

const $ = (id) => document.getElementById(id);
const book = findBook(new URLSearchParams(location.search).get('b'));
if (!book) location.replace('./#shelf');

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}時間${m}分` : `${m}分${sec % 60}秒`;
}

function stat(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

if (book) {
  applySettings();
  const status = bookStatus(book);
  const done = loadDone(book);
  document.title = `${book.title}を納める ｜ 青空写経`;
  $('osame-title').textContent = book.title;

  if (!status.done) {
    // まだ書き上げていない本は、書き出さずに写経へ戻す
    $('osame-lead').innerHTML = `まだ書き上げていません（${status.correct.toLocaleString()} / ${status.total.toLocaleString()}字）。一冊を書き上げると、ここで記録を書き出せます。`;
    $('osame-form').hidden = true;
    const link = document.createElement('a');
    link.className = 'btn-ink';
    link.href = `./shakyo.html?b=${book.id}`;
    link.textContent = '続きから書く';
    link.style.textDecoration = 'none';
    $('osame-lead').after(link);
  } else {
    $('osame-seal').innerHTML = sealSheet({ title: book.title, small: book.author, date: done ? new Date(done.date) : new Date() });
    $('osame-lead').textContent = `${book.author}『${book.title}』を一冊、書き写しました。${done ? wafuDate(new Date(done.date)) : ''}`;

    const record = buildRecord(book, loadProfile());
    const s = record.summary;
    $('osame-stats').innerHTML = [
      stat('字', `${s.chars.toLocaleString()}字`),
      stat('時間', formatTime(s.elapsedSec)),
      stat('正確率', s.accuracy == null ? '—' : `${s.accuracy}%`),
      stat('打鍵', `${s.keystrokes.toLocaleString()}回`),
      stat('章', `${record.sections.length}`),
      stat('記録', `${record.sections.reduce((n, sec) => n + sec.events.length, 0).toLocaleString()}件`),
    ].join('');

    const profile = loadProfile();
    $('osame-name').value = profile.name;
    $('osame-number').value = profile.number;

    $('osame-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const format = e.submitter?.dataset.format ?? 'json';
      const profile = { name: $('osame-name').value.trim(), number: $('osame-number').value.trim() };
      saveProfile(profile);
      const record = buildRecord(book, profile);
      if (format === 'jsonl') download(fileName(record, 'jsonl'), toJsonl(record), 'application/jsonl');
      else download(fileName(record, 'json'), toJson(record), 'application/json');
      $('osame-msg').textContent = `${fileName(record, format)} を書き出しました。`;
    });

    setupIrohaCode(book);
  }
}

// iroha のコード：iroha の ID を入れると、この一冊のコードを出す（計算は src/iroha.js）。
// 番号のない本と、コードを計算できない開き方（https でも localhost でもない）では出さない
function setupIrohaCode(book) {
  const work = workNumber(book);
  if (!work || !canMakeCode()) return;
  $('osame-iroha').hidden = false;
  const input = $('iroha-id');
  let latest = 0; // 打つたびに計算するので、あとから始めた計算の結果だけを出す

  async function update() {
    const turn = ++latest;
    const text = input.value.trim();
    const id = normalizeId(text);
    if (!id) {
      $('iroha-result').hidden = true;
      $('iroha-msg').textContent = text ? 'ID は英数字 8 文字です（例：7QF2-MX8K）。iroha の「設定」→「スキル」で確かめてください。' : '';
      return;
    }
    const code = await makeCode(id, work);
    if (turn !== latest) return;
    saveIrohaId(formatId(id));
    $('iroha-code').textContent = code;
    $('iroha-result').hidden = false;
    $('iroha-msg').textContent = 'このコードを、iroha の「設定」→「スキル」のコードの欄に入れてください。ID はこのブラウザの中にだけ残します。';
  }

  input.value = loadIrohaId();
  input.addEventListener('input', update);
  $('iroha-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('iroha-code').textContent);
      $('iroha-msg').textContent = 'コードをコピーしました。';
    } catch {
      $('iroha-msg').textContent = 'コピーできませんでした。コードを選んでコピーしてください。';
    }
  });
  update();
}

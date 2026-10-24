// 紹介動画を撮る：Chrome で stage.html を開き、本物のサイトを操作しながら、画面の中継（screencast）でコマを集める
//
//   node tools/video/record.mjs <stage の URL> <書き出す場所>
//
// 書き出すもの：<場所>/frames/*.jpg（画面が変わるたびの一コマ）、<場所>/frames.txt（ffmpeg に渡す一覧）、<場所>/timeline.json
// （コマの時刻、打鍵の時刻、御朱印を押した時刻）。音は tools/video/audio.py が timeline.json から作る。
// 時刻はすべて撮りはじめからの秒。

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [stageUrl, outDir] = process.argv.slice(2);
if (!stageUrl || !outDir) {
  console.error('使い方：node tools/video/record.mjs <stage の URL> <書き出す場所>');
  process.exit(1);
}
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400);

// ───── Chrome とのやりとり（DevTools Protocol） ─────

const profile = mkdtempSync(join(tmpdir(), 'aozora-video-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1920,1080',
  '--hide-scrollbars',
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  } catch {
    await sleep(200);
  }
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let nextId = 0;
const pending = new Map();
const listeners = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else listeners.forEach((l) => l(msg));
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
// サイト（iframe）の中で式を評価する。w はサイトの window、d は document
const site = (expr) => evaluate(`(() => { const w = stage.site().contentWindow; const d = w.document; return (${expr}); })()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
// ヘッドレスでも、ページにフォーカスがあるものとして扱う（原稿用紙の「押すと書きはじめられます」を出さない）
await send('Emulation.setFocusEmulationEnabled', { enabled: true });

// ───── 記録 ─────

mkdirSync(join(outDir, 'frames'), { recursive: true });
const frames = [];
const keys = []; // [時刻, 種類]（key / space / enter）
const stamps = [];
let t0 = 0;
const now = () => (Date.now() - t0) / 1000;

listeners.push((msg) => {
  if (msg.method !== 'Page.screencastFrame') return;
  const { data, metadata, sessionId } = msg.params;
  send('Page.screencastFrameAck', { sessionId });
  if (!t0) return;
  const file = `${String(frames.length).padStart(6, '0')}.jpg`;
  writeFileSync(join(outDir, 'frames', file), Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp - t0 / 1000 });
});

// ───── 操作 ─────

const CODES = { '.': 'Period', ',': 'Comma', '-': 'Minus', '[': 'BracketRight', ']': 'Backslash', ' ': 'Space' };
const codeOf = (k) => CODES[k] ?? (/^[a-z]$/.test(k) ? `Key${k.toUpperCase()}` : k);
const jitter = (a, b) => a + Math.random() * (b - a);

async function press(key, text = key.length === 1 ? key : undefined) {
  const code = key === 'Enter' ? 'Enter' : codeOf(key);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text, windowsVirtualKeyCode: key === 'Enter' ? 13 : 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  keys.push([now(), key === ' ' ? 'space' : key === 'Enter' ? 'enter' : 'key']);
}

// 読みで打つ：ローマ字を一打ずつ。句読点のあとは少し間をおく
async function typeRomaji(romaji) {
  for (const k of romaji) {
    await press(k);
    await sleep(/[.,]/.test(k) ? jitter(320, 460) : jitter(95, 175));
  }
}

// 変換して書く：かなを一打ずつ打って変換中の字をのばす（IME の動きを模す）
async function composeKana(chunks) {
  let kana = '';
  for (const [k, romaji] of chunks) {
    for (let i = 0; i < romaji.length; i++) {
      const shown = i === romaji.length - 1 ? kana + k : kana + romaji.slice(0, i + 1);
      await send('Input.imeSetComposition', { text: shown, selectionStart: shown.length, selectionEnd: shown.length });
      keys.push([now(), 'key']);
      await sleep(jitter(100, 170));
    }
    kana += k;
  }
  return kana;
}

// いま書く升目のあたりへ寄る。横は升目の少し左（これから書く行の側）を、縦は原稿用紙の行の頭から終わりまでが入る高さを真ん中にする
async function zoomToCursor(scale = 1.6) {
  const r = await site(`(() => { const c = d.querySelector('.cell.next') ?? d.querySelector('.cell.ghost'); const b = c.getBoundingClientRect(); const s = d.querySelector('.genko-sheet').getBoundingClientRect(); return { x: b.x, mid: s.y + s.height / 2 }; })()`);
  await evaluate(`stage.zoom(${r.x - 170}, ${r.mid}, ${scale})`);
}

async function waitSite(path) {
  for (let i = 0; i < 100; i++) {
    const ok = await site(`d.readyState === 'complete' && w.location.pathname.endsWith('${path}')`).catch(() => false);
    if (ok) break;
    await sleep(100);
  }
  await site(`d.fonts.ready.then(() => true)`);
  await sleep(400);
}

// 書く欄に、手本の読みを最後まで打つためのローマ字（運筆図と同じヘボン式の案内）
async function romajiFor(bookId, section, fromText, toText) {
  return evaluate(`(async () => {
    const { BOOKS } = await import('/docs/src/texts.js');
    const { layout } = await import('/docs/src/genko.js');
    const y = await import('/docs/src/yomi.js');
    const { chars, yomi } = layout(BOOKS.find((b) => b.id === '${bookId}').sections[${section}].paras);
    const st = y.buildStream(chars.map((c) => c.ch), yomi);
    const text = chars.map((c) => c.ch).join('');
    const from = ${JSON.stringify(fromText)} ? text.indexOf(${JSON.stringify(fromText)}) : 0;
    const to = text.indexOf(${JSON.stringify(toText)}, from) + ${toText.length}; // 始まりより後ろから探す
    const state = { pos: st.starts[from], pending: '' };
    let out = '';
    while (state.pos < st.ends[to - 1]) {
      const k = y.nextKey(st.stream, state, 'hepburn');
      if (!k || !y.feed(st.stream, state, k)) break;
      out += k;
    }
    return out;
  })()`);
}

// ───── はじめの状態：書棚の見え方と、ごん狐を最後の一行の手前まで ─────

const stageOrigin = new URL(stageUrl).origin;
await send('Page.navigate', { url: `${stageOrigin}/docs/osame.html` }); // 同じ場所の保存領域を先に整える
await sleep(800);
await evaluate(`(async () => {
  localStorage.clear();
  const set = (k, v) => localStorage.setItem('aozora:' + k, JSON.stringify(v));
  set('guideSeen', true);
  set('soundChosen', true);
  set('settings', { ire: 'yomi', romaji: 'hepburn', font: 'mincho', theme: 'washi', unpitsu: 'cursor', tickSound: false, keyboard: 'jis', version: 2 });
  const { BOOKS } = await import('/docs/src/texts.js');
  const progress = (book, i, typed, done) => {
    const text = book.sections[i].paras.map((p) => p.text).join('');
    const t = typeof typed === 'number' ? text.slice(0, typed) : text;
    set('progress:' + book.id + ':' + i, { total: text.length, typed: t, correct: t.length, misses: 4, elapsed: 900, keys: null, startedAt: Date.now() - 3.6e6, finishedAt: done ? Date.now() : null });
    return text.length;
  };
  const chumon = BOOKS.find((b) => b.id === 'chumon');
  progress(chumon, 0, 1900, false);
  const gon = BOOKS.find((b) => b.id === 'gon');
  gon.sections.forEach((s, i) => {
    const len = s.paras.reduce((n, p) => n + p.text.length, 0);
    progress(gon, i, i < 5 ? undefined : len - 12, i < 5);
  });
})()`);

await send('Page.navigate', { url: stageUrl });
await sleep(1200);
await evaluate(`document.fonts.ready.then(() => true)`);
await evaluate(`stage.open('/docs/index.html')`);
await waitSite('/docs/index.html');
const firstKeys = await romajiFor('rashomon', 0, '', '待っていた。');
const gonKeys = await romajiFor('gon', 5, '筒口', 'ました。');

await send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
t0 = Date.now();
const mark = (name) => console.log(`${now().toFixed(1).padStart(5)}s  ${name}`);

// 1. 題字
mark('題字');
await sleep(3600);

// 2. 書棚から一冊を選ぶ
mark('書棚');
await evaluate(`stage.title(false)`);
await evaluate(`stage.caption('本を選ぶ', '青空文庫から、一冊を選ぶ', '芥川龍之介、宮沢賢治、新美南吉。章のある本は章ごとに')`);
await sleep(1300);
await site(`w.scrollTo({ top: d.getElementById('shelf-section').offsetTop - 30, behavior: 'smooth' })`);
await sleep(1000);
await evaluate(`stage.zoom(560, 330, 1.35)`);
await sleep(2000);
await site(`d.querySelector('.book-card .book-actions a').click()`);
await evaluate(`stage.zoom()`);
await waitSite('/docs/shakyo.html');

// 3. 読みで打つ
mark('読みで打つ');
await evaluate(`stage.caption('読みで打つ', '手本の読みを、ローマ字で打つ', '日本語入力はオフ。読みが合った語から、升目に字が入る')`);
await site(`(w.focus(), d.querySelector('.fude-input').focus(), true)`);
await zoomToCursor();
await sleep(1300);
await typeRomaji(firstKeys);
await sleep(900);

// 4. 変換して書く
mark('変換して書く');
await evaluate(`stage.caption('変換して書く', '変換すると、手本の上にぴたりと重なる', '日本語入力をオンにして、かなで打って変換する')`);
await evaluate(`stage.zoom(1050, 330, 1.45)`); // 設定のパネルへ
await site(`(d.getElementById('settings-btn').click(), true)`);
await sleep(1200);
await site(`(d.querySelector('[data-setting="ire"][data-value="kasane"]').click(), true)`);
await sleep(700);
await site(`(d.getElementById('settings-btn').click(), d.querySelector('.fude-input').focus(), true)`);
await zoomToCursor();
await sleep(1200);
const kana = await composeKana([
  ['ひ', 'hi'], ['ろ', 'ro'], ['い', 'i'], ['も', 'mo'], ['ん', 'nn'],
  ['の', 'no'], ['し', 'shi'], ['た', 'ta'], ['に', 'ni'], ['は', 'ha'], ['、', ','],
]);
await sleep(700);
// はじめの候補は手本と違う字（紋）、次の候補で手本どおり（門）になり、薄墨とぴったり重なる
for (const text of ['広い紋の下には、', '広い門の下には、']) {
  await send('Input.imeSetComposition', { text, selectionStart: 2, selectionEnd: 3 });
  keys.push([now(), 'space']);
  await sleep(1300);
}
await send('Input.insertText', { text: '広い門の下には、' });
keys.push([now(), 'enter']);
await sleep(1500);
void kana;

// 5. 一冊を書き上げる
mark('書き上げ');
await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('aozora:settings')); s.ire = 'yomi'; localStorage.setItem('aozora:settings', JSON.stringify(s)); })()`);
await evaluate(`stage.caption('書き上げ', '一冊を書き上げると、御朱印が押される', '『ごん狐』の最後の一行')`);
await evaluate(`stage.zoom()`);
await evaluate(`stage.open('/docs/shakyo.html?b=gon&s=5')`);
await waitSite('/docs/shakyo.html');
await site(`(w.focus(), d.querySelector('.fude-input').focus(), true)`);
await zoomToCursor();
await sleep(1300);
await typeRomaji(gonKeys);
await evaluate(`stage.zoom()`); // 御朱印は、引いて全体で見せる
stamps.push(now() + 0.55); // おりんは、朱印が紙に押される瞬間に鳴る（sound.js の stamp と同じ）
await sleep(4200);

// 6. 納める
mark('納める');
await evaluate(`stage.caption('納める', '書いた記録を、手元に納める', '名前と番号を添えて、JSON・JSONL で書き出す')`);
await site(`(d.querySelector('.seal-actions a').click(), true)`);
await waitSite('/docs/osame.html');
await evaluate(`stage.zoom(760, 400, 1.3)`);
await sleep(900);
await site(`(w.focus(), d.getElementById('osame-name').focus(), true)`);
for (const ch of '青空 花子') {
  await send('Input.insertText', { text: ch });
  keys.push([now(), ch === ' ' ? 'space' : 'key']);
  await sleep(jitter(170, 260));
}
await site(`(d.getElementById('osame-number').focus(), true)`);
await sleep(300);
for (const ch of '26001') {
  await press(ch);
  await sleep(jitter(120, 190));
}
await sleep(1800);

// 7. 題字と URL
mark('締め');
await evaluate(`stage.caption('', '')`);
await evaluate(`stage.zoom()`);
await evaluate(`stage.title(true, { sub: '青空文庫の名作を、原稿用紙に書き写す', url: true })`);
await sleep(4800);
const end = now();
mark('終わり');

await send('Page.stopScreencast');
writeFileSync(join(outDir, 'timeline.json'), JSON.stringify({ duration: end, frames, keys, stamps }, null, 1));
// ffmpeg に渡すコマの一覧。画面が変わらないあいだは、前のコマをそのまま映す
const list = ['ffconcat version 1.0'];
frames.forEach((f, i) => {
  const from = i === 0 ? 0 : f.t;
  const to = i + 1 < frames.length ? frames[i + 1].t : end;
  list.push(`file 'frames/${f.file}'`, `duration ${Math.max(0.001, to - from).toFixed(4)}`);
});
list.push(`file 'frames/${frames.at(-1).file}'`);
writeFileSync(join(outDir, 'frames.txt'), list.join('\n') + '\n');
console.log(`コマ ${frames.length}、打鍵 ${keys.length}、${end.toFixed(1)} 秒`);
ws.close();
chrome.kill();

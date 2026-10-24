import { settings, updateSetting } from './settings.js';

// 運筆図：次に打つキーと、使う指を、小さなキーボードの図でそっと示す
// shakyo（../shakyo/public/src/unpitsu.js）から写した。置き場所は設定（settings.unpitsu）で選ぶ
//   side    右の欄
//   below   原稿用紙の下の中央
//   cursor  いま書く升目の上に浮かべ、書き進めるのについていく。
//           上に余地がなければ、書き終えた行の側（右）に、そこにも余地がなければ左に寄せる
//           （縦書きでは、升目の下はこれから書く字なので、そこには置かない）
//   off     出さない
//
// 指はいつも「構え」（ホームポジション）から出て、また戻る。図には八本の指の定位置を点で示し、
// 次のキーが定位置の外なら、その指の定位置から線を伸ばして見せる
// キーボードの配列（JIS か US か）は、打ったキーから自動で見分ける

const FINGER_NAMES = ['左 小指', '左 薬指', '左 中指', '左 人差し指', '親指', '右 人差し指', '右 中指', '右 薬指', '右 小指'];
const COLS = [0, 1, 2, 3, 3, 5, 5, 6, 7, 8]; // 各段の左から十個のキーを受け持つ指
const LETTERS = (s) => [...s].map((c) => `Key${c}`);
const DIGITS = [...'1234567890'].map((d) => `Digit${d}`);

function keys(codes, normal, shifted, fingers) {
  return codes.map((code, i) => ({ code, n: [...normal][i], s: shifted[i] ?? '', f: fingers[i] }));
}

const special = (code, label, f, w) => ({ code, label, f, w });

// 八本の指の定位置。親指はスペースの上
const HOME = { 0: 'KeyA', 1: 'KeyS', 2: 'KeyD', 3: 'KeyF', 5: 'KeyJ', 6: 'KeyK', 7: 'KeyL', 8: 'Semicolon' };
const HOME_CODES = new Set(Object.values(HOME));
const SPACE = special('Space', '', 4, 6);

const LAYOUTS = {
  jis: [
    [
      special('Backquote', '半/全', 0, 1),
      ...keys([...DIGITS, 'Minus', 'Equal', 'IntlYen'], '1234567890-^¥', ['!', '"', '#', '$', '%', '&', "'", '(', ')', '', '=', '~', '|'], [...COLS, 8, 8, 8]),
      special('Backspace', 'BS', 8, 1),
    ],
    [
      special('Tab', 'Tab', 0, 1.5),
      ...keys([...LETTERS('QWERTYUIOP'), 'BracketLeft', 'BracketRight'], 'qwertyuiop@[', [...'QWERTYUIOP`{'], [...COLS, 8, 8]),
    ],
    [
      special('CapsLock', '英数', 0, 1.75),
      ...keys([...LETTERS('ASDFGHJKL'), 'Semicolon', 'Quote', 'Backslash'], 'asdfghjkl;:]', [...'ASDFGHJKL+*}'], [0, 1, 2, 3, 3, 5, 5, 6, 7, 8, 8, 8]),
      special('Enter', 'Enter', 8, 1.25),
    ],
    [
      special('ShiftLeft', 'Shift', 0, 2.25),
      ...keys([...LETTERS('ZXCVBNM'), 'Comma', 'Period', 'Slash', 'IntlRo'], 'zxcvbnm,./\\', [...'ZXCVBNM<>?_'], [0, 1, 2, 3, 3, 5, 5, 6, 7, 8, 8]),
      special('ShiftRight', 'Shift', 8, 1.75),
    ],
    [SPACE],
  ],
  us: [
    [
      ...keys(['Backquote', ...DIGITS, 'Minus', 'Equal'], '`1234567890-=', [...'~!@#$%^&*()_+'], [0, ...COLS, 8, 8]),
      special('Backspace', 'BS', 8, 2),
    ],
    [
      special('Tab', 'Tab', 0, 1.5),
      ...keys([...LETTERS('QWERTYUIOP'), 'BracketLeft', 'BracketRight', 'Backslash'], 'qwertyuiop[]\\', [...'QWERTYUIOP{}|'], [...COLS, 8, 8, 8]),
    ],
    [
      special('CapsLock', 'Caps', 0, 1.75),
      ...keys([...LETTERS('ASDFGHJKL'), 'Semicolon', 'Quote'], "asdfghjkl;'", [...'ASDFGHJKL:"'], [0, 1, 2, 3, 3, 5, 5, 6, 7, 8, 8]),
      special('Enter', 'Enter', 8, 2.25),
    ],
    [
      special('ShiftLeft', 'Shift', 0, 2.25),
      ...keys([...LETTERS('ZXCVBNM'), 'Comma', 'Period', 'Slash'], 'zxcvbnm,./', [...'ZXCVBNM<>?'], [0, 1, 2, 3, 3, 5, 5, 6, 7, 8]),
      special('ShiftRight', 'Shift', 8, 2.75),
    ],
    [SPACE],
  ],
};

function keyHtml(key) {
  const w = key.w ?? 1;
  const home = (key.code === 'KeyF' || key.code === 'KeyJ' ? ' is-home' : '') + (HOME_CODES.has(key.code) ? ' is-rest' : '');
  let label;
  if (key.label != null) label = `<span class="uk-name">${key.label}</span>`;
  else if (/^Key/.test(key.code)) label = `<span class="uk-main">${key.s}</span>`;
  else label = `<span class="uk-top">${key.s}</span><span class="uk-main">${key.n}</span>`;
  return `<span class="uk${home}" data-code="${key.code}" data-f="${key.f}" style="--w: ${w}">${label}</span>`;
}

// stroke（genko.js の次の一手）：{ type: 'char' | 'backspace' | 'space' | 'enter', ch?, note? }
export function mountUnpitsu(parent) {
  const box = document.createElement('div');
  box.className = 'unpitsu';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '<p class="unpitsu-say"><span class="unpitsu-finger"></span><span class="unpitsu-note"></span></p><div class="unpitsu-board"></div>';
  parent.append(box);
  const board = box.querySelector('.unpitsu-board');
  let layout = null;
  let last = null;
  let lastCaret = null;

  function build() {
    const name = settings.keyboard === 'us' ? 'us' : 'jis';
    if (layout === name) return;
    layout = name;
    board.innerHTML =
      LAYOUTS[name].map((row, r) => `<div class="uk-row${r === 4 ? ' is-space' : ''}">${row.map(keyHtml).join('')}</div>`).join('') +
      '<svg class="uk-reach" aria-hidden="true"></svg>';
  }

  // 指の定位置から、押すキーまで線を伸ばす
  function reach(lines) {
    const svg = board.querySelector('.uk-reach');
    const center = (code) => {
      const el = board.querySelector(`[data-code="${code}"]`);
      return el && [el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2];
    };
    svg.setAttribute('width', board.offsetWidth);
    svg.setAttribute('height', board.offsetHeight);
    svg.innerHTML = lines
      .map(([from, to, cls]) => {
        const a = center(from);
        const b = center(to);
        if (!a || !b) return '';
        // 線の端は、キーの文字にかからないよう少し手前で止める
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const k = Math.max(0, (len - 6) / len);
        const ex = a[0] + (b[0] - a[0]) * k;
        const ey = a[1] + (b[1] - a[1]) * k;
        return `<line class="${cls}" x1="${a[0]}" y1="${a[1]}" x2="${ex}" y2="${ey}" style="--len: ${Math.ceil(len)}"/><circle class="${cls}" cx="${a[0]}" cy="${a[1]}" r="2.6"/>`;
      })
      .join('');
  }

  function find(ch) {
    if (ch === ' ') return { key: SPACE, shift: false };
    for (const row of LAYOUTS[layout]) {
      for (const key of row) {
        if (key.label != null) continue;
        if (key.n === ch) return { key, shift: false };
        if (key.s === ch) return { key, shift: true };
      }
    }
    return null;
  }

  function show(stroke) {
    last = stroke;
    box.dataset.place = settings.unpitsu;
    box.hidden = settings.unpitsu === 'off';
    if (box.hidden) return;
    build();
    board.querySelectorAll('.is-next, .is-shift, .is-finger').forEach((n) => n.classList.remove('is-next', 'is-shift', 'is-finger'));

    let target = null;
    let shiftCode = null;
    let note = stroke?.note ?? '';
    if (stroke?.type === 'backspace') target = { code: 'Backspace', f: 8 };
    else if (stroke?.type === 'enter') target = { code: 'Enter', f: 8 };
    else if (stroke?.type === 'space') target = { code: 'Space', f: 4 };
    else if (stroke?.type === 'char') {
      const hit = find(stroke.ch);
      if (hit) {
        target = { code: hit.key.code, f: hit.key.f };
        if (hit.shift) {
          shiftCode = hit.key.f < 4 ? 'ShiftRight' : 'ShiftLeft';
          note = `${hit.key.f < 4 ? '右' : '左'}小指でシフト`;
        }
      }
    }

    const lines = [];
    if (target) {
      board.querySelectorAll(`[data-f="${target.f}"]`).forEach((n) => n.classList.add('is-finger'));
      board.querySelector(`[data-code="${target.code}"]`)?.classList.add('is-next');
      if (HOME[target.f] && HOME[target.f] !== target.code) lines.push([HOME[target.f], target.code, 'is-reach']);
      if (shiftCode) {
        board.querySelector(`[data-code="${shiftCode}"]`)?.classList.add('is-shift');
        lines.push([shiftCode === 'ShiftLeft' ? HOME[0] : HOME[8], shiftCode, 'is-shift-reach']);
      }
    }
    reach(lines);
    // 書き上がったときなど、案内することがなければ、そっと薄くしておく
    box.classList.toggle('is-idle', !target);
    box.querySelector('.unpitsu-finger').textContent = target ? FINGER_NAMES[target.f] : '';
    box.querySelector('.unpitsu-note').textContent = note;
  }

  // 打ったキーから配列を見分ける（数字や英字はどちらも同じなので、記号のキーで決まる）
  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.key.length !== 1 || e.metaKey || e.ctrlKey) return;
    const matches = (name) =>
      LAYOUTS[name].some((row) => row.some((key) => key.code === e.code && key.label == null && (key.n === e.key || key.s === e.key)));
    const jis = matches('jis');
    const us = matches('us');
    if (jis !== us) {
      const name = jis ? 'jis' : 'us';
      if (settings.keyboard !== name) {
        updateSetting('keyboard', name);
        show(last);
      }
    }
  });

  // ブラウザが配列を教えてくれるとき（Chrome など）は、最初から合わせる
  navigator.keyboard
    ?.getLayoutMap?.()
    .then((map) => {
      const eq = map.get('Equal');
      const name = eq === '^' ? 'jis' : eq === '=' ? 'us' : null;
      if (name && settings.keyboard !== name) {
        updateSetting('keyboard', name);
        show(last);
      }
    })
    .catch(() => {});

  // カーソルの上に浮かべる。caret は原稿用紙の左上から測った升目の位置 { x, y, c }、area はその原稿用紙の大きさ
  function follow(caret, area) {
    lastCaret = caret;
    if (settings.unpitsu !== 'cursor' || box.hidden) return;
    box.classList.toggle('is-away', !caret);
    if (!caret) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const { x, y, c } = caret;
    const above = y - h - 10;
    let left;
    let top;
    if (above >= 0) {
      left = Math.max(0, Math.min(area.width - w, x + c / 2 - w / 2));
      top = above;
    } else {
      // 右脇の筆先（変換中の札）にかからないよう、升目二つ分ほど離す
      const right = x + c * 2.6 + 8;
      left = right + w <= area.width ? right : Math.max(0, x - c * 0.6 - w);
      top = Math.max(0, Math.min(area.height - h, y));
    }
    // 最初に置くときは滑らせず、その場に出す
    if (!box.classList.contains('is-placed')) requestAnimationFrame(() => box.classList.add('is-placed'));
    box.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  return {
    show,
    follow,
    // 置き場所を移す（設定が変わったとき）
    mount(next) {
      if (box.parentElement !== next) next.append(box);
      box.classList.remove('is-placed', 'is-away');
      box.style.transform = '';
      show(last);
      if (settings.unpitsu === 'cursor' && lastCaret) follow(lastCaret, { width: next.offsetWidth, height: next.offsetHeight });
    },
    // 原稿用紙の下に置くときに空けておく高さ
    get height() {
      return box.hidden ? 0 : box.offsetHeight;
    },
    refresh() {
      layout = null;
      show(last);
    },
  };
}

import { same } from './match.js';
import { buildStream, feed, hira, nextKey } from './yomi.js';

// 縦書きの原稿用紙（写経用紙）
//
// 原稿用紙は描くだけの層で、字は持たない。入力は、いま書く行の右脇に置いた
// 小さな textarea（筆先）が受け持つ。確定するたびに原稿へ書き足す。手本の薄墨は一度も動かない。
//
// 筆先には、いまの段落で書き終えた字（最大 40 字）を左の文脈として残しておく。
// IME は文脈を見て変換するので、ふつうの文章の途中を書いているのと同じ精度で変換できる。
// 文脈の字は札の外に隠し、札には変換中の字だけを見せる。
//
// 変換候補の窓は札の左端から右へ開く。札を右脇（書き終えた行の上）に置くので、
// 窓は書き終えた側に出て、いま書く行の手本とルビを隠さない。
//
// 入れ方（mode()）は三つ。
//   'kasane'  変換して書く。変換中の字を升目の上に描いて手本に重ねる（札は見せない）
//   'fuda'    変換して書く。変換中の字を右脇の札に出す
//   'yomi'    読みで打つ。日本語入力をオフにしてローマ字で読みを打つと、読みが合った語から
//             手本の字が升目に入る（yomi.js）。漢字にはすべて読みを添える。
//             日本語入力がオンのままなら、'kasane' と同じように書ける（かなのまま確定しても通る）
//
// 升目に重ねるときは、
// 手本の薄墨は下にうっすら残し、変換した字が手本と同じなら、薄墨とぴったり重なる。
// IME が描く「いま変換している文節」の下線は出せないので、筆先の選択範囲から描き直す。
//
// 書いている枚だけを見せるが、次の枚があれば、その頭の数行を左にうっすら続きとして見せる。
// 語や変換中の字が枚をまたいでも、先を読みながら書ける。
//
// 外字（日本語入力では出しにくい字。texts.js の auto）は、カーソルが来たら打たずに升目へ入れて先へ進む。
//
// 段落の頭の字下げ・改行・ぶら下げは自動。書けるのは先頭から順にだけで、
// 直すときは BackSpace で戻る。Enter は変換の確定にだけ使う。
//
// opts:
//   parent         原稿用紙を入れる要素
//   paras          章の段落（texts.js の形）
//   value          はじめに書いてある字
//   mode()         入れ方：'kasane' / 'fuda' / 'yomi'
//   misses         これまでに間違えた数（続きから書くとき）
//   reserveBottom()  原稿用紙の下に空けておく高さ（運筆図を下に置くとき）
//   romaji()       運筆図で案内するローマ字の綴り：'hepburn'（ヘボン式）/ 'kunrei'（訓令式）
//   onChange(state)  state.stroke は次の一手（運筆図で示す）：{ type: 'char' | 'backspace' | 'space' | 'enter', ch?, note? }
//                    state.caret はいま書く升目の位置（原稿用紙の左上から）：{ x, y, c }。見えていなければ null
//   onRecord(event)  書いた・消した・打った記録：{ type: 'commit' | 'key' | 'delete', at, ... }
//   onLog(entry) / onPasteBlocked() / onYomiIme() / onKeystroke(event)

export const ROWS = 20; // 一行の字数
export const COLS = 20; // 一枚の行数
export const NEXT_COLS = 2; // 次の枚の頭を、左にうっすら続きとして見せる行数

// 行頭に来たら、前の行の下へぶら下げる字
const HANG = new Set('、。，．」』）〕］｝〉》');
const MODIFIERS = new Set(['Shift', 'Alt', 'Meta', 'Control', 'CapsLock']);
const SPACE = /^[ 　]$/;
const CONTEXT = 40; // 筆先に残す左の文脈の字数
const HALF_WIDTH = /[\x00-\x7f\uff61-\uff9f]/;
const SVG = 'http://www.w3.org/2000/svg';

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// 段落を升目に割りつける。chars[g] は g 字目に打つ字とその升目
export function layout(paras) {
  const chars = [];
  const marks = []; // ルビと傍点：{ kind, from, to, text }
  const starts = new Set(); // 段落の頭の字の g
  const yomi = []; // 漢字を含む語の読み：{ from, to, text }
  let col = -1;
  for (const p of paras) {
    col++;
    starts.add(chars.length);
    let row = p.align === 'end' ? Math.max(0, ROWS - p.text.length) : p.indent;
    const start = chars.length;
    const auto = new Set(p.auto ?? []);
    for (const [i, ch] of [...p.text].entries()) {
      if (row >= ROWS && !(row === ROWS && HANG.has(ch))) {
        col++;
        row = 0;
      }
      chars.push(auto.has(i) ? { ch, col, row, auto: true } : { ch, col, row });
      row++;
    }
    for (const [s, e, text] of p.ruby ?? []) marks.push({ kind: 'ruby', from: start + s, to: start + e, text });
    for (const [s, e] of p.dots ?? []) marks.push({ kind: 'dots', from: start + s, to: start + e });
    for (const [s, e, text] of p.yomi ?? []) {
      marks.push({ kind: 'yomi', from: start + s, to: start + e, text });
      yomi.push({ from: start + s, to: start + e, text });
    }
  }
  return { chars, marks, starts, yomi, columns: col + 1, pages: Math.max(1, Math.ceil((col + 1) / COLS)) };
}

export function createGenko(opts) {
  const { chars, marks, starts, yomi, pages } = layout(opts.paras);
  const total = chars.length;
  const stream = buildStream(chars.map((c) => c.ch), yomi); // 読みで打つときの、章の頭からの読み
  const wordEnds = new Set(yomi.map((u) => stream.ends[u.from])); // 漢字を含む語の読みが終わる位置

  const root = el('div', 'genko');
  const sheet = el('div', 'genko-sheet');
  const paper = el('div', 'genko-paper');
  const grid = document.createElementNS(SVG, 'svg');
  grid.classList.add('genko-grid');
  const cellLayer = el('div', 'genko-cells');
  const markLayer = el('div', 'genko-marks');
  const fude = el('div', 'fude'); // 札。文脈の字は札の外に出して隠す
  const input = el('textarea', 'fude-input');
  for (const [k, v] of Object.entries({
    spellcheck: 'false',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    wrap: 'off',
    rows: '1',
    'aria-label': '筆先',
  })) {
    input.setAttribute(k, v);
  }
  fude.append(input);
  sheet.append(paper, grid, markLayer, cellLayer, fude);
  root.append(sheet);
  opts.parent.append(root);

  let typed = '';
  for (const ch of opts.value ?? '') if (typed.length < total) typed += ch;
  autoFill();
  let misses = opts.misses ?? 0;
  let context = ''; // 筆先に残している左の文脈
  let kana = { pos: 0, pending: '' }; // 読みで打つ：読みのどこまで打ったか、まだ字にならないローマ字
  let composing = null; // 変換中：{ start, baseLength }（筆先の中の位置）
  let fresh = null; // 書いたばかりの字の範囲：{ from, to }
  let peek = null; // 書いている枚とは別の枚を見ているとき、その枚
  let shown = -1; // いま描いている枚
  let geo = null; // 升目の大きさと位置
  let cellEls = new Map(); // g → 升目の要素

  const record = (type, extra = {}) => opts.onRecord?.({ type, mode: opts.mode?.() ?? 'kasane', ...extra });
  const log = (type, extra = {}) =>
    opts.onLog?.({ type, value: input.value.slice(context.length), context, composing: !!composing, ...extra });

  // ───── 升目の位置 ─────

  function measure() {
    const width = opts.parent.clientWidth;
    const height = window.innerHeight - opts.parent.getBoundingClientRect().top - 24 - (opts.reserveBottom?.() ?? 0);
    // 横：外の余白 1.6 升、行の間のルビの帯 0.5 升、真ん中の柱 1.4 升、左に続きの行と余白
    const byWidth = width / (COLS * 1.5 + 1.4 + 1.6 + NEXT_COLS * 1.5 + 1);
    const byHeight = height / (ROWS + 2.5);
    const c = Math.floor(Math.max(18, Math.min(44, byWidth, Math.max(byHeight, 22))));
    const gap = Math.round(c * 0.5);
    const hashira = Math.round(c * 1.4);
    const padX = Math.round(c * 0.8);
    const padTop = Math.round(c * 0.9);
    const offset = NEXT_COLS * (c + gap) + c; // 原稿用紙の左端。その左に続きの行を置く
    const paperWidth = padX * 2 + COLS * (c + gap) + hashira;
    return {
      c,
      gap,
      hashira,
      padX,
      padTop,
      offset,
      paperWidth,
      width: offset + paperWidth,
      height: padTop + ROWS * c + Math.round(c * 1.6),
    };
  }

  // 枚の中の k 行目（右から数える）の升目の左端
  function colLeft(k) {
    const { c, gap, hashira, padX, width } = geo;
    return width - padX - (k + 1) * (c + gap) - (k >= COLS / 2 ? hashira : 0);
  }

  // 続きの j 行目（次の枚の j 行目）の升目の左端。原稿用紙の左の外に並べる
  function nextLeft(j) {
    const { c, gap, offset } = geo;
    return offset - c / 2 - gap - c - j * (c + gap);
  }

  // いま見せている枚に出すか（その枚の字か、次の枚の頭の続きの行か）。出すなら升目の左端
  function placeOf(col, page) {
    const p = Math.floor(col / COLS);
    if (p === page) return colLeft(col % COLS);
    if (p === page + 1 && col % COLS < NEXT_COLS) return nextLeft(col % COLS);
    return null;
  }

  function cellBox(g) {
    const { col, row } = chars[Math.min(g, total - 1)];
    const x = colLeft(col % COLS);
    return { x, y: geo.padTop + row * geo.c, page: Math.floor(col / COLS) };
  }

  // ───── 一枚を組む ─────

  function drawGrid() {
    const { c, gap, width, height, padTop, hashira } = geo;
    grid.setAttribute('width', width);
    grid.setAttribute('height', height);
    grid.setAttribute('viewBox', `0 0 ${width} ${height}`);
    let d = '';
    for (let k = 0; k < COLS; k++) {
      const x = colLeft(k);
      d += `M${x} ${padTop}V${padTop + ROWS * c}M${x + c} ${padTop}V${padTop + ROWS * c}`;
      for (let r = 1; r < ROWS; r++) d += `M${x} ${padTop + r * c}h${c}`;
    }
    // 外枠と、真ん中の柱
    const left = colLeft(COLS - 1) - gap / 2;
    const right = colLeft(0) + c + gap;
    const mid = colLeft(COLS / 2 - 1) - gap;
    d += `M${left} ${padTop}H${right}M${left} ${padTop + ROWS * c}H${right}`;
    d += `M${left} ${padTop}V${padTop + ROWS * c}M${right} ${padTop}V${padTop + ROWS * c}`;
    d += `M${mid} ${padTop}V${padTop + ROWS * c}M${mid - hashira + gap} ${padTop}V${padTop + ROWS * c}`;
    // 続きの行（次の枚の頭）
    let next = '';
    for (let j = 0; j < NEXT_COLS; j++) {
      const x = nextLeft(j);
      next += `M${x} ${padTop}V${padTop + ROWS * c}M${x + c} ${padTop}V${padTop + ROWS * c}`;
      for (let r = 1; r < ROWS; r++) next += `M${x} ${padTop + r * c}h${c}`;
    }
    grid.innerHTML = `<path d="${d}" /><path class="next" d="${next}" />`;
    paper.style.left = `${geo.offset}px`;
    paper.style.width = `${geo.paperWidth}px`;
    paper.style.height = `${height}px`;
  }

  function buildPage(page) {
    shown = page;
    cellLayer.replaceChildren();
    markLayer.replaceChildren();
    cellEls = new Map();
    const { c, gap, padTop } = geo;

    for (let g = 0; g < total; g++) {
      const { col, row } = chars[g];
      const x = placeOf(col, page);
      if (x == null) continue;
      const cell = el('span', 'cell');
      if (Math.floor(col / COLS) !== page) cell.dataset.next = '';
      cell.style.left = `${x}px`;
      cell.style.top = `${padTop + row * c}px`;
      cellLayer.append(cell);
      cellEls.set(g, cell);
    }

    // ルビと傍点は、行の右の帯に添える。行をまたぐときは、字数で読みを分ける
    for (const m of marks) {
      const runs = [];
      for (let g = m.from; g < m.to; g++) {
        const { col } = chars[g];
        if (placeOf(col, page) == null) continue;
        if (runs.length && runs.at(-1).col === col) runs.at(-1).to = g + 1;
        else runs.push({ col, from: g, to: g + 1 });
      }
      const len = m.to - m.from;
      for (const run of runs) {
        const node = el('span', m.kind);
        const { row } = chars[run.from];
        node.style.left = `${placeOf(run.col, page) + c}px`;
        if (Math.floor(run.col / COLS) !== page) node.classList.add('is-next');
        node.style.top = `${padTop + row * c}px`;
        node.style.width = `${gap}px`;
        node.style.height = `${(run.to - run.from) * c}px`;
        if (m.kind === 'ruby' || m.kind === 'yomi') {
          const a = Math.round((m.text.length * (run.from - m.from)) / len);
          const b = Math.round((m.text.length * (run.to - m.from)) / len);
          node.textContent = m.text.slice(a, b);
          if (m.kind === 'yomi') {
            node.dataset.unit = m.from;
            node.dataset.a = a;
          }
        } else {
          node.textContent = '﹅'.repeat(run.to - run.from);
        }
        node.dataset.from = run.from;
        markLayer.append(node);
      }
    }

    // 柱に枚数
    const no = el('span', 'genko-page-no');
    no.textContent = `${page + 1}`;
    no.style.left = `${colLeft(COLS / 2 - 1) - geo.hashira / 2 - gap / 2}px`;
    no.style.top = `${padTop + ROWS * c - c * 1.2}px`;
    markLayer.append(no);

    // 続きの行の見出し
    const hasNext = page + 1 < pages;
    root.classList.toggle('has-next', hasNext);
    if (hasNext) {
      const label = el('span', 'genko-next-label');
      label.textContent = `つづき（${page + 2}枚目）`;
      label.style.left = `${nextLeft(NEXT_COLS - 1)}px`;
      label.style.width = `${nextLeft(0) + c + gap - nextLeft(NEXT_COLS - 1)}px`;
      label.style.top = `${padTop - c * 0.8}px`;
      markLayer.append(label);
    }
  }

  function relayout() {
    geo = measure();
    root.style.setProperty('--c', `${geo.c}px`);
    root.style.setProperty('--gap', `${geo.gap}px`);
    sheet.style.width = `${geo.width}px`;
    sheet.style.height = `${geo.height}px`;
    drawGrid();
    shown = -1;
    render();
  }

  // ───── 描く ─────

  // 筆先の中身：pending は確定したがまだ原稿に書き足していない字、comp は変換中の字。
  // caret と sel は、変換中の字の中のカーソルと選んでいる範囲（いま変換している文節）
  function state() {
    const value = input.value;
    if (!composing) return { pending: '', comp: '', caret: 0, sel: null };
    const pending = value.slice(context.length, composing.start);
    const comp = value.slice(composing.start, composing.start + Math.max(0, value.length - composing.baseLength));
    const a = input.selectionStart - composing.start;
    const b = input.selectionEnd - composing.start;
    return { pending, comp, caret: b, sel: b > a ? [a, b] : null };
  }

  function render() {
    const { pending, comp, caret, sel } = state();
    const preedit = comp.length;
    const cursor = Math.min(typed.length + pending.length, total);
    const writing = cursor < total ? cellBox(cursor).page : pages - 1;
    const page = peek ?? writing;
    if (page !== shown) buildPage(page);
    const written = typed + pending;
    const mode = opts.mode?.() ?? 'kasane';
    const overlay = mode !== 'fuda';
    const yomiMode = mode === 'yomi' && !composing;

    for (const [g, cell] of cellEls) {
      let cls = 'cell';
      let text = chars[g].ch;
      let html = null;
      if (g < written.length) {
        text = written[g];
        cls += same(written[g], chars[g].ch) ? ' ink' : ' miss';
        if (fresh && g >= fresh.from && g < fresh.to) cls += ' fresh';
      } else if (composing && g < cursor + preedit) {
        cls += ' ghost aim';
        if (overlay) {
          // 手本の薄墨の上に、変換中の字を重ねる
          const i = g - cursor;
          const ok = same(comp[i], chars[g].ch);
          cls += ok ? ' is-ok' : '';
          if (sel && i >= sel[0] && i < sel[1]) cls += ' pre-sel';
          if (!sel && i === caret) cls += ' pre-caret';
          html = `${escapeHtml(text)}<span class="pre${ok ? ' ok' : ''}">${escapeHtml(comp[i])}</span>`;
        }
      } else {
        cls += g === cursor ? ' ghost next' : ' ghost';
        if (overlay && composing && !sel && g === cursor + caret) cls += ' pre-caret';
        // 読みで打つ：打ちかけの語の升目を淡く示し、まだ字にならないローマ字を添える
        if (yomiMode && g >= cursor && stream.starts[g] < kana.pos) cls += ' aim';
        if (yomiMode && g === cursor && kana.pending) html = `${escapeHtml(text)}<span class="romaji">${escapeHtml(kana.pending)}</span>`;
      }
      if (/[A-Za-z0-9 ]/.test(chars[g].ch)) cls += ' upright';
      if (cell.className !== cls) cell.className = cls;
      const key = html ?? escapeHtml(text);
      if (cell.dataset.k !== key) {
        cell.dataset.k = key;
        if (html) cell.innerHTML = html;
        else cell.textContent = text;
      }
    }
    for (const node of markLayer.children) {
      if (node.dataset.from) node.classList.toggle('is-written', Number(node.dataset.from) < written.length);
      if (node.dataset.unit) {
        // 読みで打つ：いま打っている語の読みは、打ったところまで藍にする
        const from = Number(node.dataset.unit);
        const current = yomiMode && from <= cursor && cursor < total && stream.starts[cursor] === stream.starts[from];
        const done = current ? kana.pos - stream.starts[from] - Number(node.dataset.a) : 0;
        node.classList.toggle('is-current', current);
        const text = node.dataset.text ?? (node.dataset.text = node.textContent);
        const key = `${Math.max(0, done)}`;
        if (node.dataset.done !== key) {
          node.dataset.done = key;
          node.innerHTML = done > 0
            ? `<span class="done">${escapeHtml(text.slice(0, done))}</span>${escapeHtml(text.slice(done))}`
            : escapeHtml(text);
        }
      }
    }

    placeFude(cursor, pending.length, preedit, page === writing && cursor < total);
    root.classList.toggle('is-overlay', overlay);
    root.classList.toggle('is-yomi', mode === 'yomi');
    root.classList.toggle('is-composing', !!composing);
    root.classList.toggle('is-peeking', peek != null && peek !== writing);
    const box = cursor < total && page === writing ? cellBox(cursor) : null;
    opts.onChange?.({
      stroke: nextStroke(mode, cursor, comp),
      caret: box && { x: box.x, y: box.y, c: geo.c },
      typed,
      total,
      correct: [...typed].filter((ch, g) => same(ch, chars[g].ch)).length,
      misses,
      page,
      pages,
      writingPage: writing,
      done: typed.length === total && [...typed].every((ch, g) => same(ch, chars[g].ch)),
      composing: !!composing,
    });
  }

  // 次の一手：朱の字があれば消す。読みで打つときと、変換する前は、読みの次のローマ字。
  // 変換中は、かなの読みが合っていれば次のローマ字（漢字の語の読みが終わっていれば、変換もできる）、
  // 変換した字が手本どおりなら確定、違えば次の候補
  function nextStroke(mode, cursor, comp) {
    for (let g = 0; g < typed.length; g++) {
      if (!same(typed[g], chars[g].ch)) return { type: 'backspace', note: '朱の字を消す' };
    }
    if (cursor >= total) return null;
    const start = stream.starts[cursor];
    if (!composing) {
      const ch = nextKey(stream.stream, mode === 'yomi' ? kana : { pos: start, pending: '' }, opts.romaji?.());
      return ch ? { type: 'char', ch, note: mode === 'yomi' ? '' : 'かなで打つ' } : null;
    }
    const m = comp.match(/^([ぁ-ゖァ-ヺー、。「」『』！？・]*)([a-z']*)$/);
    if (m) {
      const read = hira(m[1]);
      if (!stream.stream.startsWith(read, start)) return { type: 'backspace', note: '読みを打ち直す' };
      const pos = start + read.length;
      const convertible = read.length > 0 && wordEnds.has(pos);
      const ch = nextKey(stream.stream, { pos, pending: m[2] }, opts.romaji?.());
      if (ch) return { type: 'char', ch, note: convertible ? 'スペースで変換もできる' : '' };
      return convertible ? { type: 'space', note: '変換' } : null;
    }
    const ok = [...comp].every((c, i) => cursor + i < total && same(c, chars[cursor + i].ch));
    return ok ? { type: 'enter', note: '確定' } : { type: 'space', note: '次の候補' };
  }

  // 札を、いま書く行の右脇に置く。筆先にまだ書き足していない確定済みの字（pending）が
  // 残っているときは、その分だけ上へずらし、変換中の字がいま書く升目にそろうようにする
  function placeFude(cursor, pending, preedit, visible) {
    const { x, y } = cellBox(Math.min(cursor, total - 1));
    const { c, gap, height } = geo;
    const f = Math.round(c * 0.74);
    fude.classList.toggle('is-empty', input.value === context);
    fude.classList.toggle('is-away', !visible);

    const h = Math.max(2, pending + preedit + 1) * c;
    fude.style.width = `${c}px`;
    fude.style.height = `${h}px`;
    fude.style.top = `${Math.min(y - pending * c, height - h - 4)}px`;
    fude.style.left = `${x + c + gap + 2}px`;

    // 字の送りを升目と同じにし、文脈の字の分だけ上へずらして札の外に出す
    const s = input.style;
    s.fontSize = `${f}px`;
    s.letterSpacing = `${c - f}px`;
    s.lineHeight = `${c}px`;
    s.paddingTop = `${(c - f) / 2}px`;
    s.width = `${c}px`;
    s.height = `${(input.value.length + 2) * c}px`;
    s.top = `${-context.length * c}px`;
  }

  // ───── 入力 ─────

  // 筆先に、いまの段落で書き終えた字を左の文脈として入れ直す。
  // 半角の字は升目と字の送りが合わないので、文脈はその字のあとからにする
  function setContext() {
    const g = typed.length;
    let from = g;
    while (from > 0 && g - from < CONTEXT && !starts.has(from)) from--;
    let text = typed.slice(from, g);
    for (let i = text.length - 1; i >= 0; i--) {
      if (HALF_WIDTH.test(text[i])) {
        text = text.slice(i + 1);
        break;
      }
    }
    context = text;
    input.value = text;
    input.setSelectionRange(text.length, text.length);
  }

  // 読みで打つ：原稿の字から、読みのどこから打つかを決め直す
  function syncKana() {
    kana = { pos: typed.length < total ? stream.starts[typed.length] : stream.stream.length, pending: '' };
  }

  // カーソルが外字に来たら、打たずに升目へ入れる。入れたら true
  function autoFill() {
    const from = typed.length;
    while (typed.length < total && chars[typed.length].auto) typed += chars[typed.length].ch;
    return typed.length > from;
  }

  // BackSpace：自動で入れた字は飛ばして、その前の字を一つ消す。消した字数を返す
  function backOne() {
    const before = typed.length;
    while (typed.length && chars[typed.length - 1].auto) typed = typed.slice(0, -1);
    if (typed.length) typed = typed.slice(0, -1);
    return before - typed.length;
  }

  // 読みで打つ：読みを打ち終えた語の字を、手本のとおりに升目へ入れる（続く外字も入れて、読みの位置をその先へ）
  function fillByKana() {
    const from = typed.length;
    while (typed.length < total && stream.ends[typed.length] <= kana.pos) typed += chars[typed.length].ch;
    if (autoFill()) syncKana();
    if (typed.length > from) fresh = { from, to: typed.length };
    return typed.length > from;
  }

  function typeKana(e) {
    if (autoFill()) {
      syncKana();
      setContext();
    }
    const at = typed.length;
    const ok = feed(stream.stream, kana, e.key);
    record('key', { key: e.key, ok, at });
    if (ok) {
      if (fillByKana()) setContext();
    } else {
      misses++;
      cellEls.get(typed.length)?.animate?.(
        [{ backgroundColor: 'var(--shu-soft)' }, { backgroundColor: 'transparent' }],
        { duration: 360 },
      );
    }
    log('kana', { key: e.key, pos: kana.pos, pending: kana.pending });
    peek = null;
    render();
  }

  // 筆先の字を原稿へ書き足す。文脈の字が消されていたら（Option＋BackSpace など）、原稿からも消す
  function flush() {
    if (composing) return;
    const value = input.value;
    if (value === context) return;
    let kept = 0;
    while (kept < context.length && kept < value.length && value[kept] === context[kept]) kept++;
    const removed = context.length - kept;
    if (removed) {
      typed = typed.slice(0, typed.length - removed);
      record('delete', { n: removed, at: typed.length });
    }

    const added = value.slice(kept);
    const from = typed.length;

    // 読みで打つとき、日本語入力をオンのまま、かなで確定しても読みが合えば通す
    if (opts.mode?.() === 'yomi' && !removed && /^[ぁ-ゖァ-ヺー]+$/.test(added)) {
      syncKana();
      const read = hira(added);
      if (stream.stream.startsWith(read, kana.pos)) {
        kana.pos += read.length;
        fillByKana();
        record('commit', { text: added, ok: true, at: from, kana: true });
        log('commit', { data: added, kana: true });
        setContext();
        peek = null;
        render();
        return;
      }
    }

    for (const ch of added) {
      if (ch === '\n' || ch === '\r' || ch === '\t') continue;
      autoFill();
      if (typed.length >= total) break;
      const expected = chars[typed.length].ch;
      // 段落の頭の字下げなどで空白を打っても、手本が空白でなければ数えない
      if (SPACE.test(ch) && !SPACE.test(expected)) continue;
      if (!same(ch, expected)) misses++;
      typed += ch;
    }
    autoFill();
    fresh = typed.length > from ? { from, to: typed.length } : null;
    if (added) {
      const ok = [...typed.slice(from)].every((ch, i) => same(ch, chars[from + i].ch));
      record('commit', { text: added, ok, at: from });
    }
    log('commit', { data: added, removed });
    setContext();
    syncKana();
    peek = null;
    render();
  }

  input.addEventListener('keydown', (e) => {
    log('keydown', { key: e.key, keyCode: e.keyCode, isComposing: e.isComposing });
    if (e.isComposing || e.keyCode === 229) return;
    if (!e.metaKey && !e.ctrlKey && !MODIFIERS.has(e.key)) opts.onKeystroke?.(e);
    const idle = input.value === context;
    const yomiMode = opts.mode?.() === 'yomi';

    if (yomiMode && idle && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      typeKana(e);
    } else if (yomiMode && idle && e.key === 'Backspace' && !e.metaKey && !e.ctrlKey) {
      // 読みで打つ：まだ字にならないローマ字、打ちかけの読み、一つ前の語、の順に戻る
      e.preventDefault();
      if (kana.pending) kana.pending = kana.pending.slice(0, -1);
      else if (typed.length < total && kana.pos > stream.starts[typed.length]) kana.pos--;
      else if (typed.length) {
        const before = typed.length;
        while (typed.length && chars[typed.length - 1].auto) typed = typed.slice(0, -1);
        const end = stream.ends[typed.length - 1];
        while (typed.length && stream.ends[typed.length - 1] === end) typed = typed.slice(0, -1);
        record('delete', { n: before - typed.length, at: typed.length });
        setContext();
        syncKana();
      }
      fresh = null;
      peek = null;
      render();
    } else if (e.key === 'Backspace' && idle && !e.altKey && !e.metaKey && !e.ctrlKey) {
      // 一字戻る。段落の頭では、前の段落の最後の字を消す
      e.preventDefault();
      if (typed.length) {
        record('delete', { n: backOne(), at: typed.length });
        fresh = null;
        peek = null;
        setContext();
        syncKana();
        render();
      }
    } else if (
      idle &&
      (e.key === 'Enter' || e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')
    ) {
      // 改行や移動は原稿用紙の側で済ませるので、筆先には入れない
      e.preventDefault();
    }
  });

  input.addEventListener('compositionstart', (e) => {
    const selected = input.selectionEnd - input.selectionStart;
    composing = { start: input.selectionStart, baseLength: input.value.length - selected };
    log('compositionstart', { data: e.data });
    if (opts.mode?.() === 'yomi') opts.onYomiIme?.();
    render();
  });

  input.addEventListener('compositionupdate', (e) => {
    log('compositionupdate', { data: e.data });
  });

  input.addEventListener('compositionend', (e) => {
    composing = null;
    log('compositionend', { data: e.data });
    // Safari は確定の input がこのあとに来る。次の番で、筆先にある字をまとめて書き足す
    setTimeout(flush, 0);
  });

  input.addEventListener('input', (e) => {
    log('input', { data: e.data, inputType: e.inputType, isComposing: e.isComposing });
    if (composing || e.isComposing) render();
    else flush();
  });

  // カーソルはいつも筆先の末尾に置く（文脈の字を選んで書き換えられないように）
  document.addEventListener('selectionchange', () => {
    if (document.activeElement !== input) return;
    if (composing) {
      render(); // 文節を移ったら、下線を描き直す
      return;
    }
    const end = input.value.length;
    if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
  });

  const blockPaste = (e) => {
    e.preventDefault();
    log(e.type);
    opts.onPasteBlocked?.();
  };
  input.addEventListener('paste', blockPaste);
  input.addEventListener('drop', blockPaste);

  // 原稿用紙のどこを押しても、筆先に戻る
  root.addEventListener('mousedown', (e) => {
    if (e.target === input) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
  });
  input.addEventListener('focus', () => root.classList.add('is-focused'));
  input.addEventListener('blur', () => root.classList.remove('is-focused'));

  window.addEventListener('resize', relayout);
  document.fonts?.ready.then(relayout);
  setContext();
  syncKana();
  relayout();

  return {
    root,
    get typed() {
      return typed;
    },
    focus() {
      input.focus({ preventScroll: true });
    },
    refresh() {
      // 打ちかけの読みは、いま書く語のものなら残す（設定を変えただけで、打ちかけが消えないように）
      const inWord = typed.length < total && kana.pos >= stream.starts[typed.length] && kana.pos < stream.ends[typed.length];
      if (!inWord) syncKana();
      relayout();
    },
    reset() {
      typed = '';
      autoFill();
      misses = 0;
      fresh = null;
      setContext();
      syncKana();
      peek = null;
      render();
    },
    // 書いている枚とは別の枚を見る（書きはじめると、書いている枚に戻る）
    turn(delta) {
      const cursor = Math.min(typed.length, total - 1);
      const base = peek ?? cellBox(cursor).page;
      const next = Math.max(0, Math.min(pages - 1, base + delta));
      peek = next === cellBox(cursor).page ? null : next;
      render();
    },
  };
}

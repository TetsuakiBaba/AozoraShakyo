// 読みで打つ：ローマ字の打鍵を、手本の読み（かな）と照らし合わせる
//
// 日本語入力をオフにして打つので、IME の変換（ライブ変換も）は関わらない。
// shi / si、tsu / tu、n / nn、っ の子音重ね、小さい字の x・l など、打ち方の違いは受け付ける。

const BASE = {
  あ: ['a'], い: ['i', 'yi'], う: ['u', 'wu', 'whu'], え: ['e'], お: ['o'],
  か: ['ka', 'ca'], き: ['ki'], く: ['ku', 'cu', 'qu'], け: ['ke'], こ: ['ko', 'co'],
  さ: ['sa'], し: ['si', 'shi', 'ci'], す: ['su'], せ: ['se', 'ce'], そ: ['so'],
  た: ['ta'], ち: ['ti', 'chi'], つ: ['tu', 'tsu'], て: ['te'], と: ['to'],
  な: ['na'], に: ['ni'], ぬ: ['nu'], ね: ['ne'], の: ['no'],
  は: ['ha'], ひ: ['hi'], ふ: ['hu', 'fu'], へ: ['he'], ほ: ['ho'],
  ま: ['ma'], み: ['mi'], む: ['mu'], め: ['me'], も: ['mo'],
  や: ['ya'], ゆ: ['yu'], よ: ['yo'],
  ら: ['ra'], り: ['ri'], る: ['ru'], れ: ['re'], ろ: ['ro'],
  わ: ['wa'], ゐ: ['wi'], ゑ: ['we'], を: ['wo'], ん: ['nn', 'xn'],
  が: ['ga'], ぎ: ['gi'], ぐ: ['gu'], げ: ['ge'], ご: ['go'],
  ざ: ['za'], じ: ['zi', 'ji'], ず: ['zu'], ぜ: ['ze'], ぞ: ['zo'],
  だ: ['da'], ぢ: ['di'], づ: ['du'], で: ['de'], ど: ['do'],
  ば: ['ba'], び: ['bi'], ぶ: ['bu'], べ: ['be'], ぼ: ['bo'],
  ぱ: ['pa'], ぴ: ['pi'], ぷ: ['pu'], ぺ: ['pe'], ぽ: ['po'],
  ゔ: ['vu'],
  ぁ: ['la', 'xa'], ぃ: ['li', 'xi'], ぅ: ['lu', 'xu'], ぇ: ['le', 'xe'], ぉ: ['lo', 'xo'],
  ゃ: ['lya', 'xya'], ゅ: ['lyu', 'xyu'], ょ: ['lyo', 'xyo'], ゎ: ['lwa', 'xwa'],
  っ: ['ltu', 'xtu', 'ltsu', 'xtsu'],
  ー: ['-'], '―': ['-'], '‐': ['-'], 'ゝ': ['-'],
  '、': [','], '。': ['.'], '，': [','], '．': ['.'],
  '「': ['['], '」': [']'], '『': ['['], '』': [']'], '（': ['('], '）': [')'],
  '！': ['!'], '？': ['?'], '・': ['/'], '～': ['~'], '〜': ['~'], '：': [':'], '；': [';'],
  '　': [' '],
};

// 拗音など、二字で一つの打ち方があるもの
const PAIRS = {};
const YOUON = {
  き: ['ky'], ぎ: ['gy'], し: ['sy', 'sh'], じ: ['zy', 'jy', 'j'], ち: ['ty', 'cy', 'ch'], ぢ: ['dy'],
  に: ['ny'], ひ: ['hy'], び: ['by'], ぴ: ['py'], み: ['my'], り: ['ry'],
};
for (const [head, cons] of Object.entries(YOUON)) {
  for (const [small, vowel] of [['ゃ', 'a'], ['ゅ', 'u'], ['ょ', 'o'], ['ぇ', 'e']]) {
    PAIRS[head + small] = cons.map((c) => c + vowel);
  }
}
Object.assign(PAIRS, {
  ふぁ: ['fa'], ふぃ: ['fi'], ふぇ: ['fe'], ふぉ: ['fo'],
  てぃ: ['thi'], でぃ: ['dhi'], とぅ: ['twu'], どぅ: ['dwu'],
  うぃ: ['wi'], うぇ: ['we'], うぉ: ['who'], ゔぁ: ['va'], ゔぃ: ['vi'], ゔぇ: ['ve'], ゔぉ: ['vo'],
});

export function hira(text) {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// その字の打ち方。英数字は全角も半角も、その字（小文字）で打つ
function spellingsOf(ch) {
  if (BASE[ch]) return BASE[ch];
  const n = ch.normalize('NFKC').toLowerCase();
  if (n.length === 1 && /[a-z0-9!?.,\-'"/:;()]/.test(n)) return [n];
  return null; // 打ちようのない字（外字の目印など）は、打たずに進める
}

// 手本の g 字目までを打つために、読みの並び（stream）のどこまで打てばよいか。
// stream はひらがなの読みを章の頭からつないだもの。ends[g] は g 字目が書き終わる stream の位置、
// starts[g] はその字を含む語の読みの始まり
export function buildStream(chars, yomi) {
  let stream = '';
  const starts = new Array(chars.length);
  const ends = new Array(chars.length);
  const units = new Map(yomi.map((u) => [u.from, u]));
  for (let g = 0; g < chars.length; ) {
    const unit = units.get(g);
    if (unit) {
      const from = stream.length;
      stream += hira(unit.text);
      for (let k = unit.from; k < unit.to; k++) {
        starts[k] = from;
        ends[k] = stream.length;
      }
      g = unit.to;
    } else {
      starts[g] = stream.length;
      stream += hira(chars[g]);
      ends[g] = stream.length;
      g++;
    }
  }
  return { stream, starts, ends };
}

// stream の i から打てる打ち方：[{ len: 進む字数, r: ローマ字 }]
function options(stream, i) {
  const list = [];
  const pair = PAIRS[stream.slice(i, i + 2)];
  if (pair) for (const r of pair) list.push({ len: 2, r });
  const ch = stream[i];
  for (const r of spellingsOf(ch) ?? []) list.push({ len: 1, r });

  if (ch === 'っ') {
    // 次の字の子音を重ねる（「った」→ tta）
    for (const o of options(stream, i + 1)) {
      const c = o.r[0];
      if (c && /[bcdfghjklmpqrstvwxyz]/.test(c) && c !== 'n') list.push({ len: 1, r: c });
    }
  }
  if (ch === 'ん') {
    // 次が母音・な行・や行でなければ、n 一つでよい
    const next = stream[i + 1];
    const firsts = next ? (options(stream, i + 1).map((o) => o.r[0])) : [];
    if (next && !firsts.some((c) => /[aiueony]/.test(c))) list.push({ len: 1, r: 'n' });
  }
  return list;
}

// 打鍵を受けて進める。state は { pos: stream の位置, pending: まだ字にならないローマ字 }
// 返り値：合った打鍵なら true（state を進める）、違えば false
export function feed(stream, state, key) {
  // 打ちようのない字は、打たずに進める
  while (state.pos < stream.length && !options(stream, state.pos).length) state.pos++;
  if (state.pos >= stream.length) return false;

  const q = state.pending + key.toLowerCase();
  const opts = options(stream, state.pos);
  const exact = opts.find((o) => o.r === q);
  const longer = opts.some((o) => o.r !== q && o.r.startsWith(q));

  // n のように、それで一字になるが、続けて打つと別の打ち方（nn）にもなるときは、次の打鍵まで待つ
  if (longer) {
    state.pending = q;
    return true;
  }
  if (exact) {
    state.pos += exact.len;
    state.pending = '';
    while (state.pos < stream.length && !options(stream, state.pos).length) state.pos++;
    return true;
  }
  // 待っていた打鍵（n など）がそれだけで一字になるなら確定し、いまの打鍵を次の字に回す
  const waited = state.pending && opts.find((o) => o.r === state.pending);
  if (waited) {
    const saved = { ...state };
    state.pos += waited.len;
    state.pending = '';
    if (feed(stream, state, key)) return true;
    Object.assign(state, saved);
  }
  return false;
}

// 運筆図で案内する綴り。受け付けるのはどちらの綴りも同じで、案内だけを変える
// （ヘボン式は 2025 年の内閣告示「ローマ字のつづり方」の基本。訓令式は小学校で習ってきた綴り）
const PREFERRED = {
  hepburn: new Set(['shi', 'chi', 'tsu', 'fu', 'ji', 'sha', 'shu', 'sho', 'she', 'ja', 'ju', 'jo', 'je', 'cha', 'chu', 'cho', 'che']),
  kunrei: new Set(['si', 'ti', 'tu', 'hu', 'zi', 'sya', 'syu', 'syo', 'sye', 'zya', 'zyu', 'zyo', 'zye', 'tya', 'tyu', 'tyo', 'tye']),
};

// stream の pos からの、案内する打ち方。っ は次の字の子音を重ねる打ち方で案内する
function preferred(stream, pos, pending, style) {
  const opts = options(stream, pos).filter((o) => o.r.length > pending.length && o.r.startsWith(pending));
  if (!opts.length) return null;
  if (stream[pos] === 'っ') {
    const next = preferred(stream, pos + 1, '', style);
    const double = next && opts.find((o) => o.r === next.r[0]);
    if (double) return double;
  }
  return opts.find((o) => PREFERRED[style]?.has(o.r)) ?? opts[0];
}

// 次に押すキー（運筆図で示す）。style は案内する綴り：'hepburn'（ヘボン式）か 'kunrei'（訓令式）
export function nextKey(stream, state, style = 'hepburn') {
  let pos = state.pos;
  while (pos < stream.length && !options(stream, pos).length) pos++;
  if (pos >= stream.length) return null;
  const pick = preferred(stream, pos, state.pending, style);
  return pick ? pick.r[state.pending.length] : null;
}

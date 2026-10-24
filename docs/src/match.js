// 書いた字と手本の字を照らし合わせる
//
// IME で素直に出ない字は、同じ字として認める（ダッシュをのばし棒で書く、など）。
// 全角と半角の英数字・記号も同じ字とみなす。

const GROUPS = ['―ー－—─━‐-', '〜～~', '・･'];

const KEY = new Map();
for (const group of GROUPS) {
  for (const c of group) KEY.set(c, group[0]);
}

function key(c) {
  if (KEY.has(c)) return KEY.get(c);
  // 全角の英数字・記号・空白を半角に寄せる（一字が一字になるときだけ）
  const n = c.normalize('NFKC');
  return n.length === 1 ? n : c;
}

export function same(typed, expected) {
  return typed === expected || key(typed) === key(expected);
}

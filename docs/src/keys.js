// 写経の打鍵の様子をまとめる。どのキーを押したかは残さず、押した間隔だけを数える
// 間隔が5秒より空いたら、手を止めていたとみなして数えない
// 人の打鍵は間隔にばらつきがあり、35ms より短い間隔はほとんど出ない。自動入力の見分けに使う

const PAUSE_MS = 5000;
const FAST_MS = 35;

export function emptyKeys() {
  return { count: 0, sum: 0, sumSq: 0, fast: 0, last: 0 };
}

export function recordKey(keys, now = Date.now()) {
  const gap = now - keys.last;
  if (keys.last && gap < PAUSE_MS) {
    keys.count++;
    keys.sum += gap;
    keys.sumSq += gap * gap;
    if (gap < FAST_MS) keys.fast++;
  }
  keys.last = now;
}

// 提出用の要約：打鍵の数、間隔の平均とばらつき（ミリ秒）、極端に速い打鍵の割合
export function summarizeKeys(keys) {
  if (!keys?.count) return null;
  const mean = keys.sum / keys.count;
  const sd = Math.sqrt(Math.max(0, keys.sumSq / keys.count - mean * mean));
  return {
    count: keys.count,
    meanMs: Math.round(mean),
    sdMs: Math.round(sd),
    fastRatio: Math.round((keys.fast / keys.count) * 1000) / 1000,
  };
}

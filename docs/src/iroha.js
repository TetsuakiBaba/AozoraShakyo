// iroha のコード。一冊を書き上げた人に、日本語入力 iroha のスキルを解除するコードを出す。
//
// iroha（https://github.com/TetsuakiBaba/iroha）の 設定 > スキル に出ている ID をここに入れると、
// 「その ID と作品の番号」からコードを作る。iroha の側は同じ計算で照合する（サーバは使わない）。
// 計算は iroha の macos/Sources/IrohaCore/Skills/SkillCode.swift と同じにする。
// **変えるときは両方を合わせ、下の「検算の値」と iroha の SkillCodeTests の値も更新する。**
//
//   文字        数字と英大文字 32 種（見間違えやすい I・L・O・U を除く）
//   iroha の ID 8 文字（表示は 7QF2-MX8K）
//   作品の番号  2 文字（WORK_NUMBERS）
//   コード      作品の番号 2 文字 + 照合用 6 文字（表示は 01-XV922G）
//   照合用      HMAC-SHA256(鍵 = KEY, 本文 = "<ID>:<作品の番号>") の先頭 30 ビットを、上位から 5 ビットずつ文字にしたもの
//
// 検算の値（ID 7QF2MX8K）：作品 01 → 01-XV922G、作品 02 → 02-XQGSYN

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY = 'iroha-skill-code-v1';
const ID_LENGTH = 8;

// 作品の番号。iroha は「別々の番号のコードがいくつあるか」を数えるので、
// **一度公開した番号は変えない・ほかの本に使い回さない**（本を外しても番号は欠番にする）。
// 本を足したら、ここに次の番号を足す（番号のない本にはコードを出さない）
export const WORK_NUMBERS = {
  rashomon: '01',
  chumon: '02',
  gon: '03',
};

export function workNumber(book) {
  return WORK_NUMBERS[book.id] ?? null;
}

// 入れられた ID を照合用の形にそろえる：全角を半角に、小文字を大文字に、空白とハイフンを除き、
// 見間違えやすい字を数字に寄せる（I・L → 1、O → 0）。8 文字にならない・使えない字があれば null
export function normalizeId(text) {
  let id = '';
  for (const ch of text.normalize('NFKC').toUpperCase()) {
    if (/[\s\-‐‑–—ー]/.test(ch)) continue;
    if (ch === 'I' || ch === 'L') id += '1';
    else if (ch === 'O') id += '0';
    else if (ALPHABET.includes(ch)) id += ch;
    else return null;
  }
  return id.length === ID_LENGTH ? id : null;
}

export function formatId(id) {
  return `${id.slice(0, 4)}-${id.slice(4)}`;
}

// コードを作れるか（HMAC の計算は、https か localhost で開いたページでだけ使える）
export function canMakeCode() {
  return !!globalThis.crypto?.subtle;
}

// その ID・作品のコード（表示の形。例：01-XV922G）
export async function makeCode(id, work) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}:${work}`)));
  // 先頭 30 ビットを 5 ビットずつ取り出す（>>> で符号なしの 32 ビットとして扱う）
  const bits = ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 2;
  let check = '';
  for (let i = 5; i >= 0; i--) check += ALPHABET[(bits >>> (5 * i)) & 31];
  return `${work}-${check}`;
}

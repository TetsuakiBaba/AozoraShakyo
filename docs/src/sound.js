// 効果音は Web Audio で鳴らす（打鍵音だけは録音した音を使い、ほかは合成する）

let ctx = null;

function audio() {
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ページで最初に操作したときに音の準備を済ませておき、一打目から遅れずに鳴らす
for (const type of ['pointerdown', 'keydown']) {
  addEventListener(type, audio, { once: true, capture: true });
}

// 打鍵音：キーボードを録音した音から、毎回ひとつ選んで鳴らす
// 素材は unicaegames「Keyboard Soundpack #1」（CC0、OpenGameArt）。出だしの無音を削り、長さと大きさをそろえてある
// 同じ音の繰り返しに聞こえないよう、高さと大きさをほんの少し揺らす。読み込めないときは合成した音で鳴らす
const KEY_SAMPLES = {
  key: Array.from({ length: 10 }, (_, i) => `key-${i + 1}`),
  space: ['space-1', 'space-2'],
};
const KEY_GAIN = 0.6;
let keyBuffers = null; // { key: [AudioBuffer], space: [AudioBuffer] }

// ページを開いたら、音を鳴らす準備とは別に、先に読み込んでおく（一打目から録音の音で鳴らせるように）
export const keySamplesReady = (async () => {
  try {
    const decoder = new OfflineAudioContext(1, 1, 48000);
    const entries = await Promise.all(
      Object.entries(KEY_SAMPLES).map(async ([kind, names]) => {
        const buffers = await Promise.all(
          names.map(async (name) => {
            const res = await fetch(new URL(`../sounds/keys/${name}.wav`, import.meta.url));
            return decoder.decodeAudioData(await res.arrayBuffer());
          }),
        );
        return [kind, buffers];
      }),
    );
    keyBuffers = Object.fromEntries(entries);
  } catch {
    keyBuffers = null;
  }
})();

// 押したキーから、どの音を使うか
function keyKind(key) {
  if (key === ' ') return 'space';
  if (key === 'Enter') return 'enter';
  if (key === 'Backspace' || key === 'Delete') return 'backspace';
  return 'key';
}

// tickAt は、録音用に別の AudioContext でも鳴らせるようにしたもの
export function tickAt(ac, t, key = '', out = ac.destination) {
  const kind = keyKind(key);
  if (!keyBuffers) return synthTickAt(ac, t, out);
  const list = kind === 'space' || kind === 'enter' ? keyBuffers.space : keyBuffers.key;
  const src = ac.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  const pitch = kind === 'enter' ? 0.88 : kind === 'backspace' ? 0.94 : 1;
  src.playbackRate.value = pitch * (0.97 + Math.random() * 0.06);
  const gain = ac.createGain();
  gain.gain.value = KEY_GAIN * (0.85 + Math.random() * 0.25);
  src.connect(gain).connect(out);
  src.start(t);
}

export function tick(key = '') {
  const ac = audio();
  tickAt(ac, ac.currentTime, key);
}

// 読み込めなかったときの打鍵音：硯に筆を置くような、乾いた音を合成する
function synthTickAt(ac, t, out) {
  const len = Math.floor(ac.sampleRate * 0.03);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;

  const src = ac.createBufferSource();
  src.buffer = buf;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1400 + Math.random() * 400;
  band.Q.value = 1.2;
  const gain = ac.createGain();
  gain.gain.value = 1.1;
  src.connect(band).connect(gain).connect(out);
  src.start(t);
}

// 間違えたときの音：木魚を軽く打ったような、乾いた「ポク」
// キーボードを見ながら打っていても、朱の字に耳で気づけるように。打鍵音とは高さも長さも違えてある
// 驚かせないよう、大きさは打鍵音とほぼ同じにし、出だしを少し柔らかくしてある
// missAt は、録音用に別の AudioContext でも鳴らせるようにしたもの
export function missAt(ac, t, out = ac.destination) {
  // 胴の鳴り：少し高めから下がる、短い木の響き。上の倍音は早く消える
  for (const [freq, amp, decay] of [[430, 0.24, 0.18], [1000, 0.05, 0.06]]) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.frequency.setValueAtTime(freq * 1.15, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }
  // 撥（ばち）が当たった瞬間
  const len = Math.floor(ac.sampleRate * 0.008);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 900;
  band.Q.value = 1.4;
  const g = ac.createGain();
  g.gain.value = 0.12;
  src.connect(band).connect(g).connect(out);
  src.start(t);
}

// 続けて間違えても、鳴りすぎないように間をあける
let lastMiss = -Infinity;
export function miss() {
  const now = performance.now();
  if (now - lastMiss < 90) return;
  lastMiss = now;
  const ac = audio();
  missAt(ac, ac.currentTime);
}

// 書き上げて納めたときの音：おりん（仏壇の鈴）
// 御朱印が紙に押される瞬間（約 0.55 秒後）に、りん棒で打った当たりと、うなりながら長く残る響きを鳴らす
// 倍音の並びは金属の椀の鳴り方に近い比率。倍音ごとにごく近い二つの高さを重ねて「うなり」を作る
const ORIN_F0 = 400;
const ORIN_PARTIALS = [
  // [基音に対する倍率, 音量, 減衰（秒）, うなり（Hz）]
  [1, 0.26, 13.5, 1.54],
  [2.71, 0.13, 8.6, 2.66],
  [5.12, 0.06, 5.0, 3.78],
  [8.27, 0.03, 2.9, 5.04],
  [12.1, 0.012, 1.4, 0],
];

export function stamp() {
  const ac = audio();
  const t = ac.currentTime + 0.55;

  // 打った瞬間：高い金属の当たりと、中ほどの「キン」
  const len = Math.floor(ac.sampleRate * 0.012);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  for (const [type, freq, q, level] of [['highpass', 3500, 1, 0.22], ['bandpass', 2400, 2.5, 0.35]]) {
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ac.createGain();
    g.gain.value = level;
    src.connect(filter).connect(g).connect(ac.destination);
    src.start(t);
  }

  for (const [ratio, amp, decay, beat] of ORIN_PARTIALS) {
    for (const side of [-0.5, 0.5]) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.frequency.value = ORIN_F0 * ratio + side * beat;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp / 2, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(ac.destination);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    }
  }
}

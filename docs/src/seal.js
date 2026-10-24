// 御朱印。shakyo（../shakyo/public/src/seal.js）から写し、一冊を書き上げたときに使う

const DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function kanjiNumber(n) {
  if (n < 10) return DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? '' : DIGITS[tens]}十${ones ? DIGITS[ones] : ''}`;
}

export function wafuDate(d) {
  const reiwa = d.getFullYear() - 2018;
  return `令和${kanjiNumber(reiwa)}年${kanjiNumber(d.getMonth() + 1)}月${kanjiNumber(d.getDate())}日`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// 朱印：白抜きの四字印「写経之印」。縁を少し荒らして、押した感じを出す
// 一つのページに何個並べてもよいように、フィルタの id を印ごとに分ける
let sealCount = 0;
export function sealSvg(className = 'seal-mark') {
  const id = `seal-rough-${++sealCount}`;
  return `
<svg class="${className}" viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <filter id="${id}" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${sealCount * 7}" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2"/>
    </filter>
  </defs>
  <g filter="url(#${id})">
    <rect x="6" y="6" width="108" height="108" rx="6" fill="var(--shu)"/>
    <rect x="13" y="13" width="94" height="94" rx="3" fill="none" stroke="var(--seal-text)" stroke-width="2.4"/>
    <g fill="var(--seal-text)" font-family="'Shippori Mincho', serif" font-weight="700" font-size="38" text-anchor="middle">
      <text x="83" y="55">写</text>
      <text x="83" y="98">経</text>
      <text x="37" y="55">之</text>
      <text x="37" y="98">印</text>
    </g>
  </g>
</svg>`;
}

// 御朱印の紙（縦書きの題・奉納・日付と、朱印）
// 題は縦一行に収まるよう、字数に合わせて小さくする
export function sealSheet({ title, small, date = new Date() }) {
  const size = Math.min(66, Math.floor(300 / ([...title].length * 1.32)));
  return `
<div class="seal-sheet">
  <p class="seal-houno">奉納</p>
  <p class="seal-title" style="font-size: ${size}px">${escapeHtml(title)}</p>
  <p class="seal-date">${wafuDate(date)}</p>
  ${small ? `<div class="seal-small" aria-hidden="true"><span>${escapeHtml(small)}</span></div>` : ''}
  ${sealSvg()}
</div>`;
}

// 御朱印を押す画面。info: { title, small, eyebrow, message, stats }
// actions: [{ label, href?, onClick?, primary? }] 閉じる以外に並べるボタン
export function showSeal(info, { onClose, actions = [] } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'seal-overlay';
  overlay.innerHTML = `
<div class="seal-page" role="dialog" aria-label="御朱印">
  ${sealSheet(info)}
  <div class="seal-caption">
    <p class="seal-eyebrow">${escapeHtml(info.eyebrow ?? '書き上げ')}</p>
    <p class="seal-message"></p>
    <p class="seal-stats"></p>
    <div class="seal-actions"></div>
  </div>
</div>`;
  overlay.querySelector('.seal-message').textContent = info.message;
  overlay.querySelector('.seal-stats').textContent = info.stats ?? '';
  document.body.append(overlay);

  const close = () => {
    overlay.classList.add('is-leaving');
    setTimeout(() => {
      overlay.remove();
      onClose?.();
    }, 400);
  };

  const bar = overlay.querySelector('.seal-actions');
  for (const action of actions) {
    const node = document.createElement(action.href ? 'a' : 'button');
    node.className = action.primary ? 'btn-ink' : 'btn-line';
    node.textContent = action.label;
    if (action.href) node.href = action.href;
    else {
      node.type = 'button';
      node.addEventListener('click', () => {
        action.onClick?.();
        close();
      });
    }
    bar.append(node);
  }
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'text-btn seal-close';
  closeBtn.textContent = '閉じる';
  closeBtn.addEventListener('click', close);
  bar.append(closeBtn);

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    (bar.querySelector('.btn-ink') ?? closeBtn).focus({ preventScroll: true });
  });
}

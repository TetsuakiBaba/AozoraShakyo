import { load, save } from './store.js';

// ire: yomi（読みで打つ）| kasane（変換して升目に重ねる）| fuda（変換して右脇の札）
// romaji（運筆図で案内する綴り。受け付けはどちらも同じ）: hepburn | kunrei
// font: mincho | gothic ／ theme: washi | yoru ／ keyboard: jis | us
// unpitsu（運筆図の置き場所。写経の画面の右の欄で選ぶ）: side | below | cursor | off
export const settings = load('settings', {
  ire: 'yomi',
  romaji: 'hepburn',
  font: 'mincho',
  theme: 'washi',
  unpitsu: 'side',
  tickSound: false,
  keyboard: 'jis',
});

// 入れ方の標準を「読みで打つ」に変えた（2026-10-24）。それより前に保存した設定も、一度だけそろえる
if (settings.version !== 2) {
  settings.ire = 'yomi';
  settings.version = 2;
}

// 運筆図が「出す／出さない」だったころの設定は、置き場所に読み替える
if (settings.unpitsu === 'on') settings.unpitsu = 'side';

const BOOLEAN_KEYS = new Set(['tickSound']);

const PANEL_HTML = `
<div class="setting">
  <p class="setting-label">入れ方</p>
  <div class="seg">
    <button type="button" data-setting="ire" data-value="yomi">
      <span class="seg-main">読みで打つ</span><span class="seg-sub">日本語入力はオフ・ローマ字</span>
    </button>
    <button type="button" data-setting="ire" data-value="kasane">
      <span class="seg-main">変換して書く</span><span class="seg-sub">升目に重ねる</span>
    </button>
    <button type="button" data-setting="ire" data-value="fuda">
      <span class="seg-main">変換して書く</span><span class="seg-sub">右脇の札に出す</span>
    </button>
  </div>
</div>
<div class="setting">
  <p class="setting-label">ローマ字（運筆図で案内する綴り）</p>
  <div class="seg seg-2">
    <button type="button" data-setting="romaji" data-value="hepburn">
      <span class="seg-main">ヘボン式</span><span class="seg-sub">shi・tsu</span>
    </button>
    <button type="button" data-setting="romaji" data-value="kunrei">
      <span class="seg-main">訓令式</span><span class="seg-sub">si・tu</span>
    </button>
  </div>
  <p class="settings-note setting-aside">どちらの綴りで打っても通ります。</p>
</div>
<div class="setting">
  <p class="setting-label">書体</p>
  <div class="seg seg-2">
    <button type="button" data-setting="font" data-value="mincho"><span class="seg-main">明朝</span></button>
    <button type="button" data-setting="font" data-value="gothic"><span class="seg-main">ゴシック</span></button>
  </div>
</div>
<div class="setting">
  <p class="setting-label">紙</p>
  <div class="seg seg-2">
    <button type="button" data-setting="theme" data-value="washi"><span class="seg-main">和紙</span></button>
    <button type="button" data-setting="theme" data-value="yoru"><span class="seg-main">夜</span></button>
  </div>
</div>
<div class="setting">
  <p class="setting-label">キーボード</p>
  <div class="seg seg-2">
    <button type="button" data-setting="keyboard" data-value="jis"><span class="seg-main">JIS（日本語）</span></button>
    <button type="button" data-setting="keyboard" data-value="us"><span class="seg-main">US（英語）</span></button>
  </div>
</div>
<div class="setting">
  <p class="setting-label">打鍵音</p>
  <div class="seg seg-2">
    <button type="button" data-setting="tickSound" data-value="true"><span class="seg-main">鳴らす</span></button>
    <button type="button" data-setting="tickSound" data-value="false"><span class="seg-main">鳴らさない</span></button>
  </div>
</div>`;

export function applySettings() {
  const root = document.documentElement;
  root.dataset.font = settings.font;
  root.dataset.theme = settings.theme;
  document.querySelectorAll('[data-setting]').forEach((btn) => {
    const current = String(settings[btn.dataset.setting]);
    btn.setAttribute('aria-pressed', String(current === btn.dataset.value));
  });
  save('settings', settings);
}

// 設定パネルの外に置いたボタン（data-setting）を、設定につなぐ
export function bindSettingButtons(container, onChange) {
  container.querySelectorAll('[data-setting]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.setting;
      settings[key] = BOOLEAN_KEYS.has(key) ? btn.dataset.value === 'true' : btn.dataset.value;
      applySettings();
      onChange?.(key);
    });
  });
}

// 画面の操作からではなく、プログラムの側で設定を変える（キーボード配列の自動の見分けなど）
export function updateSetting(key, value) {
  settings[key] = value;
  applySettings();
}

// 設定ボタンに、開閉する設定パネルをつなぐ。onChange(key) は値が変わったときに呼ばれる
export function mountSettings(button, onChange) {
  const panel = document.createElement('div');
  panel.className = 'settings';
  panel.id = 'settings';
  panel.hidden = true;
  panel.innerHTML = PANEL_HTML;
  document.body.append(panel);
  button.setAttribute('aria-controls', 'settings');
  button.setAttribute('aria-expanded', 'false');

  const setOpen = (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !button.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  bindSettingButtons(panel, onChange);
  applySettings();
}

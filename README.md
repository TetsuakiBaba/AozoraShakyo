# 青空写経 — aozora shakyo

青空文庫の名作を、薄墨で刷られた縦書きの原稿用紙に一字ずつなぞって書き写す Web ページ。プログラミング写経 [写経](https://shakyo-4lc.pages.dev/) から派生した。

公開：https://tetsuakibaba.github.io/AozoraShakyo/

1. **導入**：このページの紹介と進め方。初めて開いたときに、打鍵音を鳴らすかどうかを選ぶ。
2. **本を選ぶ**：書棚から一冊。章のある本は章ごとに書き進められる。
3. **写経**：原稿用紙の薄墨をなぞる。入れ方は二つ。
   - 読みで打つ（標準）：日本語入力をオフにして、漢字に添えた読みをローマ字で打つ。
   - 変換して書く：かなで打って変換すると、変換中の字が手本の上に重なる。
4. **納める**：一冊を書き上げたら、名前と番号（任意）を添えて、書いた記録を JSON か JSONL で書き出す。

計画と設計の詳細は [PLAN.md](PLAN.md)。

## 手元で動かす

Python 3 だけで動きます（npm やビルドは不要）。

```bash
python3 serve.py          # http://localhost:5174
python3 serve.py 8000     # ポートを変えるとき
```

入力のイベント（IME の変換中・確定など）を見るときは、写経の画面の URL に `&debug` をつけます。

## 本を足す・取り込み直す

`tools/aozora.py` の `BOOKS` に青空文庫の XHTML の URL を足して、次を実行します。読みを出すのに macOS の日本語の解析（Swift）を使うので、macOS で実行してください。

```bash
python3 tools/aozora.py   # → docs/src/texts.js
```

漢字の読みが違っていたら、`tools/aozora.py` の `YOMI_FIXES` に（前後の字, 直す語, 読み）を足して、取り込み直します。

| 場所 | 中身 |
|---|---|
| `docs/` | 公開するサイト（`index.html` 導入と書棚、`shakyo.html` 写経、`osame.html` 納める） |
| `docs/src/` | JS と CSS。`texts.js` は取り込んだ本文（手で書き換えない） |
| `tools/` | 青空文庫の本文と読みの取り込み |
| `serve.py` | 手元で確かめるためのサーバ |

## 公開

GitHub Pages で、main ブランチの `docs/` をそのまま配っています。main に push すると、しばらくして公開し直されます。ビルドの手順はありません（`docs/.nojekyll` で Jekyll の処理を止めています）。

SNS で共有されたときの画像（OGP）は `docs/ogp.png`。もとは `tools/ogp.html` で、Chrome で 1200×630 の大きさに開いて撮り直します。

## 使っているもの

- 本文：[青空文庫](https://www.aozora.gr.jp/)（底本と入力・校正の方は、写経の画面に載せている）
- 読み：青空文庫のルビと、macOS の日本語の解析（CFStringTokenizer）
- 書体：Google Fonts（Shippori Mincho / Zen Kaku Gothic New / Yuji Syuku）
- 打鍵音：unicaegames「[Keyboard Soundpack #1](https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes)」（CC0）。shakyo から

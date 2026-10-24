"""青空文庫の XHTML から本文を取り出し、写経用のデータ（docs/src/texts.js）に書き出す。

    python3 tools/aozora.py

Python 3 の標準機能と、macOS に入っている日本語の解析（tools/yomi.swift）だけで動く。実行時に青空文庫へ取りに行くことはしない（Shift_JIS で、
ほかのサイトからは読めないため）ので、取り込む本はここで前処理しておく。

本文は段落ごとに次の形にする。
    { text, indent, ruby: [[start, end, 読み], ...], yomi: [[start, end, 読み], ...], dots: [[start, end], ...], align }
  text   打つ字（段落頭の字下げの全角空白は含めず、indent に字数で持つ）
  ruby   text の [start, end) に添える読み（青空文庫のルビ）
  yomi   漢字を含む語の読み（ひらがな）。「読みで打つ」で使う。送りがなは分け、ルビのある語はルビの読みにする
  dots   傍点をつける範囲
  align  'end' なら地付き（行の下に寄せる）
空行は text が空の段落。見出しが来たら、そこから新しい章にする。
"""

import html
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "src" / "texts.js"

BOOKS = [
    {
        "id": "melos",
        "url": "https://www.aozora.gr.jp/cards/000035/files/1567_14913.html",
        "card": "https://www.aozora.gr.jp/cards/000035/card1567.html",
    },
    {
        "id": "chumon",
        "url": "https://www.aozora.gr.jp/cards/000081/files/43754_17659.html",
        "card": "https://www.aozora.gr.jp/cards/000081/card43754.html",
    },
    {
        "id": "gon",
        "url": "https://www.aozora.gr.jp/cards/000121/files/628_14895.html",
        "card": "https://www.aozora.gr.jp/cards/000121/card628.html",
    },
]

# 読みの直し。macOS の解析が読み違えた語を、前後の字ごと指定して直す（本の id → [(前後の字, 直す語, 読み), ...]）
# 前後の字で場所を絞るのは、同じ字でも語によって読みが変わるため（「用心深かった」なら「ぶか」が正しい）
YOMI_FIXES = {
    "melos": [
        ("間近か", "間近", "まぢ"),  # 送りがなの「か」を書いた表記。解析は「まぢか」と読み、か が二重になる
        ("身近か", "身近", "みぢ"),  # 同上
        ("ように深かった", "深", "ふか"),  # 解析は「ぶかかっ」と読む
        ("情無い", "情", "なさけ"),  # 解析は「じょう」と読む
    ],
}

RUBY = re.compile(r"<ruby><rb>(.*?)</rb><rp>.*?</rp><rt>(.*?)</rt><rp>.*?</rp></ruby>", re.S)
DOTS = re.compile(r'<em class="sesame_dot">(.*?)</em>', re.S)
GAIJI = re.compile(r'<img [^>]*class="gaiji"[^>]*/>')
HEADING = re.compile(r"<h[3-5][^>]*>(.*?)</h[3-5]>", re.S)
TAG = re.compile(r"<[^>]+>")
KANJI = "\u3400-\u9fff\uf900-\ufaff々〆ヶ〇"
HAS_KANJI = re.compile(f"[{KANJI}]")


def fetch(url):
    with urllib.request.urlopen(url) as res:
        return res.read().decode("cp932", errors="replace")


def plain(fragment):
    return html.unescape(TAG.sub("", fragment))


def parse_line(line):
    """一行（段落）の XHTML を、打つ字とルビ・傍点の範囲に分ける"""
    line = line.replace("\r", "").replace("\n", "")
    align = "end" if "chitsuki" in line else None
    text = ""
    ruby = []
    dots = []
    pos = 0
    # ルビと傍点を先に見つけ、そのほかのタグは捨てる
    pattern = re.compile(f"{RUBY.pattern}|{DOTS.pattern}|{GAIJI.pattern}", re.S)
    for m in pattern.finditer(line):
        text += plain(line[pos : m.start()])
        if m.group(1) is not None:
            base = plain(m.group(1))
            ruby.append([len(text), len(text) + len(base), plain(m.group(2))])
            text += base
        elif m.group(3) is not None:
            inner = plain(m.group(3))
            dots.append([len(text), len(text) + len(inner)])
            text += inner
        else:
            # 外字は今回の本にはない。来たら目印の字にして、あとで扱いを決める
            text += "〓"
        pos = m.end()
    text += plain(line[pos:])

    indent = len(text) - len(text.lstrip("　"))
    shift = indent
    text = text[indent:]
    ruby = [[s - shift, e - shift, r] for s, e, r in ruby]
    dots = [[s - shift, e - shift] for s, e in dots]
    para = {"text": text, "indent": indent}
    if ruby:
        para["ruby"] = ruby
    if dots:
        para["dots"] = dots
    if align:
        para["align"] = align
    return para


def parse(source, book):
    title = plain(re.search(r'<h1 class="title">(.*?)</h1>', source, re.S).group(1))
    author = plain(re.search(r'<h2 class="author">(.*?)</h2>', source, re.S).group(1))
    main = re.search(r'<div class="main_text">(.*?)<div class="bibliographical_information">', source, re.S).group(1)
    biblio = re.search(r'<div class="bibliographical_information">(.*?)</div>', source, re.S).group(1)

    sections = [{"title": "", "paras": []}]
    for line in re.split(r"<br />", main):
        heading = HEADING.search(line)
        if heading:
            if sections[-1]["paras"] or sections[-1]["title"]:
                sections.append({"title": "", "paras": []})
            sections[-1]["title"] = plain(heading.group(1)).strip()
            continue
        sections[-1]["paras"].append(parse_line(line))

    # 章の頭と終わりの空行は落とす
    for section in sections:
        paras = section["paras"]
        while paras and not paras[0]["text"]:
            paras.pop(0)
        while paras and not paras[-1]["text"]:
            paras.pop()
    sections = [s for s in sections if s["paras"]]

    # 書誌は「底本」から「校正」まで（公開日などは除く）
    credit = []
    for line in re.split(r"<br />", biblio):
        line = plain(line).strip()
        if not line or line.startswith("青空文庫作成ファイル"):
            if credit:
                break
            continue
        credit.append(line)
    credit = [c for c in credit if not re.match(r"\d{4}年\d+月\d+日(公開|修正|作成)", c)]

    return {
        "id": book["id"],
        "title": title,
        "author": author,
        "card": book["card"],
        "credit": credit,
        "sections": sections,
    }


def hira(text):
    """カタカナをひらがなにする"""
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in text)


def tokenize(texts):
    """tools/yomi.swift で、文章ごとに [(start, end, 読み), ...] を出す（位置は Python の字で数える）"""
    out = subprocess.run(
        ["swift", str(ROOT / "tools" / "yomi.swift")],
        input=json.dumps(texts).encode(),
        capture_output=True,
        check=True,
    ).stdout
    result = []
    for text, tokens in zip(texts, json.loads(out)):
        # UTF-16 の位置を、Python の字の位置に直す
        index = []
        for i, c in enumerate(text):
            index.extend([i] * (2 if ord(c) > 0xFFFF else 1))
        index.append(len(text))
        result.append([(index[a], index[a + n], kana) for a, n, kana in tokens])
    return result


def split_okurigana(start, surface, reading):
    """「除か／のぞか」→ 除＝のぞ。漢字のかたまりごとに読みを分ける。分けられなければ語全体で一つ"""
    runs = re.findall(f"[{KANJI}]+|[^{KANJI}]+", surface)
    pattern = "".join("(.+?)" if HAS_KANJI.match(r) else re.escape(hira(r)) for r in runs)
    m = re.fullmatch(pattern, reading)
    if not m:
        return [(start, start + len(surface), reading)]
    units = []
    pos = start
    groups = iter(m.groups())
    for r in runs:
        if HAS_KANJI.match(r):
            units.append((pos, pos + len(r), next(groups)))
        pos += len(r)
    return units


def override(units, s, e, reading):
    """[s, e) の読みを reading にする。重なった語のはみ出した分は、読みを字数で分けて残す"""
    kept = []
    for a, b, kana in units:
        if b <= s or a >= e:
            kept.append((a, b, kana))
            continue
        n = b - a
        if a < s:
            kept.append((a, s, kana[: round(len(kana) * (s - a) / n)]))
        if b > e:
            kept.append((e, b, kana[round(len(kana) * (e - a) / n) :]))
    return kept + [(s, e, reading)]


def add_yomi(books):
    paras = [(b["id"], p) for b in books for s in b["sections"] for p in s["paras"] if HAS_KANJI.search(p["text"])]
    fixed = set()
    for (book_id, p), tokens in zip(paras, tokenize([p["text"] for _, p in paras])):
        units = []
        for a, b, kana in tokens:
            surface = p["text"][a:b]
            if HAS_KANJI.search(surface):
                units.extend(split_okurigana(a, surface, hira(kana)))
        # ルビのある語は、ルビの読みにする
        for s, e, r in p.get("ruby", []):
            units = override(units, s, e, hira(r))
        # 読みの直し
        for context, word, reading in YOMI_FIXES.get(book_id, []):
            for m in re.finditer(re.escape(context), p["text"]):
                s = m.start() + context.index(word)
                units = override(units, s, s + len(word), reading)
                fixed.add((book_id, context))
        units = sorted(u for u in units if HAS_KANJI.search(p["text"][u[0] : u[1]]) and u[2])
        p["yomi"] = [list(u) for u in units]
    for book_id, fixes in YOMI_FIXES.items():
        for context, _, _ in fixes:
            if (book_id, context) not in fixed:
                print(f"読みの直し「{context}」が本文に見つかりません（{book_id}）", file=sys.stderr)


def main():
    books = []
    for book in BOOKS:
        data = parse(fetch(book["url"]), book)
        chars = sum(len(p["text"]) for s in data["sections"] for p in s["paras"])
        print(f"{data['author']}『{data['title']}』 {len(data['sections'])}章 {chars}字", file=sys.stderr)
        books.append(data)

    add_yomi(books)
    body = json.dumps(books, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "// tools/aozora.py が青空文庫の本文から書き出したもの。手で書き換えない\n"
        f"export const BOOKS = {body};\n",
        encoding="utf-8",
    )
    print(f"→ {OUT.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()

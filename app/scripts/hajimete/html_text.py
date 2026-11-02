"""自治体の案内ページ（HTML）を文字にする（手元だけ。リポジトリには入れない）。

使い方: python3 html_text.py <入力 .html> <出力 .txt>
- 全体を =====p1===== とする（HTML にはページの区切りが無い）
- script・style・ナビ・ヘッダ・フッタは外す。<main> か本文らしい箱があれば、その中だけを使う
- 文字コードは meta の charset を見る（Shift_JIS の自治体サイトが多い）
最後の行に「ページ数 N」を出す（文字が少なすぎれば 0）。
外部の通信はしない。標準ライブラリだけ使う。
"""
import re
import sys
import unicodedata
from html.parser import HTMLParser

外す = {"script", "style", "noscript", "nav", "header", "footer", "aside", "form", "svg", "template", "iframe"}
区切る = {
    "p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "dt", "dd",
    "section", "article", "table", "ul", "ol", "dl", "blockquote", "pre", "hr", "main",
}
本文の箱 = re.compile(r"^(main|contents?|main[-_]?contents?|tmp_contents|article|page[-_]?body|honbun|mainArea|content[-_]?main)$", re.I)


def 読み込む(src):
    raw = open(src, "rb").read()
    head = raw[:4096].decode("ascii", "ignore")
    m = re.search(r"charset=[\"']?([A-Za-z0-9_\-]+)", head, re.I)
    候補 = []
    if m:
        c = m.group(1).lower()
        候補.append("cp932" if c in ("shift_jis", "shift-jis", "sjis", "x-sjis", "windows-31j") else c)
    候補 += ["utf-8", "cp932", "euc_jp"]
    for c in 候補:
        try:
            return raw.decode(c)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "replace")


class 抜く(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.外す深さ = 0
        self.箱の深さ = []  # 本文の箱に入ったときのタグの深さ
        self.深さ = 0
        self.全体 = []
        self.箱 = []
        self.title = ""
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in ("br", "hr", "img", "meta", "link", "input"):
            if tag in ("br", "hr"):
                self._足す("\n")
            if tag == "img" and not self.外す深さ:
                alt = dict(attrs).get("alt") or ""
                if alt.strip():
                    self._足す(alt.strip())
            return
        self.深さ += 1
        if tag == "title":
            self.in_title = True
        if tag in 外す or self.外す深さ:
            self.外す深さ += 1
            return
        a = dict(attrs)
        if tag == "main" or 本文の箱.match(a.get("id") or "") or tag == "article":
            self.箱の深さ.append(self.深さ)
        if tag in 区切る:
            self._足す("\n")

    def handle_endtag(self, tag):
        if tag in ("br", "hr", "img", "meta", "link", "input"):
            return
        if tag == "title":
            self.in_title = False
        if self.外す深さ:
            self.外す深さ -= 1
        elif tag in 区切る:
            self._足す("\n")
        if self.箱の深さ and self.箱の深さ[-1] == self.深さ:
            self.箱の深さ.pop()
        self.深さ = max(0, self.深さ - 1)

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.外す深さ:
            return
        self._足す(data)

    def _足す(self, s):
        self.全体.append(s)
        if self.箱の深さ:
            self.箱.append(s)


def 整える(parts):
    text = "".join(parts)
    text = unicodedata.normalize("NFC", text)
    lines = [re.sub(r"[ \t　\xa0]+", " ", l).strip() for l in text.split("\n")]
    out = []
    for l in lines:
        if not l and (not out or not out[-1]):
            continue
        out.append(l)
    return "\n".join(out).strip()


def main():
    src, dst = sys.argv[1], sys.argv[2]
    p = 抜く()
    p.feed(読み込む(src))
    p.close()
    箱 = 整える(p.箱)
    全体 = 整える(p.全体)
    本文 = 箱 if len(箱) >= 200 else 全体
    if len(本文) < 50:
        print("ページ数 0")
        return
    with open(dst, "w", encoding="utf-8") as f:
        f.write("=====p1=====\n")
        if p.title.strip():
            f.write(f"【ページの題名：{整える([p.title])}】\n")
        f.write(本文 + "\n")
    print("ページ数 1")


if __name__ == "__main__":
    main()

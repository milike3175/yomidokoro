"""手引き・記載例・様式を文字にする（手元だけ。リポジトリには入れない）。

使い方: python3 to_text.py <入力ファイル> <出力 .txt>
- PDF  : ページごとに =====pN===== で区切る（N は物理ページ）
- Word : textutil（macOS）で文字にし、全体を =====p1===== とする（Word にはページの区切りが無い）
- Excel: シートごとに =====pN===== で区切る（N はシートの順番）
最後の行に「ページ数 N」を出す。
"""
import subprocess
import sys
import unicodedata


def pdf(src):
    import fitz  # pymupdf

    pages = []
    with fitz.open(src) as d:
        for i, p in enumerate(d, start=1):
            pages.append((i, p.get_text("text")))
    return pages


def word(src):
    out = subprocess.run(["textutil", "-convert", "txt", "-stdout", src], capture_output=True, check=True)
    return [(1, out.stdout.decode("utf-8", "replace"))]


def excel(src):
    import openpyxl

    wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
    pages = []
    for i, ws in enumerate(wb.worksheets, start=1):
        lines = [f"【シート：{ws.title}】"]
        for row in ws.iter_rows(values_only=True):
            cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
            if cells:
                lines.append("　".join(cells))
        pages.append((i, "\n".join(lines)))
    return pages


def main():
    src, dst = sys.argv[1], sys.argv[2]
    low = src.lower()
    if low.endswith(".pdf"):
        pages = pdf(src)
    elif low.endswith((".doc", ".docx", ".rtf")):
        pages = word(src)
    elif low.endswith(".xlsx"):
        pages = excel(src)
    else:
        print("ページ数 0")
        return
    with open(dst, "w", encoding="utf-8") as f:
        for n, t in pages:
            f.write(f"=====p{n}=====\n")
            f.write(unicodedata.normalize("NFC", t).rstrip() + "\n")
    print(f"ページ数 {len(pages)}")


if __name__ == "__main__":
    main()

// 手引きや記載例の PDF をページごとの文字にする（PDFKit。pymupdf が無くても動く）。ページの頭に =====pN===== を置く（scripts/tebiki/to_text.py と同じ印）。
// 使い方：swiftc -O pdftext.swift -o <置き場>/pdftext ; <置き場>/pdftext <PDF> <書き出す .txt>

import Foundation
import PDFKit
let a=CommandLine.arguments; let d=PDFDocument(url:URL(fileURLWithPath:a[1]))!
var out=""
for i in 0..<d.pageCount { out += "=====p\(i+1)=====\n" + (d.page(at:i)!.string ?? "") + "\n" }
try! out.write(toFile:a[2], atomically:true, encoding:.utf8)
print(d.pageCount)

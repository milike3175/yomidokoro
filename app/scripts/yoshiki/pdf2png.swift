// 試しの下書きを LibreOffice で PDF にしたあと、ページごとの画像にする（崩れを目で見るため）。
// 使い方：swiftc -O pdf2png.swift -o <置き場>/pdf2png ; <置き場>/pdf2png <PDF> <書き出すフォルダ> [倍率]

import Foundation
import PDFKit
import AppKit
let a=CommandLine.arguments; let doc=PDFDocument(url:URL(fileURLWithPath:a[1]))!
let outDir=a[2]; let scale:CGFloat=CGFloat(Double(a.count>3 ? a[3] : "1.6")!)
for i in 0..<doc.pageCount { let p=doc.page(at:i)!; let r=p.bounds(for:.mediaBox)
 let img=NSImage(size:NSSize(width:r.width*scale,height:r.height*scale)); img.lockFocus()
 NSColor.white.set(); NSRect(x:0,y:0,width:r.width*scale,height:r.height*scale).fill()
 let ctx=NSGraphicsContext.current!.cgContext; ctx.scaleBy(x:scale,y:scale); p.draw(with:.mediaBox,to:ctx); img.unlockFocus()
 let rep=NSBitmapImageRep(data:img.tiffRepresentation!)!; try! rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"\(outDir)/p\(i+1).png")) }
print(doc.pageCount)

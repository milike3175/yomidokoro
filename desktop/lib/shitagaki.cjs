// 申請書の下書き（docx・xlsx）を、このパソコンの「書類」フォルダの よみどころ_下書き/ に置く。
// 置き場：Windows はドキュメント\よみどころ_下書き、Mac は 書類/よみどころ_下書き
// 画面から来たファイル名は信用しない。フォルダの外を指せないよう、名前だけを取り出して使う。上書きしない。
// 中身は記録（launch-log.txt）にも書かない。
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const 上限 = 30 * 1024 * 1024;

function 下書きの置き場(documents) {
  const d = path.join(documents, "よみどころ_下書き");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function 名前を整える(名) {
  let n = path.basename(String(名 ?? "")).normalize("NFC");
  n = n.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").replace(/[. ]+$/, "").trim();
  if (!n) return null;
  if (!/\.(docx|xlsx)$/i.test(n)) n += ".docx";
  const 拡 = n.slice(-5);
  if (n.length > 120) n = n.slice(0, 115) + 拡;
  return n;
}

function 空いた名前(d, n) {
  if (!fs.existsSync(path.join(d, n))) return n;
  const 拡 = n.slice(-5);
  const 元 = n.slice(0, -5);
  for (let i = 2; i < 1000; i++) {
    const c = `${元}_${i}${拡}`;
    if (!fs.existsSync(path.join(d, c))) return c;
  }
  return null;
}

function 下書きを保存(documents, 名, バイト) {
  if (!(バイト instanceof Uint8Array) || バイト.length === 0 || バイト.length > 上限) return { ok: false, 理由: "下書きの中身が正しくありません" };
  // docx は zip。頭が PK でなければ置かない
  if (バイト[0] !== 0x50 || バイト[1] !== 0x4b) return { ok: false, 理由: "docx ではありません" };
  const d = 下書きの置き場(documents);
  const n0 = 名前を整える(名);
  const n = n0 && 空いた名前(d, n0);
  if (!n) return { ok: false, 理由: "ファイル名を決められませんでした" };
  fs.writeFileSync(path.join(d, n), Buffer.from(バイト));
  return { ok: true, ファイル名: n, 置き場: d };
}

module.exports = { 下書きの置き場, 下書きを保存, 名前を整える };

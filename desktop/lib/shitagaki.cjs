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

/** フォルダ名を整える（名前だけ。拡張子は付けない。空なら null） */
function フォルダ名を整える(名) {
  let n = path.basename(String(名 ?? "")).normalize("NFC");
  n = n.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").replace(/[. ]+$/, "").trim();
  if (!n || n === "." || n === "..") return null;
  return n.length > 60 ? n.slice(0, 60) : n;
}

/**
 * 保存する。小分け は置き場の下のフォルダ（例：["和歌山環境サービス株式会社_新規", "京都府"]）。
 * 画面から来た名前は信用せず、名前だけを取り出して使う（置き場の外を指せない）
 */
function 下書きを保存(documents, 名, バイト, 小分け) {
  if (!(バイト instanceof Uint8Array) || バイト.length === 0 || バイト.length > 上限) return { ok: false, 理由: "下書きの中身が正しくありません" };
  // docx は zip。頭が PK でなければ置かない
  if (バイト[0] !== 0x50 || バイト[1] !== 0x4b) return { ok: false, 理由: "docx ではありません" };
  const 根 = 下書きの置き場(documents);
  let d = 根;
  let 親 = 根;
  if (Array.isArray(小分け)) {
    const 段 = 小分け.slice(0, 2).map(フォルダ名を整える).filter(Boolean);
    if (段.length) {
      親 = path.join(根, 段[0]);
      d = path.join(根, ...段);
      fs.mkdirSync(d, { recursive: true });
    }
  }
  const n0 = 名前を整える(名);
  const n = n0 && 空いた名前(d, n0);
  if (!n) return { ok: false, 理由: "ファイル名を決められませんでした" };
  fs.writeFileSync(path.join(d, n), Buffer.from(バイト));
  return { ok: true, ファイル名: n, 置き場: d, 親 };
}

/** 置き場の中のフォルダか（開くときの確かめ）。外なら置き場そのもの */
function 置き場の中(documents, 場所) {
  const 根 = 下書きの置き場(documents);
  if (typeof 場所 !== "string" || !場所) return 根;
  const r = path.resolve(場所);
  if (r === 根 || r.startsWith(根 + path.sep)) return fs.existsSync(r) ? r : 根;
  return 根;
}

module.exports = { 下書きの置き場, 下書きを保存, 名前を整える, 置き場の中 };

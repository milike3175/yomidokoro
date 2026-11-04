// 事業者の控え（JSON）を、利用者フォルダの 控え/ に置く・並べる・読む。
// 置き場：userData/控え/（Windows：%APPDATA%\yomidokoro\控え、Mac：~/Library/Application Support/yomidokoro/控え）
// 画面から来たファイル名は信用しない。フォルダの外を指せないよう、名前だけを取り出して使う。
// 中身は記録（launch-log.txt）にも書かない。
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const 上限 = 2 * 1024 * 1024; // 控えは数KB。これより大きいものは控えではない

function 控えの置き場(userData) {
  const d = path.join(userData, "控え");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Windows と Mac で使えない文字を _ にし、末尾を .json にそろえる。空なら null */
function 名前を整える(名) {
  let n = path.basename(String(名 ?? "")).normalize("NFC");
  n = n.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").replace(/[. ]+$/, "").trim();
  if (!n) return null;
  if (!/\.json$/i.test(n)) n += ".json";
  if (n.length > 120) n = n.slice(0, 115) + ".json";
  return n;
}

/** 同じ名前があれば _2, _3 … を付ける（上書きしない） */
function 空いた名前(d, n) {
  if (!fs.existsSync(path.join(d, n))) return n;
  const 元 = n.replace(/\.json$/i, "");
  for (let i = 2; i < 1000; i++) {
    const c = `${元}_${i}.json`;
    if (!fs.existsSync(path.join(d, c))) return c;
  }
  return null;
}

function 控えを保存(userData, 名, 中身) {
  if (typeof 中身 !== "string" || 中身.length > 上限) return { ok: false, 理由: "控えの中身が正しくありません" };
  const d = 控えの置き場(userData);
  const n0 = 名前を整える(名);
  const n = n0 && 空いた名前(d, n0);
  if (!n) return { ok: false, 理由: "ファイル名を決められませんでした" };
  fs.writeFileSync(path.join(d, n), 中身, "utf8");
  return { ok: true, ファイル名: n, 置き場: d };
}

function 控えの一覧(userData) {
  const d = 控えの置き場(userData);
  return fs
    .readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.json$/i.test(e.name))
    .map((e) => ({ ファイル名: e.name.normalize("NFC"), 実名: e.name, 更新: fs.statSync(path.join(d, e.name)).mtimeMs }))
    .sort((a, b) => b.更新 - a.更新)
    .map(({ ファイル名, 更新 }) => ({ ファイル名, 更新: new Date(更新).toISOString() }));
}

function 控えを開く(userData, 名) {
  const d = 控えの置き場(userData);
  const n = path.basename(String(名 ?? "")).normalize("NFC");
  // 一覧に出した名前（NFC）と、フォルダの実際の名前（Mac では NFD のことがある）を突き合わせる
  const 実 = fs.readdirSync(d).find((x) => x.normalize("NFC") === n && /\.json$/i.test(x));
  if (!実) return { ok: false, 理由: "その控えは見つかりません" };
  const p = path.join(d, 実);
  if (fs.statSync(p).size > 上限) return { ok: false, 理由: "大きすぎて控えではありません" };
  return { ok: true, 中身: fs.readFileSync(p, "utf8") };
}

module.exports = { 控えの置き場, 控えを保存, 控えの一覧, 控えを開く, 名前を整える };

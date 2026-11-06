// npm run 共有に出す -- <手帳の記録の yaml> [書き出す先の yaml]
// 手帳の一件（電話・補正）から「手元だけ」の欄（担当者の名前・案件・メモ）を外し、共有する記録の形にして出す。
// 書き出す先を書かなければ画面に出すだけ。書き出す先に app/data/見本/ の中を指したときは 見本: true を付ける。
// 共有する記録（窓口・回答・指摘）には取込の時点で人名・会社名が無い。ここでは何も言い換えず、欄を外すだけ。
import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { 電話ファイル, 補正ファイル } from "../schema/record.ts";

const [元, 先] = process.argv.slice(2);
if (!元) {
  console.log("使い方：npm run 共有に出す -- <手帳の記録の yaml> [書き出す先の yaml]");
  process.exit(1);
}
const raw = parse(fs.readFileSync(元, "utf8"));
const d = raw?.種別 === "補正" ? 補正ファイル.parse(raw) : 電話ファイル.parse(raw);
const { 手元だけ, ...共有 } = d as typeof d & { 手元だけ?: unknown };
const 見本へ = !!先 && path.resolve(先).includes(`${path.sep}data${path.sep}見本${path.sep}`);
const 出す記録 = 見本へ ? { ...共有, 見本: true } : 共有;
const 文 = stringify(出す記録, { lineWidth: 0 });
if (手元だけ) console.error("手元だけの欄（担当者の名前・案件・メモ）を外した。共有する記録には出ない。");
else console.error("手元だけの欄は無かった。");
if (先) {
  fs.mkdirSync(path.dirname(先), { recursive: true });
  fs.writeFileSync(先, 文, { flag: "wx" });
  console.error(`書き出した：${先}${見本へ ? "（見本: true を付けた）" : ""}`);
} else {
  process.stdout.write(文);
}

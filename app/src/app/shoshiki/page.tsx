import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse } from "yaml";
import { 手帳を読む } from "@/lib/data";
import { 公開する様式を読む } from "@/lib/kokai-yoshiki";
import type { 様式, 書き方の型 } from "@/lib/shoshiki";
import ShoshikiView, { type 手元の様式 } from "./ShoshikiView";

export const metadata = { title: "申請書に下書きする｜よみどころ" };

const APP = process.cwd();
const 対応表の置き場 = path.join(APP, "data", "様式");
const 手引きの置き場 = path.join(APP, "..", "手引き");
const 型の置き場 = path.join(APP, "data", "書き方の型");

/** 書き方の型（app/data/書き方の型/*.yaml）を読む。公開してよい（県の記載例の書き方だけで、事業者の情報は入っていない） */
function 型を読む(): 書き方の型[] {
  if (!fs.existsSync(型の置き場)) return [];
  return fs
    .readdirSync(型の置き場)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => {
      const d = parse(fs.readFileSync(path.join(型の置き場, f), "utf8")) as 書き方の型;
      if (!/^[0-9a-f]{64}$/.test(d?.sha256 ?? "")) throw new Error(`書き方の型 ${f}：sha256 が無い`);
      if (!Array.isArray(d.欄) || !Array.isArray(d.差し込み口)) throw new Error(`書き方の型 ${f}：欄・差し込み口が無い`);
      return d;
    });
}

/** 欄の対応表（app/data/様式/*.yaml）を読む。公開してよい（様式の中身は入っていない） */
function 対応表を読む(): 様式[] {
  if (!fs.existsSync(対応表の置き場)) return [];
  return fs
    .readdirSync(対応表の置き場)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => {
      const d = parse(fs.readFileSync(path.join(対応表の置き場, f), "utf8")) as 様式;
      if (!/^[0-9a-f]{64}$/.test(d?.sha256 ?? "")) throw new Error(`様式の対応表 ${f}：sha256 が無い`);
      if (!Array.isArray(d.欄) || typeof d.箱の数 !== "number") throw new Error(`様式の対応表 ${f}：欄・箱の数が無い`);
      return d;
    });
}

/**
 * 手帳版（TECHO=1）だけ：手引き/<県>/様式/ にすでにある様式ファイルを sha256 で見分けて一覧にする。
 * 知っている様式は中身も画面に渡す（手元で開いている画面の中だけ。外へは送らない）。
 * 公開版（TECHO=0）では読まない。県の様式ファイルを out/ に入れないため。
 */
function 手元の様式を読む(知っている: Set<string>): 手元の様式[] {
  if (!手帳を読む || !fs.existsSync(手引きの置き場)) return [];
  const 一覧: 手元の様式[] = [];
  for (const 県 of fs.readdirSync(手引きの置き場).sort()) {
    const dir = path.join(手引きの置き場, 県, "様式");
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!/\.(docx|xlsx)$/i.test(f)) continue;
      const buf = fs.readFileSync(path.join(dir, f));
      const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
      const 知 = 知っている.has(sha256);
      一覧.push({ 県, ファイル名: f, sha256, 中身: 知 ? buf.toString("base64") : null });
    }
  }
  return 一覧;
}

export default function ShoshikiPage() {
  const 様式たち = 対応表を読む();
  const 手元 = 手元の様式を読む(new Set(様式たち.map((s) => s.sha256)));
  // 公開版にも入れてよい様式（app/public/ に置いた県の様式。app/data/公開する様式.yaml で sha256 ごとに許したものだけ）
  const 知っている = new Set(様式たち.map((s) => s.sha256));
  const 試せる = 公開する様式を読む(APP).filter((x) => 知っている.has(x.sha256));
  return <ShoshikiView 様式たち={様式たち} 型たち={型を読む()} 手元={手元} 手帳版={手帳を読む} 試せる={試せる} />;
}

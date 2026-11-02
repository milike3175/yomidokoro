// npm run 確認：全 YAML を書き方の決まり（schema/record.ts）で検証する。
// エラーはファイル名・行番号・日本語で出す。記録の中身は画面に出さない（エラー箇所の項目名だけ）。
import fs from "node:fs";
import path from "node:path";
import { LineCounter, parseDocument, isNode } from "yaml";
import type { ZodType } from "zod";
import {
  観点ファイル,
  品目ファイル,
  県ファイル,
  手引きファイル,
  受理実績ファイル,
  電話ファイル,
  補正ファイル,
} from "../schema/record.ts";

const APP = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(APP, "..");
const 許認可 = "産廃収集運搬";

let エラー数 = 0;
let ファイル数 = 0;
const NFC = (s: string) => s.normalize("NFC");
const 表示名 = (f: string) => NFC(path.relative(ROOT, f));

function 誤り(file: string, 行: number | null, msg: string) {
  エラー数++;
  console.log(`[誤り] ${表示名(file)}${行 ? ` ${行}行目` : ""}：${msg}`);
}

function 検証<T>(file: string, schema: ZodType<T>): T | null {
  ファイル数++;
  const lc = new LineCounter();
  const text = fs.readFileSync(file, "utf8");
  const doc = parseDocument(text, { lineCounter: lc, prettyErrors: false });
  if (doc.errors.length) {
    for (const e of doc.errors) 誤り(file, e.linePos?.[0]?.line ?? null, `YAML として読めません（${e.code}）`);
    return null;
  }
  const r = schema.safeParse(doc.toJS());
  if (r.success) return r.data;
  for (const i of r.error.issues) {
    // 誤りのある場所に最も近い項目の行を探す
    let 行: number | null = null;
    for (let n = i.path.length; n >= 0 && 行 === null; n--) {
      const node = n === 0 ? doc.contents : doc.getIn(i.path.slice(0, n) as (string | number)[], true);
      if (isNode(node) && node.range) 行 = lc.linePos(node.range[0]).line;
    }
    const 場所 = i.path.length ? `「${i.path.map((x) => (typeof x === "number" ? `${x + 1}件目` : String(x))).join(" > ")}」` : "";
    誤り(file, 行, `${場所} ${日本語(i)}`);
  }
  return null;
}

function 日本語(i: { code: string; message: string; expected?: unknown }): string {
  // zod の英語の既定文を日本語に置き換える（スキーマ側で日本語を書いたものはそのまま）
  if (/[ぁ-んァ-ン一-龠]/.test(i.message)) return i.message;
  if (i.code === "invalid_type" && /received undefined/.test(i.message)) return "この項目が書かれていません";
  if (i.code === "invalid_type") return `書き方の型が違います（${String(i.expected)} のはず）`;
  if (i.code === "unrecognized_keys") return `決まりに無い項目があります（${i.message}）`;
  if (i.code === "too_small") return "空か、数が足りません";
  if (i.code === "too_big") return "長すぎるか、数が多すぎます";
  if (i.code === "invalid_value") return `使えない値です（${i.message}）`;
  if (i.code === "invalid_format") return "形が違います";
  return i.message;
}

function 検査数字(五桁: string): string {
  const s = [...五桁].reduce((a, d, k) => a + Number(d) * (6 - k), 0);
  const c = s >= 11 ? 11 - (s % 11) : 11 - s;
  return String(c % 10);
}

// ---- 語彙 ----
const DATA = path.join(APP, "data");
const 観点 = 検証(path.join(DATA, "観点.yaml"), 観点ファイル);
const 品目 = 検証(path.join(DATA, "品目.yaml"), 品目ファイル);
const 県 = 検証(path.join(DATA, "県.yaml"), 県ファイル);

const 観点ids = new Set(観点?.観点.map((k) => k.id) ?? []);
if (観点) {
  const seen = new Set<string>();
  for (const k of 観点.観点) {
    if (seen.has(k.id)) 誤り(path.join(DATA, "観点.yaml"), null, `観点の id「${k.id}」が重なっています`);
    seen.add(k.id);
  }
}
const 品目ids = new Set([...(品目?.品目.map((h) => h.id) ?? []), ...(品目?.付加区分.map((h) => h.id) ?? []), "建設系", "建設系以外"]);
const 県コード = new Set(県?.県.map((k) => k.コード) ?? []);
const 政令市コード = new Set<string>();
if (県) {
  for (const k of 県.県) {
    const want = `${k.コード}000${検査数字(k.コード + "000")}`;
    if (k.団体コード !== want) 誤り(path.join(DATA, "県.yaml"), null, `${k.名前} の団体コードが ${k.団体コード} ですが、計算では ${want} です`);
  }
  const want = Array.from({ length: 47 }, (_, n) => String(n + 1).padStart(2, "0"));
  if (want.some((c) => !県コード.has(c))) 誤り(path.join(DATA, "県.yaml"), null, "01〜47 のコードがそろっていません");
  for (const s of 県.政令市) {
    const want = `${s.コード}${検査数字(s.コード)}`;
    if (s.団体コード !== want) 誤り(path.join(DATA, "県.yaml"), null, `${s.名前} の団体コードが ${s.団体コード} ですが、計算では ${want} です`);
    if (!県コード.has(s.親)) 誤り(path.join(DATA, "県.yaml"), null, `${s.名前} の親「${s.親}」が県の一覧にありません`);
    if (!s.コード.startsWith(s.親)) 誤り(path.join(DATA, "県.yaml"), null, `${s.名前} のコード ${s.コード} が親の県コード ${s.親} で始まっていません`);
    if (政令市コード.has(s.コード)) 誤り(path.join(DATA, "県.yaml"), null, `政令市のコード ${s.コード} が重なっています`);
    政令市コード.add(s.コード);
  }
}

function 観点を確かめる(file: string, 観点名: string) {
  if (観点名 !== "未分類" && !観点ids.has(観点名)) 誤り(file, null, `観点「${観点名}」は 観点.yaml にありません`);
}
function 品目を確かめる(file: string, v: string | string[] | undefined) {
  for (const x of v === undefined ? [] : Array.isArray(v) ? v : [v]) {
    if (!品目ids.has(x)) 誤り(file, null, `品目「${x}」は 品目.yaml にありません（「建設系」「建設系以外」も使えます）`);
  }
}

function 県フォルダたち(root: string): { dir: string; コード: string }[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((n) => fs.statSync(path.join(root, n)).isDirectory() && !n.startsWith("."))
    .map((n) => {
      const m = NFC(n).match(/^(\d{2}|\d{5})_/);
      if (!m) 誤り(path.join(root, n), null, "フォルダ名は「27_大阪府」のようにコードで始めてください");
      return { dir: path.join(root, n), コード: m?.[1] ?? "" };
    })
    .filter((x) => x.コード);
}

function コードを確かめる(dir: string, コード: string) {
  if (!県) return;
  if (コード.length === 2 && !県コード.has(コード)) 誤り(dir, null, `県コード ${コード} は 県.yaml にありません`);
  if (コード.length === 5 && !政令市コード.has(コード)) 誤り(dir, null, `政令市のコード ${コード} は 県.yaml の 政令市: にありません（先に足してください）`);
}

// ---- 公開側：手引き・受理実績 ----
for (const { dir, コード } of 県フォルダたち(path.join(DATA, 許認可))) {
  コードを確かめる(dir, コード);
  const t = path.join(dir, "手引き.yaml");
  if (fs.existsSync(t)) {
    const d = 検証(t, 手引きファイル);
    if (d) {
      if (d.許可権者.コード !== コード) 誤り(t, null, `許可権者のコード ${d.許可権者.コード} がフォルダ（${コード}）と違います`);
      const 文書 = new Set(d.手引き.map((x) => x.文書));
      const ids = new Set<string>();
      for (const r of d.記録) {
        観点を確かめる(t, r.観点);
        品目を確かめる(t, r.品目);
        if (!文書.has(r.出典.文書)) 誤り(t, null, `記録 ${r.id} の出典の文書「${r.出典.文書}」が 手引き: の一覧にありません`);
        if (ids.has(r.id)) 誤り(t, null, `記録の id「${r.id}」が重なっています`);
        ids.add(r.id);
      }
      for (const n of d.記載なし) 観点を確かめる(t, n.観点);
    }
  }
  const j = path.join(dir, "受理実績.yaml");
  if (fs.existsSync(j)) {
    const d = 検証(j, 受理実績ファイル);
    for (const r of d ?? []) {
      観点を確かめる(j, r.観点);
      品目を確かめる(j, r.品目);
    }
  }
}

// ---- 手帳側：電話・補正（自分のパソコンにだけある。中身は出さない） ----
const TECHO = path.join(ROOT, "手帳", 許認可);
const 電話id = new Set<string>();
for (const { dir, コード } of 県フォルダたち(TECHO)) {
  コードを確かめる(dir, コード);
  const 電話dir = path.join(dir, "電話");
  if (!fs.existsSync(電話dir)) continue;
  for (const f of fs.readdirSync(電話dir).filter((n) => n.endsWith(".yaml"))) {
    const file = path.join(電話dir, f);
    const d = 検証(file, 電話ファイル);
    if (!d) continue;
    if (d.許可権者.コード !== コード) 誤り(file, null, `許可権者のコード ${d.許可権者.コード} がフォルダ（${コード}）と違います`);
    if (電話id.has(d.id)) 誤り(file, null, `電話の id「${d.id}」が他のファイルと重なっています`);
    電話id.add(d.id);
    for (const a of d.回答) {
      観点を確かめる(file, a.観点);
      品目を確かめる(file, a.品目);
    }
  }
  const 補正dir = path.join(dir, "補正");
  if (!fs.existsSync(補正dir)) continue;
  for (const f of fs.readdirSync(補正dir).filter((n) => n.endsWith(".yaml"))) {
    const file = path.join(補正dir, f);
    const d = 検証(file, 補正ファイル);
    if (!d) continue;
    if (d.許可権者.コード !== コード) 誤り(file, null, `許可権者のコード ${d.許可権者.コード} がフォルダ（${コード}）と違います`);
    if (電話id.has(d.id)) 誤り(file, null, `id「${d.id}」が他のファイルと重なっています`);
    電話id.add(d.id);
    for (const a of d.指摘) {
      観点を確かめる(file, a.観点);
      品目を確かめる(file, a.品目);
    }
  }
}

console.log("");
if (エラー数 === 0) {
  console.log(`確認おわり：${ファイル数}ファイル、誤りなし`);
} else {
  console.log(`確認おわり：${ファイル数}ファイル、誤り ${エラー数}件`);
  process.exit(1);
}

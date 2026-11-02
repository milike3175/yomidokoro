// 層1（手引き）の道具が共通で使う部分。取得・読む・照合・鮮度から呼ぶ。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse, parseDocument, type Document } from "yaml";
import { 県ファイル } from "../../schema/record.ts";

export const APP = path.resolve(import.meta.dirname, "..", "..");
export const ROOT = path.resolve(APP, "..");
export const DATA = path.join(APP, "data");
export const 許認可 = "産廃収集運搬";
export const 手引きの置き場 = path.join(ROOT, "手引き");

export const NFC = (s: string) => s.normalize("NFC");
export const 出す = (s = "") => console.log(s);
export function 止める(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

export function 今日の文字(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function sha256(file: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export const 県一覧 = 県ファイル.parse(parse(fs.readFileSync(path.join(DATA, "県.yaml"), "utf8"))).県;

export function 県を探す(コード: string | undefined) {
  if (!コード) 止める("県コードを付けてほしい（例：npm run 取得 -- 03）");
  const k = 県一覧.find((x) => x.コード === コード!.padStart(2, "0"));
  if (!k) 止める(`県コード「${コード}」は県.yaml にない`);
  return k!;
}

/** コード2桁で始まるフォルダを探す。無ければ作る場所を返す */
export function 県フォルダ(root: string, コード: string, 名前: string, 作る = false): string {
  if (fs.existsSync(root)) {
    const hit = fs.readdirSync(root).find((n) => NFC(n).startsWith(`${コード}_`));
    if (hit) return path.join(root, hit);
  }
  const p = path.join(root, `${コード}_${名前}`);
  if (作る) fs.mkdirSync(p, { recursive: true });
  return p;
}

export function 手引きフォルダ(コード: string, 名前: string, 作る = false) {
  // 鮮度の試しなどで、別の写しのフォルダを使えるようにする
  const i = process.argv.indexOf("--フォルダ");
  if (i >= 0 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  return 県フォルダ(手引きの置き場, コード, 名前, 作る);
}

export function 公開側フォルダ(コード: string, 名前: string, 作る = false) {
  return 県フォルダ(path.join(DATA, 許認可), コード, 名前, 作る);
}

// ---------------- _出典.yaml ----------------

export type ファイル記録 = {
  ファイル名: string;
  名前?: string;
  役割?: string;
  版?: string;
  url: string | null;
  sha256: string;
  取得日: string;
  サイズ: number;
  最終更新: string | null;
  ページ数?: number | null;
  文字にした日?: string;
};

export type 出典 = {
  許可権者?: { コード: string; 名前: string };
  入口?: string;
  利用規約?: string;
  文書?: { 名前: string; 版?: string; 役割?: string }[];
  取り寄せ?: { url: string; 名前?: string; 役割?: string; 版?: string }[];
  ファイル?: ファイル記録[];
  入口の文書一覧?: { 確認日: string; リンク: { 名前: string; url: string }[] };
  改訂の検知?: { 日付: string; 文書: string[]; 内容: string[]; 読み直し済み?: string }[];
  鮮度確認日?: string;
};

export function 出典を読む(dir: string): { doc: Document; data: 出典 } {
  const f = path.join(dir, "_出典.yaml");
  if (!fs.existsSync(f)) return { doc: parseDocument("{}"), data: {} };
  const doc = parseDocument(fs.readFileSync(f, "utf8"));
  return { doc, data: (doc.toJS() ?? {}) as 出典 };
}

/** 人が書いた部分（コメントや並び）を残したまま、道具が持つ項目だけ書き換える */
export function 出典に書く(dir: string, doc: Document, 項目: Partial<出典>) {
  for (const [k, v] of Object.entries(項目)) {
    if (v === undefined) doc.delete(k);
    else doc.set(k, doc.createNode(v));
  }
  fs.writeFileSync(path.join(dir, "_出典.yaml"), doc.toString({ lineWidth: 0 }));
}

/** 文書の名前（_出典.yaml の 文書:）とファイル名を突き合わせて、役割・版を引く */
export function 文書を引く(data: 出典, ファイル名: string) {
  const base = NFC(ファイル名);
  const hit = (data.文書 ?? []).find((d) => base.startsWith(NFC(d.名前)) || base.includes(NFC(d.名前)));
  const t = (data.取り寄せ ?? []).find((d) => d.url && NFC(decodeURIComponent(path.basename(new URL(d.url).pathname))) === base);
  return { 名前: t?.名前 ?? hit?.名前, 役割: t?.役割 ?? hit?.役割, 版: t?.版 ?? hit?.版 };
}

/** 版らしい部分（R7, R8.4, 令和8年 など）を外した名前。版の書き換えの検知に使う */
export function 版を外す(名前: string) {
  return NFC(名前)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[【（(\[]?(R|Ｒ|令和|H|平成)\s*\d+(\.\d+)*(年度?|改|版)?[】）)\]]?/g, "")
    .replace(/\d{8,14}/g, "")
    .replace(/\s+/g, "");
}

// ---------------- 文字にしたページ ----------------

export type ページ = { 文書: string; 物理ページ: number; 本文: string };

/** txt/<ファイル名>.txt を =====pN===== で割る */
export function ページに割る(txtFile: string, 文書: string): ページ[] {
  const text = fs.readFileSync(txtFile, "utf8");
  const out: ページ[] = [];
  const re = /=====p(\d+)=====\n?/g;
  let m: RegExpExecArray | null;
  const marks: { n: number; at: number; end: number }[] = [];
  while ((m = re.exec(text))) marks.push({ n: Number(m[1]), at: m.index, end: re.lastIndex });
  marks.forEach((mk, i) => {
    out.push({ 文書, 物理ページ: mk.n, 本文: text.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : text.length) });
  });
  return out;
}

/** 照合のための正規化：全角半角・空白・改行・似た記号の違いを吸収する */
export function 正規化(s: string) {
  return NFC(s)
    .normalize("NFKC")
    .replace(/[ヶヵ]/g, "ケ")
    .replace(/[〜～~∼]/g, "~")
    .replace(/[‐－−–—―ｰ]/g, "-")
    .replace(/[「」『』“”"'‘’]/g, "")
    .replace(/[\s　]+/g, "");
}

/** 料金の目安（1M トークンあたりのドル。2026-11 時点の公開価格を基にした目安） */
export const 単価: Record<string, { 入力: number; 出力: number; 書込: number; 読込: number }> = {
  "claude-fable-5-1": { 入力: 10, 出力: 50, 書込: 12.5, 読込: 0.25 },
  "claude-opus-5-5": { 入力: 4, 出力: 20, 書込: 5, 読込: 0.4 },
  "claude-haiku-5-5": { 入力: 0.1, 出力: 0.5, 書込: 0.125, 読込: 0.01 },
};
export type 使用量 = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
export function ドル(model: string, u: 使用量, まとめて = false) {
  const p = 単価[model];
  if (!p) return 0;
  const usd =
    (u.input_tokens * p.入力 +
      u.output_tokens * p.出力 +
      (u.cache_creation_input_tokens ?? 0) * p.書込 +
      (u.cache_read_input_tokens ?? 0) * p.読込) /
    1_000_000;
  return まとめて ? usd / 2 : usd;
}

export function 鍵を読む() {
  try {
    process.loadEnvFile(path.join(APP, ".env"));
  } catch {
    // .env が無ければ、すでに環境変数にあるかだけ見る
  }
  if (!process.env.ANTHROPIC_API_KEY) 止める("ANTHROPIC_API_KEY が見つからない。app/.env に入っているか、みゆきに確かめてもらってほしい。");
}

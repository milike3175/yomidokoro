// 「はじめての許認可」モード（探す・はじめて読む）が共通で使う部分。
// 産廃の道具（scripts/tebiki/）のファイルは書き換えず、import して使う。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { APP, ROOT, DATA, NFC, 止める } from "../tebiki/kyotsu.ts";
import { 文字にする as 文書を文字にする } from "../tebiki/shutoku.ts";

export const はじめての手引き = path.join(ROOT, "手引き", "_はじめて");
export const はじめてのデータ = path.join(DATA, "はじめて");

/** 許認可名と自治体名から idを作る（フォルダ名・画面の URL に使う） */
export function idを作る(許認可名: string, 自治体名: string) {
  const きれい = (s: string) => NFC(s).trim().replace(/[\s/\\:*?"<>|.]+/g, "");
  return `${きれい(許認可名)}_${きれい(自治体名)}`;
}

export function 手元フォルダ(id: string, 作る = false) {
  const p = path.join(はじめての手引き, NFC(id));
  if (作る) fs.mkdirSync(p, { recursive: true });
  return p;
}
export function 公開フォルダ(id: string, 作る = false) {
  const p = path.join(はじめてのデータ, NFC(id));
  if (作る) fs.mkdirSync(p, { recursive: true });
  return p;
}

/**
 * 公的なドメインか。lg.jp・go.jp と、地方公共団体の地域型ドメイン（pref./city./town./vill. で始まる .jp）だけを通す。
 * 例：pref.wakayama.lg.jp、www.city.wakayama.wakayama.jp、www.mlit.go.jp
 */
export function 公的なドメインか(host: string) {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (/(^|\.)lg\.jp$/.test(h) || /(^|\.)go\.jp$/.test(h)) return true;
  return /^(www\d?\.)?(pref|city|town|vill|metro)\.[a-z0-9-]+(\.[a-z0-9-]+)?\.jp$/.test(h);
}
export function 公的なURLか(url: string) {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && 公的なドメインか(u.hostname);
  } catch {
    return false;
  }
}

export type 形式 = "PDF" | "HTML" | "Word" | "Excel" | "その他";
export function 形式を見る(ファイル名: string): 形式 {
  const n = ファイル名.toLowerCase();
  if (n.endsWith(".pdf")) return "PDF";
  if (/\.html?$/.test(n)) return "HTML";
  if (/\.(docx?|rtf)$/.test(n)) return "Word";
  if (/\.xlsx?$/.test(n)) return "Excel";
  return "その他";
}

/** PDF・Word・Excel は産廃の道具の to_text.py、HTML はこのフォルダの html_text.py で文字にする */
export function 文字にする(dir: string, ファイル名: string): number | null {
  if (形式を見る(ファイル名) !== "HTML") return 文書を文字にする(dir, ファイル名);
  const txtDir = path.join(dir, "txt");
  fs.mkdirSync(txtDir, { recursive: true });
  const 先 = path.join(txtDir, `${ファイル名}.txt`);
  const out = execFileSync("python3", ["-I", path.join(APP, "scripts", "hajimete", "html_text.py"), path.join(dir, ファイル名), 先], {
    encoding: "utf8",
  });
  const n = Number(/ページ数 (\d+)/.exec(out)?.[1] ?? 0);
  if (n === 0 && fs.existsSync(先)) fs.rmSync(先);
  return n || null;
}

// ---------------- 手元の _出典.yaml（探すが書き、はじめて読むが読む） ----------------

export type はじめての出典 = {
  id: string;
  許認可名: string;
  自治体名: string;
  自治体ドメイン: string | null;
  探した日: string;
  検索語: string[];
  候補: { url: string; 名前?: string; 役割?: string; 理由?: string }[];
  ファイル: {
    ファイル名: string;
    名前?: string;
    役割?: string;
    形式: 形式;
    url: string;
    sha256: string;
    取得日: string;
    サイズ: number;
    最終更新: string | null;
    ページ数: number | null;
  }[];
  取れなかった: { url: string | null; 理由: string }[];
  見つからなかったこと: string | null;
  時間: { 探す: number; 取得: number };
  費用: { 探す: number };
};

export function 出典を読む(id: string): はじめての出典 {
  const f = path.join(手元フォルダ(id), "_出典.yaml");
  if (!fs.existsSync(f)) 止める(`「${id}」はまだ探していない。先に npm run 探す -- "<許認可名>" "<自治体名>"`);
  return parseYaml(fs.readFileSync(f, "utf8")) as はじめての出典;
}

/** 秒を小数1桁で */
export const 秒 = (ms: number) => Math.round(ms / 100) / 10;

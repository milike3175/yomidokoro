// 「はじめての許認可」の結果（app/data/はじめて/<id>/手引き.yaml）と共通観点を、画面用に読む。サーバー側だけで使う。
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { 共通観点ファイル, はじめてファイル, type はじめてデータ, type 共通観点 } from "../../schema/hajimete.ts";

const DATA = path.join(process.cwd(), "data");
const NFC = (s: string) => s.normalize("NFC");

export type はじめて = はじめてデータ & {
  合計秒: number;
  合計ドル: number;
  照合の内訳: Record<string, number>;
  埋まった観点: number;
};

let cache: { 観点: 共通観点[]; 一覧: はじめて[] } | null = null;

export function はじめてのデータ() {
  if (cache) return cache;
  const 観点 = 共通観点ファイル.parse(parse(fs.readFileSync(path.join(DATA, "共通観点.yaml"), "utf8"))).観点;
  const dir = path.join(DATA, "はじめて");
  const 一覧: はじめて[] = [];
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => !n.startsWith(".")).sort() : []) {
    const f = path.join(dir, n, "手引き.yaml");
    if (!fs.existsSync(f)) continue;
    const d = はじめてファイル.parse(parse(fs.readFileSync(f, "utf8")));
    const 照合の内訳: Record<string, number> = {};
    for (const x of [...d.記録.map((r) => r.出典), ...d.独自の観点.map((c) => c.出典)]) 照合の内訳[x.照合] = (照合の内訳[x.照合] ?? 0) + 1;
    一覧.push({
      ...d,
      id: NFC(d.id),
      合計秒: d.時間.探す + d.時間.取得 + d.時間.読む + d.時間.照合,
      合計ドル: d.費用.探す + d.費用.読む,
      照合の内訳,
      埋まった観点: new Set(d.記録.map((r) => r.観点)).size,
    });
  }
  cache = { 観点, 一覧 };
  return cache;
}

/** 秒を「2分7秒」の形に */
export function 時間の文字(秒: number) {
  const s = Math.round(秒);
  if (s < 1) return "1秒未満";
  if (s < 60) return `${s}秒`;
  return `${Math.floor(s / 60)}分${s % 60 ? `${s % 60}秒` : ""}`;
}

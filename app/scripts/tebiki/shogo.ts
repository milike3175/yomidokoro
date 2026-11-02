// npm run 照合 -- <県コード>（ケン）
// 手引き.yaml の各引用が、本当にそのページの文字に入っているかをプログラムで照らし合わせる。AI は使わない。
//   一致            ：指定のページに、正規化した引用がそのまま入っている
//   一致（ページ訂正）：前後2ページに入っていた。物理ページを直す
//   近似（要目視）    ：文字の並び（2文字ずつ）の似ている度合いが 0.9 以上の箇所がある
//   不一致          ：それ以外。捨てずに残し、画面で目立たせる
import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { 手引きファイル, type 手引きデータ } from "../../schema/record.ts";
import { 出す, 止める, 県を探す, 手引きフォルダ, 公開側フォルダ, ページに割る, 正規化, NFC } from "./kyotsu.ts";

export type 照合結果 = "一致" | "一致（ページ訂正）" | "近似（要目視）" | "不一致";

/** 文書ごと・物理ページごとの、正規化した本文 */
export function 本文を用意(dir: string, 文書たち: string[]) {
  const 本: Map<string, Map<number, string>> = new Map();
  for (const 文書 of 文書たち) {
    const f = path.join(dir, "txt", `${文書}.txt`);
    const m = new Map<number, string>();
    if (fs.existsSync(f)) for (const p of ページに割る(f, 文書)) m.set(p.物理ページ, 正規化(p.本文));
    本.set(NFC(文書), m);
  }
  return 本;
}

function 二文字(s: string) {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
  return out;
}
function 似ている度合い(a: string, b: string) {
  const A = 二文字(a);
  const B = 二文字(b);
  let 共通 = 0;
  for (const [k, n] of A) 共通 += Math.min(n, B.get(k) ?? 0);
  const 全 = Math.max(1, a.length - 1 + b.length - 1);
  return (2 * 共通) / 全;
}
function 一番似ている(q: string, 本文: string) {
  let best = 0;
  const w = q.length;
  for (let i = 0; i + w <= 本文.length; i += Math.max(1, Math.floor(w / 8))) {
    best = Math.max(best, 似ている度合い(q, 本文.slice(i, i + w)));
    if (best >= 0.999) break;
  }
  return best;
}

export function 照らす(
  本: ReturnType<typeof 本文を用意>,
  文書: string,
  物理ページ: number,
  引用: string,
): { 照合: 照合結果; 物理ページ: number; 度合い?: number } {
  const ページたち = 本.get(NFC(文書));
  const q = 正規化(引用);
  if (!ページたち || q.length < 4) return { 照合: "不一致", 物理ページ };
  if (ページたち.get(物理ページ)?.includes(q)) return { 照合: "一致", 物理ページ };
  for (const d of [1, -1, 2, -2]) {
    if (ページたち.get(物理ページ + d)?.includes(q)) return { 照合: "一致（ページ訂正）", 物理ページ: 物理ページ + d };
  }
  // ページの境目をまたぐ引用：隣のページとつないで探す
  for (const d of [0, -1]) {
    const a = ページたち.get(物理ページ + d);
    const b = ページたち.get(物理ページ + d + 1);
    if (a && b && (a + b).includes(q)) return { 照合: "一致", 物理ページ: 物理ページ + d };
  }
  let best = { 度合い: 0, ページ: 物理ページ };
  for (const d of [0, 1, -1, 2, -2]) {
    const t = ページたち.get(物理ページ + d);
    if (!t) continue;
    const s = 一番似ている(q, t);
    if (s > best.度合い) best = { 度合い: s, ページ: 物理ページ + d };
  }
  if (best.度合い >= 0.9) return { 照合: "近似（要目視）", 物理ページ: best.ページ, 度合い: best.度合い };
  return { 照合: "不一致", 物理ページ, 度合い: best.度合い };
}

/** 印字ページを、ページの最初か最後の行の「－２－」「- 2 -」「P.2」から読む */
export function 印字ページを読む(txtFile: string, 文書: string): [number, number][] {
  if (!fs.existsSync(txtFile)) return [];
  const out: [number, number][] = [];
  for (const p of ページに割る(txtFile, 文書)) {
    const lines = p.本文.split("\n").map((l) => l.normalize("NFKC").trim()).filter(Boolean);
    const 候補 = [...lines.slice(0, 2), ...lines.slice(-2)];
    for (const l of 候補) {
      const m = /^(?:[-‐－−–—ー―]\s*(\d{1,3})\s*[-‐－−–—ー―]|[PpＰ]\s*[.．]\s*(\d{1,3}))$/.exec(l);
      if (m) {
        out.push([p.物理ページ, Number(m[1] ?? m[2])]);
        break;
      }
    }
  }
  return out;
}

export function 印字を引く(対応: [number, number][] | undefined, 物理: number) {
  return 対応?.find(([p]) => p === 物理)?.[1] ?? null;
}

/** 手引き.yaml 全体を照合し直す。結果の数を返す */
export function 全部照らす(dir: string, data: 手引きデータ) {
  const 本 = 本文を用意(dir, data.手引き.map((d) => d.文書));
  const 対応 = new Map(data.手引き.map((d) => [NFC(d.文書), d.ページ対応]));
  const 数: Record<照合結果, number> = { 一致: 0, "一致（ページ訂正）": 0, "近似（要目視）": 0, 不一致: 0 };
  const 気になる: string[] = [];
  for (const r of data.記録) {
    const res = 照らす(本, r.出典.文書, r.出典.物理ページ, r.出典.引用);
    if (res.物理ページ !== r.出典.物理ページ) 気になる.push(`  ページ訂正 ${r.観点}：p.${r.出典.物理ページ} から p.${res.物理ページ} へ`);
    r.出典.物理ページ = res.物理ページ;
    r.出典.照合 = res.照合;
    r.出典.印字ページ = 印字を引く(対応.get(NFC(r.出典.文書)), res.物理ページ);
    数[res.照合]++;
    if (res.照合 === "近似（要目視）" || res.照合 === "不一致")
      気になる.push(`  ${res.照合} ${r.観点}（${r.出典.文書} p.${res.物理ページ}、似ている度合い ${(res.度合い ?? 0).toFixed(2)}）：${r.出典.引用}`);
  }
  return { 数, 気になる };
}

function main() {
  const 県 = 県を探す(process.argv[2]);
  const dir = 手引きフォルダ(県.コード, 県.名前);
  const f = path.join(公開側フォルダ(県.コード, 県.名前), "手引き.yaml");
  if (!fs.existsSync(f)) 止める(`${県.名前}の手引き.yaml がまだ無い。先に npm run 読む -- ${県.コード}`);
  const data = 手引きファイル.parse(parse(fs.readFileSync(f, "utf8")));
  出す(`${県.名前}：引用 ${data.記録.length}件を、手引きの文字と照らし合わせる`);
  const { 数, 気になる } = 全部照らす(dir, data);
  fs.writeFileSync(f, stringify(data, { lineWidth: 0 }));
  出す(`一致 ${数.一致}　一致（ページ訂正） ${数["一致（ページ訂正）"]}　近似（要目視） ${数["近似（要目視）"]}　不一致 ${数.不一致}`);
  for (const l of 気になる) 出す(l);
}

if (import.meta.main) main();

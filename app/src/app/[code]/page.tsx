import { notFound } from "next/navigation";
import { データ } from "@/lib/data";
import { 今日の文字 } from "@/lib/hizuke";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import KenView from "./KenView";

/** この県の様式の対応表（app/data/様式/*.yaml）の名前。様式に書く画面への案内に使う */
function 書ける様式(県コード: string): string[] {
  const d = path.join(process.cwd(), "data", "様式");
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => parse(fs.readFileSync(path.join(d, f), "utf8")) as { 県コード?: string; 名前?: string })
    .filter((x) => x?.県コード === 県コード && x.名前)
    .map((x) => x.名前!.replace(/^産業廃棄物収集運搬業許可申請書/, "申請書"));
}

/** 対応表のある県のコード（書ける県の一覧。対応表を足せば増える） */
function 対応表のある県(): string[] {
  const d = path.join(process.cwd(), "data", "様式");
  if (!fs.existsSync(d)) return [];
  const コード = fs
    .readdirSync(d)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => (parse(fs.readFileSync(path.join(d, f), "utf8")) as { 県コード?: string })?.県コード)
    .filter((x): x is string => !!x);
  return [...new Set(コード)].sort();
}

/** 県の産廃収集運搬業のページ（手引き/<県>/_出典.yaml の 入口）。様式はここから取ってくる */
function 様式の入口(県コード: string): string | null {
  const d = path.join(process.cwd(), "..", "手引き");
  if (!fs.existsSync(d)) return null;
  const k = fs.readdirSync(d).find((n) => n.startsWith(`${県コード}_`));
  const f = k ? path.join(d, k, "_出典.yaml") : null;
  if (!f || !fs.existsSync(f)) return null;
  const 入口 = (parse(fs.readFileSync(f, "utf8")) as { 入口?: unknown })?.入口;
  return typeof 入口 === "string" && /^https:\/\//.test(入口) ? 入口 : null;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return データ().県一覧.map((k) => ({ code: k.コード }));
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const d = データ().県ごと[code];
  return { title: d ? `${d.県.名前}｜よみどころ` : "見つかりません" };
}

export default async function KenPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { 県ごと, 観点一覧, 品目 } = データ();
  const d = 県ごと[code];
  if (!d) notFound();
  return <KenView
      県名={d.県.名前}
      書ける様式={書ける様式(d.県.コード)}
      書ける県={対応表のある県().map((c) => 県ごと[c]?.県.名前).filter((x): x is string => !!x)}
      様式の入口={様式の入口(d.県.コード)}
      手引きの状態={d.手引きの状態}
      改訂={d.改訂}
      読んだ日={d.読んだ日}
      観点候補={d.観点候補}
      照合の内訳={d.照合の内訳}
      県コード={d.県.コード}
      観点一覧={観点一覧}
      品目一覧={品目.品目}
      付加区分={品目.付加区分.map((x) => x.id)}
      カード={d.カード}
      政令市={d.政令市.map((s) => ({ コード: s.市.コード, 名前: s.市.名前, カード: s.カード }))}
      書き出し日={今日の文字()}
    />;
}

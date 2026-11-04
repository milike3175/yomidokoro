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

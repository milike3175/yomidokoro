import { notFound } from "next/navigation";
import { データ } from "@/lib/data";
import { 今日の文字 } from "@/lib/hizuke";
import KenView from "./KenView";

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

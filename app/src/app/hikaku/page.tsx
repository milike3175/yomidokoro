import { データ, 手帳を読む } from "@/lib/data";
import { 今日の文字 } from "@/lib/hizuke";
import HikakuView, { type 行 } from "./HikakuView";

export const metadata = { title: "府県くらべ｜許認可ローカルルールの地図" };

// 観点を一つ選ぶと、許可権者（府県と政令市）ごとの記録が一つの画面に並ぶ。
// 行は記録が1件以上ある許可権者だけ。政令市は親の県のすぐ下に置く（許可権者が違うので行は分ける）
export default function HikakuPage() {
  const { 県一覧, 県ごと, 観点一覧, 品目 } = データ();
  const 行たち: 行[] = [];
  for (const k of 県一覧) {
    const d = 県ごと[k.コード];
    if (d.カード.length > 0) {
      行たち.push({
        コード: k.コード,
        名前: k.名前,
        県ページ: `/${k.コード}/`,
        錨: "",
        手引きの状態: d.手引きの状態,
        カード: d.カード,
      });
    }
    for (const s of d.政令市) {
      行たち.push({
        コード: s.市.コード,
        名前: `${s.市.名前}（政令市）`,
        県ページ: `/${k.コード}/`,
        錨: `c${s.市.コード}`,
        手引きの状態: s.手引きの状態,
        カード: s.カード,
      });
    }
  }
  return (
    <HikakuView
      行たち={行たち}
      観点一覧={観点一覧}
      品目一覧={品目.品目}
      付加区分={品目.付加区分.map((x) => x.id)}
      手帳あり={手帳を読む}
      書き出し日={今日の文字()}
    />
  );
}

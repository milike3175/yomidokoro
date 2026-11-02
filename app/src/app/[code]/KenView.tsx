"use client";

// 県ページの中身。「再確認」とチェックリストは見た日で計算するので、ブラウザ側で動かす。
import { useEffect, useState } from "react";
import type { カード } from "@/lib/data";
import type { 観点 } from "../../../schema/record.ts";
import { 再確認か, 経過日数, 年月, 表示日, 日付に } from "@/lib/hizuke";

type Props = { 県名: string; 観点一覧: 観点[]; カード: カード[]; 書き出し日: string };

const 種別の説明: Record<カード["種別"], string> = {
  手引き: "手引き",
  受理実績: "受理実績",
  電話: "電話",
  同業者: "同業者",
  記載なし: "記載なし",
};

export default function KenView({ 県名, 観点一覧, カード: 全カード, 書き出し日 }: Props) {
  // 最初は書き出した日で描き、ブラウザで開いた時点の日付に置き換える
  const [今日, set今日] = useState<Date>(() => 日付に(書き出し日));
  useEffect(() => set今日(new Date()), []);

  const 観点の記録 = (id: string) => 全カード.filter((c) => c.観点 === id);

  // チェックリスト：手引き（照合一致）・受理実績・1年以内の電話 のどれも無い観点
  const チェック = 観点一覧
    .map((k) => {
      const cs = 観点の記録(k.id);
      const 裏付けあり = cs.some(
        (c) =>
          (c.種別 === "手引き" && c.出典 && c.出典.照合.startsWith("一致")) ||
          c.種別 === "受理実績" ||
          (c.種別 === "電話" && c.確認日 !== null && 経過日数(c.確認日, 今日) <= 365),
      );
      if (裏付けあり) return null;
      let 理由 = "手引きをまだ読んでいない";
      if (cs.some((c) => c.種別 === "記載なし")) 理由 = "手引きを読んだが載っていない";
      if (cs.some((c) => c.種別 === "電話")) 理由 = "前回の電話から1年を超えた";
      else if (cs.some((c) => c.種別 === "手引き")) 理由 = "手引きの記録はあるが出典と照合できていない";
      return { k, 理由 };
    })
    .filter((x) => x !== null);

  const 群順: string[] = [];
  for (const k of 観点一覧) if (!群順.includes(k.群)) 群順.push(k.群);

  return (
    <>
      <p className="back">
        <a href="/">全国一覧にもどる</a>
      </p>
      <h1>{県名}</h1>
      <p className="lead">
        観点{観点一覧.length}項目ごとに、手引き・受理実績・電話で聞いた答えを分けて並べている。道具は判断しない。判断は行政書士がする。
      </p>
      <div className="legend">
        <span className="label 手引き">手引き</span>
        <span className="label 受理実績">受理実績</span>
        <span className="label 電話">電話</span>
        <span className="label 同業者">同業者</span>
        <span className="label 記載なし">記載なし</span>
        <span className="label 再確認">再確認</span>確認から1年を超えた記録
      </div>

      <section className="checklist">
        <h2>電話で聞くことのチェックリスト（{チェック.length}項目）</h2>
        <div className="lead" style={{ margin: 0 }}>
          手引き（出典と照合済み）・受理実績・1年以内の電話のどれも無い観点。電話で答えが入ると消える。
        </div>
        <ol>
          {チェック.map(({ k, 理由 }) => (
            <li key={k.id}>
              <span className="ask">{k.電話で聞く文}</span>
              <span className="why">
                <a href={`#${k.番号}`}>
                  {k.番号} {k.表示名}
                </a>
                。{理由}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {群順.map((群) => (
        <section key={群}>
          <h2>{群}</h2>
          {観点一覧
            .filter((k) => k.群 === 群)
            .map((k) => {
              const cs = 観点の記録(k.id);
              return (
                <div key={k.id} id={k.番号} className={`kanten${cs.length === 0 ? " empty" : ""}`}>
                  <div className="kanten-head">
                    <span className="no">{k.番号}</span>
                    <span className="title">{k.表示名}</span>
                    {cs.length === 0 && <span className="nothing">まだ記録がない</span>}
                  </div>
                  {cs.length > 0 && (
                    <div className="cards">
                      {cs.map((c, i) => (
                        <Card key={i} c={c} 今日={今日} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </section>
      ))}
    </>
  );
}

function Card({ c, 今日 }: { c: カード; 今日: Date }) {
  const 古い = 再確認か(c.確認日, 今日);
  return (
    <div className={`card ${c.種別}${古い ? " recheck" : ""}`}>
      <div className="card-top">
        <span className={`label ${c.種別}`}>{種別の説明[c.種別]}</span>
        {古い && <span className="label 再確認">再確認</span>}
      </div>

      {c.問い && <div className="q">問い：{c.問い}</div>}
      <div className="a">
        {c.種別 === "電話" || c.種別 === "同業者" ? "答え：" : ""}
        {c.本文}
      </div>

      {c.出典 && (
        <>
          <blockquote>{c.出典.引用}</blockquote>
          <div className="ref">
            {c.出典.url ? (
              <a href={`${c.出典.url}#page=${c.出典.物理ページ}`} target="_blank" rel="noopener noreferrer">
                {c.出典.文書} PDF {c.出典.物理ページ}ページ目
                {c.出典.印字ページ ? `（印字 p.${c.出典.印字ページ}）` : ""}
              </a>
            ) : (
              <>
                {c.出典.文書} PDF {c.出典.物理ページ}ページ目
              </>
            )}
            。照合：{c.出典.照合}
          </div>
        </>
      )}

      {c.探した語 && <div className="meta">探した語：{c.探した語.join("、")}</div>}

      <div className="meta">
        {c.確認日 && <span>確認日：{表示日(c.確認日)}</span>}
        {c.受理年 && <span>受理：{c.受理年}年</span>}
        {c.窓口 && <span>窓口：{c.窓口}</span>}
        {c.対象.length > 0 && <span>対象：{c.対象.join("・")}</span>}
        {c.品目 && <span>品目：{c.品目.join("・")}</span>}
      </div>

      {c.手引きへの参照 && (
        <div className="ref">
          {c.手引きへの参照.url ? (
            <a href={c.手引きへの参照.url} target="_blank" rel="noopener noreferrer">
              手引き p.{c.手引きへの参照.ページ} を見る
            </a>
          ) : (
            <>手引き p.{c.手引きへの参照.ページ} を見る</>
          )}
          {c.手引きへの参照.内容 ? `（${c.手引きへの参照.内容}）` : ""}
        </div>
      )}

      {c.種別 === "電話" && c.確認日 && (
        <div className="disclaimer">{年月(c.確認日)}に電話で確認した内容。公式見解ではない。申請前に再確認すること</div>
      )}
      {c.種別 === "同業者" && <div className="disclaimer">同業者から聞いた参考情報。公式見解ではない。申請前に再確認すること</div>}
    </div>
  );
}

"use client";

// 県ページの中身。手続き・品目の切り替え、「再確認」、チェックリストは、見た人の画面で計算する。
import { useEffect, useState } from "react";
import type { カード } from "@/lib/data";
import type { 観点 } from "../../../schema/record.ts";
import { 再確認か, 経過日数, 年月, 表示日, 日付に } from "@/lib/hizuke";

const 手続き一覧 = ["新規", "更新", "変更許可"] as const;
type 手続き = (typeof 手続き一覧)[number];
const 既定の手続き: 手続き = "新規";

type Props = {
  県名: string;
  手引きの状態: string;
  観点一覧: 観点[];
  品目一覧: { id: string; 建設系: boolean }[];
  付加区分: string[];
  カード: カード[];
  書き出し日: string;
};

type 品目判定 = "合う" | "合わない" | "関係なし";

const 状態の説明: Record<string, string> = {
  検品済み: "手引きは検品済み",
  未検品: "手引きは自動で読んだだけ（未検品）",
  未確認: "手引きは手元にあるが未確認",
  未読: "手引きはまだ読んでいない",
};

export default function KenView({ 県名, 手引きの状態, 観点一覧, 品目一覧, 付加区分, カード: 全カード, 書き出し日 }: Props) {
  // 最初は書き出した日と既定値で描き、ブラウザで開いた時点の日付と URL の指定に置き換える
  const [今日, set今日] = useState<Date>(() => 日付に(書き出し日));
  const [手続き, set手続き] = useState<手続き>(既定の手続き);
  const [品目, set品目] = useState<string>("");

  useEffect(() => {
    set今日(new Date());
    const q = new URLSearchParams(window.location.search);
    const t = q.get("手続き");
    if (t && (手続き一覧 as readonly string[]).includes(t)) set手続き(t as 手続き);
    const h = q.get("品目");
    if (h && (品目一覧.some((x) => x.id === h) || 付加区分.includes(h))) set品目(h);
  }, [品目一覧, 付加区分]);

  // 選んだものを URL に残す（静的書き出しでも動くよう、ページは読み直さずに書き換えるだけ）
  function URLに残す(t: 手続き, h: string) {
    const q = new URLSearchParams(window.location.search);
    q.set("手続き", t);
    if (h) q.set("品目", h);
    else q.delete("品目");
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}${window.location.hash}`);
  }
  const 手続きを選ぶ = (t: 手続き) => {
    set手続き(t);
    URLに残す(t, 品目);
  };
  const 品目を選ぶ = (h: string) => {
    set品目(h);
    URLに残す(手続き, h);
  };

  const 選んだ品目 = 品目一覧.find((x) => x.id === 品目);

  const 品目で見る = (c: カード, k: 観点 | undefined): 品目判定 => {
    if (!品目 || !k?.品目で変わる || !c.品目 || c.品目.length === 0) return "関係なし";
    if (c.品目.includes(品目)) return "合う";
    if (選んだ品目 && c.品目.includes("建設系")) return 選んだ品目.建設系 ? "合う" : "合わない";
    if (選んだ品目 && c.品目.includes("建設系以外")) return 選んだ品目.建設系 ? "合わない" : "合う";
    return "合わない";
  };
  const 手続きが合う = (c: カード) => c.対象.length === 0 || c.対象.includes(手続き);

  const 観点の記録 = (id: string) => 全カード.filter((c) => c.観点 === id);
  const 観点map = new Map(観点一覧.map((k) => [k.id, k]));

  // チェックリスト：選んだ手続き（と品目）に当てはまる、手引き（照合一致）・受理実績・1年以内の電話 のどれも無い観点
  const チェック = 観点一覧
    .map((k) => {
      const cs = 観点の記録(k.id);
      const 使える = cs.filter((c) => 手続きが合う(c) && 品目で見る(c, k) !== "合わない");
      const 裏付けあり = 使える.some(
        (c) =>
          (c.種別 === "手引き" && c.出典 && c.出典.照合.startsWith("一致")) ||
          c.種別 === "受理実績" ||
          (c.種別 === "電話" && c.確認日 !== null && 経過日数(c.確認日, 今日) <= 365),
      );
      if (裏付けあり) return null;
      let 理由 = "手引きをまだ読んでいない";
      if (cs.some((c) => c.種別 === "記載なし")) 理由 = "手引きを読んだが載っていない";
      if (使える.some((c) => c.種別 === "電話")) 理由 = "前回の電話から1年を超えた";
      else if (使える.some((c) => c.種別 === "手引き")) 理由 = "手引きの記録はあるが出典と照合できていない";
      else if (cs.some((c) => c.種別 === "電話" || c.種別 === "受理実績"))
        理由 = `記録はあるが、${手続き}${品目 ? `・${品目}` : ""}には当てはまらない`;
      return { k, 理由 };
    })
    .filter((x) => x !== null);

  const 群順: string[] = [];
  for (const k of 観点一覧) if (!群順.includes(k.群)) 群順.push(k.群);
  const 群id = (群: string) => `g${群順.indexOf(群) + 1}`;
  const 群の記録数 = (群: string) => 観点一覧.filter((k) => k.群 === 群).reduce((s, k) => s + 観点の記録(k.id).length, 0);

  return (
    <>
      <p className="back">
        <a href="/">全国の地図にもどる</a>
      </p>
      <h1>{県名}</h1>
      <p className="lead">
        {状態の説明[手引きの状態]}。観点{観点一覧.length}項目ごとに、手引き・受理実績・電話で聞いた答えを分けて並べている。道具は判断しない。判断は行政書士がする。
      </p>

      <nav className="toc-mobile" aria-label="目次">
        <a href="#checklist">電話で聞くこと</a>
        {群順.map((g) => (
          <a key={g} href={`#${群id(g)}`}>
            {g}
          </a>
        ))}
      </nav>

      <div className="ken-layout">
        <aside className="side">
          <div className="panel">
            <div className="panel-title">手続き</div>
            <div className="seg" role="group" aria-label="手続き">
              {手続き一覧.map((t) => (
                <button key={t} type="button" aria-pressed={手続き === t} onClick={() => 手続きを選ぶ(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="hint">選んだ手続きに当てはまる記録だけで、チェックリストを作る。</div>
          </div>
          <div className="panel">
            <label className="panel-title" htmlFor="hinmoku">
              品目
            </label>
            <select id="hinmoku" className="select" value={品目} onChange={(e) => 品目を選ぶ(e.target.value)}>
              <option value="">選ばない</option>
              <optgroup label="品目">
                {品目一覧.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.id}
                  </option>
                ))}
              </optgroup>
              <optgroup label="付加区分">
                {付加区分.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </optgroup>
            </select>
            <div className="hint">
              {選んだ品目
                ? `${選んだ品目.id}は${選んだ品目.建設系 ? "建設系にもなりうる品目" : "建設系以外の品目"}として見る。`
                : "品目で答えが変わる観点で、当てはまる記録を目立たせる。"}
            </div>
          </div>
          <nav className="panel toc" aria-label="目次">
            <div className="panel-title">目次</div>
            <ol>
              <li>
                <a href="#checklist">
                  電話で聞くこと<span className="num">{チェック.length}</span>
                </a>
              </li>
              {群順.map((g) => (
                <li key={g}>
                  <a href={`#${群id(g)}`}>
                    {g}
                    <span className="num">{群の記録数(g)}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div>
          <section className="checklist" id="checklist">
            <h2>
              電話で聞くことのチェックリスト<span className="cnt">{チェック.length}件</span>
            </h2>
            <div className="lead" style={{ margin: 0 }}>
              {手続き}のときに、手引き（出典と照合済み）・受理実績・1年以内の電話のどれも無い観点。電話で答えが入ると消える。
            </div>
            {チェック.length === 0 && <p className="empty-all">聞くことは残っていない。</p>}
            {群順.map((g) => {
              const items = チェック.filter((x) => x.k.群 === g);
              if (items.length === 0) return null;
              return (
                <details key={g}>
                  <summary>
                    <Chevron />
                    {g}
                    <span className="n">{items.length}件</span>
                  </summary>
                  <ol>
                    {items.map(({ k, 理由 }) => (
                      <li key={k.id}>
                        <span className="ask">{k.電話で聞く文}</span>
                        <span className="why">
                          <a href={`#${k.番号}`}>
                            {k.番号} {k.表示名}
                          </a>
                          　{理由}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
              );
            })}
          </section>

          <div className="legend" style={{ marginTop: 18 }}>
            <span className="label 手引き">手引き</span>
            <span className="label 受理実績">受理実績</span>
            <span className="label 電話">電話</span>
            <span className="label 同業者">同業者</span>
            <span className="label 記載なし">記載なし</span>
            <span className="label 再確認">再確認</span>
            <span>確認から1年を超えた記録</span>
          </div>

          {群順.map((g) => (
            <section key={g} id={群id(g)} className="group">
              <h2>{g}</h2>
              {観点一覧
                .filter((k) => k.群 === g)
                .map((k) => {
                  const cs = 観点の記録(k.id);
                  return (
                    <div key={k.id} id={k.番号} className={`kanten${cs.length === 0 ? " empty" : ""}`}>
                      <div className="kanten-head">
                        <span className="no">{k.番号}</span>
                        <span className="title">{k.表示名}</span>
                        {k.品目で変わる && <span className="tag">品目で変わる</span>}
                        {cs.length === 0 && <span className="nothing">まだ記録がない</span>}
                      </div>
                      {cs.length > 0 && (
                        <div className="cards">
                          {cs.map((c, i) => (
                            <Card
                              key={i}
                              c={c}
                              今日={今日}
                              手続きが合う={手続きが合う(c)}
                              品目={品目で見る(c, 観点map.get(c.観点))}
                              選んだ品目={品目}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4 2.5 L7.5 6 L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function OutLink() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M5 2.5 H2.5 V9.5 H9.5 V7 M7 2.5 H9.5 V5 M9.5 2.5 L5.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Card({
  c,
  今日,
  手続きが合う,
  品目,
  選んだ品目,
}: {
  c: カード;
  今日: Date;
  手続きが合う: boolean;
  品目: 品目判定;
  選んだ品目: string;
}) {
  const 古い = 再確認か(c.確認日, 今日);
  const 薄く = !手続きが合う || 品目 === "合わない";
  const cls = `card ${c.種別}${古い ? " recheck" : ""}${薄く ? " faded" : ""}${品目 === "合う" && !薄く ? " match" : ""}`;
  const 添え書き: string[] = [];
  if (!手続きが合う) 添え書き.push(`この答えは${c.対象.join("・")}のとき`);
  if (品目 === "合わない" && c.品目) 添え書き.push(`この答えは${c.品目.join("・")}の品目のとき`);

  return (
    <article className={cls}>
      <div className="card-body">
        <div className="card-top">
          <span className={`label ${c.種別}`}>{c.種別}</span>
          {古い && <span className="label 再確認">再確認</span>}
          {品目 === "合う" && !薄く && <span className="label 当てはまる">{選んだ品目}に当てはまる</span>}
          {添え書き.length > 0 && <span className="note">{添え書き.join("。")}</span>}
        </div>

        <p className="a">{c.本文}</p>

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
                <span>
                  {c.出典.文書} PDF {c.出典.物理ページ}ページ目
                </span>
              )}
              <span style={{ color: "var(--sub)", fontSize: 12 }}>照合：{c.出典.照合}</span>
            </div>
          </>
        )}

        {c.問い && <div className="q">問い　{c.問い}</div>}
        {c.探した語 && <div className="q">探した語　{c.探した語.join("、")}</div>}

        <div className="meta">
          {c.確認日 && (
            <span>
              <b>確認日</b>
              {表示日(c.確認日)}
            </span>
          )}
          {c.受理年 && (
            <span>
              <b>受理</b>
              {c.受理年}年
            </span>
          )}
          {c.窓口 && (
            <span>
              <b>窓口</b>
              {c.窓口}
            </span>
          )}
          {c.対象.length > 0 && (
            <span>
              <b>対象</b>
              {c.対象.join("・")}
            </span>
          )}
          {c.品目 && (
            <span>
              <b>品目</b>
              {c.品目.join("・")}
            </span>
          )}
        </div>

        {c.手引きへの参照 && (
          <div className="ref">
            {c.手引きへの参照.url ? (
              <a href={c.手引きへの参照.url} target="_blank" rel="noopener noreferrer">
                手引き p.{c.手引きへの参照.ページ} を見る
              </a>
            ) : (
              <span>手引き p.{c.手引きへの参照.ページ} を見る</span>
            )}
            {c.手引きへの参照.url && <OutLink />}
            {c.手引きへの参照.内容 && <span style={{ color: "var(--sub)", fontSize: 12 }}>{c.手引きへの参照.内容}</span>}
          </div>
        )}
      </div>

      {c.種別 === "電話" && c.確認日 && (
        <div className="band">{年月(c.確認日)}に電話で確認した内容。公式見解ではない。申請前に再確認すること</div>
      )}
      {c.種別 === "同業者" && <div className="band">同業者から聞いた参考情報。公式見解ではない。申請前に再確認すること</div>}
    </article>
  );
}

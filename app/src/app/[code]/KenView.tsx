"use client";

// 県ページの中身。手続き・品目の切り替え、「再確認」、チェックリストは、見た人の画面で計算する。
import { useEffect, useState } from "react";
import type { カード } from "@/lib/data";
import { 判定の文, 判定の札, 札に出す判定, 見立てに出す判定, 見立ての順, 記録が薄い, type 選び } from "@/lib/fuda";
import type { 観点 } from "../../../schema/record.ts";
import { 再確認か, 経過日数, 年月, 表示日, 日付に, 今日の文字 } from "@/lib/hizuke";
import { 手続き一覧, 既定の手続き, 品目で見る as 品目の判定, 手続きが合う as 手続きの判定, type 手続き, type 品目判定 } from "@/lib/hantei";

type Props = {
  県名: string;
  /** この県の様式で、手元で下書きできるもの（様式に書く画面へ案内する） */
  書ける様式: string[];
  /** 下書きできる県の名前（対応表のある県） */
  書ける県: string[];
  /** 県の産廃収集運搬業のページ。様式はここから取ってくる */
  様式の入口: string | null;
  県コード: string;
  手引きの状態: string;
  改訂: { 日付: string; 内容: string[] } | null;
  読んだ日: string | null;
  観点候補: { 名前: string; 主張?: string; 文書?: string; 物理ページ?: number; 引用: string; url?: string }[];
  照合の内訳: Record<string, number>;
  観点一覧: 観点[];
  品目一覧: { id: string; 建設系: boolean }[];
  付加区分: string[];
  カード: カード[];
  /** この県の中の政令市の記録。許可権者が違うので、県の記録・チェックリスト・揺れとは混ぜない */
  政令市: { コード: string; 名前: string; カード: カード[] }[];
  書き出し日: string;
};

const 状態の説明: Record<string, string> = {
  検品済み: "手引きは読み込み済みで、引用は人が出典と照合しました",
  照合済み: "手引きは自動で読み、引用はすべて出典の本文と機械で照合できました（人の検品はまだです）",
  未検品: "手引きは自動で読みましたが、出典と照合できていない引用があります（未検品）",
  未確認: "手引きは手元にありますが、未確認です",
  未読: "手引きはまだ読んでいません",
};

export default function KenView({
  県名,
  書ける様式,
  書ける県,
  様式の入口,
  県コード,
  手引きの状態,
  改訂,
  読んだ日,
  観点候補,
  照合の内訳,
  観点一覧,
  品目一覧,
  付加区分,
  カード: 全カード,
  政令市,
  書き出し日,
}: Props) {
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

  // 判定は府県くらべと同じもの（@/lib/hantei）を使う
  const 品目で見る = (c: カード, k: 観点 | undefined): 品目判定 => 品目の判定(c, k, 品目, 品目一覧);
  const 手続きが合う = (c: カード) => 手続きの判定(c, 手続き);

  const 観点の記録 = (id: string) => 全カード.filter((c) => c.観点 === id);
  const 観点map = new Map(観点一覧.map((k) => [k.id, k]));
  // 札を出す組・見比べを出す組の決まりは府県くらべと同じ（@/lib/fuda）
  const 今の選び: 選び = { 手続き, 品目, 品目一覧 };

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
      // 県の手引きを読んでいても、この観点の記録も「載っていない」の印も無いことがある（読み落としか、別の手続きの話だけ）
      let 理由 =
        手引きの状態 === "未読" || 手引きの状態 === "未確認" ? "手引きをまだ読んでいません" : "手引きからは、この観点の記録が取れていません";
      if (cs.some((c) => c.種別 === "記載なし")) 理由 = "手引きを読みましたが、載っていません";
      if (使える.some((c) => c.種別 === "電話")) 理由 = "前回の電話から1年を超えました";
      else if (使える.some((c) => c.種別 === "手引き")) 理由 = "手引きの記録はありますが、出典と照合できていません";
      else if (cs.some((c) => c.種別 === "電話" || c.種別 === "受理実績"))
        理由 = `記録はありますが、${手続き}${品目 ? `・${品目}` : ""}には当てはまりません`;
      return { k, 理由 };
    })
    .filter((x) => x !== null);

  // 事業者さんの状況で変わること：手引きに書いてあっても、排出事業者・運搬先が未定などで答えが変わるので、いつも電話で確かめる問い。
  // 手引きの記録（照合一致）は「手引きには」として添える。決まっていないときの書き方らしい記載があれば、そう添える
  const 未定に触れる = /特定でき|未定|決まっていな|決まらな|定まっていな/;
  const 状況 = 観点一覧
    .filter((k) => !!k.状況で変わる問い)
    .map((k) => {
      const 手引き = 観点の記録(k.id).filter(
        (c) => c.種別 === "手引き" && !!c.出典?.照合.startsWith("一致") && 手続きが合う(c) && 品目で見る(c, k) !== "合わない",
      );
      const 触れる = 手引き.find((c) => 未定に触れる.test(`${c.本文}${c.出典?.引用 ?? ""}`));
      return { k, 手引き: 触れる ?? 手引き[0] ?? null, 触れる: !!触れる };
    });
  const 聞く数 = チェック.length + 状況.length;

  // チェックリストを文字にしてクリップボードへ。電話を5分にするための手元の紙
  const [写した, set写した] = useState("");
  async function 書き写す() {
    const 行 = [`${県名}　電話で聞くこと（${手続き}${品目 ? `・${品目}` : ""}）　${表示日(今日の文字(今日))}`, ""];
    let n = 1;
    for (const g of 群順) {
      const items = チェック.filter((x) => x.k.群 === g);
      if (items.length === 0) continue;
      行.push(`■ ${g}`);
      for (const { k } of items) 行.push(`${n++}. ${k.電話で聞く文}`, "   答え：", "");
    }
    if (状況.length) {
      行.push("■ 事業者さんの状況で変わること（手引きに書いてあっても確かめる）");
      for (const { k, 手引き, 触れる } of 状況) {
        行.push(`${n++}. ${k.状況で変わる問い}`);
        if (手引き?.出典) 行.push(`   手引きには：${手引き.本文}（PDF ${手引き.出典.物理ページ}ページ目）${触れる ? "　決まっていないときの書き方らしい記載あり" : ""}`);
        行.push("   答え：", "");
      }
    }
    行.push("聞いた日と窓口（課名）だけ残し、担当者の名前は書かない");
    try {
      // アプリ（desktop）ではアプリの口で書く。ブラウザでは navigator.clipboard
      const 口 = (window as unknown as { yomidokoro?: { 書き写す?: (t: string) => Promise<boolean> } }).yomidokoro?.書き写す;
      if (口) {
        if (!(await 口(行.join("\n")))) throw new Error("写せない");
      } else await navigator.clipboard.writeText(行.join("\n"));
      set写した(`${聞く数}件をコピーしました。Notion の議事録やメモ帳に貼り付けてください`);
    } catch {
      set写した("コピーできませんでした。この画面の文字を選んでコピーしてください");
    }
  }

  // 印刷用：選んだ手続き・品目に当てはまる記録だけを、観点ごとに出典ページつきで並べる
  const 印刷の出典 = (c: カード) => {
    if (c.種別 === "手引き" && c.出典)
      return `${c.出典.文書名 ?? c.出典.文書}　PDF ${c.出典.物理ページ}ページ目${c.出典.印字ページ ? `（印字 p.${c.出典.印字ページ}）` : ""}`;
    if (c.種別 === "電話") return `電話　${c.確認日 ? 表示日(c.確認日) : ""}${c.窓口 ? `　${c.窓口}` : ""}${c.見本 ? "（見本）" : ""}`;
    if (c.種別 === "受理実績") return `受理実績　${c.受理年 ?? ""}年`;
    if (c.種別 === "補正") return `補正　${c.年 ?? ""}年`;
    return c.種別;
  };
  const 印刷の観点 = 観点一覧
    .filter((k) => k.id !== "未分類")
    .map((k) => ({
      k,
      cs: 観点の記録(k.id).filter(
        (c) =>
          c.種別 !== "記載なし" &&
          手続きが合う(c) &&
          品目で見る(c, k) !== "合わない" &&
          (c.種別 !== "手引き" || !!c.出典?.照合.startsWith("一致")),
      ),
      聞く: チェック.some((x) => x.k.id === k.id),
    }));

  // 補正：手続き・品目に当てはまるものを上に、当てはまらないものは薄く下に
  const 当てはまる = (c: カード) => 手続きが合う(c) && 品目で見る(c, 観点map.get(c.観点)) !== "合わない";
  const 補正 = 全カード.filter((c) => c.種別 === "補正");
  const 補正の並び = [...補正.filter(当てはまる), ...補正.filter((c) => !当てはまる(c))];
  const 手引きに明記 = new Set(
    全カード.filter((c) => c.種別 === "手引き" && c.出典?.照合.startsWith("一致")).map((c) => c.観点),
  );
  const 未分類 = 全カード.filter((c) => c.観点 === "未分類");

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
      <p className="hk-entry">
        <a href={`/hikaku/?${new URLSearchParams({ 観点: "排出事業者", ...(品目 ? { 品目 } : {}), 手続き }).toString()}`}>府県くらべ</a>
        <span className="hint">同じ観点を、ほかの府県と並べて見られます</span>
      </p>
      {改訂 && (
        <div className="kaitei-band" role="alert">
          <div className="kaitei-title">
            手引きが改訂されたかもしれません（{表示日(改訂.日付)}に検知）。読み直してください
          </div>
          <ul>
            {改訂.内容.slice(0, 6).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <div className="kaitei-how">
            読み直すまで、手引きから取った記録には「再確認」の印を付けています。読み直す手順：npm run 取得 -- {県コード} のあと npm run 読む -- {県コード}
          </div>
        </div>
      )}
      <p className="lead">
        {県名}の手引きの要点を、観点{観点一覧.length}項目ごとに出典つきで並べ、電話で聞いた答え・受理実績と分けて置いています。道具は判断しません。判断は行政書士がします。
      </p>
      <p className="lead lead-sub">
        {状態の説明[手引きの状態]}
        {読んだ日
          ? `（${表示日(読んだ日)}に読みました。照合：${Object.entries(照合の内訳)
              .map(([k, v]) => `${k} ${v}`)
              .join("、")}）`
          : ""}
        。
        {政令市.length > 0 &&
          `${政令市.map((s) => s.名前).join("・")}（政令市）の窓口で聞いた記録は、許可権者が違うので${県名}の記録とは分けて、下の${政令市.map((s) => `「${s.名前}（政令市）の窓口」`).join("・")}に置いています。`}
      </p>

      <p className="print-entry">
        <button type="button" onClick={() => window.print()}>
          印刷用の一覧を印刷する
        </button>
        <span className="hint">
          {手続き}
          {品目 ? `・${品目}` : ""}のときの要点と出典ページ、電話で聞くことを紙にまとめます（下で手続き・品目を選び直すと変わります）
        </span>
      </p>

      {書ける様式.length > 0 ? (
        <p className="to-form">
          <a href={`/shoshiki/?県=${県コード}`}>{県名}の申請書に下書きする</a>
          <span>
            {書ける様式.join("・")}に、事業者の情報をこのパソコンの中だけで書き込めます（Claude にもインターネットにも送りません）
          </span>
        </p>
      ) : (
        <div className="to-form to-form-not-yet" data-testid="まだ書けない">
          <strong>{県名}の申請書は、まだ下書きできません</strong>
          <span>
            今、下書きできるのは{書ける県.join("・")}の様式です。様式は県ごとに形が違うので、どこに何を書くかの対応表を県ごとに作り、架空の事業者で試して人の目で確かめた様式だけを書けるようにしています。
            {県名}の様式は
            {様式の入口 ? (
              <a href={様式の入口} target="_blank" rel="noreferrer">
                県のページ
              </a>
            ) : (
              "県のページ"
            )}
            から取ってきてください。
          </span>
        </div>
      )}

      <nav className="toc-mobile" aria-label="目次">
        <a href="#checklist">電話で聞くこと</a>
        <a href="#hosei">補正になったこと</a>
        {群順.map((g) => (
          <a key={g} href={`#${群id(g)}`}>
            {g}
          </a>
        ))}
        {政令市.map((s) => (
          <a key={s.コード} href={`#c${s.コード}`}>
            {s.名前}（政令市）
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
            <div className="hint">選んだ手続きに当てはまる記録だけで、チェックリストを作ります。</div>
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
                ? `${選んだ品目.id}は${選んだ品目.建設系 ? "建設系にもなりうる品目" : "建設系以外の品目"}として見ます。`
                : "品目で答えが変わる観点で、当てはまる記録を目立たせます。"}
            </div>
          </div>
          <nav className="panel toc" aria-label="目次">
            <div className="panel-title">目次</div>
            <ol>
              <li>
                <a href="#checklist">
                  電話で聞くこと<span className="num">{聞く数}</span>
                </a>
              </li>
              <li>
                <a href="#hosei">
                  補正になったこと<span className="num">{補正.filter(当てはまる).length}</span>
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
              {政令市.map((s) => (
                <li key={s.コード}>
                  <a href={`#c${s.コード}`}>
                    {s.名前}（政令市）の窓口
                    <span className="num">{s.カード.length}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div>
          <section className="checklist" id="checklist">
            <h2>
              電話で聞くことのチェックリスト<span className="cnt">{聞く数}件</span>
            </h2>
            <div className="lead" style={{ margin: 0 }}>
              {手続き}のときに、手引き（出典と照合済み）・受理実績・1年以内の電話のどれも無い観点です。電話で答えが入ると消えます。下の「事業者さんの状況で変わること」は、手引きに書いてあっても毎回確かめる問いです。
            </div>
            {聞く数 > 0 && (
              <div className="checklist-tools">
                <button type="button" onClick={() => void 書き写す()}>
                  聞くことをコピーする
                </button>
                <span>{写した || "押すと、聞くことの一覧がコピーされます。Notion の議事録やメモ帳に貼り付けて、電話をしながら答えを書き込めます"}</span>
              </div>
            )}
            {聞く数 === 0 && <p className="empty-all">聞くことは残っていません。</p>}
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
            {状況.length > 0 && (
              <details className="jokyo" data-testid="状況で変わること" open>
                <summary>
                  <Chevron />
                  事業者さんの状況で変わること
                  <span className="n">{状況.length}件</span>
                </summary>
                <p className="jokyo-lead">
                  手引きに記載例があっても、排出事業者や運搬先がまだ決まっていないときの書き方は、手引きだけでは分からないことが多いところです。事業者さんの状況に合わせて確かめてください。
                </p>
                <ol>
                  {状況.map(({ k, 手引き, 触れる }) => (
                    <li key={k.id}>
                      <span className="ask">{k.状況で変わる問い}</span>
                      <span className="why">
                        <a href={`#${k.番号}`}>
                          {k.番号} {k.表示名}
                        </a>
                        　
                        {手引き?.出典
                          ? `手引きには：${手引き.本文}（PDF ${手引き.出典.物理ページ}ページ目）`
                          : "手引きからは、この観点の記録が取れていません"}
                        {触れる && <strong className="jokyo-hit">　手引きに、決まっていないときの書き方らしい記載があります。念のための確かめです</strong>}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>

          <section className="hosei" id="hosei">
            <h2>
              この県で補正になったこと<span className="cnt">{補正.filter(当てはまる).length}件</span>
            </h2>
            <div className="lead" style={{ margin: 0 }}>
              出す前に見直すところです。審査で直すよう言われた点と、どう直して通ったかを載せています。{手続き}
              {品目 ? `・${品目}` : ""}に当てはまらないものは薄くして下に置いています。
            </div>
            {補正の並び.length === 0 ? (
              <p className="empty-all">まだ補正の記録がありません。</p>
            ) : (
              <div className="cards">
                {補正の並び.map((c, i) => {
                  const k = 観点map.get(c.観点);
                  return (
                    <div key={i}>
                      <div className="kanten-name">
                        {k ? (
                          <a href={`#${k.番号}`}>
                            {k.番号} {k.表示名}
                          </a>
                        ) : (
                          <>未分類（候補：{c.候補観点}）</>
                        )}
                      </div>
                      <Card
                        c={c}
                        今日={今日}
                        手続きが合う={手続きが合う(c)}
                        品目={品目で見る(c, k)}
                        選んだ品目={品目}
                        選び={今の選び}
                        観点={観点map.get(c.観点)}
                        分かりにくい={手引きに明記.has(c.観点)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="legend" style={{ marginTop: 18 }}>
            <span className="label 手引き">手引き</span>
            <span className="label 受理実績">受理実績</span>
            <span className="label 電話">電話</span>
            <span className="label 同業者">同業者</span>
            <span className="label 補正">補正</span>
            <span className="label 記載なし">記載なし</span>
            <span className="label 再確認">再確認</span>
            <span>確認から1年を超えた記録</span>
          </div>
          <div className="legend">
            <span className="label 判定 食い違い">揺れあり、要確認</span>
            <span className="label 判定 補足">電話で補足</span>
            <span className="label 判定 一致">手引きと一致</span>
            <span className="label 判定 判定不能">判定不能</span>
            <span>電話の答えと手引きを Claude が見比べた印です。補足と揺れは、観点の下の「見比べ」に理由が出ます</span>
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
                        {cs.length === 0 && <span className="nothing">まだ記録がありません</span>}
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
                              選び={今の選び}
                              観点={観点map.get(c.観点)}
                              分かりにくい={c.種別 === "補正" && 手引きに明記.has(c.観点)}
                            />
                          ))}
                        </div>
                      )}
                      <Mikurabe cs={cs} 観点={k} 選び={今の選び} />
                    </div>
                  );
                })}
            </section>
          ))}

          {政令市.map((s) => {
            // 観点の並びは県と同じにするが、県の記録とは比べない（許可権者が違うので揺れとして数えない）
            const 並び = [
              ...観点一覧.map((k) => ({ k, cs: s.カード.filter((c) => c.観点 === k.id) })),
              { k: undefined, cs: s.カード.filter((c) => c.観点 === "未分類") },
            ].filter((x) => x.cs.length > 0);
            return (
              <section key={s.コード} className="group seireishi" id={`c${s.コード}`}>
                <h2>
                  {s.名前}（政令市）の窓口<span className="cnt">{s.カード.length}件</span>
                </h2>
                <p className="lead">
                  {s.名前}の窓口で聞いた記録です。許可権者が{県名}とは別なので、{県名}の記録と並べても食い違い（揺れ）としては数えません。上のチェックリストにも入れていません。
                </p>
                {並び.map(({ k, cs }) => (
                  <div key={k?.id ?? "未分類"} className="kanten">
                    <div className="kanten-head">
                      {k ? (
                        <>
                          <span className="no">{k.番号}</span>
                          <span className="title">{k.表示名}</span>
                          {k.品目で変わる && <span className="tag">品目で変わる</span>}
                        </>
                      ) : (
                        <span className="title">観点に無い話（未分類）</span>
                      )}
                    </div>
                    <div className="cards">
                      {cs.map((c, i) => (
                        <div key={i}>
                          {!k && (
                            <div className="kanten-name" style={{ fontSize: 12, color: "var(--sub)" }}>
                              候補：{c.候補観点}
                            </div>
                          )}
                          <Card
                            c={c}
                            今日={今日}
                            手続きが合う={手続きが合う(c)}
                            品目={k ? 品目で見る(c, k) : "関係なし"}
                            選んだ品目={品目}
                            選び={今の選び}
                            観点={観点map.get(c.観点)}
                            分かりにくい={false}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}

          {観点候補.length > 0 && (
            <section className="group" id="kouho">
              <h2>手引きにある、この県だけの決まり（観点候補）</h2>
              <p className="lead">観点の一覧には無いものの、手引きに書かれていた独自のルールです。よく使うものは観点に足します。</p>
              <div className="cards">
                {観点候補.map((c, i) => (
                  <article key={i} className="card 手引き">
                    <div className="card-body">
                      <div className="card-top">
                        <span className="label 手引き">手引き</span>
                        <span className="note">{c.名前}</span>
                      </div>
                      {c.主張 && <p className="a">{c.主張}</p>}
                      <blockquote>{c.引用}</blockquote>
                      {c.物理ページ && (
                        <div className="ref">
                          {c.url ? (
                            <a href={c.url} target="_blank" rel="noopener noreferrer">
                              {c.文書} PDF {c.物理ページ}ページ目
                            </a>
                          ) : (
                            <span>
                              {c.文書} PDF {c.物理ページ}ページ目
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {未分類.length > 0 && (
            <section className="group" id="mibunrui">
              <h2>観点に無い話（未分類）</h2>
              <p className="lead">観点の一覧に当てはまらなかった記録です。よく出るものは観点に足します。</p>
              <div className="cards">
                {未分類.map((c, i) => (
                  <div key={i}>
                    <div className="kanten-name" style={{ fontSize: 12, color: "var(--sub)" }}>
                      候補：{c.候補観点}
                    </div>
                    <Card c={c} 今日={今日} 手続きが合う={手続きが合う(c)} 品目="関係なし" 選んだ品目={品目} 選び={今の選び} 観点={観点map.get(c.観点)} 分かりにくい={false} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* 印刷のときだけ出る。画面では隠す（globals.css の .ken-print） */}
      <section className="ken-print" aria-hidden="true">
        <h1>
          {県名}　産業廃棄物収集運搬業　要点と出典
        </h1>
        <p className="kp-meta">
          {手続き}
          {品目 ? `・${品目}` : ""}　印刷した日 {表示日(今日の文字(今日))}　{状態の説明[手引きの状態]}
        </p>
        <p className="kp-meta">ページは PDF の何枚目か。申請の前に、必ず手引きと窓口で確かめてください。道具は判断しません。</p>
        {群順.map((g) => {
          const ks = 印刷の観点.filter((x) => x.k.群 === g && (x.cs.length > 0 || x.聞く));
          if (ks.length === 0) return null;
          return (
            <div key={g} className="kp-group">
              <h2>{g}</h2>
              {ks.map(({ k, cs, 聞く }) => (
                <div key={k.id} className="kp-item">
                  <h3>
                    <span className="kp-check" />
                    {k.表示名}
                  </h3>
                  {cs.map((c, i) => (
                    <p key={i} className="kp-rec">
                      {c.本文}
                      <span className="kp-src">［{印刷の出典(c)}］</span>
                    </p>
                  ))}
                  {聞く && (
                    <p className="kp-ask">
                      電話で聞く：{k.電話で聞く文}
                      <span className="kp-line">答え</span>
                    </p>
                  )}
                  {k.状況で変わる問い && (
                    <p className="kp-ask">
                      状況で変わるので確かめる：{k.状況で変わる問い}
                      <span className="kp-line">答え</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        <p className="kp-foot">聞いた日と窓口（課名）だけを残し、担当者の名前は書かない。よみどころ</p>
      </section>
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
  分かりにくい,
  選び,
  観点: k,
}: {
  c: カード;
  今日: Date;
  手続きが合う: boolean;
  品目: 品目判定;
  選んだ品目: string;
  分かりにくい: boolean;
  選び: 選び;
  観点: 観点 | undefined;
}) {
  const 古い = 再確認か(c.確認日, 今日) || !!c.改訂;
  const 照合 = c.出典?.照合;
  const 照合の札 =
    照合 === "一致"
      ? { cls: "照合済み", 文: "出典と照合済み" }
      : 照合 === "一致（ページ訂正）"
        ? { cls: "照合済み", 文: "出典と照合済み（ページ訂正）" }
        : 照合 === "近似（要目視）"
          ? { cls: "近似", 文: "照合：近似（要目視）" }
          : 照合 === "不一致"
            ? { cls: "不一致", 文: "照合：不一致" }
            : null;
  const 薄く = !手続きが合う || 品目 === "合わない";
  const 印たち = 判定の札(札に出す判定(c.判定 ?? [], 薄く, k, 選び), c.種別 === "手引き");
  const 揺れ = 印たち.some((x) => x.判定 === "食い違い" && !x.解消);
  const cls = `card ${c.種別}${揺れ ? " yure" : ""}${古い ? " recheck" : ""}${薄く ? " faded" : ""}${品目 === "合う" && !薄く ? " match" : ""}${照合 === "不一致" ? " mismatch" : ""}`;
  const 添え書き: string[] = [];
  if (!手続きが合う) 添え書き.push(`この答えは${c.対象.join("・")}のとき`);
  if (品目 === "合わない" && c.品目) 添え書き.push(`この答えは${c.品目.join("・")}の品目のとき`);

  return (
    <article className={cls}>
      <div className="card-body">
        <div className="card-top">
          <span className={`label ${c.種別}`}>{c.種別}</span>
          {c.見本 && <span className="label 見本">見本</span>}
          {古い && <span className="label 再確認">再確認</span>}
          {印たち.map((x) => (
            <span key={x.判定 + x.文} className={`label 判定 ${x.判定}${x.解消 ? " 解消" : ""}`} title={x.理由たち.join("\n")}>
              {x.文}
              {x.解消 ? "・確かめ済み" : ""}
            </span>
          ))}
          {照合の札 && <span className={`label ${照合の札.cls}`}>{照合の札.文}</span>}
          {c.足した && <span className="note">Claude が拾えず、{c.足した}が手引きを見て足した記録</span>}
          {c.改訂 && <span className="note">手引きの改訂を検知。読み直すまで再確認</span>}
          {分かりにくい && <span className="label 分かりにくい">手引きが分かりにくい所</span>}
          {品目 === "合う" && !薄く && <span className="label 当てはまる">{選んだ品目}に当てはまる</span>}
          {添え書き.length > 0 && <span className="note">{添え書き.join("。")}</span>}
        </div>

        <p className="a">{c.本文}</p>
        {c.直し方 && (
          <div className="fix">
            <b>直し方</b>
            {c.直し方}
          </div>
        )}

        {c.出典 && (
          <>
            <blockquote>{c.出典.引用}</blockquote>
            <div className="ref">
              <span style={{ color: "var(--sub)", fontSize: 12 }}>出典</span>
              {c.出典.url ? (
                <a href={`${c.出典.url}#page=${c.出典.物理ページ}`} target="_blank" rel="noopener noreferrer">
                  {c.出典.文書名 ?? c.出典.文書}　PDF {c.出典.物理ページ}ページ目
                  {c.出典.印字ページ ? `（印字 p.${c.出典.印字ページ}）` : ""}
                </a>
              ) : (
                <span>
                  {c.出典.文書名 ?? c.出典.文書}　PDF {c.出典.物理ページ}ページ目
                  {c.出典.印字ページ ? `（印字 p.${c.出典.印字ページ}）` : ""}
                </span>
              )}
              {c.出典.url && <OutLink />}
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
          {c.年 && (
            <span>
              <b>年</b>
              {c.年}年
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
                {c.手引きへの参照.物理ページ && c.手引きへの参照.物理ページ !== c.手引きへの参照.ページ
                  ? `（PDF ${c.手引きへの参照.物理ページ}ページ目）`
                  : ""}
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
        <div className="band">{年月(c.確認日)}に電話で確認した内容です。公式見解ではありません。申請前に再確認してください</div>
      )}
      {c.種別 === "補正" && c.年 && (
        <div className="band">{c.年}年に審査で指摘された内容です。運用は変わることがあります。申請前に再確認してください</div>
      )}
      {c.種別 === "同業者" && <div className="band">同業者から聞いた参考情報です。公式見解ではありません。申請前に再確認してください</div>}
    </article>
  );
}

// ---- 揺れの印（ケンの判定）。札の言葉と並べ方は @/lib/fuda（府県くらべと共用） ----

type 見比べの側 = { 種別: string; 本文: string; 問い?: string; 確認日: string | null; 窓口?: string; ページ?: string; url?: string };

/** 観点の中で、補足と揺れの組を、二つの記録を並べて理由一行で見せる */
function Mikurabe({ cs, 観点: k, 選び }: { cs: カード[]; 観点: 観点; 選び: 選び }) {
  // 出す組は府県くらべの見立てと同じ：電話も相手も、選んだ手続き・品目に当てはまる揺れと補足だけ
  const 組 = cs.flatMap((c) =>
    見立てに出す判定(c.判定 ?? [], 記録が薄い(c, k, 選び), k, 選び).map((j) => ({ 電話: c as 見比べの側, j })),
  );
  if (組.length === 0) return null;
  組.sort((a, b) => 見立ての順(a.j, b.j));
  return (
    <div className="mikurabe">
      <div className="mikurabe-title">見比べ（Claude の見立て）</div>
      {組.map(({ 電話, j }, i) => (
        <div key={i} className={`mikurabe-pair ${j.判定}${j.解消 ? " 解消" : ""}`}>
          <div className="mikurabe-head">
            <span className={`label 判定 ${j.判定}${j.解消 ? " 解消" : ""}`}>
              {判定の文(j.判定, j.種類)}
              {j.解消 ? "・確かめ済み" : ""}
            </span>
            <span className="mikurabe-why">{j.理由}</span>
          </div>
          <div className="mikurabe-two">
            {/* 手引きと電話は、手引きを左に。電話どうしは、前の電話を左に */}
            <Kata x={j.相手} 見出し={j.種類 === "電話どうし" ? "前の電話" : "手引き"} />
            <Kata x={電話} 見出し={j.種類 === "電話どうし" ? "あとの電話" : "電話"} />
          </div>
        </div>
      ))}
      <div className="mikurabe-note">
        二つの記録を並べて Claude が見立てた一行です。道具は判断しません。食い違うかどうかを決めるのは行政書士です。
      </div>
    </div>
  );
}

function Kata({ x, 見出し }: { x: 見比べの側; 見出し: string }) {
  return (
    <div className={`mikurabe-side ${x.種別}`}>
      <div className="mikurabe-side-top">
        <span className={`label ${x.種別}`}>{見出し}</span>
        {x.確認日 && <span className="note">{表示日(x.確認日)}</span>}
        {x.窓口 && <span className="note">{x.窓口}</span>}
      </div>
      <p>{x.本文}</p>
      {x.問い && <div className="q">問い　{x.問い}</div>}
      {x.ページ &&
        (x.url ? (
          <a className="ref" href={x.url} target="_blank" rel="noopener noreferrer">
            {x.ページ}
          </a>
        ) : (
          <span className="ref">{x.ページ}</span>
        ))}
    </div>
  );
}

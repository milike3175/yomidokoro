"use client";

// 府県くらべ：観点を一つ選ぶと、許可権者ごとの記録が縦に並ぶ。
// 手続き・品目が当てはまるかの判定は県ページと同じもの（@/lib/hantei）を使う。
import { useEffect, useState } from "react";
import type { カード } from "@/lib/data";
import type { 観点 } from "../../../schema/record.ts";
import { 再確認か, 表示日, 日付に } from "@/lib/hizuke";
import { 手続き一覧, 既定の手続き, 品目で見る, 手続きが合う, type 手続き, type 品目判定 } from "@/lib/hantei";

export type 行 = {
  コード: string;
  名前: string;
  /** その許可権者の記録が載っている県ページ（政令市は親の県のページ） */
  県ページ: string;
  /** 県ページの中の飛び先。空なら観点の番号へ飛ぶ */
  錨: string;
  手引きの状態: string;
  カード: カード[];
};

type Props = {
  行たち: 行[];
  観点一覧: 観点[];
  品目一覧: { id: string; 建設系: boolean }[];
  付加区分: string[];
  /** 手帳（電話・補正）を読んでいるか。公開用の書き出しでは false */
  手帳あり: boolean;
  書き出し日: string;
};

const 既定の観点 = "排出事業者";
/** 品目で答えが変わる観点のうち、選び肢の先頭に置く順（デモの山場から） */
const 先頭の順 = ["排出事業者", "運搬先", "品目表記", "性状", "石綿", "水銀", "破砕物", "写真要件"];

/** 一つの記録が、いまの選び方にどう当てはまるか。並べる順にも使う */
type 見え方 = { c: カード; 品目: 品目判定; 手続き: boolean; 薄く: boolean };

export default function HikakuView({ 行たち, 観点一覧, 品目一覧, 付加区分, 手帳あり, 書き出し日 }: Props) {
  const [観点id, set観点id] = useState<string>(既定の観点);
  const [手続き, set手続き] = useState<手続き>(既定の手続き);
  const [品目, set品目] = useState<string>("");
  const [今日, set今日] = useState<Date>(() => 日付に(書き出し日));

  useEffect(() => {
    set今日(new Date());
    const q = new URLSearchParams(window.location.search);
    const k = q.get("観点");
    if (k && 観点一覧.some((x) => x.id === k)) set観点id(k);
    const t = q.get("手続き");
    if (t && (手続き一覧 as readonly string[]).includes(t)) set手続き(t as 手続き);
    const h = q.get("品目");
    if (h && (品目一覧.some((x) => x.id === h) || 付加区分.includes(h))) set品目(h);
  }, [観点一覧, 品目一覧, 付加区分]);

  // 選んだものを URL に残す（静的書き出しでも動くよう、読み直さずに書き換えるだけ）
  function URLに残す(k: string, t: 手続き, h: string) {
    const q = new URLSearchParams();
    q.set("観点", k);
    if (h) q.set("品目", h);
    q.set("手続き", t);
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
  }
  const 観点を選ぶ = (k: string) => {
    set観点id(k);
    URLに残す(k, 手続き, 品目);
  };
  const 手続きを選ぶ = (t: 手続き) => {
    set手続き(t);
    URLに残す(観点id, t, 品目);
  };
  const 品目を選ぶ = (h: string) => {
    set品目(h);
    URLに残す(観点id, 手続き, h);
  };

  const k = 観点一覧.find((x) => x.id === 観点id) ?? 観点一覧[0];
  const 選んだ品目 = 品目一覧.find((x) => x.id === 品目);

  // 観点の選び肢：品目で変わる観点を先頭に、残りは群ごとに
  const 品目で変わる観点 = [
    ...先頭の順.map((id) => 観点一覧.find((x) => x.id === id)).filter((x): x is 観点 => !!x && x.品目で変わる),
    ...観点一覧.filter((x) => x.品目で変わる && !先頭の順.includes(x.id)),
  ];
  const 残り = 観点一覧.filter((x) => !品目で変わる観点.includes(x));
  const 群順: string[] = [];
  for (const x of 残り) if (!群順.includes(x.群)) 群順.push(x.群);

  const 見る = (c: カード): 見え方 => {
    const p = 品目で見る(c, k, 品目, 品目一覧);
    const t = 手続きが合う(c, 手続き);
    return { c, 品目: p, 手続き: t, 薄く: !t || p === "合わない" };
  };
  // 当てはまるもの（品目に合う）を上に、当てはまらないものは薄くして下に
  const 並べる = (xs: 見え方[]) => [
    ...xs.filter((x) => !x.薄く && x.品目 === "合う"),
    ...xs.filter((x) => !x.薄く && x.品目 !== "合う"),
    ...xs.filter((x) => x.薄く),
  ];

  const 右の種別 = new Set(["受理実績", "電話", "同業者", "補正"]);
  const 中身 = 行たち.map((r) => {
    const cs = r.カード.filter((c) => c.観点 === k.id);
    return {
      r,
      手引き: 並べる(cs.filter((c) => c.種別 === "手引き").map(見る)),
      記載なし: cs.find((c) => c.種別 === "記載なし"),
      右: 並べる(cs.filter((c) => 右の種別.has(c.種別)).map(見る)),
    };
  });
  // 公開用（手帳なし）で右側に出すもの（受理実績）が一件も無ければ、右の列ごと出さない
  const 右の列 = 手帳あり || 行たち.some((r) => r.カード.some((c) => c.種別 === "受理実績"));
  const 右の見出し = 手帳あり ? "電話・補正など" : "受理実績";

  const 当てはまる数 = (xs: 見え方[]) => xs.filter((x) => !x.薄く).length;
  const 手引きあり = 中身.filter((x) => 当てはまる数(x.手引き) > 0).length;
  const 記載なし数 = 中身.filter((x) => 当てはまる数(x.手引き) === 0 && x.記載なし).length;
  const 右あり = 中身.filter((x) => 当てはまる数(x.右) > 0).length;
  const 品目が効く = k.品目で変わる;
  const 条件 = `${手続き}${品目が効く && 品目 ? `・${品目}` : ""}`;

  return (
    <>
      <p className="back">
        <a href="/">全国の地図にもどる</a>
      </p>
      <h1>府県くらべ</h1>
      <p className="lead">
        観点を一つ選ぶと、記録のある府県と政令市の答えが並ぶ。左が手引きに書いてあること、右が{手帳あり ? "電話で聞いた答え・補正・受理実績" : "受理実績"}
        。選んだ手続き{品目が効く ? "・品目" : ""}に当てはまらない記録は薄くして下に置いた。道具は判断しない。判断は行政書士がする。
        {!手帳あり && "（公開版のため、電話で聞いた答えと補正は載せていない。手引きだけの比較になる）"}
      </p>

      <div className="hk-controls">
        <div className="panel">
          <label className="panel-title" htmlFor="hk-kanten">
            観点
          </label>
          <select id="hk-kanten" className="select" value={k.id} onChange={(e) => 観点を選ぶ(e.target.value)}>
            <optgroup label="品目で変わる観点">
              {品目で変わる観点.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.番号} {x.表示名}
                </option>
              ))}
            </optgroup>
            {群順.map((g) => (
              <optgroup key={g} label={g}>
                {残り
                  .filter((x) => x.群 === g)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.番号} {x.表示名}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="panel">
          <div className="panel-title">手続き</div>
          <div className="seg" role="group" aria-label="手続き">
            {手続き一覧.map((t) => (
              <button key={t} type="button" aria-pressed={手続き === t} onClick={() => 手続きを選ぶ(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <label className="panel-title" htmlFor="hk-hinmoku">
            品目
          </label>
          <select id="hk-hinmoku" className="select" value={品目} onChange={(e) => 品目を選ぶ(e.target.value)}>
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
            {!品目が効く
              ? "この観点は品目で答えが変わらないので、品目では絞らない。"
              : 選んだ品目
                ? `${選んだ品目.id}は${選んだ品目.建設系 ? "建設系にもなりうる品目" : "建設系以外の品目"}として見る。`
                : 品目
                  ? `${品目}に当てはまる記録を目立たせる。`
                  : "品目を選ぶと、当てはまる記録を目立たせ、当てはまらない記録を薄くする。"}
          </div>
        </div>
      </div>

      <div className="hk-title">
        <span className="no">{k.番号}</span>
        <span className="title">{k.表示名}</span>
        {品目が効く && <span className="tag">品目で変わる</span>}
        <span className="hk-cond">
          {手続き}
          {品目が効く && 品目 ? `・${品目}` : ""}
        </span>
      </div>
      <div className="summary hk-summary">
        <div>
          <b>{行たち.length}</b>記録のある府県・政令市
        </div>
        <div>
          <b>{手引きあり}</b>
          <span className="dot 手引き" />
          手引きに記載あり
        </div>
        <div>
          <b>{記載なし数}</b>手引きに記載なし
        </div>
        {右の列 && (
          <div>
            <b>{右あり}</b>
            <span className={`dot ${手帳あり ? "電話" : "受理実績"}`} />
            {手帳あり ? "電話・補正などあり" : "受理実績あり"}
          </div>
        )}
      </div>
      <p className="hint" style={{ margin: "4px 0 0" }}>
        数は、選んだ{手続き}
        {品目が効く && 品目 ? `・${品目}` : ""}に当てはまる記録がある府県・政令市の数。
      </p>
      <div className="legend" style={{ marginTop: 10 }}>
        <span className="label 手引き">手引き</span>
        <span className="label 受理実績">受理実績</span>
        {手帳あり && (
          <>
            <span className="label 電話">電話</span>
            <span className="label 同業者">同業者</span>
            <span className="label 補正">補正</span>
          </>
        )}
        <span className="label 記載なし">記載なし</span>
        <span className="label 再確認">再確認</span>
        <span>確認から1年を超えた記録</span>
      </div>

      <div className="hk-rows">
        {中身.map(({ r, 手引き, 記載なし, 右 }) => {
          const 飛び先 = `${r.県ページ}?${new URLSearchParams({ 手続き, ...(品目 ? { 品目 } : {}) }).toString()}#${r.錨 || k.番号}`;
          const 政令市 = r.コード.length === 5;
          return (
            <section key={r.コード} className={`hk-row${政令市 ? " shi" : ""}`} aria-label={r.名前}>
              <div className="hk-head">
                <h2>{r.名前}</h2>
                <a href={飛び先} className="hk-link">
                  {政令市 ? `${r.名前.replace("（政令市）", "")}の窓口の記録を見る` : `県ページの ${k.番号} を見る`}
                </a>
              </div>
              <div className={`hk-cols${右の列 ? "" : " one"}`}>
                <div className="hk-col">
                  <div className="hk-col-title">手引き</div>
                  {手引き.length > 0 ? (
                    <>
                      {当てはまる数(手引き) === 0 && <p className="hk-empty">{条件}に当てはまる記述はない</p>}
                      {手引き.map((x, i) => (
                        <小さなカード key={i} x={x} 今日={今日} 品目={品目} />
                      ))}
                    </>
                  ) : 記載なし ? (
                    <article className="card 記載なし">
                      <div className="card-body">
                        <div className="card-top">
                          <span className="label 記載なし">記載なし</span>
                        </div>
                        <p className="a">手引きに記載なし</p>
                        {記載なし.探した語 && <div className="q">探した語　{記載なし.探した語.join("、")}</div>}
                      </div>
                    </article>
                  ) : (
                    <p className="hk-empty">
                      {r.手引きの状態 === "未読" || r.手引きの状態 === "未確認" ? "手引きはまだ読んでいない" : "この観点の記録はまだない"}
                    </p>
                  )}
                </div>
                {右の列 && (
                  <div className="hk-col">
                    <div className="hk-col-title">{右の見出し}</div>
                    {右.length > 0 ? (
                      <>
                        {当てはまる数(右) === 0 && <p className="hk-empty">{条件}に当てはまる記録はない</p>}
                        {右.map((x, i) => (
                          <小さなカード key={i} x={x} 今日={今日} 品目={品目} />
                        ))}
                      </>
                    ) : (
                      <p className="hk-empty">{手帳あり ? "まだ聞いていない" : "まだ記録がない"}</p>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

/** 府県くらべ用の小さなカード。色と札は県ページのカードと同じ */
function 小さなカード({ x, 今日, 品目 }: { x: 見え方; 今日: Date; 品目: string }) {
  const { c } = x;
  const 古い = 再確認か(c.確認日, 今日) || !!c.改訂;
  const 照合 = c.出典?.照合;
  const 合う = x.品目 === "合う" && !x.薄く;
  const cls = `card ${c.種別}${古い ? " recheck" : ""}${x.薄く ? " faded" : ""}${合う ? " match" : ""}${照合 === "不一致" ? " mismatch" : ""}`;
  const 添え書き: string[] = [];
  if (!x.手続き) 添え書き.push(`${c.対象.join("・")}のとき`);
  if (x.品目 === "合わない" && c.品目) 添え書き.push(`${c.品目.join("・")}のとき`);

  return (
    <article className={cls}>
      <div className="card-body">
        <div className="card-top">
          <span className={`label ${c.種別}`}>{c.種別}</span>
          {古い && <span className="label 再確認">再確認</span>}
          {照合 === "近似（要目視）" && <span className="label 近似">照合：近似（要目視）</span>}
          {照合 === "不一致" && <span className="label 不一致">照合：不一致</span>}
          {合う && <span className="label 当てはまる">{品目}に当てはまる</span>}
          {添え書き.length > 0 && <span className="note">{添え書き.join("。")}</span>}
        </div>
        <p className="a">{c.本文}</p>
        {c.直し方 && (
          <div className="fix">
            <b>直し方</b>
            {c.直し方}
          </div>
        )}
        <div className="ref hk-src">
          <span style={{ color: "var(--sub)", fontSize: 12 }}>出典</span>
          <出典 c={c} />
        </div>
      </div>
    </article>
  );
}

function 出典({ c }: { c: カード }) {
  if (c.種別 === "手引き" && c.出典) {
    const s = c.出典;
    const 文 = `手引き ${s.印字ページ ? `p.${s.印字ページ}` : `PDF ${s.物理ページ}ページ目`}`;
    return s.url ? (
      <a href={`${s.url}#page=${s.物理ページ}`} target="_blank" rel="noopener noreferrer" title={s.文書名 ?? s.文書}>
        {文}
      </a>
    ) : (
      <span title={s.文書名 ?? s.文書}>{文}</span>
    );
  }
  if (c.種別 === "受理実績") return <span>受理実績 {c.受理年}年</span>;
  if (c.種別 === "補正") return <span>補正 {c.年}年{c.窓口 ? ` ${c.窓口}` : ""}</span>;
  // 電話・同業者：日付と窓口（課名）だけ。担当者の名前は持っていない
  return (
    <span>
      {c.種別} {c.確認日 ? 表示日(c.確認日) : ""}
      {c.窓口 ? ` ${c.窓口}` : ""}
    </span>
  );
}

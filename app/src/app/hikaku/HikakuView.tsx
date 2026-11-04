"use client";

// 府県くらべ：観点を一つ選ぶと、許可権者ごとの記録が縦に並ぶ。
// 手続き・品目が当てはまるかの判定は県ページと同じもの（@/lib/hantei）を使う。
import { useEffect, useRef, useState } from "react";
import type { カード, 判定の印 } from "@/lib/data";
import { 判定の文, 判定の札, 札に出す判定, 見立てに出す判定, 見立ての順, type 選び } from "@/lib/fuda";
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
type 見え方 = {
  c: カード;
  品目: 品目判定;
  手続き: boolean;
  薄く: boolean;
  /** 札に出す判定。記録が当てはまるときは、相手の記録も選んだ手続き・品目に当てはまる組だけ */
  判定: 判定の印[];
  /** 段の下に理由の一行を出す組 */
  見立て: 判定の印[];
};

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

  // 札を出す組・理由の一行を出す組の決まりは県ページと同じ（@/lib/fuda）
  const 今の選び: 選び = { 手続き, 品目, 品目一覧 };
  const 見る = (c: カード): 見え方 => {
    const p = 品目で見る(c, k, 品目, 品目一覧);
    const t = 手続きが合う(c, 手続き);
    const 薄く = !t || p === "合わない";
    const js = c.判定 ?? [];
    return { c, 品目: p, 手続き: t, 薄く, 判定: 札に出す判定(js, 薄く, k, 今の選び), 見立て: 見立てに出す判定(js, 薄く, k, 今の選び) };
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
  // 公開用（手帳なし）で右側に出すもの（見本の電話・受理実績）が一件も無ければ、右の列ごと出さない
  const 右の列 = 手帳あり || 行たち.some((r) => r.カード.some((c) => 右の種別.has(c.種別)));
  const 右の見出し = 手帳あり ? "電話・補正など" : "電話（見本）・受理実績";

  const 当てはまる数 = (xs: 見え方[]) => xs.filter((x) => !x.薄く).length;
  // 段の下に出す見立て：電話の側（主）の、揺れと補足だけ。両方の記録が選んだ手続き・品目に当てはまる組に限る
  const 見立て = (xs: 見え方[]) => xs.flatMap((x) => x.見立て).sort(見立ての順);
  const 判定あり = 行たち.some((r) => r.カード.some((c) => (c.判定 ?? []).length > 0));
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
        観点を一つ選ぶと、記録のある府県と政令市の答えが並ぶ。左が手引きに書いてあること、右が{手帳あり ? "電話で聞いた答え・補正・受理実績" : "電話で聞いた答え（見本）・受理実績"}
        。選んだ手続き{品目が効く ? "・品目" : ""}に当てはまらない記録は薄くして下に置いた。道具は判断しない。判断は行政書士がする。
        {!手帳あり && "（公開版では、作者の電話記録のうち大阪の7件だけを見本として載せている）"}
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
            <span className="dot 電話" />
            {手帳あり ? "電話・補正などあり" : "電話（見本）・受理実績あり"}
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
        {!手帳あり && <span className="label 電話">電話</span>}
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
      {判定あり && (
        <div className="legend" style={{ marginTop: 6 }}>
          <span className="label 判定 食い違い">揺れあり、要確認</span>
          <span className="label 判定 補足">電話で補足</span>
          <span className="label 判定 一致">手引きと一致</span>
          <span className="label 判定 判定不能">判定不能</span>
          <span>電話の答えと手引きをケン（Claude）が見比べた印。補足と揺れは、段の下に理由の一行が出る。並べた見比べは県ページで</span>
        </div>
      )}

      <div className="hk-rows">
        {中身.map(({ r, 手引き, 記載なし, 右 }) => {
          const 飛び先 = `${r.県ページ}?${new URLSearchParams({ 手続き, ...(品目 ? { 品目 } : {}) }).toString()}#${r.錨 || k.番号}`;
          const 政令市 = r.コード.length === 5;
          const 段の見立て = 見立て(右);
          return (
            <section key={r.コード} id={`row-${r.コード}`} className={`hk-row${政令市 ? " shi" : ""}`} aria-label={r.名前}>
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
              {段の見立て.length > 0 && <Mitate js={段の見立て} 飛び先={飛び先} />}
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
  const 揺れ = x.判定.some((j) => j.判定 === "食い違い" && !j.解消);
  const cls = `card ${c.種別}${揺れ ? " yure" : ""}${古い ? " recheck" : ""}${x.薄く ? " faded" : ""}${合う ? " match" : ""}${照合 === "不一致" ? " mismatch" : ""}`;
  const 添え書き: string[] = [];
  if (!x.手続き) 添え書き.push(`${c.対象.join("・")}のとき`);
  if (x.品目 === "合わない" && c.品目) 添え書き.push(`${c.品目.join("・")}のとき`);

  return (
    <article className={cls}>
      <div className="card-body">
        <div className="card-top">
          <span className={`label ${c.種別}`}>{c.種別}</span>
          {c.見本 && <span className="label 見本">見本</span>}
          {古い && <span className="label 再確認">再確認</span>}
          {判定の札(x.判定, c.種別 === "手引き").map((f) => (
            <span key={f.判定 + f.文} className={`label 判定 ${f.判定}${f.解消 ? " 解消" : ""}`} title={f.理由たち.join("\n")}>
              {f.文}
              {f.解消 ? "・確かめ済み" : ""}
            </span>
          ))}
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

/** 段の下の見立て。札と理由の一行だけ。理由が長ければ一行で切り、押すと全部出る。並べた見比べは県ページで */
function Mitate({ js, 飛び先 }: { js: 判定の印[]; 飛び先: string }) {
  return (
    <div className="hk-ken">
      <div className="hk-ken-title">
        ケンの見立て
        <a href={飛び先} className="hk-link">
          県ページで並べて見る
        </a>
      </div>
      {js.map((j, i) => (
        <Mitate1 key={i} j={j} />
      ))}
    </div>
  );
}

/** 見立ての一行。理由が一行に収まらず切れているときだけ、行の末に小さく「全文」と添える */
function Mitate1({ j }: { j: 判定の印 }) {
  const 理由の欄 = useRef<HTMLSpanElement>(null);
  const [切れている, set切れている] = useState(false);
  const [開いた, set開いた] = useState(false);
  useEffect(() => {
    const e = 理由の欄.current;
    if (!e) return;
    const 測る = () => set切れている(e.scrollWidth > e.clientWidth + 1);
    測る();
    const ro = new ResizeObserver(測る);
    ro.observe(e);
    return () => ro.disconnect();
  }, [j.理由]);
  return (
    <details
      className={`hk-ken-pair ${j.判定}${j.解消 ? " 解消" : ""}`}
      onToggle={(e) => set開いた((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span className={`label 判定 ${j.判定}${j.解消 ? " 解消" : ""}`}>
          {判定の文(j.判定, j.種類)}
          {j.解消 ? "・確かめ済み" : ""}
        </span>
        <span className="hk-ken-why" ref={理由の欄}>
          {j.理由}
        </span>
        {切れている && !開いた && <span className="hk-ken-full">全文</span>}
      </summary>
      <div className="hk-ken-more">
        {j.種類 === "電話どうし"
          ? `前の電話（${j.相手.確認日 ? 表示日(j.相手.確認日) : "日付なし"}${j.相手.窓口 ? ` ${j.相手.窓口}` : ""}）と見比べた`
          : `手引き（${j.相手.ページ ?? "ページ不明"}）と見比べた`}
      </div>
    </details>
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

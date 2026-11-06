import { はじめてのデータ, 時間の文字 } from "@/lib/hajimete";

export const metadata = { title: "はじめての許認可｜よみどころ" };

const 照合の順 = ["一致", "一致（ページ訂正）", "一致（目視）", "近似（要目視）", "不一致"] as const;

export default function HajimeteIndex() {
  const { 観点, 一覧 } = はじめてのデータ();
  return (
    <>
      <a className="back" href="/">
        全国の地図へ戻る
      </a>
      <h1>はじめての許認可</h1>
      <p className="lead">
        許認可の名前と自治体を入れると、Claude が公式サイト（lg.jp・go.jp・自治体のドメインだけ）から手引きと案内ページを探して読み、
        どの許認可にも共通する観点{観点.length}項目と、その許認可だけの観点を、出典つきで出します。引用はすべてプログラムで本文と照らし合わせています。
        初めて扱う許認可の、最初の下調べに使います。判断は、行政書士が窓口で確かめてからにしてください。
      </p>
      <p className="hint">
        新しく調べるとき：<code>npm run 探す -- &quot;建設業許可&quot; &quot;和歌山県&quot;</code> のあと <code>npm run はじめて読む -- 建設業許可_和歌山県</code>
      </p>

      {一覧.length === 0 ? (
        <p className="none">まだ調べた許認可がありません。</p>
      ) : (
        <div className="pref-grid hj-grid">
          {一覧.map((d) => (
            <a key={d.id} className="pref has hj-card" href={`/hajimete/${encodeURIComponent(d.id)}/`}>
              <div className="name">{d.許認可名}</div>
              <div className="state">{d.自治体名}　{d.読んだ日}に読みました</div>
              <div className="counts">
                <span className="count">
                  <span className="dot 手引き" />
                  記録 {d.記録.length}
                </span>
                <span className="count">
                  埋まった観点 {d.埋まった観点}／{観点.length}
                </span>
                <span className="count">独自の観点 {d.独自の観点.length}</span>
                <span className="count">資料 {d.資料.length}</span>
              </div>
              <div className="counts">
                {照合の順
                  .filter((k) => d.照合の内訳[k])
                  .map((k) => (
                    <span key={k} className={`count${k === "不一致" ? " hj-bad" : ""}`}>
                      照合 {k} {d.照合の内訳[k]}
                    </span>
                  ))}
              </div>
              <div className="hj-time">
                かかった時間 <b>{時間の文字(d.合計秒)}</b>　費用 約{d.合計ドル.toFixed(2)}ドル
              </div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

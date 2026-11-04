import { notFound } from "next/navigation";
import { はじめてのデータ, 時間の文字, type はじめて } from "@/lib/hajimete";

export const dynamicParams = false;

export function generateStaticParams() {
  return はじめてのデータ().一覧.map((d) => ({ id: d.id }));
}

function 引く(raw: string) {
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // そのまま
  }
  return はじめてのデータ().一覧.find((d) => d.id === id.normalize("NFC"));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = 引く((await params).id);
  return { title: d ? `${d.許認可名}（${d.自治体名}）｜はじめての許認可` : "見つかりません" };
}

type 出典 = はじめて["記録"][number]["出典"];

const 照合の札: Record<string, { cls: string; 文: string }> = {
  一致: { cls: "照合済み", 文: "本文と一致" },
  "一致（ページ訂正）": { cls: "照合済み", 文: "本文と一致（ページを直した）" },
  "近似（要目視）": { cls: "近似", 文: "ほぼ一致・目で確かめる" },
  不一致: { cls: "不一致", 文: "本文に見つからない" },
};

function SourceRow({ s, d }: { s: 出典; d: はじめて }) {
  const 資料 = d.資料.find((x) => x.文書 === s.文書);
  const 名 = 資料?.名前 ?? s.文書;
  const 場所 = 資料?.形式 === "PDF" ? `PDF ${s.物理ページ}ページ目${s.印字ページ ? `（印字 p.${s.印字ページ}）` : ""}` : (資料?.形式 ?? "") === "HTML" ? "案内ページ" : `${s.物理ページ}ページ目`;
  const url = 資料?.url ? (資料.形式 === "PDF" ? `${資料.url}#page=${s.物理ページ}` : 資料.url) : null;
  return (
    <div className="ref">
      <span style={{ color: "var(--sub)", fontSize: 12 }}>出典</span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {名}　{場所}
        </a>
      ) : (
        <span>
          {名}　{場所}
        </span>
      )}
    </div>
  );
}

function HjCard({ 主張, s, d, 名前 }: { 主張: string; s: 出典; d: はじめて; 名前?: string }) {
  const 札 = 照合の札[s.照合];
  return (
    <article className={`card 手引き${s.照合 === "不一致" ? " mismatch" : ""}`}>
      <div className="card-body">
        <div className="card-top">
          <span className="label 手引き">手引き</span>
          {札 && <span className={`label ${札.cls}`}>{札.文}</span>}
          {名前 && <span className="note">{名前}</span>}
        </div>
        <p className="a">{主張}</p>
        <blockquote>{s.引用}</blockquote>
        <SourceRow s={s} d={d} />
      </div>
    </article>
  );
}

export default async function HajimetePage({ params }: { params: Promise<{ id: string }> }) {
  const d = 引く((await params).id);
  if (!d) notFound();
  const { 観点 } = はじめてのデータ();
  const 段階 = [
    ["探す", d.時間.探す],
    ["取得", d.時間.取得],
    ["読む", d.時間.読む],
    ["照合", d.時間.照合],
  ] as const;

  return (
    <>
      <a className="back" href="/hajimete/">
        はじめての許認可の一覧へ戻る
      </a>
      <h1>
        {d.許認可名}
        <span className="hj-place">{d.自治体名}</span>
      </h1>
      <p className="lead">
        公式サイト{d.自治体ドメイン ? `（${d.自治体ドメイン}）` : ""}の手引き・案内ページを Claude が探して読み、要点を自分の言葉でまとめたものです。
        引用は本文そのままで、プログラムで照らし合わせています。{d.読んだ日}に読みました。申請前に窓口で再確認してください。
      </p>

      <section className="summary hj-summary" aria-label="かかった時間と費用">
        <div>
          <b>{時間の文字(d.合計秒)}</b>かかった時間（合計）
        </div>
        {段階.map(([k, v]) => (
          <div key={k}>
            <b>{時間の文字(v)}</b>
            {k}
          </div>
        ))}
        <div>
          <b>約{d.合計ドル.toFixed(2)}ドル</b>
          費用（探す {d.費用.探す.toFixed(2)}・読む {d.費用.読む.toFixed(2)}）
        </div>
      </section>

      <section className="summary" aria-label="件数">
        <div>
          <b>{d.記録.length}</b>記録
        </div>
        <div>
          <b>
            {d.埋まった観点}
            <span style={{ fontSize: 13, color: "var(--sub)" }}> / {観点.length}</span>
          </b>
          手引きで埋まった観点
        </div>
        <div>
          <b>{d.記載なし.length}</b>手引きに記載なし
        </div>
        <div>
          <b>{d.独自の観点.length}</b>この許認可だけの観点
        </div>
        {Object.entries(d.照合の内訳).map(([k, v]) => (
          <div key={k}>
            <b>{v}</b>照合 {k}
          </div>
        ))}
      </section>

      <h2>読んだ資料</h2>
      <ul className="hj-docs">
        {d.資料.map((x) => (
          <li key={x.文書}>
            <span className="label 未分類">{x.役割 ?? "資料"}</span>
            <span className="hj-fmt">{x.形式}</span>
            {x.url ? (
              <a href={x.url} target="_blank" rel="noopener noreferrer">
                {x.名前 ?? x.文書}
              </a>
            ) : (
              <span>{x.名前 ?? x.文書}</span>
            )}
            <span className="hint">
              {x.ページ数 ? `${x.ページ数}ページ` : "文字にできませんでした"}
              {x.読んだ ? "" : "・読んでいません（様式など）"}　取得 {x.取得日}
            </span>
          </li>
        ))}
      </ul>
      {(d.取れなかった.length > 0 || d.見つからなかったこと) && (
        <div className="hj-ng">
          <b>見つからなかった・取れなかったもの</b>
          {d.見つからなかったこと && <p>{d.見つからなかったこと}</p>}
          <ul>
            {d.取れなかった.map((x, i) => (
              <li key={i}>
                {x.url ?? "（URL なし）"}：{x.理由}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2>共通の観点</h2>
      <div className="legend">
        <span className="label 手引き">手引き</span>手引き・案内ページに明記
        <span className="label 記載なし">記載なし</span>探しましたが、ありません。窓口に電話で聞いてください
      </div>
      {観点.map((k, i) => {
        const rs = d.記録.filter((r) => r.観点 === k.id);
        const 無し = d.記載なし.find((n) => n.観点 === k.id);
        return (
          <div key={k.id} className={`kanten${rs.length === 0 ? " empty" : ""}`}>
            <div className="kanten-head">
              <span className="no">{String(i + 1).padStart(2, "0")}</span>
              <span className="title">{k.表示名}</span>
              {rs.length === 0 && <span className="nothing">手引きに記載なし</span>}
            </div>
            <div className="cards">
              {rs.map((r) => (
                <HjCard key={r.id} 主張={r.主張} s={r.出典} d={d} />
              ))}
              {rs.length === 0 && (
                <article className="card 記載なし">
                  <div className="card-body">
                    <div className="card-top">
                      <span className="label 記載なし">記載なし</span>
                    </div>
                    <p className="a">手引き・案内ページには書かれていませんでした。窓口に電話で聞いてください。</p>
                    <div className="q">探したもの　{k.探すもの}</div>
                    {無し && <div className="q">探した語　{無し.探した語.join("、")}</div>}
                  </div>
                </article>
              )}
            </div>
          </div>
        );
      })}

      <section className="group" id="dokuji">
        <h2>この許認可だけの観点</h2>
        <p className="lead">共通の観点には当てはまりませんが、{d.許認可名}の手引きに書かれていた、申請前に知っておくべき決まりです（Claude が拾った候補）。</p>
        <div className="cards">
          {d.独自の観点.length === 0 && <p className="none">見つかりませんでした。</p>}
          {d.独自の観点.map((c, i) => (
            <HjCard key={i} 主張={c.主張} s={c.出典} d={d} 名前={c.名前} />
          ))}
        </div>
      </section>
    </>
  );
}

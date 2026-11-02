import { データ } from "@/lib/data";

const 種別順 = ["手引き", "受理実績", "電話", "同業者"] as const;

export default function Home() {
  const { 県一覧, 県ごと, 観点一覧 } = データ();

  const 地方順: string[] = [];
  for (const k of 県一覧) if (!地方順.includes(k.地方)) 地方順.push(k.地方);

  const 合計 = (c: string) => Object.values(県ごと).reduce((s, d) => s + d.件数[c as (typeof 種別順)[number]], 0);
  const 記録のある県 = Object.values(県ごと).filter((d) => 種別順.some((s) => d.件数[s] > 0)).length;
  const 全件 = 種別順.reduce((s, c) => s + 合計(c), 0);

  return (
    <>
      <h1>全国一覧</h1>
      <p className="lead">
        県ごとの記録の件数を、出典の種類ごとに出している。記録のある県は押すと、観点{観点一覧.length}項目ごとの中身が見られる。
      </p>

      <div className="summary">
        <div>
          <b>{記録のある県} / 47</b>記録のある都道府県
        </div>
        <div>
          <b>{全件}</b>記録の件数
        </div>
        {種別順.map((s) => (
          <div key={s}>
            <b>{合計(s)}</b>
            {s}
          </div>
        ))}
      </div>

      <div className="legend">
        <span className="label 手引き">手引き</span>手引きに明記
        <span className="label 受理実績">受理実績</span>この形で受理された
        <span className="label 電話">電話</span>窓口に電話で確認
        <span className="label 同業者">同業者</span>同業者から聞いた
      </div>

      {地方順.map((地方) => (
        <section className="region" key={地方}>
          <h2>{地方}</h2>
          <div className="pref-grid">
            {県一覧
              .filter((k) => k.地方 === 地方)
              .map((k) => {
                const d = 県ごと[k.コード];
                const ある = 種別順.some((s) => d.件数[s] > 0);
                const 中身 = (
                  <>
                    <div className="name">{k.名前}</div>
                    {ある ? (
                      <div className="counts">
                        {種別順.map((s) => (
                          <span key={s} className={`count${d.件数[s] === 0 ? " zero" : ""}`}>
                            <span className={`dot ${s}`} />
                            {s} {d.件数[s]}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="none">まだ記録がない</div>
                    )}
                  </>
                );
                return ある ? (
                  <a key={k.コード} className="pref has" href={`/${k.コード}/`}>
                    {中身}
                  </a>
                ) : (
                  <div key={k.コード} className="pref">
                    {中身}
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </>
  );
}

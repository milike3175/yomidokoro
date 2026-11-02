import { データ } from "@/lib/data";
import { 配置, 列数, 行数 } from "@/lib/tilemap";

const 種別順 = ["手引き", "受理実績", "電話", "同業者", "補正"] as const;

const 状態の説明: Record<string, string> = {
  検品済み: "検品済み",
  未検品: "未検品（自動で読んだだけ）",
  未確認: "手引き未確認",
  未読: "まだ読んでいない",
};

/** 件数を濃さの5段階に */
function 濃さ(n: number) {
  if (n === 0) return 0;
  if (n < 5) return 1;
  if (n < 10) return 2;
  if (n < 20) return 3;
  return 4;
}

export default function Home() {
  const { 県一覧, 県ごと, 観点一覧 } = データ();

  const 地方順: string[] = [];
  for (const k of 県一覧) if (!地方順.includes(k.地方)) 地方順.push(k.地方);

  // 件数は、その県の中の政令市の記録も含めて数える（地図はその土地の記録の量を見せる）。県のページでは分けて出す
  const 市の件数 = (code: string, t: (typeof 種別順)[number]) => 県ごと[code].政令市.reduce((s, c) => s + c.件数[t], 0);
  const 市の計 = (code: string) => 種別順.reduce((s, t) => s + 市の件数(code, t), 0);
  const 計 = (code: string) => 種別順.reduce((s, t) => s + 県ごと[code].件数[t], 0) + 市の計(code);
  const 合計 = (t: (typeof 種別順)[number]) =>
    Object.values(県ごと).reduce((s, d) => s + d.件数[t] + d.政令市.reduce((a, c) => a + c.件数[t], 0), 0);
  const 記録のある県 = 県一覧.filter((k) => 計(k.コード) > 0).length;
  const 全件 = 種別順.reduce((s, t) => s + 合計(t), 0);

  return (
    <>
      <h1>全国の地図</h1>
      <p className="lead">
        色の濃さが記録の件数、枠の線が手引きの読み込み状況。記録のある県を押すと、観点{観点一覧.length}項目ごとの中身が見られる。
      </p>

      <div className="summary">
        <div>
          <b>
            {記録のある県}
            <span style={{ fontSize: 13, color: "var(--sub)" }}> / 47</span>
          </b>
          記録のある都道府県
        </div>
        <div>
          <b>{全件}</b>記録の件数
        </div>
        {種別順.map((t) => (
          <div key={t}>
            <b>{合計(t)}</b>
            <span className={`dot ${t}`} />
            {t}
          </div>
        ))}
      </div>

      <section className="map-wrap" aria-label="都道府県のタイル地図">
        <div
          className="tilemap"
          style={{ gridTemplateColumns: `repeat(${列数}, 1fr)`, gridTemplateRows: `repeat(${行数}, auto)` }}
        >
          {県一覧.map((k) => {
            const p = 配置[k.コード];
            const n = 計(k.コード);
            const d = 県ごと[k.コード];
            const cls = `tile lv${濃さ(n)} st-${d.手引きの状態}${p.幅 ? " big" : ""}${d.改訂 ? " kaitei" : ""}`;
            const style = {
              gridColumn: `${p.列 + 1} / span ${p.幅 ?? 1}`,
              gridRow: `${p.行 + 1} / span ${p.高さ ?? 1}`,
            };
            const 市 = 市の計(k.コード);
            const 市名 = d.政令市.map((s) => s.市.名前).join("・");
            const title = `${k.名前}：記録 ${n}件${市 ? `（うち${市名}（政令市）${市}件）` : ""}、${状態の説明[d.手引きの状態]}${d.改訂 ? `、手引きの改訂を検知（${d.改訂.日付}）` : ""}`;
            const 中身 = (
              <>
                <span className="n">{k.短い名}</span>
                {n > 0 && <span className="c">{n}</span>}
                {市 > 0 && (
                  <span className="shi" aria-hidden="true">
                    市
                  </span>
                )}
              </>
            );
            return n > 0 ? (
              <a key={k.コード} className={cls} style={style} href={`/${k.コード}/`} title={title} aria-label={title}>
                {中身}
              </a>
            ) : (
              <div key={k.コード} className={cls} style={style} title={title}>
                {中身}
              </div>
            );
          })}
        </div>

        <div className="map-legend">
          <div className="legend">
            <span>記録の件数</span>
            {[
              [0, "0"],
              [1, "1〜4"],
              [2, "5〜9"],
              [3, "10〜19"],
              [4, "20〜"],
            ].map(([lv, t]) => (
              <span key={lv} className="legend-item">
                <span className={`swatch lv${lv}`} />
                {t}
              </span>
            ))}
          </div>
          <div className="legend">
            <span className="legend-item">
              <span className="swatch shi-mark">市</span>
              政令市の窓口の記録もある（件数に含む）
            </span>
          </div>
          <div className="legend">
            <span>手引き</span>
            {Object.entries(状態の説明).map(([k, t]) => (
              <span key={k} className="legend-item">
                <span className={`swatch st-${k}`} />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      <h2>一覧</h2>
      <div className="legend">
        <span className="label 手引き">手引き</span>手引きに明記
        <span className="label 受理実績">受理実績</span>この形で受理された
        <span className="label 電話">電話</span>窓口に電話で確認
        <span className="label 同業者">同業者</span>同業者から聞いた
        <span className="label 補正">補正</span>審査で直すよう言われた
      </div>

      {地方順.map((地方) => (
        <section className="region" key={地方}>
          <h2>{地方}</h2>
          <div className="pref-grid">
            {県一覧
              .filter((k) => k.地方 === 地方)
              .map((k) => {
                const d = 県ごと[k.コード];
                const ある = 計(k.コード) > 0;
                const 中身 = (
                  <>
                    <div className="name">{k.名前}</div>
                    <div className="state">
                      手引き：{d.手引きの状態 === "未読" ? "まだ読んでいない" : d.手引きの状態}
                      {d.改訂 ? "（改訂を検知、再確認）" : ""}
                    </div>
                    {ある ? (
                      <div className="counts">
                        {種別順.map((t) => (
                          <span key={t} className={`count${d.件数[t] === 0 ? " zero" : ""}`}>
                            <span className={`dot ${t}`} />
                            {t} {d.件数[t]}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="none">まだ記録がない</div>
                    )}
                    {d.政令市.map((s) => (
                      <div key={s.市.コード} className="counts shi-counts">
                        <span className="count">{s.市.名前}（政令市）</span>
                        {種別順
                          .filter((t) => s.件数[t] > 0)
                          .map((t) => (
                            <span key={t} className="count">
                              <span className={`dot ${t}`} />
                              {t} {s.件数[t]}
                            </span>
                          ))}
                      </div>
                    ))}
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

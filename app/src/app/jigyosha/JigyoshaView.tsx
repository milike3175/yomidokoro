"use client";

// 事業者の控え（電話帳）。様式に書く画面で保存した控えを、会社ごとに一行にまとめて並べる。
// 控えはこのパソコンの中（アプリの控えの置き場）にだけある。画面に出すだけで、Claude にもネットにも送らない。
import { useEffect, useState } from "react";
import { 控えを読む } from "@/lib/shoshiki";
import s from "../shoshiki/shoshiki.module.css";

type 控えの口の型 = {
  一覧: () => Promise<{ ファイル名: string; 更新: string }[] | { ok: false; 理由: string }>;
  開く: (ファイル名: string) => Promise<{ ok: true; 中身: string } | { ok: false; 理由: string }>;
  置き場を開く: () => Promise<unknown>;
};

type 行 = {
  会社: string;
  ふりがな: string;
  住所: string;
  代表者: string;
  電話: string;
  品目: string[];
  保存日: string;
  ファイル名: string;
  ほか: number;
};

function アプリの控えの口(): 控えの口の型 | null {
  if (typeof window === "undefined") return null;
  const y = (window as unknown as { yomidokoro?: { 控え?: 控えの口の型 } }).yomidokoro;
  return y?.控え ?? null;
}

export default function JigyoshaView() {
  const [アプリ, setアプリ] = useState<控えの口の型 | null | undefined>(undefined);
  const [行たち, set行たち] = useState<行[]>([]);
  const [知らせ, set知らせ] = useState("");

  useEffect(() => {
    const 口 = アプリの控えの口();
    setアプリ(口);
    if (口) void 読む(口);
  }, []);

  async function 読む(口: 控えの口の型) {
    const 一覧 = await 口.一覧();
    if (!Array.isArray(一覧)) {
      set知らせ(`控えの一覧を読めませんでした：${一覧.理由}`);
      return;
    }
    // 一覧は新しい順。会社（氏名）ごとに、いちばん新しい控えを出す
    const 会社ごと = new Map<string, 行>();
    let 読めない = 0;
    for (const x of 一覧) {
      const r = await 口.開く(x.ファイル名);
      const k = r.ok ? 控えを読む(r.中身) : null;
      if (!k || !k.ok) {
        読めない++;
        continue;
      }
      const v = k.控え.値;
      const 会社 = (v["氏名"] ?? "").trim() || "（名前の無い控え）";
      const 前 = 会社ごと.get(会社);
      if (前) {
        前.ほか++;
        continue;
      }
      会社ごと.set(会社, {
        会社,
        ふりがな: v["ふりがな"] ?? "",
        住所: v["住所"] ?? "",
        代表者: v["代表者"] ?? "",
        電話: v["電話番号"] ?? "",
        品目: (k.控え.申請?.品目 ?? []).map((p) => p.id),
        保存日: k.控え.保存日,
        ファイル名: x.ファイル名,
        ほか: 0,
      });
    }
    const 並び = [...会社ごと.values()].sort((a, b) => (a.ふりがな || a.会社).localeCompare(b.ふりがな || b.会社, "ja"));
    set行たち(並び);
    set知らせ(読めない ? `よみどころの控えの形でないファイルが ${読めない}件あったので、出していません` : "");
  }

  return (
    <>
      <h1>事業者の控え</h1>
      <p className={s.note}>
        様式に書く画面で「事業者の控えを保存」を押した事業者が、会社ごとに並びます。「この事業者で下書きする」を押すと、会社の情報と品目が入った状態で様式に書く画面が開きます。
        控えはこのパソコンの中にだけあります。Claude にもインターネットにも送りません。
      </p>

      {アプリ === null && (
        <p className={s.note} data-testid="ブラウザの控え">
          ブラウザで開いているときは、控えはダウンロードしたファイル（控え_会社名_日付.json）として手元にあります。
          <a href="/shoshiki/">様式に書く画面</a>の「控えを読み込む」で、そのファイルを選んでください。一覧で並べられるのは、デスクトップ版（アプリ）だけです。
        </p>
      )}

      {アプリ && (
        <>
          <p>
            <button type="button" className={s.small} onClick={() => void アプリ.置き場を開く()}>
              控えの置き場を開く
            </button>
            　<a href="/shoshiki/">新しい事業者を入れる（様式に書く画面へ）</a>
          </p>
          {知らせ && <p className={s.placed}>{知らせ}</p>}
          {行たち.length === 0 ? (
            <p className={s.note} data-testid="控えなし">
              まだ控えがありません。<a href="/shoshiki/">様式に書く画面</a>で事業者の情報を入れて、「事業者の控えを保存」を押すと、ここに並びます。
            </p>
          ) : (
            <table className={s.book} data-testid="控えの一覧">
              <thead>
                <tr>
                  <th>会社</th>
                  <th>住所</th>
                  <th>代表者</th>
                  <th>電話</th>
                  <th>品目</th>
                  <th>保存日</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {行たち.map((x) => (
                  <tr key={x.ファイル名}>
                    <td>
                      <strong>{x.会社}</strong>
                      {x.ふりがな && <div className={s.kana}>{x.ふりがな}</div>}
                    </td>
                    <td>{x.住所}</td>
                    <td>{x.代表者}</td>
                    <td>{x.電話}</td>
                    <td>{x.品目.length ? x.品目.join("、") : "なし"}</td>
                    <td>
                      {x.保存日}
                      {x.ほか > 0 && <div className={s.kana}>前の控え {x.ほか}件</div>}
                    </td>
                    <td>
                      <a href={`/shoshiki/?控え=${encodeURIComponent(x.ファイル名)}`} data-testid="この事業者で下書きする">
                        この事業者で下書きする
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}

"use client";

// トップの「事業者さんの名簿」のカード。アプリでは名簿の会社の数と、いちばん最近保存した日を出す。
// 会社の名前は出さない（2026-11-06 みゆき「日付だけにしよう」。実際に使うと依頼者の会社名がトップに出るので、画面を人に見せるときのため）。
// 名簿はこのパソコンの中にだけある（アプリの控えの置き場）。画面に出すだけで、どこにも送らない。
import { useEffect, useState } from "react";
import { 控えを読む } from "@/lib/shoshiki";

type 口の型 = {
  一覧: () => Promise<{ ファイル名: string; 更新: string }[] | { ok: false; 理由: string }>;
  開く: (ファイル名: string) => Promise<{ ok: true; 中身: string } | { ok: false; 理由: string }>;
};

export default function MeiboCard() {
  const [状態, set状態] = useState<{ アプリ: boolean; 社数: number; 最近: string } | null>(null);

  useEffect(() => {
    const 口 = (window as unknown as { yomidokoro?: { 控え?: 口の型 } }).yomidokoro?.控え;
    if (!口) {
      set状態({ アプリ: false, 社数: 0, 最近: "" });
      return;
    }
    void (async () => {
      const 一覧 = await 口.一覧();
      if (!Array.isArray(一覧)) return set状態({ アプリ: true, 社数: 0, 最近: "" });
      const 会社 = new Set<string>();
      for (const x of 一覧) {
        const r = await 口.開く(x.ファイル名);
        const k = r.ok ? 控えを読む(r.中身) : null;
        const 名 = k && k.ok ? (k.控え.値["氏名"] ?? "").trim() : "";
        if (!名) continue;
        会社.add(名); // 数えるだけ。名前は画面に出さない
      }
      // 一覧は新しい順。いちばん上の保存日を「最近の保存」として出す
      const 日 = 一覧.length ? new Date(一覧[0].更新) : null;
      const 最近 = 日 && !Number.isNaN(日.getTime()) ? `${日.getMonth() + 1}/${日.getDate()}` : "";
      set状態({ アプリ: true, 社数: 会社.size, 最近 });
    })();
  }, []);

  return (
    <a href="/jigyosha/" className="meibo-card" data-testid="名簿のカード">
      <span className="meibo-card-title">事業者さんの名簿</span>
      <span className="meibo-card-body">
        {!状態
          ? "　"
          : !状態.アプリ
            ? "アプリで使えます。申請書に書いた事業者さんを名簿に入れておくと、次からは選ぶだけで書けます"
            : 状態.社数 === 0
              ? "まだ誰も入っていません。開いて「新しい事業者さんを入れる」から始めます"
              : `${状態.社数}社${状態.最近 ? `　最近の保存：${状態.最近}` : ""}`}
      </span>
      <span className="meibo-card-go">名簿を開く</span>
    </a>
  );
}

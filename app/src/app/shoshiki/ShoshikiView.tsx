"use client";

// 様式に書く画面。すべてこのブラウザの中で動く。
// 置かれた様式ファイルも、入力した事業者の情報も、どこにも送らない（送る fetch はしない。Claude も呼ばない）。
// 県のサイトから様式を取ってくることもしない（リンクを出すだけ。利用者が自分で保存して、ここに置く）。
// 例外は「試す」ボタンだけ：このサイトと同じ場所に置いた様式（app/public/、公開する様式.yaml で sha256 ごとに許したもの）を
// 同じオリジンから読み込む（GET。何も送らない）。読み込んだ中身の sha256 が一覧と違えば使わない。

import { useEffect, useMemo, useRef, useState } from "react";
import {
  docxに書く,
  品目たち,
  品目を書き出す,
  丸の説明,
  区分がある,
  含みたち,
  型を組む,
  型の鍵,
  くり返しの鍵,
  入っている組,
  形の鍵,
  選んだ形,
  欄の行,
  使う口,
  品目の名たち,
  中身の印,
  積替保管ありの注,
  type 書き方の型,
  type 含み,
  空の中身,
  控えを作る,
  控えを読む,
  住所を分ける,
  全角に,
  type 様式,
  type 値,
  type 欄の結果,
  type 申請の中身,
  type 品目の選び,
} from "@/lib/shoshiki";
import type { 公開する様式 } from "@/lib/kokai-yoshiki";
import s from "./shoshiki.module.css";

export type 手元の様式 = { 県: string; ファイル名: string; sha256: string; 中身: string | null };

type 置いた様式 = {
  ファイル名: string;
  sha256: string;
  バイト: Uint8Array;
  様: 様式 | null;
};

async function sha256を出す(b: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", b as BufferSource);
  return Array.from(new Uint8Array(h))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function 保存させる(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// デスクトップ版（desktop/preload.cjs）が出す控えの口。ブラウザで開いたときは無い
type 控えの口の型 = {
  保存: (ファイル名: string, 中身: string) => Promise<{ ok: true; ファイル名: string; 置き場: string } | { ok: false; 理由: string }>;
  一覧: () => Promise<{ ファイル名: string; 更新: string }[] | { ok: false; 理由: string }>;
  開く: (ファイル名: string) => Promise<{ ok: true; 中身: string } | { ok: false; 理由: string }>;
  置き場を開く: () => Promise<unknown>;
};
function アプリの控えの口(): 控えの口の型 | null {
  if (typeof window === "undefined") return null;
  const y = (window as unknown as { yomidokoro?: { 控え?: 控えの口の型 } }).yomidokoro;
  return y?.控え ?? null;
}

function 今日(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function base64からバイト(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 記入した docx を作る。本文の1ファイルだけを差し替え、ほかは読み込んだ圧縮データのまま書き出す（lib/shoshiki.ts の docxに書く） */
async function docxを作る(
  置: 置いた様式,
  様: 様式,
  値たち: 値,
  中身: 申請の中身,
  型: 書き方の型 | null,
): Promise<{ ok: true; blob: Blob; 結果: 欄の結果[] } | { ok: false; 理由: string }> {
  const JSZip = (await import("jszip")).default;
  const r = await docxに書く(JSZip, 置.バイト, 様, 値たち, 中身, 型);
  if (!r.ok) return r;
  const blob = new Blob([r.バイト as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  return { ok: true, blob, 結果: r.結果 };
}

export default function ShoshikiView({
  様式たち,
  型たち,
  手元,
  手帳版,
  試せる,
}: {
  様式たち: 様式[];
  型たち: 書き方の型[];
  手元: 手元の様式[];
  手帳版: boolean;
  試せる: 公開する様式[];
}) {
  const 表 = useMemo(() => new Map(様式たち.map((x) => [x.sha256, x])), [様式たち]);
  const [置, set置] = useState<置いた様式 | null>(null);
  const [値たち, set値たち] = useState<値>({});
  const [中身, set中身] = useState<申請の中身>({ ...空の中身, 品目: [] });
  const [知らせ, set知らせ] = useState<string>("");
  const [控えの知らせ, set控えの知らせ] = useState<string>("");
  const [重ねる, set重ねる] = useState(false);
  const 受け口 = useRef<HTMLInputElement>(null);
  const 控えの口 = useRef<HTMLInputElement>(null);
  // アプリの中では、控えは決まった置き場に保存し、その一覧から選んで読み込む
  const [アプリ, setアプリ] = useState<控えの口の型 | null>(null);
  const [控えの一覧, set控えの一覧] = useState<{ ファイル名: string; 更新: string }[]>([]);
  const [選んだ控え, set選んだ控え] = useState<string>("");
  async function 一覧を読み直す(口: 控えの口の型 | null = アプリ) {
    if (!口) return;
    const r = await 口.一覧();
    if (!Array.isArray(r)) {
      set控えの知らせ(`控えの一覧を読めませんでした：${r.理由}`);
      return;
    }
    set控えの一覧(r);
    set選んだ控え((v) => (r.some((x) => x.ファイル名 === v) ? v : (r[0]?.ファイル名 ?? "")));
  }
  useEffect(() => {
    const 口 = アプリの控えの口();
    setアプリ(口);
    void 一覧を読み直す(口);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const 様 = 置?.様 ?? null;
  const 型 = (様 && 型たち.find((t) => t.sha256 === 様.sha256)) || null;

  async function 置く(ファイル名: string, バイト: Uint8Array) {
    // 様式を見分ける計算（sha256）は、https か 127.0.0.1 で開いたときだけブラウザが使わせてくれる
    if (!globalThis.crypto?.subtle) {
      set知らせ("この開き方では様式を見分けられません。https のページか、このパソコンの 127.0.0.1 で開き直してください");
      return;
    }
    const sha256 = await sha256を出す(バイト);
    set置({ ファイル名, sha256, バイト, 様: 表.get(sha256) ?? null });
    set知らせ("");
  }

  /** このサイトに置いた様式を、同じオリジンから読み込んで置く（外へは出ない） */
  async function 試しの様式を置く(x: 公開する様式) {
    const url = new URL(x.場所, location.origin);
    if (url.origin !== location.origin) {
      set知らせ("このサイトの外の場所は読みません");
      return;
    }
    try {
      const r = await fetch(url, { credentials: "omit", cache: "no-store" });
      if (!r.ok) {
        set知らせ(`様式を読み込めませんでした（${r.status}）`);
        return;
      }
      const バイト = new Uint8Array(await r.arrayBuffer());
      if (!globalThis.crypto?.subtle) {
        set知らせ("この開き方では様式を見分けられません。https のページか、このパソコンの 127.0.0.1 で開き直してください");
        return;
      }
      if ((await sha256を出す(バイト)) !== x.sha256) {
        set知らせ("読み込んだ様式の中身が、載せた様式と違います。使いません");
        return;
      }
      await 置く(x.場所.split("/").pop() ?? "様式.docx", バイト);
    } catch {
      set知らせ("様式を読み込めませんでした");
    }
  }

  async function ファイルを受ける(f: File | undefined) {
    if (!f) return;
    await 置く(f.name, new Uint8Array(await f.arrayBuffer()));
  }

  // 入力のたびに、本文に書いたらどうなるかを見る（要確認の印を先に出すため）。本文が無ければ形だけ見る
  const 見込み = useMemo(() => {
    if (!様) return new Map<string, 欄の結果>();
    const m = new Map<string, 欄の結果>();
    for (const f of 様.欄) {
      if (f.種類 === "住所2行") {
        const v = 全角に((値たち[f.id] ?? "").trim());
        if (!v) continue;
        const w2 = f.次の空白 - f.次の頭;
        const sp = 住所を分ける(v, f.空白, w2);
        const 説明: string[] = [];
        if (sp.二行目) 説明.push(`${sp.区切り}で2行目へ送ります：1行目「${sp.一行目}」／2行目「${sp.二行目}」。切る位置を確かめてください`);
        if (sp.切り捨て) 説明.push(`2行目にも入らず「${sp.切り捨て}」が切れます。書き方を考え直してください`);
        m.set(f.id, { id: f.id, 見出し: f.見出し, 状態: 説明.length ? "要確認" : "書いた", 説明 });
      } else if (f.種類 === "空白") {
        const v = 全角に((値たち[f.id] ?? "").trim());
        const 入る = (f.幅 ?? f.空白) - (f.頭 ?? 0);
        if (!v) continue;
        const n = Array.from(v).length;
        m.set(f.id, n > 入る
          ? { id: f.id, 見出し: f.見出し, 状態: "要確認", 説明: [`${入る}字の欄に${n}字です。${入る}字で切れます`] }
          : { id: f.id, 見出し: f.見出し, 状態: "書いた", 説明: [] });
      }
    }
    return m;
  }, [様, 値たち]);

  async function 書いて保存() {
    if (!置 || !様) return;
    const r = await docxを作る(置, 様, 値たち, 中身, 型);
    if (!r.ok) {
      set知らせ(`書きませんでした：${r.理由}`);
      return;
    }
    const 確 = r.結果.filter((x) => x.状態 === "要確認").length;
    保存させる(r.blob, `記入_${様.県コード}_${置.ファイル名.replace(/\.docx$/i, "")}.docx`);
    set知らせ(`記入した docx を保存しました（このパソコンの中だけ）。要確認 ${確}件。Word で開いて確かめてください`);
  }

  async function 控えを保存() {
    if (!様) return;
    const k = 控えを作る(様, 値たち, 今日(), 中身);
    const 名 = (値たち["氏名"] ?? "").trim() || "事業者";
    const 文 = JSON.stringify(k, null, 2) + "\n";
    const ファイル名 = `控え_${名}_${k.保存日}.json`;
    if (アプリ) {
      const r = await アプリ.保存(ファイル名, 文);
      if (!r.ok) {
        set控えの知らせ(`保存できませんでした：${r.理由}`);
        return;
      }
      await 一覧を読み直す();
      set選んだ控え(r.ファイル名);
      set控えの知らせ(`事業者の控えを「${r.ファイル名}」として保存しました（このパソコンの中だけ。置き場：${r.置き場}）。次は下の一覧から選んで読み込めます`);
      return;
    }
    保存させる(new Blob([文], { type: "application/json" }), ファイル名);
    set控えの知らせ("事業者の控えを保存しました（このパソコンの中だけ）。次はこのファイルを読み込めば、同じ値で書けます");
  }

  async function アプリの控えを読む() {
    if (!アプリ || !選んだ控え) return;
    const r = await アプリ.開く(選んだ控え);
    if (!r.ok) {
      set控えの知らせ(`読めませんでした：${r.理由}`);
      return;
    }
    控えの文を受ける(r.中身);
  }

  async function 控えを受ける(f: File | undefined) {
    if (!f) return;
    控えの文を受ける(await f.text());
  }

  function 控えの文を受ける(文: string) {
    const r = 控えを読む(文);
    if (!r.ok) {
      set控えの知らせ(`読めませんでした：${r.理由}`);
      return;
    }
    set値たち(r.控え.値);
    set中身(r.控え.申請 ?? { ...空の中身, 品目: [] });
    const 違う = 様 && r.控え.様式.sha256 !== 様.sha256;
    set控えの知らせ(
      `控え（${r.控え.保存日} 保存）を読み込みました。` +
        (違う ? `この控えは別の様式（${r.控え.様式.名前}）で保存したものです。同じ id の欄だけ入れました。確かめてください` : ""),
    );
  }

  const 変える = (id: string) => (e: React.ChangeEvent<HTMLInputElement>) => set値たち((v) => ({ ...v, [id]: e.target.value }));

  // 品目の選び。並びは施行令の順に lib がそろえる
  const 選び = useMemo(() => new Map(中身.品目.map((x) => [x.id, x])), [中身]);
  const 品目を切り替える = (id: string) =>
    set中身((c) => ({
      ...c,
      品目: c.品目.some((x) => x.id === id) ? c.品目.filter((x) => x.id !== id) : [...c.品目, { id }],
    }));
  const 水銀使用製品を切り替える = (id: string) =>
    set中身((c) => ({ ...c, 品目: c.品目.map((x): 品目の選び => (x.id === id ? { ...x, 水銀使用製品: !x.水銀使用製品 } : x)) }));
  const 含みを選ぶ = (id: string, k: "石綿" | "水銀含有ばいじん等", v: 含み) =>
    set中身((c) => ({ ...c, 品目: c.品目.map((x): 品目の選び => (x.id === id ? { ...x, [k]: v === "含まない" ? undefined : v } : x)) }));
  const 品目の見込み = useMemo(() => (様 ? 品目を書き出す(様, 中身) : null), [様, 中身]);
  const 型の見込み = useMemo(() => (様 && 型 ? 型を組む(型, 様, 値たち, 中身) : []), [様, 型, 値たち, 中身]);
  const 使う = useMemo(() => (型 && 様 ? 使う口(型, 値たち, 中身の印(様, 中身)) : new Set<string>()), [型, 様, 値たち, 中身]);
  const 品目の名 = useMemo(() => (様 ? 品目の名たち(様, 中身) : []), [様, 中身]);

  return (
    <>
      <a className="back" href="/">
        全国の地図へ戻る
      </a>
      <h1>様式に書く（試し）</h1>
      <p className="lead">
        県の公式の様式ファイルに、事業者の情報を書き込みます。書き込みはこのブラウザの中だけで行い、様式も事業者の情報もどこにも送りません（Claude にも送りません）。
        様式の欄の空白だけを同じ字数の値に置き換えるので、書式・改行・枠はそのまま残ります。最後は必ず Word で開いて、行政書士が確かめてください。
      </p>

      {試せる.length > 0 && (
        <div className={s.trial}>
          <p className={s.note}>まず試すなら：県の様式の写しを、このサイトに一つだけ置いています。押すとこのサイトから読み込みます（外へは何も送りません）。架空の会社で書いてみてください</p>
          {試せる.map((x) => (
            <div key={x.sha256}>
              <div className={s.buttons}>
                <button type="button" className={s.primary} data-testid={`試す-${x.sha256.slice(0, 8)}`} onClick={() => void 試しの様式を置く(x)}>
                  {x.県名}の{x.呼び名}で試す
                </button>
              </div>
              <p className={s.source} data-testid="出典">
                出典：{x.県名}「{x.出典の名前}」（
                <a href={x.入口} target="_blank" rel="noopener noreferrer">
                  {x.入口}
                </a>
                、{x.取得日.replace(/^(\d{4})-0?(\d+)-0?(\d+)$/, "$1年$2月$3日")}取得）。
                <a href={x.規約} target="_blank" rel="noopener noreferrer">
                  {x.規約の名前}
                </a>
                に基づき、中身を変えずに掲載しています。
              </p>
            </div>
          ))}
        </div>
      )}

      <h2>1．様式を県のページから取ってくる</h2>
      <p className={s.note}>道具は県のサイトから様式を取ってきません。下のページを開いて、様式ファイルを自分で保存してください。</p>
      <ul className={s.list}>
        {様式たち.map((x) => (
          <li key={x.sha256}>
            <a href={x.入口} target="_blank" rel="noopener noreferrer">
              {x.県名}の産業廃棄物収集運搬業のページ
            </a>
            　{x.名前}（ファイル名 {x.ファイル名}）
          </li>
        ))}
      </ul>

      <h2>2．保存した様式をここに置く</h2>
      <div
        className={`${s.drop} ${重ねる ? s.dropOn : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          set重ねる(true);
        }}
        onDragLeave={() => set重ねる(false)}
        onDrop={(e) => {
          e.preventDefault();
          set重ねる(false);
          void ファイルを受ける(e.dataTransfer.files[0]);
        }}
        onClick={() => 受け口.current?.click()}
      >
        ダウンロードした様式（docx）をここに置いてください。押して選ぶこともできます
        <input
          ref={受け口}
          type="file"
          accept=".docx"
          className={s.hidden}
          data-testid="様式の受け口"
          onChange={(e) => {
            void ファイルを受ける(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {手帳版 && (
        <div className={s.techo}>
          <p className={s.note}>手元の版だけ：手引き/ にすでにある様式（公開版には出ません）</p>
          {手元.length === 0 ? (
            <p className={s.note}>手引き/&lt;県&gt;/様式/ に様式ファイルがありません。</p>
          ) : (
            <ul className={s.list}>
              {手元.map((t) => (
                <li key={`${t.県}/${t.ファイル名}`}>
                  {t.県}／{t.ファイル名}
                  {t.中身 ? (
                    <button type="button" className={s.small} onClick={() => void 置く(t.ファイル名, base64からバイト(t.中身!))}>
                      これを使う
                    </button>
                  ) : (
                    <span className={s.faint}>まだ対応表の無い様式（sha256 {t.sha256.slice(0, 12)}…）</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {置 && (
        <p className={s.placed} data-testid="置いた様式">
          置いた様式：{置.ファイル名}（sha256 {置.sha256.slice(0, 16)}…）
          {様 ? <strong>　{様.県名}「{様.名前}」と分かりました</strong> : <strong className={s.warn}>　知らない様式です。まだ対応表が無いので書けません</strong>}
        </p>
      )}

      {様 && (
        <>
          <h2>3．事業者の情報を入れる</h2>
          <p className={s.note}>半角の英数字は全角にして書きます。空けた欄は様式のままにします（触りません）。</p>
          <div className={s.form}>
            {様.欄.map((f) => {
              const 見 = 見込み.get(f.id);
              return (
                <div key={f.id} className={s.row}>
                  <label className={s.label} htmlFor={f.種類 === "日付" ? `${f.id}.年` : f.id}>
                    {f.見出し}
                  </label>
                  <div>
                    {f.種類 === "日付" ? (
                      <span className={s.date}>
                        令和
                        <input id={`${f.id}.年`} data-testid={`${f.id}.年`} value={値たち[`${f.id}.年`] ?? ""} onChange={変える(`${f.id}.年`)} />年
                        <input id={`${f.id}.月`} data-testid={`${f.id}.月`} value={値たち[`${f.id}.月`] ?? ""} onChange={変える(`${f.id}.月`)} />月
                        <input id={`${f.id}.日`} data-testid={`${f.id}.日`} value={値たち[`${f.id}.日`] ?? ""} onChange={変える(`${f.id}.日`)} />日
                      </span>
                    ) : (
                      <input
                        id={f.id}
                        data-testid={f.id}
                        className={s.input}
                        value={値たち[f.id] ?? ""}
                        placeholder={"例" in f && f.例 ? `例：${f.例}` : ""}
                        onChange={変える(f.id)}
                      />
                    )}
                    {f.注 && <div className={s.faint}>{f.注}</div>}
                    {見?.状態 === "要確認" && (
                      <div className={s.check} data-testid={`要確認-${f.id}`}>
                        <span className={s.badge}>要確認</span>
                        {見.説明.join("　")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {様.品目 && 品目の見込み && (
            <>
              <h3 className={s.h3}>申請する品目と積替保管</h3>
              <p className={s.note}>
                この様式とこの道具は、特別管理産業廃棄物を含みません（普通の産業廃棄物の収集運搬だけです）。特別管理産業廃棄物の申請は、別の様式で行政書士が作ってください。
              </p>
              <div className={s.form}>
                <div className={s.row}>
                  <div className={s.label}>品目（産業廃棄物の種類）</div>
                  <div>
                    <div className={s.hinmoku} data-testid="品目">
                      {品目たち.map((h) => {
                        const x = 選び.get(h.id);
                        return (
                          <div key={h.id} className={s.hinmokuRow}>
                            <label className={s.check1}>
                              <input type="checkbox" data-testid={`品目-${h.id}`} checked={!!x} onChange={() => 品目を切り替える(h.id)} />
                              {h.名前}
                            </label>
                            {x && 様 && (区分がある(様, h.id, "石綿") || 区分がある(様, h.id, "水銀使用製品") || 区分がある(様, h.id, "水銀含有ばいじん等")) && (
                              <span className={s.soe}>
                                {(["石綿", "水銀含有ばいじん等"] as const)
                                  .filter((k) => 区分がある(様, h.id, k))
                                  .map((k) => {
                                    const 名 = k === "石綿" ? "石綿含有産業廃棄物" : "水銀含有ばいじん等";
                                    const 今 = x[k] ?? "含まない";
                                    return (
                                      <span key={k} className={s.fukumi} data-testid={`${k}-${h.id}`}>
                                        {含みたち.map((c) => (
                                          <label key={c.値} className={s.check1}>
                                            <input
                                              type="radio"
                                              name={`${k}-${h.id}`}
                                              data-testid={`${k}-${h.id}-${c.値}`}
                                              checked={今 === c.値}
                                              onChange={() => 含みを選ぶ(h.id, k, c.値)}
                                            />
                                            {c.言い方(名)}
                                          </label>
                                        ))}
                                      </span>
                                    );
                                  })}
                                {区分がある(様, h.id, "水銀使用製品") && (
                                  <label className={s.check1}>
                                    <input type="checkbox" data-testid={`水銀使用製品-${h.id}`} checked={!!x.水銀使用製品} onChange={() => 水銀使用製品を切り替える(h.id)} />
                                    水銀使用製品産業廃棄物を含む
                                  </label>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className={s.faint}>
                      並びは廃棄物処理法施行令の順です。石綿・水銀の欄は、その区分になりうる品目にだけ出しています。どの品目に出すかは県で違うことがあるので、様式ごとの対応表に持っています（和歌山：石綿は手引き p4 の4品目。水銀の2つは法令の区分から道具が選んだもので、要確認です）。
                    </div>
                  </div>
                </div>
                <div className={s.row}>
                  <div className={s.label}>積替え又は保管</div>
                  <div>
                    <span className={s.date}>
                      <label className={s.check1}>
                        <input type="radio" name="積替保管" data-testid="積替保管-無" checked={中身.積替保管 === "無"} onChange={() => set中身((c) => ({ ...c, 積替保管: "無" }))} />
                        無
                      </label>
                      <label className={s.check1}>
                        <input type="radio" name="積替保管" data-testid="積替保管-有" checked={中身.積替保管 === "有"} onChange={() => set中身((c) => ({ ...c, 積替保管: "有" }))} />
                        有
                      </label>
                    </span>
                    {中身.積替保管 === "有" && 様 && (
                      <>
                        <div className={s.check} data-testid="積替保管の知らせ">
                          <span className={s.badge}>要確認</span>
                          {積替保管ありの注(様).map((t, k) => (
                            <div key={k}>{t}</div>
                          ))}
                        </div>
                        {(様.積替保管?.添付.length ?? 0) > 0 && (
                          <div className={s.faint} data-testid="添付が要るもの">
                            添付が要るもの（道具では作れません。{様.県名}の手引きに書いてあるものだけを並べています）
                            <ul className={s.list}>
                              {様.積替保管!.添付.map((x, k) => (
                                <li key={k}>
                                  {x.いつ && `${x.いつ}：`}
                                  {x.もの}（出典 {x.出典}）
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {中身.品目.length > 0 && (
                  <div className={s.row}>
                    <div className={s.label}>様式にこう書きます</div>
                    <div data-testid="品目の見込み">
                      <div className={s.faint}>第1面「事業の範囲」（和歌山の申請書記載例 p1 の書き方）</div>
                      <div className={s.preview}>
                        {品目の見込み.行たち.map((t, k) => (
                          <div key={k}>{t}</div>
                        ))}
                        <div>石綿含有産業廃棄物【有・無】（{品目の見込み.石綿の番号}）</div>
                        <div>水銀使用製品産業廃棄物【有・無】</div>
                        <div>水銀含有ばいじん等【有・無】（{品目の見込み.水銀含有ばいじん等の番号}）</div>
                        <div>積替え又は保管【有・無】</div>
                      </div>
                      <div className={s.faint}>【有・無】の○は、Word の囲い文字で付けます。LibreOffice では囲い文字が見えず「無」などが消えて見えるので、Word で開いて確かめてください。</div>
                      <div className={s.faint}>事業計画の概要の品目表、品目の名前の列（和歌山の様式記載例 p1〜p2 の書き方）</div>
                      <ol className={s.preview}>
                        {品目の見込み.表の行.map((t, k) => (
                          <li key={k}>{t}</li>
                        ))}
                      </ol>
                      <div className={s.check} data-testid="要確認-品目">
                        <span className={s.badge}>要確認</span>
                        {[...丸の説明(品目の見込み), ...品目の見込み.要確認].map((t, k) => (
                          <div key={k}>{t}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {様.文の欄 && 型 && (
            <>
              <h3 className={s.h3}>事業計画の概要・環境保全措置の文（{型.県名}の記載例の書き方の型）</h3>
              <p className={s.note}>
                型の文は{型.県名}の記載例と手引きから前もって作ったものです。下の欄に入れた事業者の中身を、このブラウザの中で差し込みます（どこにも送りません）。
                空けた所は様式に「【要確認：…】」と残します。品目を選んだときだけ書きます。型の文は記載例の会社の例なので、事業者の実際に合わせて行政書士が直してください。
              </p>
              <div className={s.form}>
                {型.欄
                  .filter((k) => (k.形?.length ?? 0) > 1)
                  .map((k) => {
                    const 今 = 選んだ形(k, 値たち);
                    return (
                      <div key={`形-${k.id}`} className={s.row}>
                        <div className={s.label}>{k.見出し}の書き方の形</div>
                        <div data-testid={`形-${k.id}`}>
                          <span className={s.date}>
                            {k.形!.map((f) => (
                              <label key={f.id} className={s.check1}>
                                <input
                                  type="radio"
                                  name={`形-${k.id}`}
                                  data-testid={`形-${k.id}-${f.id}`}
                                  checked={今?.id === f.id}
                                  onChange={() => set値たち((v) => ({ ...v, [形の鍵(k.id)]: f.id }))}
                                />
                                {f.見出し}
                              </label>
                            ))}
                          </span>
                          {k.形の説明 && <div className={s.faint}>{k.形の説明}</div>}
                          {今?.説明 && <div className={s.faint}>{今.説明}</div>}
                        </div>
                      </div>
                    );
                  })}
                {型.差し込み口
                  .filter((d) => d.種類 !== "自動" && 使う.has(d.id))
                  .map((d) =>
                    d.種類 === "品目ごと" ? (
                      <div key={d.id} className={s.row}>
                        <div className={s.label}>{d.見出し}</div>
                        <div data-testid={`品目ごと-${d.id}`}>
                          {品目の名.length === 0 && <div className={s.faint}>上で品目を選ぶと、品目ごとの欄が出ます</div>}
                          {品目の名.map((h) => (
                            <div key={h.鍵} className={s.kumi}>
                              <span className={s.faint}>{h.名}</span>
                              {(d.項目 ?? []).map((k) => (
                                <input
                                  key={k.id}
                                  aria-label={`${h.名} ${k.見出し}`}
                                  data-testid={くり返しの鍵(d.id, h.鍵, k.id)}
                                  className={s.input}
                                  value={値たち[くり返しの鍵(d.id, h.鍵, k.id)] ?? ""}
                                  placeholder={k.例 ? `${k.見出し}（例：${k.例}）` : k.見出し}
                                  onChange={変える(くり返しの鍵(d.id, h.鍵, k.id))}
                                />
                              ))}
                            </div>
                          ))}
                          {d.説明 && <div className={s.faint}>{d.説明}</div>}
                        </div>
                      </div>
                    ) : d.種類 === "聞き取り" ? (
                      <div key={d.id} className={s.row}>
                        <label className={s.label} htmlFor={型の鍵(d.id)}>
                          {d.見出し}
                        </label>
                        <div>
                          <input
                            id={型の鍵(d.id)}
                            data-testid={型の鍵(d.id)}
                            className={s.input}
                            value={値たち[型の鍵(d.id)] ?? ""}
                            placeholder={d.例 ? `例：${d.例}` : ""}
                            onChange={変える(型の鍵(d.id))}
                          />
                          {d.説明 && <div className={s.faint}>{d.説明}</div>}
                        </div>
                      </div>
                    ) : (
                      <div key={d.id} className={s.row}>
                        <div className={s.label}>{d.見出し}</div>
                        <div>
                          {Array.from({ length: Math.min(d.最大 ?? 10, Math.max(1, ...入っている組(型, d.id, 値たち).map((n) => n + 1))) }, (_, j) => j + 1).map((n) => (
                            <div key={n} className={s.kumi}>
                              <span className={s.faint}>{n}</span>
                              {(d.項目 ?? []).map((k) => (
                                <input
                                  key={k.id}
                                  aria-label={`${d.見出し} ${n} ${k.見出し}`}
                                  data-testid={くり返しの鍵(d.id, n, k.id)}
                                  className={s.input}
                                  value={値たち[くり返しの鍵(d.id, n, k.id)] ?? ""}
                                  placeholder={k.例 ? `${k.見出し}（例：${k.例}）` : k.見出し}
                                  onChange={変える(くり返しの鍵(d.id, n, k.id))}
                                />
                              ))}
                            </div>
                          ))}
                          {d.説明 && <div className={s.faint}>{d.説明}</div>}
                        </div>
                      </div>
                    ),
                  )}
                {中身.品目.length > 0 &&
                  型の見込み.map((g) => (
                    <div key={g.id} className={s.row}>
                      <div className={s.label}>{g.見出し}</div>
                      <div data-testid={`型の見込み-${g.id}`}>
                        <div className={s.preview}>
                          {g.行たち.map((t, k) => (
                            <div key={k} className={s.pre}>
                              {t || "\u00a0"}
                            </div>
                          ))}
                        </div>
                        {g.要確認.length > 0 && (
                          <div className={s.check}>
                            <span className={s.badge}>要確認</span>
                            {g.要確認.map((t, k) => (
                              <div key={k}>{t}</div>
                            ))}
                          </div>
                        )}
                        <details className={s.faint}>
                          <summary>この欄の型の文と出典</summary>
                          <ul className={s.list}>
                            {(() => {
                              const k = 型.欄.find((x) => x.id === g.id);
                              return k ? 欄の行(k, 値たち) : [];
                            })()
                              .flatMap((r) => (r.くり返し ? [r, ...(r.行 ?? [])] : [r]))
                              .filter((r) => r.字 || r.空なら)
                              .map((r, k) => (
                                <li key={k}>
                                  {r.字 || r.空なら}
                                  {r.条件 && `（${r.条件}のとき）`}　
                                  {r.写し === "まま"
                                    ? "記載例の文のまま"
                                    : r.写し === "一部"
                                      ? "差し込み口のほかは記載例の文のまま"
                                      : r.写し === "組み替え"
                                        ? "記載例の言い回しを道具が組み替えた"
                                        : "記載例に文が無い"}
                                  {r.出典 && `／出典 ${r.出典}`}
                                </li>
                              ))}
                          </ul>
                        </details>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}

          <h3 className={s.h3}>今は書かない欄</h3>
          <ul className={s.later}>
            {様.書かない.map((x) => (
              <li key={x.見出し}>
                <span className={x.印 === "型が入る予定" ? s.badgeKata : s.badge}>{x.印 === "型が入る予定" ? "型が入る予定・要確認" : "要確認"}</span>
                {x.見出し}：{x.理由}
              </li>
            ))}
          </ul>

          <h2>4．書いて保存する</h2>
          <div className={s.buttons}>
            <button type="button" className={s.primary} data-testid="書いて保存" onClick={() => void 書いて保存()}>
              記入した docx を保存する
            </button>
          </div>
          {知らせ && (
            <p className={s.placed} data-testid="知らせ">
              {知らせ}
            </p>
          )}
        </>
      )}

      <h2>事業者の控え</h2>
      <p className={s.note}>
        入れた値を、このパソコンにファイル（JSON）で保存します。ブラウザには溜めません。次に同じ事業者の申請書を作るときは、様式を置いてから控えを読み込んでください。
      </p>
      {アプリ && (
        <p className={s.note}>
          アプリでは、控えをこのパソコンの決まった置き場（よみどころ専用のフォルダ）に保存し、一覧から選んで読み込みます。
        </p>
      )}
      <div className={s.buttons}>
        <button type="button" disabled={!様} data-testid="控えを保存" onClick={() => void 控えを保存()}>
          控えを保存する
        </button>
        {アプリ && (
          <>
            <select
              value={選んだ控え}
              onChange={(e) => set選んだ控え(e.target.value)}
              disabled={控えの一覧.length === 0}
              data-testid="控えの一覧"
              aria-label="保存した控え"
            >
              {控えの一覧.length === 0 && <option value="">保存した控えはまだありません</option>}
              {控えの一覧.map((x) => (
                <option key={x.ファイル名} value={x.ファイル名}>
                  {x.ファイル名}
                </option>
              ))}
            </select>
            <button type="button" disabled={!選んだ控え} data-testid="控えを一覧から読む" onClick={() => void アプリの控えを読む()}>
              選んだ控えを読み込む
            </button>
            <button type="button" data-testid="控えの置き場を開く" onClick={() => void アプリ.置き場を開く()}>
              置き場を開く
            </button>
          </>
        )}
        <button type="button" data-testid="控えを読む" onClick={() => 控えの口.current?.click()}>
          {アプリ ? "ほかの場所のファイルから読み込む" : "控えを読み込む"}
        </button>
        <input
          ref={控えの口}
          type="file"
          accept=".json,application/json"
          className={s.hidden}
          data-testid="控えの口"
          onChange={(e) => {
            void 控えを受ける(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {控えの知らせ && (
        <p className={s.placed} data-testid="控えの知らせ">
          {控えの知らせ}
        </p>
      )}
    </>
  );
}

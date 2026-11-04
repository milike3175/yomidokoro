"use client";

// 様式に書く画面。すべてこのブラウザの中で動く。
// 置かれた様式ファイルも、入力した事業者の情報も、どこにも送らない（fetch しない。Claude も呼ばない）。
// 県のサイトから様式を取ってくることもしない（リンクを出すだけ。利用者が自分で保存して、ここに置く）。

import { useMemo, useRef, useState } from "react";
import {
  記入する,
  控えを作る,
  控えを読む,
  住所を分ける,
  全角に,
  type 様式,
  type 値,
  type 欄の結果,
} from "@/lib/shoshiki";
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

/** 記入した docx を作る。本文の1ファイルだけを差し替え、ほかは読み込んだ圧縮データのまま書き出す */
async function docxを作る(置: 置いた様式, 様: 様式, 値たち: 値): Promise<{ ok: true; blob: Blob; 結果: 欄の結果[] } | { ok: false; 理由: string }> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(置.バイト);
  const entry = zip.file(様.本文);
  if (!entry) return { ok: false, 理由: `${様.本文} が見つからない` };
  const 元 = await entry.async("uint8array");
  const 本文 = new TextDecoder("utf-8", { fatal: true }).decode(元);
  // 文字にして戻したときに元と同じバイトになるか（BOM や改行の扱いで変わるなら書かない）
  const 戻し = new TextEncoder().encode(本文);
  if (戻し.length !== 元.length || 戻し.some((v, i) => v !== 元[i])) {
    return { ok: false, 理由: "本文を文字にして戻すと元と同じにならない。書かない" };
  }
  const r = 記入する(本文, 様, 値たち);
  if (!r.ok) return r;
  const 名前の並び = Object.keys(zip.files);
  zip.file(様.本文, new TextEncoder().encode(r.本文), {
    binary: true,
    date: entry.date,
    compression: "DEFLATE",
    unixPermissions: entry.unixPermissions,
    dosPermissions: entry.dosPermissions,
    createFolders: false,
  });
  if (Object.keys(zip.files).join("\n") !== 名前の並び.join("\n")) {
    return { ok: false, 理由: "zip の中のファイルの並びが変わった。書かない" };
  }
  // 圧縮方式を元と同じ DEFLATE にする。JSZip は、読み込んだパーツの方式と同じなら圧縮データを解かずにそのまま書く
  // （指定しないと全パーツが無圧縮で詰め直される）
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    platform: "DOS",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return { ok: true, blob, 結果: r.結果 };
}

export default function ShoshikiView({ 様式たち, 手元, 手帳版 }: { 様式たち: 様式[]; 手元: 手元の様式[]; 手帳版: boolean }) {
  const 表 = useMemo(() => new Map(様式たち.map((x) => [x.sha256, x])), [様式たち]);
  const [置, set置] = useState<置いた様式 | null>(null);
  const [値たち, set値たち] = useState<値>({});
  const [知らせ, set知らせ] = useState<string>("");
  const [控えの知らせ, set控えの知らせ] = useState<string>("");
  const [重ねる, set重ねる] = useState(false);
  const 受け口 = useRef<HTMLInputElement>(null);
  const 控えの口 = useRef<HTMLInputElement>(null);

  const 様 = 置?.様 ?? null;

  async function 置く(ファイル名: string, バイト: Uint8Array) {
    // 様式を見分ける計算（sha256）は、https か 127.0.0.1 で開いたときだけブラウザが使わせてくれる
    if (!globalThis.crypto?.subtle) {
      set知らせ("この開き方では様式を見分けられない。https のページか、このパソコンの 127.0.0.1 で開き直す");
      return;
    }
    const sha256 = await sha256を出す(バイト);
    set置({ ファイル名, sha256, バイト, 様: 表.get(sha256) ?? null });
    set知らせ("");
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
        if (sp.二行目) 説明.push(`${sp.区切り}で2行目へ送る：1行目「${sp.一行目}」／2行目「${sp.二行目}」。切る位置を確かめる`);
        if (sp.切り捨て) 説明.push(`2行目にも入らず「${sp.切り捨て}」が切れる。書き方を考え直す`);
        m.set(f.id, { id: f.id, 見出し: f.見出し, 状態: 説明.length ? "要確認" : "書いた", 説明 });
      } else if (f.種類 === "空白") {
        const v = 全角に((値たち[f.id] ?? "").trim());
        const 入る = (f.幅 ?? f.空白) - (f.頭 ?? 0);
        if (!v) continue;
        const n = Array.from(v).length;
        m.set(f.id, n > 入る
          ? { id: f.id, 見出し: f.見出し, 状態: "要確認", 説明: [`${入る}字の欄に${n}字。${入る}字で切れる`] }
          : { id: f.id, 見出し: f.見出し, 状態: "書いた", 説明: [] });
      }
    }
    return m;
  }, [様, 値たち]);

  async function 書いて保存() {
    if (!置 || !様) return;
    const r = await docxを作る(置, 様, 値たち);
    if (!r.ok) {
      set知らせ(`書かなかった：${r.理由}`);
      return;
    }
    const 確 = r.結果.filter((x) => x.状態 === "要確認").length;
    保存させる(r.blob, `記入_${様.県コード}_${置.ファイル名.replace(/\.docx$/i, "")}.docx`);
    set知らせ(`記入した docx を保存した（このパソコンの中だけ）。要確認 ${確}件。Word で開いて確かめる`);
  }

  function 控えを保存() {
    if (!様) return;
    const k = 控えを作る(様, 値たち, 今日());
    const 名 = (値たち["氏名"] ?? "").trim() || "事業者";
    保存させる(new Blob([JSON.stringify(k, null, 2) + "\n"], { type: "application/json" }), `控え_${名}_${k.保存日}.json`);
    set控えの知らせ("事業者の控えを保存した（このパソコンの中だけ）。次はこのファイルを読み込めば、同じ値で書ける");
  }

  async function 控えを受ける(f: File | undefined) {
    if (!f) return;
    const r = 控えを読む(await f.text());
    if (!r.ok) {
      set控えの知らせ(`読めなかった：${r.理由}`);
      return;
    }
    set値たち(r.控え.値);
    const 違う = 様 && r.控え.様式.sha256 !== 様.sha256;
    set控えの知らせ(
      `控え（${r.控え.保存日} 保存）を読み込んだ。` +
        (違う ? `この控えは別の様式（${r.控え.様式.名前}）で保存したもの。同じ id の欄だけ入れた。確かめる` : ""),
    );
  }

  const 変える = (id: string) => (e: React.ChangeEvent<HTMLInputElement>) => set値たち((v) => ({ ...v, [id]: e.target.value }));

  return (
    <>
      <a className="back" href="/">
        全国の地図へ戻る
      </a>
      <h1>様式に書く（試し）</h1>
      <p className="lead">
        県の公式の様式ファイルに、事業者の情報を書き込む。書き込みはこのブラウザの中だけで行い、様式も事業者の情報もどこにも送らない（Claude にも送らない）。
        様式の欄の空白だけを同じ字数の値に置き換えるので、書式・改行・枠はそのまま残る。最後は必ず Word で開いて、行政書士が確かめる。
      </p>

      <h2>1．様式を県のページから取ってくる</h2>
      <p className={s.note}>道具は県のサイトから様式を取ってこない。下のページを開いて、様式ファイルを自分で保存する。</p>
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
        ダウンロードした様式（docx）をここに置く。押して選んでもよい
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
          <p className={s.note}>手元の版だけ：手引き/ にすでにある様式（公開版には出ない）</p>
          {手元.length === 0 ? (
            <p className={s.note}>手引き/&lt;県&gt;/様式/ に様式ファイルが無い。</p>
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
          {様 ? <strong>　{様.県名}「{様.名前}」と分かった</strong> : <strong className={s.warn}>　知らない様式。まだ対応表が無いので書けない</strong>}
        </p>
      )}

      {様 && (
        <>
          <h2>3．事業者の情報を入れる</h2>
          <p className={s.note}>半角の英数字は全角にして書く。空けた欄は様式のまま（触らない）。</p>
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
        入れた値を、このパソコンにファイル（JSON）で保存する。ブラウザには溜めない。次に同じ事業者の申請書を作るときは、様式を置いてから控えを読み込む。
      </p>
      <div className={s.buttons}>
        <button type="button" disabled={!様} data-testid="控えを保存" onClick={控えを保存}>
          控えを保存する
        </button>
        <button type="button" data-testid="控えを読む" onClick={() => 控えの口.current?.click()}>
          控えを読み込む
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

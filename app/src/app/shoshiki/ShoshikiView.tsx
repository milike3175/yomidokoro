"use client";

// 様式に書く画面。すべてこのブラウザの中で動く。
// 置かれた様式ファイルも、入力した事業者の情報も、どこにも送らない（送る fetch はしない。Claude も呼ばない）。
// 県のサイトから様式を取ってくることもしない（リンクを出すだけ。利用者が自分で保存して、ここに置く）。
// 例外は「試す」ボタンだけ：このサイトと同じ場所に置いた様式（app/public/、公開する様式.yaml で sha256 ごとに許したもの）を
// 同じオリジンから読み込む（GET。何も送らない）。読み込んだ中身の sha256 が一覧と違えば使わない。

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
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
  様式が使う口,
  品目の名たち,
  中身の印,
  積替保管ありの注,
  type 書き方の型,
  type 差し込み口,
  type 型の欄,
  type 含み,
  空の中身,
  控えを作る,
  控えを読む,
  住所を分ける,
  全角に,
  type 様式,
  type 値,
  type 写真,
  type 欄の結果,
  type 申請の中身,
  type 品目の選び,
  自動車等破砕物の品目,
  type 区分,
} from "@/lib/shoshiki";
import type { 公開する様式 } from "@/lib/kokai-yoshiki";
import { 見本の値, 見本の中身, 見本の写真, 見本の組の数 } from "@/lib/mihon";
import s from "./shoshiki.module.css";

export type 手元の様式 = {
  県: string;
  ファイル名: string;
  sha256: string;
  中身: string | null;
};

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
  保存: (
    ファイル名: string,
    中身: string,
  ) => Promise<
    | { ok: true; ファイル名: string; 置き場: string }
    | { ok: false; 理由: string }
  >;
  一覧: () => Promise<
    { ファイル名: string; 更新: string }[] | { ok: false; 理由: string }
  >;
  開く: (
    ファイル名: string,
  ) => Promise<{ ok: true; 中身: string } | { ok: false; 理由: string }>;
  置き場を開く: () => Promise<unknown>;
};
function アプリの控えの口(): 控えの口の型 | null {
  if (typeof window === "undefined") return null;
  const y = (window as unknown as { yomidokoro?: { 控え?: 控えの口の型 } })
    .yomidokoro;
  return y?.控え ?? null;
}

// デスクトップ版の下書きの口と、様式を県のサイトから取ってくる口。ブラウザで開いたときは無い
type 下書きの口の型 = {
  /** 小分け：置き場の下のフォルダ（事業者名_新規、県名）。古いアプリは受け取らない */
  保存: (
    ファイル名: string,
    バイト: Uint8Array,
    小分け?: string[],
  ) => Promise<
    | { ok: true; ファイル名: string; 置き場: string; 親?: string }
    | { ok: false; 理由: string }
  >;
  /** 場所を渡すと、そのフォルダを開く（置き場の中だけ）。渡さなければ置き場 */
  置き場を開く: (場所?: string) => Promise<unknown>;
};
type アプリの様式の口 = {
  様式を取ってくる?: (
    県コード: string,
    sha256?: string,
  ) => Promise<
    | { ok: true; 名前: string; 対応表と一致: boolean }
    | { ok: false; 理由: string; 入口: string }
  >;
  取ってきた様式?: () => Promise<手元の様式[]>;
  /** 手で置いた様式を覚える（次に開いたときも使えるように） */
  様式を覚える?: (
    ファイル名: string,
    base64: string,
  ) => Promise<
    | {
        ok: true;
        県コード: string;
        県名: string;
        名前: string;
        ファイル名: string;
        新しく: boolean;
      }
    | { ok: false; 理由: string }
  >;
  /** ダウンロードのフォルダとデスクトップから、道具の知っている様式を探して覚える */
  落ちた様式を探す?: () => Promise<{
    見た: string[];
    見つけた: {
      県コード: string;
      県名: string;
      名前: string;
      ファイル名: string;
      新しく: boolean;
    }[];
  }>;
  下書き?: 下書きの口の型;
};
/** 都道府県を地方ごとにまとめる（47並ぶと長いので。2026-11-05 みゆき「地方ごとに分けてすっきりさせて」）。県コードの順 */
const 地方の表: { 地方: string; 頭: number; 尻: number }[] = [
  { 地方: "北海道", 頭: 1, 尻: 1 },
  { 地方: "東北", 頭: 2, 尻: 7 },
  { 地方: "関東", 頭: 8, 尻: 14 },
  { 地方: "中部", 頭: 15, 尻: 23 },
  { 地方: "近畿", 頭: 24, 尻: 30 },
  { 地方: "中国", 頭: 31, 尻: 35 },
  { 地方: "四国", 頭: 36, 尻: 39 },
  { 地方: "九州・沖縄", 頭: 40, 尻: 47 },
];
function 地方ごと(組たち: 様式[][]): { 地方: string; 組たち: 様式[][] }[] {
  return 地方の表
    .map((r) => ({
      地方: r.地方,
      組たち: 組たち.filter((g) => {
        const n = Number(g[0].県コード);
        return n >= r.頭 && n <= r.尻;
      }),
    }))
    .filter((r) => r.組たち.length > 0);
}

function アプリの口(): アプリの様式の口 | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { yomidokoro?: アプリの様式の口 }).yomidokoro ?? null
  );
}
function 下書きの口(): 下書きの口の型 | null {
  return アプリの口()?.下書き ?? null;
}

function 今日(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function バイトからbase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000)
    s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
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
  写真たち: Record<string, 写真>,
): Promise<
  { ok: true; blob: Blob; 結果: 欄の結果[] } | { ok: false; 理由: string }
> {
  const JSZip = (await import("jszip")).default;
  const r = await docxに書く(JSZip, 置.バイト, 様, 値たち, 中身, 型, 写真たち);
  if (!r.ok) return r;
  const 型名 =
    様.方式 === "セル"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const blob = new Blob([r.バイト as BlobPart], { type: 型名 });
  return { ok: true, blob, 結果: r.結果 };
}

/** 同じ入れ物の中の開け閉めできる組を、すべて開く／すべて閉じる */
function 組をそろえる(e: MouseEvent<HTMLButtonElement>, 開く: boolean) {
  const 親 = e.currentTarget.closest("[data-fold-group]");
  if (!親) return;
  for (const d of Array.from(
    親.querySelectorAll<HTMLDetailsElement>("details"),
  ))
    d.open = 開く;
}

function 組の帯({ 件数, 何 }: { 件数: number; 何: string }) {
  if (件数 < 2) return null;
  return (
    <div className={s.foldBar} data-testid={`組の帯-${何}`}>
      <span>県ごとの「{何}」は畳んであります。見出しを押すと開きます。</span>
      <button type="button" onClick={(e) => 組をそろえる(e, true)}>
        すべて開く
      </button>
      <button type="button" onClick={(e) => 組をそろえる(e, false)}>
        すべて閉じる
      </button>
    </div>
  );
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
  const 表 = useMemo(
    () => new Map(様式たち.map((x) => [x.sha256, x])),
    [様式たち],
  );
  // 置いた様式は県ごとに複数持てる（2026-11-05 みゆき「県を選ぶ（複数可能）と、申請書の下書きができる」）。同じ sha256 は1つ
  const [置たち, set置たち] = useState<置いた様式[]>([]);
  // 申請する都道府県（県コード）。いくつでも選べる。選んだ県の数だけ下書きを作る
  const [選んだ県, set選んだ県] = useState<Set<string>>(new Set());
  // 県のページから来たとき（/shoshiki/?県=30）：その県を選んだ状態で始める
  const [来た県, set来た県] = useState<string>("");
  const [作成中, set作成中] = useState(false);
  const [手で置くを開く, set手で置くを開く] = useState(false);
  const [値たち, set値たち] = useState<値>({});
  // 写真（車両の前面・側面、容器）。鍵は 車両.1.前面 など。このブラウザの中だけに持ち、控えには入れない（どこにも送らない）
  const [写真たち, set写真たち] = useState<Record<string, 写真>>({});
  async function 写真を受ける(鍵: string, f: File | undefined) {
    if (!f) return;
    const バイト = new Uint8Array(await f.arrayBuffer());
    set写真たち((v) => ({ ...v, [鍵]: { 名前: f.name, バイト } }));
  }
  function 写真を外す(鍵: string) {
    set写真たち((v) => {
      const w = { ...v };
      delete w[鍵];
      return w;
    });
  }
  const [中身, set中身] = useState<申請の中身>({ ...空の中身, 品目: [] });
  const [知らせ, set知らせ] = useState<string>("");
  const [控えの知らせ, set控えの知らせ] = useState<string>("");
  const [重ねる, set重ねる] = useState(false);
  const 受け口 = useRef<HTMLInputElement>(null);
  const 控えの口 = useRef<HTMLInputElement>(null);
  // アプリの中では、控えは決まった置き場に保存し、その一覧から選んで読み込む
  const [アプリ, setアプリ] = useState<控えの口の型 | null>(null);
  const [控えの一覧, set控えの一覧] = useState<
    { ファイル名: string; 更新: string }[]
  >([]);
  const [選んだ控え, set選んだ控え] = useState<string>("");
  const [下書きの置き場, set下書きの置き場] = useState<string>("");
  const [取りの知らせ, set取りの知らせ] = useState<string>("");
  // 様式を置いたとき（置けなかったとき）の知らせ。受け口のすぐ下に出す
  const [置きの知らせ, set置きの知らせ] = useState<string>("");
  const 置き場の枠 = useRef<HTMLDivElement>(null);
  const [取れる, set取れる] = useState(false);
  async function 一覧を読み直す(口: 控えの口の型 | null = アプリ) {
    if (!口) return;
    const r = await 口.一覧();
    if (!Array.isArray(r)) {
      set控えの知らせ(`控えの一覧を読めませんでした：${r.理由}`);
      return;
    }
    set控えの一覧(r);
    set選んだ控え((v) =>
      r.some((x) => x.ファイル名 === v) ? v : (r[0]?.ファイル名 ?? ""),
    );
  }
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("県") ?? "";
    if (様式たち.some((x) => x.県コード === c)) {
      set来た県(c);
      set選んだ県(new Set([c]));
      setTimeout(
        () =>
          document
            .querySelector(`[data-testid="県の様式-${c}"]`)
            ?.scrollIntoView({ block: "center" }),
        50,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const 口 = アプリの控えの口();
    setアプリ(口);
    void 一覧を読み直す(口);
    // 事業者の控え（電話帳）から来たとき（/shoshiki/?控え=ファイル名）：その控えを読み込む
    const 控え名 = new URLSearchParams(window.location.search).get("控え");
    if (口 && 控え名) {
      set選んだ控え(控え名);
      void 口
        .開く(控え名)
        .then((r) =>
          r.ok
            ? 控えの文を受ける(r.中身)
            : set控えの知らせ(`読めませんでした：${r.理由}`),
        );
    }
    set取れる(!!アプリの口()?.様式を取ってくる);
    void 取ってきた様式を置く();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** アプリ：前に取ってきた様式（対応表と一致したもの）を全部置く */
  async function 取ってきた様式を置く() {
    const 口 = アプリの口();
    if (!口?.取ってきた様式) return;
    try {
      const 一覧 = await 口.取ってきた様式();
      for (const t of 一覧)
        if (t.中身) await 置く(t.ファイル名, base64からバイト(t.中身), false);
    } catch {
      /* 読めなければ置かない */
    }
  }

  /** アプリ：ダウンロードのフォルダとデスクトップから様式を探して置く。sha256 を渡せば、その様式が見つかったときだけ置いたものを返す */
  async function ダウンロードから探す(
    sha256?: string,
  ): Promise<置いた様式 | null> {
    const 口 = アプリの口();
    if (!口?.落ちた様式を探す || !口.取ってきた様式) return null;
    const r = await 口.落ちた様式を探す();
    const 一覧 = await 口.取ってきた様式();
    let 当たり: 置いた様式 | null = null;
    for (const f of r.見つけた) {
      const t = 一覧.find((y) => y.ファイル名 === f.ファイル名 && y.中身);
      if (!t) continue;
      const p = await 置く(t.ファイル名, base64からバイト(t.中身!), true);
      if (p && sha256 && p.sha256 === sha256) 当たり = p;
    }
    if (!sha256) {
      受け口を見せる();
      set置きの知らせ(
        r.見つけた.length > 0
          ? `見つけて置きました：${r.見つけた.map((f) => `${f.県名}「${f.名前}」（${f.ファイル名}）`).join("、")}。「2．申請する都道府県」に印を付けました`
          : `ダウンロードのフォルダとデスクトップに、道具の知っている様式はありませんでした（見たのは ${r.見た.join("、") || "なし"}）。上の「様式ファイルを保存する」で落としてから、もう一度押してください`,
      );
    }
    return 当たり;
  }

  /** アプリ：県のサイトから様式を取ってきて置く */
  async function 県から取る(x: 様式) {
    const 口 = アプリの口();
    if (!口?.様式を取ってくる) return;
    set取りの知らせ(`${x.県名}の様式を県のサイトから取ってきています…`);
    const r = await 口.様式を取ってくる(x.県コード, x.sha256);
    if (!r.ok) {
      set取りの知らせ(
        `${x.県名}：${r.理由}。県のページから手で保存して、下に置いてください${r.入口 ? `（${r.入口}）` : ""}`,
      );
      return;
    }
    if (!r.対応表と一致) {
      set取りの知らせ(
        `${x.県名}：取ってきましたが、道具が知っている様式と中身が違います（県が様式を改めたのかもしれません）。まだ書けません`,
      );
      return;
    }
    await 取ってきた様式を置く();
    set選んだ県((m) => new Set(m).add(x.県コード));
    set取りの知らせ(
      `${x.県名}の「${r.名前}」を取ってきて、このパソコンに置きました`,
    );
  }

  // 下書きを作る様式：選んだ県の対応表（様式ファイルは作成のときに用意する）
  const 選んだ様たち = 様式たち.filter((x) => 選んだ県.has(x.県コード));
  /** 県ごとにまとめた様式（一つの県に申請書と事業計画の概要など、いくつもあることがある） */
  const 県の組たち = useMemo(() => {
    const m = new Map<string, 様式[]>();
    for (const x of 様式たち)
      m.set(x.県コード, [...(m.get(x.県コード) ?? []), x]);
    return [...m.values()];
  }, [様式たち]);
  const 県名たち = (a: 様式[]) => [...new Set(a.map((x) => x.県名))].join("・");
  const 様式の短い名 = (x: 様式) => x.名前.replace(/[（(].*$/, "");
  // 入力欄は、選んだ県の欄を id で合わせたもの（和歌山も山形も 申請日・住所・氏名… は同じ id）。
  // まだ県を選んでいないときも、下書きできる県全部の欄を出して、すぐ入れられるようにする
  const 様: 様式 | null = useMemo(() => {
    const 元たち = 選んだ様たち.length ? 選んだ様たち : 様式たち;
    if (元たち.length === 0) return null;
    const 元 = 元たち[0];
    const 欄 = [...元.欄];
    for (const x of 元たち.slice(1))
      for (const f of x.欄) if (!欄.some((g) => g.id === f.id)) 欄.push(f);
    const 書かない = 選んだ様たち.flatMap((x) =>
      x.書かない.map((b) => ({ ...b, 見出し: `${x.県名}：${b.見出し}` })),
    );
    // 区分（石綿・水銀・自動車等破砕物）は、選んだ県のどれかにあれば画面に出す（2026-11-06 みゆき「愛知と和歌山を選ぶと自動車等破砕物が出なかった」）。
    // 自動車等破砕物は、どの県でも三品目で選べる（書き方の無い県は要確認が出る）
    const 区分の品目: NonNullable<様式["区分の品目"]> = {};
    for (const x of 元たち)
      for (const [k, ids] of Object.entries(x.区分の品目 ?? {}) as [区分, string[]][])
        区分の品目[k] = [...new Set([...(区分の品目[k] ?? []), ...ids])];
    区分の品目.自動車等破砕物 = [...new Set([...(区分の品目.自動車等破砕物 ?? []), ...自動車等破砕物の品目])];
    return { ...元, 欄, 書かない, 区分の品目 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [選んだ県, 様式たち]);
  // 書き方の型（事業計画の概要の文）：型のある様式を選んだ分だけ（和歌山の申請書、山形の事業計画の概要…）。
  // 空きの id は県で共通（_共通の差し込み口.yaml）なので、同じ id の欄・口は一つにまとめて出す
  const 型の組たち = 選んだ様たち.flatMap((x) => {
    const t = 型たち.find((k) => k.sha256 === x.sha256);
    return t ? [{ 様: x, 型: t }] : [];
  });
  const 型の様 = 型の組たち[0]?.様 ?? null;
  const 型 = 型の組たち[0]?.型 ?? null;
  // 同じ id が二つの型にあるときは、書き方の形を持つ方・項目の多い方を残す（和歌山の全体計画の形の選びが、山形と一緒に選んでも消えないように）
  const 型の欄たち: { 型: 書き方の型; 欄: 型の欄 }[] = [];
  for (const g of 型の組たち)
    for (const k of g.型.欄) {
      const i = 型の欄たち.findIndex((y) => y.欄.id === k.id);
      if (i < 0) 型の欄たち.push({ 型: g.型, 欄: k });
      else if (!型の欄たち[i].欄.形?.length && k.形?.length)
        型の欄たち[i] = { 型: g.型, 欄: k };
    }
  const 差し込み口たち: 差し込み口[] = [];
  for (const g of 型の組たち)
    for (const d of g.型.差し込み口) {
      const i = 差し込み口たち.findIndex((y) => y.id === d.id);
      if (i < 0) 差し込み口たち.push(d);
      else if ((d.項目?.length ?? 0) > (差し込み口たち[i].項目?.length ?? 0))
        差し込み口たち[i] = d;
    }
  /** まとめた口で くり返し の組を数えるための型（口の一覧だけ差し替える） */
  const まとめた型: 書き方の型 | null = 型
    ? { ...型, 差し込み口: 差し込み口たち }
    : null;

  async function 置く(
    ファイル名: string,
    バイト: Uint8Array,
    選ぶ = true,
  ): Promise<置いた様式 | null> {
    // 様式を見分ける計算（sha256）は、https か 127.0.0.1 で開いたときだけブラウザが使わせてくれる
    if (!globalThis.crypto?.subtle) {
      set知らせ(
        "この開き方では様式を見分けられません。https のページか、このパソコンの 127.0.0.1 で開き直してください",
      );
      return null;
    }
    const sha256 = await sha256を出す(バイト);
    const x: 置いた様式 = {
      ファイル名,
      sha256,
      バイト,
      様: 表.get(sha256) ?? null,
    };
    set置たち((a) => [...a.filter((y) => y.sha256 !== sha256), x]);
    if (選ぶ && x.様) set選んだ県((m) => new Set(m).add(x.様!.県コード));
    set知らせ("");
    return x;
  }

  /** 作成のとき：選んだ県の様式を用意する。置いてあればそれを、アプリなら県のサイトから取ってくる */
  async function 様式を用意する(
    x: 様式,
  ): Promise<{ 置: 置いた様式 } | { 置: null; 理由: string }> {
    const ある = 置たち.find((p) => p.sha256 === x.sha256);
    if (ある) return { 置: ある };
    // ダウンロードのフォルダに落ちていれば、それを使う（愛知のように道具が取ってこられない県のため）
    const 落ちていた = await ダウンロードから探す(x.sha256);
    if (落ちていた) return { 置: 落ちていた };
    const 口 = アプリの口();
    if (!口?.様式を取ってくる || !口.取ってきた様式)
      return {
        置: null,
        理由: `様式がまだこの画面にありません。ブラウザは、ダウンロードしたファイルを自分では読めません。「様式ファイルを保存する」で落とした様式ファイル（${x.名前}）を、この画面にドラッグして落とすか、下の「様式を手で置く」で選んでから、もう一度「作成」を押してください`,
      };
    if (x.自動で取れない)
      return {
        置: null,
        理由: `${x.自動で取れない}。下の「様式を手で置く」の「様式ファイルを保存する」で様式を落としてから、もう一度「作成」を押してください（ダウンロードのフォルダから見つけます）`,
      };
    const r = await 口.様式を取ってくる(x.県コード, x.sha256);
    if (!r.ok)
      return {
        置: null,
        理由: `県のサイトから様式を取れませんでした（${r.理由}）。県のページから手で保存して、下の「様式を手で置く」から置いてください`,
      };
    if (!r.対応表と一致)
      return {
        置: null,
        理由: "取ってきた様式が、道具の知っている様式と違います（県が様式を改めたのかもしれません）。まだ書けません",
      };
    const t = (await 口.取ってきた様式()).find(
      (y) => y.sha256 === x.sha256 && y.中身,
    );
    const p = t
      ? await 置く(t.ファイル名, base64からバイト(t.中身!), false)
      : null;
    return p
      ? { 置: p }
      : { 置: null, 理由: "取ってきた様式を読めませんでした" };
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
        set知らせ(
          "この開き方では様式を見分けられません。https のページか、このパソコンの 127.0.0.1 で開き直してください",
        );
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

  /** 受け口を開いて、そこまで画面を送る（知らせを見せるため） */
  function 受け口を見せる() {
    set手で置くを開く(true);
    setTimeout(
      () =>
        置き場の枠.current?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        }),
      50,
    );
  }

  /** 置かれたファイルを受ける。zip・古い形・様式でないものは、理由を言って置かない */
  async function ファイルを受ける(f: File | undefined) {
    if (!f) return;
    const 名 = f.name;
    const 形 = 名.toLowerCase().split(".").pop() ?? "";
    受け口を見せる();
    if (形 === "zip") {
      set置きの知らせ(
        `「${名}」は zip のままでは置けません。zip を展開（ダブルクリック）して、中の Word（.docx）か Excel（.xlsx）の様式を置いてください`,
      );
      return;
    }
    if (形 === "doc" || 形 === "xls") {
      set置きの知らせ(
        `「${名}」は古い形（.${形}）なので、道具は読めません。道具が書けるのは、上の一覧の「様式ファイルを保存する」から保存した様式（${県名たち(様式たち)}）だけです`,
      );
      return;
    }
    if (形 !== "docx" && 形 !== "xlsx") {
      set置きの知らせ(
        `「${名}」は Word（.docx）でも Excel（.xlsx）でもないので置けません`,
      );
      return;
    }
    const バイト = new Uint8Array(await f.arrayBuffer());
    const x = await 置く(名, バイト);
    if (!x) return;
    if (x.様) {
      let 覚えた = "";
      const 口 = アプリの口();
      if (口?.様式を覚える) {
        try {
          const r = await 口.様式を覚える(名, バイトからbase64(バイト));
          if (r.ok) 覚えた = "。アプリが覚えたので、次に開いたときも使えます";
        } catch {
          /* 覚えられなくても置けてはいる */
        }
      }
      set置きの知らせ(
        `${x.様.県名}「${x.様.名前}」を置きました（${名}）。「2．申請する都道府県」の${x.様.県名}に印を付けました。「4．作成する」でこの様式に書きます${覚えた}`,
      );
    } else
      set置きの知らせ(
        `「${名}」を置きましたが、道具の知っている様式と中身が違うので、まだ下書きできません。県のページから保存し直すか、上の一覧の「様式ファイルを保存する」から保存した様式を置いてください`,
      );
  }

  // ページのどこにファイルを落としても受ける（受け口の外に落とすと、ブラウザがファイルを開いてしまうため）
  const 受け方 = useRef(ファイルを受ける);
  受け方.current = ファイルを受ける;
  useEffect(() => {
    const ある = (e: DragEvent) => !!e.dataTransfer?.types?.includes("Files");
    const over = (e: DragEvent) => {
      if (!ある(e)) return;
      e.preventDefault();
      set重ねる(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) set重ねる(false);
    };
    const drop = (e: DragEvent) => {
      if (!ある(e)) return;
      e.preventDefault();
      set重ねる(false);
      for (const f of Array.from(e.dataTransfer?.files ?? []))
        void 受け方.current(f);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
    };
  }, []);

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
        if (sp.二行目)
          説明.push(
            `${sp.区切り}で2行目へ送ります：1行目「${sp.一行目}」／2行目「${sp.二行目}」。切る位置を確かめてください`,
          );
        if (sp.切り捨て)
          説明.push(
            `2行目にも入らず「${sp.切り捨て}」が切れます。書き方を考え直してください`,
          );
        m.set(f.id, {
          id: f.id,
          見出し: f.見出し,
          状態: 説明.length ? "要確認" : "書いた",
          説明,
        });
      } else if (f.種類 === "空白") {
        const v = 全角に((値たち[f.id] ?? "").trim());
        const 入る = (f.幅 ?? f.空白) - (f.頭 ?? 0);
        if (!v) continue;
        const n = Array.from(v).length;
        m.set(
          f.id,
          n > 入る
            ? {
                id: f.id,
                見出し: f.見出し,
                状態: "要確認",
                説明: [`${入る}字の欄に${n}字です。${入る}字で切れます`],
              }
            : { id: f.id, 見出し: f.見出し, 状態: "書いた", 説明: [] },
        );
      }
    }
    return m;
  }, [様, 値たち]);

  /** 見本の会社（架空）を画面に入れる。写真はこのサイトの中から読み込む（外へは何も送らない） */
  async function 見本を入れる() {
    set値たち({ ...見本の値 });
    set中身({ ...見本の中身, 品目: 見本の中身.品目.map((x) => ({ ...x })) });
    set組の数((c) => ({ ...c, ...見本の組の数 }));
    const 写: Record<string, 写真> = {};
    for (const x of 見本の写真) {
      try {
        const r = await fetch(new URL(x.場所, location.origin), { credentials: "omit" });
        if (r.ok) 写[x.鍵] = { 名前: x.名前, バイト: new Uint8Array(await r.arrayBuffer()) };
      } catch {
        // 写真が読めなくても、値と品目は入れる
      }
    }
    set写真たち(写);
    set知らせ(`見本の会社（架空の ${見本の値["氏名"]}）を入れました。申請する都道府県に印を付けて「作成」を押してください${Object.keys(写).length ? "。車両と容器の写真はデモ用のイラストです" : ""}`);
  }

  async function 書いて保存() {
    if (選んだ様たち.length === 0) {
      set知らせ("申請する都道府県を選んでください");
      return;
    }
    set作成中(true);
    set知らせ(`${県名たち(選んだ様たち)}の下書きを作っています…`);
    const 文たち: string[] = [];
    const 日 = 今日();
    let 作った = 0;
    let 開く場所 = "";
    for (const x of 選んだ様たち) {
      const 呼び名 =
        様式たち.filter((y) => y.県コード === x.県コード).length > 1
          ? `${x.県名}の${様式の短い名(x)}`
          : x.県名;
      const 用意 = await 様式を用意する(x);
      if (!用意.置) {
        文たち.push(`${呼び名}：${用意.理由}`);
        set手で置くを開く(true);
        continue;
      }
      const 型x = 型たち.find((t) => t.sha256 === x.sha256) ?? null;
      const r = await docxを作る(用意.置, x, 値たち, 中身, 型x, 写真たち);
      if (!r.ok) {
        文たち.push(`${呼び名}：書きませんでした（${r.理由}）`);
        continue;
      }
      const 確 = r.結果.filter((y) => y.状態 === "要確認").length;
      const 拡張子 = /\.xlsx$/i.test(x.ファイル名) ? "xlsx" : "docx";
      const 名 = `${x.県名}_${x.名前.replace(/[（(].*$/, "").slice(0, 20)}_下書き_${日}.${拡張子}`;
      const 口 = 下書きの口();
      if (口) {
        // 置き場の下に 事業者名_新規／県名／ と分ける（2026-11-07 みゆき「何の申請書を作ったか分かるように」）
        const 小分け = [`${(値たち["氏名"] ?? "").trim() || "名前なし"}_新規`, x.県名];
        const w = await 口.保存(名, new Uint8Array(await r.blob.arrayBuffer()), 小分け);
        文たち.push(
          w.ok
            ? `${呼び名}：「${w.ファイル名}」（要確認 ${確}件）`
            : `${呼び名}：保存できませんでした（${w.理由}）`,
        );
        if (w.ok) {
          開く場所 = w.親 ?? w.置き場;
          set下書きの置き場(開く場所);
          作った++;
        }
      } else {
        保存させる(r.blob, 名);
        文たち.push(`${呼び名}：「${名}」（要確認 ${確}件）`);
        作った++;
      }
    }
    // アプリでは、作ったら事業者さんのフォルダを開く（2026-11-07 みゆき「作成したところを自動で開くように」）
    if (開く場所) void 下書きの口()?.置き場を開く(開く場所);
    // アプリでは、作成と一緒に名簿にも入れる（会社名があるとき）
    let 名簿 = "";
    if (作った > 0 && アプリ && (値たち["氏名"] ?? "").trim()) {
      const ok = await 控えを保存();
      名簿 = ok ? "名簿にも入れました。" : "";
    }
    set作成中(false);
    set知らせ(
      作った > 0
        ? `下書きを${作った}つ作りました（このパソコンの中だけ）。${名簿}${文たち.join("　")}。Word・Excel で開いて、要確認の所を確かめてください`
        : `下書きを作れませんでした。${文たち.join("　")}`,
    );
  }

  async function 控えを保存(): Promise<boolean> {
    if (!様) return false;
    const k = 控えを作る(様, 値たち, 今日(), 中身);
    const 名 = (値たち["氏名"] ?? "").trim() || "事業者";
    const 文 = JSON.stringify(k, null, 2) + "\n";
    const ファイル名 = `控え_${名}_${k.保存日}.json`;
    if (アプリ) {
      const r = await アプリ.保存(ファイル名, 文);
      if (!r.ok) {
        set控えの知らせ(`保存できませんでした：${r.理由}`);
        return false;
      }
      await 一覧を読み直す();
      set選んだ控え(r.ファイル名);
      set控えの知らせ(
        `「${名}」を名簿に入れました（このパソコンの中だけ）。次からは、事業者さんの名簿か下の一覧から選べば欄が埋まります`,
      );
      return true;
    }
    保存させる(new Blob([文], { type: "application/json" }), ファイル名);
    set控えの知らせ(
      "名簿のファイルを保存しました（このパソコンの中だけ）。次はこのファイルを読み込めば、同じ値で書けます",
    );
    return true;
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
      `名簿から読み込みました（${r.控え.保存日} に入れた分）。` +
        (違う
          ? `別の様式（${r.控え.様式.名前}）で入れた分です。同じ欄だけ入れました。確かめてください`
          : ""),
    );
  }

  const 変える = (id: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set値たち((v) => ({ ...v, [id]: e.target.value }));

  // 品目の選び。並びは施行令の順に lib がそろえる
  const 選び = useMemo(() => new Map(中身.品目.map((x) => [x.id, x])), [中身]);
  const 品目を切り替える = (id: string) =>
    set中身((c) => ({
      ...c,
      品目: c.品目.some((x) => x.id === id)
        ? c.品目.filter((x) => x.id !== id)
        : [...c.品目, { id }],
    }));
  const 水銀使用製品を切り替える = (id: string) =>
    set中身((c) => ({
      ...c,
      品目: c.品目.map((x): 品目の選び =>
        x.id === id ? { ...x, 水銀使用製品: !x.水銀使用製品 } : x,
      ),
    }));
  // くり返しの組（車両・容器など）の欄の数。初めは一つ。「足す」で増やす（2026-11-06 みゆき「最初は１つずつ入力欄があって、ボタンを押すと増やせるように」）
  const [組の数, set組の数] = useState<Record<string, number>>({});
  const 組を足す = (id: string, 最大: number) =>
    set組の数((c) => ({ ...c, [id]: Math.min(最大, Math.max(c[id] ?? 1, ...入っている組(まとめた型!, id, 値たち)) + 1) }));
  const 自動車等破砕物を切り替える = (id: string) =>
    set中身((c) => ({
      ...c,
      品目: c.品目.map((x): 品目の選び =>
        x.id === id ? { ...x, 自動車等破砕物: !x.自動車等破砕物 } : x,
      ),
    }));
  const 含みを選ぶ = (id: string, k: "石綿" | "水銀含有ばいじん等", v: 含み) =>
    set中身((c) => ({
      ...c,
      品目: c.品目.map((x): 品目の選び =>
        x.id === id ? { ...x, [k]: v === "含まない" ? undefined : v } : x,
      ),
    }));
  const 型の見込み = useMemo(
    () =>
      型の組たち.flatMap((g) =>
        型を組む(g.型, g.様, 値たち, 中身).map((r) => ({ ...r, 型: g.型 })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [選んだ県, 型たち, 値たち, 中身],
  );
  const 使う = useMemo(() => {
    const r = new Set<string>();
    for (const g of 型の組たち) {
      for (const id of 使う口(g.型, 値たち, 中身の印(g.様, 中身))) r.add(id);
      for (const id of 様式が使う口(g.様, g.型)) r.add(id);
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [選んだ県, 型たち, 値たち, 中身]);
  const 品目の名 = useMemo(
    () => (型の様 ? 品目の名たち(型の様, 中身) : []),
    [型の様, 中身],
  );

  return (
    <>
      <a className="back" href="/">
        全国の地図へ戻る
      </a>
      <h1>申請書に下書きする</h1>
      <p className="lead">
        事業者さんの情報を入れ、申請する都道府県を選び、品目を入れると、県ごとの公式の様式に書き込んだ下書きができます。県を選ぶと、その県の様式にどう書くかが、その下に出ます。書き込みはこのパソコンの中だけで行い、事業者さんの情報はどこにも送りません（Claude
        にも送りません）。 様式の書式・改行・枠はそのまま残ります。最後は必ず
        Word・Excel で開いて、行政書士が確かめてください。
      </p>
      {来た県 && (
        <p className={s.here} data-testid="来た県">
          {様式たち.find((x) => x.県コード === 来た県)?.県名}
          のページから来ました。この県を選んでいます。ほかの県も一緒に作るときは、「2．申請する都道府県」で印を付けてください
        </p>
      )}

      {様 && (
        <>
          <h2>1．事業者さんの情報</h2>
          <p className={s.note}>
            半角の英数字は全角にして書きます。空けた欄は様式のままにします（触りません）。
          </p>
          <div className={s.buttons}>
            <button type="button" data-testid="見本の会社で試す" disabled={作成中} onClick={() => void 見本を入れる()}>
              見本の会社で試す（架空の会社・品目・車両・容器・写真まで入ります）
            </button>
            <span className={s.faint}>入っている値は消えて、見本に置き換わります。県を選んで「作成」まで押せば、県ごとの書き方の違いが見られます</span>
          </div>
          <div className={s.form}>
            {様.欄.map((f) => {
              const 見 = 見込み.get(f.id);
              return (
                <div key={f.id} className={s.row}>
                  <label
                    className={s.label}
                    htmlFor={f.種類 === "日付" ? `${f.id}.年` : f.id}
                  >
                    {f.見出し}
                  </label>
                  <div>
                    {f.種類 === "日付" ? (
                      <span className={s.date}>
                        令和
                        <input
                          id={`${f.id}.年`}
                          data-testid={`${f.id}.年`}
                          value={値たち[`${f.id}.年`] ?? ""}
                          onChange={変える(`${f.id}.年`)}
                        />
                        年
                        <input
                          id={`${f.id}.月`}
                          data-testid={`${f.id}.月`}
                          value={値たち[`${f.id}.月`] ?? ""}
                          onChange={変える(`${f.id}.月`)}
                        />
                        月
                        <input
                          id={`${f.id}.日`}
                          data-testid={`${f.id}.日`}
                          value={値たち[`${f.id}.日`] ?? ""}
                          onChange={変える(`${f.id}.日`)}
                        />
                        日
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

          <h2>2．申請する都道府県</h2>
          <p className={s.note}>
            いくつでも選べます。選んだ県の数だけ、下書きができます（今、下書きできるのは
            {県名たち(様式たち)}です）。
          </p>
          <div data-testid="申請する県">
            {地方ごと(県の組たち).map(({ 地方, 組たち }) => (
              <div key={地方} className={s.region}>
                <h3 className={s.h3}>{地方}</h3>
                <ul className={`${s.list} ${s.kenList}`}>
                  {組たち.map((組) => {
                    const x = 組[0];
                    return (
                      <li
                        key={x.県コード}
                        data-testid={`県の様式-${x.県コード}`}
                        className={
                          x.県コード === 来た県 ? s.hereItem : undefined
                        }
                      >
                        <label className={s.kenPick}>
                          <input
                            type="checkbox"
                            data-testid={`県を選ぶ-${x.県コード}`}
                            checked={選んだ県.has(x.県コード)}
                            onChange={() =>
                              set選んだ県((m) => {
                                const n = new Set(m);
                                if (n.has(x.県コード)) n.delete(x.県コード);
                                else n.add(x.県コード);
                                return n;
                              })
                            }
                          />
                          <strong>{x.県名}</strong>
                          {組.length === 1 && <span>{x.名前}</span>}
                        </label>
                        {組.map((y) => {
                          const ある = 置たち.some(
                            (p) => p.sha256 === y.sha256,
                          );
                          return (
                            <span
                              key={y.sha256}
                              className={s.faint}
                              style={
                                組.length > 1 ? { display: "block" } : undefined
                              }
                            >
                              {組.length > 1 && <>{y.名前}：</>}
                              {ある ? (
                                "様式はこのパソコンにあります"
                              ) : y.自動で取れない && 取れる ? (
                                <>
                                  {y.自動で取れない}。
                                  {y.ファイルの場所 ? (
                                    <>
                                      「
                                      <a
                                        href={y.ファイルの場所}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        様式ファイルを保存する
                                      </a>
                                      」を押すと、いつものブラウザがダウンロードのフォルダに落とします。そのあと「作成」を押せば、アプリがそのフォルダから見つけます
                                    </>
                                  ) : (
                                    <>
                                      <a
                                        href={y.入口}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        県のページ
                                      </a>
                                      から様式を保存して、下の「様式を手で置く」から置いてください
                                    </>
                                  )}
                                </>
                              ) : y.自動で取れない || !取れる ? (
                                <>
                                  {y.ファイルの場所 ? (
                                    <a
                                      href={y.ファイルの場所}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      様式ファイルを保存する
                                    </a>
                                  ) : (
                                    <a
                                      href={y.入口}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      県のページ
                                    </a>
                                  )}
                                  で様式を保存して、下の「様式を手で置く」から置いてください
                                  {y.自動で取れない
                                    ? `（${y.自動で取れない}）`
                                    : ""}
                                </>
                              ) : (
                                "作成のときに県のサイトから取ってきます"
                              )}
                            </span>
                          );
                        })}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {(様.品目 ||
            様.品目の文 ||
            様式たち.some((x) => x.品目 || x.品目の文 || x.品目のセル)) && (
            <>
              <h2>3．申請する品目と積替保管</h2>
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
                              <input
                                type="checkbox"
                                data-testid={`品目-${h.id}`}
                                checked={!!x}
                                onChange={() => 品目を切り替える(h.id)}
                              />
                              {h.名前}
                            </label>
                            {x &&
                              様 &&
                              (区分がある(様, h.id, "石綿") ||
                                区分がある(様, h.id, "水銀使用製品") ||
                                区分がある(様, h.id, "水銀含有ばいじん等") ||
                                区分がある(様, h.id, "自動車等破砕物")) && (
                                <span className={s.soe}>
                                  {(["石綿", "水銀含有ばいじん等"] as const)
                                    .filter((k) => 区分がある(様, h.id, k))
                                    .map((k) => {
                                      const 名 =
                                        k === "石綿"
                                          ? "石綿含有産業廃棄物"
                                          : "水銀含有ばいじん等";
                                      const 今 = x[k] ?? "含まない";
                                      return (
                                        <span
                                          key={k}
                                          className={s.fukumi}
                                          data-testid={`${k}-${h.id}`}
                                        >
                                          {含みたち.map((c) => (
                                            <label
                                              key={c.値}
                                              className={s.check1}
                                            >
                                              <input
                                                type="radio"
                                                name={`${k}-${h.id}`}
                                                data-testid={`${k}-${h.id}-${c.値}`}
                                                checked={今 === c.値}
                                                onChange={() =>
                                                  含みを選ぶ(h.id, k, c.値)
                                                }
                                              />
                                              {c.言い方(名)}
                                            </label>
                                          ))}
                                        </span>
                                      );
                                    })}
                                  {区分がある(様, h.id, "水銀使用製品") && (
                                    <label className={s.check1}>
                                      <input
                                        type="checkbox"
                                        data-testid={`水銀使用製品-${h.id}`}
                                        checked={!!x.水銀使用製品}
                                        onChange={() =>
                                          水銀使用製品を切り替える(h.id)
                                        }
                                      />
                                      水銀使用製品産業廃棄物を含む
                                    </label>
                                  )}
                                  {区分がある(様, h.id, "自動車等破砕物") && (
                                    <label className={s.check1}>
                                      <input
                                        type="checkbox"
                                        data-testid={`自動車等破砕物-${h.id}`}
                                        checked={!!x.自動車等破砕物}
                                        onChange={() =>
                                          自動車等破砕物を切り替える(h.id)
                                        }
                                      />
                                      自動車等破砕物（シュレッダーダスト）を含む
                                    </label>
                                  )}
                                </span>
                              )}
                          </div>
                        );
                      })}
                    </div>
                    <div className={s.faint}>
                      並びは廃棄物処理法施行令の順です。石綿・水銀の欄は、その区分になりうる品目にだけ出しています。どの品目に出すかは県で違うことがあるので、様式ごとの対応表に持っています（和歌山：石綿は手引き
                      p4
                      の4品目。水銀の2つは法令の区分から道具が選んだもので、要確認です）。
                    </div>
                  </div>
                </div>
                <div className={s.row}>
                  <div className={s.label}>積替え又は保管</div>
                  <div>
                    <span className={s.date}>
                      <label className={s.check1}>
                        <input
                          type="radio"
                          name="積替保管"
                          data-testid="積替保管-無"
                          checked={中身.積替保管 === "無"}
                          onChange={() =>
                            set中身((c) => ({ ...c, 積替保管: "無" }))
                          }
                        />
                        無
                      </label>
                      <label className={s.check1}>
                        <input
                          type="radio"
                          name="積替保管"
                          data-testid="積替保管-有"
                          checked={中身.積替保管 === "有"}
                          onChange={() =>
                            set中身((c) => ({ ...c, 積替保管: "有" }))
                          }
                        />
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
                            添付が要るもの（道具では作れません。{様.県名}
                            の手引きに書いてあるものだけを並べています）
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
                  <div data-fold-group>
                    <組の帯
                      件数={選んだ様たち.length}
                      何="様式にこう書きます"
                    />
                    {選んだ様たち.map((x0) => {
                      const x = { 様: x0 };
                      const 見 = 品目を書き出す(x.様, 中身);
                      if (!見) return null;
                      const 箱の形 = !!x.様.品目;
                      return (
                        <details
                          className={s.fold}
                          key={x0.sha256}
                          open={選んだ様たち.length === 1}
                        >
                          <summary>
                            {x.様.県名}の様式にこう書きます
                            {[...丸の説明(見), ...見.要確認].length > 0 && (
                              <span className={s.badge}>
                                要確認 {[...丸の説明(見), ...見.要確認].length}
                              </span>
                            )}
                          </summary>
                          <div data-testid={`品目の見込み-${x.様.県コード}`}>
                            <div className={s.faint}>
                              第1面「事業の範囲」（{x.様.県名}
                              の申請書記載例の書き方）
                            </div>
                            <div className={s.preview}>
                              {見.行たち.map((t, k) => (
                                <div key={k}>{t}</div>
                              ))}
                              {箱の形 && (
                                <>
                                  <div>
                                    石綿含有産業廃棄物【有・無】（
                                    {見.石綿の番号}）
                                  </div>
                                  <div>水銀使用製品産業廃棄物【有・無】</div>
                                  <div>
                                    水銀含有ばいじん等【有・無】（
                                    {見.水銀含有ばいじん等の番号}）
                                  </div>
                                  <div>積替え又は保管【有・無】</div>
                                </>
                              )}
                            </div>
                            {箱の形 && (
                              <>
                                <div className={s.faint}>
                                  【有・無】の○は、Word
                                  の囲い文字で付けます。LibreOffice
                                  では囲い文字が見えず「無」などが消えて見えるので、Word
                                  で開いて確かめてください。
                                </div>
                                <div className={s.faint}>
                                  事業計画の概要の品目表、品目の名前の列（
                                  {x.様.県名}の様式記載例の書き方）
                                </div>
                                <ol className={s.preview}>
                                  {見.表の行.map((t, k) => (
                                    <li key={k}>{t}</li>
                                  ))}
                                </ol>
                              </>
                            )}
                            {[...丸の説明(見), ...見.要確認].length > 0 && (
                              <div
                                className={s.check}
                                data-testid={`要確認-品目-${x.様.県コード}`}
                              >
                                <span className={s.badge}>要確認</span>
                                {[...丸の説明(見), ...見.要確認].map((t, k) => (
                                  <div key={k}>{t}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        </details>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {型の組たち.length > 0 && 型 && まとめた型 && (
            <details className={s.fold} open data-testid="事業計画の欄">
              <summary className={s.foldHead}>
                事業計画の概要・環境保全措置の文（
                {型の組たち.map((g) => g.型.県名).join("・")}
                の記載例の書き方の型）
              </summary>
              <p className={s.note}>
                型の文は{型の組たち.map((g) => g.型.県名).join("・")}
                の記載例と手引きから前もって作ったものです。下の欄に入れた事業者の中身を、このブラウザの中で差し込みます（どこにも送りません）。
                空けた所は様式に「【要確認：…】」と残します。品目を選んだときだけ書きます。型の文は記載例の会社の例なので、事業者の実際に合わせて行政書士が直してください。
              </p>
              <div className={s.form}>
                {型の欄たち
                  .map((y) => y.欄)
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
                                  onChange={() =>
                                    set値たち((v) => ({
                                      ...v,
                                      [形の鍵(k.id)]: f.id,
                                    }))
                                  }
                                />
                                {f.見出し}
                              </label>
                            ))}
                          </span>
                          {k.形の説明 && (
                            <div className={s.faint}>{k.形の説明}</div>
                          )}
                          {今?.説明 && <div className={s.faint}>{今.説明}</div>}
                        </div>
                      </div>
                    );
                  })}
                {差し込み口たち
                  .filter((d) => d.種類 !== "自動" && 使う.has(d.id))
                  .map((d) =>
                    d.種類 === "品目ごと" ? (
                      <div key={d.id} className={s.row}>
                        <div className={s.label}>{d.見出し}</div>
                        <div data-testid={`品目ごと-${d.id}`}>
                          {品目の名.length === 0 && (
                            <div className={s.faint}>
                              上で品目を選ぶと、品目ごとの欄が出ます
                            </div>
                          )}
                          {品目の名.map((h) => (
                            <div key={h.鍵} className={s.kumi}>
                              <div className={s.kumiHead}>{h.名}</div>
                              {(d.項目 ?? []).map((k) => (
                                <input
                                  key={k.id}
                                  aria-label={`${h.名} ${k.見出し}`}
                                  data-testid={くり返しの鍵(d.id, h.鍵, k.id)}
                                  className={s.input}
                                  value={
                                    値たち[くり返しの鍵(d.id, h.鍵, k.id)] ?? ""
                                  }
                                  placeholder={
                                    k.例
                                      ? `${k.見出し}（例：${k.例}）`
                                      : k.見出し
                                  }
                                  onChange={変える(
                                    くり返しの鍵(d.id, h.鍵, k.id),
                                  )}
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
                          {Array.from(
                            {
                              length: Math.min(
                                d.最大 ?? 10,
                                Math.max(
                                  1,
                                  組の数[d.id] ?? 1,
                                  ...入っている組(まとめた型, d.id, 値たち),
                                ),
                              ),
                            },
                            (_, j) => j + 1,
                          ).map((n) => (
                            <div key={n} className={s.kumi}>
                              <div className={s.kumiHead}>
                                {d.見出し} {n}
                              </div>
                              {(d.項目 ?? []).map((k) => (
                                <input
                                  key={k.id}
                                  aria-label={`${d.見出し} ${n} ${k.見出し}`}
                                  data-testid={くり返しの鍵(d.id, n, k.id)}
                                  className={s.input}
                                  value={
                                    値たち[くり返しの鍵(d.id, n, k.id)] ?? ""
                                  }
                                  placeholder={
                                    k.例
                                      ? `${k.見出し}（例：${k.例}）`
                                      : k.見出し
                                  }
                                  onChange={変える(くり返しの鍵(d.id, n, k.id))}
                                />
                              ))}
                              {(d.写真 ?? []).map((k) => {
                                const 鍵 = `${d.id}.${n}.${k.id}`;
                                const 今 = 写真たち[鍵];
                                return (
                                  <div
                                    key={k.id}
                                    className={s.photo}
                                    data-testid={`写真-${鍵}`}
                                  >
                                    <span className={s.faint}>{k.見出し}</span>
                                    {今 ? (
                                      <>
                                        <span className={s.photoName}>
                                          {今.名前}
                                        </span>
                                        <button
                                          type="button"
                                          className={s.small}
                                          onClick={() => 写真を外す(鍵)}
                                        >
                                          外す
                                        </button>
                                      </>
                                    ) : (
                                      <input
                                        type="file"
                                        accept="image/png,image/jpeg"
                                        aria-label={`${d.見出し} ${n} ${k.見出し}`}
                                        onChange={(e) =>
                                          void 写真を受ける(
                                            鍵,
                                            e.target.files?.[0],
                                          )
                                        }
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                          {Math.min(
                            d.最大 ?? 10,
                            Math.max(
                              1,
                              組の数[d.id] ?? 1,
                              ...入っている組(まとめた型, d.id, 値たち),
                            ),
                          ) < (d.最大 ?? 10) && (
                            <div className={s.buttons}>
                              <button
                                type="button"
                                className={s.small}
                                data-testid={`組を足す-${d.id}`}
                                onClick={() => 組を足す(d.id, d.最大 ?? 10)}
                              >
                                {d.見出し}をもう一組足す
                              </button>
                            </div>
                          )}
                          {d.写真 &&
                            選んだ様たち.some((x) => x.写真の場所?.length) && (
                              <div className={s.faint}>
                                写真は PNG か JPEG。
                                {選んだ様たち
                                  .filter((x) => x.写真の場所?.length)
                                  .map(
                                    (x) =>
                                      `${x.県名}の様式の写真の面（${[...new Set(x.写真の場所!.map((p) => p.見出し.replace(/（.*$/, "")))].join("・")}）`,
                                  )
                                  .join("、")}
                                に貼ります。写真は控えには入れず、このパソコンの中だけで扱います
                              </div>
                            )}
                          {d.写真 &&
                            !選んだ様たち.some((x) => x.写真の場所?.length) &&
                            選んだ様たち.length > 0 && (
                              <div className={s.faint}>
                                選んだ県の様式には、道具が写真を貼る所をまだ決めていません。写真は手で貼ってください
                              </div>
                            )}
                          {d.説明 && <div className={s.faint}>{d.説明}</div>}
                        </div>
                      </div>
                    ),
                  )}
                {中身.品目.length > 0 && (
                  <div data-fold-group>
                    <組の帯
                      件数={型の組たち.length}
                      何="事業計画の概要の見込み"
                    />
                    {型の見込み.map((g) => (
                      <details
                        key={`${g.型.sha256}-${g.id}`}
                        className={s.fold}
                        open={型の組たち.length === 1}
                      >
                        <summary>
                          {型の組たち.length > 1
                            ? `${g.型.県名}：${g.見出し}`
                            : g.見出し}
                          {g.要確認.length > 0 && (
                            <span className={s.badge}>
                              要確認 {g.要確認.length}
                            </span>
                          )}
                        </summary>
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
                                const k = g.型.欄.find((x) => x.id === g.id);
                                return k ? 欄の行(k, 値たち) : [];
                              })()
                                .flatMap((r) =>
                                  r.くり返し ? [r, ...(r.行 ?? [])] : [r],
                                )
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
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </details>
          )}

          {様.書かない.length > 0 && <h3 className={s.h3}>今は書かない欄</h3>}
          <ul className={s.later}>
            {様.書かない.map((x) => (
              <li key={x.見出し}>
                <span
                  className={x.印 === "型が入る予定" ? s.badgeKata : s.badge}
                >
                  {x.印 === "型が入る予定" ? "型が入る予定・要確認" : "要確認"}
                </span>
                {x.見出し}：{x.理由}
              </li>
            ))}
          </ul>

          <h2>4．作成する</h2>
          <p className={s.note}>
            {取れる
              ? "選んだ県の様式を、道具が県のサイトから取ってきて書き込みます（県の公開ページから取るだけで、事業者さんの情報は送りません）。前に取ってきた様式があれば、それを使います。作った下書きは書類の「よみどころ_下書き」に、県の名前のファイルで残ります。事業者さんは名簿にも入ります。"
              : "選んだ県の様式に書き込みます。ブラウザでは道具が県のサイトから様式を取ってこられないので、下の「様式を手で置く」から、県のページで保存した様式を置いてください。"}
          </p>
          <div className={s.buttons}>
            <button
              type="button"
              className={s.primary}
              data-testid="書いて保存"
              disabled={作成中 || 選んだ様たち.length === 0}
              onClick={() => void 書いて保存()}
            >
              {作成中
                ? "作っています…"
                : 選んだ様たち.length
                  ? `${県名たち(選んだ様たち)}の下書きを作成する`
                  : "申請する都道府県を選んでください"}
            </button>
            {下書きの口() && (
              <button
                type="button"
                data-testid="下書きの置き場を開く"
                onClick={() => void 下書きの口()?.置き場を開く()}
              >
                下書きの置き場を開く
              </button>
            )}
          </div>
          {知らせ && (
            <p className={s.placed} data-testid="知らせ">
              {知らせ}
            </p>
          )}
        </>
      )}

      <h2>事業者さんの名簿</h2>
      <p className={s.note}>
        入れた事業者さんの情報と品目を、このパソコンの中に残します。次に同じ事業者さんの申請書を作るときは、名簿から選ぶだけで欄が埋まります。
      </p>
      {アプリ && (
        <p className={s.note}>
          アプリでは、よみどころ専用のフォルダに残し、
          <a href="/jigyosha/">事業者さんの名簿</a>に会社ごとに並びます。
        </p>
      )}
      <div className={s.buttons}>
        <button
          type="button"
          disabled={!様}
          data-testid="控えを保存"
          onClick={() => void 控えを保存()}
        >
          名簿に入れる
        </button>
        {アプリ && (
          <>
            <select
              value={選んだ控え}
              onChange={(e) => set選んだ控え(e.target.value)}
              disabled={控えの一覧.length === 0}
              data-testid="控えの一覧"
              aria-label="名簿に入れた事業者さん"
            >
              {控えの一覧.length === 0 && (
                <option value="">名簿にはまだ誰も入っていません</option>
              )}
              {控えの一覧.map((x) => (
                <option key={x.ファイル名} value={x.ファイル名}>
                  {x.ファイル名}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!選んだ控え}
              data-testid="控えを一覧から読む"
              onClick={() => void アプリの控えを読む()}
            >
              選んだ事業者さんを読み込む
            </button>
            <button
              type="button"
              data-testid="控えの置き場を開く"
              onClick={() => void アプリ.置き場を開く()}
            >
              名簿のフォルダを開く
            </button>
          </>
        )}
        <button
          type="button"
          data-testid="控えを読む"
          onClick={() => 控えの口.current?.click()}
        >
          {アプリ
            ? "ほかの場所のファイルから読み込む"
            : "名簿のファイルから読み込む"}
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

      <details
        className={s.manual}
        open={!取れる || 手で置くを開く}
        data-testid="様式を手で置く"
      >
        <summary>
          様式を手で置く（県のサイトから取れなかったとき・ブラウザで使うとき）
        </summary>
        {試せる.length > 0 && (
          <div className={s.trial}>
            <p className={s.note}>
              まず試すなら：県の様式の写しを、このサイトに一つだけ置いています。押すとこのサイトから読み込みます（外へは何も送りません）。架空の会社で書いてみてください
            </p>
            {試せる.map((x) => (
              <div key={x.sha256}>
                <div className={s.buttons}>
                  <button
                    type="button"
                    className={s.primary}
                    data-testid={`試す-${x.sha256.slice(0, 8)}`}
                    onClick={() => void 試しの様式を置く(x)}
                  >
                    {x.県名}の{x.呼び名}で試す
                  </button>
                </div>
                <p className={s.source} data-testid="出典">
                  出典：{x.県名}「{x.出典の名前}」（
                  <a href={x.入口} target="_blank" rel="noopener noreferrer">
                    {x.入口}
                  </a>
                  、
                  {x.取得日.replace(
                    /^(\d{4})-0?(\d+)-0?(\d+)$/,
                    "$1年$2月$3日",
                  )}
                  取得）。
                  <a href={x.規約} target="_blank" rel="noopener noreferrer">
                    {x.規約の名前}
                  </a>
                  に基づき、中身を変えずに掲載しています。
                </p>
              </div>
            ))}
          </div>
        )}

        <h3 className={s.h3}>
          県から取ってくる（下書きできる県：{県名たち(様式たち)}）
        </h3>
        <p className={s.note}>
          {取れる
            ? "アプリでは、ボタンを押すと県のサイトから様式を取ってきて、このパソコンに置きます（県の公開ページから取るだけで、事業者の情報は送りません）。"
            : "ブラウザでは、道具は県のサイトから様式を取ってきません。下のページを開いて、様式ファイルを自分で保存してください。"}
        </p>
        <ul className={s.list}>
          {様式たち.map((x) => (
            <li key={x.sha256}>
              <a href={x.入口} target="_blank" rel="noopener noreferrer">
                {x.県名}の産業廃棄物収集運搬業のページ
              </a>
              　{x.名前}（ファイル名 {x.ファイル名}）
              {x.ファイルの場所 && (!取れる || x.自動で取れない) && (
                <>
                  <a
                    href={x.ファイルの場所}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`様式ファイル-${x.sha256.slice(0, 8)}`}
                  >
                    様式ファイルを保存する
                  </a>
                </>
              )}
              {取れる && !x.自動で取れない && (
                <button
                  type="button"
                  className={s.small}
                  data-testid={`県から取る-${x.県コード}`}
                  onClick={() => void 県から取る(x)}
                >
                  {置たち.some((y) => y.sha256 === x.sha256)
                    ? "取り直す"
                    : "県のサイトから取ってくる"}
                </button>
              )}
            </li>
          ))}
        </ul>
        {取りの知らせ && <p className={s.placed}>{取りの知らせ}</p>}

        <h3 className={s.h3}>保存した様式をここに置く</h3>
        {取れる && (
          <p className={s.note}>
            「様式ファイルを保存する」で落としたら、
            <button
              type="button"
              className={s.small}
              data-testid="ダウンロードから探す"
              onClick={() => void ダウンロードから探す()}
            >
              ダウンロードのフォルダから様式を探す
            </button>
            を押してください。アプリがダウンロードのフォルダとデスクトップを見て、道具の知っている様式だけを覚えます（ほかのファイルは触りません）。「作成」を押したときも同じように探します
          </p>
        )}
        <div
          ref={置き場の枠}
          className={`${s.drop} ${重ねる ? s.dropOn : ""}`}
          onClick={() => 受け口.current?.click()}
          data-testid="様式の置き場"
        >
          ダウンロードした様式（Word か
          Excel）をここに置いてください。この画面のどこに落としても受け取ります。県ごとに何枚でも置けます。押して選ぶこともできます
          <input
            ref={受け口}
            type="file"
            accept=".docx,.xlsx"
            multiple
            className={s.hidden}
            data-testid="様式の受け口"
            onChange={(e) => {
              for (const f of Array.from(e.target.files ?? []))
                void ファイルを受ける(f);
              e.target.value = "";
            }}
          />
        </div>
        {置きの知らせ && (
          <p className={s.placedNote} data-testid="置きの知らせ">
            {置きの知らせ}
          </p>
        )}

        {手帳版 && (
          <div className={s.techo}>
            <p className={s.note}>
              手元の版だけ：手引き/ にすでにある様式（公開版には出ません）
            </p>
            {手元.length === 0 ? (
              <p className={s.note}>
                手引き/&lt;県&gt;/様式/ に様式ファイルがありません。
              </p>
            ) : (
              <ul className={s.list}>
                {手元.map((t) => (
                  <li key={`${t.県}/${t.ファイル名}`}>
                    {t.県}／{t.ファイル名}
                    {t.中身 ? (
                      <button
                        type="button"
                        className={s.small}
                        onClick={() =>
                          void 置く(t.ファイル名, base64からバイト(t.中身!))
                        }
                      >
                        これを使う
                      </button>
                    ) : (
                      <span className={s.faint}>
                        まだ対応表の無い様式（sha256 {t.sha256.slice(0, 12)}…）
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {置たち.length > 0 && (
          <div className={s.placed} data-testid="置いた様式">
            <div>このパソコンに置いた様式</div>
            <ul className={s.list}>
              {置たち.map((x) => (
                <li key={x.sha256}>
                  {x.様 ? (
                    <span>
                      <strong>{x.様.県名}</strong>「{x.様.名前}」（
                      {x.ファイル名}）
                    </span>
                  ) : (
                    <span>
                      {x.ファイル名}（sha256 {x.sha256.slice(0, 16)}…）
                      <strong className={s.warn}>
                        　この様式は、まだ下書きできません。下書きできるのは、対応表を作って人の目で確かめた様式（今は
                        {県名たち(様式たち)}
                        ）だけです。県が様式を改めたときも、ここに出ます
                      </strong>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </>
  );
}

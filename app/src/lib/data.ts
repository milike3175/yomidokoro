// ビルド時（と開発中の表示時）に YAML を読み、画面用の形にそろえる。サーバー側だけで使う。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse } from "yaml";
import type { ZodType } from "zod";
import {
  観点ファイル,
  品目ファイル,
  県ファイル,
  手引きファイル,
  受理実績ファイル,
  電話ファイル,
  補正ファイル,
  判定ファイル,
  type 観点,
  type 県,
  type 政令市,
} from "../../schema/record.ts";

export const 許認可 = "産廃収集運搬";

const APP = process.cwd();
const DATA = path.join(APP, "data");
/** 公開版に載せる見本の電話記録。手帳を読むとき（TECHO=1）は読まない（手帳の元の記録と二重になるため） */
const MIHON_DIR = path.join(DATA, "見本");
/** 手帳の置き場。試しのときだけ TECHO_ROOT で差し替える（本物の手帳に試しのファイルを置かないため） */
const TECHO_DIR = process.env.TECHO_ROOT ? path.resolve(process.env.TECHO_ROOT) : path.join(APP, "..", "手帳");
/** 手引きの置き場（_出典.yaml だけがリポジトリに入る）。試しのときだけ TEBIKI_ROOT で差し替える */
const TEBIKI_DIR = process.env.TEBIKI_ROOT ? path.resolve(process.env.TEBIKI_ROOT) : path.join(APP, "..", "手引き");

/** 手帳（みゆき専用の電話記録）を読むか。TECHO=1 のときだけ。公開用の書き出しには入れない */
export const 手帳を読む = process.env.TECHO === "1";

export type 種別 = "手引き" | "受理実績" | "電話" | "同業者" | "補正" | "記載なし";
export const 件数の種別 = ["手引き", "受理実績", "電話", "同業者", "補正"] as const;
export type 件数の種別 = (typeof 件数の種別)[number];

export type カード = {
  観点: string;
  種別: 種別;
  本文: string;
  問い?: string;
  /** 観点が 未分類 のときの候補 */
  候補観点?: string;
  /** 補正：どう直して通ったか */
  直し方?: string;
  /** 確認日（YYYY-MM / YYYY-MM-DD）。受理実績・補正は年だけなので null */
  確認日: string | null;
  受理年?: number;
  年?: number;
  窓口?: string;
  対象: string[];
  品目?: string[];
  出典?: { 文書: string; 文書名?: string; url?: string; 物理ページ: number; 印字ページ?: number | null; 引用: string; 照合: string };
  /** 電話の答えから手引きへのリンク。ページ は人が見た印字の番号、物理ページ は PDF の何枚目か */
  手引きへの参照?: { ページ: number; 物理ページ?: number; 内容?: string; url?: string };
  /** 手引きの改訂を検知したあと、まだ読み直していない文書から取った記録 */
  改訂?: boolean;
  /** 公開版に載せる見本の電話記録（app/data/見本/ から読んだもの） */
  見本?: boolean;
  探した語?: string[];
  /** ケンの判定（揺れ）。この記録と、相手の記録の組ごと。「対象が違う」は付けない */
  判定?: 判定の印[];
};

/** 画面に出す判定の答え。「対象が違う」は印を出さないので入れない */
export type 判定の種類 = "一致" | "補足" | "食い違い" | "判定不能";

export type 判定の印 = {
  判定: 判定の種類;
  理由: string;
  種類: "手引きと電話" | "電話どうし";
  /** 行政書士が確かめて片付けた。印は消さずに弱める */
  解消: boolean;
  /** 相手の記録が見つからなくなった組 */
  もう一度判定: boolean;
  /** 組の主（電話の答えの側）。手引きの側・古い電話の側は false。見比べを一度だけ出すのに使う */
  主: boolean;
  /** 組の相手（画面で並べて見せる分だけ写す） */
  相手: { 種別: 種別; 本文: string; 問い?: string; 確認日: string | null; 窓口?: string; ページ?: string; url?: string };
};

export type 手引きの状態 = "検品済み" | "未検品" | "未確認" | "未読";

export type 県データ = {
  県: 県;
  カード: カード[];
  件数: Record<件数の種別, number>;
  /** 手引き.yaml の有無と照合の結果から決める。無ければ県.yaml の値 */
  手引きの状態: 手引きの状態;
  /** 読んだ日より後に改訂を検知していれば、その日付と中身 */
  改訂: { 日付: string; 内容: string[] } | null;
  読んだ日: string | null;
  観点候補: { 名前: string; 主張?: string; 文書?: string; 物理ページ?: number; 引用: string; url?: string }[];
  照合の内訳: Record<string, number>;
  /** この県の中の政令市（記録が1件以上あるものだけ）。許可権者が違うので、県の記録とは混ぜない */
  政令市: 政令市データ[];
};

export type 許可権者の記録 = Omit<県データ, "県" | "政令市">;
export type 政令市データ = 許可権者の記録 & { 市: 政令市 };

function NFC(s: string) {
  return s.normalize("NFC");
}

function 読む<T>(file: string, schema: ZodType<T>): T {
  const text = fs.readFileSync(file, "utf8");
  const raw = parse(text);
  const r = schema.safeParse(raw);
  if (!r.success) {
    const rel = path.relative(path.join(APP, ".."), file);
    const 中身 = r.error.issues.map((i) => `  ${i.path.join(".") || "(全体)"}: ${i.message}`).join("\n");
    throw new Error(`${NFC(rel)} の書き方に誤りがあります（npm run 確認 で行番号つきで見られます）\n${中身}`);
  }
  return r.data;
}

/** コード2桁で始まるフォルダを探す（フォルダ名の日本語部分は見ない） */
function 県フォルダ(root: string, コード: string): string | null {
  if (!fs.existsSync(root)) return null;
  const hit = fs.readdirSync(root).find((n) => NFC(n).startsWith(`${コード}_`));
  return hit ? path.join(root, hit) : null;
}

function 配列に(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

/** 問いの文から作る短い印。scripts/yure/hantei.ts の「印」と同じ式（変えると判定の組が全部つながらなくなる） */
function 問いの印(s: string) {
  return crypto.createHash("sha256").update(NFC(s).replace(/\s+/g, "")).digest("hex").slice(0, 8);
}

/** 判定が付いたが、相手の記録が見つからなかった組の数（書き出しのときに知らせる） */
export const つながらない判定: { 許可権者: string; 件数: number }[] = [];

let cache: ReturnType<typeof 全部読む> | null = null;

function 全部読む() {
  const 観点一覧: 観点[] = 読む(path.join(DATA, "観点.yaml"), 観点ファイル).観点;
  const 品目 = 読む(path.join(DATA, "品目.yaml"), 品目ファイル);
  const 観点ids = new Set(観点一覧.map((k) => k.id));

  const 県ファイルの中身 = 読む(path.join(DATA, "県.yaml"), 県ファイル);
  const 政令市一覧 = 県ファイルの中身.政令市;

  /** 許可権者（県か政令市）1つ分の記録を集める。フォルダはコード（2桁か5桁）で探す */
  function 一つ読む(県: { コード: string; 名前: string; 手引きの状態: 手引きの状態 }): 許可権者の記録 {
    const カード: カード[] = [];
    const 公開側 = 県フォルダ(path.join(DATA, 許認可), 県.コード);
    let 手引きurl: string | undefined;
    let 印字から物理: Map<number, number> = new Map();
    let 状態: 手引きの状態 = 県.手引きの状態;
    let 読んだ日: string | null = null;
    let 観点候補: 県データ["観点候補"] = [];
    const 照合の内訳: Record<string, number> = {};
    /** 判定ファイルの ID（手引きの記録のID、電話は「電話の記録のID#観点#問いの印」）から、その記録のカードを引く */
    const 鍵から: Map<string, カード> = new Map();

    // 手引きの置き場の _出典.yaml（改訂の検知）
    const 手引きdir = 県フォルダ(TEBIKI_DIR, 県.コード);
    const 出典f = 手引きdir ? path.join(手引きdir, "_出典.yaml") : null;
    const 出典 = 出典f && fs.existsSync(出典f) ? (parse(fs.readFileSync(出典f, "utf8")) ?? {}) : null;
    if (出典) 状態 = "未確認";

    let 手引きあり = false;
    let 検知: { 日付: string; 文書: string[]; 内容: string[] }[] = [];
    if (公開側 && fs.existsSync(path.join(公開側, "手引き.yaml"))) {
      手引きあり = true;
      const t = 読む(path.join(公開側, "手引き.yaml"), 手引きファイル);
      読んだ日 = t.読んだ日 ?? null;
      // 読み直したときに npm run 読む が「読み直し済み」を付ける。付いていない検知だけを出す
      検知 = ((出典?.改訂の検知 ?? []) as (typeof 検知[number] & { 読み直し済み?: string })[]).filter((x) => !x.読み直し済み);
      const 改訂の文書 = new Set(検知.flatMap((x) => x.文書.map(NFC)));
      const 全部 = 改訂の文書.has("（入口ページ）");
      const url = new Map(t.手引き.map((d) => [d.文書, d.url ?? undefined]));
      const 名 = new Map(t.手引き.map((d) => [d.文書, d.名前]));
      const 主 = t.手引き.find((d) => d.役割 === "実質の手引き") ?? t.手引き[0];
      手引きurl = 主?.url ?? undefined;
      印字から物理 = new Map((主?.ページ対応 ?? []).map(([物, 印]) => [印, 物]));
      for (const r of t.記録) {
        照合の内訳[r.出典.照合] = (照合の内訳[r.出典.照合] ?? 0) + 1;
        const c: カード = {
          観点: r.観点,
          種別: "手引き",
          本文: r.主張,
          確認日: r.確認日,
          対象: r.対象,
          品目: 配列に(r.品目),
          出典: { ...r.出典, 文書名: 名.get(r.出典.文書), url: url.get(r.出典.文書) },
          改訂: 全部 || 改訂の文書.has(NFC(r.出典.文書)),
        };
        カード.push(c);
        鍵から.set(r.id, c);
      }
      観点候補 = t.観点候補.map((c) => ({
        ...c,
        url: c.文書 && url.get(c.文書) && c.物理ページ ? `${url.get(c.文書)}#page=${c.物理ページ}` : undefined,
      }));
      const 怪しい = (照合の内訳["近似（要目視）"] ?? 0) + (照合の内訳["不一致"] ?? 0);
      状態 = t.記録.length > 0 && 怪しい === 0 ? "検品済み" : "未検品";
      for (const n of t.記載なし) {
        カード.push({ 観点: n.観点, 種別: "記載なし", 本文: "手引きを読んだが見つからなかった", 確認日: null, 対象: [], 探した語: n.探した語 });
      }
    } else if (出典) {
      検知 = ((出典.改訂の検知 ?? []) as (typeof 検知[number] & { 読み直し済み?: string })[]).filter((x) => !x.読み直し済み);
    }
    if (公開側 && fs.existsSync(path.join(公開側, "受理実績.yaml"))) {
      for (const r of 読む(path.join(公開側, "受理実績.yaml"), 受理実績ファイル)) {
        カード.push({ 観点: r.観点, 種別: "受理実績", 本文: r.内容, 確認日: null, 受理年: r.受理年, 対象: r.対象, 品目: 配列に(r.品目) });
      }
    }

    {
      // 電話の記録：TECHO=1 なら手帳から、公開版（TECHO=0）なら見本/ から読む
      const 電話の置き場 = 手帳を読む ? TECHO_DIR : MIHON_DIR;
      const 電話側 = 県フォルダ(path.join(電話の置き場, 許認可), 県.コード);
      const 電話dir = 電話側 ? path.join(電話側, "電話") : null;
      if (電話dir && fs.existsSync(電話dir)) {
        for (const f of fs.readdirSync(電話dir).filter((n) => n.endsWith(".yaml")).sort()) {
          const d = 読む(path.join(電話dir, f), 電話ファイル);
          for (const a of d.回答) {
            const c: カード = {
              観点: a.観点,
              種別: d.種別,
              本文: a.答え,
              問い: a.問い,
              確認日: d.確認日,
              窓口: d.窓口,
              見本: 手帳を読む ? undefined : true, // 見本/ から読んだものには必ず「見本」の札を付ける
              対象: a.対象,
              品目: 配列に(a.品目),
              候補観点: a.候補観点,
              手引きへの参照: a.手引きへの参照
                ? (() => {
                    // 人が言う「2ページ」は印字の番号。PDF の何枚目かに直してリンクする
                    const 物理 = 印字から物理.get(a.手引きへの参照.ページ) ?? a.手引きへの参照.ページ;
                    return { ...a.手引きへの参照, 物理ページ: 物理, url: 手引きurl ? `${手引きurl}#page=${物理}` : undefined };
                  })()
                : undefined,
            };
            カード.push(c);
            // 同じ電話で同じ問いに観点を分けて答えることがあるので、観点も鍵に入れる（判定の id と同じ考え方）
            鍵から.set(`${d.id}#${a.観点}#${問いの印(a.問い)}`, c);
          }
        }
      }
      // ケンの判定：電話と同じ置き場から読む（TECHO=1 は手帳/<許認可>/_判定/、公開版は 見本/<許認可>/_判定/ だけ）
      const 判定dir = path.join(電話の置き場, 許認可, "_判定");
      const 判定f = fs.existsSync(判定dir)
        ? fs.readdirSync(判定dir).find((n) => NFC(n).startsWith(`${県.コード}_`) && n.endsWith(".yaml"))
        : undefined;
      if (判定f) {
        let 迷子 = 0;
        const 写す = (c: カード): 判定の印["相手"] => ({
          種別: c.種別,
          本文: c.本文,
          問い: c.問い,
          確認日: c.確認日,
          窓口: c.窓口,
          ページ: c.出典
            ? `${c.出典.文書名 ?? c.出典.文書}　PDF ${c.出典.物理ページ}ページ目${c.出典.印字ページ ? `（印字 p.${c.出典.印字ページ}）` : ""}`
            : undefined,
          url: c.出典?.url ? `${c.出典.url}#page=${c.出典.物理ページ}` : undefined,
        });
        for (const x of 読む(path.join(判定dir, 判定f), 判定ファイル).判定) {
          if (x.判定 === "対象が違う") continue;
          const 電話 = 鍵から.get(`${x.電話.id}#${x.観点}#${x.電話.問いの印}`);
          const 相手 = 鍵から.get("手引き" in x.相手 ? x.相手.手引き : `${x.相手.電話}#${x.観点}#${x.相手.問いの印}`);
          if (!電話 || !相手) {
            迷子++;
            continue;
          }
          const 共通 = { 判定: x.判定, 理由: x.理由, 種類: x.種類, 解消: !!x.解消, もう一度判定: !!x.もう一度判定 };
          (電話.判定 ??= []).push({ ...共通, 主: true, 相手: 写す(相手) });
          (相手.判定 ??= []).push({ ...共通, 主: false, 相手: 写す(電話) });
        }
        if (迷子) {
          つながらない判定.push({ 許可権者: 県.名前, 件数: 迷子 });
          console.warn(`${県.名前}：判定 ${迷子}件の相手の記録が見つからない（問いや手引きを直したなら npm run 判定 をやり直す）`);
        }
      }
    }
    if (手帳を読む) {
      const 手帳側 = 県フォルダ(path.join(TECHO_DIR, 許認可), 県.コード);
      const 補正dir = 手帳側 ? path.join(手帳側, "補正") : null;
      if (補正dir && fs.existsSync(補正dir)) {
        for (const f of fs.readdirSync(補正dir).filter((n) => n.endsWith(".yaml")).sort()) {
          const d = 読む(path.join(補正dir, f), 補正ファイル);
          for (const a of d.指摘) {
            カード.push({
              観点: a.観点,
              種別: "補正",
              本文: a.指摘,
              直し方: a.直し方,
              確認日: null,
              年: d.年,
              窓口: d.窓口,
              対象: a.対象,
              品目: 配列に(a.品目),
              候補観点: a.候補観点,
            });
          }
        }
      }
    }

    for (const c of カード) {
      if (c.観点 !== "未分類" && !観点ids.has(c.観点)) throw new Error(`${県.名前} の記録に、観点.yaml に無い観点「${c.観点}」があります`);
    }
    const 件数 = { 手引き: 0, 受理実績: 0, 電話: 0, 同業者: 0, 補正: 0 };
    for (const c of カード) if (c.種別 !== "記載なし") 件数[c.種別]++;
    const 最新 = 検知.length ? 検知[検知.length - 1] : null;
    void 手引きあり;
    return {
      カード,
      件数,
      手引きの状態: 状態,
      改訂: 最新 ? { 日付: String(最新.日付), 内容: 検知.flatMap((x) => x.内容) } : null,
      読んだ日,
      観点候補,
      照合の内訳,
    };
  }

  const 県一覧 = 県ファイルの中身.県;
  const 県ごと: Record<string, 県データ> = {};
  for (const 県 of 県一覧) {
    const 市たち = 政令市一覧
      .filter((s) => s.親 === 県.コード)
      .map((市) => ({ 市, ...一つ読む(市) }))
      .filter((d) => d.カード.length > 0);
    県ごと[県.コード] = { 県, ...一つ読む(県), 政令市: 市たち };
  }
  return { 観点一覧, 品目, 県一覧, 県ごと };
}

export function データ() {
  // 開発中は保存のたびに読み直す。書き出し時は1回だけ
  if (process.env.NODE_ENV !== "production" || !cache) cache = 全部読む();
  return cache;
}

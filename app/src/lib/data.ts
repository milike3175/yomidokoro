// ビルド時（と開発中の表示時）に YAML を読み、画面用の形にそろえる。サーバー側だけで使う。
import fs from "node:fs";
import path from "node:path";
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
  type 観点,
  type 県,
} from "../../schema/record.ts";

export const 許認可 = "産廃収集運搬";

const APP = process.cwd();
const DATA = path.join(APP, "data");
const TECHO_DIR = path.join(APP, "..", "手帳");

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
  出典?: { 文書: string; url?: string; 物理ページ: number; 印字ページ?: number | null; 引用: string; 照合: string };
  手引きへの参照?: { ページ: number; 内容?: string; url?: string };
  探した語?: string[];
};

export type 県データ = {
  県: 県;
  カード: カード[];
  件数: Record<件数の種別, number>;
};

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

let cache: ReturnType<typeof 全部読む> | null = null;

function 全部読む() {
  const 観点一覧: 観点[] = 読む(path.join(DATA, "観点.yaml"), 観点ファイル).観点;
  const 品目 = 読む(path.join(DATA, "品目.yaml"), 品目ファイル);
  const 県一覧 = 読む(path.join(DATA, "県.yaml"), 県ファイル).県;
  const 観点ids = new Set(観点一覧.map((k) => k.id));

  const 県ごと: Record<string, 県データ> = {};
  for (const 県 of 県一覧) {
    const カード: カード[] = [];
    const 公開側 = 県フォルダ(path.join(DATA, 許認可), 県.コード);
    let 手引きurl: string | undefined;

    if (公開側 && fs.existsSync(path.join(公開側, "手引き.yaml"))) {
      const t = 読む(path.join(公開側, "手引き.yaml"), 手引きファイル);
      const url = new Map(t.手引き.map((d) => [d.文書, d.url]));
      手引きurl = t.手引き[0]?.url;
      for (const r of t.記録) {
        カード.push({
          観点: r.観点,
          種別: "手引き",
          本文: r.主張,
          確認日: r.確認日,
          対象: r.対象,
          品目: 配列に(r.品目),
          出典: { ...r.出典, url: url.get(r.出典.文書) },
        });
      }
      for (const n of t.記載なし) {
        カード.push({ 観点: n.観点, 種別: "記載なし", 本文: "手引きを読んだが見つからなかった", 確認日: null, 対象: [], 探した語: n.探した語 });
      }
    }
    if (公開側 && fs.existsSync(path.join(公開側, "受理実績.yaml"))) {
      for (const r of 読む(path.join(公開側, "受理実績.yaml"), 受理実績ファイル)) {
        カード.push({ 観点: r.観点, 種別: "受理実績", 本文: r.内容, 確認日: null, 受理年: r.受理年, 対象: r.対象, 品目: 配列に(r.品目) });
      }
    }

    if (手帳を読む) {
      const 手帳側 = 県フォルダ(path.join(TECHO_DIR, 許認可), 県.コード);
      const 電話dir = 手帳側 ? path.join(手帳側, "電話") : null;
      if (電話dir && fs.existsSync(電話dir)) {
        for (const f of fs.readdirSync(電話dir).filter((n) => n.endsWith(".yaml")).sort()) {
          const d = 読む(path.join(電話dir, f), 電話ファイル);
          for (const a of d.回答) {
            カード.push({
              観点: a.観点,
              種別: d.種別,
              本文: a.答え,
              問い: a.問い,
              確認日: d.確認日,
              窓口: d.窓口,
              対象: a.対象,
              品目: 配列に(a.品目),
              候補観点: a.候補観点,
              手引きへの参照: a.手引きへの参照
                ? { ...a.手引きへの参照, url: 手引きurl ? `${手引きurl}#page=${a.手引きへの参照.ページ}` : undefined }
                : undefined,
            });
          }
        }
      }
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
    県ごと[県.コード] = { 県, カード, 件数 };
  }
  return { 観点一覧, 品目, 県一覧, 県ごと };
}

export function データ() {
  // 開発中は保存のたびに読み直す。書き出し時は1回だけ
  if (process.env.NODE_ENV !== "production" || !cache) cache = 全部読む();
  return cache;
}

// 「はじめての許認可」モードの YAML の決まり。産廃の決まり（record.ts）とは別にして、互いに影響しないようにする。
import { z } from "zod";

const 日付 = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "日付は「2026-11-03」の形で書いてください" }),
);

export const 共通観点ファイル = z.object({
  観点: z
    .array(
      z.object({
        id: z.string().min(1),
        表示名: z.string().min(1),
        探すもの: z.string().min(1),
      }),
    )
    .min(1),
});
export type 共通観点 = z.infer<typeof 共通観点ファイル>["観点"][number];

export const 照合 = z.enum(["一致", "一致（ページ訂正）", "近似（要目視）", "不一致"]);

const 出典 = z.object({
  文書: z.string().min(1),
  物理ページ: z.number().int().positive(),
  印字ページ: z.number().int().nullable().optional(),
  引用: z.string().min(1).max(120, { error: "引用は短く（目安20〜60字）してください" }),
  照合,
});

export const はじめてファイル = z.object({
  id: z.string().min(1),
  許認可名: z.string().min(1),
  自治体名: z.string().min(1),
  /** 探す・読むで使った自治体の公式サイトのドメイン（見つからなければ null） */
  自治体ドメイン: z.string().nullable(),
  読んだ日: 日付,
  モデル: z.string().min(1),
  資料: z.array(
    z.object({
      文書: z.string().min(1),
      名前: z.string().optional(),
      /** 手引き・案内ページ・様式・その他 */
      役割: z.string().optional(),
      形式: z.enum(["PDF", "HTML", "Word", "Excel", "その他"]),
      url: z.string().url().nullable(),
      取得日: 日付,
      sha256: z.string(),
      ページ数: z.number().int().nullable(),
      /** 読む対象にしたか（様式・文字にできないものは読まない） */
      読んだ: z.boolean(),
    }),
  ),
  記録: z
    .array(
      z.object({
        id: z.string().min(1),
        観点: z.string().min(1),
        主張: z.string().min(1),
        種別: z.literal("手引き"),
        出典,
        確認日: 日付,
      }),
    )
    .default([]),
  記載なし: z.array(z.object({ 観点: z.string().min(1), 探した語: z.array(z.string()) })).default([]),
  /** この許認可だけの観点（共通観点に無いもの）。5個まで */
  独自の観点: z
    .array(
      z.object({
        名前: z.string().min(1),
        主張: z.string().min(1),
        出典,
      }),
    )
    .default([]),
  /** 探したけれど取れなかった・見つからなかったこと（正直に残す） */
  取れなかった: z.array(z.object({ url: z.string().nullable(), 理由: z.string() })).default([]),
  見つからなかったこと: z.string().nullable().optional(),
  検索語: z.array(z.string()).default([]),
  /** 段階ごとの秒数 */
  時間: z.object({ 探す: z.number(), 取得: z.number(), 読む: z.number(), 照合: z.number() }),
  /** 段階ごとの費用（ドル、目安） */
  費用: z.object({ 探す: z.number(), 読む: z.number() }),
});
export type はじめてデータ = z.infer<typeof はじめてファイル>;

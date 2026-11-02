// YAML の書き方の決まり（唯一の正）。項目名は 構成/02_データの形.md の日本語名どおり。
import { z } from "zod";

// ---- 部品 ----

/** 確認日：「YYYY-MM」（年月まで）と「YYYY-MM-DD」の両方を許す */
export const 確認日 = z.preprocess(
  // YAML は 2026-11-03 を日付型として読むことがあるので文字に戻す
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z
    .string({ error: "確認日は「2026-07」か「2026-07-15」の形で書いてください" })
    .regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/, {
      error: "確認日は「2026-07」か「2026-07-15」の形で書いてください",
    }),
);

export const 手続き = z.enum(["新規", "更新", "変更許可", "変更届"], {
  error: "対象は 新規・更新・変更許可・変更届 のどれかです",
});
export const 対象 = z.array(手続き).min(1, { error: "対象を1つ以上書いてください" });

export const 許可権者 = z.object({
  コード: z.string().regex(/^(\d{2}|\d{5})$/, { error: "コードは2桁（県）か5桁（政令市）の文字で書いてください（例 \"27\"）" }),
  名前: z.string().min(1),
});

/** 品目：品目.yaml の id か、「建設系」「建設系以外」のような区分。1つでも複数でもよい */
export const 品目 = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const 観点id = z.string().min(1, { error: "観点の id を書いてください" });

// ---- 語彙 ----

export const 観点ファイル = z.object({
  観点: z
    .array(
      z.object({
        番号: z.string().regex(/^[A-Z]\d+$/),
        id: z.string().min(1),
        群: z.string().min(1),
        表示名: z.string().min(1),
        手引きで探すもの: z.string().min(1),
        電話で聞く文: z.string().min(1),
        品目で変わる: z.boolean(),
      }),
    )
    .min(1),
});

export const 品目ファイル = z.object({
  品目: z.array(z.object({ id: z.string().min(1), 建設系: z.boolean() })).min(1),
  付加区分: z.array(z.object({ id: z.string().min(1), 関係する観点: z.array(z.string()) })),
});

export const 県ファイル = z.object({
  出所: z.string().url(),
  県: z
    .array(
      z.object({
        コード: z.string().regex(/^\d{2}$/),
        団体コード: z.string().regex(/^\d{6}$/),
        名前: z.string().min(1),
        短い名: z.string().min(1),
        地方: z.string().min(1),
        言い回し: z.array(z.string()).optional(),
        手引きの状態: z
          .enum(["検品済み", "未検品", "未確認", "未読"], {
            error: "手引きの状態は 検品済み・未検品・未確認・未読 のどれかです",
          })
          .default("未読"),
      }),
    )
    .length(47, { error: "都道府県は47件のはずです" }),
});

// ---- 層1：手引き ----

export const 手引きファイル = z.object({
  許可権者,
  許認可: z.string().min(1),
  手引き: z.array(
    z.object({
      文書: z.string().min(1),
      url: z.string().url(),
      版: z.string().nullable().optional(),
      取得日: 確認日,
      sha256: z.string().nullable().optional(),
      ページ数: z.number().int().positive().nullable().optional(),
      利用規約: z.string().default("未確認"),
      利用規約確認日: 確認日.nullable().optional(),
    }),
  ),
  記録: z
    .array(
      z.object({
        id: z.string().min(1),
        観点: 観点id,
        主張: z.string().min(1),
        種別: z.literal("手引き"),
        出典: z.object({
          文書: z.string().min(1),
          物理ページ: z.number().int().positive(),
          印字ページ: z.number().int().nullable().optional(),
          引用: z.string().min(1).max(120, { error: "引用は短く（目安20〜60字）してください" }),
          照合: z.enum(["一致", "一致（ページ訂正）", "近似（要目視）", "不一致"]),
        }),
        確認日,
        対象,
        品目: 品目.optional(),
      }),
    )
    .default([]),
  記載なし: z
    .array(
      z.object({
        観点: 観点id,
        探した語: z.array(z.string()),
        探した文書: z.array(z.string()),
      }),
    )
    .default([]),
  観点候補: z
    .array(z.object({ 名前: z.string(), 引用: z.string(), 物理ページ: z.number().int().optional() }))
    .default([]),
});

// ---- 受理実績 ----

export const 受理実績ファイル = z.array(
  z.object({
    観点: 観点id,
    内容: z.string().min(1),
    受理年: z.number({ error: "受理年は西暦4桁の数で書いてください" }).int().min(2000, { error: "受理年は西暦4桁で書いてください（例 2026）" }).max(2100, { error: "受理年は西暦4桁で書いてください（例 2026）" }),
    対象,
    品目: 品目.optional(),
  }),
);

// ---- 層2：電話・同業者 ----

/** 取込元：議事録 / メモ / superwhisper。元の文字はリポジトリにも手帳にも残さない */
export const 取込元 = z.enum(["議事録", "メモ", "superwhisper"], {
  error: "取込元は 議事録・メモ・superwhisper のどれかです",
});

/** 観点に当てはまらない話は 観点: 未分類 にして、候補観点 を添える */
const 未分類の決まり = (v: { 観点: string; 候補観点?: string }, ctx: z.RefinementCtx) => {
  if (v.観点 === "未分類" && !v.候補観点) {
    ctx.addIssue({ code: "custom", path: ["候補観点"], message: "観点が 未分類 のときは 候補観点 を書いてください" });
  }
};

export const 電話ファイル = z.object({
  id: z.string().min(1),
  許可権者,
  許認可: z.string().min(1),
  確認日,
  窓口: z.string().min(1, { error: "窓口は課名まで書いてください（個人名は書かない）" }),
  種別: z.enum(["電話", "同業者"], { error: "種別は 電話 か 同業者 です" }),
  記録者: z.enum(["本人", "同業者"]),
  取込元: 取込元.optional(),
  回答: z
    .array(
      z
        .object({
          観点: 観点id,
          候補観点: z.string().min(1).optional(),
          問い: z.string().min(1),
          答え: z.string().min(1),
          対象,
          品目: 品目.optional(),
          手引きへの参照: z
            .object({ ページ: z.number().int().positive(), 内容: z.string().optional() })
            .optional(),
        })
        .superRefine(未分類の決まり),
    )
    .min(1, { error: "回答を1つ以上書いてください" }),
  個人名削除: z.number().int().min(0),
});

// ---- 補正：審査で直すよう言われたこと。日付は年だけ（案件を逆にたどれないように） ----

export const 補正ファイル = z.object({
  id: z.string().min(1),
  許可権者,
  許認可: z.string().min(1),
  年: z.number({ error: "年は西暦4桁の数で書いてください（例 2026）" }).int().min(2000).max(2100),
  窓口: z.string().min(1, { error: "窓口は課名まで書いてください（個人名は書かない）" }),
  種別: z.literal("補正", { error: "種別は 補正 です" }),
  記録者: z.enum(["本人", "同業者"]),
  取込元: 取込元.optional(),
  指摘: z
    .array(
      z
        .object({
          観点: 観点id,
          候補観点: z.string().min(1).optional(),
          指摘: z.string().min(1),
          直し方: z.string().min(1),
          対象,
          品目: 品目.optional(),
        })
        .superRefine(未分類の決まり),
    )
    .min(1, { error: "指摘を1つ以上書いてください" }),
  個人名削除: z.number().int().min(0),
});

export type 観点 = z.infer<typeof 観点ファイル>["観点"][number];
export type 県 = z.infer<typeof 県ファイル>["県"][number];
export type 手引きデータ = z.infer<typeof 手引きファイル>;
export type 受理実績データ = z.infer<typeof 受理実績ファイル>;
export type 電話データ = z.infer<typeof 電話ファイル>;
export type 補正データ = z.infer<typeof 補正ファイル>;

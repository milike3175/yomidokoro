// 記録が「選んだ手続き・品目」に当てはまるかの判定。県ページと府県くらべで同じものを使う（画面側でも動く）。

export const 手続き一覧 = ["新規", "更新", "変更許可"] as const;
export type 手続き = (typeof 手続き一覧)[number];
export const 既定の手続き: 手続き = "新規";

export type 品目判定 = "合う" | "合わない" | "関係なし";

type 品目の印 = { id: string; 建設系: boolean };

/**
 * 品目で答えが変わる観点だけ、選んだ品目に当てはまるかを見る。
 * 記録の品目に「建設系」「建設系以外」とあれば、品目.yaml の 建設系 の印で判定する。
 */
export function 品目で見る(
  c: { 品目?: string[] },
  k: { 品目で変わる: boolean } | undefined,
  品目: string,
  品目一覧: 品目の印[],
): 品目判定 {
  if (!品目 || !k?.品目で変わる || !c.品目 || c.品目.length === 0) return "関係なし";
  if (c.品目.includes(品目)) return "合う";
  const 選んだ品目 = 品目一覧.find((x) => x.id === 品目);
  if (選んだ品目 && c.品目.includes("建設系")) return 選んだ品目.建設系 ? "合う" : "合わない";
  if (選んだ品目 && c.品目.includes("建設系以外")) return 選んだ品目.建設系 ? "合わない" : "合う";
  return "合わない";
}

/** 対象（手続き）が書かれていない記録は、どの手続きにも当てはまるとみなす */
export function 手続きが合う(c: { 対象: string[] }, 手続き: 手続き): boolean {
  return c.対象.length === 0 || c.対象.includes(手続き);
}

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

/** 記録の品目を配列にそろえる（YAML では1つなら文字、複数なら配列で書ける） */
const 品目の配列 = (v?: string | string[]) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * 記録どうし（手引きと電話、電話と電話）の品目が重なるか。揺れの判定に回す組を選ぶときに使う。
 * 決まりは 品目で見る と同じ：品目で答えが変わらない観点か、どちらかに品目が無ければ重なるとみなす。
 * 「建設系」「建設系以外」は 品目.yaml の 建設系 の印で具体の品目に広げて比べる。
 * それ以外の呼び名（石綿含有産業廃棄物などの付加区分）は、同じ呼び名どうしだけ重なる。
 */
export function 品目が重なる(
  a: { 品目?: string | string[] },
  b: { 品目?: string | string[] },
  k: { 品目で変わる: boolean } | undefined,
  品目一覧: 品目の印[],
): boolean {
  const pa = 品目の配列(a.品目);
  const pb = 品目の配列(b.品目);
  if (!k?.品目で変わる || pa.length === 0 || pb.length === 0) return true;
  const 広げる = (ps: string[]) =>
    new Set(
      ps.flatMap((p) =>
        p === "建設系"
          ? 品目一覧.filter((x) => x.建設系).map((x) => x.id)
          : p === "建設系以外"
            ? 品目一覧.filter((x) => !x.建設系).map((x) => x.id)
            : [p],
      ),
    );
  const sb = 広げる(pb);
  return [...広げる(pa)].some((p) => sb.has(p));
}

/** 手続き（対象）が重なるか。書かれていない側は、どの手続きにも当てはまるとみなす */
export function 手続きが重なる(a: { 対象: string[] }, b: { 対象: string[] }): boolean {
  return a.対象.length === 0 || b.対象.length === 0 || a.対象.some((x) => b.対象.includes(x));
}

// 日付の計算（画面側でも使う）。「再確認」は保存せず、見た日で毎回計算する。

/** 確認日を日付にする。年月だけのときはその月の1日とみなす（古めに見積もって、再確認を早めに出す） */
export function 日付に(確認日: string): Date {
  const [y, m, d] = 確認日.split("-").map(Number);
  return new Date(y, m - 1, d ?? 1);
}

export function 経過日数(確認日: string, 今日: Date): number {
  const a = 日付に(確認日);
  const b = new Date(今日.getFullYear(), 今日.getMonth(), 今日.getDate());
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

export function 再確認か(確認日: string | null, 今日: Date): boolean {
  return 確認日 !== null && 経過日数(確認日, 今日) > 365;
}

/** 「2026-07」「2026-07-15」を「2026年7月」に */
export function 年月(確認日: string): string {
  const [y, m] = 確認日.split("-");
  return `${y}年${Number(m)}月`;
}

export function 表示日(確認日: string): string {
  const [y, m, d] = 確認日.split("-");
  return d ? `${y}年${Number(m)}月${Number(d)}日` : `${y}年${Number(m)}月`;
}

/** 文字の日付（YYYY-MM-DD）を作る。サーバーで書き出した日と、見ている日の受け渡しに使う */
export function 今日の文字(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

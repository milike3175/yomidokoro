// 様式への記入（ブラウザの中だけで動く。サーバーにも Claude にも送らない）。
//
// やり方は _申請/試し/道具/fill_test3.py と同じ（2026-11-03 みゆきが Word で合格）：
//   - docx（zip）の中の word/document.xml の、決まった w:t の文字だけを書き換える
//   - 欄の全角空白を、同じ字数の値に置き換える（短ければ全角空白で埋め、長ければ切って「要確認」）
//   - 住所が1行目の空白に収まらないときは、様式の2行目（すぐ下の空白だけの行）へ送る
//   - zip の中のほかのファイルは、圧縮されたバイトのまま使い回す（JSZip が読み込んだまま書き出す）
// docx を組み立て直すライブラリは使わない。書式・改行・枠に触らないため。
//
// このファイルは node: の機能を使わない（ブラウザと、試しの Node の両方から読むため）。

export const SP = "　"; // 全角スペース

// ---------------- 欄の対応表（app/data/様式/*.yaml の形） ----------------

/** 欄の全角空白を値に置き換える */
export type 空白の欄 = {
  id: string;
  見出し: string;
  種類: "空白";
  /** 文書の中で何番目の w:t か（0 から） */
  箱: number;
  /** w:t の元の文字 = 見出しの字 + 全角空白 × 空白 */
  見出しの字: string;
  空白: number;
  /** 書き出す幅（見出しの字の後ろの字数）。省略すると 空白 と同じ */
  幅?: number;
  /** 値の前に置く全角空白の数（幅に含む） */
  頭?: number;
  例?: string;
  注?: string;
};

/** 住所：1行目に入らない分を、すぐ下の空白だけの行へ送る */
export type 住所の欄 = {
  id: string;
  見出し: string;
  種類: "住所2行";
  箱: number;
  見出しの字: string;
  空白: number;
  次の箱: number;
  次の空白: number;
  /** 2行目の値の前に置く全角空白の数（〒の後ろの列にそろえるため） */
  次の頭: number;
  例?: string;
  注?: string;
};

/** 「　　年　　月　　日　」の形の日付 */
export type 日付の欄 = {
  id: string;
  見出し: string;
  種類: "日付";
  箱: number;
  /** 元の文字。年・月・日の前の空白の数 */
  年の空白: number;
  月の空白: number;
  日の空白: number;
  後ろの空白: number;
  注?: string;
};

export type 欄 = 空白の欄 | 住所の欄 | 日付の欄;

/** 今は書かない欄（あとで書き方の型を差し込む口、または行政書士が選ぶ欄） */
export type 書かない欄 = {
  見出し: string;
  印: "型が入る予定" | "要確認";
  理由: string;
};

export type 様式 = {
  sha256: string;
  名前: string;
  県コード: string;
  県名: string;
  ファイル名: string;
  入口: string;
  /** 書き換える本文のファイル（zip の中のパス） */
  本文: string;
  /** 本文の中の w:t の総数（違えば別の様式。書かずに止める） */
  箱の数: number;
  欄: 欄[];
  書かない: 書かない欄[];
};

// ---------------- 値の整え方 ----------------

/** 半角の英数字・記号・空白を全角にする（半角が混ざると列がずれるため） */
export function 全角に(s: string): string {
  return Array.from(s)
    .map((c) => {
      const n = c.codePointAt(0)!;
      if (n === 0x20) return SP;
      if (n >= 0x21 && n <= 0x7e) return String.fromCodePoint(n + 0xfee0);
      return c;
    })
    .join("");
}

export function 字数(s: string): number {
  return Array.from(s).length;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** width 字にそろえる。短ければ全角空白で埋め、長ければ切る */
function そろえる(value: string, width: number): { 文字: string; 切った: boolean } {
  const cs = Array.from(value);
  if (cs.length > width) return { 文字: cs.slice(0, width).join(""), 切った: true };
  return { 文字: value + SP.repeat(width - cs.length), 切った: false };
}

// ---------------- 住所の切り方 ----------------

export type 住所の切り方 = {
  一行目: string;
  二行目: string;
  /** どこで切ったか（画面に出す） */
  区切り: string;
  /** 2行目にも入らず、切り捨てた字 */
  切り捨て: string;
};

const 県の形 = /^(?:[０-９]{3}－[０-９]{4}　?)?(東京都|北海道|京都府|大阪府|[^　]{2,3}?県)/;

/**
 * 1行目に入るぶんと、2行目へ送るぶんに分ける。
 * 区切りの候補（強い順）：全角空白、都道府県・市・区・郡の後ろ、町・村の後ろ、丁目・番地・番・号の後ろや番地の数字の前。
 * 1行目に w1 字以内、2行目に w2 字以内で収まる候補のうち、いちばん強い区切りの、いちばん後ろで切る。
 * 収まる候補が無ければ w1 字で切り、2行目からあふれる字は切り捨てる（どちらも要確認）。
 */
export function 住所を分ける(addr: string, w1: number, w2: number): 住所の切り方 {
  const cs = Array.from(addr);
  if (cs.length <= w1) return { 一行目: addr, 二行目: "", 区切り: "", 切り捨て: "" };

  type 候補 = { k: number; 次: number; 強さ: number; 名: string };
  const 候補たち: 候補[] = [];
  const 数字 = /[０-９〇一二三四五六七八九十百千]/;
  for (let k = 1; k < cs.length; k++) {
    const 前 = cs[k - 1];
    const 今 = cs[k];
    if (今 === SP) 候補たち.push({ k, 次: k + 1, 強さ: 4, 名: "空白" });
    if (/[市区郡]/.test(前)) 候補たち.push({ k, 次: k, 強さ: 3, 名: `「${前}」の後ろ` });
    if (/[町村]/.test(前)) 候補たち.push({ k, 次: k, 強さ: 2, 名: `「${前}」の後ろ` });
    if (/[目番号地]/.test(前) || (!数字.test(前) && 前 !== SP && 数字.test(今)))
      候補たち.push({ k, 次: k, 強さ: 1, 名: "番地のあたり" });
  }
  const m = 県の形.exec(addr);
  if (m) {
    const k = Array.from(m[0]).length;
    候補たち.push({ k, 次: k, 強さ: 3, 名: `「${m[1]}」の後ろ` });
  }

  const 収まる = 候補たち.filter((c) => c.k <= w1 && cs.length - c.次 <= w2 && c.k > 0);
  if (収まる.length > 0) {
    収まる.sort((a, b) => b.強さ - a.強さ || b.k - a.k);
    const c = 収まる[0];
    return { 一行目: cs.slice(0, c.k).join(""), 二行目: cs.slice(c.次).join(""), 区切り: c.名, 切り捨て: "" };
  }
  const rest = cs.slice(w1);
  return {
    一行目: cs.slice(0, w1).join(""),
    二行目: rest.slice(0, w2).join(""),
    区切り: `${w1}字目（区切りが見つからない）`,
    切り捨て: rest.slice(w2).join(""),
  };
}

// ---------------- 記入 ----------------

export type 値 = Record<string, string>;

export type 欄の結果 = {
  id: string;
  見出し: string;
  状態: "空" | "書いた" | "要確認";
  /** 画面に出す説明（要確認の理由など） */
  説明: string[];
};

export type 記入の結果 =
  | { ok: true; 本文: string; 結果: 欄の結果[] }
  | { ok: false; 理由: string };

const 箱の形 = /<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g;

type 差し替え = { 箱: number; 文字: string };

/** 値の入っていない欄は触らない。入っている欄だけ、w:t の文字を差し替える */
export function 記入する(本文: string, 様: 様式, 値たち: 値): 記入の結果 {
  const 箱たち = [...本文.matchAll(箱の形)];
  if (箱たち.length !== 様.箱の数) {
    return { ok: false, 理由: `本文の文字の箱の数が ${箱たち.length}（この様式なら ${様.箱の数}）。別の版の様式かもしれないので書かない` };
  }
  const 中身 = (i: number) => 箱たち[i][1];
  const 守る = (i: number) => /xml:space="preserve"/.test(箱たち[i][0].slice(0, 箱たち[i][0].indexOf(">")));
  const 元と同じか = (i: number, want: string, label: string): string | null => {
    if (中身(i) !== want) return `${label}：元の字が様式と違う（${i}番目の箱）。書かない`;
    if (!守る(i)) return `${label}：空白を守る印が無い箱（${i}番目）。書かない`;
    return null;
  };

  const 差したち: 差し替え[] = [];
  const 結果: 欄の結果[] = [];

  for (const f of 様.欄) {
    if (f.種類 === "日付") {
      const 年 = (値たち[`${f.id}.年`] ?? "").trim();
      const 月 = (値たち[`${f.id}.月`] ?? "").trim();
      const 日 = (値たち[`${f.id}.日`] ?? "").trim();
      const 元 = SP.repeat(f.年の空白) + "年" + SP.repeat(f.月の空白) + "月" + SP.repeat(f.日の空白) + "日" + SP.repeat(f.後ろの空白);
      const err = 元と同じか(f.箱, 元, f.見出し);
      if (err) return { ok: false, 理由: err };
      if (!年 && !月 && !日) {
        結果.push({ id: f.id, 見出し: f.見出し, 状態: "空", 説明: [] });
        continue;
      }
      const 説明: string[] = [];
      const 右寄せ = (v: string, w: number, 名: string) => {
        const z = Array.from(全角に(v));
        if (z.length > w) {
          説明.push(`${名}が${w}字を超えたので切った`);
          return z.slice(z.length - w).join("");
        }
        return SP.repeat(w - z.length) + z.join("");
      };
      const 文字 =
        右寄せ(年, f.年の空白, "年") + "年" + 右寄せ(月, f.月の空白, "月") + "月" + 右寄せ(日, f.日の空白, "日") + "日" + SP.repeat(f.後ろの空白);
      差したち.push({ 箱: f.箱, 文字 });
      結果.push({ id: f.id, 見出し: f.見出し, 状態: 説明.length ? "要確認" : "書いた", 説明 });
      continue;
    }

    const err = 元と同じか(f.箱, f.見出しの字 + SP.repeat(f.空白), f.見出し);
    if (err) return { ok: false, 理由: err };

    if (f.種類 === "住所2行") {
      const err2 = 元と同じか(f.次の箱, SP.repeat(f.次の空白), `${f.見出し}の2行目`);
      if (err2) return { ok: false, 理由: err2 };
    }

    const v = 全角に((値たち[f.id] ?? "").trim());
    if (!v) {
      結果.push({ id: f.id, 見出し: f.見出し, 状態: "空", 説明: [] });
      continue;
    }

    if (f.種類 === "空白") {
      const 幅 = f.幅 ?? f.空白;
      const 頭 = SP.repeat(f.頭 ?? 0);
      const r = そろえる(頭 + v, 幅);
      差したち.push({ 箱: f.箱, 文字: f.見出しの字 + r.文字 });
      結果.push({
        id: f.id,
        見出し: f.見出し,
        状態: r.切った ? "要確認" : "書いた",
        説明: r.切った ? [`${幅 - (f.頭 ?? 0)}字を超えたので「${r.文字.slice((f.頭 ?? 0))}」で切った。様式の欄に収まる書き方を確かめる`] : [],
      });
      continue;
    }

    // 住所2行
    const w2 = f.次の空白 - f.次の頭;
    const s = 住所を分ける(v, f.空白, w2);
    const r1 = そろえる(s.一行目, f.空白);
    差したち.push({ 箱: f.箱, 文字: f.見出しの字 + r1.文字 });
    const 説明: string[] = [];
    if (s.二行目) {
      const r2 = そろえる(s.二行目, w2);
      差したち.push({ 箱: f.次の箱, 文字: SP.repeat(f.次の頭) + r2.文字 });
      説明.push(`1行目（${f.空白}字）に入らないので、${s.区切り}で切って2行目へ送った。切る位置を確かめる`);
    }
    if (s.切り捨て) 説明.push(`2行目（${w2}字）にも入らず「${s.切り捨て}」を切り捨てた。書き方を考え直す`);
    結果.push({ id: f.id, 見出し: f.見出し, 状態: 説明.length ? "要確認" : "書いた", 説明 });
  }

  // 後ろから差し替える（前の位置がずれないように）
  const 箱ごと = new Map<number, string>();
  for (const d of 差したち) {
    if (箱ごと.has(d.箱)) return { ok: false, 理由: `${d.箱}番目の箱に二つの欄が書こうとしている。対応表を直す` };
    箱ごと.set(d.箱, d.文字);
  }
  let out = 本文;
  for (const i of [...箱ごと.keys()].sort((a, b) => b - a)) {
    const m = 箱たち[i];
    const start = m.index! + m[0].indexOf(">") + 1;
    const end = start + m[1].length;
    out = out.slice(0, start) + esc(箱ごと.get(i)!) + out.slice(end);
  }
  return { ok: true, 本文: out, 結果 };
}

// ---------------- 事業者の控え ----------------

export type 控え = {
  種類: "よみどころ 事業者の控え";
  版: 1;
  保存日: string;
  様式: { sha256: string; 名前: string };
  値: 値;
};

export function 控えを作る(様: 様式, 値たち: 値, 保存日: string): 控え {
  const 値: 値 = {};
  for (const k of Object.keys(値たち).sort()) if (値たち[k] !== "") 値[k] = 値たち[k];
  return { 種類: "よみどころ 事業者の控え", 版: 1, 保存日, 様式: { sha256: 様.sha256, 名前: 様.名前 }, 値 };
}

export function 控えを読む(text: string): { ok: true; 控え: 控え } | { ok: false; 理由: string } {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return { ok: false, 理由: "JSON として読めない" };
  }
  const o = d as Partial<控え>;
  if (!o || o.種類 !== "よみどころ 事業者の控え" || o.版 !== 1 || typeof o.値 !== "object" || !o.様式?.sha256) {
    return { ok: false, 理由: "よみどころの事業者の控えの形ではない" };
  }
  const 値: 値 = {};
  for (const [k, v] of Object.entries(o.値 ?? {})) if (typeof v === "string") 値[k] = v;
  return { ok: true, 控え: { ...(o as 控え), 値 } };
}

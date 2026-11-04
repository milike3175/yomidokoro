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

import type JSZipの型 from "jszip";

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

/**
 * 「事業の範囲」の品目を書く欄（和歌山の様式第六号 第1面）。
 * 見出しの段落のすぐ後ろに、run の無い空の段落が並ぶ。そこに1行ずつ run を足して品目を書く。
 * その下の石綿・水銀含有ばいじん等の行の（　）には、該当する品目の番号を書く。
 */
export type 品目の欄 = {
  見出し: string;
  /** 見出しの段落の最後の箱。この段落のすぐ後ろから空の段落が並ぶ。字の書式はこの箱の run から写す */
  見出しの箱: number;
  見出しの字: string;
  /** 続く空の段落の数（ここまでしか書かない） */
  空の段落: number;
  /** 1行（1段落）に書く字数の上限。品目の切れ目でしか改行しない */
  一行の字数: number;
  /** 空の段落のすぐ後ろの段落にある箱（並びを確かめるため） */
  次の箱: number;
  次の字: string;
  石綿の番号: 括弧の欄;
  水銀含有ばいじん等の番号: 括弧の欄;
  /** 【有・無】の行。今は○を付けない（要確認として画面に出す） */
  有無: { 見出し: string; 箱: number; 字: string; 何の: "石綿" | "水銀使用製品" | "水銀含有ばいじん等" | "積替保管" }[];
};

/** 「…【有・無】（　…　）」の（　）の中の全角空白に番号を書く */
export type 括弧の欄 = { 箱: number; 前の字: string; 空白: number; 後ろの字: string };

/** 事業計画の概要「２．取り扱う産業廃棄物の種類及び運搬量等」の表の、品目の名前の列 */
export type 品目表の欄 = {
  見出し: string;
  /** 各行の番号の箱（左端の列）。名前の欄は、番号の段落のすぐ後ろの空の段落。字の書式は番号の run から写す */
  行: { 箱: number; 字: string }[];
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
  品目?: 品目の欄;
  品目表?: 品目表の欄;
  書かない: 書かない欄[];
};

// ---------------- 品目（産業廃棄物の種類） ----------------

/**
 * 産業廃棄物の20種類。並びは廃棄物処理法施行令第2条の順（燃え殻・汚泥・廃油…は法第2条第4項第1号）。
 * 名前：申請書第1面「事業の範囲」に書く名前。和歌山の申請書記載例 p1 は「ガラスくず、コンクリートくず及び陶磁器くず」と書く。
 * 表の名前：事業計画の概要の品目表に書く名前。和歌山の様式記載例 p2 は「ガラスくず・コンクリートくず・陶磁器くず」と書く。
 * 石綿：石綿含有産業廃棄物になりうる品目。和歌山の手引き p4「汚泥、廃プラスチック類、ガラスくず及びがれき類の4種類が対象」（令和5年2月1日以降）。
 * 水銀含有ばいじん等：施行規則で定める「水銀含有ばいじん等」になりうる品目（燃え殻・汚泥・廃酸・廃アルカリ・鉱さい・ばいじん）。
 *   和歌山の記載例に出てくるのは汚泥だけ。ほかの品目と規則の条番号は要確認。
 * 水銀使用製品：水銀使用製品産業廃棄物を含みうる品目（廃プラスチック類・金属くず・ガラスくず等）。記載例に品目との対応は無く、要確認。
 */
export type 品目 = {
  id: string;
  名前: string;
  表の名前?: string;
  石綿?: true;
  水銀使用製品?: true;
  水銀含有ばいじん等?: true;
};

export const 品目たち: 品目[] = [
  { id: "燃え殻", 名前: "燃え殻", 水銀含有ばいじん等: true },
  { id: "汚泥", 名前: "汚泥", 石綿: true, 水銀含有ばいじん等: true },
  { id: "廃油", 名前: "廃油" },
  { id: "廃酸", 名前: "廃酸", 水銀含有ばいじん等: true },
  { id: "廃アルカリ", 名前: "廃アルカリ", 水銀含有ばいじん等: true },
  { id: "廃プラスチック類", 名前: "廃プラスチック類", 石綿: true, 水銀使用製品: true },
  { id: "紙くず", 名前: "紙くず" },
  { id: "木くず", 名前: "木くず" },
  { id: "繊維くず", 名前: "繊維くず" },
  { id: "動植物性残さ", 名前: "動植物性残さ" },
  { id: "動物系固形不要物", 名前: "動物系固形不要物" },
  { id: "ゴムくず", 名前: "ゴムくず" },
  { id: "金属くず", 名前: "金属くず", 水銀使用製品: true },
  {
    id: "ガラスくず等",
    名前: "ガラスくず、コンクリートくず及び陶磁器くず",
    表の名前: "ガラスくず・コンクリートくず・陶磁器くず",
    石綿: true,
    水銀使用製品: true,
  },
  { id: "鉱さい", 名前: "鉱さい", 水銀含有ばいじん等: true },
  { id: "がれき類", 名前: "がれき類", 石綿: true },
  { id: "動物のふん尿", 名前: "動物のふん尿" },
  { id: "動物の死体", 名前: "動物の死体" },
  { id: "ばいじん", 名前: "ばいじん", 水銀含有ばいじん等: true },
  // 和歌山の記載例に書き方が無い。「政令第13号廃棄物」「第13号廃棄物」と書く県もある（要確認）
  { id: "13号廃棄物", 名前: "１３号廃棄物" },
];

export type 品目の選び = { id: string; 石綿?: boolean; 水銀使用製品?: boolean; 水銀含有ばいじん等?: boolean };

/** 控えに残す申請の中身（品目と積替保管）。依頼者の情報と同じく、このパソコンの中だけで扱う */
export type 申請の中身 = {
  品目: 品目の選び[];
  /** "" は未選択 */
  積替保管: "" | "無" | "有";
};

export const 空の中身: 申請の中身 = { 品目: [], 積替保管: "" };

/** 選んだ品目を施行令の順に並べ、該当しない添え書きを落とす */
export function 中身を整える(中身: 申請の中身 | undefined): 申請の中身 {
  if (!中身) return { ...空の中身, 品目: [] };
  const 選 = new Map(中身.品目.map((x) => [x.id, x]));
  const 品目: 品目の選び[] = [];
  for (const h of 品目たち) {
    const x = 選.get(h.id);
    if (!x) continue;
    const y: 品目の選び = { id: h.id };
    if (h.石綿 && x.石綿) y.石綿 = true;
    if (h.水銀使用製品 && x.水銀使用製品) y.水銀使用製品 = true;
    if (h.水銀含有ばいじん等 && x.水銀含有ばいじん等) y.水銀含有ばいじん等 = true;
    品目.push(y);
  }
  const 積替保管 = 中身.積替保管 === "有" || 中身.積替保管 === "無" ? 中身.積替保管 : "";
  return { 品目, 積替保管 };
}

export type 品目の書き方 = {
  /** 第1面「事業の範囲」の行（1行＝1段落） */
  行たち: string[];
  /** 書ける行数を超えて、書かない行 */
  あふれ: string[];
  石綿の番号: string;
  水銀含有ばいじん等の番号: string;
  /** 【有・無】のどちらに○を付けるか（"" は決まらない） */
  丸: { 何の: string; 見出し: string; 付ける: "有" | "無" | "" }[];
  /** 品目表の名前の列（上から） */
  表の行: string[];
  表のあふれ: string[];
  要確認: string[];
};

/** 【有・無】の○は道具では付けない。どちらを囲むかを画面に出す */
export function 丸の説明(b: 品目の書き方): string[] {
  return b.丸.map((u) =>
    u.付ける
      ? `${u.見出し}【有・無】：「${u.付ける}」を○で囲んでください（道具では囲んでいません）`
      : `${u.見出し}【有・無】：道具では決めていません。行政書士が選んで○で囲んでください`,
  );
}

function 番号(n: number): string {
  return 全角に(String(n));
}

/** 品目の選びから、様式に書く字を作る（記入と画面の見込みの両方で使う） */
export function 品目を書き出す(様: 様式, 中身0: 申請の中身 | undefined): 品目の書き方 | null {
  const 欄 = 様.品目;
  if (!欄) return null;
  const 中身 = 中身を整える(中身0);
  const 表 = new Map(品目たち.map((h) => [h.id, h]));
  const 要確認: string[] = [];
  const 選 = 中身.品目;

  // 第1面：「１．汚泥　２．廃プラスチック類」の形（和歌山の申請書記載例 p1）。品目の切れ目でだけ改行する
  const 札 = 選.map((x, i) => `${番号(i + 1)}．${表.get(x.id)!.名前}`);
  const 行: string[] = [];
  for (const t of 札) {
    const 今 = 行.length ? 行[行.length - 1] : null;
    if (今 !== null && 字数(今) + 1 + 字数(t) <= 欄.一行の字数) 行[行.length - 1] = 今 + SP + t;
    else 行.push(t);
    if (字数(t) > 欄.一行の字数) 要確認.push(`「${t}」が1行（${欄.一行の字数}字）より長いので、Word で折り返しを確かめてください`);
  }
  const 行たち = 行.slice(0, 欄.空の段落);
  const あふれ = 行.slice(欄.空の段落);
  if (あふれ.length) 要確認.push(`品目が「事業の範囲」の欄（${欄.空の段落}行）に収まりません。収まらない ${あふれ.length}行は書いていません。2枚目や別紙にするかを確かめてください`);

  const 番号の並び = (k: "石綿" | "水銀含有ばいじん等") =>
    選.map((x, i) => (x[k] ? 番号(i + 1) : "")).filter(Boolean).join("、");
  const 石綿の番号 = 番号の並び("石綿");
  const 水銀含有ばいじん等の番号 = 番号の並び("水銀含有ばいじん等");

  const 有無 = (b: boolean): "有" | "無" | "" => (選.length === 0 ? "" : b ? "有" : "無");
  const 丸 = 欄.有無.map((u) => {
    let 付ける: "有" | "無" | "" = "";
    if (u.何の === "石綿") 付ける = 有無(選.some((x) => x.石綿));
    else if (u.何の === "水銀使用製品") 付ける = 有無(選.some((x) => x.水銀使用製品));
    else if (u.何の === "水銀含有ばいじん等") 付ける = 有無(選.some((x) => x.水銀含有ばいじん等));
    else 付ける = 中身.積替保管 === "無" ? "無" : "";
    return { 何の: u.何の, 見出し: u.見出し, 付ける };
  });
  if (中身.積替保管 === "有") 要確認.push("積替保管「有」：この道具は今、積替保管を含む申請の下書きに対応していません。積替え又は保管の【有・無】と、積替保管の欄は行政書士が書いてください");

  // 品目表：石綿・水銀含有ばいじん等を含む品目は「を除く」「を含む」の行に分ける（和歌山の様式記載例 p1〜p2 の 1〜10）。
  // 水銀使用製品産業廃棄物は品目に付けず、1行に分けて最後に置く（同 p2 の 11）
  const 表の全部: string[] = [];
  for (const x of 選) {
    const h = 表.get(x.id)!;
    const 名 = h.表の名前 ?? h.名前;
    const 除く = [x.石綿 ? "石綿含有産業廃棄物" : "", x.水銀含有ばいじん等 ? "水銀含有ばいじん等" : ""].filter(Boolean);
    if (除く.length === 0) {
      表の全部.push(名);
      continue;
    }
    表の全部.push(`${名}（${除く.join("、")}を除く）`);
    if (x.石綿) 表の全部.push(`${名}（石綿含有産業廃棄物を含む）`);
    if (x.水銀含有ばいじん等) 表の全部.push(`${名}（水銀含有ばいじん等を含む）`);
  }
  if (選.some((x) => x.水銀使用製品)) {
    表の全部.push("水銀使用製品産業廃棄物");
    要確認.push("水銀使用製品産業廃棄物：和歌山の記載例は品目に付けず、品目表に1行で書き、第1面は【有・無】だけ（品目の番号は書かない）としています。それに合わせました。品目ごとの書き方が要るかを確かめてください");
  }
  const n表 = 様.品目表?.行.length ?? 0;
  if (n表 && 表の全部.length) 要確認.push("品目表：品目の名前の列だけを書きました。運搬量・性状・予定排出事業場・予定運搬先は事業者から聞き取って書いてください");
  const 表の行 = 表の全部.slice(0, n表);
  const 表のあふれ = 表の全部.slice(n表);
  if (表のあふれ.length) 要確認.push(`品目表（${n表}行）に収まりません。収まらない ${表のあふれ.length}行（${表のあふれ.join("、")}）は書いていません。2枚目を作るかを確かめてください`);

  return { 行たち, あふれ, 石綿の番号, 水銀含有ばいじん等の番号, 丸, 表の行, 表のあふれ, 要確認 };
}

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
export function 記入する(本文: string, 様: 様式, 値たち: 値, 中身0?: 申請の中身): 記入の結果 {
  const 箱たち = [...本文.matchAll(箱の形)];
  if (箱たち.length !== 様.箱の数) {
    return { ok: false, 理由: `本文の文字の箱の数が ${箱たち.length}（この様式なら ${様.箱の数}）です。別の版の様式かもしれないので書きません` };
  }
  const 中身 = (i: number) => 箱たち[i][1];
  const 守る = (i: number) => /xml:space="preserve"/.test(箱たち[i][0].slice(0, 箱たち[i][0].indexOf(">")));
  const 元と同じか = (i: number, want: string, label: string): string | null => {
    if (中身(i) !== want) return `${label}：元の字が様式と違います（${i}番目の箱）。書きません`;
    if (!守る(i)) return `${label}：空白を守る印が無い箱です（${i}番目）。書きません`;
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
          説明.push(`${名}が${w}字を超えたので切りました`);
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
        説明: r.切った ? [`${幅 - (f.頭 ?? 0)}字を超えたので「${r.文字.slice((f.頭 ?? 0))}」で切りました。様式の欄に収まる書き方を確かめてください`] : [],
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
      説明.push(`1行目（${f.空白}字）に入らないので、${s.区切り}で切って2行目へ送りました。切る位置を確かめてください`);
    }
    if (s.切り捨て) 説明.push(`2行目（${w2}字）にも入らず「${s.切り捨て}」を切り捨てました。書き方を考え直してください`);
    結果.push({ id: f.id, 見出し: f.見出し, 状態: 説明.length ? "要確認" : "書いた", 説明 });
  }

  // ---- 品目（空の段落に run を足す。書式は直前の run から写す） ----
  const 足したち: { 位置: number; xml: string }[] = [];
  const 段落たち = 段落を数える(本文);
  if (!段落たち) return { ok: false, 理由: "本文の段落の組み立てが読めません。書きません" };
  const 箱の段落 = (i: number) => 段落の中(段落たち, 箱たち[i].index!);
  const 足す = (段: 段落, rPr: string, 字: string) => 足したち.push({ 位置: 段.閉じ, xml: `<w:r>${rPr}<w:t>${esc(字)}</w:t></w:r>` });

  const 書き方 = 品目を書き出す(様, 中身0);
  if (様.品目 && 書き方) {
    const q = 様.品目;
    const err = 元と同じか一字(q.見出しの箱, q.見出しの字, q.見出し) ?? 元と同じか一字(q.次の箱, q.次の字, q.見出し);
    if (err) return { ok: false, 理由: err };
    const 頭 = 箱の段落(q.見出しの箱);
    const 尻 = 箱の段落(q.次の箱);
    if (!頭 || !尻) return { ok: false, 理由: `${q.見出し}：見出しの段落が見つかりません。書きません` };
    const 間 = 段落たち.filter((p) => p.始め >= 頭.終わり && p.終わり <= 尻.始め);
    if (間.length !== q.空の段落 || 間.some((p) => !p.空)) {
      return { ok: false, 理由: `${q.見出し}：品目を書く空の段落が${q.空の段落}つ並んでいません（${間.length}つ）。別の版の様式かもしれないので書きません` };
    }
    const rPr = runの書式(本文, 箱たち[q.見出しの箱].index!);
    if (rPr === null) return { ok: false, 理由: `${q.見出し}：写す書式が見つかりません。書きません` };
    書き方.行たち.forEach((t, k) => 足す(間[k], rPr, t));

    const 括弧 = (c: 括弧の欄, 番号: string, 名: string): string | null => {
      const 元 = c.前の字 + SP.repeat(c.空白) + c.後ろの字;
      if (中身(c.箱) !== 元) return `${名}：元の字が様式と違います（${c.箱}番目の箱）。書きません`;
      if (!番号) return null;
      if (字数(番号) > c.空白) {
        書き方.要確認.push(`${名}の（　）に番号「${番号}」が入りません（${c.空白}字）。書いていません`);
        return null;
      }
      差したち.push({ 箱: c.箱, 文字: c.前の字 + 番号 + SP.repeat(c.空白 - 字数(番号)) + c.後ろの字 });
      return null;
    };
    const e1 = 括弧(q.石綿の番号, 書き方.石綿の番号, "石綿含有産業廃棄物");
    const e2 = 括弧(q.水銀含有ばいじん等の番号, 書き方.水銀含有ばいじん等の番号, "水銀含有ばいじん等");
    if (e1 || e2) return { ok: false, 理由: (e1 ?? e2)! };
    for (const u of q.有無) {
      const e = 元と同じか一字(u.箱, u.字, u.見出し);
      if (e) return { ok: false, 理由: e };
    }

    if (様.品目表) {
      for (let k = 0; k < 様.品目表.行.length; k++) {
        const r = 様.品目表.行[k];
        const e = 元と同じか一字(r.箱, r.字, `${様.品目表.見出し}の${k + 1}行目`);
        if (e) return { ok: false, 理由: e };
        const t = 書き方.表の行[k];
        if (!t) continue;
        const 番 = 箱の段落(r.箱);
        const 次 = 番 && 段落たち.find((p) => p.始め >= 番.終わり);
        if (!次 || !次.空) return { ok: false, 理由: `${様.品目表.見出し}の${k + 1}行目：名前の欄が空の段落ではありません。書きません` };
        const rPr2 = runの書式(本文, 箱たち[r.箱].index!);
        if (rPr2 === null) return { ok: false, 理由: `${様.品目表.見出し}：写す書式が見つかりません。書きません` };
        足す(次, rPr2, t);
      }
    }

    const 選んだ = 書き方.行たち.length > 0;
    結果.push({
      id: "品目",
      見出し: q.見出し,
      状態: 書き方.要確認.length ? "要確認" : 選んだ ? "書いた" : "空",
      説明: 書き方.要確認,
    });
    if (選んだ || 書き方.丸.some((u) => u.付ける)) {
      結果.push({ id: "有無", 見出し: "【有・無】の○", 状態: "要確認", 説明: 丸の説明(書き方) });
    }
  }

  // 後ろから差し替える（前の位置がずれないように）
  const 箱ごと = new Map<number, string>();
  for (const d of 差したち) {
    if (箱ごと.has(d.箱)) return { ok: false, 理由: `${d.箱}番目の箱に二つの欄が書こうとしています。対応表を直してください` };
    箱ごと.set(d.箱, d.文字);
  }
  const 変え: { 始め: number; 終わり: number; 字: string }[] = [];
  for (const [i, 字] of 箱ごと) {
    const m = 箱たち[i];
    const start = m.index! + m[0].indexOf(">") + 1;
    変え.push({ 始め: start, 終わり: start + m[1].length, 字: esc(字) });
  }
  for (const a of 足したち) 変え.push({ 始め: a.位置, 終わり: a.位置, 字: a.xml });
  変え.sort((a, b) => b.始め - a.始め);
  let out = 本文;
  for (const c of 変え) out = out.slice(0, c.始め) + c.字 + out.slice(c.終わり);

  // 門：書き換えた段落のほかは、段落も段落の間も元のまま
  const 狙い = new Set<number>();
  for (const c of 変え) {
    // いちばん内側の段落（始まりの順に並んでいるので、含むもののうち最後）
    let k = -1;
    段落たち.forEach((p, j) => {
      if (p.始め <= c.始め && c.終わり <= p.終わり) k = j;
    });
    if (k < 0) return { ok: false, 理由: "段落の外を書き換えようとしました。書きません" };
    狙い.add(k);
  }
  const 後の段落 = 段落を数える(out);
  if (!後の段落 || 後の段落.length !== 段落たち.length) return { ok: false, 理由: "書いたあと段落の数が変わりました。書きません" };
  const 伏せる = (s: string, ps: 段落[]) => {
    let r = s;
    for (const k of [...狙い].sort((a, b) => b - a)) r = r.slice(0, ps[k].始め) + `\u0000${k}\u0000` + r.slice(ps[k].終わり);
    return r;
  };
  if (伏せる(本文, 段落たち) !== 伏せる(out, 後の段落)) return { ok: false, 理由: "狙った段落のほかが変わりました。書きません" };

  return { ok: true, 本文: out, 結果 };

  function 元と同じか一字(i: number, want: string, label: string): string | null {
    if (i < 0 || i >= 箱たち.length || 中身(i) !== want) return `${label}：元の字が様式と違います（${i}番目の箱）。書きません`;
    return null;
  }
}

// ---------------- 段落 ----------------

type 段落 = {
  始め: number;
  /** 閉じタグ（</w:p>）の始まり。run を足す位置 */
  閉じ: number;
  終わり: number;
  /** run も文字も無い段落 */
  空: boolean;
};

const 段落の印 = /<w:p(?=[\s>/])[^>]*?(\/?)>|<\/w:p>/g;

/** 本文の w:p を、始まりの順に数える（入れ子の段落も1つと数える）。組み立てが崩れていれば null */
function 段落を数える(本文: string): 段落[] | null {
  const 並び: 段落[] = [];
  const 積み: { k: number; 中の始め: number }[] = [];
  for (const m of 本文.matchAll(段落の印)) {
    if (m[0] === "</w:p>") {
      const t = 積み.pop();
      if (!t) return null;
      const 中 = 本文.slice(t.中の始め, m.index!);
      並び[t.k] = { ...並び[t.k], 閉じ: m.index!, 終わり: m.index! + 6, 空: !/<w:r[\s>]/.test(中) && !/<w:t[\s>]/.test(中) };
    } else if (m[1] === "/") {
      並び.push({ 始め: m.index!, 閉じ: -1, 終わり: m.index! + m[0].length, 空: false });
    } else {
      並び.push({ 始め: m.index!, 閉じ: -1, 終わり: -1, 空: false });
      積み.push({ k: 並び.length - 1, 中の始め: m.index! + m[0].length });
    }
  }
  if (積み.length) return null;
  return 並び;
}

/** pos を含む、いちばん内側の段落 */
function 段落の中(並び: 段落[], pos: number): 段落 | null {
  let r: 段落 | null = null;
  for (const p of 並び) if (p.始め <= pos && pos < p.終わり) r = p;
  return r;
}

/** pos（w:t の位置）を含む run の w:rPr。書式が無ければ ""、run が見つからなければ null */
function runの書式(本文: string, pos: number): string | null {
  const a = 本文.lastIndexOf("<w:r>", pos);
  const b = 本文.lastIndexOf("<w:r ", pos);
  const 始め = Math.max(a, b);
  if (始め < 0) return null;
  const 間 = 本文.slice(始め, pos);
  if (/<\/w:r>/.test(間)) return null;
  const m = /^<w:r(?: [^>]*)?>(<w:rPr>[\s\S]*?<\/w:rPr>)?/.exec(間);
  if (!m) return null;
  return m[1] ?? "";
}

// ---------------- 事業者の控え ----------------

export type 控え = {
  種類: "よみどころ 事業者の控え";
  版: 1;
  保存日: string;
  様式: { sha256: string; 名前: string };
  値: 値;
  /** 品目と積替保管（2026-11-04 から。これより前の控えには無い） */
  申請?: 申請の中身;
};

export function 控えを作る(様: 様式, 値たち: 値, 保存日: string, 中身?: 申請の中身): 控え {
  const 値: 値 = {};
  for (const k of Object.keys(値たち).sort()) if (値たち[k] !== "") 値[k] = 値たち[k];
  const k: 控え = { 種類: "よみどころ 事業者の控え", 版: 1, 保存日, 様式: { sha256: 様.sha256, 名前: 様.名前 }, 値 };
  if (中身) k.申請 = 中身を整える(中身);
  return k;
}

export function 控えを読む(text: string): { ok: true; 控え: 控え } | { ok: false; 理由: string } {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return { ok: false, 理由: "JSON として読めません" };
  }
  const o = d as Partial<控え>;
  if (!o || o.種類 !== "よみどころ 事業者の控え" || o.版 !== 1 || typeof o.値 !== "object" || !o.様式?.sha256) {
    return { ok: false, 理由: "よみどころの事業者の控えの形ではありません" };
  }
  const 値: 値 = {};
  for (const [k, v] of Object.entries(o.値 ?? {})) if (typeof v === "string") 値[k] = v;
  // 品目：知らない品目・形の違うものは落とす。古い控え（申請が無い）は空のまま
  let 申請: 申請の中身 = { ...空の中身, 品目: [] };
  const a = (o as { 申請?: unknown }).申請 as Partial<申請の中身> | undefined;
  if (a && typeof a === "object") {
    const 品目 = Array.isArray(a.品目)
      ? a.品目
          .filter((x): x is 品目の選び => !!x && typeof x === "object" && typeof (x as 品目の選び).id === "string")
          .map((x) => ({ id: x.id, 石綿: x.石綿 === true, 水銀使用製品: x.水銀使用製品 === true, 水銀含有ばいじん等: x.水銀含有ばいじん等 === true }))
      : [];
    申請 = 中身を整える({ 品目, 積替保管: a.積替保管 === "有" || a.積替保管 === "無" ? a.積替保管 : "" });
  }
  return { ok: true, 控え: { 種類: o.種類, 版: 1, 保存日: String(o.保存日 ?? ""), 様式: { sha256: o.様式.sha256, 名前: String(o.様式.名前 ?? "") }, 値, 申請 } };
}

// ---------------- docx を組む ----------------

type JSZipの形 = JSZipの型;

/**
 * 記入した docx を作る。本文の1ファイルだけを差し替え、ほかは読み込んだ圧縮データのまま書き出す。
 * 画面と試しのスクリプトの両方から使う（JSZip は呼ぶ側が渡す）
 */
export async function docxに書く(
  JSZip: JSZipの形,
  バイト: Uint8Array,
  様: 様式,
  値たち: 値,
  中身?: 申請の中身,
): Promise<{ ok: true; バイト: Uint8Array; 結果: 欄の結果[] } | { ok: false; 理由: string }> {
  const zip = await JSZip.loadAsync(バイト);
  const entry = zip.file(様.本文);
  if (!entry) return { ok: false, 理由: `${様.本文} が見つかりません` };
  const 元 = await entry.async("uint8array");
  const 本文 = new TextDecoder("utf-8", { fatal: true }).decode(元);
  // 文字にして戻したときに元と同じバイトになるか（BOM や改行の扱いで変わるなら書かない）
  const 戻し = new TextEncoder().encode(本文);
  if (戻し.length !== 元.length || 戻し.some((v, i) => v !== 元[i])) {
    return { ok: false, 理由: "本文を文字にして戻すと元と同じになりません。書きません" };
  }
  const r = 記入する(本文, 様, 値たち, 中身);
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
    return { ok: false, 理由: "zip の中のファイルの並びが変わりました。書きません" };
  }
  // 圧縮方式を元と同じ DEFLATE にする。JSZip は、読み込んだパーツの方式と同じなら圧縮データを解かずにそのまま書く
  // （指定しないと全パーツが無圧縮で詰め直される）
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", platform: "DOS" });
  return { ok: true, バイト: out, 結果: r.結果 };
}

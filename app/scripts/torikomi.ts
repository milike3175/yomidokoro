// npm run 取込：電話・補正のメモを整えて、手帳（みゆき専用）に記録する。ミオの本体。
//
// 入口
//   npm run 取込                       superwhisper の最新の「電話メモ」録音
//   npm run 取込 -- 標準入力            パイプで渡した文字
//   npm run 取込 -- 貼付                クリップボード
//   npm run 取込 -- ファイル <パス>      文字のファイル
// 付け足し
//   --取込元 議事録|メモ|superwhisper   記録に残す取込元（既定：superwhisper 以外は メモ）
//   --答え "<文>"                       聞き返しへの答え（端末で聞けないとき用）
//   --保存                              検査を通ったら確認なしで保存する（端末で Enter を押せないとき用）
//   --検査だけ                          整えずに、渡した文を二段目・三段目の検査にだけかける（保存しない）
//
// 守ること
//   - 元の文字は保存しない。保存するのは整えた記録だけ
//   - 個人名・依頼者情報は三段で検査し、どれかに引っかかれば保存しない
//   - 鍵は app/.env の ANTHROPIC_API_KEY を環境変数として読むだけ。画面にもファイルにも出さない
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parse, stringify } from "yaml";
import {
  観点ファイル,
  品目ファイル,
  県ファイル,
  手引きファイル,
  受理実績ファイル,
  電話ファイル,
  補正ファイル,
} from "../schema/record.ts";

const APP = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(APP, "..");
const DATA = path.join(APP, "data");
const 許認可 = "産廃収集運搬";
const 手帳 = path.join(ROOT, "手帳", 許認可);
const 取込済 = path.join(ROOT, "手帳", "_取込済.txt");
const 録音の置き場 = path.join(os.homedir(), "Documents", "superwhisper", "recordings");

const 整えるモデル = "claude-opus-5-5";
const 確かめるモデル = "claude-haiku-5-5";
// 料金の目安（1M トークンあたりのドル。2026-11 時点の公開価格を基にした目安。変わったらここを直す）
const 単価 = {
  [整えるモデル]: { 入力: 4, 出力: 20 },
  [確かめるモデル]: { 入力: 0.1, 出力: 0.5 },
} as const;
const 円 = 150; // 1ドルあたりの円（目安）

const NFC = (s: string) => s.normalize("NFC");
const 出す = (s = "") => console.log(s);
const 止める = (msg: string, code = 1): never => {
  console.error(msg);
  process.exit(code);
};

// ---------------- 引数 ----------------
const args = process.argv.slice(2);
function 付け足し(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const 入口 = args[0] && !args[0].startsWith("--") ? args[0] : "superwhisper";
const 確認なしで保存 = args.includes("--保存");
const 先に渡された答え = 付け足し("--答え");

// ---------------- 端末（Enter と聞き返し用） ----------------
let tty: number | null = null;
try {
  tty = fs.openSync("/dev/tty", "r");
} catch {
  tty = null; // 端末が無い（ほかのプログラムから呼ばれた）
}
async function 聞く(q: string): Promise<string> {
  if (tty === null) return "";
  const input = fs.createReadStream("", { fd: tty, autoClose: false });
  const rl = readline.createInterface({ input, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  input.destroy();
  return a.trim();
}

// ---------------- 入口ごとに文字を受け取る ----------------
let 録音id: string | null = null;
let 録音日: string | null = null;

function 標準入力を読む(): string {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function superwhisperを読む(): string {
  if (!fs.existsSync(録音の置き場)) 止める("superwhisper の録音フォルダが見つからない。貼付 か 標準入力 で取り込んでほしい。", 0);
  const 済 = new Set(fs.existsSync(取込済) ? fs.readFileSync(取込済, "utf8").split("\n").map((s) => s.trim()) : []);
  const dirs = fs
    .readdirSync(録音の置き場)
    .filter((n) => /^\d+$/.test(n))
    .sort((a, b) => Number(b) - Number(a));
  for (const d of dirs) {
    if (済.has(`superwhisper/${d}`)) continue;
    const meta = path.join(録音の置き場, d, "meta.json");
    if (!fs.existsSync(meta)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(meta, "utf8"));
      if (NFC(String(m.modeName ?? "")) !== "電話メモ") continue;
      録音id = d;
      録音日 = typeof m.datetime === "string" ? m.datetime.slice(0, 10) : null;
      return String(m.result ?? "");
    } catch {
      continue;
    }
  }
  return 止める(
    "superwhisper に「電話メモ」モードの、まだ取り込んでいない録音が見つからない。\n" +
      "モードを作っていなければ、superwhisper で「電話メモ」という名前のモードを作ってほしい。\n" +
      "今すぐ取り込むなら、npm run 取込 -- 貼付 か npm run 取込 -- 標準入力 が使える。",
    0,
  );
}

let 元の文字 = "";
if (入口 === "superwhisper") 元の文字 = superwhisperを読む();
else if (入口 === "標準入力") 元の文字 = 標準入力を読む();
else if (入口 === "貼付") 元の文字 = execFileSync("pbpaste", { encoding: "utf8" });
else if (入口 === "ファイル") {
  const p = args[1];
  if (!p || !fs.existsSync(p)) 止める("ファイルが見つからない。npm run 取込 -- ファイル <パス> の形で渡してほしい。");
  元の文字 = fs.readFileSync(p!, "utf8");
} else 止める(`入口「${入口}」は知らない。標準入力・貼付・ファイル のどれかにしてほしい。`);

元の文字 = NFC(元の文字).trim();
if (!元の文字) 止める("取り込む文字が空だった。", 0);
if (元の文字.length > 8000) 止める("文字が長すぎる（8000字まで）。要約してから渡してほしい。");

const 取込元の指定 = 付け足し("--取込元");
const 取込元 = (取込元の指定 ?? (入口 === "superwhisper" ? "superwhisper" : "メモ")) as "議事録" | "メモ" | "superwhisper";
if (!["議事録", "メモ", "superwhisper"].includes(取込元)) 止める("--取込元 は 議事録・メモ・superwhisper のどれか。");

// ---------------- 語彙と既存の記録 ----------------
const 観点 = 観点ファイル.parse(parse(fs.readFileSync(path.join(DATA, "観点.yaml"), "utf8"))).観点;
const 品目 = 品目ファイル.parse(parse(fs.readFileSync(path.join(DATA, "品目.yaml"), "utf8")));
const 県の中身 = 県ファイル.parse(parse(fs.readFileSync(path.join(DATA, "県.yaml"), "utf8")));
const 県一覧 = 県の中身.県;
/** 許可権者の候補：47都道府県＋県.yaml に足した政令市。政令市の窓口の答えは政令市のコード（5桁）で保存する */
const 許可権者一覧: { コード: string; 名前: string; 言葉: string[]; 説明: string }[] = [
  ...県一覧.map((k) => ({
    コード: k.コード,
    名前: k.名前,
    言葉: [k.名前, k.短い名, ...(k.言い回し ?? [])],
    説明: `${k.名前}／${k.短い名}${k.言い回し?.length ? "／" + k.言い回し.join("・") : ""}`,
  })),
  ...県の中身.政令市.map((s) => {
    const 親 = 県一覧.find((k) => k.コード === s.親);
    return {
      コード: s.コード,
      名前: s.名前,
      言葉: [s.名前, ...(s.言い回し ?? [])],
      説明: `${s.名前}（政令市。${親?.名前 ?? s.親}の中）${s.言い回し?.length ? "／" + s.言い回し.join("・") : ""}`,
    };
  }),
];
const 観点ids = new Set(観点.map((k) => k.id));
const 品目ids = new Set([...品目.品目.map((h) => h.id), ...品目.付加区分.map((h) => h.id), "建設系", "建設系以外"]);

function 県フォルダ(root: string, コード: string): string | null {
  if (!fs.existsSync(root)) return null;
  const hit = fs.readdirSync(root).find((n) => NFC(n).startsWith(`${コード}_`));
  return hit ? path.join(root, hit) : null;
}

/** 文字の中から許可権者を探す（Claude に渡す既存の記録を選ぶためだけ。決めるのは Claude）。
 *  同じ位置で当たったら長い語を取る（「京都市」と「京都」なら京都市） */
function 県の見当(text: string) {
  let best: { コード: string; at: number; 長さ: number } | null = null;
  for (const k of 許可権者一覧) {
    for (const w of k.言葉) {
      const at = text.indexOf(w);
      if (at < 0) continue;
      if (!best || at < best.at || (at === best.at && w.length > best.長さ)) best = { コード: k.コード, at, 長さ: w.length };
    }
  }
  return best?.コード ?? null;
}

type 既存 = { 番号: string; 種別: string; 観点: string; 対象: string[]; 品目?: string[]; 日付: string; 中身: string };
function 既存の記録(コード: string | null): 既存[] {
  if (!コード) return [];
  const out: 既存[] = [];
  const 配列 = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
  const 公開側 = 県フォルダ(path.join(DATA, 許認可), コード);
  if (公開側 && fs.existsSync(path.join(公開側, "手引き.yaml"))) {
    const t = 手引きファイル.parse(parse(fs.readFileSync(path.join(公開側, "手引き.yaml"), "utf8")));
    for (const r of t.記録) out.push({ 番号: "", 種別: "手引き", 観点: r.観点, 対象: r.対象, 品目: 配列(r.品目), 日付: r.確認日, 中身: r.主張 });
  }
  if (公開側 && fs.existsSync(path.join(公開側, "受理実績.yaml"))) {
    for (const r of 受理実績ファイル.parse(parse(fs.readFileSync(path.join(公開側, "受理実績.yaml"), "utf8"))))
      out.push({ 番号: "", 種別: "受理実績", 観点: r.観点, 対象: r.対象, 品目: 配列(r.品目), 日付: String(r.受理年), 中身: r.内容 });
  }
  const 手帳側 = 県フォルダ(手帳, コード);
  for (const sub of ["電話", "補正"]) {
    const dir = 手帳側 ? path.join(手帳側, sub) : null;
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort()) {
      const raw = parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (sub === "電話") {
        const d = 電話ファイル.parse(raw);
        for (const a of d.回答) out.push({ 番号: "", 種別: d.種別, 観点: a.観点, 対象: a.対象, 品目: 配列(a.品目), 日付: d.確認日, 中身: a.答え });
      } else {
        const d = 補正ファイル.parse(raw);
        for (const a of d.指摘) out.push({ 番号: "", 種別: "補正", 観点: a.観点, 対象: a.対象, 品目: 配列(a.品目), 日付: String(d.年), 中身: `${a.指摘}（直し方：${a.直し方}）` });
      }
    }
  }
  out.forEach((r, i) => (r.番号 = `既存${i + 1}`));
  return out;
}

const 見当 = 県の見当(元の文字);
const 既存たち = 既存の記録(見当);

// ---------------- Claude に渡す ----------------
const 手続き = z.enum(["新規", "更新", "変更許可", "変更届"]);
const 整えた形 = z.object({
  種別: z.enum(["電話", "補正"]),
  許可権者コード: z.string(),
  窓口: z.string(),
  日付: z.string(),
  項目: z.array(
    z.object({
      観点: z.string(),
      候補観点: z.string(),
      問い: z.string(),
      答え: z.string(),
      直し方: z.string(),
      対象: z.array(手続き),
      品目: z.array(z.string()),
      既存との関係: z.enum(["新規", "一致", "補足", "食い違いの候補"]),
      関係する既存: z.string(),
    }),
  ),
  聞き返し: z.string(),
  個人名削除: z.number().int(),
  依頼者情報削除: z.number().int(),
});
type 整えた = z.infer<typeof 整えた形>;

const 確かめた形 = z.object({
  残っている: z.boolean(),
  箇所: z.array(z.string()),
});

function 指示文(file: string, 差し込み: Record<string, string>): string {
  const text = fs.readFileSync(path.join(APP, "prompts", file), "utf8");
  const i = text.indexOf("---- ここから指示 ----");
  let body = i >= 0 ? text.slice(i + "---- ここから指示 ----".length) : text;
  for (const [k, v] of Object.entries(差し込み)) body = body.replaceAll(`{{${k}}}`, v);
  return body.trim();
}

const 今日 = new Date();
const p2 = (n: number) => String(n).padStart(2, "0");
const 今日の文字 = `${今日.getFullYear()}-${p2(今日.getMonth() + 1)}-${p2(今日.getDate())}`;

const system = 指示文("mio.md", {
  許認可,
  今日: 今日の文字,
  録音日: 録音日 ?? `${今日の文字}（録音ではないので今日）`,
  県: 許可権者一覧.map((k) => `${k.コード}：${k.説明}`).join("\n"),
  観点: 観点.map((k) => `${k.id}：${k.表示名}／${k.群}／${k.品目で変わる ? "品目で変わる" : "-"}`).join("\n"),
  品目: [...品目.品目.map((h) => `${h.id}${h.建設系 ? "（建設系もある）" : ""}`), ...品目.付加区分.map((h) => `${h.id}（付加区分）`)].join("、"),
  既存の記録: 既存たち.length
    ? 既存たち
        .map((r) => `${r.番号}｜${r.種別}｜${r.日付}｜観点=${r.観点}｜対象=${r.対象.join("・")}${r.品目 ? `｜品目=${r.品目.join("・")}` : ""}｜${r.中身.slice(0, 120)}`)
        .join("\n")
    : "（なし）",
});

let client: Anthropic;
try {
  process.loadEnvFile(path.join(APP, ".env"));
} catch {
  // .env が無ければ、すでに環境変数にあるかだけ見る
}
if (!process.env.ANTHROPIC_API_KEY) 止める("ANTHROPIC_API_KEY が見つからない。app/.env に入っているか、みゆきに確かめてもらってほしい。");
client = new Anthropic();

const 使った = { 入力: 0, 出力: 0, 確入力: 0, 確出力: 0 };

// 端末で見ているときは、Claude が書いた所から順に、読める形で出す（観点・問い・答えなど）。
// 録画で「Claude が整えていく」様子をそのまま見せるため。演出ではなく、届いた速さのまま出す。
// Claude Code や Skill から呼ぶとき（端末でないとき）は出さない。
const 少しずつ出す = Boolean(process.stdout.isTTY) && !process.argv.includes("--静か");
const 見せる鍵: Record<string, string> = {
  許可権者コード: "許可権者",
  窓口: "窓口",
  日付: "日付",
  観点: "観点",
  問い: "問い",
  答え: "答え",
  直し方: "直し方",
  既存との関係: "これまでの記録と",
};

/** 少しずつ届く JSON の文字列から、見せる鍵の値だけを届いたそばから書き出す */
function 流れを見せる() {
  let 文 = "";
  let i = 0;
  let 中 = false; // 見せる値の中にいるか
  let 逃し = ""; // \ の後ろ
  let 見出し = ""; // 値の一文字目が来たら出す（空の値は見出しごと出さない）
  let コードを溜める: string | null = null; // 許可権者はコードで届くので、閉じたら名前にして出す
  const 書く = (t: string) => {
    if (見出し) process.stdout.write(見出し);
    見出し = "";
    process.stdout.write(t);
  };
  return (かけら: string) => {
    文 += かけら;
    while (i < 文.length) {
      if (!中) {
        if (文[i] !== '"') {
          i++;
          continue;
        }
        // 引用符の組を一つ読む。閉じがまだ届いていなければ待つ
        let j = i + 1;
        while (j < 文.length && 文[j] !== '"') j += 文[j] === "\\" ? 2 : 1;
        if (j >= 文.length) return;
        let k = j + 1;
        while (k < 文.length && /\s/.test(文[k])) k++;
        if (k >= 文.length) return;
        if (文[k] !== ":") {
          i = j + 1; // 鍵ではなく値（配列の中の文字など）。読み飛ばす
          continue;
        }
        const 鍵 = 文.slice(i + 1, j);
        k++;
        while (k < 文.length && /\s/.test(文[k])) k++;
        if (k >= 文.length) return;
        if (文[k] === '"' && 見せる鍵[鍵]) {
          見出し = `${鍵 === "観点" ? "\n" : ""}  ${見せる鍵[鍵]}：`;
          if (鍵 === "許可権者コード") コードを溜める = "";
          i = k + 1;
          中 = true;
          continue;
        }
        i = k; // 見せない値は、次の回で値として読み飛ばす
        continue;
      }
      const c = 文[i];
      if (逃し) {
        逃し += c;
        if (逃し[1] === "u") {
          if (逃し.length < 6) {
            i++;
            continue;
          }
          書く(String.fromCharCode(parseInt(逃し.slice(2), 16)));
        } else 書く(逃し[1] === "n" ? " " : 逃し[1] === "t" ? " " : 逃し[1]);
        逃し = "";
      } else if (c === "\\") 逃し = c;
      else if (c === '"' && コードを溜める !== null) {
        const k = 許可権者一覧.find((x) => x.コード === コードを溜める);
        書く(`${k ? k.名前 : コードを溜める}\n`);
        コードを溜める = null;
        見出し = "";
        中 = false;
      } else if (コードを溜める !== null) コードを溜める += c;
      else if (c === '"') {
        if (!見出し) process.stdout.write("\n");
        見出し = "";
        中 = false;
      } else 書く(c);
      i++;
    }
  };
}

async function 整える(追記: string): Promise<整えた> {
  const params = {
    model: 整えるモデル,
    max_tokens: 4000,
    system,
    messages: [
      {
        role: "user" as const,
        content: `次のメモを整えてください。\n\n<メモ>\n${元の文字}\n</メモ>${追記}`,
      },
    ],
    output_config: { format: zodOutputFormat(整えた形) },
  };
  if (!少しずつ出す) {
    const msg = await client.messages.parse(params);
    使った.入力 += msg.usage.input_tokens;
    使った.出力 += msg.usage.output_tokens;
    if (!msg.parsed_output) 止める("Claude の返事を読み取れなかった。もう一度試してほしい。");
    return msg.parsed_output!;
  }
  const 見せる = 流れを見せる();
  const stream = client.messages.stream(params);
  stream.on("text", (t) => 見せる(t));
  const msg = await stream.finalMessage();
  process.stdout.write("\n");
  使った.入力 += msg.usage.input_tokens;
  使った.出力 += msg.usage.output_tokens;
  const 本文 = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    return 整えた形.parse(JSON.parse(本文));
  } catch {
    return 止める("Claude の返事を読み取れなかった。もう一度試してほしい。");
  }
}

function 料金の行() {
  const a = 単価[整えるモデル];
  const b = 単価[確かめるモデル];
  const usd = (使った.入力 * a.入力 + 使った.出力 * a.出力 + 使った.確入力 * b.入力 + 使った.確出力 * b.出力) / 1_000_000;
  return `送った量：${整えるモデル} 入力${使った.入力}・出力${使った.出力}トークン、${確かめるモデル} 入力${使った.確入力}・出力${使った.確出力}トークン。料金の目安 約${usd.toFixed(3)}ドル（約${Math.round(usd * 円)}円）`;
}

// ---------------- 三段の検査 ----------------
const 置き換え語 = /^(担当者|依頼者|先方|窓口|審査|申請者|事業者)/;
const 正規表現の検査: { 名前: string; re: RegExp }[] = [
  { 名前: "敬称・役職の前の名前", re: /([一-龠々]{2,4})(さん|様(?![式子相々])|氏(?!名)|係長|主査|主任(?!者|技術)|課長)/g },
  { 名前: "会社名", re: /[一-龠々ァ-ヶーA-Za-z0-9]{1,}(株式会社|有限会社|合同会社)|(株式会社|有限会社|合同会社)[一-龠々ァ-ヶーA-Za-z0-9]{1,}/g },
  { 名前: "番地らしい数字", re: /\d+丁目|\d+番地|\d+番\d+号|(?<![\d-])\d{1,3}-\d{1,4}-\d{1,4}(?![\d-])/g },
  { 名前: "車両番号らしい数字", re: /\d{2,3}\s?[あ-ん]\s?\d{1,2}-\d{2}|[あ-ん]\s?\d{2}-\d{2}/g },
];

function 正規表現で見る(texts: string[]): string[] {
  const hits: string[] = [];
  for (const t of texts) {
    for (const { 名前, re } of 正規表現の検査) {
      for (const m of t.matchAll(re)) {
        if (名前 === "敬称・役職の前の名前" && 置き換え語.test(m[1] ?? "")) continue;
        hits.push(`${名前}：「${m[0]}」（${t.slice(Math.max(0, (m.index ?? 0) - 10), (m.index ?? 0) + m[0].length + 10)}）`);
      }
    }
  }
  return hits;
}

async function 小さなモデルで見る(text: string): Promise<string[]> {
  const msg = await client.messages.parse({
    model: 確かめるモデル,
    max_tokens: 1000,
    system: 指示文("mio_check.md", {}),
    messages: [{ role: "user", content: `<記録>\n${text}\n</記録>` }],
    output_config: { format: zodOutputFormat(確かめた形) },
  });
  使った.確入力 += msg.usage.input_tokens;
  使った.確出力 += msg.usage.output_tokens;
  const r = msg.parsed_output;
  if (!r) return ["（再確認の返事を読み取れなかった。安全のため止める）"];
  // 「残っていない」と言いながら箇所を挙げた場合も、安全のため止める
  if (!r.残っている && r.箇所.length === 0) return [];
  return r.箇所.length ? r.箇所.map((s) => `小さなモデルが指摘：「${s}」`) : ["小さなモデルが「残っている」と答えた（箇所は不明）"];
}

// ---------------- 本体 ----------------
async function main() {
  if (args.includes("--検査だけ")) {
    出す("渡した文を、小さなモデルと正規表現で確かめている（整えない・保存しない）…");
    const hits = [...(await 小さなモデルで見る(元の文字)), ...正規表現で見る([元の文字])];
    if (hits.length === 0) 出す("引っかかる箇所は無かった。");
    else {
      出す("止めた。個人名・会社名・住所・車両番号が残っているかもしれない箇所：");
      for (const h of hits) 出す(`  ${h}`);
    }
    出す(料金の行());
    process.exit(hits.length ? 3 : 0);
  }
  出す(`取り込む文字：${元の文字.length}字（入口：${入口}${録音id ? `、録音 ${録音id}` : ""}）`);
  出す("Claude で整えている…");
  let r = await 整える("");

  if (r.聞き返し) {
    出す();
    出す(`聞き返し：${r.聞き返し}`);
    let a = 先に渡された答え ?? (await 聞く("答え> "));
    if (!a) {
      出す();
      出す("答えが無いので、ここで止める（保存していない）。");
      出す('答えを足すときは --答え "<答え>" を付けてもう一度。');
      出す(料金の行());
      process.exit(2);
    }
    r = await 整える(`\n\n<聞き返しと答え>\n問い：${r.聞き返し}\n答え：${a}\n</聞き返しと答え>\nこれ以上は聞き返さず、聞き返しは空文字にしてください。`);
  }

  const 県 = 許可権者一覧.find((k) => k.コード === r.許可権者コード);
  if (!県) 止める(`許可権者が決まらなかった（${r.許可権者コード || "空"}）。保存していない。\n${料金の行()}`);
  if (r.項目.length === 0) 止める(`答えが一つも取れなかった。保存していない。\n${料金の行()}`);

  // 語彙に合わせる
  for (const it of r.項目) {
    if (it.観点 !== "未分類" && !観点ids.has(it.観点)) {
      it.候補観点 = it.候補観点 || it.観点;
      it.観点 = "未分類";
    }
    if (it.観点 === "未分類" && !it.候補観点) it.候補観点 = "名前未定";
    it.品目 = it.品目.filter((h) => 品目ids.has(h));
    if (it.対象.length === 0) it.対象 = ["新規"];
  }

  // 記録の形にする
  const 県dir = 県フォルダ(手帳, 県!.コード) ?? path.join(手帳, `${県!.コード}_${県!.名前}`);
  const 削除数 = Math.max(0, r.個人名削除) + Math.max(0, r.依頼者情報削除);
  const 品目欄 = (h: string[]) => (h.length === 0 ? undefined : h.length === 1 ? h[0] : h);
  let 記録: Record<string, unknown>;
  let 保存先: string;

  if (r.種別 === "電話") {
    const 日付 = /^\d{4}-\d{2}(-\d{2})?$/.test(r.日付) ? r.日付 : (録音日 ?? 今日の文字);
    const 課名 = (r.窓口.split(/\s+/).pop() || "不明").replace(/[\\/:*?"<>|\s]/g, "");
    const dir = path.join(県dir, "電話");
    const 同じ日 = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => NFC(n).startsWith(日付)).length : 0;
    保存先 = path.join(dir, `${日付}_${課名}.yaml`);
    for (let n = 2; fs.existsSync(保存先); n++) 保存先 = path.join(dir, `${日付}_${課名}_${n}.yaml`);
    記録 = {
      id: `${県!.コード}-電話-${日付}-${同じ日 + 1}`,
      許可権者: { コード: 県!.コード, 名前: 県!.名前 },
      許認可,
      確認日: 日付,
      窓口: r.窓口 || "不明",
      種別: "電話",
      記録者: "本人",
      取込元,
      回答: r.項目.map((it) => ({
        観点: it.観点,
        ...(it.観点 === "未分類" ? { 候補観点: it.候補観点 } : {}),
        問い: it.問い,
        答え: it.答え,
        対象: it.対象,
        ...(品目欄(it.品目) ? { 品目: 品目欄(it.品目) } : {}),
      })),
      個人名削除: 削除数,
    };
    電話ファイル.parse(記録);
  } else {
    const 年 = Number(/^\d{4}/.exec(r.日付)?.[0] ?? 今日.getFullYear());
    const dir = path.join(県dir, "補正");
    let n = 1;
    while (fs.existsSync(path.join(dir, `${年}_${n}.yaml`))) n++;
    保存先 = path.join(dir, `${年}_${n}.yaml`);
    記録 = {
      id: `${県!.コード}-補正-${年}-${n}`,
      許可権者: { コード: 県!.コード, 名前: 県!.名前 },
      許認可,
      年,
      窓口: r.窓口 || "不明",
      種別: "補正",
      記録者: "本人",
      取込元,
      指摘: r.項目.map((it) => ({
        観点: it.観点,
        ...(it.観点 === "未分類" ? { 候補観点: it.候補観点 } : {}),
        指摘: it.答え || it.問い,
        直し方: it.直し方 || "未記入",
        対象: it.対象,
        ...(品目欄(it.品目) ? { 品目: 品目欄(it.品目) } : {}),
      })),
      個人名削除: 削除数,
    };
    補正ファイル.parse(記録);
  }

  const yamlの文 = stringify(記録, { lineWidth: 0 });

  // 三段の検査（一段目は Claude が置き換え済み。二段目・三段目をここで）
  出す("個人名・依頼者情報を確かめている…");
  const 文たち = [
    String(記録.窓口),
    ...r.項目.flatMap((it) => [it.問い, it.答え, it.直し方, it.候補観点]),
  ].filter(Boolean);
  const 見つかった = [...(await 小さなモデルで見る(yamlの文)), ...正規表現で見る(文たち)];

  // 結果を見せる
  出す();
  出す("──────── 整えた結果 ────────");
  出す(`種別：${r.種別}　許可権者：${県!.名前}　窓口：${記録.窓口}　${r.種別 === "電話" ? `確認日：${記録.確認日}` : `年：${記録.年}`}`);
  r.項目.forEach((it, i) => {
    const k = 観点.find((x) => x.id === it.観点);
    出す();
    出す(`${i + 1}. ${k ? `${k.番号} ${k.表示名}` : `未分類（候補：${it.候補観点}）`}　対象：${it.対象.join("・")}${it.品目.length ? `　品目：${it.品目.join("・")}` : ""}`);
    if (r.種別 === "電話") {
      出す(`   問い：${it.問い}`);
      出す(`   答え：${it.答え}`);
    } else {
      出す(`   指摘：${it.答え || it.問い}`);
      出す(`   直し方：${it.直し方 || "未記入"}`);
    }
  });
  出す();
  出す(`個人名・依頼者情報の削除：${r.個人名削除 + r.依頼者情報削除}件（個人名 ${r.個人名削除}・依頼者情報 ${r.依頼者情報削除}）`);

  // 揺れの候補（判定はしない）。比べてよいのは同じ許可権者の記録だけ（京都府と京都市は別）。
  // 見当で選んだ既存の記録が、決まった許可権者と違うときは比べない
  const 同じ許可権者 = 見当 === 県!.コード;
  if (見当 && !同じ許可権者 && r.項目.some((it) => it.既存との関係 === "食い違いの候補")) {
    出す();
    出す(`揺れの候補は出さない：見比べた既存の記録が ${許可権者一覧.find((k) => k.コード === 見当)?.名前 ?? "なし"} のもので、${県!.名前} とは許可権者が違うため。`);
  }
  const 候補 = 同じ許可権者 ? r.項目.filter((it) => it.既存との関係 === "食い違いの候補") : [];
  for (const it of 候補) {
    const e = 既存たち.find((x) => x.番号 === it.関係する既存);
    if (!e) continue;
    const 重なる = e.観点 === it.観点 && e.対象.some((t) => (it.対象 as string[]).includes(t));
    if (!重なる) continue;
    出す();
    出す(`揺れの候補（判定はしない。Claude か行政書士が見る）：${県!.名前}・${it.観点}`);
    出す(`   これまで（${e.種別} ${e.日付}、対象 ${e.対象.join("・")}）：${e.中身}`);
    出す(`   今回（${r.種別}、対象 ${it.対象.join("・")}）：${it.答え}`);
  }

  if (見つかった.length > 0) {
    出す();
    出す("──────── 止めた（保存していない） ────────");
    出す("個人名・会社名・住所・車両番号が残っているかもしれない箇所：");
    for (const h of 見つかった) 出す(`  ${h}`);
    出す("元のメモから該当の部分を消すか「担当者」「依頼者」に直して、もう一度取り込んでほしい。");
    出す(料金の行());
    process.exit(3);
  }

  出す();
  出す(`保存先：${NFC(path.relative(ROOT, 保存先))}`);
  let 保存する = 確認なしで保存;
  if (!保存する) {
    if (tty === null) {
      出す("端末が無いので保存していない。保存するなら --保存 を付けてもう一度。");
      出す(料金の行());
      process.exit(0);
    }
    const a = await 聞く("この内容で保存するなら Enter、やめるなら n と入力> ");
    保存する = a === "";
  }
  if (!保存する) {
    出す("保存しなかった。");
    出す(料金の行());
    return;
  }

  fs.mkdirSync(path.dirname(保存先), { recursive: true });
  fs.writeFileSync(保存先, yamlの文, { flag: "wx" }); // 既にあれば上書きしない
  if (録音id) fs.appendFileSync(取込済, `superwhisper/${録音id}\n`);
  出す(`保存した：${NFC(path.relative(ROOT, 保存先))}`);
  出す(料金の行());
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  // 鍵が画面に出ないよう、念のため伏せる
  console.error(`取り込みに失敗した：${msg.replace(/sk-ant-[A-Za-z0-9_-]+/g, "（鍵）")}`);
  console.error(料金の行());
  process.exit(1);
});

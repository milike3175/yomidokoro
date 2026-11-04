// npm run 判定 [-- --県 27] [--数える] [--見せる [--全部]] [--やり直し] [--かまわない]（ケン）
// 電話の答えと、手引きの記録・別の日の電話の答えを比べ、揺れ（食い違い）かどうかを Claude に判定させる。
// - 組を選ぶのはプログラム：許可権者・観点（未分類は除く）が同じで、手続きと品目が重なるものだけ
// - Claude に一度に見せるのは「電話の答え一つ」と「同じ観点の相手すべて」。答えは相手ごとに付ける
// - TECHO=1：手帳の電話を読み、手帳/<許認可>/_判定/<許可権者>.yaml に書く（非公開）
//   それ以外：見本の電話だけを読み、app/data/見本/<許認可>/_判定/<許可権者>.yaml に書く（手帳は読まない）
// - 走らせ直し：材料が変わっていない組は聞き直さない（--やり直し で全部聞き直す）。解消: true は残す。
//   相手の記録が消えた組は、解消を捨てずに「もう一度判定」の印を付けて残す
// - 手引きの改訂（再確認）はここでは見ない
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parse, stringify } from "yaml";
import {
  観点ファイル,
  品目ファイル,
  手引きファイル,
  電話ファイル,
  判定ファイル,
  判定の答え,
  type 手引きデータ,
  type 電話データ,
  type 判定データ,
} from "../../schema/record.ts";
import { 品目が重なる, 手続きが重なる } from "../../src/lib/hantei.ts";
import { APP, ROOT, DATA, NFC, 出す, 止める, 今日の文字, ドル, 鍵を読む, 許認可, type 使用量 } from "../tebiki/kyotsu.ts";

const モデル = "claude-opus-5-5";
const 上限ドル = 3; // 見込みがこれを超えたら、聞く前に止める（--かまわない で外す）
const 同時に = 4;

const args = process.argv.slice(2);
const 県だけ = args.includes("--県") ? args[args.indexOf("--県") + 1] : null;
const 数えるだけ = args.includes("--数える");
const 見せる = args.includes("--見せる");
const 全部見せる = args.includes("--全部");
const やり直し = args.includes("--やり直し");
const 手帳を読む = process.env.TECHO === "1";

const 電話の置き場 = 手帳を読む ? path.join(ROOT, "手帳", 許認可) : path.join(DATA, "見本", 許認可);
const 判定の置き場 = path.join(電話の置き場, "_判定");
const ログの置き場 = 手帳を読む ? path.join(判定の置き場, "_ログ") : path.join(APP, "logs");

const 印 = (s: string) => crypto.createHash("sha256").update(NFC(s).replace(/\s+/g, "")).digest("hex").slice(0, 8);
const 配列に = (v?: string | string[]) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const 返事の形 = z.object({
  結果: z.array(z.object({ 相手ID: z.string(), 判定: 判定の答え, 理由: z.string() })),
});

function 指示文(差し込み: Record<string, string>) {
  const text = fs.readFileSync(path.join(APP, "prompts", "ken.md"), "utf8");
  const i = text.indexOf("---- ここから指示 ----");
  let body = i >= 0 ? text.slice(i + "---- ここから指示 ----".length) : text;
  for (const [k, v] of Object.entries(差し込み)) body = body.replaceAll(`{{${k}}}`, v);
  return body.trim();
}

// ---- 読む ----
const 観点 = 観点ファイル.parse(parse(fs.readFileSync(path.join(DATA, "観点.yaml"), "utf8"))).観点;
const 観点表 = new Map(観点.map((k) => [k.id, k]));
const 品目一覧 = 品目ファイル.parse(parse(fs.readFileSync(path.join(DATA, "品目.yaml"), "utf8"))).品目;

/** 許可権者のフォルダ（「27_大阪府」「26100_京都市」）。_判定 などの _ 始まりは飛ばす */
function 許可権者フォルダ(root: string) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .map(NFC)
    .filter((n) => /^(\d{2}|\d{5})_/.test(n) && fs.statSync(path.join(root, n)).isDirectory())
    .filter((n) => !県だけ || n.startsWith(`${県だけ}_`))
    .sort();
}

type 答え = 電話データ["回答"][number] & { 電話id: string; 確認日: string; 問いの印: string };
type 手引き記録 = 手引きデータ["記録"][number];
type 単位 = {
  許可権者: string;
  種類: "手引きと電話" | "電話どうし";
  答え: 答え;
  相手: { id: string; 判定id: string; 相手: 判定データ["判定"][number]["相手"]; 中身: string }[];
  材料の印: string;
};

function 電話を読む(dir: string): 答え[] {
  const d = path.join(dir, "電話");
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((n) => n.endsWith(".yaml"))
    .sort()
    .flatMap((n) => {
      const f = 電話ファイル.parse(parse(fs.readFileSync(path.join(d, n), "utf8")));
      return f.回答.map((a) => ({ ...a, 電話id: f.id, 確認日: f.確認日, 問いの印: 印(a.問い) }));
    });
}

function 手引きを読む(フォルダ名: string): 手引き記録[] | null {
  const f = path.join(DATA, 許認可, フォルダ名, "手引き.yaml");
  if (!fs.existsSync(f)) return null;
  return 手引きファイル.parse(parse(fs.readFileSync(f, "utf8"))).記録;
}

const 電話の中身 = (a: 答え) =>
  [
    `問い：${a.問い}`,
    `答え：${a.答え}`,
    `確認日：${a.確認日}`,
    `対象：${a.対象.join("・")}`,
    `品目：${配列に(a.品目).join("・") || "（限らない）"}`,
  ].join("\n");
const 手引きの中身 = (r: 手引き記録) =>
  [
    `主張：${r.主張}`,
    `引用：${r.出典.引用}`,
    `対象：${r.対象.join("・")}`,
    `品目：${配列に(r.品目).join("・") || "（限らない）"}`,
  ].join("\n");

function 単位を作る(フォルダ名: string, 答えたち: 答え[], 手引き: 手引き記録[]): 単位[] {
  const 単位たち: 単位[] = [];
  const 鍵 = (a: 答え) => `${a.電話id}#${a.観点}#${a.問いの印}`;
  // 古い順（確認日、同じ日なら id）。電話どうしは新しい方の答えを主にして、古い方を相手に見せる
  const 順 = [...new Set(答えたち.map((a) => a.電話id))].sort((x, y) => {
    const dx = 答えたち.find((a) => a.電話id === x)!.確認日;
    const dy = 答えたち.find((a) => a.電話id === y)!.確認日;
    return dx === dy ? x.localeCompare(y) : dx.localeCompare(dy);
  });
  for (const a of 答えたち) {
    if (a.観点 === "未分類") continue;
    const k = 観点表.get(a.観点);
    const 重なる = (b: { 対象: string[]; 品目?: string | string[] }) => 手続きが重なる(a, b) && 品目が重なる(a, b, k, 品目一覧);

    const 手引きの相手 = 手引き.filter((r) => r.観点 === a.観点 && 重なる(r));
    if (手引きの相手.length) {
      const 相手 = 手引きの相手.map((r) => ({ id: r.id, 判定id: `${鍵(a)}>${r.id}`, 相手: { 手引き: r.id }, 中身: 手引きの中身(r) }));
      単位たち.push({ 許可権者: フォルダ名, 種類: "手引きと電話", 答え: a, 相手, 材料の印: 印(電話の中身(a) + 相手.map((x) => x.id + x.中身).join("|")) });
    }

    const 古い電話 = new Set(順.slice(0, 順.indexOf(a.電話id)));
    const 電話の相手 = 答えたち.filter((b) => 古い電話.has(b.電話id) && b.観点 === a.観点 && 重なる(b));
    if (電話の相手.length) {
      const 相手 = 電話の相手.map((b) => ({
        id: `${b.電話id}#${b.問いの印}`,
        判定id: `${鍵(a)}>${b.電話id}#${b.問いの印}`,
        相手: { 電話: b.電話id, 問いの印: b.問いの印 },
        中身: 電話の中身(b),
      }));
      単位たち.push({ 許可権者: フォルダ名, 種類: "電話どうし", 答え: a, 相手, 材料の印: 印(電話の中身(a) + 相手.map((x) => x.id + x.中身).join("|")) });
    }
  }
  return 単位たち;
}

function 問いを作る(u: 単位) {
  const k = 観点表.get(u.答え.観点);
  const 相手の名 = u.種類 === "手引きと電話" ? "手引きの記録" : "別の日に電話で聞いた答え";
  return [
    `観点：${u.答え.観点}（${k?.表示名 ?? ""}）`,
    "",
    "## 電話の答え",
    電話の中身(u.答え),
    "",
    `## 比べる相手：${相手の名}（${u.相手.length}件）`,
    ...u.相手.map((x) => `### 相手ID：${x.id}\n${x.中身}`),
    "",
    `相手ID ${u.相手.length}件を全部、相手ごとに判定してください。`,
  ].join("\n");
}

async function main() {
  const 開始 = Date.now();
  const 今日 = 今日の文字();
  出す(`Claude の判定：${手帳を読む ? "手帳（非公開）" : "見本（公開版）"}の電話を読む`);

  const 許可権者たち = 許可権者フォルダ(電話の置き場);
  const 全単位: 単位[] = [];
  const 手引き無し: string[] = [];
  const 手引きのid = new Map<string, Set<string>>();
  for (const n of 許可権者たち) {
    const 答えたち = 電話を読む(path.join(電話の置き場, n));
    const 手引き = 手引きを読む(n);
    if (!手引き) 手引き無し.push(n);
    手引きのid.set(n, new Set((手引き ?? []).map((r) => r.id)));
    全単位.push(...単位を作る(n, 答えたち, 手引き ?? []));
  }

  const 前の判定 = new Map<string, 判定データ>();
  for (const n of 許可権者たち) {
    const f = path.join(判定の置き場, `${n}.yaml`);
    if (fs.existsSync(f)) 前の判定.set(n, 判定ファイル.parse(parse(fs.readFileSync(f, "utf8"))));
  }
  const 前の組 = new Map([...前の判定.values()].flatMap((d) => d.判定.map((x) => [x.id, x] as const)));

  // 材料が変わっていない単位は聞き直さない
  const 聞く = 全単位.filter((u) => やり直し || u.相手.some((x) => 前の組.get(x.判定id)?.材料の印 !== u.材料の印));

  const system = 指示文({
    許認可名: "産業廃棄物収集運搬業の許可",
    観点: 観点.map((k) => `${k.id}（${k.表示名}）：${k.手引きで探すもの}`).join("\n"),
  });
  const 見込み = 聞く.reduce((s, u) => s + ((system.length + 問いを作る(u).length) * 1.2 * 4 + (80 + 120 * u.相手.length) * 20) / 1_000_000, 0);

  for (const n of 許可権者たち) {
    const us = 全単位.filter((u) => u.許可権者 === n);
    const 手 = us.filter((u) => u.種類 === "手引きと電話");
    const 電 = us.filter((u) => u.種類 === "電話どうし");
    出す(
      `  ${n}：手引きと電話 ${手.length}単位（組 ${手.reduce((s, u) => s + u.相手.length, 0)}）、電話どうし ${電.length}単位（組 ${電.reduce((s, u) => s + u.相手.length, 0)}）${手引き無し.includes(n) ? "　手引き.yaml なし" : ""}`,
    );
  }
  出す(`  合わせて ${全単位.length}単位。聞くのは ${聞く.length}単位（${モデル}、料金の見込み 約${見込み.toFixed(2)}ドル）`);
  if (数えるだけ) return;
  if (見込み > 上限ドル && !args.includes("--かまわない")) 止める(`  見込みが${上限ドル}ドルを超えるので止めた。--かまわない を付けると進む。`);

  // ---- 聞く ----
  const 新しい答え = new Map<string, { 判定: z.infer<typeof 判定の答え>; 理由: string }>();
  const 使用量たち: { 単位: string; 使用量: 使用量; ドル: number }[] = [];
  const 気になる: string[] = [];
  let 合計ドル = 0;
  if (聞く.length) {
    鍵を読む();
    const client = new Anthropic();
    const format = zodOutputFormat(返事の形);
    let 次 = 0;
    const 働く = async () => {
      while (次 < 聞く.length) {
        const u = 聞く[次++];
        const 名 = `${u.答え.電話id}#${u.答え.観点}#${u.答え.問いの印}（${u.種類}）`;
        let msg;
        try {
          msg = await client.messages
            .stream({
              model: モデル,
              max_tokens: 4000,
              system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }],
              messages: [{ role: "user" as const, content: 問いを作る(u) }],
              output_config: { format },
            })
            .finalMessage();
        } catch (e) {
          気になる.push(`  ${名}：聞けなかった（${String(e instanceof Error ? e.message : e).replace(/sk-ant-[A-Za-z0-9_-]+/g, "（鍵）").slice(0, 120)}）。判定不能にした`);
          continue;
        }
        const d = ドル(モデル, msg.usage);
        合計ドル += d;
        使用量たち.push({ 単位: 名, 使用量: msg.usage, ドル: d });
        const 返事 = msg.parsed_output;
        if (!返事) {
          気になる.push(`  ${名}：返事を読み取れなかった（${msg.stop_reason}）。判定不能にした`);
          continue;
        }
        for (const r of 返事.結果) {
          const x = u.相手.find((x) => x.id === r.相手ID);
          if (!x) {
            気になる.push(`  ${名}：知らない相手ID が返ってきた（捨てた）`);
            continue;
          }
          if (r.理由.length > 60) 気になる.push(`  ${x.判定id}：理由が${r.理由.length}字（60字を超えた）`);
          新しい答え.set(x.判定id, { 判定: r.判定, 理由: r.理由.replace(/\s+/g, " ").trim().slice(0, 80) });
        }
        出す(`  済み ${使用量たち.length}／${聞く.length}　${名}（約${d.toFixed(3)}ドル）`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(同時に, 聞く.length) }, 働く));
  }

  // ---- 書く ----
  const 数: Record<string, Record<string, number>> = {};
  let 引き継いだ解消 = 0;
  let 残した解消 = 0;
  for (const n of 許可権者たち) {
    const 前 = 前の判定.get(n);
    const us = 全単位.filter((u) => u.許可権者 === n);
    if (!us.length && !前) continue;
    const 判定: 判定データ["判定"] = [];
    for (const u of us) {
      for (const x of u.相手) {
        const 古い = 前の組.get(x.判定id);
        const 新 = 新しい答え.get(x.判定id);
        const 聞いた = 聞く.includes(u);
        const 中身 =
          新 ??
          (!聞いた && 古い
            ? { 判定: 古い.判定, 理由: 古い.理由 }
            : { 判定: "判定不能" as const, 理由: "Claude の返事にこの組が無かった" });
        if (聞いた && !新) 気になる.push(`  ${x.判定id}：返事に無かったので判定不能にした`);
        判定.push({
          id: x.判定id,
          種類: u.種類,
          観点: u.答え.観点,
          電話: { id: u.答え.電話id, 問いの印: u.答え.問いの印 },
          相手: x.相手,
          判定: 中身.判定,
          理由: 中身.理由,
          判定日: 聞いた ? 今日 : (古い?.判定日 ?? 今日),
          材料の印: u.材料の印,
          ...(古い?.解消 ? { 解消: true } : {}),
          // 解消したあとで材料が変わった組は、確かめ直してもらう
          ...(古い?.解消 && (古い.材料の印 !== u.材料の印 || 古い.もう一度判定) ? { もう一度判定: true } : {}),
        });
        if (古い?.解消) 引き継いだ解消++;
      }
    }
    // 相手が消えた組：解消してあったものは捨てずに残す（手引きを読み直して記録の ID が変わったときなど）
    const 今のid = new Set(判定.map((x) => x.id));
    for (const x of 前?.判定 ?? []) {
      if (今のid.has(x.id) || !x.解消) continue;
      判定.push({ ...x, もう一度判定: true });
      残した解消++;
      const 消えた = "手引き" in x.相手 && !手引きのid.get(n)?.has(x.相手.手引き) ? "手引きの記録" : "電話の答え";
      気になる.push(`  ${x.id}：${消えた}が見つからなくなった。解消を残し、もう一度判定の印を付けた`);
    }
    const [コード, ...名前] = n.split("_");
    const data: 判定データ = { 許可権者: { コード, 名前: 名前.join("_") }, 許認可, 判定日: 今日, モデル, 判定 };
    判定ファイル.parse(data);
    fs.mkdirSync(判定の置き場, { recursive: true });
    fs.writeFileSync(path.join(判定の置き場, `${n}.yaml`), stringify(data, { lineWidth: 0 }));
    数[n] = Object.fromEntries(判定の答え.options.map((o) => [o, 判定.filter((x) => x.判定 === o).length]));
  }

  // ---- ログ（手元だけ） ----
  const 秒 = Math.round((Date.now() - 開始) / 1000);
  if (使用量たち.length) {
    fs.mkdirSync(ログの置き場, { recursive: true });
    fs.writeFileSync(
      path.join(ログの置き場, `判定_${手帳を読む ? "手帳" : "見本"}_${今日}_${Date.now()}.json`),
      JSON.stringify({ モデル, 秒, 合計ドル, 使用量たち }, null, 1),
    );
  }

  出す();
  出す(`許可権者\t${判定の答え.options.join("\t")}`);
  for (const [n, c] of Object.entries(数)) 出す(`${n}\t${判定の答え.options.map((o) => c[o]).join("\t")}`);
  for (const l of 気になる) 出す(l);
  if (引き継いだ解消 || 残した解消) 出す(`解消：引き継いだ ${引き継いだ解消}、相手が消えて残した ${残した解消}`);
  const 入 = 使用量たち.reduce((s, x) => s + x.使用量.input_tokens + (x.使用量.cache_read_input_tokens ?? 0) + (x.使用量.cache_creation_input_tokens ?? 0), 0);
  const 出 = 使用量たち.reduce((s, x) => s + x.使用量.output_tokens, 0);
  出す(
    `料金 約${合計ドル.toFixed(3)}ドル（${使用量たち.length}回、入力 ${入}・出力 ${出}トークン${使用量たち.length ? `、1回あたり約${(合計ドル / 使用量たち.length).toFixed(4)}ドル` : ""}）、${秒}秒`,
  );
  出す(`書いた：${NFC(path.relative(ROOT, 判定の置き場))}/`);

  // ---- 見せる：食い違い・補足を、電話の答え・相手・理由で並べる（手元の画面だけ。ファイルには書かない） ----
  if (見せる) {
    for (const n of Object.keys(数)) {
      const d = 判定ファイル.parse(parse(fs.readFileSync(path.join(判定の置き場, `${n}.yaml`), "utf8")));
      for (const x of d.判定.filter((x) => 全部見せる || x.判定 === "食い違い" || x.判定 === "補足")) {
        const u = 全単位.find((u) => u.相手.some((y) => y.判定id === x.id))!;
        const y = u.相手.find((y) => y.判定id === x.id)!;
        出す(`\n[${x.判定}] ${n} ${x.観点}（${x.種類}）${x.解消 ? " 解消済み" : ""}`);
        出す(`  電話：${u.答え.答え}`);
        出す(`  相手：${y.中身.split("\n")[0]}`);
        出す(`  理由：${x.理由}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(`判定に失敗した：${String(e instanceof Error ? e.message : e).replace(/sk-ant-[A-Za-z0-9_-]+/g, "（鍵）")}`);
  process.exit(1);
});

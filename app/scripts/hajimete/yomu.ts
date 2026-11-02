// npm run はじめて読む -- <id> [--かまわない]
// npm run 探す で取ってきた手引き・案内ページを、共通観点（data/共通観点.yaml）で読み、
// あわせて「この許認可だけの観点」を5個まで拾わせる。結果は app/data/はじめて/<id>/手引き.yaml。
// 読んだあと、産廃の道具と同じ照合（引用が本文にあるか。AI は使わない）を必ず通す。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parse, stringify } from "yaml";
import { APP, ROOT, DATA, NFC, 出す, 止める, 今日の文字, ページに割る, ドル, 鍵を読む } from "../tebiki/kyotsu.ts";
import { 全部照らす, 本文を用意, 照らす, 印字ページを読む, 印字を引く } from "../tebiki/shogo.ts";
import type { 手引きデータ } from "../../schema/record.ts";
import { 共通観点ファイル, はじめてファイル, type はじめてデータ } from "../../schema/hajimete.ts";
import { 手元フォルダ, 公開フォルダ, 出典を読む, 秒 } from "./kyotsu.ts";

const モデル = "claude-fable-5-1";
const 上限ドル = 4; // 見込みがこれを超えたら、聞く前に止める（--かまわない で外す）
const 文字の上限 = 300_000; // 本文がこれより長ければ止める（--かまわない で外す）

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
if (!id) 止める("使い方：npm run はじめて読む -- <id>（例：npm run はじめて読む -- 建設業許可_和歌山県）");

const 一件 = z.object({ 主張: z.string(), 文書: z.string(), 物理ページ: z.number().int(), 引用: z.string() });
const 返事の形 = z.object({
  結果: z.array(z.object({ 観点: z.string(), 記載: z.enum(["あり", "なし"]), 記録: z.array(一件), 探した語: z.array(z.string()) })),
  独自の観点: z.array(z.object({ 名前: z.string(), 主張: z.string(), 文書: z.string(), 物理ページ: z.number().int(), 引用: z.string() })),
});

const ハッシュ = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);

function 指示文(差し込み: Record<string, string>) {
  const text = fs.readFileSync(path.join(APP, "prompts", "hajimete.md"), "utf8");
  const i = text.indexOf("---- ここから指示 ----");
  let body = i >= 0 ? text.slice(i + "---- ここから指示 ----".length) : text;
  for (const [k, v] of Object.entries(差し込み)) body = body.replaceAll(`{{${k}}}`, v);
  return body.trim();
}

async function main() {
  const t読む = Date.now();
  const 出典 = 出典を読む(id!);
  const dir = 手元フォルダ(id!);
  const 読む資料 = 出典.ファイル.filter((f) => (f.ページ数 ?? 0) > 0 && f.役割 !== "様式");
  if (読む資料.length === 0) 止める(`「${id}」には、文字にできた手引き・案内ページが無い。npm run 探す の結果（取れなかった理由）を見てほしい。`);

  const 本文の塊: string[] = [];
  const ページ対応 = new Map<string, [number, number][]>();
  for (const f of 読む資料) {
    const txt = path.join(dir, "txt", `${f.ファイル名}.txt`);
    const 対応 = f.形式 === "PDF" ? 印字ページを読む(txt, f.ファイル名) : [];
    ページ対応.set(f.ファイル名, 対応);
    const 印字 = new Map(対応);
    本文の塊.push(`### 文書：${f.ファイル名}（形式：${f.形式}${f.名前 ? `、名前：${f.名前}` : ""}）`);
    for (const p of ページに割る(txt, f.ファイル名)) {
      本文の塊.push(`=====p${p.物理ページ}=====${印字.has(p.物理ページ) ? `（印字 p.${印字.get(p.物理ページ)}）` : ""}`);
      本文の塊.push(p.本文.replace(/[ \t　]+\n/g, "\n").trimEnd());
    }
  }
  const 本文 = 本文の塊.join("\n");

  const 観点 = 共通観点ファイル.parse(parse(fs.readFileSync(path.join(DATA, "共通観点.yaml"), "utf8"))).観点;
  const system = 指示文({
    自治体名: 出典.自治体名,
    許認可名: 出典.許認可名,
    観点: 観点.map((k) => `- ${k.id}（${k.表示名}）：${k.探すもの}`).join("\n"),
  });

  const 見込み = ((本文.length + system.length) * 10 + 12000 * 50) / 1_000_000;
  出す(`${id}：${読む資料.length}資料・${本文.length.toLocaleString()}字を、共通観点${観点.length}項目と独自の観点で読む（${モデル}）`);
  出す(`  料金の見込み：約${見込み.toFixed(2)}ドル`);
  const かまわない = args.includes("--かまわない");
  if (本文.length > 文字の上限 && !かまわない) 止める(`  本文が${文字の上限.toLocaleString()}字を超えるので止めた。--かまわない を付けると進む。`);
  if (見込み > 上限ドル && !かまわない) 止める(`  見込みが${上限ドル}ドルを超えるので止めた。--かまわない を付けると進む。`);

  // --ログから：前に読んだ返事（_ログ/読む_*.json の最新）から作り直す。API は使わない（形の直しの試しに使う）
  let 返事: z.infer<typeof 返事の形>;
  let 読む費用: number;
  let 読む秒: number;
  let 使用量: unknown;
  const ログdir = path.join(dir, "_ログ");
  if (args.includes("--ログから")) {
    const ログ = fs.existsSync(ログdir) ? fs.readdirSync(ログdir).filter((n) => n.startsWith("読む_")).sort() : [];
    if (!ログ.length) 止める("  前に読んだログが無い。--ログから を外して読んでほしい。");
    const L = JSON.parse(fs.readFileSync(path.join(ログdir, ログ[ログ.length - 1]), "utf8"));
    返事 = 返事の形.parse(L.返事);
    読む費用 = L.費用;
    読む秒 = L.秒;
    使用量 = L.使用量;
    出す(`  前に読んだ返事（${ログ[ログ.length - 1]}）から作り直す。API は使わない`);
  } else {
    鍵を読む();
    const client = new Anthropic();
    const stream = client.messages.stream({
      model: モデル,
      max_tokens: 20000,
      system: [
        { type: "text", text: system },
        { type: "text", text: `## 本文\n\n${本文}` },
      ],
      messages: [
        {
          role: "user",
          content: `共通の観点${観点.length}項目を全部、記載あり・なしのどちらかで「結果」に入れてください。「観点」には、一覧の行頭の id（括弧の前の部分）をそのまま書いてください。そのあと「独自の観点」を多くて5個入れてください。`,
        },
      ],
      output_config: { format: zodOutputFormat(返事の形) },
    });
    const msg = await stream.finalMessage();
    if (!msg.parsed_output) 止める(`  返事を読み取れなかった（止まった理由：${msg.stop_reason}）`);
    返事 = msg.parsed_output!;
    読む費用 = ドル(モデル, msg.usage);
    読む秒 = 秒(Date.now() - t読む);
    使用量 = msg.usage;
    出す(`  読んだ：${読む秒}秒、約${読む費用.toFixed(3)}ドル（入力 ${msg.usage.input_tokens}・出力 ${msg.usage.output_tokens}トークン）`);
    fs.mkdirSync(ログdir, { recursive: true });
    fs.writeFileSync(path.join(ログdir, `読む_${今日の文字()}_${Date.now()}.json`), JSON.stringify({ モデル, 秒: 読む秒, 費用: 読む費用, 使用量, 返事 }, null, 1));
    fs.appendFileSync(path.join(ROOT, "手引き", "_料金ログ.txt"), `${今日の文字()}\t${id}\tはじめて読む\t${モデル}\t${読む費用.toFixed(3)}ドル\t${読む秒}秒\n`);
  }

  // ---- 形をそろえる ----
  const 今日 = 今日の文字();
  // 観点の名前は id で返すよう頼んでいるが、表示名で返ってくることもあるので、どちらでも引けるようにする
  const 観点を引く = (名: string) => {
    const n = NFC(名).trim();
    return 観点.find((k) => k.id === n || k.表示名 === n || n.startsWith(k.id) || k.表示名.startsWith(n))?.id ?? null;
  };
  const 文書名 = new Set(読む資料.map((f) => f.ファイル名));
  const 記録: はじめてデータ["記録"] = [];
  const 記載なし: はじめてデータ["記載なし"] = [];
  const 見た = new Set<string>();
  const 引用を整える = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 100);
  for (const r0 of 返事.結果) {
    const 観点id = 観点を引く(r0.観点);
    if (!観点id) {
      出す(`  （注）観点の一覧に無い名前で返ってきた：${r0.観点}`);
      continue;
    }
    const r = { ...r0, 観点: 観点id };
    見た.add(r.観点);
    const 使える = r.記録.filter((x) => 文書名.has(NFC(x.文書)) && x.引用.trim().length >= 4 && x.物理ページ > 0);
    if (r.記載 === "なし" || 使える.length === 0) {
      if (!記載なし.some((n) => n.観点 === r.観点)) 記載なし.push({ 観点: r.観点, 探した語: r.探した語.length ? r.探した語 : ["（語の記録なし）"] });
      continue;
    }
    for (const x of 使える.slice(0, 3)) {
      const 引用 = 引用を整える(x.引用);
      const rid = `${r.観点}-${ハッシュ(NFC(x.文書) + 引用)}`;
      if (記録.some((e) => e.id === rid)) continue;
      記録.push({
        id: rid,
        観点: r.観点,
        主張: x.主張,
        種別: "手引き",
        出典: { 文書: NFC(x.文書), 物理ページ: x.物理ページ, 印字ページ: null, 引用, 照合: "不一致" },
        確認日: 今日,
      });
    }
  }
  for (const k of 観点) if (!見た.has(k.id)) 記載なし.push({ 観点: k.id, 探した語: ["（返事に含まれなかった）"] });
  const 独自の観点: はじめてデータ["独自の観点"] = 返事.独自の観点
    .filter((x) => 文書名.has(NFC(x.文書)) && x.引用.trim().length >= 4 && x.物理ページ > 0)
    .slice(0, 5)
    .map((x) => ({
      名前: x.名前,
      主張: x.主張,
      出典: { 文書: NFC(x.文書), 物理ページ: x.物理ページ, 印字ページ: null, 引用: 引用を整える(x.引用), 照合: "不一致" as const },
    }));

  // ---- 照合（産廃の道具と同じ関数。AI は使わない） ----
  const t照合 = Date.now();
  const 照合用 = {
    手引き: 読む資料.map((f) => ({ 文書: f.ファイル名, ページ対応: ページ対応.get(f.ファイル名) ?? [] })),
    記録,
  } as unknown as 手引きデータ;
  const { 数, 気になる } = 全部照らす(dir, 照合用);
  const 本 = 本文を用意(dir, 読む資料.map((f) => f.ファイル名));
  const 独自の数: Record<string, number> = {};
  for (const c of 独自の観点) {
    const res = 照らす(本, c.出典.文書, c.出典.物理ページ, c.出典.引用);
    c.出典.物理ページ = res.物理ページ;
    c.出典.照合 = res.照合;
    c.出典.印字ページ = 印字を引く(ページ対応.get(c.出典.文書), res.物理ページ);
    独自の数[res.照合] = (独自の数[res.照合] ?? 0) + 1;
    if (res.照合 === "近似（要目視）" || res.照合 === "不一致") 気になる.push(`  ${res.照合} 独自の観点「${c.名前}」：${c.出典.引用}`);
  }
  const 照合秒 = 秒(Date.now() - t照合);

  const data: はじめてデータ = {
    id: id!,
    許認可名: 出典.許認可名,
    自治体名: 出典.自治体名,
    自治体ドメイン: 出典.自治体ドメイン,
    読んだ日: 今日,
    モデル,
    資料: 出典.ファイル.map((f) => ({
      文書: f.ファイル名,
      ...(f.名前 ? { 名前: f.名前 } : {}),
      ...(f.役割 ? { 役割: f.役割 } : {}),
      形式: f.形式,
      url: f.url,
      取得日: f.取得日,
      sha256: f.sha256,
      ページ数: f.ページ数,
      読んだ: 読む資料.includes(f),
    })),
    記録,
    記載なし,
    独自の観点,
    取れなかった: 出典.取れなかった,
    見つからなかったこと: 出典.見つからなかったこと,
    検索語: 出典.検索語,
    時間: { 探す: 出典.時間.探す, 取得: 出典.時間.取得, 読む: 読む秒, 照合: 照合秒 },
    費用: { 探す: 出典.費用.探す, 読む: Math.round(読む費用 * 10000) / 10000 },
  };
  はじめてファイル.parse(data);

  const out = path.join(公開フォルダ(id!, true), "手引き.yaml");
  if (fs.existsSync(out)) fs.copyFileSync(out, `${out}.前`);
  fs.writeFileSync(out, stringify(data, { lineWidth: 0 }));

  出す();
  出す(`${id}：記録 ${記録.length}件（埋まった観点 ${new Set(記録.map((r) => r.観点)).size}／${観点.length}）、記載なし ${記載なし.length}、独自の観点 ${独自の観点.length}`);
  出す(`照合（共通観点）：一致 ${数.一致}　一致（ページ訂正） ${数["一致（ページ訂正）"]}　近似（要目視） ${数["近似（要目視）"]}　不一致 ${数.不一致}`);
  出す(`照合（独自の観点）：${Object.entries(独自の数).map(([k, v]) => `${k} ${v}`).join("　") || "なし"}`);
  for (const l of 気になる) 出す(l);
  const 計秒 = data.時間.探す + data.時間.取得 + data.時間.読む + data.時間.照合;
  出す(`時間：探す ${data.時間.探す}秒・取得 ${data.時間.取得}秒・読む ${data.時間.読む}秒・照合 ${data.時間.照合}秒（計 ${Math.round(計秒)}秒）`);
  出す(`費用：探す 約${data.費用.探す.toFixed(3)}ドル・読む 約${data.費用.読む.toFixed(3)}ドル`);
  出す(`書いた：${NFC(path.relative(ROOT, out))}`);
}

main().catch((e) => {
  console.error(`読むのに失敗した：${String(e instanceof Error ? e.message : e).replace(/sk-ant-[A-Za-z0-9_-]+/g, "（鍵）")}`);
  process.exit(1);
});

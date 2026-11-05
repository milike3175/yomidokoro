// npm run 読む -- <県コード> [--まとめて] [--群 手続きの流れ]（ハナ）
// 文字にした手引きを、観点の群ごとに Claude に読ませ、層1の形で
// app/data/産廃収集運搬/<コード>_<県名>/手引き.yaml に書く。
// - 手引きの本文は記憶（キャッシュ）させ、群ごとの問いを重ねて安く読む
// - --まとめて：Batch API（半額。結果が返るまで数分〜待つ）
// - 前の 手引き.yaml は 手引き.yaml.前 として残し、変わった観点を出す
// - 読んだあと、ケンの照合（AI を使わない）をそのまま走らせる
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parse, stringify } from "yaml";
import { 観点ファイル, 品目ファイル, 手引きファイル, type 手引きデータ } from "../../schema/record.ts";
import {
  DATA,
  ROOT,
  NFC,
  出す,
  止める,
  今日の文字,
  観点を合わせる,
  県を探す,
  手引きフォルダ,
  公開側フォルダ,
  出典を読む,
  出典に書く,
  ページに割る,
  ドル,
  鍵を読む,
  許認可,
  type 使用量,
} from "./kyotsu.ts";
import { 全部照らす, 印字ページを読む } from "./shogo.ts";

const モデル = "claude-fable-5-1";
const 上限ドル = 5; // 見込みがこれを超えたら、聞く前に止める（--かまわない で外す）

const args = process.argv.slice(2);
const まとめて = args.includes("--まとめて");
const 群だけ = args.includes("--群") ? args[args.indexOf("--群") + 1] : null;

const 手続き = z.enum(["新規", "更新", "変更許可", "変更届"]);
const 返事の形 = z.object({
  結果: z.array(
    z.object({
      観点: z.string(),
      記載: z.enum(["あり", "なし"]),
      記録: z.array(
        z.object({
          主張: z.string(),
          文書: z.string(),
          物理ページ: z.number().int(),
          引用: z.string(),
          対象: z.array(手続き),
          品目: z.array(z.string()),
        }),
      ),
      探した語: z.array(z.string()),
    }),
  ),
  観点候補: z.array(
    z.object({ 名前: z.string(), 主張: z.string(), 文書: z.string(), 物理ページ: z.number().int(), 引用: z.string() }),
  ),
});
type 返事 = z.infer<typeof 返事の形>;

function 指示文(差し込み: Record<string, string>) {
  const text = fs.readFileSync(path.join(DATA, "..", "prompts", "hana.md"), "utf8");
  const i = text.indexOf("---- ここから指示 ----");
  let body = i >= 0 ? text.slice(i + "---- ここから指示 ----".length) : text;
  for (const [k, v] of Object.entries(差し込み)) body = body.replaceAll(`{{${k}}}`, v);
  return body.trim();
}

const ハッシュ = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);

async function main() {
  const 開始 = Date.now();
  const 県 = 県を探す(args[0]);
  const dir = 手引きフォルダ(県.コード, 県.名前);
  const { data: 出典 } = 出典を読む(dir);
  if (!出典.ファイル?.length) 止める(`${県.名前}の手引きがまだ登録されていない。先に npm run 取得 -- ${県.コード}`);

  // 読む文書：様式そのもの・参考は除く（様式は書き込む紙で、ルールの説明ではない）
  const 読む文書 = 出典.ファイル!.filter((f) => (f.ページ数 ?? 0) > 0 && !/^(様式|参考)/.test(f.役割 ?? ""));
  if (読む文書.length === 0) 止める("文字にできた手引きが無い。");

  const 本文の塊: string[] = [];
  const ページ対応 = new Map<string, [number, number][]>();
  for (const f of 読む文書) {
    const txt = path.join(dir, "txt", `${f.ファイル名}.txt`);
    const 対応 = 印字ページを読む(txt, f.ファイル名);
    ページ対応.set(f.ファイル名, 対応);
    const 印字 = new Map(対応);
    本文の塊.push(`### 文書：${f.ファイル名}`);
    for (const p of ページに割る(txt, f.ファイル名)) {
      本文の塊.push(`=====p${p.物理ページ}=====${印字.has(p.物理ページ) ? `（印字 p.${印字.get(p.物理ページ)}）` : ""}`);
      本文の塊.push(p.本文.replace(/[ \t　]+\n/g, "\n").trimEnd());
    }
  }
  const 本文 = 本文の塊.join("\n");

  const 観点 = 観点ファイル.parse(parse(fs.readFileSync(path.join(DATA, "観点.yaml"), "utf8"))).観点;
  const 品目 = 品目ファイル.parse(parse(fs.readFileSync(path.join(DATA, "品目.yaml"), "utf8")));
  const 群順 = [...new Set(観点.map((k) => k.群))].filter((g) => !群だけ || g === 群だけ);
  const system = 指示文({
    県名: 県.名前,
    許認可名: "産業廃棄物収集運搬業の許可",
    観点: 観点.map((k) => `${k.id}（${k.番号} ${k.表示名}／群：${k.群}）：${k.手引きで探すもの}`).join("\n"),
    品目: [...品目.品目.map((h) => h.id), ...品目.付加区分.map((h) => h.id), "建設系", "建設系以外"].join("、"),
  });

  // 料金の見込み（日本語はおおむね1文字1トークン弱。多めに見る）
  const 見込み入力 = 本文.length + system.length;
  const 見込み =
    (見込み入力 * (まとめて ? 20 : 12.5) + 見込み入力 * (群順.length - 1) * 0.25 + 群順.length * 6000 * 50) / 1_000_000 / (まとめて ? 2 : 1);
  出す(`${県.名前}：${読む文書.length}文書・${本文.length.toLocaleString()}字を、観点の群 ${群順.length}つに分けて読む（${モデル}${まとめて ? "、まとめて送る＝半額" : ""}）`);
  出す(`  料金の見込み：約${見込み.toFixed(2)}ドル`);
  if (見込み > 上限ドル && !args.includes("--かまわない")) 止める(`  見込みが${上限ドル}ドルを超えるので止めた。--かまわない を付けると進む。`);

  鍵を読む();
  const client = new Anthropic();
  const format = zodOutputFormat(返事の形);
  const 群の問い = (群: string) => {
    const ks = 観点.filter((k) => k.群 === 群);
    return `今回は群「${群}」の観点だけを読んでください（${ks.length}つ）。\n${ks
      .map((k) => `- ${k.id}（${k.表示名}）：${k.手引きで探すもの}`)
      .join("\n")}\n結果には、この${ks.length}つの観点を全部、記載あり・なしのどちらかで入れてください。`;
  };
  const params = (群: string) => ({
    model: モデル,
    max_tokens: 16000,
    system: [
      { type: "text" as const, text: system },
      // まとめて送るときは記憶の寿命を1時間にする（Batch は5分を超えることがあるため。公式の勧め）
      {
        type: "text" as const,
        text: `## 手引きの本文\n\n${本文}`,
        cache_control: まとめて ? { type: "ephemeral" as const, ttl: "1h" as const } : { type: "ephemeral" as const },
      },
    ],
    messages: [{ role: "user" as const, content: 群の問い(群) }],
  });

  const 返事たち: { 群: string; 返事: 返事; 使用量: 使用量 }[] = [];
  let 合計ドル = 0;

  if (!まとめて) {
    for (const 群 of 群順) {
      const t0 = Date.now();
      const stream = client.messages.stream({ ...params(群), output_config: { format } });
      const msg = await stream.finalMessage();
      if (!msg.parsed_output) 止める(`  群「${群}」の返事を読み取れなかった（止まった理由：${msg.stop_reason}）`);
      const d = ドル(モデル, msg.usage);
      合計ドル += d;
      返事たち.push({ 群, 返事: msg.parsed_output!, 使用量: msg.usage });
      const あり = msg.parsed_output!.結果.filter((r) => r.記載 === "あり").length;
      出す(`  群「${群}」：記載あり ${あり}／${msg.parsed_output!.結果.length}観点（${Math.round((Date.now() - t0) / 1000)}秒、約${d.toFixed(3)}ドル、記憶から読んだ ${msg.usage.cache_read_input_tokens ?? 0}トークン）`);
    }
  } else {
    // Batch の中は同時に処理されるので、そのままでは記憶（キャッシュ）がほとんど当たらない。
    // 先に1群だけ送って本文を記憶させ、それが終わってから残りの群を送る（残りは記憶から読む）。
    const 送る = async (群たち: string[], 名札: string) => {
      const batch = await client.messages.batches.create({
        requests: 群たち.map((群) => ({
          custom_id: `g${群順.indexOf(群) + 1}`,
          params: { ...params(群), output_config: { format: { type: "json_schema" as const, schema: format.schema } } },
        })),
      });
      出す(`  ${名札}を送った（${群たち.length}群、受付番号 ${batch.id}）。結果を待つ…`);
      let b = batch;
      while (b.processing_status !== "ended") {
        await new Promise((r) => setTimeout(r, 20000));
        b = await client.messages.batches.retrieve(batch.id);
        出す(`  待っている：済み ${b.request_counts.succeeded}・処理中 ${b.request_counts.processing}・失敗 ${b.request_counts.errored}`);
      }
      for await (const r of await client.messages.batches.results(batch.id)) {
        const 群 = 群順[Number(r.custom_id.slice(1)) - 1];
        if (r.result.type !== "succeeded") {
          出す(`  群「${群}」：失敗（${r.result.type}）`);
          continue;
        }
        const msg = r.result.message;
        const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
        const parsed = 返事の形.safeParse(JSON.parse(text));
        if (!parsed.success) {
          出す(`  群「${群}」：返事の形が違った`);
          continue;
        }
        const d = ドル(モデル, msg.usage, true);
        合計ドル += d;
        返事たち.push({ 群, 返事: parsed.data, 使用量: msg.usage });
        出す(
          `  群「${群}」：記載あり ${parsed.data.結果.filter((x) => x.記載 === "あり").length}／${parsed.data.結果.length}観点（約${d.toFixed(3)}ドル、記憶に書いた ${msg.usage.cache_creation_input_tokens ?? 0}・記憶から読んだ ${msg.usage.cache_read_input_tokens ?? 0}トークン）`,
        );
      }
    };
    await 送る(群順.slice(0, 1), "先の1群（本文を記憶させる）");
    if (群順.length > 1) await 送る(群順.slice(1), "残りの群");
  }

  // ---- 手引き.yaml の形にする ----
  const 今日 = 今日の文字();
  const 文書名 = new Set(読む文書.map((f) => f.ファイル名));
  const 記録: 手引きデータ["記録"] = [];
  const 記載なし: 手引きデータ["記載なし"] = [];
  const 観点候補: 手引きデータ["観点候補"] = [];
  const 見た観点 = new Set<string>();
  for (const { 群, 返事 } of 返事たち) {
    for (const r0 of 返事.結果) {
      const id = 観点を合わせる(r0.観点, 観点);
      if (!id) {
        出す(`  群「${群}」：知らない観点の名前「${r0.観点}」が返ってきた。この答えは使わない`);
        continue;
      }
      const r = { ...r0, 観点: id };
      見た観点.add(r.観点);
      const 使える = r.記録.filter((x) => 文書名.has(NFC(x.文書)) && x.引用.trim().length >= 4);
      if (r.記載 === "なし" || 使える.length === 0) {
        記載なし.push({ 観点: r.観点, 探した語: r.探した語.length ? r.探した語 : ["（語の記録なし）"], 探した文書: [...文書名], 確認日: 今日 });
        continue;
      }
      for (const x of 使える) {
        const 引用 = x.引用.replace(/\s+/g, " ").trim().slice(0, 100);
        const id = `${県.コード}-${r.観点}-${ハッシュ(NFC(x.文書) + 引用)}`;
        if (記録.some((e) => e.id === id)) continue;
        記録.push({
          id,
          観点: r.観点,
          主張: x.主張,
          種別: "手引き",
          出典: { 文書: NFC(x.文書), 物理ページ: x.物理ページ, 印字ページ: null, 引用, 照合: "不一致" },
          確認日: 今日,
          対象: x.対象.length ? x.対象 : ["新規", "更新", "変更許可"],
          ...(x.品目.length ? { 品目: x.品目.length === 1 ? x.品目[0] : x.品目 } : {}),
        });
      }
    }
    for (const c of 返事.観点候補) {
      if (観点候補.some((e) => e.名前 === c.名前)) continue;
      観点候補.push({ 名前: c.名前, 主張: c.主張, 文書: NFC(c.文書), 引用: c.引用.slice(0, 100), 物理ページ: c.物理ページ });
    }
  }
  for (const k of 観点.filter((k) => 群順.includes(k.群) && !見た観点.has(k.id))) {
    記載なし.push({ 観点: k.id, 探した語: ["（返事に含まれなかった）"], 探した文書: [...文書名], 確認日: 今日 });
  }

  // 一部の群だけ読み直したときは、ほかの群の記録を前の手引き.yaml から引き継ぐ
  const outDir0 = 公開側フォルダ(県.コード, 県.名前);
  const 前のファイル = path.join(outDir0, "手引き.yaml");
  if (群だけ && fs.existsSync(前のファイル)) {
    const 前 = 手引きファイル.parse(parse(fs.readFileSync(前のファイル, "utf8")));
    const 今回の観点 = new Set(観点.filter((k) => 群順.includes(k.群)).map((k) => k.id));
    記録.push(...前.記録.filter((r) => !今回の観点.has(r.観点)));
    記載なし.push(...前.記載なし.filter((r) => !今回の観点.has(r.観点)));
    for (const c of 前.観点候補) if (!観点候補.some((e) => e.名前 === c.名前)) 観点候補.push(c);
  }

  const data: 手引きデータ = {
    許可権者: { コード: 県.コード, 名前: 県.名前 },
    許認可,
    読んだ日: 今日,
    モデル,
    手引き: 読む文書.map((f) => ({
      文書: f.ファイル名,
      ...(f.名前 ? { 名前: f.名前 } : {}),
      ...(f.役割 ? { 役割: f.役割 } : {}),
      url: f.url,
      版: f.版 ?? null,
      取得日: f.取得日,
      sha256: f.sha256,
      ページ数: f.ページ数 ?? null,
      利用規約: "未確認",
      利用規約確認日: null,
      ページ対応: ページ対応.get(f.ファイル名) ?? [],
    })),
    記録,
    記載なし,
    観点候補,
  };

  // ---- ケンの照合（AI を使わない） ----
  const { 数, 気になる } = 全部照らす(dir, data);
  手引きファイル.parse(data);

  // ---- 前の版を残して、差分を出す ----
  const outDir = 公開側フォルダ(県.コード, 県.名前, true);
  const out = path.join(outDir, "手引き.yaml");
  let 差分: { 観点: string; 変化: string; 前: string[]; 今: string[] }[] = [];
  if (fs.existsSync(out)) {
    fs.copyFileSync(out, `${out}.前`);
    const 前 = 手引きファイル.parse(parse(fs.readFileSync(out, "utf8")));
    const まとめ = (d: 手引きデータ, id: string) => d.記録.filter((r) => r.観点 === id);
    for (const k of 観点.filter((k) => 群順.includes(k.群))) {
      const a = まとめ(前, k.id);
      const b = まとめ(data, k.id);
      const 鍵 = (rs: typeof a) => rs.map((r) => r.出典.引用.replace(/\s/g, "")).sort().join("|");
      if (鍵(a) === 鍵(b)) continue;
      const 変化 = a.length === 0 ? "新しく載った" : b.length === 0 ? "見つからなくなった" : "中身が変わった";
      差分.push({ 観点: k.id, 変化, 前: a.map((r) => r.主張), 今: b.map((r) => r.主張) });
    }
    fs.writeFileSync(
      path.join(dir, "_差分.yaml"),
      stringify({ 日付: 今日, 前に読んだ日: 前.読んだ日 ?? null, 変わった観点: 差分 }, { lineWidth: 0 }),
    );
  }
  fs.writeFileSync(out, stringify(data, { lineWidth: 0 }));

  // 改訂の検知があれば、読み直したので印を付ける（画面の「改訂されたかもしれない」の帯が消える）
  if (!群だけ) {
    const { doc: 出典doc, data: 出典今 } = 出典を読む(dir);
    const 検知 = (出典今.改訂の検知 ?? []).map((x) => (x.読み直し済み ? x : { ...x, 読み直し済み: 今日 }));
    if (検知.length) 出典に書く(dir, 出典doc, { 改訂の検知: 検知 });
  }

  // ---- ログ（手元だけ） ----
  const logDir = path.join(dir, "_ログ");
  fs.mkdirSync(logDir, { recursive: true });
  const 秒 = Math.round((Date.now() - 開始) / 1000);
  fs.writeFileSync(
    path.join(logDir, `読む_${今日}_${Date.now()}.json`),
    JSON.stringify({ 県: 県.名前, モデル, まとめて, 秒, 合計ドル, 返事たち }, null, 1),
  );
  fs.appendFileSync(path.join(ROOT, "手引き", "_料金ログ.txt"), `${今日}\t${県.コード}_${県.名前}\t読む\t${モデル}${まとめて ? "（まとめて）" : ""}\t${合計ドル.toFixed(3)}ドル\t${秒}秒\n`);

  出す();
  出す(`${県.名前}：記録 ${記録.length}件（手引きで埋まった観点 ${new Set(記録.map((r) => r.観点)).size}／${観点.length}）、記載なし ${記載なし.length}、観点候補 ${観点候補.length}`);
  出す(`照合：一致 ${数.一致}　一致（ページ訂正） ${数["一致（ページ訂正）"]}　近似（要目視） ${数["近似（要目視）"]}　不一致 ${数.不一致}`);
  for (const l of 気になる) 出す(l);
  if (差分.length) {
    出す(`前の版から変わった観点（${差分.length}）：`);
    for (const d of 差分) 出す(`  ${d.観点}：${d.変化}`);
  }
  出す(`料金 約${合計ドル.toFixed(3)}ドル（約${Math.round(合計ドル * 150)}円）、かかった時間 ${秒}秒`);
  出す(`書いた：${NFC(path.relative(ROOT, out))}`);
}

main().catch((e) => {
  console.error(`読むのに失敗した：${String(e instanceof Error ? e.message : e).replace(/sk-ant-[A-Za-z0-9_-]+/g, "（鍵）")}`);
  process.exit(1);
});

// npm run 拾い直す -- <県コード | 全部> [--書く]
// 読んだときのログ（手引き/<県>/_ログ/読む_*.json）から、観点の名前が決まりどおりでなかったために捨てていた答えを拾い直す。
// Claude は呼ばない（料金はかからない）。触るのは「（返事に含まれなかった）」の記載なしだけで、人が直した記録には触らない。
// 拾った記録は、ほかと同じくプログラムで引用を照合する。--書く を付けないときは、数を出すだけで書き込まない。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse, stringify } from "yaml";
import { 観点ファイル, 手引きファイル, type 手引きデータ } from "../../schema/record.ts";
import { DATA, 出す, 止める, 県一覧, 手引きフォルダ, 公開側フォルダ, NFC, 観点を合わせる, 今日の文字 } from "./kyotsu.ts";
import { 全部照らす } from "./shogo.ts";

const ハッシュ = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
const 印 = "（返事に含まれなかった）";

type ログの答え = {
  観点: string;
  記載: "あり" | "なし";
  記録: { 主張: string; 文書: string; 物理ページ: number; 引用: string; 対象: string[]; 品目: string[] }[];
  探した語: string[];
};

const args = process.argv.slice(2);
const 書く = args.includes("--書く");
const 対象 = args.find((a) => !a.startsWith("--"));
if (!対象) 止める("県コードか「全部」を付けてください（例 npm run 拾い直す -- 30）");

const 観点 = 観点ファイル.parse(parse(fs.readFileSync(path.join(DATA, "観点.yaml"), "utf8"))).観点;
const 県たち = 対象 === "全部" ? 県一覧 : 県一覧.filter((k) => k.コード === 対象.padStart(2, "0"));
if (!県たち.length) 止める(`県コード ${対象} が見つからない`);

let 合計 = { 観点: 0, 記録: 0, なし: 0 };
for (const 県 of 県たち) {
  const f = path.join(公開側フォルダ(県.コード, 県.名前), "手引き.yaml");
  if (!fs.existsSync(f)) continue;
  const dir = 手引きフォルダ(県.コード, 県.名前);
  const logDir = path.join(dir, "_ログ");
  if (!fs.existsSync(logDir)) continue;
  const data: 手引きデータ = 手引きファイル.parse(parse(fs.readFileSync(f, "utf8")));
  const 拾う観点 = new Set(data.記載なし.filter((n) => n.探した語.includes(印)).map((n) => n.観点));
  if (!拾う観点.size) continue;

  // 新しいログから順に見て、観点ごとに最初に見つかった答えを使う
  const ログ = fs
    .readdirSync(logDir)
    .filter((x) => /^読む_.*\.json$/.test(x))
    .sort()
    .reverse();
  const 答え = new Map<string, ログの答え>();
  for (const l of ログ) {
    const j = JSON.parse(fs.readFileSync(path.join(logDir, l), "utf8")) as { 返事たち: { 返事: { 結果: ログの答え[] } }[] };
    for (const g of j.返事たち) {
      for (const r of g.返事.結果) {
        const id = 観点を合わせる(r.観点, 観点);
        if (id && 拾う観点.has(id) && !答え.has(id)) 答え.set(id, r);
      }
    }
  }
  if (!答え.size) continue;

  const 文書名 = new Set(data.手引き.map((d) => NFC(d.文書)));
  // 答えを読んだのは読んだ日。拾い直した今日ではない
  const 確認日: string = data.読んだ日 ?? data.記載なし.find((n) => n.探した語.includes(印))?.確認日 ?? 今日の文字();
  let 足した記録 = 0;
  let なし = 0;
  for (const [id, r] of 答え) {
    data.記載なし = data.記載なし.filter((n) => !(n.観点 === id && n.探した語.includes(印)));
    const 使える = r.記録.filter((x) => 文書名.has(NFC(x.文書)) && x.引用.trim().length >= 4);
    if (r.記載 === "なし" || 使える.length === 0) {
      data.記載なし.push({ 観点: id, 探した語: r.探した語.length ? r.探した語 : ["（語の記録なし）"], 探した文書: [...文書名], 確認日 });
      なし++;
      continue;
    }
    for (const x of 使える) {
      const 引用 = x.引用.replace(/\s+/g, " ").trim().slice(0, 100);
      const rid = `${県.コード}-${id}-${ハッシュ(NFC(x.文書) + 引用)}`;
      if (data.記録.some((e) => e.id === rid)) continue;
      data.記録.push({
        id: rid,
        観点: id,
        主張: x.主張,
        種別: "手引き",
        出典: { 文書: NFC(x.文書), 物理ページ: x.物理ページ, 印字ページ: null, 引用, 照合: "不一致" },
        確認日,
        対象: (x.対象.length ? x.対象 : ["新規", "更新", "変更許可"]) as 手引きデータ["記録"][number]["対象"],
        ...(x.品目.length ? { 品目: x.品目.length === 1 ? x.品目[0] : x.品目 } : {}),
      });
      足した記録++;
    }
  }
  // 観点.yaml の並びにそろえる
  const 順 = new Map(観点.map((k, i) => [k.id, i]));
  data.記載なし.sort((a, b) => (順.get(a.観点) ?? 99) - (順.get(b.観点) ?? 99));

  const { 数, 気になる } = 全部照らす(dir, data);
  手引きファイル.parse(data);
  const 残り = data.記載なし.filter((n) => n.探した語.includes(印)).length;
  出す(
    `${県.名前}：拾えた観点 ${答え.size}／${拾う観点.size}（記録 +${足した記録}、本当に記載なし ${なし}、まだ答えが無い ${残り}）　照合：一致 ${数.一致 + 数["一致（ページ訂正）"]}　近似 ${数["近似（要目視）"]}　不一致 ${数.不一致}`,
  );
  for (const l of 気になる) 出す(l);
  合計 = { 観点: 合計.観点 + 答え.size, 記録: 合計.記録 + 足した記録, なし: 合計.なし + なし };
  if (書く) {
    fs.copyFileSync(f, `${f}.前`);
    fs.writeFileSync(f, stringify(data, { lineWidth: 0 }));
  }
}
出す();
出す(`合計：拾えた観点 ${合計.観点}、足した記録 ${合計.記録}、本当に記載なし ${合計.なし}${書く ? "。書き込んだ" : "。まだ書き込んでいない（--書く で書き込む）"}`);

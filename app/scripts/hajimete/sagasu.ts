// npm run 探す -- "<許認可名>" "<自治体名>" [--ドメイン www.city.example.lg.jp]
// はじめての許認可・自治体で、公式の手引き・案内ページ・様式を Claude の web 検索で探し、取ってくる。
//   1. 自治体の公式サイトのドメインを確かめる（--ドメイン で直接渡してもよい）
//   2. そのドメインと go.jp だけに絞って web 検索し、手引き・案内ページの候補を出させる
//   3. 候補のうち公的なドメイン（lg.jp・go.jp・自治体の地域型ドメイン）のものだけ取ってくる。
//      案内ページ（HTML）に手引きらしい文書へのリンクがあれば、それも少しだけ取る
//   4. 文字にする（PDF はページごと、HTML は1ページ）
// 置き場は 手引き/_はじめて/<許認可>_<自治体>/（本体と txt/ はリポジトリに入れない）。
// ボット対策（断られた・確認画面が出た）は回避しない。取れなかったと正直に書いて、手で保存してもらう。
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { stringify } from "yaml";
import { ROOT, NFC, 出す, 止める, 今日の文字, sha256, ドル, 鍵を読む, type 使用量 } from "../tebiki/kyotsu.ts";
import { 入口の一覧 } from "../tebiki/shutoku.ts";
import {
  idを作る,
  手元フォルダ,
  公的なドメインか,
  公的なURLか,
  形式を見る,
  文字にする,
  秒,
  type はじめての出典,
} from "./kyotsu.ts";

const UA = "Mozilla/5.0 (Macintosh) kyoninka-local-rules/0.1 (gyoseishoshi research; contact via site)";
const ドメインを聞くモデル = "claude-haiku-5-5";
const 探すモデル = "claude-opus-5-5";
const 検索1回 = 0.01; // web 検索は 1,000 回で 10 ドル
const 取る上限 = 8; // 1つの許認可で取ってくるファイルの数の上限
const 大きさ上限 = 30 * 1024 * 1024;

const args = process.argv.slice(2);
const 引数 = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--ドメイン"));
const [許認可名, 自治体名] = 引数;
if (!許認可名 || !自治体名) 止める('使い方：npm run 探す -- "<許認可名>" "<自治体名>"（例：npm run 探す -- "建設業許可" "和歌山県"）');
const 渡されたドメイン = args.includes("--ドメイン") ? args[args.indexOf("--ドメイン") + 1] : null;

type 結果のURL = { url: string; title: string };

/** 返事の中の web 検索の結果（URL と題名）と、検索語を集める */
function 検索の中身(content: Anthropic.ContentBlock[]) {
  const urls: 結果のURL[] = [];
  const 語: string[] = [];
  for (const b of content) {
    if (b.type === "server_tool_use" && b.name === "web_search") {
      const q = (b.input as { query?: string })?.query;
      if (q) 語.push(q);
    }
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === "web_search_result") urls.push({ url: r.url, title: r.title });
    }
  }
  return { urls, 語 };
}

function 文字だけ(content: Anthropic.ContentBlock[]) {
  return content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** 返事の最後にある JSON を取り出す */
function JSONを拾う<T>(text: string): T | null {
  const 囲み = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const 候補 = [...囲み.reverse(), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of 候補) {
    try {
      return JSON.parse(c) as T;
    } catch {
      continue;
    }
  }
  return null;
}

/** web 検索つきで1回聞く。pause_turn なら続きを頼む（3回まで） */
async function 検索つきで聞く(client: Anthropic, model: string, system: string, 問い: string, tool: Anthropic.WebSearchTool20250305) {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: 問い }];
  const 全部: Anthropic.ContentBlock[] = [];
  let 費用 = 0;
  let 検索回数 = 0;
  for (let i = 0; i < 4; i++) {
    const msg = await client.messages.create({ model, max_tokens: 4000, system, messages, tools: [tool] });
    全部.push(...msg.content);
    費用 += ドル(model, msg.usage as 使用量);
    const n = msg.usage.server_tool_use?.web_search_requests ?? 0;
    検索回数 += n;
    費用 += n * 検索1回;
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  return { 全部, 費用, 検索回数 };
}

// ---------------- robots.txt（入ってはいけないと書かれた所は取らない） ----------------
const robotsの控え = new Map<string, string[]>();
async function robotsで止められているか(url: string) {
  const u = new URL(url);
  if (!robotsの控え.has(u.origin)) {
    let 禁止: string[] = [];
    try {
      const res = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (res.ok) {
        let 当てはまる = false;
        for (const 行 of (await res.text()).split(/\r?\n/)) {
          const [k, ...v] = 行.replace(/#.*/, "").split(":");
          const 値 = v.join(":").trim();
          if (/^user-agent$/i.test(k.trim())) 当てはまる = 値 === "*";
          else if (当てはまる && /^disallow$/i.test(k.trim()) && 値) 禁止.push(値);
        }
      }
    } catch {
      禁止 = [];
    }
    robotsの控え.set(u.origin, 禁止);
  }
  return robotsの控え.get(u.origin)!.some((p) => u.pathname.startsWith(p));
}

// ---------------- 取ってくる ----------------
function 保存名(url: string, html: boolean, 使った: Set<string>) {
  const u = new URL(url);
  let base = NFC(decodeURIComponent(path.basename(u.pathname) || "index"));
  if (html) {
    const 道 = NFC(decodeURIComponent(u.pathname)).replace(/^\/+|\/+$/g, "").replace(/\.(html?|php|aspx?|jsp)$/i, "");
    base = `${u.hostname}_${道.replace(/[\/\\:*?"<>|]+/g, "_") || "index"}`.slice(0, 120) + ".html";
  }
  base = base.replace(/[\/\\:*?"<>|]+/g, "_");
  let 名 = base;
  for (let i = 2; 使った.has(名); i++) 名 = base.replace(/(\.[^.]+)?$/, `_${i}$1`);
  使った.add(名);
  return 名;
}

async function 取る(url: string, dir: string, 使った: Set<string>) {
  if (await robotsで止められているか(url)) throw new Error("robots.txt で機械による取得が断られている。手で開いて保存してほしい");
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if ([401, 403, 429, 503].includes(res.status))
    throw new Error(`サイトに断られた（${res.status}）。ボット対策の可能性があるので回避しない。手で開いて保存してほしい`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (!公的なURLか(res.url)) throw new Error(`転送先が公的なドメインではない（${new URL(res.url).hostname}）ので取らない`);
  const 長さ = Number(res.headers.get("content-length") ?? 0);
  if (長さ > 大きさ上限) throw new Error(`大きすぎる（${Math.round(長さ / 1024 / 1024)}MB）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 大きさ上限) throw new Error(`大きすぎる（${Math.round(buf.length / 1024 / 1024)}MB）`);
  const type = res.headers.get("content-type") ?? "";
  const html = /text\/html|application\/xhtml/i.test(type) || (!/pdf|word|excel|spreadsheet|officedocument|octet/i.test(type) && /<html/i.test(buf.subarray(0, 2000).toString("latin1")));
  if (html && /captcha|challenge-platform|cf-chl|あなたはロボットではありません|アクセスが集中/i.test(buf.subarray(0, 20000).toString("utf8")))
    throw new Error("確認画面（ボット対策）が出た。回避しない。手で開いて保存してほしい");
  const ファイル名 = 保存名(res.url, html, 使った);
  fs.writeFileSync(path.join(dir, ファイル名), buf);
  return { ファイル名, 最終更新: res.headers.get("last-modified"), サイズ: buf.length, 最終URL: res.url, html };
}

const 手引きらしい = /手引|てびき|案内|要領|手続|ガイド|マニュアル|の流れ|申請方法|申請の方法|必要書類|提出書類|Q&A|Ｑ＆Ａ|よくある/;

async function main() {
  const 開始 = Date.now();
  const id = idを作る(許認可名, 自治体名);
  const dir = 手元フォルダ(id, true);
  const 今日 = 今日の文字();
  出す(`${自治体名}の${許認可名}：公式の手引き・案内ページを探す（置き場 ${NFC(path.relative(ROOT, dir))}）`);

  鍵を読む();
  const client = new Anthropic();
  const 場所 = { type: "approximate" as const, country: "JP", timezone: "Asia/Tokyo" };
  let 費用 = 0;
  const 検索語: string[] = [];

  // ---- 1. 自治体の公式サイトのドメイン ----
  let ドメイン: string | null = 渡されたドメイン ? 渡されたドメイン.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase() : null;
  if (ドメイン && !公的なドメインか(ドメイン)) 止める(`--ドメイン「${ドメイン}」は公的なドメイン（lg.jp・go.jp・自治体の地域型ドメイン）ではない`);
  if (!ドメイン) {
    const r = await 検索つきで聞く(
      client,
      ドメインを聞くモデル,
      "あなたは日本の自治体の公式ウェブサイトを確かめる係です。検索して、公式サイトのホスト名だけを答えます。",
      `「${自治体名}」の公式ウェブサイトのホスト名（例：www.pref.wakayama.lg.jp、www.city.wakayama.wakayama.jp）を検索で確かめ、最後に JSON で {"ホスト名": "..."} とだけ答えてください。分からなければ {"ホスト名": null}。`,
      { type: "web_search_20250305", name: "web_search", max_uses: 2, user_location: 場所 },
    );
    費用 += r.費用;
    const { urls, 語 } = 検索の中身(r.全部);
    検索語.push(...語);
    const 答え = JSONを拾う<{ ホスト名: string | null }>(文字だけ(r.全部))?.ホスト名?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") ?? null;
    // 答えが公的なドメインで、しかも検索結果に実際に出てきたものだけを信じる
    const 出てきた = new Set(urls.map((u) => new URL(u.url).hostname.toLowerCase()));
    if (答え && 公的なドメインか(答え) && (出てきた.has(答え) || [...出てきた].some((h) => h.endsWith(答え.replace(/^www\./, ""))))) ドメイン = 答え;
    出す(ドメイン ? `  公式サイト：${ドメイン}（検索 ${r.検索回数}回、約${r.費用.toFixed(3)}ドル）` : "  公式サイトのドメインを確かめられなかった。lg.jp と go.jp 全体から探す");
  }
  const 絞り = ドメイン ? [ドメイン.replace(/^www\./, ""), "go.jp"] : ["lg.jp", "go.jp"];

  // ---- 2. 手引き・案内ページを探す ----
  const system = `あなたは行政書士の調べものを手伝う係です。日本の自治体の公式サイトから、許認可の手引き・案内ページ・様式の URL を探します。
- 検索結果に実際に出てきた URL だけを答えます。URL を推測で作りません。
- 公式サイト（${絞り.join("・")}）以外の URL は答えません。行政書士事務所・民間のまとめサイトは使いません。
- 見つからなければ、見つからなかったと正直に書きます。`;
  const 問い = `「${自治体名}」の「${許認可名}」について、申請する人向けの公式の資料を探してください。
欲しいもの（重要な順）：
1. 手引き・申請の手引き・要領（PDF のことが多い）
2. 手続きの案内ページ（HTML。提出先・持ち物・手数料・受付時間などが書かれたページ）
3. 様式・申請書のダウンロードページ
${自治体名}以外の自治体の資料は入れないでください（国の資料は、自治体の資料が見つからないときだけ）。
最後に、次の形の JSON だけを \`\`\`json で囲んで答えてください。候補は多くて6件。
{"候補": [{"url": "...", "名前": "資料やページの名前", "役割": "手引き|案内ページ|様式|その他", "理由": "なぜこれを選んだか（20字程度）"}], "見つからなかったこと": "探したが見つからなかったもの。なければ null"}`;
  const r = await 検索つきで聞く(client, 探すモデル, system, 問い, {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 5,
    allowed_domains: 絞り,
    user_location: 場所,
  });
  費用 += r.費用;
  const { urls, 語 } = 検索の中身(r.全部);
  検索語.push(...語);
  const 返事 = JSONを拾う<{ 候補?: { url: string; 名前?: string; 役割?: string; 理由?: string }[]; 見つからなかったこと?: string | null }>(文字だけ(r.全部));
  const 取れなかった: はじめての出典["取れなかった"] = [];
  const 出てきたURL = new Set(urls.map((u) => u.url));
  const 候補: はじめての出典["候補"] = [];
  for (const c of 返事?.候補 ?? []) {
    if (!c?.url) continue;
    if (!公的なURLか(c.url)) {
      取れなかった.push({ url: c.url, 理由: "公的なドメインではないので外した" });
      continue;
    }
    if (!出てきたURL.has(c.url)) 出す(`  （注）検索結果に無い URL を答えてきた：${c.url}。取れるかどうかで確かめる`);
    if (!候補.some((x) => x.url === c.url)) 候補.push(c);
  }
  const 探す秒 = 秒(Date.now() - 開始);
  出す(`  検索 ${r.検索回数}回（語：${語.join("／") || "なし"}）、候補 ${候補.length}件、約${r.費用.toFixed(3)}ドル、${探す秒}秒`);
  if (!返事) 出す("  返事から候補の一覧を読み取れなかった");
  for (const c of 候補) 出す(`    ${c.役割 ?? "?"}：${c.名前 ?? ""}　${c.url}`);

  // ---- 3. 取ってくる ----
  const t取得 = Date.now();
  const 使った = new Set<string>(fs.readdirSync(dir).map(NFC));
  for (const f of fs.readdirSync(dir)) if (!f.startsWith("_") && fs.statSync(path.join(dir, f)).isFile()) fs.rmSync(path.join(dir, f)); // 前回の取得物は入れ替える
  使った.clear();
  fs.rmSync(path.join(dir, "txt"), { recursive: true, force: true });
  const ファイル: はじめての出典["ファイル"] = [];
  const 取る一覧 = [...候補];
  for (let i = 0; i < 取る一覧.length && ファイル.length < 取る上限; i++) {
    const c = 取る一覧[i];
    try {
      const g = await 取る(c.url, dir, 使った);
      const ページ数 = 文字にする(dir, g.ファイル名);
      ファイル.push({
        ファイル名: g.ファイル名,
        ...(c.名前 ? { 名前: c.名前 } : {}),
        ...(c.役割 ? { 役割: c.役割 } : {}),
        形式: 形式を見る(g.ファイル名),
        url: g.最終URL,
        sha256: sha256(path.join(dir, g.ファイル名)),
        取得日: 今日,
        サイズ: g.サイズ,
        最終更新: g.最終更新,
        ページ数,
      });
      出す(`  取得：${g.ファイル名}（${Math.round(g.サイズ / 1024)}KB、${ページ数 ? `${ページ数}ページを文字にした` : "文字にできなかった"}）`);
      // 案内ページに、手引きらしい文書へのリンクがあれば足す（同じ公的なドメインのものだけ）
      if (g.html && c.役割 !== "様式") {
        try {
          const リンク = await 入口の一覧(g.最終URL);
          for (const l of リンク) {
            if (!公的なURLか(l.url) || 取る一覧.some((x) => x.url === l.url)) continue;
            if (!手引きらしい.test(l.名前) || /様式|記入例|記載例/.test(l.名前)) continue;
            if (取る一覧.length >= 候補.length + 4) break;
            取る一覧.push({ url: l.url, 名前: l.名前, 役割: "手引き", 理由: `案内ページ（${g.ファイル名}）のリンクから` });
            出す(`    案内ページのリンクから足す：${l.名前}`);
          }
        } catch {
          // リンクを見られなくても、ページそのものは取れている
        }
      }
    } catch (e) {
      取れなかった.push({ url: c.url, 理由: (e as Error).message });
      出す(`  取れなかった：${c.url}（${(e as Error).message}）`);
    }
  }
  const 取得秒 = 秒(Date.now() - t取得);
  if (ファイル.length === 0) 出す("  公式の資料を一つも取れなかった。上の理由を見て、手で保存するか、許認可名・自治体名を変えて探し直してほしい");

  const 出典: はじめての出典 = {
    id,
    許認可名,
    自治体名,
    自治体ドメイン: ドメイン,
    探した日: 今日,
    検索語,
    候補,
    ファイル,
    取れなかった,
    見つからなかったこと: 返事?.見つからなかったこと ?? (候補.length ? null : "公式サイトで手引き・案内ページを見つけられなかった"),
    時間: { 探す: 探す秒, 取得: 取得秒 },
    費用: { 探す: Math.round(費用 * 10000) / 10000 },
  };
  fs.writeFileSync(path.join(dir, "_出典.yaml"), stringify(出典, { lineWidth: 0 }));
  fs.mkdirSync(path.join(dir, "_ログ"), { recursive: true });
  fs.writeFileSync(path.join(dir, "_ログ", `探す_${今日}_${Date.now()}.json`), JSON.stringify({ 検索語, 結果: urls, 返事: 文字だけ(r.全部) }, null, 1));
  fs.appendFileSync(path.join(ROOT, "手引き", "_料金ログ.txt"), `${今日}\t${id}\t探す\t${探すモデル}\t${費用.toFixed(3)}ドル\t${探す秒 + 取得秒}秒\n`);

  出す();
  出す(`${id}：取れた資料 ${ファイル.length}件、取れなかった ${取れなかった.length}件。探す ${探す秒}秒・取得 ${取得秒}秒、費用 約${費用.toFixed(3)}ドル`);
  if (ファイル.length) 出す(`次：npm run はじめて読む -- ${id}`);
}

main().catch((e) => {
  console.error(`探すのに失敗した：${String(e instanceof Error ? e.message : e).replace(/sk-ant-[A-Za-z0-9_-]+/g, "（鍵）")}`);
  process.exit(1);
});

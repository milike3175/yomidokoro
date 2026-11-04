// npm run 取得 -- <県コード>
// 公式URLから手引き・記載例・書類一覧を 手引き/<コード>_<県名>/ に取ってきて、_出典.yaml に
// sha256・取得日・URL・サイズ・最終更新（Last-Modified）を書く。すでに手元にあるファイルも登録する。
// そのあと txt/ に文字にする（ページ番号を保つ）。本体と txt/ は .gitignore 済み。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  APP,
  ROOT,
  NFC,
  出す,
  止める,
  今日の文字,
  sha256,
  県を探す,
  手引きフォルダ,
  出典を読む,
  出典に書く,
  文書を引く,
  URLの名前,
  type ファイル記録,
  type 出典,
} from "./kyotsu.ts";

const UA = "Mozilla/5.0 (Macintosh) yomidokoro/0.1 (gyoseishoshi research; contact via site)";
const 文書の拡張子 = /\.(pdf|docx?|xlsx?|zip|rtf)$/i;
// 拡張子の無い URL（東京都の .../01_xxx-pdf など）。リンクの文字の「（PDF：1,662KB）」や、応答の中身で形式を決める
const 文字の形式 = /(PDF|ＰＤＦ|ワード|Word|エクセル|Excel)\s*[：:（(]?\s*[\d,，.]+\s*[KMＫＭ]?B/i;
const 文書置き場らしい = /\/(documents?|files?|attach(ment)?s?|uploads?|material)\//i;

/** 応答の Content-Type と先頭のバイトから、文書の形式（拡張子）を決める。文書でなければ null */
export function 形式を見る(contentType: string | null, 先頭: Buffer): string | null {
  const ct = (contentType ?? "").toLowerCase();
  if (先頭.subarray(0, 5).toString("latin1") === "%PDF-" || ct.includes("application/pdf")) return "pdf";
  if (ct.includes("wordprocessingml")) return "docx";
  if (ct.includes("spreadsheetml")) return "xlsx";
  if (ct.includes("msword")) return "doc";
  if (ct.includes("ms-excel")) return "xls";
  if (ct.includes("rtf") || 先頭.subarray(0, 5).toString("latin1") === "{\\rtf") return "rtf";
  if (先頭[0] === 0x50 && 先頭[1] === 0x4b) {
    const s = 先頭.toString("latin1");
    if (s.includes("word/")) return "docx";
    if (s.includes("xl/")) return "xlsx";
    return ct.includes("zip") ? "zip" : null;
  }
  return null;
}

/** URL から手元に置くファイル名を決める。拡張子が無ければ形式を足す（末尾の -pdf などは外す） */
export function 置く名前(url: string, 形式: string | null) {
  const n = URLの名前(url);
  if (文書の拡張子.test(n) || !形式) return n;
  return `${n.replace(/[-_.](pdf|docx?|xlsx?|rtf|zip)$/i, "")}.${形式}`;
}

/** _出典.yaml に 取り寄せ が無いとき、_出典候補 の表から、その県の行にある文書の URL を拾う */
export function 候補表から拾う(県名: string): string[] {
  const urls = new Set<string>();
  for (const f of fs.readdirSync(path.join(ROOT, "手引き")).filter((n) => NFC(n).startsWith("_出典候補"))) {
    const text = NFC(fs.readFileSync(path.join(ROOT, "手引き", f), "utf8"));
    for (const line of text.split("\n")) {
      if (!line.includes(県名)) continue;
      for (const m of line.matchAll(/https?:\/\/[^\s）)|]+/g)) {
        const u = m[0].replace(/[。、]$/, "");
        if (u.includes("...")) continue; // 省略して書かれた URL は使わない
        if (文書の拡張子.test(new URL(u).pathname) || /[-_](pdf|docx?|xlsx?)$/i.test(new URL(u).pathname)) urls.add(u);
      }
    }
  }
  return [...urls];
}

/** 保存先がフォルダなら、URL と中身の形式からファイル名を決めてそこに置く */
export async function 取ってくる(url: string, 保存先: string, フォルダに置く = false) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const 形式 = 形式を見る(res.headers.get("content-type"), buf.subarray(0, 4096));
  const ファイル名 = 置く名前(url, 形式);
  const 置き場 = フォルダに置く ? path.join(保存先, ファイル名) : 保存先;
  fs.writeFileSync(置き場, buf);
  return { 最終更新: res.headers.get("last-modified"), サイズ: buf.length, ファイル名, 形式 };
}

/** 拡張子の無いリンクが文書かどうかを、HEAD（だめなら先頭だけの GET）で確かめる */
async function 文書か確かめる(url: string): Promise<string | null> {
  try {
    let res = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" });
    if (res.ok) {
      const f = 形式を見る(res.headers.get("content-type"), Buffer.alloc(0));
      if (f) return f;
    }
    res = await fetch(url, { headers: { "User-Agent": UA, Range: "bytes=0-4095" }, redirect: "follow" });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type");
    if ((ct ?? "").toLowerCase().includes("text/html")) {
      await res.body?.cancel();
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 4096);
    return 形式を見る(ct, buf);
  } catch {
    return null;
  }
}

/** 入口ページ（HTML）に載っている文書へのリンクの一覧 */
export async function 入口の一覧(入口: string) {
  const res = await fetch(入口, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`入口ページ ${res.status}`);
  const html = await res.text();
  const リンク: { 名前: string; url: string }[] = [];
  const 確かめる候補: { 名前: string; url: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: string;
    try {
      u = new URL(m[1].replace(/&amp;/g, "&"), 入口).toString();
    } catch {
      continue;
    }
    const 名前 = NFC(m[2].replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim());
    const 文書らしい = 文書の拡張子.test(new URL(u).pathname) || /download|kantan|downloadForm/i.test(u);
    if (文書らしい) {
      if (!リンク.some((x) => x.url === u)) リンク.push({ 名前: 名前 || path.basename(u), url: u });
      continue;
    }
    // 拡張子の無いリンク：リンクの文字に「PDF：○KB」などがあるか、文書の置き場らしい道で、中身が文書なら拾う
    const 最後 = path.basename(new URL(u).pathname);
    if (最後.includes(".") || new URL(u).host !== new URL(入口).host) continue;
    if (文字の形式.test(名前) || 文書置き場らしい.test(new URL(u).pathname)) {
      const 鍵 = u.split("#")[0];
      if (!確かめる候補.some((x) => x.url === 鍵)) 確かめる候補.push({ 名前: 名前 || 最後, url: 鍵 });
    }
  }
  // 中身を確かめるのは多くても60本まで（相手のサイトに負担をかけない）
  for (const c of 確かめる候補.slice(0, 60)) {
    if (リンク.some((x) => x.url === c.url)) continue;
    if (await 文書か確かめる(c.url)) リンク.push(c);
  }
  return リンク;
}

export function 文字にする(dir: string, ファイル名: string): number | null {
  const txtDir = path.join(dir, "txt");
  fs.mkdirSync(txtDir, { recursive: true });
  const out = execFileSync("python3", [path.join(APP, "scripts", "tebiki", "to_text.py"), path.join(dir, ファイル名), path.join(txtDir, `${ファイル名}.txt`)], {
    encoding: "utf8",
  });
  const n = Number(/ページ数 (\d+)/.exec(out)?.[1] ?? 0);
  if (n === 0 && fs.existsSync(path.join(txtDir, `${ファイル名}.txt`))) fs.rmSync(path.join(txtDir, `${ファイル名}.txt`));
  return n || null;
}

export function 手元のファイル(dir: string) {
  return fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith(".") && !n.startsWith("_") && fs.statSync(path.join(dir, n)).isFile())
    .map(NFC)
    .sort();
}

async function main() {
  const 県 = 県を探す(process.argv[2]);
  const dir = 手引きフォルダ(県.コード, 県.名前, true);
  const { doc, data } = 出典を読む(dir);
  const 今日 = 今日の文字();
  出す(`${県.名前}：手引きを取ってくる（置き場 ${NFC(path.relative(ROOT, dir))}）`);

  if (!data.許可権者) doc.set("許可権者", doc.createNode({ コード: 県.コード, 名前: 県.名前 }));
  if (!data.取り寄せ?.length) {
    const urls = 候補表から拾う(県.名前);
    if (urls.length) {
      出す(`  _出典.yaml に 取り寄せ が無いので、出典候補の表から ${urls.length} 本の URL を拾った`);
      data.取り寄せ = urls.map((url) => ({ url }));
      doc.set("取り寄せ", doc.createNode(data.取り寄せ));
    }
  }

  const 前 = new Map((data.ファイル ?? []).map((f) => [NFC(f.ファイル名), f]));
  const ファイル: ファイル記録[] = [];

  // 1. 公式URLから取ってくる
  for (const t of data.取り寄せ ?? []) {
    try {
      const r = await 取ってくる(t.url, dir, true);
      const ファイル名 = r.ファイル名;
      出す(`  取得：${ファイル名}（${Math.round(r.サイズ / 1024)}KB、最終更新 ${r.最終更新 ?? "不明"}${r.形式 ? `、中身は ${r.形式}` : ""}）`);
      前.set(ファイル名, { ...(前.get(ファイル名) ?? {}), ファイル名, url: t.url, 取得日: 今日, サイズ: r.サイズ, 最終更新: r.最終更新, sha256: "" } as ファイル記録);
    } catch (e) {
      出す(`  取得できなかった：${t.url}（${(e as Error).message}）`);
    }
  }

  // 2. 手元にあるファイルを全部登録する（人がダウンロードしたものも）
  for (const ファイル名 of 手元のファイル(dir)) {
    const p = path.join(dir, ファイル名);
    const old = 前.get(ファイル名);
    const 引き = 文書を引く(data, ファイル名);
    const 指紋 = sha256(p);
    const 文字にした = path.join(dir, "txt", `${ファイル名}.txt`);
    let ページ数 = old?.ページ数 ?? null;
    let 文字にした日 = old?.文字にした日;
    if (!fs.existsSync(文字にした) || old?.sha256 !== 指紋) {
      ページ数 = 文字にする(dir, ファイル名);
      文字にした日 = 今日;
    }
    ファイル.push({
      ファイル名,
      ...(引き.名前 ? { 名前: 引き.名前 } : {}),
      ...(引き.役割 ? { 役割: 引き.役割 } : {}),
      ...(引き.版 ? { 版: 引き.版 } : {}),
      url: old?.url ?? null,
      sha256: 指紋,
      取得日: old?.取得日 || 今日,
      サイズ: fs.statSync(p).size,
      最終更新: old?.最終更新 ?? null,
      ページ数,
      ...(文字にした日 ? { 文字にした日 } : {}),
    });
    出す(`  登録：${ファイル名}　${ページ数 ? `${ページ数}ページを文字にした` : "文字にできない形式"}　sha256 ${指紋.slice(0, 12)}…`);
  }

  // 3. 入口ページの文書の一覧（改訂の検知の基準）
  let 入口の文書一覧: 出典["入口の文書一覧"];
  if (data.入口) {
    try {
      const リンク = await 入口の一覧(data.入口);
      入口の文書一覧 = { 確認日: 今日, リンク };
      出す(`  入口ページの文書へのリンク：${リンク.length}本を控えた`);
    } catch (e) {
      出す(`  入口ページを開けなかった：${(e as Error).message}`);
    }
  }

  出典に書く(dir, doc, { ファイル, ...(入口の文書一覧 ? { 入口の文書一覧 } : {}), 鮮度確認日: 今日 });
  出す(`${県.名前}：${ファイル.length}ファイルを _出典.yaml に登録した`);
}

if (import.meta.main) main();

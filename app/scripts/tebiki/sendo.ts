// npm run 鮮度 -- [県コード|全部] [--フォルダ <写しのフォルダ>]
// 手引きが改訂されていないかを確かめる。登録済みのファイルは書き換えない（見つけて知らせるだけ）。
// 比べるもの
//   - 公式URLのあるファイル：取り直して sha256 と Last-Modified を比べる
//   - 人がダウンロードしたファイル：手元のファイルの sha256 が登録と同じか。増えた・無くなったファイル
//   - 入口ページ：載っている文書へのリンクの増減。版の書き換え（R7→R8 など）
// 変わっていれば _出典.yaml の 改訂の検知 に、日付・文書・何が変わったかを足す。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ROOT,
  NFC,
  出す,
  止める,
  今日の文字,
  sha256,
  県一覧,
  県を探す,
  手引きフォルダ,
  手引きの置き場,
  出典を読む,
  出典に書く,
  版を外す,
} from "./kyotsu.ts";
import { 取ってくる, 入口の一覧, 手元のファイル } from "./shutoku.ts";

async function 一県(コード: string, 名前: string, dir: string) {
  const { doc, data } = 出典を読む(dir);
  const 今日 = 今日の文字();
  const 内容: string[] = [];
  const 文書 = new Set<string>();
  出す(`${名前}：改訂されていないか確かめる（${NFC(path.relative(ROOT, dir)) || dir}）`);

  const 登録 = new Map((data.ファイル ?? []).map((f) => [NFC(f.ファイル名), f]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sendo-"));
  try {
    // 1. 公式URLのあるファイルは取り直す
    for (const f of 登録.values()) {
      if (!f.url) continue;
      try {
        const p = path.join(tmp, "x");
        const r = await 取ってくる(f.url, p);
        const 指紋 = sha256(p);
        if (指紋 !== f.sha256) {
          内容.push(`${f.ファイル名}：公式URLのファイルの中身が変わった（sha256 が違う）`);
          文書.add(f.ファイル名);
        }
        if (r.最終更新 && f.最終更新 && r.最終更新 !== f.最終更新) {
          内容.push(`${f.ファイル名}：最終更新が ${f.最終更新} から ${r.最終更新} に変わった`);
          文書.add(f.ファイル名);
        }
        出す(`  ${f.ファイル名}：取り直して比べた（${指紋 === f.sha256 ? "同じ" : "違う"}）`);
      } catch (e) {
        内容.push(`${f.ファイル名}：公式URLから取れなくなった（${(e as Error).message}）。移動・削除の可能性`);
        文書.add(f.ファイル名);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 2. 手元のファイル（人がダウンロードしたものを含む）
  const 手元 = new Set(手元のファイル(dir));
  for (const f of 登録.values()) {
    if (!手元.has(NFC(f.ファイル名))) {
      内容.push(`${f.ファイル名}：手元から無くなった`);
      文書.add(f.ファイル名);
      continue;
    }
    if (!f.url && sha256(path.join(dir, f.ファイル名)) !== f.sha256) {
      内容.push(`${f.ファイル名}：手元のファイルの中身が登録したときと違う（sha256 が違う）`);
      文書.add(f.ファイル名);
    }
  }
  for (const n of 手元) {
    if (登録.has(n)) continue;
    const 似た = [...登録.keys()].find((r) => 版を外す(r) === 版を外す(n));
    内容.push(似た ? `${似た} が ${n} に置き換わったかもしれない（版の書き換え）` : `${n}：登録に無いファイルが増えた`);
    文書.add(似た ?? n);
  }

  // 3. 入口ページの文書の一覧
  if (data.入口 && data.入口の文書一覧) {
    try {
      const 今 = await 入口の一覧(data.入口);
      const 前 = data.入口の文書一覧.リンク;
      const 前url = new Set(前.map((x) => x.url));
      const 今url = new Set(今.map((x) => x.url));
      const 消えた = 前.filter((x) => !今url.has(x.url));
      const 増えた = 今.filter((x) => !前url.has(x.url));
      for (const a of 増えた) {
        const b = 消えた.find((x) => 版を外す(x.名前) === 版を外す(a.名前) || 版を外す(path.basename(x.url)) === 版を外す(path.basename(a.url)));
        if (b) 内容.push(`入口ページ：「${b.名前}」が「${a.名前}」に置き換わった（版の書き換えかもしれない）`);
        else 内容.push(`入口ページ：文書が増えた「${a.名前}」`);
      }
      for (const b of 消えた) {
        if (増えた.some((a) => 版を外す(b.名前) === 版を外す(a.名前) || 版を外す(path.basename(b.url)) === 版を外す(path.basename(a.url)))) continue;
        内容.push(`入口ページ：文書が無くなった「${b.名前}」`);
      }
      for (const a of 今) {
        const b = 前.find((x) => x.url === a.url);
        if (b && b.名前 !== a.名前) 内容.push(`入口ページ：リンクの名前が「${b.名前}」から「${a.名前}」に変わった`);
      }
      出す(`  入口ページ：リンク ${前.length}本 → ${今.length}本（増 ${増えた.length}・減 ${消えた.length}）`);
      if (増えた.length || 消えた.length) 文書.add("（入口ページ）");
    } catch (e) {
      出す(`  入口ページを開けなかった：${(e as Error).message}`);
    }
  }

  const 検知 = [...(data.改訂の検知 ?? [])];
  if (内容.length) {
    検知.push({ 日付: 今日, 文書: [...文書], 内容 });
    出す(`  改訂を検知した（${内容.length}件）：`);
    for (const l of 内容) 出す(`    ${l}`);
    出す(`  読み直すには：npm run 取得 -- ${コード} のあと npm run 読む -- ${コード}`);
  } else {
    出す("  変わったところは見つからなかった");
  }
  出典に書く(dir, doc, { 改訂の検知: 検知.length ? 検知 : undefined, 鮮度確認日: 今日 });
  return 内容.length;
}

async function main() {
  const 指定 = process.argv[2] ?? "全部";
  if (指定 === "全部") {
    let n = 0;
    for (const k of 県一覧) {
      const dir = path.join(手引きの置き場, fs.readdirSync(手引きの置き場).find((x) => NFC(x).startsWith(`${k.コード}_`)) ?? "-");
      if (!fs.existsSync(path.join(dir, "_出典.yaml"))) continue;
      n += await 一県(k.コード, k.名前, dir);
    }
    出す(`全部で ${n}件の変化`);
    return;
  }
  const 県 = 県を探す(指定);
  const dir = 手引きフォルダ(県.コード, 県.名前);
  if (!fs.existsSync(path.join(dir, "_出典.yaml"))) 止める(`${県.名前}の _出典.yaml が無い。先に npm run 取得 -- ${県.コード}`);
  await 一県(県.コード, 県.名前, dir);
}

main().catch((e) => {
  console.error(`鮮度の確認に失敗した：${(e as Error).message}`);
  process.exit(1);
});

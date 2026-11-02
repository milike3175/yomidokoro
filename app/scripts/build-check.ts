// npm run build の最後に動く見張り。
// 公開用の書き出し（out/）に、手帳（みゆき専用の電話記録）の中身が混ざっていないかを調べる。
// 手帳の各ファイル（電話・補正）の id・答え・指摘・直し方の文が out/ のどこかに出てきたら、書き出しを失敗にする。
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const APP = path.resolve(import.meta.dirname, "..");
const OUT = path.join(APP, "out");
const TECHO = path.join(APP, "..", "手帳");

function ファイルたち(dir: string, ext: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? ファイルたち(p, ext) : ext.test(e.name) ? [p] : [];
  });
}

const 見張る語 = new Set<string>();
for (const f of ファイルたち(TECHO, /\.ya?ml$/)) {
  const d = parse(fs.readFileSync(f, "utf8")) ?? {};
  if (typeof d.id === "string") 見張る語.add(d.id);
  // 電話の答え・補正の指摘と直し方の、それぞれ先頭20字を見張る
  for (const a of [...(Array.isArray(d.回答) ? d.回答 : []), ...(Array.isArray(d.指摘) ? d.指摘 : [])]) {
    for (const t of [a?.答え, a?.指摘, a?.直し方]) {
      if (typeof t === "string" && t.length >= 8) 見張る語.add(t.slice(0, 20));
    }
  }
}
const 見張る文 = [...見張る語].map((s) => s.normalize("NFC"));

let 漏れ = 0;
for (const f of ファイルたち(OUT, /\.(html|txt|js|json|rsc)$/)) {
  const text = fs.readFileSync(f, "utf8").normalize("NFC");
  if (見張る文.some((s) => text.includes(s))) {
    漏れ++;
    console.error(`[止めました] 書き出しに手帳の中身が入っています：${path.relative(APP, f)}`);
  }
}
if (漏れ) {
  console.error("公開用の書き出しに電話の記録が混ざっています。TECHO=1 を付けずに npm run build してください。");
  fs.rmSync(OUT, { recursive: true, force: true });
  console.error("out/ を消しました。");
  process.exit(1);
}
console.log(`見張り：手帳の文 ${見張る文.length}件を out/ で探した。混ざっていない`);

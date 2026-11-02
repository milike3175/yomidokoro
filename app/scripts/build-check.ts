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

const MIHON = path.join(APP, "data", "見本");
const 見張る語 = new Set<string>();
/** 見本/ に同じ相対パスのファイルがある手帳ファイル（見本の元）の語。out/ に出てよい */
const 見本の元の語 = new Set<string>();
for (const f of ファイルたち(TECHO, /\.ya?ml$/)) {
  const d = parse(fs.readFileSync(f, "utf8")) ?? {};
  const 見本の元 = fs.existsSync(path.join(MIHON, path.relative(TECHO, f)));
  const 足す = (w: string) => (見本の元 ? 見本の元の語 : 見張る語).add(w);
  if (typeof d.id === "string") 足す(d.id);
  // 電話の答え・補正の指摘と直し方の、それぞれ先頭20字を見張る
  for (const a of [...(Array.isArray(d.回答) ? d.回答 : []), ...(Array.isArray(d.指摘) ? d.指摘 : [])]) {
    for (const t of [a?.答え, a?.指摘, a?.直し方]) {
      if (typeof t === "string" && t.length >= 8) 足す(t.slice(0, 20));
    }
  }
}
// 公開してよいデータ（app/data の YAML。手引きの要約・引用、観点、品目など）に元から出てくる文は見張らない。
// ただし app/data/見本/ は除く（見本に手帳の別の文が紛れても素通りさせないため）。
// 見本で out/ に出てよいのは、見本/<X> と同じ相対パスの 手帳/<X>（元の記録）の文だけ（見本の元の語）。
// 「石綿含有産業廃棄物・水銀使用製品産業廃棄物」のような法令の呼び名が、手帳と手引きの両方に出るため
const 公開の文 = ファイルたち(path.join(APP, "data"), /\.ya?ml$/)
  .filter((f) => !f.startsWith(MIHON + path.sep))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n")
  .normalize("NFC");
// 品目・付加区分・手続きの呼び名と区切りだけでできた語も見張らない（画面が品目を「・」でつないで出すため）
const 品目の文 = parse(fs.readFileSync(path.join(APP, "data", "品目.yaml"), "utf8")) ?? {};
const 呼び名 = [
  ...(品目の文.品目 ?? []).map((x: { id: string }) => x.id),
  ...(品目の文.付加区分 ?? []).map((x: { id: string }) => x.id),
  "建設系以外",
  "建設系",
  "新規",
  "更新",
  "変更許可",
  "変更届",
].sort((a: string, b: string) => b.length - a.length);
function 呼び名だけ(s: string) {
  let r = s;
  for (const w of 呼び名) {
    // 語の末尾が途中で切れていることがあるので、呼び名の先頭部分でも外す
    r = r.split(w).join("");
    for (let n = w.length - 1; n >= 3; n--) if (r.endsWith(w.slice(0, n))) r = r.slice(0, -n);
  }
  return r.replace(/[・、，,\s（）()]/g, "").length < 4;
}
const 見本の元 = new Set([...見本の元の語].map((s) => s.normalize("NFC")));
const 見張る文 = [...見張る語]
  .map((s) => s.normalize("NFC"))
  .filter((s) => !見本の元.has(s) && !公開の文.includes(s) && !呼び名だけ(s));
const 外した = 見張る語.size - 見張る文.length;

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
console.log(`見張り：手帳の文 ${見張る文.length}件を out/ で探した。混ざっていない${外した ? `（公開データにも出てくる ${外した}件は外した）` : ""}${見本の元.size ? `（見本の元の記録の ${見本の元.size}件は出てよい）` : ""}`);

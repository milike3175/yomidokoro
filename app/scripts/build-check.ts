// npm run build の最後に動く見張り。
// 公開用の書き出し（out/）に、手帳（みゆき専用の電話記録）の中身が混ざっていないかを調べる。
// 手帳の各ファイル（電話・補正）の id・答え・指摘・直し方の文が out/ のどこかに出てきたら、書き出しを失敗にする。
// 揺れの判定（ケン）の理由も見る：
//   - 手帳/<許認可>/_判定/ の理由の一行が out/ に出てきたら失敗（見本の電話どうしの組の理由だけは外す）
//   - 見本/<許認可>/_判定/ の組が、見本の電話と公開の手引きの記録だけでできているかを確かめる（ほかの電話の組があれば失敗）
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

// ---- 揺れの判定（ケン）の理由 ----
const 詰める = (s: string) => s.normalize("NFC").replace(/\s+/g, "");
/** 理由の一行を見張る語に切る（短いので、20字に満たなければ全体、それ以上は20字ずつ10字ずらし） */
function 切る(理由: string): string[] {
  const s = 詰める(理由);
  if (s.length < 12) return [];
  if (s.length < 20) return [s];
  const r: string[] = [];
  for (let i = 0; i + 20 <= s.length; i += 10) r.push(s.slice(i, i + 20));
  r.push(s.slice(-20));
  return r;
}
type 判定の組 = { 理由?: unknown; 電話?: { id?: unknown }; 相手?: { 手引き?: unknown; 電話?: unknown } };
const 判定たち = (f: string): 判定の組[] => {
  const d = parse(fs.readFileSync(f, "utf8")) ?? {};
  return Array.isArray(d.判定) ? d.判定 : [];
};
const 判定の置き場か = (f: string) => path.basename(path.dirname(f)) === "_判定";

// 見本の電話の記録の ID
const 見本の電話id = new Set<string>();
for (const f of ファイルたち(MIHON, /\.ya?ml$/).filter((f) => path.basename(path.dirname(f)) === "電話")) {
  const id = (parse(fs.readFileSync(f, "utf8")) ?? {}).id;
  if (typeof id === "string") 見本の電話id.add(id);
}
/** 組が見本の電話だけでできているか（相手が手引きか、相手の電話も見本） */
const 見本だけの組 = (x: 判定の組) =>
  typeof x.電話?.id === "string" &&
  見本の電話id.has(x.電話.id) &&
  (typeof x.相手?.手引き === "string" || (typeof x.相手?.電話 === "string" && 見本の電話id.has(x.相手.電話)));

// 1. 見本の判定ファイルの組を確かめる：電話は見本の電話、相手は見本の電話か、同じ許可権者の公開の手引きの記録
const 見本の判定の誤り: string[] = [];
const 見本の理由 = new Set<string>();
for (const f of ファイルたち(MIHON, /\.ya?ml$/).filter(判定の置き場か)) {
  const 許可権者 = path.basename(f, path.extname(f));
  const 手引きf = path.join(APP, "data", path.basename(path.dirname(path.dirname(f))), 許可権者, "手引き.yaml");
  const 手引きのid = new Set<string>(
    fs.existsSync(手引きf) ? ((parse(fs.readFileSync(手引きf, "utf8")) ?? {}).記録 ?? []).map((r: { id: string }) => r.id) : [],
  );
  判定たち(f).forEach((x, i) => {
    const 場所 = `${path.relative(APP, f)} の ${i + 1}件目`;
    if (!見本だけの組(x)) 見本の判定の誤り.push(`${場所}：見本の電話の記録ではない電話の組が入っている`);
    else if (typeof x.相手?.手引き === "string" && !手引きのid.has(x.相手.手引き)) 見本の判定の誤り.push(`${場所}：相手の手引きの記録が公開の手引きに無い`);
    if (typeof x.理由 === "string") 見本の理由.add(詰める(x.理由));
  });
}
if (見本の判定の誤り.length) {
  for (const m of 見本の判定の誤り) console.error(`[止めました] ${m}`);
  console.error("公開版の判定は、見本の電話の記録から作ったものだけにしてください（TECHO を付けずに npm run 判定）。");
  fs.rmSync(OUT, { recursive: true, force: true });
  console.error("out/ を消しました。");
  process.exit(1);
}

// 2. 手帳の判定の理由を見張る。見本の電話だけの組の理由は外す（見本の判定と同じ材料から出た言い換えのため）
const 判定の見張る語 = new Set<string>();
let 判定の外した = 0;
for (const f of ファイルたち(TECHO, /\.ya?ml$/).filter(判定の置き場か)) {
  for (const x of 判定たち(f)) {
    if (typeof x.理由 !== "string") continue;
    if (見本だけの組(x)) {
      判定の外した++;
      continue;
    }
    for (const w of 切る(x.理由)) if (!呼び名だけ(w)) 判定の見張る語.add(w);
  }
}

let 漏れ = 0;
let 判定の漏れ = 0;
const 画面に出た見本の理由 = new Set<string>();
for (const f of ファイルたち(OUT, /\.(html|txt|js|json|rsc)$/)) {
  const text = fs.readFileSync(f, "utf8").normalize("NFC");
  if (見張る文.some((s) => text.includes(s))) {
    漏れ++;
    console.error(`[止めました] 書き出しに手帳の中身が入っています：${path.relative(APP, f)}`);
  }
  const 詰めた = 詰める(text);
  if ([...判定の見張る語].some((s) => 詰めた.includes(s))) {
    判定の漏れ++;
    console.error(`[止めました] 書き出しに手帳の判定の理由が入っています：${path.relative(APP, f)}`);
  }
  for (const r of 見本の理由) if (詰めた.includes(r)) 画面に出た見本の理由.add(r);
}
漏れ += 判定の漏れ;
if (漏れ) {
  console.error("公開用の書き出しに電話の記録が混ざっています。TECHO=1 を付けずに npm run build してください。");
  fs.rmSync(OUT, { recursive: true, force: true });
  console.error("out/ を消しました。");
  process.exit(1);
}
console.log(
  `見張り：手帳の判定の理由 ${判定の見張る語.size}か所を out/ で探した。混ざっていない${判定の外した ? `（見本の電話だけの組の ${判定の外した}件は外した）` : ""}。見本の判定の理由 ${見本の理由.size}件のうち ${画面に出た見本の理由.size}件が画面に出ている`,
);
console.log(`見張り：手帳の文 ${見張る文.length}件を out/ で探した。混ざっていない${外した ? `（公開データにも出てくる ${外した}件は外した）` : ""}${見本の元.size ? `（見本の元の記録の ${見本の元.size}件は出てよい）` : ""}`);

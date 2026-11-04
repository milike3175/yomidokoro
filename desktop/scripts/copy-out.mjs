// app/out（公開用の書き出し、TECHO=0）と様式の対応表を、desktop/_写し/ に写す。
// app/ の中は読むだけで、書き換えない。app/ で npm run build（TECHO=0）を済ませてから使う。
// 手帳（TECHO=1）で書き出した out/ なら止める。
import fs from "node:fs";
import path from "node:path";

const HERE = path.resolve(import.meta.dirname, "..");
const OUT = path.resolve(HERE, "..", "app", "out");
const 対応表 = path.resolve(HERE, "..", "app", "data", "様式");
const 写し = path.join(HERE, "_写し");

function やめる(msg) {
  console.error(`止めた：${msg}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(OUT, "index.html"))) やめる("app/out が無い。app/ で npm run build を先に済ませる");

// 手帳の書き出しには画面の上に techo-banner の帯が出る。HTML に帯の要素があれば手帳版
function htmlたち(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? htmlたち(p) : e.name.endsWith(".html") || e.name.endsWith(".txt") ? [p] : [];
  });
}
for (const f of htmlたち(OUT)) {
  const t = fs.readFileSync(f, "utf8");
  if (/class(Name)?\\?"?[:=]\\?"techo-banner/.test(t) || t.includes("自分専用の手帳（電話の記録）を読み込んで表示しています"))
    やめる(`${path.relative(OUT, f)} に手帳の帯がある。手帳版（TECHO=1）の書き出しは入れない。app/ で TECHO=0 npm run build をやり直す`);
}
// 様式ファイル（県の著作物）を out/ に入れていないか
const 様式の本体 = (function 探す(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? 探す(p) : /\.(docx|xlsx|pdf)$/i.test(e.name) ? [p] : [];
  });
})(OUT);
if (様式の本体.length) やめる(`out/ に様式・手引きの本体がある：${様式の本体.map((p) => path.relative(OUT, p)).join(", ")}`);

fs.rmSync(写し, { recursive: true, force: true });
fs.mkdirSync(写し, { recursive: true });
fs.cpSync(OUT, path.join(写し, "site"), { recursive: true });
fs.mkdirSync(path.join(写し, "様式"), { recursive: true });
if (fs.existsSync(対応表)) {
  for (const f of fs.readdirSync(対応表).filter((n) => /\.ya?ml$/.test(n))) fs.copyFileSync(path.join(対応表, f), path.join(写し, "様式", f));
}
const 日時 = fs.statSync(path.join(OUT, "index.html")).mtime.toISOString();
fs.writeFileSync(path.join(写し, "書き出し日時.txt"), `${日時}\n`);
console.log(`app/out（${日時} の書き出し）を desktop/_写し/ に写した`);

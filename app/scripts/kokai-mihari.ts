// npm run 見張り：GitHub に上げる（push する）前の見張り。
// 公開してはいけないものが、git が追跡しているファイル・push しようとしているコミットに入っていないかを調べ、
// 入っていれば止める（終了コード 1。Claude Code のフックから呼ばれたときは 2）。
//
// 呼ばれ方
//   npm run 見張り                       手で確かめる（追跡中のファイル＋まだ上げていないコミット）
//   node scripts/kokai-mihari.ts --pre-push       git の pre-push フックから（標準入力に push する ref が来る）
//   node scripts/kokai-mihari.ts --claude-hook    Claude Code の PreToolUse フックから（git push のときだけ動く）
//
// 調べること
//   1. 置き場所：手帳/・_申請/・_鍵/・.env・手引き/<県>/ の本体ファイル（_出典.yaml・_差分.yaml 以外）が入っていないか
//   2. 手帳の中身：手帳にある記録の答え・指摘・直し方の文（20字以上の部分）と、手帳の _判定 の理由の一行が、
//      どこかのファイルに混ざっていないか（app/data/見本/<X> だけは、元の 手帳/<X> の文を外して調べる。
//      見本/<許認可>/_判定/ は、見本の電話ファイルに由来する文だけを外す）
//   3. 鍵の形：sk-ant- で始まる文字列など。見つけても中身は出さず「どのファイルの何行目」だけ出す
//   4. 公開しない予定のメモ：下の一覧。追跡に入ったら止める（警告どまりのものは印を付けてある）
//   5. 見本/<許認可>/_判定/ の組：電話が見本の電話の記録で、相手が手引きか見本の電話であること（画面に理由が出るため）
//
// 守ること
//   - 手帳の文も鍵も、画面には一切出さない。出すのはファイル名と行番号だけ
//   - git の中身を書き換えない（読むだけ）
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";

// ---------------- 公開しない予定のメモ（追跡に入ったら知らせる） ----------------
// 止める：push を止める。警告：知らせるだけで止めない（公開してよいかをあとで決めるもの）
const 公開しない予定: { 場所: string; 扱い: "止める" | "警告"; 理由: string }[] = [
  { 場所: "引き継ぎ.md", 扱い: "止める", 理由: "経緯と内部の相談のメモ" },
  { 場所: "構成/", 扱い: "止める", 理由: "設計メモ・相談記録" },
  { 場所: "規約_", 扱い: "止める", 理由: "ハッカソンの規約の写し" },
  { 場所: "参加者ガイド_", 扱い: "止める", 理由: "ハッカソンの参加者向け資料の写し" },
  { 場所: "手引き/_料金ログ.txt", 扱い: "止める", 理由: "API の使用料の記録" },
  { 場所: "app/logs/", 扱い: "止める", 理由: "取り込みのログ" },
  { 場所: "CLAUDE.md", 扱い: "止める", 理由: "期間前（10/23）に書いた構想。運営回答：事前の構想はリポジトリ外で" },
  { 場所: "手引き/_出典候補_", 扱い: "止める", 理由: "期間前（10/23）の調査を含む。運営回答：事前の構想はリポジトリ外で" },
];

// ---------------- 鍵の形 ----------------
const 鍵の形: { 名前: string; re: RegExp }[] = [
  { 名前: "Anthropic の鍵", re: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { 名前: "OpenAI の鍵", re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { 名前: "Stripe の鍵", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { 名前: "GitHub の鍵", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { 名前: "Notion の鍵", re: /\b(?:secret|ntn)_[A-Za-z0-9]{40,}/ },
  { 名前: "AWS の鍵", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { 名前: "Slack の鍵", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { 名前: "秘密鍵", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { 名前: "鍵の書き込み", re: /\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_\-./+]{20,}/ },
];

const APP = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(APP, "..");
const TECHO = path.join(ROOT, "手帳");
const NFC = (s: string) => s.normalize("NFC");

const mode = process.argv.includes("--claude-hook") ? "claude" : process.argv.includes("--pre-push") ? "pre-push" : "手";

function git(args: string[], input?: string): Buffer {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: ROOT,
    input,
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });
}

// ---------------- Claude Code のフック：git push のときだけ動く ----------------
if (mode === "claude") {
  let 入力 = "";
  try {
    入力 = fs.readFileSync(0, "utf8");
  } catch {
    process.exit(0);
  }
  let command = "";
  try {
    command = String(JSON.parse(入力)?.tool_input?.command ?? "");
  } catch {
    process.exit(0);
  }
  // 「git push」「git -C x push」など。push を含まない git の操作には関わらない
  if (!/\bgit\b(?:\s+-{1,2}[^\s;&|]+(?:\s+[^\s;&|-][^\s;&|]*)?)*\s+push\b/.test(command)) process.exit(0);
}

// ---------------- pre-push：標準入力に「ローカルの ref と sha・リモートの ref と sha」が来る ----------------
const ゼロ = /^0+$/;
function 上げるコミット(): string[] {
  const 一覧 = new Set<string>();
  const 足す = (args: string[]) => {
    const out = git(["rev-list", ...args]).toString().trim();
    for (const c of out ? out.split("\n") : []) 一覧.add(c);
  };
  if (mode === "pre-push") {
    let 入力 = "";
    try {
      入力 = fs.readFileSync(0, "utf8");
    } catch {}
    for (const 行 of 入力.split("\n")) {
      const [, 手元sha, , 先sha] = 行.trim().split(/\s+/);
      if (!手元sha || ゼロ.test(手元sha)) continue; // 消す push は中身が無い
      if (先sha && !ゼロ.test(先sha)) 足す([`${先sha}..${手元sha}`]);
      else 足す([手元sha, "--not", "--remotes"]);
    }
  } else {
    // 手・Claude のフック：どのブランチを上げるか分からないので、まだ上げていないコミットを全部
    try {
      足す(["--branches", "--not", "--remotes"]);
    } catch {
      // コミットが一つも無い
    }
  }
  return [...一覧];
}

// 調べる対象：（場所, 中身の sha, どこから）
type 対象 = { 場所: string; blob: string; 出どころ: string };
const 対象たち: 対象[] = [];
// 追跡中（git add 済み＝次のコミットに入るもの）
{
  const out = git(["ls-files", "-s", "-z"]).toString();
  for (const e of out.split("\0")) {
    const m = e.match(/^\d+ ([0-9a-f]+) \d+\t(.+)$/s);
    if (m) 対象たち.push({ 場所: NFC(m[2]), blob: m[1], 出どころ: "追跡中" });
  }
}
const コミット = 上げるコミット();
for (const c of コミット) {
  const out = git(["ls-tree", "-r", "-z", c]).toString();
  for (const e of out.split("\0")) {
    const m = e.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/s);
    if (m) 対象たち.push({ 場所: NFC(m[2]), blob: m[1], 出どころ: `コミット ${c.slice(0, 7)}` });
  }
}

const 止める理由: string[] = [];
const 警告: string[] = [];
const 一度だけ = new Set<string>();
function 記す(先: string[], msg: string) {
  if (一度だけ.has(msg)) return;
  一度だけ.add(msg);
  先.push(msg);
}

// ---------------- 1. 置き場所 ----------------
function 置いてはいけない(p: string): string | null {
  const 部分 = p.split("/");
  if (部分[0] === "手帳") return "手帳（電話の記録）は上げない";
  if (部分[0] === "_申請") return "_申請（案件の書類）は上げない";
  if (部分[0] === "_鍵") return "_鍵（鍵の置き場）は上げない";
  const 名 = 部分[部分.length - 1];
  if (名 === ".env" || 名.startsWith(".env.")) return ".env（鍵）は上げない";
  if (部分[0] === "手引き" && 部分.length >= 3 && !(部分.length === 3 && (名 === "_出典.yaml" || 名 === "_差分.yaml")))
    return "手引きの本体（県の著作物）は上げない。置けるのは _出典.yaml と _差分.yaml だけ";
  return null;
}
for (const t of 対象たち) {
  const 理由 = 置いてはいけない(t.場所);
  if (理由) 記す(止める理由, `${t.場所}（${t.出どころ}）：${理由}`);
  for (const k of 公開しない予定) {
    if (t.場所 === k.場所 || t.場所.startsWith(k.場所)) {
      記す(k.扱い === "止める" ? 止める理由 : 警告, `${t.場所}（${t.出どころ}）：公開しない予定のメモ。${k.理由}`);
    }
  }
}

// ---------------- 2. 手帳の文（build-check.ts と同じ考え方） ----------------
function ファイルたち(dir: string, ext: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? ファイルたち(p, ext) : ext.test(e.name) ? [p] : [];
  });
}
const 長さ = 20;
/** 公開してよい見本の電話記録の置き場（リポジトリの根からの場所） */
const 見本の置き場 = "app/data/見本/";
const 見張る語 = new Set<string>();
/** 手帳のファイルごとの見張る語（手帳からの相対パス → 語）。見本/ の照合外しに使う */
const ファイルごとの語 = new Map<string, Set<string>>();
for (const f of ファイルたち(TECHO, /\.ya?ml$/)) {
  const この語 = new Set<string>();
  ファイルごとの語.set(NFC(path.relative(TECHO, f)), この語);
  let d: any = {};
  try {
    d = parse(fs.readFileSync(f, "utf8")) ?? {};
  } catch {
    continue;
  }
  for (const a of [...(Array.isArray(d.回答) ? d.回答 : []), ...(Array.isArray(d.指摘) ? d.指摘 : [])]) {
    for (const t of [a?.答え, a?.指摘, a?.直し方]) {
      if (typeof t !== "string") continue;
      const s = NFC(t).replace(/\s+/g, "");
      if (s.length < 長さ) continue;
      // 20字ずつ、10字ずらしで切り出す（どこを写されても引っかかるように）
      for (let i = 0; i + 長さ <= s.length; i += 10) この語.add(s.slice(i, i + 長さ));
      この語.add(s.slice(-長さ));
      for (const w of この語) 見張る語.add(w);
    }
  }
}
// 見本の電話の記録（app/data/見本/<許認可>/<県>/電話/*.yaml）の ID と、その元の手帳ファイル
const 見本の電話id = new Set<string>();
const 見本の元 = new Set<string>();
for (const f of ファイルたち(path.join(APP, "data", "見本"), /\.ya?ml$/).filter((f) => path.basename(path.dirname(f)) === "電話")) {
  try {
    const id = parse(fs.readFileSync(f, "utf8"))?.id;
    if (typeof id === "string") 見本の電話id.add(id);
  } catch {}
  見本の元.add(NFC(path.relative(path.join(APP, "data", "見本"), f)));
}
/** 組が見本の電話だけでできているか（相手が手引きか、相手の電話も見本）。見本の判定に入ってよいのはこの組だけ */
const 見本だけの組 = (x: any) =>
  typeof x?.電話?.id === "string" &&
  見本の電話id.has(x.電話.id) &&
  (typeof x?.相手?.手引き === "string" || (typeof x?.相手?.電話 === "string" && 見本の電話id.has(x.相手.電話)));
// 手帳/<許認可>/_判定/ の理由の一行（ケンが電話の答えを言い換えたもの）も見張る。電話の記録の ID ごとに持つ
/** 判定の理由の語（電話の記録の ID → 語）。見本/ の _判定 で外すのは、見本の電話だけでできた組の語だけ */
const 判定の語 = new Map<string, Set<string>>();
for (const f of ファイルたち(TECHO, /\.ya?ml$/).filter((f) => path.basename(path.dirname(f)) === "_判定")) {
  let d: any = {};
  try {
    d = parse(fs.readFileSync(f, "utf8")) ?? {};
  } catch {
    continue;
  }
  for (const x of Array.isArray(d.判定) ? d.判定 : []) {
    if (typeof x?.理由 !== "string" || typeof x?.電話?.id !== "string") continue;
    const s = NFC(x.理由).replace(/\s+/g, "");
    if (s.length < 12) continue;
    // 見本の電話と、見本でない電話の組（電話どうし）は、見本の側でも外さない（見本でない電話の言い換えを含むため）
    const 鍵 = 見本だけの組(x) ? x.電話.id : "（見本でない組）";
    const この語 = 判定の語.get(鍵) ?? new Set<string>();
    判定の語.set(鍵, この語);
    // 理由は短い（60字以内）ので、20字に満たなければ全体を、それ以上なら20字ずつ切り出す
    if (s.length < 長さ) この語.add(s);
    else {
      for (let i = 0; i + 長さ <= s.length; i += 10) この語.add(s.slice(i, i + 長さ));
      この語.add(s.slice(-長さ));
    }
    for (const w of この語) 見張る語.add(w);
  }
}

// 品目・手続きの呼び名だけでできた語は見張らない（build-check.ts と同じ）
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
    r = r.split(w).join("");
    // 20字で切ると、呼び名の頭や尻尾が端に残るので、それも外す
    for (let n = w.length - 1; n >= 2; n--) if (r.endsWith(w.slice(0, n))) r = r.slice(0, -n);
    for (let n = w.length - 1; n >= 2; n--) if (r.startsWith(w.slice(-n))) r = r.slice(n);
  }
  return r.replace(/[・、，,\s（）()「」]/g, "").length < 4;
}
const 見張る文 = [...見張る語].filter((s) => !呼び名だけ(s));
/** 見本/ のファイルで見張る文：同じ相対パスの手帳ファイル（元の記録）の語だけを外す。ほかの手帳の文が入っていれば止める */
function 見本で見張る文(場所: string): string[] {
  const 相対 = 場所.slice(見本の置き場.length);
  // 見本/<許認可>/_判定/ は、同じ場所の手帳の判定（ほかの電話の判定も入っている）を丸ごと外さない。
  // 外すのは、見本の電話ファイルの元の答えの文と、見本の電話の ID に結びつく判定の理由だけ
  if (相対.split("/")[1] === "_判定") {
    const 外す = new Set<string>();
    for (const p of 見本の元) for (const w of ファイルごとの語.get(p) ?? []) 外す.add(w);
    for (const id of 見本の電話id) for (const w of 判定の語.get(id) ?? []) 外す.add(w);
    return 見張る文.filter((s) => !外す.has(s));
  }
  const 元 = ファイルごとの語.get(相対) ?? new Set<string>();
  return 見張る文.filter((s) => !元.has(s));
}

// ---------------- 中身を読む（git から。いま手元にあるファイルではなく、上げる中身そのもの） ----------------
const blobs = [...new Set(対象たち.map((t) => t.blob))];
const 中身 = new Map<string, Buffer>();
if (blobs.length) {
  const out = git(["cat-file", "--batch"], blobs.join("\n") + "\n");
  let i = 0;
  while (i < out.length) {
    const nl = out.indexOf(0x0a, i);
    const head = out.subarray(i, nl).toString();
    const [sha, type, size] = head.split(" ");
    if (type === "missing" || !size) {
      i = nl + 1;
      continue;
    }
    const n = Number(size);
    中身.set(sha, out.subarray(nl + 1, nl + 1 + n));
    i = nl + 1 + n + 1;
  }
}

const 調べ済み = new Set<string>();
for (const t of 対象たち) {
  const key = `${t.場所}\0${t.blob}`;
  if (調べ済み.has(key)) continue;
  調べ済み.add(key);
  const buf = 中身.get(t.blob);
  if (!buf || buf.length > 5 * 1024 * 1024 || buf.includes(0)) continue; // 画像などの文字でないもの
  const text = NFC(buf.toString("utf8"));
  const 行たち = text.split("\n");
  // 3. 鍵の形
  行たち.forEach((行, n) => {
    for (const k of 鍵の形) {
      if (k.re.test(行)) 記す(止める理由, `${t.場所} ${n + 1}行目（${t.出どころ}）：${k.名前}の形の文字列があります（中身は表示しません）`);
    }
  });
  // 2. 手帳の文。app/data/見本/<X> は、みゆきが公開を了承した見本なので、元の 手帳/<X> の文だけは一致しても通す。
  //    見本/ にそれ以外の手帳の文があれば止める。見本/ 以外のファイルは今までどおり全部の手帳の文で調べる
  // 5. 見本/<許認可>/_判定/ の組は、見本の電話の記録だけでできていること（ほかの電話の組が入っていれば止める）
  if (t.場所.startsWith(見本の置き場) && t.場所.slice(見本の置き場.length).split("/")[1] === "_判定" && /\.ya?ml$/.test(t.場所)) {
    let 組: any[] = [];
    try {
      const d = parse(text) ?? {};
      組 = Array.isArray(d.判定) ? d.判定 : [];
    } catch {
      記す(止める理由, `${t.場所}（${t.出どころ}）：見本の判定ファイルが読めない`);
    }
    const 外れ = 組.filter((x) => !見本だけの組(x)).length;
    if (外れ) 記す(止める理由, `${t.場所}（${t.出どころ}）：見本の電話の記録ではない電話の組が ${外れ}件入っている（判定の理由は表示しません）`);
  }
  const この見張る文 = t.場所.startsWith(見本の置き場) ? 見本で見張る文(t.場所) : 見張る文;
  if (この見張る文.length) {
    const 詰めた行 = 行たち.map((l) => l.replace(/\s+/g, ""));
    const 全体 = 詰めた行.join("");
    if (この見張る文.some((s) => 全体.includes(s))) {
      const 行番号 = 詰めた行.findIndex((l) => この見張る文.some((s) => l.includes(s)));
      記す(
        止める理由,
        `${t.場所}${行番号 >= 0 ? ` ${行番号 + 1}行目` : ""}（${t.出どころ}）：手帳（電話の記録）の答えの文が入っています（文は表示しません）`,
      );
    }
  }
}

// ---------------- 結果 ----------------
const 件数 = `追跡中 ${new Set(対象たち.filter((t) => t.出どころ === "追跡中").map((t) => t.場所)).size}ファイル・上げていないコミット ${コミット.length}件`;
const 出す = mode === "claude" ? console.error : console.log;
for (const w of 警告) 出す(`[警告] ${w}`);
if (止める理由.length) {
  console.error("[止めました] 公開してはいけないものが入っています。");
  for (const r of 止める理由) console.error(`  - ${r}`);
  console.error(
    "直し方：追跡から外すなら `git rm --cached <ファイル>`、コミットに入ってしまったならコミットを作り直してから push してください。",
  );
  process.exit(mode === "claude" ? 2 : 1);
}
出す(`見張り：${件数}を調べた（手帳の文 ${見張る文.length}か所・鍵の形 ${鍵の形.length}種）。公開してはいけないものは入っていない`);

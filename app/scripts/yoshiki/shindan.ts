// npm run 様式を診断 -- <様式のファイル> [--詳しく] [--シート <名前の一部>]
// 様式ファイル（県の白紙の様式）を一つ読み、何でできているか・道具で書けるか・見出しがどこにあるかを出す。
// 読むのはこのパソコンの中のファイルだけ。どこにも送らない。Claude も呼ばない（スキル「様式を診断する」が、この結果を見て対応表を作る）。
// --詳しく：Word なら段落ごと（表の中か・箱の番号・文字）、Excel ならシートごとの文字のセル。対応表の「段落」「箱」「セル」の番号はここで見る。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { parse } from "yaml";

const args = process.argv.slice(2);
const ファイル = args.find((a) => !a.startsWith("--"));
const 詳しく = args.includes("--詳しく");
const シートの指定 = (() => {
  const i = args.indexOf("--シート");
  return i >= 0 ? args[i + 1] : null;
})();
if (!ファイル || !fs.existsSync(ファイル)) {
  console.error("様式のファイルを付けてください（例 npm run 様式を診断 -- ../手引き/06_山形県/様式/yo6-r060226.docx）");
  process.exit(1);
}

const バイト = fs.readFileSync(ファイル);
const sha256 = crypto.createHash("sha256").update(バイト).digest("hex");
const 頭 = バイト.subarray(0, 8);
const 形 =
  頭[0] === 0x50 && 頭[1] === 0x4b
    ? "zip"
    : 頭.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
      ? "古いOffice"
      : 頭.subarray(0, 4).toString() === "%PDF"
        ? "PDF"
        : "不明";

// 道具が見る見出し（対応表の欄と同じ言い方）。様式によって言い方が違うので、いくつか持つ
const 見出したち: { 欄: string; 語: RegExp }[] = [
  { 欄: "申請日", 語: /年\s*月\s*日/ },
  { 欄: "住所", 語: /住\s*所/ },
  { 欄: "氏名・名称", 語: /氏\s*名|名\s*称/ },
  { 欄: "代表者", 語: /代表者/ },
  { 欄: "ふりがな", 語: /ふりがな|フリガナ/ },
  { 欄: "電話番号", 語: /電話/ },
  { 欄: "事業の範囲", 語: /事業の範囲/ },
  { 欄: "事務所・事業場", 語: /事務所|事業場/ },
  { 欄: "積替え・保管", 語: /積替え|積替|保管/ },
];

// この様式の対応表があるか（sha256 が同じもの）
const 対応表の置き場 = path.resolve(import.meta.dirname, "..", "..", "data", "様式");
const 対応表 = fs.existsSync(対応表の置き場)
  ? fs
      .readdirSync(対応表の置き場)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => ({ f, d: parse(fs.readFileSync(path.join(対応表の置き場, f), "utf8")) as { sha256?: string; 県名?: string; 名前?: string } }))
      .find((x) => x.d?.sha256 === sha256)
  : undefined;

console.log(`ファイル：${path.basename(ファイル)}（${(バイト.length / 1024).toFixed(0)}KB）`);
console.log(`sha256：${sha256}`);

function 結論(s: string) {
  console.log(`\n診断：${s}`);
}

if (形 === "PDF") {
  console.log("形：PDF");
  結論("PDF なので、道具では書けません。県のページに Word か Excel の様式が無いか探してください。無ければ、手で書く様式です");
  process.exit(0);
}
if (形 === "古いOffice") {
  const 名 = /\.xls$/i.test(ファイル) ? "古い Excel（.xls）" : /\.doc$/i.test(ファイル) ? "古い Word（.doc）" : "古い Office の形（.doc か .xls）";
  console.log(`形：${名}`);
  結論(`${名}なので、このままでは道具で書けません。Word か Excel で開いて新しい形（.docx・.xlsx）で保存し直せば、表を作って書けるようになります。保存し直すと中身が少し変わることがあるので、元の様式と見比べてください`);
  process.exit(0);
}
if (形 !== "zip") {
  console.log("形：不明");
  結論("Word・Excel・PDF のどれでもありません。道具では書けません");
  process.exit(0);
}

const zip = await JSZip.loadAsync(バイト);
const 見つけた = new Map<string, string[]>();
const 見つけたら = (場所: string, 文字: string) => {
  for (const m of 見出したち) if (m.語.test(文字)) 見つけた.set(m.欄, [...(見つけた.get(m.欄) ?? []), `${場所}「${文字.slice(0, 24)}」`]);
};

if (zip.file("word/document.xml")) {
  const x = await zip.file("word/document.xml")!.async("string");
  const 箱 = [...x.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>/g)].length;
  const 段落 = (x.match(/<w:p[ >]/g) ?? []).length + (x.match(/<w:p\/>/g) ?? []).length;
  const 表 = (x.match(/<w:tbl>/g) ?? []).length;
  const 改ページ = (x.match(/w:type="page"/g) ?? []).length;
  console.log(`形：新しい Word（.docx）　文字の箱 ${箱}・段落 ${段落}・表 ${表}・改ページ ${改ページ}`);
  // 段落ごと（表の中か・セル・箱の番号）。対応表の「段落」「箱」はこの番号
  const tok = x.matchAll(/<w:tbl>|<\/w:tbl>|<w:tr[ >]|<w:tc>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g);
  let 深さ = 0, 行 = 0, セル = 0, n = 0, b = 0;
  for (const m of tok) {
    const t = m[0];
    if (t === "<w:tbl>") { 深さ++; if (詳しく) console.log("== 表の始まり"); continue; }
    if (t === "</w:tbl>") { 深さ--; if (詳しく) console.log("== 表の終わり"); continue; }
    if (t.startsWith("<w:tr")) { 行++; セル = 0; continue; }
    if (t === "<w:tc>") { セル++; continue; }
    const ws = [...t.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((y) => y[1]);
    const 文字 = ws.join("");
    const 場所 = `段落${n}${深さ ? `（表 行${行} セル${セル}）` : ""}`;
    if (文字.trim()) 見つけたら(場所, 文字.replace(/\s+/g, " ").trim());
    if (詳しく) console.log(`p${n} ${深さ ? `表${深さ} 行${行} セル${セル}` : "本文"} 箱${ws.length ? `${b}-${b + ws.length - 1}` : "-"}${t.includes('w:type="page"') ? " [改ページ]" : ""} ${JSON.stringify(文字)}`);
    b += ws.length;
    n++;
  }
} else if (zip.file("xl/workbook.xml")) {
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const rmap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const tg = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && tg) rmap.set(id, tg);
  }
  const ss = zip.file("xl/sharedStrings.xml") ? await zip.file("xl/sharedStrings.xml")!.async("string") : "";
  const 文字列 = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "").matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((y) => y[1]).join(""),
  );
  const シート = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ 名前: m[1], 場所: `xl/${(rmap.get(m[2]) ?? "").replace(/^\/?xl\//, "")}` }));
  console.log(`形：新しい Excel（.xlsx）　シート ${シート.length}枚`);
  for (const sh of シート) {
    const x = (await zip.file(sh.場所)?.async("string")) ?? "";
    const 結合 = (x.match(/<mergeCell /g) ?? []).length;
    const セルたち = [...x.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)];
    let 文字のセル = 0;
    const 出す = 詳しく && (!シートの指定 || sh.名前.includes(シートの指定));
    if (出す) console.log(`## ${sh.名前}（${sh.場所}、結合 ${結合}）`);
    for (const [, r, a, inner] of セルたち) {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner ?? "")?.[1];
      const 文字 = a.includes('t="s"') && v ? 文字列[Number(v)] ?? "" : a.includes('t="inlineStr"') ? [...(inner ?? "").matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((y) => y[1]).join("") : "";
      if (!文字.trim()) continue;
      文字のセル++;
      見つけたら(`「${sh.名前.trim()}」${r}`, 文字.replace(/\s+/g, " ").trim());
      if (出す) console.log(`${r} ${JSON.stringify(文字.slice(0, 50))}`);
    }
    if (!詳しく) console.log(`  ${sh.名前.trim()}（文字のセル ${文字のセル}・結合 ${結合}）`);
  }
} else {
  console.log("形：zip だが、Word・Excel の中身が見つからない");
  結論("道具では書けません");
  process.exit(0);
}

console.log("\n見出しの場所（対応表の欄の候補。最初の3か所まで）");
for (const m of 見出したち) {
  const a = 見つけた.get(m.欄) ?? [];
  console.log(`  ${m.欄}：${a.length ? a.slice(0, 3).join("　") + (a.length > 3 ? `　ほか ${a.length - 3}か所` : "") : "見つからない"}`);
}

if (対応表) 結論(`確かめた対応表があります（${対応表.f}：${対応表.d.県名 ?? ""}「${対応表.d.名前 ?? ""}」）。道具で書けます`);
else
  結論(
    "新しい形なので、対応表を作れば道具で書けます。まだ対応表はありません。スキル「様式を診断する」の手順で、見出しの場所から対応表の下書きを作り、架空の事業者で試して、行政書士が確かめてから使ってください",
  );

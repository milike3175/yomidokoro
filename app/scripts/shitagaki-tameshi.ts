// npm run 下書きを試す -- <対応表の yaml> <様式の docx> <書き出す docx>
// 架空の事業者（和歌山環境サービス株式会社・梅干し 太郎）で下書きを書き、結果を出す。手元で崩れを見るための試し。依頼者の情報は使わない
import fs from "node:fs";
import { parse } from "yaml";
import JSZip from "jszip";
import { docxに書く, type 様式 } from "../src/lib/shoshiki.ts";

const [yml, docx, out] = process.argv.slice(2);
const 様 = parse(fs.readFileSync(yml, "utf8")) as 様式;
const 値たち = {
  "申請日.年": "8", "申請日.月": "11", "申請日.日": "5",
  住所: "640-0000 和歌山県和歌山市みなと町1丁目2番3号",
  ふりがな: "わかやまかんきょうさーびすかぶしきがいしゃ",
  氏名: "和歌山環境サービス株式会社",
  代表者: "代表取締役　梅干し　太郎",
  電話番号: "073-000-0000",
  // 既に持っている許可（架空の番号）
  "既許可1.県市": "和歌山県",
  "既許可1.番号": "第03000000001号",
  "既許可2.県市": "奈良県",
  "既許可2.番号": "申請中（令和8年10月1日申請）",
};
const 中身 = { 品目: [{ id: "廃プラスチック類", 石綿: "両方" as const }, { id: "がれき類", 石綿: "両方" as const }], 積替保管: "無" as const };
const r = await docxに書く(JSZip as never, new Uint8Array(fs.readFileSync(docx)), 様, 値たち, 中身, null);
if (!r.ok) { console.log("書けなかった：", r.理由); process.exit(1); }
fs.writeFileSync(out, r.バイト);
for (const x of r.結果) console.log(x.状態, x.見出し, x.説明.join(" / "));

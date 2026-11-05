// 様式を県のサイトから取ってきて、利用者フォルダに置き、sha256 を記録する（主の処理だけで使う）。
//
// - 置き場：<userData>/様式/<県コード>/<ファイル名>。記録は同じフォルダの _記録.json
// - 取ってくるのは県が公開している様式だけ。依頼者の情報は送らない（ふつうの GET を一回だけ）
// - 県のサイトがボット対策などで止めたら、回り道はしない。「手で取ってきてください」と返す
// - 取ってきたものが docx（zip）でなければ置かない
"use strict";

const { net } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * どの様式をどこから取るか。ファイルの直のリンクは 手引き/<県>/様式/_出典.txt から写した（公開情報）。
 * 期待する sha256 は、記入の対応表（app/data/様式/*.yaml）の sha256 を正とする。ここには書かない
 */
const 様式の目録 = {
  "30": {
    県名: "和歌山県",
    短い名前: "様式第六号（新規）",
    名前: "産業廃棄物収集運搬業許可申請書（様式第六号・新規）",
    url: "https://www.pref.wakayama.lg.jp/prefg/031800/032200/syu-un_d/fil/01futushinki20240624.docx",
    入口: "https://www.pref.wakayama.lg.jp/prefg/031800/032200/syu-un.html",
    ファイル名: "01futushinki20240624.docx",
    対応表: "30_和歌山_様式第六号.yaml",
  },
  // 2026-11-05：山形の様式第6号（入口の文書一覧から。手引き/06_山形県/_出典.yaml の 様式の取り寄せ と同じ）
  "06": {
    県名: "山形県",
    短い名前: "様式第6号",
    名前: "産業廃棄物収集運搬業許可申請書（様式第6号）",
    url: "https://www.pref.yamagata.jp/documents/17440/yo6-r060226.docx",
    入口: "https://www.pref.yamagata.jp/050010/kurashi/kankyo/haikibutsu/shorigyousha/horigyotetsuduki2020.html",
    ファイル名: "yo6-r060226.docx",
    対応表: "06_山形_様式第六号.yaml",
  },
};

const 大きさの上限 = 20 * 1024 * 1024;

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** 対応表の yaml から sha256 の一行だけ読む（yaml の読み手を入れないため、行で見る） */
function 対応表のsha(対応表の置き場, 名) {
  try {
    const t = fs.readFileSync(path.join(対応表の置き場, 名), "utf8");
    const m = t.match(/^sha256:\s*([0-9a-f]{64})\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function 置き場(userData, 県コード) {
  return path.join(userData, "様式", String(県コード));
}

/**
 * @returns {Promise<{ok:true, 名前:string, 置き場:string, sha256:string, 対応表と一致:boolean, 大きさ:number} | {ok:false, 理由:string, 入口:string}>}
 */
async function 様式を取ってくる(県コード, userData, 対応表の置き場) {
  const m = 様式の目録[県コードを直す(県コード)];
  if (!m) return { ok: false, 理由: `県コード ${県コード} の様式はまだ目録に無い`, 入口: "" };
  const 手で = (理由) => ({ ok: false, 理由, 入口: m.入口 });

  let res;
  try {
    res = await net.fetch(m.url, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*;q=0.8" },
      // クッキーは送らない・残さない
      credentials: "omit",
      cache: "no-store",
    });
  } catch (e) {
    return 手で(`県のサイトにつながらなかった（${e && e.message ? e.message : "通信の失敗"}）`);
  }
  if (res.status !== 200) return 手で(`県のサイトが断った（応答 ${res.status}）`);
  const 型 = res.headers.get("content-type") || "";
  if (/text\/html/i.test(型)) return 手で("様式ではなく、ふつうのページ（ボット対策の確認ページかもしれない）が返ってきた");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 大きさの上限) return 手で("思ったより大きいファイルが返ってきた");
  // docx は zip。頭が PK でなければ様式ではない
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return 手で("返ってきたものが docx（Word の様式）ではなかった");

  const sha = sha256(buf);
  const 期待 = 対応表のsha(対応表の置き場, m.対応表);
  const dir = 置き場(userData, 県コード);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, m.ファイル名);
  fs.writeFileSync(f, buf);
  const 記録f = path.join(dir, "_記録.json");
  let 記録 = [];
  try {
    記録 = JSON.parse(fs.readFileSync(記録f, "utf8"));
    if (!Array.isArray(記録)) 記録 = [];
  } catch {}
  const 一件 = {
    ファイル名: m.ファイル名,
    名前: m.名前,
    url: m.url,
    入口: m.入口,
    取得日時: new Date().toISOString(),
    sha256: sha,
    大きさ: buf.length,
    対応表のsha256: 期待,
    対応表と一致: 期待 === sha,
  };
  記録.push(一件);
  fs.writeFileSync(記録f, JSON.stringify(記録, null, 2) + "\n");
  return { ok: true, 名前: m.名前, 置き場: f, sha256: sha, 対応表と一致: 期待 === sha, 大きさ: buf.length };
}

function 県コードを直す(c) {
  return String(c).padStart(2, "0");
}

/**
 * 記入の画面へ渡す口：取ってきた様式の一覧。対応表と一致したものだけ中身（base64）を渡す。
 * 形は app/src/app/shoshiki/page.tsx の「手元の様式」と同じ { 県, ファイル名, sha256, 中身 }
 */
function 取ってきた様式の一覧(userData, 対応表の置き場) {
  const 知っている = new Set(Object.values(様式の目録).map((m) => 対応表のsha(対応表の置き場, m.対応表)).filter(Boolean));
  const root = path.join(userData, "様式");
  if (!fs.existsSync(root)) return [];
  const 一覧 = [];
  for (const 県 of fs.readdirSync(root).sort()) {
    const dir = path.join(root, 県);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!/\.(docx|xlsx)$/i.test(f)) continue;
      const buf = fs.readFileSync(path.join(dir, f));
      const sha = sha256(buf);
      一覧.push({ 県, ファイル名: f, sha256: sha, 中身: 知っている.has(sha) ? buf.toString("base64") : null });
    }
  }
  return 一覧;
}

module.exports = { 様式を取ってくる, 取ってきた様式の一覧, 様式の目録 };

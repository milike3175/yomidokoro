// 公開してよい様式ファイル（県の著作物）の一覧を読む。一覧の本体は app/data/公開する様式.yaml の一か所だけ。
// 使うところ：
//   - scripts/build-check.ts   out/ に一覧に無い様式・手引きの本体（docx・xlsx・pdf など）があれば止める
//   - scripts/kokai-mihari.ts  コミット・追跡中のファイルに一覧に無いものがあれば止める
//   - src/app/shoshiki/page.tsx  「この様式で試す」ボタンと出典の一文
// 許すのは中身の sha256 だけ。ファイル名や置き場所では許さない。
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export type 公開する様式 = {
  sha256: string;
  場所: string;
  県名: string;
  呼び名: string;
  出典の名前: string;
  入口: string;
  規約: string;
  規約の名前: string;
  取得日: string;
};

/** 止める拡張子（様式・手引きの本体になりうるもの） */
export const 本体の拡張子 = /\.(docx|xlsx|xlsm|xls|doc|pdf|odt|ods)$/i;

export function 公開する様式を読む(app: string): 公開する様式[] {
  const f = path.join(app, "data", "公開する様式.yaml");
  if (!fs.existsSync(f)) return [];
  const d = parse(fs.readFileSync(f, "utf8")) ?? {};
  const 一覧: 公開する様式[] = Array.isArray(d.様式) ? d.様式 : [];
  for (const x of 一覧) {
    if (!/^[0-9a-f]{64}$/.test(x?.sha256 ?? "")) throw new Error("公開する様式.yaml：sha256 の形が違う行がある");
    if (typeof x.場所 !== "string" || !x.場所.startsWith("/")) throw new Error("公開する様式.yaml：場所は / で始める");
  }
  return 一覧;
}

# よみどころ デスクトップ版（試し版）

`app/` の公開用の書き出し（`app/out`、TECHO=0）を、ダブルクリックで開けるアプリにしたもの。Electron で作っている。

- 画面は `yomi://app/` というアプリの中だけの住所で開く。ネットの口（ポート）は開かないので、ほかのパソコンからは接続できない
- 県のサイトや手引きの PDF へのリンクは、アプリの中では開かず、いつものブラウザで開く
- Claude の API は呼ばない。鍵も使わない
- 様式に書いた値・事業者の控えは、このパソコンの中だけで扱う。どこにも送らない
- 手帳（自分専用の電話の記録）は入っていない。入れる仕組みもまだ無い

## 開き方

### Windows
zip は二つある。どちらを使うかは、Windows の「設定」の「システム」の「バージョン情報」にある「システムの種類」で決める。

- 「ARM ベース プロセッサ」と書いてある（Mac の Parallels の Windows など）：`yomidokoro-0.0.2-win-arm64.zip`
- 「x64 ベース プロセッサ」と書いてある（ふつうの Windows 機）：`yomidokoro-0.0.2-win-x64.zip`

1. zip を Windows の中の場所（デスクトップやドキュメント）に置き、右クリックして「すべて展開」
   （Mac と共有しているフォルダ（`\\Mac\...`）の上では展開しない。Windows 側に写してから）
2. 展開したフォルダの中の `yomidokoro.exe` をダブルクリック
3. 青い画面「Windows によって PC が保護されました」が出たら、「詳細情報」を押し、「実行」を押す
   （署名をしていないアプリなので出る。一度実行すれば、次からは出ない）

zip のまま中の exe を開くと動かない。必ず展開してから開く。

開かずに閉じたときは、起動の記録 `%APPDATA%\yomidokoro\launch-log.txt` を作った人に送る
（エクスプローラーの住所の欄に `%APPDATA%\yomidokoro` と打つと開く）。
記録に書くのはアプリの動き（起動・窓・読み込み・落ちた理由）だけで、様式に書いた値や事業者の控えは書かない。
Mac では `~/Library/Application Support/yomidokoro/launch-log.txt`。

### Mac（Apple のチップの Mac）
1. `yomidokoro-0.0.2-arm64-mac.zip` をダブルクリックして展開し、`yomidokoro.app` を「アプリケーション」に移す
2. ダブルクリックすると「開いていません」「Apple は検証できませんでした」と出る。「完了」で閉じる
3. 「システム設定」の「プライバシーとセキュリティ」を開き、下の方の「yomidokoro がブロックされました」の横の「このまま開く」を押す。もう一度確認が出たら「開く」
   （古い macOS では、アプリを右クリックして「開く」でもよい）

## 様式を取ってくる

上の「ファイル」の献立から「和歌山県の様式第六号（新規）を県のサイトから取ってくる」を選ぶ。
取ってきた様式は、利用者フォルダの `様式/30/` に置かれ、sha256（ファイルの指紋）が `_記録.json` に残る。

- Windows：`%APPDATA%\yomidokoro\様式\`
- Mac：`~/Library/Application Support/yomidokoro/様式/`

県のサイトが断ったときは「手で取ってきてください」と出る。県のページを開いて自分で保存し、「様式に書く」画面に置けば使える。

## 作る人向け

```
cd app && npm run build          # TECHO=0 の公開用の書き出し（app/ の側）
cd ../desktop && npm install
npm start                        # app/out を _写し/ に写して開く
npm run 様式を試す                # 和歌山の様式を一回だけ取ってきて結果を出す
npm run 書き出し:win              # Windows の持ち運び版（zip、署名なし、x64 と arm64 の二つ）
npm run 書き出し:mac              # Mac 版（zip、署名なし）
```

`scripts/copy-out.mjs` は、`app/out` に手帳の帯（TECHO=1 の印）や、様式・手引きの本体（docx・xlsx・pdf など）があれば写さずに止める。例外は `app/data/公開する様式.yaml` に sha256 で許したもの（今は和歌山県の様式第六号だけ）。ファイル名ではなく中身の sha256 で見る。
書き出したもの（zip・exe・app）と `_写し/` は git に入れない（`.gitignore`）。

画面（`_写し/site`）と記入の対応表（`_写し/様式`）は app.asar の中に入れる。日本語のフォルダ名が asar の外に出ると、Windows の zip の展開で崩れることがあるため。
Windows では GPU を使わない（`app.disableHardwareAcceleration()`。Parallels などの仮想の画面で落ちるのを避ける）。

// 画面（app/out）から主の処理へ渡る口。ここに出したものだけが画面から使える。
// 出すのは「取ってきた様式の一覧」「様式を取ってくる」「様式を覚える」「落ちた様式を探す」「書き写す」「事業者の控え」「下書きの保存」の口だけ。
// 控えの書き込みは利用者フォルダの 控え/ の中に限る（主の処理で場所を決める）。ネットへの送信の口は出さない。
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("yomidokoro", {
  /** アプリの中で開いているか（ブラウザで開いたときは window.yomidokoro が無い） */
  版: "desktop",
  /** 取ってきた様式：[{ 県, ファイル名, sha256, 中身: base64 | null }]。形は様式に書く画面の「手元の様式」と同じ */
  取ってきた様式: () => ipcRenderer.invoke("様式の一覧"),
  /** 文字をクリップボードに書く（電話で聞くことの書き写し）→ true | false */
  書き写す: (文) => ipcRenderer.invoke("書き写す", 文),
  /** 事業者の控え。置き場は userData/控え/（Windows：%APPDATA%\yomidokoro\控え） */
  控え: {
    /** → { ok: true, ファイル名, 置き場 } | { ok: false, 理由 } */
    保存: (ファイル名, 中身) => ipcRenderer.invoke("控えを保存", ファイル名, 中身),
    /** → [{ ファイル名, 更新 }]（新しい順） */
    一覧: () => ipcRenderer.invoke("控えの一覧"),
    /** → { ok: true, 中身 } | { ok: false, 理由 } */
    開く: (ファイル名) => ipcRenderer.invoke("控えを開く", ファイル名),
    /** 置き場をエクスプローラー（Finder）で開く */
    置き場を開く: () => ipcRenderer.invoke("控えの置き場を開く"),
  },
  /** 申請書の下書き（docx）。置き場は 書類/よみどころ_下書き/ */
  下書き: {
    /** (ファイル名, Uint8Array) → { ok: true, ファイル名, 置き場 } | { ok: false, 理由 } */
    保存: (ファイル名, バイト, 小分け) => ipcRenderer.invoke("下書きを保存", ファイル名, バイト, 小分け),
    置き場を開く: (場所) => ipcRenderer.invoke("下書きの置き場を開く", 場所),
  },
  /** 県のサイトから様式を取ってくる（県コードと、どの様式かを指す対応表の sha256。無ければ申請書）→ { ok, 名前, 対応表と一致 } | { ok: false, 理由, 入口 } */
  様式を取ってくる: (県コード, sha256) => ipcRenderer.invoke("様式を取ってくる", 県コード, sha256),
  /** 手で置いた様式を覚える（ファイル名, base64）→ { ok, 県コード, 県名, 名前, ファイル名, 新しく } | { ok: false, 理由 } */
  様式を覚える: (ファイル名, base64) => ipcRenderer.invoke("様式を覚える", ファイル名, base64),
  /** ダウンロードのフォルダとデスクトップから様式を探して覚える → { 見た: [フォルダ], 見つけた: [{ 県コード, 県名, 名前, ファイル名, 新しく }] } */
  落ちた様式を探す: () => ipcRenderer.invoke("落ちた様式を探す"),
});

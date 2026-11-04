// 画面（app/out）から主の処理へ渡る口。ここに出したものだけが画面から使える。
// 出すのは「取ってきた様式の一覧」と「事業者の控え」の口だけ。
// 控えの書き込みは利用者フォルダの 控え/ の中に限る（主の処理で場所を決める）。ネットへの送信の口は出さない。
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("yomidokoro", {
  /** アプリの中で開いているか（ブラウザで開いたときは window.yomidokoro が無い） */
  版: "desktop",
  /** 取ってきた様式：[{ 県, ファイル名, sha256, 中身: base64 | null }]。形は様式に書く画面の「手元の様式」と同じ */
  取ってきた様式: () => ipcRenderer.invoke("様式の一覧"),
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
});

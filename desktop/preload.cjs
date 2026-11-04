// 画面（app/out）から主の処理へ渡る口。ここに出したものだけが画面から使える。
// 今は「取ってきた様式の一覧」を読む口だけ。書き込み・ネットへの送信の口は出さない。
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("yomidokoro", {
  /** アプリの中で開いているか（ブラウザで開いたときは window.yomidokoro が無い） */
  版: "desktop",
  /** 取ってきた様式：[{ 県, ファイル名, sha256, 中身: base64 | null }]。形は様式に書く画面の「手元の様式」と同じ */
  取ってきた様式: () => ipcRenderer.invoke("様式の一覧"),
});

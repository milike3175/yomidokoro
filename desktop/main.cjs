// よみどころ（試し版）の主の処理。
// - app/out（公開用の書き出し、TECHO=0）を、アプリの中だけの住所 yomi://app/ で配る。
//   ネットの口（ポート）は開かないので、外のパソコンからは接続できない。
// - 県のサイトへのリンクは、アプリの中では開かず、いつものブラウザで開く。
// - 様式を県のサイトから取ってきて、利用者フォルダ（userData/様式/）に置き、sha256 を記録する（lib/shutoku.cjs）。
// - Claude の API は呼ばない。鍵も扱わない。
"use strict";

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { 様式を取ってくる, 取ってきた様式の一覧, 様式の目録 } = require("./lib/shutoku.cjs");

const 住所 = "yomi";
const 家 = "app";

protocol.registerSchemesAsPrivileged([
  { scheme: 住所, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } },
]);

/** 書き出した画面の置き場。書き出したアプリでは resources/site、手元で動かすときは desktop/_写し/site */
function 画面の置き場() {
  return app.isPackaged ? path.join(process.resourcesPath, "site") : path.join(__dirname, "_写し", "site");
}
function 対応表の置き場() {
  return app.isPackaged ? path.join(process.resourcesPath, "様式の対応表") : path.join(__dirname, "_写し", "様式");
}

/** yomi://app/30/?手続き=新規 → site/30/index.html。置き場の外は返さない */
function 住所からファイル(urlText) {
  const root = 画面の置き場();
  const u = new URL(urlText);
  let p;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  const full = path.resolve(root, "." + p);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  const 候補 = [full, path.join(full, "index.html"), full + ".html"];
  for (const f of 候補) {
    try {
      if (fs.statSync(f).isFile()) return f;
    } catch {}
  }
  return null;
}

function 配る() {
  protocol.handle(住所, async (req) => {
    const u = new URL(req.url);
    if (u.host !== 家) return new Response("not found", { status: 404 });
    const f = 住所からファイル(req.url);
    if (f) return net.fetch(pathToFileURL(f).toString());
    const 無い = path.join(画面の置き場(), "404.html");
    if (fs.existsSync(無い)) {
      return new Response(fs.readFileSync(無い), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("not found", { status: 404 });
  });
}

function 外のリンクか(url) {
  try {
    const u = new URL(url);
    return !(u.protocol === `${住所}:` && u.host === 家);
  } catch {
    return true;
  }
}

function 外で開く(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") void shell.openExternal(url);
  } catch {}
}

function 窓を開く(はじめのページ = "/") {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "よみどころ（試し版）",
    backgroundColor: "#f4f0e6",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  // 県のサイト・手引きの PDF などは、いつものブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (外のリンクか(url)) 外で開く(url);
    else win.loadURL(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (外のリンクか(url)) {
      e.preventDefault();
      外で開く(url);
    }
  });
  win.loadURL(`${住所}://${家}${はじめのページ}`);
  return win;
}

async function 取ってきて知らせる(県コード, win) {
  const r = await 様式を取ってくる(県コード, app.getPath("userData"), 対応表の置き場());
  const 文 = r.ok
    ? `${r.名前}を取ってきた。\n置き場：${r.置き場}\nsha256：${r.sha256}\n${r.対応表と一致 ? "記入の対応表と一致した（この様式に書ける）" : "記入の対応表と一致しない。県が様式を改めた可能性がある。記入はまだできない"}`
    : `${r.理由}\n\n手で取ってきてください。\n県のページ：${r.入口}\n取ってきたファイルは、様式に書く画面に置けば使える。`;
  if (win && !win.isDestroyed()) {
    await dialog.showMessageBox(win, { type: r.ok ? "info" : "warning", title: "様式を取ってくる", message: 文, buttons: ["閉じる"] });
  }
  return r;
}

function 献立(win) {
  const 様式の項目 = Object.entries(様式の目録).map(([コード, m]) => ({
    label: `${m.県名}の${m.短い名前}を県のサイトから取ってくる`,
    click: () => void 取ってきて知らせる(コード, BrowserWindow.getFocusedWindow() ?? win),
  }));
  const 型 = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "ファイル",
      submenu: [
        ...様式の項目,
        {
          label: "取ってきた様式の置き場を開く",
          click: () => {
            const d = path.join(app.getPath("userData"), "様式");
            fs.mkdirSync(d, { recursive: true });
            void shell.openPath(d);
          },
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close", label: "閉じる" } : { role: "quit", label: "終わる" },
      ],
    },
    { role: "editMenu", label: "編集" },
    {
      label: "表示",
      submenu: [
        { label: "地図に戻る", accelerator: "CmdOrCtrl+H", click: () => (BrowserWindow.getFocusedWindow() ?? win)?.loadURL(`${住所}://${家}/`) },
        { role: "reload", label: "読み込み直す" },
        { type: "separator" },
        { role: "resetZoom", label: "文字を元の大きさに" },
        { role: "zoomIn", label: "文字を大きく" },
        { role: "zoomOut", label: "文字を小さく" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools", label: "開発者の道具" }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(型));
}

// 二つ目を開こうとしたら、一つ目の窓を前に出す
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(async () => {
    // カメラ・マイク・位置などの許可は全部断る
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    配る();

    ipcMain.handle("様式の一覧", () => 取ってきた様式の一覧(app.getPath("userData"), 対応表の置き場()));

    // 試し：YOMIDOKORO_SHUTOKU=30 なら、窓を出さずに一回だけ取ってきて結果を出して終わる
    if (process.env.YOMIDOKORO_SHUTOKU) {
      const r = await 様式を取ってくる(process.env.YOMIDOKORO_SHUTOKU, app.getPath("userData"), 対応表の置き場());
      console.log(JSON.stringify(r, null, 2));
      app.quit();
      return;
    }

    const win = 窓を開く(process.env.YOMIDOKORO_PAGE || "/");
    献立(win);

    // 試し：YOMIDOKORO_SHOT=<png> なら、読み込みの後に画面を写して終わる
    if (process.env.YOMIDOKORO_SHOT) {
      win.webContents.once("did-finish-load", () => {
        setTimeout(async () => {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.YOMIDOKORO_SHOT, img.toPNG());
          console.log(`写した：${process.env.YOMIDOKORO_SHOT}（${win.webContents.getURL()}）`);
          app.quit();
        }, 2500);
      });
    }
  });

  app.on("window-all-closed", () => app.quit());
}

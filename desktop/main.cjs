// よみどころ（試し版）の主の処理。
// - app/out（公開用の書き出し、TECHO=0）を、アプリの中だけの住所 yomi://app/ で配る。
//   ネットの口（ポート）は開かないので、外のパソコンからは接続できない。
// - 県のサイトへのリンクは、アプリの中では開かず、いつものブラウザで開く。
// - 様式を県のサイトから取ってきて、利用者フォルダ（userData/様式/）に置き、sha256 を記録する（lib/shutoku.cjs）。
// - 事業者の控えは利用者フォルダの 控え/ に置く（lib/hikae.cjs）。このパソコンの外には出さない。
// - Claude の API は呼ばない。鍵も扱わない。
"use strict";

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// ---- 起動の記録（launch-log.txt）----
// 一瞬で閉じたときに理由を追えるよう、起動の最初から時刻つきで書く。
// 置き場：userData/launch-log.txt（Windows：%APPDATA%\yomidokoro\launch-log.txt）。
// 書くのはアプリの動き（起動・窓・読み込み・落ちた理由）だけ。様式に書いた値や事業者の控えは書かない。
let 記録の置き場 = null;
function 記録の置き場を決める() {
  if (記録の置き場) return 記録の置き場;
  try {
    const d = app.getPath("userData");
    fs.mkdirSync(d, { recursive: true });
    記録の置き場 = path.join(d, "launch-log.txt");
  } catch {
    記録の置き場 = path.join(os.tmpdir(), "yomidokoro-launch-log.txt");
  }
  return 記録の置き場;
}
function 記録(...words) {
  try {
    const line = `${new Date().toISOString()} ${words.map((w) => (typeof w === "string" ? w : JSON.stringify(w))).join(" ")}\n`;
    fs.appendFileSync(記録の置き場を決める(), line);
  } catch {}
}
記録(
  "start",
  { version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron, os: os.release(), packaged: app.isPackaged, exe: process.execPath },
);
process.on("uncaughtException", (e) => {
  記録("uncaughtException", String(e && e.stack ? e.stack : e));
  try {
    dialog.showErrorBox("よみどころ：起動中にエラー", `${String(e && e.message ? e.message : e)}\n\n記録：${記録の置き場を決める()}`);
  } catch {}
  // 窓の無いまま残ると、次に開いたときに「二つ目」として黙って閉じてしまうので、ここで終える
  app.exit(1);
});
process.on("unhandledRejection", (e) => 記録("unhandledRejection", String(e && e.stack ? e.stack : e)));

// ---- 開いた場所の確かめ（Windows）----
// Chromium の守りの仕組み（サンドボックス）は、Mac と共有している場所（Parallels の C:\Mac\・\\Mac\・\\psf\）や
// ネットワークの場所の上では動かず、画面の処理が立ち上がれずに閉じる（launch-failed、アクセス拒否）。
// 守りの仕組みは切らない（--no-sandbox は使わない）。代わりに、場所を変えて開き直すよう案内して終える。
const 場所の案内 =
  "このアプリは Mac と共有している場所やネットワークの場所からは開けません。\n\n" +
  "Windows のフォルダ（例：C:\\yomidokoro）に zip を写して、そこで展開してから開いてください。";
let 案内した = false;
function 案内して終える(理由, 詳しく) {
  if (案内した) return;
  案内した = true;
  記録("unsupported location", 理由, 詳しく ?? {});
  try {
    dialog.showErrorBox("よみどころ：この場所からは開けません", `${場所の案内}\n\nいまの場所：${process.execPath}\n\n記録：${記録の置き場を決める()}`);
  } catch {}
  app.exit(1);
}
/** 共有・ネットワークの場所なら、その理由を返す。問題なければ null */
function 共有の場所か(p) {
  const s = String(p || "").replace(/\//g, "\\");
  const 小 = s.toLowerCase();
  if (/^[a-z]:\\mac(\\|$)/.test(小)) return "parallels shared folder (C:\\Mac\\)";
  if (小.startsWith("\\\\mac\\") || 小.startsWith("\\\\psf\\")) return "parallels shared folder (\\\\Mac\\ or \\\\psf\\)";
  if (小.startsWith("\\\\?\\unc\\")) return "network location (\\\\?\\UNC\\)";
  if (小.startsWith("\\\\") && !小.startsWith("\\\\?\\") && !小.startsWith("\\\\.\\")) return "network location (UNC)";
  return null;
}
/** ドライブ文字がネットワークドライブ（net use で割り当てたもの）か。C: は調べない */
function ネットワークドライブか(p) {
  const m = /^([a-zA-Z]):/.exec(String(p || ""));
  if (!m || m[1].toUpperCase() === "C") return false;
  try {
    const { spawnSync } = require("node:child_process");
    const r = spawnSync("net", ["use"], { encoding: "utf8", timeout: 3000, windowsHide: true });
    const 文字 = m[1].toUpperCase();
    return String(r.stdout || "")
      .split(/\r?\n/)
      .some((line) => new RegExp(`(^|\\s)${文字}:(\\s|$)`, "i").test(line));
  } catch {
    return false;
  }
}
if (process.platform === "win32") {
  const exe = process.execPath;
  let 本当の場所 = exe;
  try {
    本当の場所 = fs.realpathSync.native(exe);
  } catch {}
  const 理由 = 共有の場所か(exe) || 共有の場所か(本当の場所) || (ネットワークドライブか(exe) ? "network drive" : null);
  記録("location check", { exe, realpath: 本当の場所, result: 理由 || "ok" });
  if (理由) {
    案内して終える(理由, { exe, realpath: 本当の場所 });
    // app.exit の後に下の処理（窓を作るなど）へ進まないよう、ここで読み込みを止める（CommonJS の最上位の return）
    return;
  }
}

// Parallels などの仮想の画面で落ちることがあるので、Windows では GPU を使わない
if (process.platform === "win32") {
  app.disableHardwareAcceleration();
  記録("hardware acceleration disabled");
}

const { 様式を取ってくる, 取ってきた様式の一覧, 様式の目録 } = require("./lib/shutoku.cjs");
const 控え = require("./lib/hikae.cjs");
const 下書き = require("./lib/shitagaki.cjs");

const 住所 = "yomi";
const 家 = "app";

protocol.registerSchemesAsPrivileged([
  { scheme: 住所, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } },
]);

/** 書き出した画面の置き場。書き出したアプリでも手元でも desktop/_写し/site（書き出したアプリでは app.asar の中）。
 *  日本語のフォルダ名が asar の外に出ると、Windows の zip の展開で名前が崩れることがあるので、全部 asar に入れる */
function 画面の置き場() {
  return path.join(__dirname, "_写し", "site");
}
function 対応表の置き場() {
  return path.join(__dirname, "_写し", "様式");
}

const 種類 = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".yaml": "text/plain; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

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
    if (f) {
      // asar の中のファイルも読めるよう、fs で読んで返す
      try {
        const buf = await fs.promises.readFile(f);
        return new Response(buf, { status: 200, headers: { "content-type": 種類[path.extname(f).toLowerCase()] || "application/octet-stream" } });
      } catch (e) {
        記録("read failed", String(e));
        return new Response("read failed", { status: 500 });
      }
    }
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
  // 起動の記録と、読み込みに失敗したときの知らせ（白い画面のままにしない）
  記録("window created");
  win.webContents.on("did-finish-load", () => 記録("did-finish-load", win.webContents.getURL()));
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    記録("did-fail-load", { code, desc, url, isMainFrame });
    if (code === -3 || !isMainFrame || String(url).startsWith("data:")) return; // -3 は読み込みの取り消し（失敗ではない）
    const html = `<!doctype html><meta charset="utf-8"><title>よみどころ</title><body style="font-family:sans-serif;background:#f4f0e6;padding:2em;line-height:1.8">
<h1>画面を読み込めませんでした</h1><p>エラー：${code} ${String(desc).replace(/[<>&]/g, "")}</p>
<p>この記録のファイルを作った人に送ってください：<br><code>${記録の置き場を決める().replace(/[<>&]/g, "")}</code></p></body>`;
    void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  });
  // 窓の中身が読み込まれる前に、ページの処理が立ち上がれずに落ちる（launch-failed）ときは、
  // 開いた場所のせい（共有・ネットワークの場所でサンドボックスが動かない）であることが多い。
  // 一度だけ読み込み直し、それでも落ちたら場所を変えて開き直すよう案内して終える（黙って閉じない）。
  let 読み込めた = false;
  let 立ち上がれなかった回数 = 0;
  win.webContents.on("did-finish-load", () => {
    読み込めた = true;
  });
  win.webContents.on("render-process-gone", (_e, d) => {
    記録("render-process-gone", d);
    if (読み込めた || !d || d.reason !== "launch-failed") return;
    立ち上がれなかった回数 += 1;
    if (立ち上がれなかった回数 < 2 && !win.isDestroyed()) {
      記録("renderer launch-failed before first load; reloading once");
      win.webContents.reload();
      return;
    }
    案内して終える("renderer launch-failed before first load", { count: 立ち上がれなかった回数, details: d });
  });
  win.webContents.on("unresponsive", () => 記録("unresponsive"));
  win.on("closed", () => 記録("window closed"));
  win.loadURL(`${住所}://${家}${はじめのページ}`);
  記録("loadURL", `${住所}://${家}${はじめのページ}`);
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
          label: "申請書の下書きの置き場を開く",
          click: () => void shell.openPath(下書き.下書きの置き場(app.getPath("documents"))),
        },
        {
          label: "事業者の控えの置き場を開く",
          click: () => void shell.openPath(控え.控えの置き場(app.getPath("userData"))),
        },
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
// GPU などの処理が立ち上がれない（launch-failed）ときも、最初の画面が出る前なら場所の案内を出して終える。
// Chromium は GPU の処理が何度も立ち上がれないと自分で閉じてしまうので、二回目で案内する。
let 画面が出た = false;
let 子が立ち上がれなかった回数 = 0;
app.on("browser-window-created", (_e, w) => w.webContents.once("did-finish-load", () => (画面が出た = true)));
app.on("child-process-gone", (_e, d) => {
  記録("child-process-gone", d);
  if (画面が出た || !d || d.reason !== "launch-failed") return;
  子が立ち上がれなかった回数 += 1;
  if (子が立ち上がれなかった回数 >= 2) 案内して終える(`${d.type} launch-failed before first load`, { count: 子が立ち上がれなかった回数, details: d });
});
app.on("render-process-gone", (_e, _wc, d) => 記録("app render-process-gone", d));
app.on("will-quit", () => 記録("will-quit"));

if (!app.requestSingleInstanceLock()) {
  記録("another yomidokoro is already running; this one quits");
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
    try {
      await 起動する();
    } catch (e) {
      記録("startup failed", String(e && e.stack ? e.stack : e));
      try {
        dialog.showErrorBox("よみどころ：起動中にエラー", `${String(e && e.message ? e.message : e)}\n\n記録：${記録の置き場を決める()}`);
      } catch {}
      app.exit(1);
    }
  });

  async function 起動する() {
    記録("ready", { site: fs.existsSync(path.join(画面の置き場(), "index.html")), yaml: fs.existsSync(対応表の置き場()) });
    // カメラ・マイク・位置などの許可は全部断る
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    配る();

    ipcMain.handle("様式の一覧", () => 取ってきた様式の一覧(app.getPath("userData"), 対応表の置き場()));
    // 事業者の控え。中身は記録に書かない（失敗したときも理由の文だけ）
    const 控えの口 = (名前, f) =>
      ipcMain.handle(名前, (_e, ...a) => {
        try {
          return f(...a);
        } catch (e) {
          記録(`${名前} failed`, String(e && e.code ? e.code : "error"));
          return { ok: false, 理由: 名前.startsWith("下書き") ? "このパソコンの下書きの置き場（書類/よみどころ_下書き）に書けませんでした" : "このパソコンの控えの置き場に書けませんでした" };
        }
      });
    控えの口("控えを保存", (名, 中身) => 控え.控えを保存(app.getPath("userData"), 名, 中身));
    控えの口("控えの一覧", () => 控え.控えの一覧(app.getPath("userData")));
    控えの口("控えを開く", (名) => 控え.控えを開く(app.getPath("userData"), 名));
    // 電話で聞くことを書き写す（クリップボードに書くだけ。読む口は出さない）
    ipcMain.handle("書き写す", (_e, t) => {
      if (typeof t !== "string" || t.length > 20000) return false;
      clipboard.writeText(t);
      return true;
    });
    控えの口("控えの置き場を開く", () => shell.openPath(控え.控えの置き場(app.getPath("userData"))));
    // 申請書の下書き（docx）。置き場は 書類/よみどころ_下書き/
    控えの口("下書きを保存", (名, バイト) => 下書き.下書きを保存(app.getPath("documents"), 名, バイト));
    控えの口("下書きの置き場を開く", () => shell.openPath(下書き.下書きの置き場(app.getPath("documents"))));
    // 県のサイトから様式を取ってくる（目録にある県だけ。ふつうの GET を一回。依頼者の情報は送らない）
    ipcMain.handle("様式を取ってくる", async (_e, コード) => {
      try {
        const r = await 様式を取ってくる(String(コード ?? ""), app.getPath("userData"), 対応表の置き場());
        return r.ok ? { ok: true, 名前: r.名前, 対応表と一致: r.対応表と一致 } : { ok: false, 理由: r.理由, 入口: r.入口 };
      } catch (e) {
        記録("様式を取ってくる failed", String(e && e.code ? e.code : "error"));
        return { ok: false, 理由: "取ってこられませんでした", 入口: "" };
      }
    });

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
          // 試し：YOMIDOKORO_CLICK=<文字> なら、その文字を含むボタンを一つ押して、少し待ってから写す
          if (process.env.YOMIDOKORO_CLICK) {
            const r = await win.webContents.executeJavaScript(
              `(() => { const t = ${JSON.stringify(process.env.YOMIDOKORO_CLICK)}; const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(t)); if (!b) return "button not found"; b.click(); return "clicked: " + b.textContent; })()`,
            );
            console.log(r);
            await new Promise((ok) => setTimeout(ok, 3000));
          }
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.YOMIDOKORO_SHOT, img.toPNG());
          console.log(`写した：${process.env.YOMIDOKORO_SHOT}（${win.webContents.getURL()}）`);
          app.quit();
        }, 2500);
      });
    }
  }

  app.on("window-all-closed", () => app.quit());
}

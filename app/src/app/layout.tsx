import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";
import { 手帳を読む } from "@/lib/data";

// 書体は書き出し時に取り込み、自分のサイトから配る（見る人の端末から Google に問い合わせない）
const 本文書体 = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-body", display: "swap", preload: false });
const 見出し書体 = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-head",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "よみどころ｜ところ変われば、書き方も変わる。（産業廃棄物収集運搬業）",
  description: "県ごとのローカルルールを、手引き・受理実績・電話で聞いた答えに分けて一覧にする、行政書士の道具",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f0e6" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1b19" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${本文書体.variable} ${見出し書体.variable}`}>
      <body>
        {手帳を読む && (
          <div className="techo-banner">
            自分専用の手帳（電話の記録）を読み込んで表示しています。公開用の書き出し（npm run build）には入りません。
          </div>
        )}
        <header className="site-header">
          <div className="site-header-inner">
            <a href="/" className="site-title">
              よみどころ
            </a>
            <span className="site-catch">ところ変われば、書き方も変わる。</span>
            <nav className="site-nav" aria-label="画面">
              <a href="/">全国の地図</a>
              <a href="/shoshiki/">様式に書く（試し）</a>
              <a href="/jigyosha/">事業者の控え</a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          この一覧は、行政書士が自分の業務に使うために公開情報と自分のメモを整理したものです。申請前に窓口で再確認してください。
        </footer>
      </body>
    </html>
  );
}

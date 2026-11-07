export const metadata = { title: "電話の記録の入れ方｜よみどころ" };

export default function DenwaPage() {
  return (
    <>
      <a className="back" href="/">
        全国の地図へ戻る
      </a>
      <h1>電話の記録の入れ方</h1>
      <p className="lead">
        役所に電話で聞いた答えは、手元のメモや AI 議事録をそのまま渡すと、Claude が観点ごとに整え、担当者の名前を消し、日付と課名だけを残して、自分の手帳に記録します。
        手引きと食い違えば「揺れあり、要確認」の印が付きます。どちらが正しいかは道具が決めません。行政書士が決めます。
      </p>
      <p className="hint">
        取り込みの入口は、この公開版にも、ダウンロード版のアプリにもまだありません。どちらも Claude を呼ばない作りだからです。
        取り込みは、自分のパソコンで Claude Code か端末から動かします（Claude の API の鍵が要ります）。
      </p>

      <h2>手順</h2>
      <ol className="howto" aria-label="手順">
        <li>
          <b>置き場を手元に</b>
          <span>
            GitHub の <a href="https://github.com/milike3175/yomidokoro">milike3175/yomidokoro</a> を複製し、<code>app/.env</code> に Claude の API の鍵を置く（<code>cd app &amp;&amp; npm install</code>）
          </span>
        </li>
        <li>
          <b>電話の前に、聞くことをコピーする</b>
          <span>県のページの「電話で聞くこと」の「聞くことをコピーする」で問いを写し、メモ帳や議事録に貼って、電話をしながら答えを書き込む</span>
        </li>
        <li>
          <b>電話のあとに、渡す</b>
          <span>
            Claude Code でこのフォルダを開き、「電話メモ」と言ってメモの文を貼る。Notion の AI 議事録なら「この議事録を記録」と言って URL を貼る。端末なら <code>npm run 取込 -- 貼付</code>（貼り付け）や <code>npm run 取込 -- ファイル メモ.txt</code>
          </span>
        </li>
        <li>
          <b>見てから保存する</b>
          <span>
            Claude が整えた記録（許可権者・窓口・日付・観点・問い・答え）と、消した名前の数、止めた情報（住所・車両番号など）の数が出る。保存前に目で見て、よければ保存。手帳（<code>手帳/</code>）に入る。手帳は公開版にも GitHub にも出ない
          </span>
        </li>
        <li>
          <b>自分の地図で見る</b>
          <span>
            <code>cd app &amp;&amp; npm run dev</code> で開く自分の地図（手帳版）に、その県の「電話」の札で出る。載ったときの形は、この公開版の<a href="/27/?手続き=変更許可&品目=廃油">大阪府のページ</a>（作者の実際の記録7件。依頼者の情報と担当者の名前は除いてある）で見られる
          </span>
        </li>
      </ol>

      <h2>残すもの・残さないもの</h2>
      <ul>
        <li>共有する記録（公開版・GitHub・人に渡す形）には、担当者の個人名を残さない。日付と窓口（課名）だけ</li>
        <li>自分の手帳には、担当者の名前と「どの案件の電話か」を「手元だけ」の欄に残せる</li>
        <li>住所・氏名・生年月日・本籍・車両番号・電話番号は、どの欄にも残さない。混ざっていれば取り込みが外し、再検査で残っていれば保存しない</li>
      </ul>
      <p className="hint">
        この先：アプリ版で、県のページに電話のメモや議事録のファイルを落とすと、自分の鍵で同じ取り込みがアプリの中で動く形にする（README の「次にやること」）。公開版には入れない。
      </p>
    </>
  );
}

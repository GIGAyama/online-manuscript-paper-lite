/* 原稿用紙の組版（禁則処理）。アプリの中核。
 *
 * 画面に依らない純粋な計算なので、ここだけ切り出してテストできるようにしてある
 * （tests/genko-parser.test.mjs）。表示側は src/app.jsx の useGenkoParser から呼ぶ。
 *
 * 戻り値は「行の配列」。各行は1マス1要素の配列で、
 * ぶら下がりのときだけ chars を超える要素が付く（超えた分がマスの外に小さく出る）。 */

// 行のはじめに来てはいけない文字（句読点・閉じ括弧・小書き文字など）
const NO_START = ['、', '。', '」', '』', '）', 'っ', 'ゃ', 'ゅ', 'ょ', 'ッ', 'ャ', 'ュ', 'ョ', 'ー', ',', '.', ']', '}', '>', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ヮ', 'ヵ', 'ヶ', '・', '？', '！', '‼', '⁇', '々'];
// 行のおわりに来てはいけない文字（開き括弧）
const NO_END = ['「', '『', '（', '(', '[', '{', '<', '【', '〔', '［'];
// 1マスにまとめて入れる組み合わせ
const COMPRESSION_PAIRS = ['。」', '。』', '。）', '、」', '、』', '、）', '！』', '！」', '？』', '？」'];

/* ぶら下げられる数の上限。
 * 「たのしかった！！！」のように行頭禁則文字が続くと、上限が無ければ
 * その全部がマスの外へ伸び、印刷したときに用紙の枠からはみ出す。
 * 2マス分（例：「！」＋「！」）までに留め、あとは次の行の頭に置く。 */
const MAX_HANGING = 2;

/* 改行を LF に揃える。
 * textarea の値は LF に正規化されるが、ファイルから読み込んだ文字列や
 * 貼り付けの経路によっては CR が混じる。放っておくと \r が1マスを占め、
 * 原稿用紙に見えない空白のマスが並ぶ。 */
const toLines = (text) => (text || '').replace(/\r\n?/g, '\n').split('\n');

export const parseGenko = (doc, settings) => {
  const chars = settings.charsPerLine;
  const kinsokuMode = settings.kinsokuMode || 'burasagari';
  const lines = [];

  // --- ヘッダー生成（題名・学年・氏名） ---
  const titleParas = toLines(doc.title);
  titleParas.forEach((para) => {
    if (!para && lines.length === 0) return;
    let line = Array(chars).fill('');
    let cursor = 2; // 題名は2マス下げる
    Array.from(para).forEach((c) => {
      if (cursor >= chars) { lines.push(line); line = Array(chars).fill(''); cursor = 0; }
      line[cursor++] = c;
    });
    lines.push(line);
  });
  if (lines.length === 0 && !doc.title) lines.push(Array(chars).fill(''));

  const footerText = (`${doc.class || ''} ${doc.name || ''}`).trim();
  if (footerText) {
    const line = Array(chars).fill('');
    const start = Math.max(0, chars - footerText.length - 1); // 下から1マス空ける
    Array.from(footerText).forEach((c, i) => {
      if (start + i < chars) line[start + i] = c;
    });
    lines.push(line);
  }

  // --- 本文生成（禁則処理と圧縮） ---
  toLines(doc.content).forEach((para) => {
    if (!para) { lines.push(Array(chars).fill('')); return; }
    let line = [];
    const paraChars = Array.from(para);
    let i = 0;

    while (i < paraChars.length) {
      let char = paraChars[i];

      // 文字の圧縮（。」などを1マスに）
      if (i < paraChars.length - 1) {
        const pair = char + paraChars[i + 1];
        if (COMPRESSION_PAIRS.includes(pair)) { char = pair; i++; }
      }

      // 行末に開き括弧が来ないよう、先に次の行へ送る
      if (line.length === chars - 1 && NO_END.includes(char.charAt(0))) {
        lines.push(line);
        line = [char];
        i++;
        continue;
      }

      line.push(char); i++;

      // 行がいっぱいになったら
      if (line.length >= chars) {
        if (kinsokuMode === 'oidashi') {
          // 追い出し：次に来るのが行頭禁則文字なら、今の行の最後の1マスを次行へ送る
          if (i < paraChars.length) {
            let nextUnit = paraChars[i];
            if (i < paraChars.length - 1) {
              const nextPair = paraChars[i] + paraChars[i + 1];
              if (COMPRESSION_PAIRS.includes(nextPair)) nextUnit = nextPair;
            }
            if (NO_START.includes(nextUnit.charAt(0))) {
              const kicked = line.pop();
              lines.push(line);
              line = [kicked];
              continue;
            }
          }
          lines.push(line); line = [];
        } else {
          // ぶら下がり：行頭禁則文字が続く限り、マスの外へぶら下げる（上限あり）
          while (i < paraChars.length && line.length - chars < MAX_HANGING) {
            const nextStartChar = paraChars[i];
            let nextUnit = nextStartChar;
            let step = 1;
            if (i < paraChars.length - 1) {
              const nextPair = nextStartChar + paraChars[i + 1];
              if (COMPRESSION_PAIRS.includes(nextPair)) { nextUnit = nextPair; step = 2; }
            }
            if (NO_START.includes(nextUnit.charAt(0))) { line.push(nextUnit); i += step; } else break;
          }
          lines.push(line); line = [];
        }
      }
    }
    if (line.length > 0) lines.push(line);
  });

  return lines;
};

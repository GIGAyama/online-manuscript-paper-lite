/** Tailwind の設定（原本）。
 *  以前はこの内容を index.html の中に書き、cdn.tailwindcss.com が
 *  ブラウザの中で CSS を作っていた。学校のフィルタリングで CDN が塞がれると
 *  画面が真っ白になるため、ビルド時に CSS を作る形へ移した。 */
export default {
  content: ['./index.html', './offline.html', './src/**/*.{js,jsx}', './tools/**/*.mjs'],
  theme: {
    extend: {
      fontFamily: {
        // Web フォントが学校のフィルタリングで届かなくても字が崩れないよう、
        // 端末側の日本語フォントを必ず後ろに並べる（GIGA Standard v5 §2-7）
        sans: ['"Zen Maru Gothic"', '"Hiragino Maru Gothic ProN"', '"Yu Gothic UI"', '"Hiragino Kaku Gothic ProN"', '"Noto Sans JP"', 'system-ui', 'sans-serif'],
        genko: ['"Zen Old Mincho"', '"BIZ UDPMincho"', '"Hiragino Mincho ProN"', '"Yu Mincho"', 'serif'],
      },
      colors: {
        paper: '#fdfbf7',
        genkoLine: 'rgba(46, 125, 50, 0.4)',
        genkoStrong: 'rgba(46, 125, 50, 0.8)',
      },
    },
  },
  plugins: [],
};

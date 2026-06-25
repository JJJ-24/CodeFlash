// markdown-it-mark は型定義を同梱していないため最小限の宣言を置く。
// `==文字==` を <mark> としてトークン化する markdown-it プラグイン。
declare module 'markdown-it-mark' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markdownItMark: (md: any, ...params: any[]) => void;
  export default markdownItMark;
}

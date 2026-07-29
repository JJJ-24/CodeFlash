// 言語を追加する際はここだけ更新する
export const EXECUTABLE_LANGUAGES: string[] = ['javascript', 'typescript', 'python', 'sql', 'cpp', 'html', 'css'];

/** 実行に Pro プランが必要な言語。チケット016（課金）実装時に isPro チェックと連動させる */
export const PRO_LANGUAGES: string[] = ['sql', 'cpp', 'html', 'css'];

/** 言語選択モーダルに出る順序（この配列の順がそのまま一覧の並び）。
 *  **実行できる言語（EXECUTABLE_LANGUAGES）を先に**、ハイライトのみを後に置く。
 *  先頭4つの web 系（js/ts/html/css）は同じ HTML 土台モデルを共有し同じデッキで併用するため隣接させる。
 *  `text` は性質が違う（フォールバック）ので末尾。 */
export const LANGUAGES = [
  'javascript', 'typescript', 'html', 'css', 'python', 'sql', 'cpp',
  'java', 'swift', 'bash', 'json',
  'text',
];

export const LANG_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  sql: 'SQL',
  cpp: 'C++',
  java: 'Java',
  swift: 'Swift',
  bash: 'Bash',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  text: 'Plain',
};

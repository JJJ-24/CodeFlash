// 言語を追加する際はここだけ更新する
export const EXECUTABLE_LANGUAGES: string[] = ['javascript', 'typescript', 'python', 'sql', 'cpp', 'html'];

/** 実行に Pro プランが必要な言語。チケット016（課金）実装時に isPro チェックと連動させる */
export const PRO_LANGUAGES: string[] = ['sql', 'cpp', 'html'];

export const LANGUAGES = [
  'javascript', 'typescript', 'python', 'sql',
  'cpp', 'java', 'swift', 'bash', 'json', 'html', 'css', 'text',
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

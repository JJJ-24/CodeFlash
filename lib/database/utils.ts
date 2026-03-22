export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 今日のローカル日付を YYYY-MM-DD 形式で返す（タイムゾーン対応） */
export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * ローカル日付における「今日」の UTC タイムスタンプ範囲を返す。
 * UTC ISO 文字列で保存されたカラム（createdAt, lastReviewDate など）との
 * 比較に使用する。
 *   start: 今日のローカル 0:00 を UTC に変換した ISO 文字列
 *   end:   翌日のローカル 0:00 を UTC に変換した ISO 文字列
 */
export function todayLocalRange(): { start: string; end: string } {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { start: from.toISOString(), end: to.toISOString() };
}

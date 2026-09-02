import type { SQLiteDatabase } from 'expo-sqlite';

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

/**
 * アクティブ（非アーカイブ）カードの SQL 条件式を返す。
 * カード自身が非アーカイブ かつ 所属デッキが非アーカイブ のものだけが「学習対象」。
 * 「将来指標」（due・新規・未学習・習熟度・学習キュー）のクエリで使う。
 * 過去実績（review_logs / grade_logs ベースのヒートマップ・ストリーク・正答率）には使わない。
 *
 * @param alias カードテーブルのエイリアス（例 'c'）。エイリアス無しのときは '' を渡す。
 */
export function activeCardCond(alias = 'c'): string {
  const p = alias ? `${alias}.` : '';
  return `${p}archived = 0 AND ${p}deckId IN (SELECT id FROM decks WHERE archived = 0)`;
}

/** Date オブジェクトをローカル日付の YYYY-MM-DD 文字列に変換する */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * すでに `orderedIds` の並び（＝配列の添字がそのまま sortOrder）になっているか。
 *
 * ドラッグは**同じ位置に落としたときも `onDragEnd` が走る**ので、素直に書くと順序が
 * 1つも変わっていないのに全行を UPDATE することになる。行を書けば `sync_state` の
 * トリガーが `localVersion` を進めるため、iCloud 同期（＝相手端末での自動バックアップ）が
 * 発生し、しかも並べ替えは `updatedAt` を動かさないので復元画面からは
 * 「何が変わったのか読めない差分」として残る。書く前にこれで確かめて、
 * 変化が無ければ何もしない。
 *
 * @param table 呼び出し側の固定文字列のみ（外部入力を受けない＝SQL に直接埋めてよい）
 */
export async function isSameSortOrder(
  db: SQLiteDatabase,
  table: 'decks' | 'cards' | 'tags',
  orderedIds: string[]
): Promise<boolean> {
  const inList = orderedIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  const rows = await db.getAllAsync<{ id: string; sortOrder: number }>(
    `SELECT id, sortOrder FROM ${table} WHERE id IN (${inList})`
  );
  // 件数が合わない＝削除済み id が混ざっている等。判断できないので「変化あり」に倒す。
  if (rows.length !== orderedIds.length) return false;
  const current = new Map(rows.map((r) => [r.id, r.sortOrder]));
  return orderedIds.every((id, i) => current.get(id) === i);
}

/** 2つの YYYY-MM-DD ローカル日付の日数差（b - a）。
 *  **DST の影響を避けるため UTC 換算で計算する**（ローカルの Date 差だと夏時間の日に 23/25 時間になる）。
 *  「暦日が連続しているか」（＝差が 1）の判定に使う。 */
export function localDateDiffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/**
 * 曜日名・月名のラベル（047 Phase 0）。
 *
 * **言語ごとのテーブルを持たない**のが要点＝`Intl` に任せるので、対応言語を増やしても
 * ここは触らなくてよい（以前は `['Jan','Feb',…]` と `['日','月',…]` を各所にハードコードし、
 * 「日本語か、それ以外は英語」の二択で分岐していた＝第3の言語ではそこだけ英語になる）。
 *
 * ⚠️ Hermes に `Intl.DisplayNames` は無いが `DateTimeFormat` はある（CLAUDE.md）。
 *    ヒートマップの月ラベルが既に `toLocaleDateString` で動いているので実機でも確認済み。
 * ⚠️ 基準日は **UTC で作り `timeZone: 'UTC'` で整形する**（ローカル時刻で作ると端末の
 *    タイムゾーン次第で1日ずれた曜日名になる）。
 */

const DAY_MS = 86400000;
// 2023-01-01 は日曜。ここから7日ぶんで「日〜土」が順に揃う。
const WEEK_REF_UTC = Date.UTC(2023, 0, 1);

// 言語が変わるまで結果は不変なので使い回す（描画のたびに Intl を作らない）。
const cache = new Map<string, string[]>();

/** 曜日ラベル（`[0]` = 日曜＝`Date.getDay()` の戻り値でそのまま引ける）。 */
export function weekdayLabels(locale: string, width: 'short' | 'narrow' = 'short'): string[] {
  const key = `${locale}:${width}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const fmt = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' });
  const labels = Array.from({ length: 7 }, (_, i) => fmt.format(new Date(WEEK_REF_UTC + i * DAY_MS)));
  cache.set(key, labels);
  return labels;
}

/** 月ラベル（`monthIndex` は 0 = 1月＝`Date.getMonth()` と同じ）。ja は「1月」・en は「Jan」。 */
export function monthLabel(locale: string, monthIndex: number): string {
  const key = `${locale}:month`;
  let labels = cache.get(key);
  if (!labels) {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    labels = Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2023, i, 1))));
    cache.set(key, labels);
  }
  return labels[monthIndex];
}

/** `YYYY-MM-DD`（ローカル日付の文字列）を「2025年3月1日」「Mar 1, 2025」の形にする（バッジの獲得日など）。
 *  文字列を UTC の日付として作り `timeZone: 'UTC'` で整形する＝端末のタイムゾーンで1日ずれない。
 *  壊れた文字列はそのまま返す（一覧を壊さない）。 */
export function formatDateLabel(locale: string, dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

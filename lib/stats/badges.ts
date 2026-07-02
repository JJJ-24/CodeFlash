// 統計：草グラフモーダルの「獲得バッジ」定義（20個）。
// 判定に使う指標（最長連続・累計回数・累計日数）はすべて単調増加なので、「現在値 ≧ 閾値」で
// 判定すれば一度獲得したバッジは消えない（＝獲得状態の保存が不要）。
// 連続日数バッジは統計フィルターブロックの常設メダル（getStreakMedal）と同じアイコン・色を使う
// ため STREAK_MEDALS を唯一の定義元とし、フィルターブロック側もこれを参照する。
import type { LifetimeStats } from '@/lib/database/reviews';

export type BadgeKind = 'streak' | 'reviews' | 'days' | 'special';

export interface BadgeDef {
  id: string;
  kind: BadgeKind;
  /** 獲得閾値（streak/days=日数、reviews=回数） */
  threshold: number;
  /** アイコンセット。連続メダルは Ionicons、その他は FontAwesome5(solid)。 */
  iconSet: 'ionicons' | 'fa5';
  icon: string;
  /** 獲得時の色（連続はメダルの段位色、その他はカテゴリ色）。 */
  color: string;
  /** セル内に出す短いラベル（単位はセクション見出しで補う）。 */
  short: string;
}

/** 連続日数の常設メダル（統計フィルターブロックと共通の唯一定義元）。閾値昇順。
 *  ribbon×3（銅/銀/金）→ trophy×3（銅/銀/金）→ diamond×4（水色/桃/金/黒）。 */
export const STREAK_MEDALS: { threshold: number; icon: string; color: string }[] = [
  { threshold: 3, icon: 'ribbon', color: '#CD7F32' },
  { threshold: 10, icon: 'ribbon', color: '#d7d7d7' },
  { threshold: 30, icon: 'ribbon', color: '#FFD700' },
  { threshold: 100, icon: 'trophy', color: '#CD7F32' },
  { threshold: 200, icon: 'trophy', color: '#d7d7d7' },
  { threshold: 300, icon: 'trophy', color: '#FFD700' },
  { threshold: 365, icon: 'diamond', color: '#77eeff' },
  { threshold: 500, icon: 'diamond', color: '#ff9ff9' },
  { threshold: 730, icon: 'diamond', color: '#FFD700' },
  { threshold: 1000, icon: 'diamond', color: '#000000' },
];

/** サプライズメダル（フィルターブロックで一定レンジの数日間だけ表示される隠しアイコン）。
 *  window はフィルターブロックで表示する日数幅（threshold〜threshold+window）。バッジ獲得は
 *  「最長連続 ≧ threshold」＝そのレンジに到達したことがあれば永久獲得。getStreakMedal と共通の定義元。 */
export const SURPRISE_STREAKS: { threshold: number; window: number; icon: string; color: string }[] = [
  { threshold: 50, window: 2, icon: 'bug', color: '#94e438' },
  { threshold: 150, window: 2, icon: 'walk', color: '#ffffff' },
  { threshold: 250, window: 2, icon: 'fish', color: '#4ac5fd' },
  { threshold: 350, window: 2, icon: 'bicycle', color: '#f88e42' },
  { threshold: 400, window: 2, icon: 'boat', color: '#98fff5' },
  { threshold: 450, window: 2, icon: 'car-sport', color: '#f72e2e' },
  { threshold: 600, window: 2, icon: 'train', color: '#f5cba7' },
  { threshold: 777, window: 0, icon: 'flower', color: '#fc94b7' },
  { threshold: 800, window: 2, icon: 'airplane', color: '#3beb90' },
  { threshold: 900, window: 2, icon: 'rocket', color: '#ea42fc' },
];

const REVIEW_COLOR = '#1976D2';
const DAYS_COLOR = '#43A047';
const SPECIAL_COLOR = '#8E24AA';
const TEN_HOURS_MS = 10 * 60 * 60 * 1000;

// 連続日数バッジ＝常設メダル＋サプライズメダルを閾値昇順で並べた 20 個。
const STREAK_ALL = [
  ...STREAK_MEDALS,
  ...SURPRISE_STREAKS.map((s) => ({ threshold: s.threshold, icon: s.icon, color: s.color })),
].sort((a, b) => a.threshold - b.threshold);

export const BADGE_SECTIONS: { kind: BadgeKind; labelKey: string }[] = [
  { kind: 'streak', labelKey: 'stats.badgeSectionStreak' },
  { kind: 'reviews', labelKey: 'stats.badgeSectionReviews' },
  { kind: 'days', labelKey: 'stats.badgeSectionDays' },
  { kind: 'special', labelKey: 'stats.badgeSectionSpecial' },
];

export const BADGES: readonly BadgeDef[] = [
  // 連続日数（20）＝常設メダル10＋サプライズメダル10
  ...STREAK_ALL.map((m): BadgeDef => ({
    id: `streak${m.threshold}`,
    kind: 'streak',
    threshold: m.threshold,
    iconSet: 'ionicons',
    icon: m.icon,
    color: m.color,
    short: String(m.threshold),
  })),
  // 累計学習回数（6）
  { id: 'rev100', kind: 'reviews', threshold: 100, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '100' },
  { id: 'rev500', kind: 'reviews', threshold: 500, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '500' },
  { id: 'rev1000', kind: 'reviews', threshold: 1000, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '1k' },
  { id: 'rev3000', kind: 'reviews', threshold: 3000, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '3k' },
  { id: 'rev5000', kind: 'reviews', threshold: 5000, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '5k' },
  { id: 'rev10000', kind: 'reviews', threshold: 10000, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '10k' },
  // 累計学習日数（4）
  { id: 'days10', kind: 'days', threshold: 10, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '10' },
  { id: 'days30', kind: 'days', threshold: 30, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '30' },
  { id: 'days100', kind: 'days', threshold: 100, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '100' },
  { id: 'days365', kind: 'days', threshold: 365, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '365' },
  // 特別（1）＝総学習時間
  { id: 'time10h', kind: 'special', threshold: TEN_HOURS_MS, iconSet: 'fa5', icon: 'stopwatch', color: SPECIAL_COLOR, short: '10h' },
] as const;

/** そのバッジを獲得済みか（単調増加指標なので一度 true になれば以後も true）。 */
export function isBadgeEarned(b: BadgeDef, s: LifetimeStats): boolean {
  switch (b.kind) {
    case 'streak':
      return s.longestStreak >= b.threshold;
    case 'reviews':
      return s.totalReviews >= b.threshold;
    case 'days':
      return s.totalDays >= b.threshold;
    case 'special':
      return s.totalTimeMs >= b.threshold;
  }
}

/** 獲得済みバッジ数。 */
export function earnedBadgeCount(s: LifetimeStats): number {
  return BADGES.reduce((n, b) => n + (isBadgeEarned(b, s) ? 1 : 0), 0);
}

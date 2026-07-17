// 統計：草グラフモーダルの「獲得バッジ」定義。
// 連続日数20（常設メダル10＋サプライズ10）＋ 回数/時間/日数 各10個。
// 回数/時間/日数は同じ数列を3周まで集められる周回（プレステージ）方式。
// 表示上の総数（分母）は段階開放：50 →（どれかが2周目に入ると）80 →（3周目で）110。
// 判定に使う指標（最長連続・累計回数・累計時間・累計日数）はすべて単調増加なので、「現在値 ≧ 閾値」で
// 判定すれば一度獲得したバッジは消えない（＝獲得状態の保存が不要。周回レベルも同様に都度計算）。
// 連続日数バッジは統計フィルターブロックの常設メダル（getStreakMedal）と同じアイコン・色を使う
// ため STREAK_MEDALS を唯一の定義元とし、フィルターブロック側もこれを参照する。
import type { LifetimeStats } from '@/lib/database/reviews';

export type BadgeKind = 'streak' | 'reviews' | 'time' | 'days';

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
const TIME_COLOR = '#F57C00'; // 学習時間＝オレンジ（記録シートの時間ブロック FILTER_COLORS.due と同色）
const DAYS_COLOR = '#43A047';
const HOUR_MS = 60 * 60 * 1000;

// 連続日数バッジ＝常設メダル＋サプライズメダルを閾値昇順で並べた 20 個。
const STREAK_ALL = [
  ...STREAK_MEDALS,
  ...SURPRISE_STREAKS.map((s) => ({ threshold: s.threshold, icon: s.icon, color: s.color })),
].sort((a, b) => a.threshold - b.threshold);

export const BADGE_SECTIONS: { kind: BadgeKind; labelKey: string }[] = [
  { kind: 'streak', labelKey: 'stats.badgeSectionStreak' },
  { kind: 'reviews', labelKey: 'stats.badgeSectionReviews' },
  { kind: 'time', labelKey: 'stats.badgeSectionTime' },
  { kind: 'days', labelKey: 'stats.badgeSectionDays' },
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
  // 累計学習回数（10）＝約1年（1日30枚弱）で1周する刻み
  { id: 'rev100', kind: 'reviews', threshold: 100, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '100' },
  { id: 'rev300', kind: 'reviews', threshold: 300, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '300' },
  { id: 'rev500', kind: 'reviews', threshold: 500, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '500' },
  { id: 'rev1000', kind: 'reviews', threshold: 1000, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '1k' },
  { id: 'rev1500', kind: 'reviews', threshold: 1500, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '1.5k' },
  { id: 'rev2000', kind: 'reviews', threshold: 2000, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '2k' },
  { id: 'rev3000', kind: 'reviews', threshold: 3000, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '3k' },
  { id: 'rev5000', kind: 'reviews', threshold: 5000, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '5k' },
  { id: 'rev7000', kind: 'reviews', threshold: 7000, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '7k' },
  { id: 'rev10000', kind: 'reviews', threshold: 10000, iconSet: 'fa5', icon: 'layer-group', color: REVIEW_COLOR, short: '10k' },
  // 学習時間（10）＝総学習時間
  { id: 'time1h', kind: 'time', threshold: 1 * HOUR_MS, iconSet: 'fa5', icon: 'stopwatch', color: TIME_COLOR, short: '1h' },
  { id: 'time3h', kind: 'time', threshold: 3 * HOUR_MS, iconSet: 'fa5', icon: 'stopwatch', color: TIME_COLOR, short: '3h' },
  { id: 'time5h', kind: 'time', threshold: 5 * HOUR_MS, iconSet: 'fa5', icon: 'stopwatch', color: TIME_COLOR, short: '5h' },
  { id: 'time7h', kind: 'time', threshold: 7 * HOUR_MS, iconSet: 'fa5', icon: 'stopwatch', color: TIME_COLOR, short: '7h' },
  { id: 'time10h', kind: 'time', threshold: 10 * HOUR_MS, iconSet: 'fa5', icon: 'stopwatch', color: TIME_COLOR, short: '10h' },
  { id: 'time15h', kind: 'time', threshold: 15 * HOUR_MS, iconSet: 'fa5', icon: 'stopwatch', color: TIME_COLOR, short: '15h' },
  { id: 'time20h', kind: 'time', threshold: 20 * HOUR_MS, iconSet: 'fa5', icon: 'stopwatch', color: TIME_COLOR, short: '20h' },
  { id: 'time30h', kind: 'time', threshold: 30 * HOUR_MS, iconSet: 'fa5', icon: 'stopwatch', color: TIME_COLOR, short: '30h' },
  { id: 'time40h', kind: 'time', threshold: 40 * HOUR_MS, iconSet: 'fa5', icon: 'stopwatch', color: TIME_COLOR, short: '40h' },
  { id: 'time50h', kind: 'time', threshold: 50 * HOUR_MS, iconSet: 'fa5', icon: 'stopwatch', color: TIME_COLOR, short: '50h' },
  // 累計学習日数（10）＝毎日続けて約1年で1周
  { id: 'days10', kind: 'days', threshold: 10, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '10' },
  { id: 'days30', kind: 'days', threshold: 30, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '30' },
  { id: 'days50', kind: 'days', threshold: 50, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '50' },
  { id: 'days70', kind: 'days', threshold: 70, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '70' },
  { id: 'days100', kind: 'days', threshold: 100, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '100' },
  { id: 'days150', kind: 'days', threshold: 150, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '150' },
  { id: 'days200', kind: 'days', threshold: 200, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '200' },
  { id: 'days250', kind: 'days', threshold: 250, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '250' },
  { id: 'days300', kind: 'days', threshold: 300, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '300' },
  { id: 'days365', kind: 'days', threshold: 365, iconSet: 'fa5', icon: 'calendar-check', color: DAYS_COLOR, short: '365' },
] as const;

// ---- 周回（プレステージ）----
// 回数/時間/日数は同じ数列を BADGE_MAX_LAP 周まで集められる（連続日数は対象外＝1周のみ）。
// 周回 l（1〜3）の獲得条件は「累計値 ≧ (l-1)×周回サイズ + threshold」（周回サイズ＝カテゴリの最終閾値）。
// 1周目を完集してから2周目が始まるオフセット方式＝2年目・3年目も1年目と同じペースでバッジが増える。
export const BADGE_MAX_LAP = 3;

const LAP_SIZE: Record<Exclude<BadgeKind, 'streak'>, number> = {
  reviews: 10000,
  time: 50 * HOUR_MS,
  days: 365,
};

// 2周目/3周目の見た目（べた塗り背景＋銀/金アイコン）用。連続日数メダルの銀/金と同色。
export const LAP_SILVER = '#d7d7d7';
export const LAP_GOLD = '#FFD700';

/** 獲得済み周回数（0=未獲得〜BADGE_MAX_LAP）。streak は 0/1。単調増加指標なので下がらない。 */
export function badgeLevel(b: BadgeDef, s: LifetimeStats): number {
  if (b.kind === 'streak') return s.longestStreak >= b.threshold ? 1 : 0;
  const value = b.kind === 'reviews' ? s.totalReviews : b.kind === 'time' ? s.totalTimeMs : s.totalDays;
  const lapSize = LAP_SIZE[b.kind];
  let level = 0;
  for (let l = 1; l <= BADGE_MAX_LAP; l++) {
    if (value >= (l - 1) * lapSize + b.threshold) level = l;
  }
  return level;
}

/** そのバッジを獲得済みか（1周目以上。単調増加指標なので一度 true になれば以後も true）。 */
export function isBadgeEarned(b: BadgeDef, s: LifetimeStats): boolean {
  return badgeLevel(b, s) >= 1;
}

/** 獲得済みバッジ数（周回込み＝連続は各1・回数/時間/日数は獲得周回数を加算）。 */
export function earnedBadgeCount(s: LifetimeStats): number {
  return BADGES.reduce((n, b) => n + badgeLevel(b, s), 0);
}

/** 開放段階（1〜3）：どれかのカテゴリが2周目に入ると2、3周目に入ると3。
 *  表示上の総バッジ数（badgeTotal）を段階的に増やす（最初から110は遠すぎるため）。 */
export function badgeStage(s: LifetimeStats): number {
  let stage = 1;
  for (const b of BADGES) {
    if (b.kind === 'streak') continue;
    const lv = badgeLevel(b, s);
    if (lv >= 3) return 3;
    if (lv >= 2) stage = 2;
  }
  return stage;
}

/** 表示上の総バッジ数（段階開放）：stage 1=50 / 2=80 / 3=110。 */
export function badgeTotal(stage: number): number {
  return BADGES.reduce((n, b) => n + (b.kind === 'streak' ? 1 : Math.min(stage, BADGE_MAX_LAP)), 0);
}

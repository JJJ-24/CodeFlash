/**
 * 046：1日の目標枚数の判定。
 *
 * 目標は**1日単位**（セッション単位ではない）で、学習画面の達成アラートと
 * Phase 2 の未達成リマインダーが**同じ目標を共有する**。
 * 判定そのものはここに純粋関数として置き、画面側は「今日の枚数を数えて渡す」だけにする
 * （UI を描かずに検証できるようにするため）。
 */

import { localDateDiffDays } from '@/lib/database/utils';

/** 達成アラートを出すか。**閾値を「またいだ」ときだけ true**。
 *
 * @param todayCount     今日学習したカード枚数（`getTodayReviewedCount`＝同じカードを何度評価しても1枚）
 * @param goal           目標枚数
 * @param metAtStart     セッション開始時点で既に達成済みだったか。**null = 未確定**
 * @param alreadyFired   このセッションで既に出したか
 *
 * `metAtStart` が true のときに出さないのは、目標が1日単位だからで、達成済みの日に新しい
 * セッションを始めた瞬間にアラートが出てしまうのを防ぐ。**未確定（null）でも出さない**
 * ＝基準が分からない状態での誤発火より、不発を選ぶ。
 */
export function shouldFireStudyGoal(
  todayCount: number,
  goal: number,
  metAtStart: boolean | null,
  alreadyFired: boolean
): boolean {
  if (alreadyFired) return false;
  if (metAtStart !== false) return false;
  return todayCount >= goal;
}

/** 未達成か（Phase 2 のリマインダー判定で使う）。目標 OFF のときは呼ばない前提。 */
export function isStudyGoalUnmet(todayCount: number, goal: number): boolean {
  return todayCount < goal;
}

// ---- 過去の達成の集計（046 Phase 5・統計「学習の記録」） ---------------------
// **目標値の履歴は持たない**＝過去の日も「現在の目標枚数」で判定する（A案）。
// 目標を変えると過去の達成日数も変わるが、①目標は「今の自分の基準」で1つしか無い
// ②日ごとの目標を記録する方式は導入日より前が永久に空白になる、ため現在値方式を選んだ。
// 経緯は `docs/046`。判定を UI から切り離してあるので `npm run verify:db` で検証できる。

/** 日別の学習枚数（学習した日だけ・**日付昇順**）。`LifetimeStats.dailyCounts` がこの形。 */
export interface DailyStudyCount {
  /** ローカル日付 YYYY-MM-DD */
  date: string;
  /** その日に学習した実カード枚数 */
  count: number;
}

export interface GoalDayStats {
  /** 目標に届いた日数（累計） */
  achievedDays: number;
  /** 目標に届いた日が**暦日で連続した**最長日数。休んだ日・未達成の日で切れる */
  longestAchievedStreak: number;
  /** 達成率（%・四捨五入）。**分母は「学習した日」**＝学習日が0なら null。
   *  経過日数を分母にしないのは、それだと「学習継続率」（学習日÷経過日数）と情報が重なり、
   *  休んだ日で二重に減点されるため。2つを掛ければ全日ベースの達成率になる＝指標が直交する。 */
  achievementRate: number | null;
}

/**
 * 日別の学習枚数から、目標達成の累計・最長連続・達成率を求める。
 *
 * @param daily 日別の学習枚数（**日付昇順**。学習していない日は行そのものが無い）
 * @param goal  目標枚数（`studyGoalCount`。ストア側で 1〜999 にクランプ済み）
 */
export function computeGoalDayStats(daily: DailyStudyCount[], goal: number): GoalDayStats {
  let achievedDays = 0;
  let longest = 0;
  let run = 0;
  // 「直前に達成した日」だけを覚える。未達成の日・学習していない日は行が飛ぶか記録しないので、
  // 次の達成日との差が 1 でなくなり run が 1 に戻る（＝連続が切れる）。
  let prevAchieved: string | null = null;
  for (const { date, count } of daily) {
    if (count < goal) continue;
    achievedDays++;
    run = prevAchieved !== null && localDateDiffDays(prevAchieved, date) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prevAchieved = date;
  }
  return {
    achievedDays,
    longestAchievedStreak: longest,
    achievementRate: daily.length > 0 ? Math.round((achievedDays / daily.length) * 100) : null,
  };
}

// ---- 未達成リマインダーの予約枠（046 Phase 2） -------------------------------
// 未達成リマインダーは「今日だけスキップ」ができないため繰り返し予約が使えず、
// **日付指定で数日分を個別に予約**する＝1つのスケジュールが先読み日数ぶんの枠を消費する。
// 通常のスケジュールも曜日指定があると曜日ごとに1件使うため、合計が iOS の上限に届きうる。

/** iOS が1アプリに許す保留ローカル通知の上限。**超えると古いものから黙って捨てられる**
 *  （エラーは出ず「設定したはずの通知が一部だけ来ない」という分かりにくい壊れ方をする）。 */
export const PENDING_NOTIFICATION_LIMIT = 64;

/** 未達成リマインダーに配ってよい枠。上限との差は休憩終了通知（039）などの臨時予約に残す。 */
export const PENDING_NOTIFICATION_BUDGET = 60;

/** 未達成リマインダーを前倒し予約する最大日数。 */
export const GOAL_LOOKAHEAD_MAX_DAYS = 7;

/**
 * 未達成リマインダーの先読み日数を、残りの予約枠から決める。
 * 1日まで縮んでも機能は成立する（アプリを開くたびに積み直されるため）。
 *
 * @param plainRegistrations 通常スケジュールが使う予約数（曜日指定なし=1・ありは曜日の数）
 * @param conditionalCount   未達成リマインダーのスケジュール件数（1以上）
 */
export function computeGoalLookaheadDays(plainRegistrations: number, conditionalCount: number): number {
  if (conditionalCount <= 0) return 0;
  const budget = Math.max(PENDING_NOTIFICATION_BUDGET - plainRegistrations, conditionalCount);
  return Math.max(1, Math.min(GOAL_LOOKAHEAD_MAX_DAYS, Math.floor(budget / conditionalCount)));
}

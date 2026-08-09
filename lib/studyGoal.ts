/**
 * 046：1日の目標枚数の判定。
 *
 * 目標は**1日単位**（セッション単位ではない）で、学習画面の達成アラートと
 * Phase 2 の未達成リマインダーが**同じ目標を共有する**。
 * 判定そのものはここに純粋関数として置き、画面側は「今日の枚数を数えて渡す」だけにする
 * （UI を描かずに検証できるようにするため）。
 */

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

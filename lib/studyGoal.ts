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

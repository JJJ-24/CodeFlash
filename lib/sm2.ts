/**
 * SM-2 ベースの間隔反復アルゴリズム
 *
 * grade:
 *   0 = もう一度（Again）
 *   1 = 難しい（Hard）
 *   2 = 普通（Good）
 *   3 = 簡単（Easy）
 */

export type Grade = 0 | 1 | 2 | 3;

export interface ReviewState {
  easeFactor: number;   // 初期値 2.5、最小 1.3
  interval: number;     // 日数
  repetitions: number;  // 連続正解回数
}

export interface ReviewResult extends ReviewState {
  nextReviewDate: string; // ISO 日付文字列
  lastReviewDate: string;
}

const MIN_EASE_FACTOR = 1.3;
const INITIAL_EASE_FACTOR = 2.5;

/**
 * EF を更新する（grade=0 の場合は呼ばれない）
 * 式: EF' = EF + (0.1 - (3-q) * (0.08 + (3-q) * 0.02))
 */
function updateEaseFactor(ef: number, grade: Grade): number {
  const q = grade;
  const delta = 0.1 - (3 - q) * (0.08 + (3 - q) * 0.02);
  return Math.max(MIN_EASE_FACTOR, ef + delta);
}

/**
 * 日付文字列に interval 日を加算した ISO 文字列を返す
 */
function addDays(dateISO: string, days: number): string {
  const date = new Date(dateISO);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/**
 * SM-2 アルゴリズム本体
 * 既存の ReviewState（未学習なら初期値）と grade から次回レビュー情報を計算する
 */
export function calculateNextReview(state: ReviewState, grade: Grade): ReviewResult {
  const now = new Date().toISOString();

  if (grade === 0) {
    // もう一度: リセット（easeFactor は維持）
    return {
      easeFactor: state.easeFactor,
      interval: 1,
      repetitions: 0,
      lastReviewDate: now,
      nextReviewDate: addDays(now, 1),
    };
  }

  // 正解系 (grade 1-3)
  let nextInterval: number;
  if (state.repetitions === 0) {
    nextInterval = 1;
  } else if (state.repetitions === 1) {
    nextInterval = 6;
  } else {
    nextInterval = Math.round(state.interval * state.easeFactor);
  }

  // grade=1(Hard) の場合はインターバルを縮小
  if (grade === 1) {
    nextInterval = Math.max(1, Math.round(nextInterval * 0.6));
  }

  const nextEF = updateEaseFactor(state.easeFactor, grade);

  return {
    easeFactor: nextEF,
    interval: nextInterval,
    repetitions: state.repetitions + 1,
    lastReviewDate: now,
    nextReviewDate: addDays(now, nextInterval),
  };
}

/** 未学習カード用の初期 ReviewState */
export const INITIAL_REVIEW_STATE: ReviewState = {
  easeFactor: INITIAL_EASE_FACTOR,
  interval: 0,
  repetitions: 0,
};

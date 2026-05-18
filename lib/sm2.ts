/**
 * 学習評価のグレード型。実際のスケジューリングは lib/fsrs.ts が ts-fsrs で計算する。
 *   0 = もう一度（Again）
 *   1 = 難しい（Hard）
 *   2 = 普通（Good）
 *   3 = 簡単（Easy）
 */
export type Grade = 0 | 1 | 2 | 3;

import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs';
import type { Card as FsrsCard } from 'ts-fsrs';
import type { Grade } from '@/lib/sm2';
import { useProStore } from '@/store/pro';
import { FSRS_RETENTION_DEFAULT, useSettingsStore } from '@/store/settings';
import type { Review } from '@/types';

const GRADE_TO_RATING = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;

/** Pro 購入時はユーザー設定の保持率、未購入時はデフォルト 90% を使う */
function getRequestRetention(): number {
  const isPro = useProStore.getState().isPro;
  if (!isPro) return FSRS_RETENTION_DEFAULT;
  return useSettingsStore.getState().fsrsDesiredRetention;
}

// FSRS difficulty (1〜10) → 仮想 SM-2 easeFactor (1.3〜3.0)：マスタリー表示用
function difficultyToEaseFactor(difficulty: number): number {
  return 3.0 - ((difficulty - 1) / 9) * (3.0 - 1.3);
}

export interface FsrsResult {
  stability: number;
  difficulty: number;
  fsrsState: number;
  fsrsReps: number;
  fsrsLapses: number;
  fsrsScheduledDays: number;
  easeFactor: number;
  nextReviewDate: string;
  lastReviewDate: string;
}

export function calculateNextReviewFSRS(existing: Review | null, grade: Grade): FsrsResult {
  const now = new Date();
  const f = fsrs(generatorParameters({
    enable_fuzz: false,
    enable_short_term: false,
    request_retention: getRequestRetention(),
  }));

  let card: FsrsCard;
  if (existing === null || existing.stability == null || existing.difficulty == null) {
    card = createEmptyCard(now);
  } else {
    const lastReview = new Date(existing.lastReviewDate);
    const elapsedDays = Math.max(0, (now.getTime() - lastReview.getTime()) / 86400000);
    card = {
      due: new Date(existing.nextReviewDate),
      stability: existing.stability,
      difficulty: existing.difficulty,
      elapsed_days: elapsedDays,
      scheduled_days: existing.fsrsScheduledDays ?? 0,
      reps: existing.fsrsReps ?? 0,
      lapses: existing.fsrsLapses ?? 0,
      state: (existing.fsrsState ?? State.New) as State,
      last_review: lastReview,
      learning_steps: 0,
    };
  }

  const schedulingCards = f.repeat(card, now);
  const newCard = schedulingCards[GRADE_TO_RATING[grade]].card;

  return {
    stability: newCard.stability,
    difficulty: newCard.difficulty,
    fsrsState: newCard.state,
    fsrsReps: newCard.reps,
    fsrsLapses: newCard.lapses,
    fsrsScheduledDays: newCard.scheduled_days,
    easeFactor: difficultyToEaseFactor(newCard.difficulty),
    nextReviewDate: newCard.due.toISOString(),
    lastReviewDate: now.toISOString(),
  };
}

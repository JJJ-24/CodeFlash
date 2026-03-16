import { useCallback, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { getCardById } from '@/lib/database/cards';
import {
  getAllCardIdsByDeckId,
  getDueCardIdsByDeckId,
  getDueCardIdsByTagId,
  getReviewByCardId,
  getTodayReviewedCardIdsByDeckId,
  getUnlearnedCardIdsByDeckId,
  saveReview,
} from '@/lib/database/reviews';
import { calculateNextReview, INITIAL_REVIEW_STATE } from '@/lib/sm2';
import type { Grade } from '@/lib/sm2';
import type { Card } from '@/types';

export interface SessionResult {
  totalCards: number;
  reviewed: number;
}

export function useStudySession() {
  const db = useSQLiteContext();
  const [queue, setQueue] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [result, setResult] = useState<SessionResult>({ totalCards: 0, reviewed: 0 });

  const loadSession = useCallback(
    async (params: { deckId?: string; tagId?: string; filter?: 'all' | 'today' | 'due' | 'unlearned' }) => {
      setLoading(true);
      setCompleted(false);
      setCurrentIndex(0);
      setQueue([]);
      try {
        let cardIds: string[] = [];
        const filter = params.filter ?? 'due';
        if (params.deckId) {
          if (filter === 'all')       cardIds = await getAllCardIdsByDeckId(db, params.deckId);
          else if (filter === 'today')     cardIds = await getTodayReviewedCardIdsByDeckId(db, params.deckId);
          else if (filter === 'unlearned') cardIds = await getUnlearnedCardIdsByDeckId(db, params.deckId);
          else                             cardIds = await getDueCardIdsByDeckId(db, params.deckId);
        } else if (params.tagId) {
          cardIds = await getDueCardIdsByTagId(db, params.tagId);
        }

        const cards = (
          await Promise.all(cardIds.map((id) => getCardById(db, id)))
        ).filter((c): c is Card => c !== null);

        setQueue(cards);
        setResult({ totalCards: cards.length, reviewed: 0 });
        if (cards.length === 0) setCompleted(true);
      } finally {
        setLoading(false);
      }
    },
    [db]
  );

  const goBack = useCallback(() => {
    if (currentIndex <= 0) return;
    setCurrentIndex((i) => i - 1);
    setResult((r) => ({ ...r, reviewed: Math.max(0, r.reviewed - 1) }));
  }, [currentIndex]);

  const goNext = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      setCompleted(true);
    } else {
      setCurrentIndex(nextIndex);
    }
  }, [currentIndex, queue.length]);

  const submitGrade = useCallback(
    async (grade: Grade) => {
      const card = queue[currentIndex];
      if (!card) return;

      const existing = await getReviewByCardId(db, card.id);
      const state = existing ?? { ...INITIAL_REVIEW_STATE };
      const reviewResult = calculateNextReview(state, grade);

      await saveReview(db, { cardId: card.id, ...reviewResult });

      const reviewed = result.reviewed + 1;
      const nextIndex = currentIndex + 1;

      if (nextIndex >= queue.length) {
        setResult({ totalCards: result.totalCards, reviewed });
        setCompleted(true);
      } else {
        setResult({ totalCards: result.totalCards, reviewed });
        setCurrentIndex(nextIndex);
      }
    },
    [db, queue, currentIndex, result]
  );

  return {
    loading,
    completed,
    currentCard: queue[currentIndex] ?? null,
    currentIndex,
    result,
    loadSession,
    submitGrade,
    goBack,
    goNext,
  };
}

import { useCallback, useRef, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import { useSettingsStore } from '@/store/settings';

import { getCardById, getTodayCreatedCardIdsByDeckId, getTodayCreatedCardIdsByTagId } from '@/lib/database/cards';
import {
  getAllCardIdsByDeckId,
  getAllCardIdsByTagId,
  getDueCardIdsByDeckId,
  getDueCardIdsByTagId,
  getReviewByCardId,
  getTodayReviewedCardIdsByDeckId,
  getTodayReviewedCardIdsByTagId,
  saveReview,
} from '@/lib/database/reviews';
import { calculateNextReview, INITIAL_REVIEW_STATE } from '@/lib/sm2';
import type { Grade } from '@/lib/sm2';
import type { Card } from '@/types';

export interface SessionResult {
  totalCards: number;
  reviewed: number;
  gradeCount: { again: number; hard: number; good: number; easy: number };
  earliestNextReview: string | null;
}

export function useStudySession() {
  const db = useSQLiteContext();
  const [queue, setQueue] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [result, setResult] = useState<SessionResult>({ totalCards: 0, reviewed: 0, gradeCount: { again: 0, hard: 0, good: 0, easy: 0 }, earliestNextReview: null });

  // カードごとの評価履歴: 戻って再評価しない場合も最初の評価を保持する
  const gradedCardsRef = useRef<Map<string, { grade: Grade; nextReviewDate: string }>>(new Map());

  // レンダーごとに同期 — useFocusEffect から呼ばれる refreshCurrentCard が常に最新値を参照できる
  const queueRef = useRef<Card[]>([]);
  const currentIndexRef = useRef(0);
  queueRef.current = queue;
  currentIndexRef.current = currentIndex;

  const loadSession = useCallback(
    async (params: { deckId?: string; tagId?: string; filter?: 'all' | 'today' | 'due' | 'unlearned'; shuffle?: boolean }) => {
      setLoading(true);
      setCompleted(false);
      setCurrentIndex(0);
      setQueue([]);
      try {
        let cardIds: string[] = [];
        const filter = params.filter ?? 'due';
        if (params.deckId) {
          if (filter === 'all')            cardIds = await getAllCardIdsByDeckId(db, params.deckId);
          else if (filter === 'today')     cardIds = await getTodayReviewedCardIdsByDeckId(db, params.deckId);
          else if (filter === 'unlearned') cardIds = await getTodayCreatedCardIdsByDeckId(db, params.deckId);
          else                             cardIds = await getDueCardIdsByDeckId(db, params.deckId);
        } else if (params.tagId) {
          if (filter === 'all')            cardIds = await getAllCardIdsByTagId(db, params.tagId);
          else if (filter === 'today')     cardIds = await getTodayReviewedCardIdsByTagId(db, params.tagId);
          else if (filter === 'unlearned') cardIds = await getTodayCreatedCardIdsByTagId(db, params.tagId);
          else                             cardIds = await getDueCardIdsByTagId(db, params.tagId);
        }

        let cards = (
          await Promise.all(cardIds.map((id) => getCardById(db, id)))
        ).filter((c): c is Card => c !== null);

        if (params.shuffle) {
          for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
          }
        } else {
          const cardSort = useSettingsStore.getState().cardSortOrder;
          if (cardSort === 'newest') cards.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          else if (cardSort === 'oldest') cards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        }

        gradedCardsRef.current = new Map();
        setQueue(cards);
        setResult({ totalCards: cards.length, reviewed: 0, gradeCount: { again: 0, hard: 0, good: 0, easy: 0 }, earliestNextReview: null });
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

      await saveReview(db, { cardId: card.id, ...reviewResult, lastGrade: grade });

      // カードごとの評価を記録（同一カードを再評価した場合は上書き）
      gradedCardsRef.current.set(card.id, { grade, nextReviewDate: reviewResult.nextReviewDate });

      // Map から集計し直す（戻って再評価しないカードの評価も保持される）
      const gradeCount = { again: 0, hard: 0, good: 0, easy: 0 };
      let earliestNextReview: string | null = null;
      for (const { grade: g, nextReviewDate } of gradedCardsRef.current.values()) {
        const key = (['again', 'hard', 'good', 'easy'] as const)[g];
        gradeCount[key]++;
        if (earliestNextReview === null || nextReviewDate < earliestNextReview) {
          earliestNextReview = nextReviewDate;
        }
      }
      setResult((r) => ({
        ...r,
        reviewed: gradedCardsRef.current.size,
        gradeCount,
        earliestNextReview,
      }));
      goNext();
    },
    [db, queue, currentIndex, goNext]
  );

  const refreshCurrentCard = useCallback(async () => {
    const currentQueue = queueRef.current;
    const idx = currentIndexRef.current;
    const card = currentQueue[idx];
    if (!card) return;
    const updated = await getCardById(db, card.id);
    if (updated) {
      setQueue((prev) => prev.map((c) => c.id === updated.id ? updated : c));
    } else {
      // カードが削除された — queue から除去して遷移先を決定
      const newQueue = currentQueue.filter((c) => c.id !== card.id);
      if (newQueue.length === 0) {
        setQueue([]);
        setCompleted(true);
      } else {
        const newIndex = Math.min(idx, newQueue.length - 1);
        setQueue(newQueue);
        setCurrentIndex(newIndex);
        setResult((r) => ({ ...r, totalCards: newQueue.length }));
      }
    }
  }, [db]);

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
    refreshCurrentCard,
  };
}

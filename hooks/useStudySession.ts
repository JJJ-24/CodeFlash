import { useCallback, useRef, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import { useSettingsStore } from '@/store/settings';

import { getCardById, getCardsByIds, getUnlearnedCardIdsByDeckId, getUnlearnedCardIdsByTagId } from '@/lib/database/cards';
import { todayISO } from '@/lib/database/utils';
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
import { calculateNextReviewFSRS } from '@/lib/fsrs';
import type { Grade } from '@/lib/sm2';
import type { Card, Review } from '@/types';

// セッションをまたいで今日の元状態を保持するモジュールレベルキャッシュ
// key: cardId, value: { review: 評価前の元レビュー状態（新規カードは null）, date: ISO日付 }
const _originalStateCache = new Map<string, { review: Review | null; date: string }>();

export interface SessionResult {
  totalCards: number;
  reviewed: number;
  gradeCount: { again: number; hard: number; good: number; easy: number };
  earliestNextReview: string | null;
  avgResponseTimeMs: number | null;
}

export function useStudySession() {
  const db = useSQLiteContext();
  const [queue, setQueue] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [result, setResult] = useState<SessionResult>({ totalCards: 0, reviewed: 0, gradeCount: { again: 0, hard: 0, good: 0, easy: 0 }, earliestNextReview: null, avgResponseTimeMs: null });

  // カードごとの評価履歴: 戻って再評価しない場合も最初の評価を保持する
  const gradedCardsRef = useRef<Map<string, { grade: Grade; nextReviewDate: string; responseTimeMs: number }>>(new Map());
  // 現在のカードが表示された時刻（回答時間計測用）
  const cardShownAtRef = useRef<number>(Date.now());

  // レンダーごとに同期 — useFocusEffect から呼ばれる refreshCurrentCard が常に最新値を参照できる
  const queueRef = useRef<Card[]>([]);
  const currentIndexRef = useRef(0);
  queueRef.current = queue;
  currentIndexRef.current = currentIndex;

  const loadSession = useCallback(
    async (params: { deckId?: string; tagId?: string; cardIds?: string[]; filter?: 'all' | 'today' | 'due' | 'unlearned'; shuffle?: boolean }) => {
      setLoading(true);
      setCompleted(false);
      setCurrentIndex(0);
      setQueue([]);
      try {
        let cardIds: string[] = [];
        const filter = params.filter ?? 'due';
        if (params.cardIds) {
          // 明示指定（重点復習モード等）：与えられた cardIds をそのまま使用し順序を維持
          cardIds = params.cardIds;
        } else if (params.deckId) {
          if (filter === 'all')            cardIds = await getAllCardIdsByDeckId(db, params.deckId);
          else if (filter === 'today')     cardIds = await getTodayReviewedCardIdsByDeckId(db, params.deckId);
          else if (filter === 'unlearned') cardIds = await getUnlearnedCardIdsByDeckId(db, params.deckId);
          else                             cardIds = await getDueCardIdsByDeckId(db, params.deckId);
        } else if (params.tagId) {
          if (filter === 'all')            cardIds = await getAllCardIdsByTagId(db, params.tagId);
          else if (filter === 'today')     cardIds = await getTodayReviewedCardIdsByTagId(db, params.tagId);
          else if (filter === 'unlearned') cardIds = await getUnlearnedCardIdsByTagId(db, params.tagId);
          else                             cardIds = await getDueCardIdsByTagId(db, params.tagId);
        }

        let cards = await getCardsByIds(db, cardIds);

        if (params.cardIds) {
          // 明示指定モード（重点復習等）：cardSort 設定は無視し、入力順を厳守
          const order = new Map(params.cardIds.map((id, idx) => [id, idx]));
          cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        } else if (params.shuffle) {
          for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
          }
        } else {
          // カード一覧（deck/[id]/index.tsx の displayedCards）と完全に同じ比較子を使う。
          // createdAt 同値時の tie-break（sortOrder）まで一致させないと、一括複製などで
          // createdAt が同一ミリ秒に揃ったカード群の並びが一覧と逆になりズレる。
          const cardSort = useSettingsStore.getState().cardSortOrder;
          if (cardSort === 'newest') {
            cards.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0) || b.sortOrder - a.sortOrder);
          } else if (cardSort === 'oldest') {
            cards.sort((a, b) => (a.createdAt > b.createdAt ? 1 : a.createdAt < b.createdAt ? -1 : 0) || a.sortOrder - b.sortOrder);
          }
        }

        gradedCardsRef.current = new Map();
        cardShownAtRef.current = Date.now();
        setQueue(cards);
        setResult({ totalCards: cards.length, reviewed: 0, gradeCount: { again: 0, hard: 0, good: 0, easy: 0 }, earliestNextReview: null, avgResponseTimeMs: null });
        if (cards.length === 0) setCompleted(true);
      } finally {
        setLoading(false);
      }
    },
    [db]
  );

  const goBack = useCallback(() => {
    if (currentIndex <= 0) return;
    cardShownAtRef.current = Date.now();
    setCurrentIndex((i) => i - 1);
  }, [currentIndex]);

  const goNext = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      setCompleted(true);
    } else {
      cardShownAtRef.current = Date.now();
      setCurrentIndex(nextIndex);
    }
  }, [currentIndex, queue.length]);

  const submitGrade = useCallback(
    async (grade: Grade) => {
      const card = queue[currentIndex];
      if (!card) return;

      const responseTimeMs = Date.now() - cardShownAtRef.current;
      const existing = await getReviewByCardId(db, card.id);
      const today = todayISO();
      const isDue = existing === null || existing.nextReviewDate.slice(0, 10) <= today;
      const reviewedToday = existing !== null && existing.lastReviewDate !== null && existing.lastReviewDate.slice(0, 10) === today;

      let nextReviewDate: string;
      const cachedEntry = _originalStateCache.get(card.id);
      const hasCachedToday = cachedEntry !== undefined && cachedEntry.date === today;

      if (isDue || reviewedToday || hasCachedToday) {
        if (!hasCachedToday) {
          // 今日初回評価: 評価前の元状態をキャッシュに保存
          _originalStateCache.set(card.id, { review: existing, date: today });
        }
        const baseReview = hasCachedToday ? cachedEntry!.review : existing;
        const reviewResult = calculateNextReviewFSRS(baseReview, grade);
        await saveReview(db, {
          cardId: card.id,
          lastGrade: grade,
          easeFactor: reviewResult.easeFactor,
          interval: 0,
          repetitions: 0,
          stability: reviewResult.stability,
          difficulty: reviewResult.difficulty,
          fsrsState: reviewResult.fsrsState,
          fsrsReps: reviewResult.fsrsReps,
          fsrsLapses: reviewResult.fsrsLapses,
          fsrsScheduledDays: reviewResult.fsrsScheduledDays,
          nextReviewDate: reviewResult.nextReviewDate,
          lastReviewDate: reviewResult.lastReviewDate,
        }, responseTimeMs);
        nextReviewDate = reviewResult.nextReviewDate;
      } else {
        nextReviewDate = existing!.nextReviewDate;
      }

      // カードごとの評価を記録（同一カードを再評価した場合は上書き）
      gradedCardsRef.current.set(card.id, { grade, nextReviewDate, responseTimeMs });

      // Map から集計し直す（戻って再評価しないカードの評価も保持される）
      const gradeCount = { again: 0, hard: 0, good: 0, easy: 0 };
      let earliestNextReview: string | null = null;
      let totalResponseTimeMs = 0;
      for (const { grade: g, nextReviewDate, responseTimeMs: rt } of gradedCardsRef.current.values()) {
        const key = (['again', 'hard', 'good', 'easy'] as const)[g];
        gradeCount[key]++;
        if (earliestNextReview === null || nextReviewDate < earliestNextReview) {
          earliestNextReview = nextReviewDate;
        }
        totalResponseTimeMs += rt;
      }
      const avgResponseTimeMs = Math.round(totalResponseTimeMs / gradedCardsRef.current.size);
      setResult((r) => ({
        ...r,
        reviewed: gradedCardsRef.current.size,
        gradeCount,
        earliestNextReview,
        avgResponseTimeMs,
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

  const finishSession = useCallback(() => {
    setCompleted(true);
  }, []);

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
    finishSession,
  };
}

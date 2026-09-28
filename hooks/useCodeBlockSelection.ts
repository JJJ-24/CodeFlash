import { useState } from 'react';
import type { OutputKeyTrigger } from '@/components/code/ExecutionOutput';
import type { Card } from '@/types';

type Side = 'front' | 'back' | 'memo';

export function useCodeBlockSelection() {
  const [selectedCodeBlockIdx, setSelectedCodeBlockIdx] = useState<number | null>(null);
  const [selectedCodeBlockSide, setSelectedCodeBlockSide] = useState<Side | null>(null);
  const [runTrigger, setRunTrigger] = useState(0);
  const [editTrigger, setEditTrigger] = useState(0);
  // 058：⌘R＝編集中でもカーソルを残したまま実行（R・▶ は編集を抜けてから実行）
  const [runKeepEditTrigger, setRunKeepEditTrigger] = useState(0);
  // 058：選択中のコードブロックのプレビュー枠のキー操作（V・⇧F・⇧R）。選ばれた瞬間の値は発火しない（ExecutionOutput 側）
  const [outputTrigger, setOutputTrigger] = useState<OutputKeyTrigger | null>(null);

  function reset() {
    setSelectedCodeBlockIdx(null);
    setSelectedCodeBlockSide(null);
    setRunTrigger(0);
    setEditTrigger(0);
    setRunKeepEditTrigger(0);
  }

  function cycleCodeBlock(
    forward: boolean,
    currentCard: Card | null,
    isFlipped: boolean,
    setShowMemo: (show: boolean) => void,
  ) {
    if (!currentCard) return;
    setEditTrigger(0);
    setRunTrigger(0);
    // 058：⌘R の値も戻す＝次に選んだブロック（同じブロックを選び直した場合も）が、その値を受け取った瞬間に実行しないように
    setRunKeepEditTrigger(0);

    if (!isFlipped) {
      // 表面: 表面のコードブロックのみサイクル
      const count = currentCard.frontContent.filter((b) => b.type === 'code').length;
      if (count === 0) return;
      if (forward) {
        if (selectedCodeBlockIdx === null) { setSelectedCodeBlockSide('front'); setSelectedCodeBlockIdx(0); }
        else if (selectedCodeBlockIdx === count - 1) { setSelectedCodeBlockSide(null); setSelectedCodeBlockIdx(null); }
        else { setSelectedCodeBlockSide('front'); setSelectedCodeBlockIdx(selectedCodeBlockIdx + 1); }
      } else {
        if (selectedCodeBlockIdx === null) { setSelectedCodeBlockSide('front'); setSelectedCodeBlockIdx(count - 1); }
        else if (selectedCodeBlockIdx === 0) { setSelectedCodeBlockSide(null); setSelectedCodeBlockIdx(null); }
        else { setSelectedCodeBlockSide('front'); setSelectedCodeBlockIdx(selectedCodeBlockIdx - 1); }
      }
    } else {
      // 裏面: 裏面＋メモのコードブロックを通しでサイクル
      const backCount = currentCard.backContent.filter((b) => b.type === 'code').length;
      const memoCount = currentCard.memoContent.filter((b) => b.type === 'code').length;
      const total = backCount + memoCount;
      if (total === 0) return;

      // 現在の combined index（back: 0〜backCount-1、memo: backCount〜）
      let currentCombined: number | null = null;
      if (selectedCodeBlockIdx !== null) {
        if (selectedCodeBlockSide === 'back') currentCombined = selectedCodeBlockIdx;
        else if (selectedCodeBlockSide === 'memo') currentCombined = backCount + selectedCodeBlockIdx;
      }

      const applyIndex = (combined: number) => {
        if (combined < backCount) {
          setSelectedCodeBlockSide('back');
          setSelectedCodeBlockIdx(combined);
        } else {
          setSelectedCodeBlockSide('memo');
          setShowMemo(true);
          setSelectedCodeBlockIdx(combined - backCount);
        }
      };

      if (forward) {
        if (currentCombined === null) applyIndex(0);
        else if (currentCombined === total - 1) { setSelectedCodeBlockSide(null); setSelectedCodeBlockIdx(null); }
        else applyIndex(currentCombined + 1);
      } else {
        if (currentCombined === null) applyIndex(total - 1);
        else if (currentCombined === 0) { setSelectedCodeBlockSide(null); setSelectedCodeBlockIdx(null); }
        else applyIndex(currentCombined - 1);
      }
    }
  }

  return {
    selectedCodeBlockIdx,
    selectedCodeBlockSide,
    setSelectedCodeBlockIdx,
    setSelectedCodeBlockSide,
    runTrigger,
    editTrigger,
    outputTrigger,
    runKeepEditTrigger,
    setRunTrigger,
    setRunKeepEditTrigger,
    setEditTrigger,
    setOutputTrigger,
    cycleCodeBlock,
    reset,
  };
}

import { useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { useKeyCommands } from '@/lib/useKeyCommands';

/**
 * 053：1つ選んで閉じる一覧モーダル（読み上げの言語・声・自動読み上げ）のキー操作。
 * J/K（↑/↓）＝行の移動（循環）、Return/Space＝選んで閉じる、Esc＝閉じる、S＝試聴（`onPreview` を渡したときだけ）。
 * `DeckPickerModal`・`LanguagePickerModal` と同じ単一選択の流儀。
 *
 * - 開いたときのフォーカスは**いま選ばれている行**（どこから動かせばよいかが一目で分かる）。
 *   一覧を非同期に読む画面（言語・声）は、読み終えて行数が変わったときに選ばれている行へ置き直す。
 * - 行が画面外なら見える位置までスクロールする：各行（**ScrollView の中身の直接の子**）に
 *   `rowLayout(i)` を当て、ScrollView に `scrollRef` と `scrollProps` を渡す。
 * - 矢印は iPad でも登録する（一覧に入力欄は無い）。ただしカードエディタ・学習セッションの上に出す一覧は
 *   `arrows: false`＝iPad で登録すると矢印のキャッシュが残り、編集中のカーソル移動を奪う（054 のアラートと同じ）。
 * - 表示中だけキーを担当する（親は `suspendKeys` / `active` でキーを手放していること）。
 */
export function usePickerKeys<T>({ visible, items, value, onPick, onClose, onPreview, arrows = true }: {
  visible: boolean;
  /** 行の値（見えている順）。「自動」「アプリ設定に従う」のような先頭行も含める */
  items: readonly T[];
  /** いま選ばれている値（開いたときのフォーカス位置） */
  value: T;
  /** 選んだ値。閉じるのはこのフックが行う（`onPick` の後に `onClose`） */
  onPick: (v: T) => void;
  onClose: () => void;
  onPreview?: (v: T) => void;
  /** 矢印キーも登録するか（既定 true） */
  arrows?: boolean;
}) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const count = items.length;
  useEffect(() => {
    if (!visible) return;
    setFocusedIndex(Math.max(0, items.indexOf(value)));
    // 開いたとき・行数が変わったとき（非同期の読み込みが終わった）だけ置き直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, count]);

  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const viewportHRef = useRef(0);
  const layouts = useRef(new Map<number, { y: number; h: number }>());
  const scrollIntoView = (i: number) => {
    const l = layouts.current.get(i);
    if (!l) return;
    const top = scrollYRef.current;
    const vh = viewportHRef.current;
    if (l.y < top) scrollRef.current?.scrollTo({ y: l.y, animated: true });
    else if (l.y + l.h > top + vh) scrollRef.current?.scrollTo({ y: l.y + l.h - vh, animated: true });
  };
  const move = (dir: 1 | -1) => {
    if (count === 0) return;
    const next = (focusedIndex + dir + count) % count;
    setFocusedIndex(next);
    scrollIntoView(next);
  };
  const pickFocused = () => {
    if (focusedIndex >= count) return;
    onPick(items[focusedIndex]);
    onClose();
  };

  useKeyCommands([
    { input: KeyCommand.keyInputEscape, handler: onClose },
    { input: 'j', handler: () => move(1) },
    { input: 'k', handler: () => move(-1) },
    ...(arrows ? [
      { input: KeyCommand.keyInputDownArrow, handler: () => move(1) },
      { input: KeyCommand.keyInputUpArrow, handler: () => move(-1) },
    ] : []),
    { input: KeyCommand.keyInputEnter, handler: pickFocused },
    { input: ' ', handler: pickFocused },
    ...(onPreview ? [{ input: 's', handler: () => { if (focusedIndex < count) onPreview(items[focusedIndex]); } }] : []),
  ], visible);

  return {
    focusedIndex,
    scrollRef,
    scrollProps: {
      onLayout: (e: LayoutChangeEvent) => { viewportHRef.current = e.nativeEvent.layout.height; },
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { scrollYRef.current = e.nativeEvent.contentOffset.y; },
      scrollEventThrottle: 16,
    },
    rowLayout: (i: number) => (e: LayoutChangeEvent) => {
      layouts.current.set(i, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height });
    },
  };
}

import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { useTheme } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';

/**
 * 複数選択のシート（カード編集のタグ選択・検索のタグ/デッキ絞り込み・統計のデッキ選択）のキー操作。
 *
 * - J/K（iPhone は ↑/↓ も）＝行 → 最後に一覧の下の「完了」へ。開いた時点ではフォーカス無し
 *   （J＝先頭の行／K＝「完了」＝選び終わったら K → Return で閉じられる）。以後は循環
 * - **Return＝フォーカス中のものを実行**（行＝選択/解除・「完了」＝閉じる・フォーカス無し＝閉じる）。
 *   かつては Return＝閉じるで、行にフォーカスして Return を押すと選ばれずに閉じていた
 *   ＝設定・デッキ編集・カード編集の J/K（Return＝フォーカス中の項目を実行）と食い違っていた
 * - Space＝行の選択/解除（従来どおり）
 * - Esc＝閉じる（選択は押した瞬間に反映済みなので「完了」と同じ結果）
 *
 * 行の index は 0〜count-1（「すべて」行があればそれも含めた通し番号）、`count` が「完了」。
 * 表示中だけキーを担当する（親は表示中に自分のキーを解除していること）。
 */
export function useMultiSelectKeys({ visible, count, onActivate, onClose, scrollTo }: {
  visible: boolean;
  /** 行の数（「すべて」行を含む） */
  count: number;
  /** 行 index の選択/解除（「すべて」行なら全解除） */
  onActivate: (index: number) => void;
  onClose: () => void;
  /** 行を見える位置へ送る（「完了」は一覧の外に固定されているので呼ばない） */
  scrollTo: (index: number) => void;
}) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  useEffect(() => { if (visible) setFocusedIndex(null); }, [visible]);
  const doneIndex = count;

  function move(dir: 1 | -1) {
    setFocusedIndex((p) => {
      const total = count + 1;
      const next = p === null ? (dir > 0 ? 0 : doneIndex) : (p + dir + total) % total;
      if (next < count) setTimeout(() => scrollTo(next), 0);
      return next;
    });
  }
  const toggle = () => { if (focusedIndex !== null && focusedIndex < count) onActivate(focusedIndex); };
  const enter = () => {
    if (focusedIndex === null || focusedIndex >= count) onClose();
    else onActivate(focusedIndex);
  };

  useKeyCommands([
    { input: 'j', handler: () => move(1) },
    { input: 'k', handler: () => move(-1) },
    { input: ' ', handler: toggle },
    { input: KeyCommand.keyInputEnter, handler: enter },
    { input: KeyCommand.keyInputEscape, handler: onClose },
    // ⚠️ 矢印は iPhone だけ（親に入力欄がある画面＝カード編集・検索から開くため。iPad は登録すると
    //   キャッシュが残って入力欄のカーソル移動を奪う）
    ...(((Platform as any).isPad ? [] : [
      { input: KeyCommand.keyInputDownArrow, handler: () => move(1) },
      { input: KeyCommand.keyInputUpArrow, handler: () => move(-1) },
    ]) as { input: string; handler: () => void }[]),
  ], visible);

  return { focusedIndex, setFocusedIndex, doneFocused: focusedIndex === doneIndex };
}

/** 一覧の下の「完了」ボタンに重ねるフォーカス枠（ボタンの上の区切り線は残すため、枠は内側に描く） */
export function DoneFocusRing({ visible }: { visible: boolean }) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 4, bottom: 4, left: 12, right: 12, borderRadius: 8, borderWidth: 2, borderColor: theme.colors.primary }}
    />
  );
}

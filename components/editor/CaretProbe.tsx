import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { MAX_FONT_MULTIPLIER } from '@/lib/theme';

/**
 * 入力中のカーソルの行の位置を測る、見えない Text（カード編集のカーソル追従用）。
 *
 * 入力欄と同じ幅・文字で「先頭からカーソルまで」を組み、**最後の行＝カーソルの行**とする
 * （折り返しも実際の表示と同じ計算になる）。入力欄に重ねて置く（見えず・触れず・読み上げられない）。
 * ⚠️ 末尾に幅0の文字を足す＝カーソルの直前が改行のとき、空の最終行も1行として数えるため。
 *
 * なぜ要るか：テキスト/コードの本文は横 ScrollView で包み、iOS の「入力欄を見せる自動スクロール」を
 * そこで吸収している（編集の開始・終了で画面が勝手に動くのを防ぐため）。その代わり入力中の追従も
 * 効かないので、アプリ側でカーソルの行を測ってスクロールする。
 */
export function CaretProbe({
  text,
  caretEnd,
  style,
  paddingTop,
  onCaret,
}: {
  text: string;
  caretEnd: number;
  /** 入力欄と同じ見た目のスタイル（幅・文字サイズ・行の高さ・余白） */
  style: StyleProp<TextStyle>;
  /** 入力欄の上の余白（行の座標は文字の領域から測られるので足す） */
  paddingTop: number;
  /** カーソルの行の上端・下端（**入力欄の上端から**の距離） */
  onCaret: (top: number, bottom: number) => void;
}) {
  return (
    <Text
      style={[style, styles.probe]}
      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onTextLayout={(e) => {
        const last = e.nativeEvent.lines[e.nativeEvent.lines.length - 1];
        if (!last) return;
        onCaret(paddingTop + last.y, paddingTop + last.y + last.height);
      }}
    >
      {text.slice(0, Math.min(caretEnd, text.length)) + '​'}
    </Text>
  );
}

const styles = StyleSheet.create({
  probe: { position: 'absolute', top: 0, left: 0, opacity: 0, minHeight: 0 },
});

import type { ReactNode } from 'react';
import { Pressable } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * ヘッダーの何も無いところをタップすると一覧の先頭へ戻す（iOS の「ステータスバーをタップ」の拡張）。
 * ヘッダーの外枠そのものをこれにする＝中のボタン（検索・ショートカット一覧・戻る など）は
 * 自分がタップを取るので先頭へは戻らず、ボタン以外（タイトル・余白）のタップだけがここまで上がってくる。
 *
 * OS の scrollsToTop に任せない理由：iPad（iPadOS 26）は OS がヘッダー付近のタップにも scrollsToTop を
 * 発火させるが、ボタンの上でも区別せず発火するため、ショートカット一覧を開くと裏の一覧が先頭へ戻っていた。
 * iPhone の OS はステータスバーにしか反応しない。アプリ側で持てば両方で同じ動きになる
 * （iPad は useSafeScrollsToTop が OS の scrollsToTop を切っている）。
 */
export function HeaderTapToTop({ onPress, style, children }: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return (
    <Pressable style={style} onPress={onPress} accessible={false}>
      {children}
    </Pressable>
  );
}

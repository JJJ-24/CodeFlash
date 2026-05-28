import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme';

const ACTION_WIDTH = 76;

function RightAction({ drag, color, onPress }: {
  drag: SharedValue<number>;
  color: string;
  onPress: () => void;
}) {
  // スワイプ量に追従して削除アクションを右から出す（公式 ReanimatedSwipeable の作法）。
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value + ACTION_WIDTH }],
  }));
  return (
    <Reanimated.View style={[styles.actionContainer, animatedStyle]}>
      <Pressable
        onPress={onPress}
        style={[styles.action, { backgroundColor: color }]}
        hitSlop={4}
      >
        <Ionicons name="trash-outline" size={24} color="#fff" />
      </Pressable>
    </Reanimated.View>
  );
}

interface Props {
  children: ReactNode;
  /** 削除アクション（ゴミ箱）タップ時。呼び出し側で確認ダイアログを出す想定。 */
  onDelete: () => void;
  /**
   * false のときスワイプを完全に無効化する（手動並び替えモード・選択モード用）。
   * Swipeable を挟まず children をそのまま返すので、ドラッグ並び替えや選択タップと一切競合しない。
   */
  enabled?: boolean;
  /**
   * 行の外側マージン（カード同士の余白・左右インセット）はここに渡す。
   * カード自身（children）の margin に付けると、その余白までスワイプ領域に入り、
   * 削除アクションがカード枠より高く／右にずれて見えるため、必ずスワイプ領域の外側へ出す。
   * enabled の真偽に関わらず同じ余白が適用される。
   */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * 行を左にスワイプすると右側に削除（ゴミ箱）アクションが現れる共通ラッパー。
 * デッキ一覧・カード一覧・タグ管理・タグカード一覧で共用する。
 * 削除は onDelete 内で ConfirmDeleteModal を出して確定する（誤削除防止）。
 */
export function SwipeToDeleteRow({ children, onDelete, enabled = true, containerStyle }: Props) {
  const theme = useTheme();
  if (!enabled) return <View style={containerStyle}>{children}</View>;
  return (
    <ReanimatedSwipeable
      containerStyle={containerStyle}
      friction={2}
      rightThreshold={ACTION_WIDTH * 0.5}
      overshootRight={false}
      renderRightActions={(_progress, drag, swipeable: SwipeableMethods) => (
        <RightAction
          drag={drag}
          color={theme.colors.danger}
          onPress={() => {
            swipeable.close();
            onDelete();
          }}
        />
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actionContainer: { width: ACTION_WIDTH },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

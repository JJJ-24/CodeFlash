import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme';

const ACTION_WIDTH = 76;

function RightActions({ drag, totalWidth, dangerColor, archiveColor, archived, onDelete, onArchive }: {
  drag: SharedValue<number>;
  totalWidth: number;
  dangerColor: string;
  archiveColor: string;
  archived?: boolean;
  onDelete: () => void;
  onArchive?: () => void;
}) {
  // スワイプ量に追従してアクション群を右から出す（公式 ReanimatedSwipeable の作法）。
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value + totalWidth }],
  }));
  return (
    <Reanimated.View style={[{ width: totalWidth, flexDirection: 'row' }, animatedStyle]}>
      {onArchive && (
        <Pressable onPress={onArchive} style={[styles.action, { backgroundColor: archiveColor }]} hitSlop={4}>
          <Ionicons name={archived ? 'arrow-undo-outline' : 'archive-outline'} size={24} color="#fff" />
        </Pressable>
      )}
      <Pressable onPress={onDelete} style={[styles.action, { backgroundColor: dangerColor }]} hitSlop={4}>
        <Ionicons name="trash-outline" size={24} color="#fff" />
      </Pressable>
    </Reanimated.View>
  );
}

// 右スワイプで左側に出す「ここから学習」ボタン（学習グリーン・▶）。左アクションは
// drag.value（右スワイプで正）に追従させ、初期は画面外左（translateX=-width）に置く。
function LeftAction({ drag, width, color, onPress }: {
  drag: SharedValue<number>;
  width: number;
  color: string;
  onPress: () => void;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value - width }],
  }));
  return (
    <Reanimated.View style={[{ width, flexDirection: 'row' }, animatedStyle]}>
      <Pressable onPress={onPress} style={[styles.action, { backgroundColor: color }]} hitSlop={4}>
        <Ionicons name="play" size={24} color="#fff" />
      </Pressable>
    </Reanimated.View>
  );
}

interface Props {
  children: ReactNode;
  /** 削除アクション（ゴミ箱）タップ時。呼び出し側で確認ダイアログを出す想定。 */
  onDelete: () => void;
  /**
   * 右スワイプで現れる「ここから学習」アクション。渡したときだけ左側に表示する（カード一覧専用・opt-in）。
   * このカードから一覧末尾までを学習する想定。
   */
  onStudyFromHere?: () => void;
  /**
   * アーカイブ/解除アクションタップ時。渡したときだけ削除ボタンの左にアーカイブボタンを表示する。
   * 即時トグル想定（archived の真偽でアイコンを切り替える）。
   */
  onArchive?: () => void;
  /** 現在アーカイブ済みか（アイコン切替用。true のときは「解除」アイコン）。 */
  archived?: boolean;
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
 * 行を左にスワイプすると右側にアクション（アーカイブ・削除）が現れる共通ラッパー。
 * デッキ一覧・カード一覧・タグカード一覧で共用する。
 * 削除は onDelete 内で ConfirmDeleteModal を出して確定する（誤削除防止）。
 */
export function SwipeToDeleteRow({ children, onDelete, onStudyFromHere, onArchive, archived, enabled = true, containerStyle }: Props) {
  const theme = useTheme();
  if (!enabled) return <View style={containerStyle}>{children}</View>;
  const totalWidth = onArchive ? ACTION_WIDTH * 2 : ACTION_WIDTH;
  return (
    <ReanimatedSwipeable
      containerStyle={containerStyle}
      friction={2}
      rightThreshold={ACTION_WIDTH * 0.5}
      leftThreshold={ACTION_WIDTH * 0.5}
      overshootRight={false}
      overshootLeft={false}
      renderLeftActions={onStudyFromHere ? (_progress, drag, swipeable: SwipeableMethods) => (
        <LeftAction
          drag={drag}
          width={ACTION_WIDTH}
          color={theme.colors.primary}
          onPress={() => { swipeable.close(); onStudyFromHere(); }}
        />
      ) : undefined}
      renderRightActions={(_progress, drag, swipeable: SwipeableMethods) => (
        <RightActions
          drag={drag}
          totalWidth={totalWidth}
          dangerColor={theme.colors.danger}
          archiveColor={theme.colors.primary}
          archived={archived}
          onDelete={() => {
            swipeable.close();
            onDelete();
          }}
          onArchive={onArchive ? () => {
            swipeable.close();
            onArchive();
          } : undefined}
        />
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  action: { width: ACTION_WIDTH, alignItems: 'center', justifyContent: 'center' },
});

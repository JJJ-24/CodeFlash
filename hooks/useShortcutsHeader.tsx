import { useLayoutEffect, useRef } from 'react';
import { Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import { HeaderTapToTop } from '@/components/HeaderTapToTop';
import { useTheme } from '@/lib/theme';

/**
 * 標準ヘッダー（学習/統計/設定タブ）の右端にショートカット一覧ボタンを出す。
 * `onHeaderTap` を渡すと、ヘッダーの何も無いところのタップで呼ぶ（一覧の先頭へ戻す用。
 * 詳細は components/HeaderTapToTop.tsx）。背景に敷くのでボタンのタップでは呼ばれない。
 * ⚠️ 標準ヘッダーはタイトル・ボタンの箱が背景の兄弟なので、タイトルの Text に当たったタップは背景へ
 * 届かない＝タブのタイトルは app/(tabs)/_layout.tsx で pointerEvents="none" にしてある。
 */
export function useShortcutsHeader(enabled: boolean, onPress: () => void, onHeaderTap?: () => void) {
  const navigation = useNavigation();
  const theme = useTheme();
  // 毎レンダー新しい関数が来ても setOptions をやり直さないよう ref 経由で呼ぶ
  const headerTapRef = useRef(onHeaderTap);
  headerTapRef.current = onHeaderTap;
  const hasHeaderTap = onHeaderTap != null;

  useLayoutEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigation as any).setOptions({
      headerRight: enabled ? () => (
        <Pressable onPress={onPress} style={{ paddingHorizontal: 8 }}>
          <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
        </Pressable>
      ) : undefined,
      headerRightContainerStyle: enabled ? { paddingRight: 8 } : undefined,
      headerBackground: hasHeaderTap
        ? ({ style }: { style: any }) => (
          <HeaderTapToTop style={[{ flex: 1 }, style]} onPress={() => headerTapRef.current?.()} />
        )
        : undefined,
    });
  }, [enabled, theme, onPress, navigation, hasHeaderTap]);
}

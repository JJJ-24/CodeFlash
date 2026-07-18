import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { popEscDismiss } from '@/lib/escStack';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useLockedTopInset } from '@/lib/useLockedTopInset';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

import { settingsStyles } from './styles';

interface Props {
  title: string;
  children: ReactNode;
  /** ScrollView の外（最前面）に重ねる要素。モーダルやローディングオーバーレイ用。 */
  overlay?: ReactNode;
  /**
   * 戻る挙動の上書き（モーダルを開いている画面は「先に閉じる」を渡す）。既定は router.back()。
   * direct=true は戻るボタン/FAB/B キー＝インライン info 展開は閉じずに直接戻る（本物のモーダルだけ先に閉じる）。
   * false は Esc＝階層ディスマス（info 展開も1段として閉じる）。
   */
  onBack?: (direct: boolean) => void;
}

/**
 * 設定のドリルイン用サブ画面の共通シェル。
 * push 遷移時の戻るボタン残像を防ぐため headerShown:false ＋ インラインカスタムヘッダー
 * （CLAUDE.md のカスタムヘッダーパターン。about.tsx と同形）。
 */
export function SettingsDetail({ title, children, overlay, onBack }: Props) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const lockedTopInset = useLockedTopInset();

  // Esc = 階層ディスマス。まず最前面のインライン展開（SegmentedCard の info 等）を閉じ、
  // 無ければ onBack（モーダル→インライン info→戻る）または router.back()。
  const handleEsc = () => {
    if (popEscDismiss()) return;
    if (onBack) onBack(false); else router.back();
  };
  // 戻るボタン / FAB / B = 直接戻る。インライン info 展開は消費しない
  // （本物のモーダルが開いていれば onBack 側が先に閉じる。ボタンはモーダル表示中タップ不可のため実質 B キー用）。
  const handleBack = () => {
    if (onBack) onBack(true); else router.back();
  };
  useKeyCommands([
    { input: 'b', handler: handleBack },
    { input: KeyCommand.keyInputEscape, handler: handleEsc },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* インラインカスタムヘッダー */}
      <View style={{ height: lockedTopInset + 44, backgroundColor: theme.colors.surface }}>
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 44,
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
        }}>
          <View style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }}>
            <Text
              style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {title}
            </Text>
          </View>
          <Pressable
            onPress={handleBack}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={4}
          >
            <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 36 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[settingsStyles.container, { paddingBottom: 32 + 56 + 24 + insets.bottom }]}>
        {children}
      </ScrollView>

      {/* 左下フローティング戻るボタン（カード一覧・タグ管理と同パターン） */}
      <Pressable
        style={[fabStyles.fab, { left: 20, bottom: Math.max(insets.bottom, 16) + 16, backgroundColor: theme.colors.primary }]}
        onPress={handleBack}
        hitSlop={6}
      >
        <Ionicons name="chevron-back" size={28} color="#FFF" />
      </Pressable>

      {overlay}
    </View>
  );
}

const fabStyles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
});

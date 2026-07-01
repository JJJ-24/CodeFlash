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
  /** 戻る挙動の上書き（モーダルを開いている画面は「先に閉じる」を渡す）。既定は router.back()。 */
  onBack?: () => void;
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

  // 戻る（Esc / B / 戻るボタン / FAB 共通）。まず最前面のインライン展開（SegmentedCard の info 等）を
  // 閉じ、無ければ onBack（モーダルを先に閉じる等）または router.back()。
  const handleBack = () => {
    if (popEscDismiss()) return;
    if (onBack) onBack(); else router.back();
  };
  useKeyCommands([
    { input: 'b', handler: handleBack },
    { input: KeyCommand.keyInputEscape, handler: handleBack },
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
        onPress={() => router.back()}
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

import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

import { settingsStyles } from './styles';

interface Props {
  title: string;
  children: ReactNode;
  /** ScrollView の外（最前面）に重ねる要素。モーダルやローディングオーバーレイ用。 */
  overlay?: ReactNode;
}

/**
 * 設定のドリルイン用サブ画面の共通シェル。
 * push 遷移時の戻るボタン残像を防ぐため headerShown:false ＋ インラインカスタムヘッダー
 * （CLAUDE.md のカスタムヘッダーパターン。about.tsx と同形）。
 */
export function SettingsDetail({ title, children, overlay }: Props) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const initialTopInsetRef = useRef(insets.top);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* インラインカスタムヘッダー */}
      <View style={{ height: initialTopInsetRef.current + 44, backgroundColor: theme.colors.surface }}>
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
            onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={4}
          >
            <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 36 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={settingsStyles.container}>
        {children}
      </ScrollView>
      {overlay}
    </View>
  );
}

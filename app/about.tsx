import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { constants as KeyCommand } from 'react-native-key-command';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InfoModal } from '@/components/InfoModal';
import { useKeyCommands } from '@/lib/useKeyCommands';

import { APP_STORE_REVIEW_URL, CONTACT_EMAIL, PRIVACY_URL, TERMS_URL } from '@/lib/links';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW } from '@/lib/theme';

export default function AboutScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const initialTopInsetRef = useRef(insets.top);

  const [errorVisible, setErrorVisible] = useState(false);
  const isOpeningRef = useRef(false);

  const appVersion = Constants.expoConfig?.version ?? '';

  // Esc / B = 戻る（エラー表示中は先に閉じる）。
  const goBack = () => { if (errorVisible) { setErrorVisible(false); return; } router.back(); };
  useKeyCommands([
    { input: 'b', handler: goBack },
    { input: KeyCommand.keyInputEscape, handler: goBack },
  ]);

  async function openExternalLink(url: string) {
    if (isOpeningRef.current) return;
    isOpeningRef.current = true;
    setTimeout(() => { isOpeningRef.current = false; }, 1500);
    try {
      await Linking.openURL(url);
    } catch {
      setErrorVisible(true);
    }
  }

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
              {t('about.title')}
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

      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 32 + 56 + 24 + insets.bottom }]}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('about.version')}
              </Text>
            </View>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.md }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {appVersion}
            </Text>
          </View>

          <Pressable style={styles.row} onPress={() => openExternalLink(PRIVACY_URL)}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('about.privacyPolicy')}
              </Text>
            </View>
            <Ionicons name="open-outline" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
          </Pressable>

          <Pressable style={styles.row} onPress={() => openExternalLink(TERMS_URL)}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('about.terms')}
              </Text>
            </View>
            <Ionicons name="open-outline" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
          </Pressable>

          <Pressable style={styles.row} onPress={() => openExternalLink(`mailto:${CONTACT_EMAIL}`)}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('about.contact')}
              </Text>
              <Text style={[styles.rowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {CONTACT_EMAIL}
              </Text>
            </View>
            <Ionicons name="mail-outline" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
          </Pressable>

          <Pressable style={styles.row} onPress={() => openExternalLink(APP_STORE_REVIEW_URL)}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('about.writeReview')}
              </Text>
            </View>
            <Ionicons name="star-outline" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
          </Pressable>
        </View>
      </ScrollView>

      {/* 左下フローティング戻るボタン（設定セクション画面と統一） */}
      <Pressable
        style={[styles.fab, { left: 20, bottom: Math.max(insets.bottom, 16) + 16, backgroundColor: theme.colors.primary }]}
        onPress={() => router.back()}
        hitSlop={6}
      >
        <Ionicons name="chevron-back" size={28} color="#FFF" />
      </Pressable>

      {errorVisible && (
        <InfoModal
          visible
          message={t('about.openLinkError')}
          onClose={() => setErrorVisible(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  card: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    ...SHADOW.subtle,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '600' },
  rowSubtitle: {},
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

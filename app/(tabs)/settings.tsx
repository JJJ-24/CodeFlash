import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { useThemeStore } from '@/store/theme';
import type { ColorSchemePreference } from '@/store/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { preference, setPreference } = useThemeStore();

  const themeOptions: { value: ColorSchemePreference; labelKey: string }[] = [
    { value: 'light', labelKey: 'settings.themeLight' },
    { value: 'dark', labelKey: 'settings.themeDark' },
    { value: 'system', labelKey: 'settings.themeSystem' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* テーマ設定 */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
          {t('settings.theme')}
        </Text>
        <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
          {themeOptions.map(({ value, labelKey }) => {
            const active = preference === value;
            return (
              <Pressable
                key={value}
                style={[
                  styles.segment,
                  active && { backgroundColor: theme.colors.surface },
                ]}
                onPress={() => setPreference(value)}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: active ? theme.colors.primary : theme.colors.textSecondary },
                    active && styles.segmentTextActive,
                  ]}
                >
                  {t(labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* タグ管理 */}
      <Pressable
        style={[styles.row, { backgroundColor: theme.colors.surface }]}
        onPress={() => router.push('/tags')}
      >
        <Ionicons name="pricetags-outline" size={22} color={theme.colors.primary} />
        <Text style={[styles.rowText, { color: theme.colors.text }]}>{t('tag.title')}</Text>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.iconSubtle} style={styles.chevron} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  card: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  segmented: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: 'center',
  },
  segmentText: { fontSize: 14 },
  segmentTextActive: { fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  rowText: { flex: 1, fontSize: 16 },
  chevron: { marginLeft: 'auto' },
});

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import { useThemeStore } from '@/store/theme';
import type { ColorSchemePreference, FontSizePreference } from '@/store/theme';

const SHORTCUTS = [
  { key: 'Space',     descKey: 'settings.shortcutFlip' },
  { key: '1–4',       descKey: 'settings.shortcutGrade' },
  { key: 'J',         descKey: 'settings.shortcutPrev' },
  { key: 'K',         descKey: 'settings.shortcutNext' },
  { key: 'M',         descKey: 'settings.shortcutMemo' },
  { key: 'F',         descKey: 'settings.shortcutFullscreen' },
  { key: 'E',         descKey: 'settings.shortcutEdit' },
  { key: 'Shift+Tab', descKey: 'settings.shortcutRun' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { preference, setPreference, fontSizePreference, setFontSizePreference } = useThemeStore();
  const { keyboardShortcutsEnabled, setKeyboardShortcutsEnabled } = useSettingsStore();

  const themeOptions: { value: ColorSchemePreference; labelKey: string }[] = [
    { value: 'light', labelKey: 'settings.themeLight' },
    { value: 'dark', labelKey: 'settings.themeDark' },
    { value: 'system', labelKey: 'settings.themeSystem' },
  ];

  const fontSizeOptions: { value: FontSizePreference; labelKey: string }[] = [
    { value: 'small', labelKey: 'settings.fontSizeSmall' },
    { value: 'medium', labelKey: 'settings.fontSizeMedium' },
    { value: 'large', labelKey: 'settings.fontSizeLarge' },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.container}>
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

      {/* フォントサイズ設定 */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
          {t('settings.fontSize')}
        </Text>
        <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
          {fontSizeOptions.map(({ value, labelKey }) => {
            const active = fontSizePreference === value;
            return (
              <Pressable
                key={value}
                style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
                onPress={() => setFontSizePreference(value)}
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

      {/* キーボードショートカット ON/OFF */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
          {t('settings.keyboard')}
        </Text>
        <View style={styles.switchRow}>
          <Text style={[styles.switchLabel, { color: theme.colors.text }]}>
            {t('settings.keyboardEnabled')}
          </Text>
          <Switch
            value={keyboardShortcutsEnabled}
            onValueChange={setKeyboardShortcutsEnabled}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>
      </View>

      {/* ショートカット一覧 */}
      {keyboardShortcutsEnabled && (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
            {t('settings.keyboardShortcuts')}
          </Text>
          {SHORTCUTS.map(({ key, descKey }) => (
            <View key={key} style={styles.shortcutRow}>
              <View style={[styles.keyBadge, { backgroundColor: theme.colors.background }]}>
                <Text style={[styles.keyBadgeText, { color: theme.colors.text }]}>{key}</Text>
              </View>
              <Text style={[styles.shortcutDesc, { color: theme.colors.textSecondary }]}>
                {t(descKey)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: { fontSize: 15, flex: 1 },
  shortcutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  keyBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 44,
    alignItems: 'center',
  },
  keyBadgeText: { fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  shortcutDesc: { fontSize: 13, flex: 1 },
});

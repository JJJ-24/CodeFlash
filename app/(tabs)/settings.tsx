import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import { useThemeStore } from '@/store/theme';
import type { ColorSchemePreference, FontSizePreference } from '@/store/theme';
import type { InitialFilterPreference } from '@/store/settings';

const SHORTCUTS = [
  { key: 'Space', descKey: 'settings.shortcutFlip' },
  { key: '1–4',   descKey: 'settings.shortcutGrade' },
  { key: 'J',     descKey: 'settings.shortcutPrev' },
  { key: 'K',     descKey: 'settings.shortcutNext' },
  { key: 'M',     descKey: 'settings.shortcutMemo' },
  { key: 'F',     descKey: 'settings.shortcutFullscreen' },
  { key: 'Tab',   descKey: 'settings.shortcutSelectBlock' },
  { key: 'R',     descKey: 'settings.shortcutRun' },
  { key: 'E',     descKey: 'settings.shortcutEdit' },
];

interface SegmentedCardProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

function SegmentedCard<T extends string>({ label, options, value, onChange }: SegmentedCardProps<T>) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
      <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
        {options.map(({ value: optValue, label: optLabel }) => {
          const active = value === optValue;
          return (
            <Pressable
              key={optValue}
              style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
              onPress={() => onChange(optValue)}
            >
              <Text style={[
                styles.segmentText,
                { color: active ? theme.colors.primary : theme.colors.textSecondary },
                active && styles.segmentTextActive,
              ]}>
                {optLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { preference, setPreference, fontSizePreference, setFontSizePreference } = useThemeStore();
  const { keyboardShortcutsEnabled, setKeyboardShortcutsEnabled, initialFilterPreference, setInitialFilterPreference } = useSettingsStore();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.container}>
      <SegmentedCard
        label={t('settings.theme')}
        options={[
          { value: 'light' as ColorSchemePreference, label: t('settings.themeLight') },
          { value: 'dark' as ColorSchemePreference,  label: t('settings.themeDark') },
          { value: 'system' as ColorSchemePreference, label: t('settings.themeSystem') },
        ]}
        value={preference}
        onChange={setPreference}
      />

      <SegmentedCard
        label={t('settings.fontSize')}
        options={[
          { value: 'small' as FontSizePreference,  label: t('settings.fontSizeSmall') },
          { value: 'medium' as FontSizePreference, label: t('settings.fontSizeMedium') },
          { value: 'large' as FontSizePreference,  label: t('settings.fontSizeLarge') },
        ]}
        value={fontSizePreference}
        onChange={setFontSizePreference}
      />

      <SegmentedCard
        label={t('settings.initialFilter')}
        options={[
          { value: 'all' as InitialFilterPreference,    label: t('settings.initialFilterAll') },
          { value: 'review' as InitialFilterPreference, label: t('settings.initialFilterReview') },
          { value: 'none' as InitialFilterPreference,   label: t('settings.initialFilterNone') },
        ]}
        value={initialFilterPreference}
        onChange={setInitialFilterPreference}
      />

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

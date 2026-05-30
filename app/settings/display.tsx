import { useTranslation } from 'react-i18next';
import { Switch, Text, View } from 'react-native';

import { SegmentedCard } from '@/components/settings/SegmentedCard';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles as styles } from '@/components/settings/styles';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useSettingsStore, type InitialFilterPreference } from '@/store/settings';
import { useThemeStore, type ColorSchemePreference, type FontSizePreference } from '@/store/theme';

export default function DisplaySettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { preference, setPreference, fontSizePreference, setFontSizePreference } = useThemeStore();
  const {
    initialFilterPreference, setInitialFilterPreference,
    keyboardShortcutsEnabled, setKeyboardShortcutsEnabled,
  } = useSettingsStore();

  return (
    <SettingsDetail title={t('settings.display')}>
      <SegmentedCard
        label={t('settings.theme')}
        options={[
          { value: 'light' as ColorSchemePreference, label: t('settings.themeLight') },
          { value: 'dark' as ColorSchemePreference, label: t('settings.themeDark') },
          { value: 'system' as ColorSchemePreference, label: t('settings.themeSystem') },
        ]}
        value={preference}
        onChange={setPreference}
      />

      <SegmentedCard
        label={t('settings.fontSize')}
        options={[
          { value: 'small' as FontSizePreference, label: t('settings.fontSizeSmall') },
          { value: 'medium' as FontSizePreference, label: t('settings.fontSizeMedium') },
          { value: 'large' as FontSizePreference, label: t('settings.fontSizeLarge') },
        ]}
        value={fontSizePreference}
        onChange={setFontSizePreference}
      />

      <SegmentedCard
        label={t('settings.initialFilter')}
        info={t('settings.initialFilterInfo')}
        options={[
          { value: 'all' as InitialFilterPreference, label: t('common.all') },
          { value: 'review' as InitialFilterPreference, label: t('common.due') },
          { value: 'none' as InitialFilterPreference, label: t('settings.initialFilterNone') },
        ]}
        value={initialFilterPreference}
        onChange={setInitialFilterPreference}
      />

      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {t('settings.keyboard')}
        </Text>
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.keyboardEnabled')}
          </Text>
          <Switch
            value={keyboardShortcutsEnabled}
            onValueChange={setKeyboardShortcutsEnabled}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>
      </View>
    </SettingsDetail>
  );
}

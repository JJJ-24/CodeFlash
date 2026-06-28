import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles as styles } from '@/components/settings/styles';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useProStore } from '@/store/pro';
import {
  FSRS_PRESET_RETENTION,
  FSRS_RETENTION_MAX,
  FSRS_RETENTION_MIN,
  useSettingsStore,
  type FsrsPreset,
} from '@/store/settings';

export default function StudySettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { isPro } = useProStore();
  const { fsrsDesiredRetention, setFsrsDesiredRetention } = useSettingsStore();
  const [showRetentionInfo, setShowRetentionInfo] = useState(false);

  function handleFsrsPresetSelect(preset: FsrsPreset) {
    setFsrsDesiredRetention(FSRS_PRESET_RETENTION[preset]);
  }

  function handleFsrsRetentionChange(value: number) {
    setFsrsDesiredRetention(Math.round(value * 100) / 100);
  }

  // 非 Pro でも直接到達しうるので、ロック状態はここでも提示する（ペイウォールへ誘導）。
  if (!isPro) {
    return (
      <SettingsDetail title={t('settings.fsrs')}>
        <Pressable
          style={[styles.card, { backgroundColor: theme.colors.surface }]}
          onPress={() => router.push('/paywall')}
        >
          <View style={styles.proRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.proTitleRow}>
                <Text style={[styles.proTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('settings.fsrs')}
                </Text>
                <Ionicons name="lock-closed" size={theme.fontSize.sm} color={theme.colors.primary} />
              </View>
              <Text style={[styles.proSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.fsrsLockedSubtitle')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
          </View>
        </Pressable>
      </SettingsDetail>
    );
  }

  return (
    <SettingsDetail
      title={t('settings.fsrs')}
      onBack={() => { if (showRetentionInfo) { setShowRetentionInfo(false); return; } router.back(); }}
    >
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        {/* プリセット */}
        <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
          {(['longTerm', 'standard', 'exam'] as FsrsPreset[]).map((preset) => {
            const active = FSRS_PRESET_RETENTION[preset] === fsrsDesiredRetention;
            const labelKey = ({
              exam: 'settings.fsrsPresetFocus',
              standard: 'settings.fsrsPresetStandard',
              longTerm: 'settings.fsrsPresetLongTerm',
            } as const)[preset];
            return (
              <Pressable
                key={preset}
                style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
                onPress={() => handleFsrsPresetSelect(preset)}
              >
                <Text style={[
                  styles.segmentText,
                  { color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.sm },
                  active && styles.segmentTextActive,
                ]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t(labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* 目標保持率 */}
        <View style={{ gap: 6 }}>
          <View style={styles.fsrsRetentionHeader}>
            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              onPress={() => setShowRetentionInfo((v) => !v)}
              hitSlop={6}
            >
              <Text style={[styles.fsrsSubLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.fsrsRetention')}
              </Text>
              <Ionicons
                name={showRetentionInfo ? 'information-circle' : 'information-circle-outline'}
                size={Math.max(theme.fontSize.lg, 20)}
                color={theme.colors.textTertiary}
              />
            </Pressable>
            <Text style={[styles.fsrsRetentionValue, { color: theme.colors.primary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {Math.round(fsrsDesiredRetention * 100)}%
            </Text>
          </View>
          <Slider
            minimumValue={FSRS_RETENTION_MIN}
            maximumValue={FSRS_RETENTION_MAX}
            step={0.01}
            value={fsrsDesiredRetention}
            onValueChange={handleFsrsRetentionChange}
            minimumTrackTintColor={theme.colors.primary}
            maximumTrackTintColor={theme.colors.iconSubtle}
            thumbTintColor={theme.colors.primary}
          />
          <View style={styles.fsrsRetentionScale}>
            <Text style={[styles.fsrsScaleText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
              {Math.round(FSRS_RETENTION_MIN * 100)}%
            </Text>
            <Text style={[styles.fsrsScaleText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
              {Math.round(FSRS_RETENTION_MAX * 100)}%
            </Text>
          </View>
          {showRetentionInfo && (
            <View style={[styles.syncInfoBox, { backgroundColor: theme.colors.background }]}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.fsrsRetentionInfo')}
              </Text>
            </View>
          )}
        </View>
      </View>
    </SettingsDetail>
  );
}

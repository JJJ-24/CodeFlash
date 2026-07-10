import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, Text, View } from 'react-native';

import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles as styles } from '@/components/settings/styles';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useProStore } from '@/store/pro';
import {
  FSRS_PRESET_RETENTION,
  FSRS_RETENTION_MAX,
  FSRS_RETENTION_MIN,
  STUDY_TIMER_MINUTES_MAX,
  STUDY_TIMER_MINUTES_MIN,
  useSettingsStore,
  type FsrsPreset,
  type StudyTimerEndBehavior,
} from '@/store/settings';

export default function StudySettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { isPro } = useProStore();
  const {
    fsrsDesiredRetention, setFsrsDesiredRetention,
    studyTimerEnabled, setStudyTimerEnabled,
    studyTimerMinutes, setStudyTimerMinutes,
    studyTimerRingVisible, setStudyTimerRingVisible,
    studyTimerShowTime, setStudyTimerShowTime,
    studyTimerEndBehavior, setStudyTimerEndBehavior,
  } = useSettingsStore();
  const [showRetentionInfo, setShowRetentionInfo] = useState(false);
  const [showTimerInfo, setShowTimerInfo] = useState(false);

  function handleFsrsPresetSelect(preset: FsrsPreset) {
    setFsrsDesiredRetention(FSRS_PRESET_RETENTION[preset]);
  }

  function handleFsrsRetentionChange(value: number) {
    setFsrsDesiredRetention(Math.round(value * 100) / 100);
  }

  // 非 Pro でも直接到達しうるので、ロック状態はここでも提示する（ペイウォールへ誘導）。
  if (!isPro) {
    return (
      <SettingsDetail title={t('settings.studySettings')}>
        <Pressable
          style={[styles.card, { backgroundColor: theme.colors.surface }]}
          onPress={() => router.push('/paywall')}
        >
          <View style={styles.proRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.proTitleRow}>
                <Text style={[styles.proTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('settings.studySettings')}
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
      title={t('settings.studySettings')}
      onBack={() => {
        if (showRetentionInfo || showTimerInfo) { setShowRetentionInfo(false); setShowTimerInfo(false); return; }
        router.back();
      }}
    >
      {/* FSRSカスタマイズ */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text
          style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
        >
          {t('settings.fsrs')}
        </Text>
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

      {/* 学習タイマー（036・Pro）。説明は常時表示せず、i アイコンのタップで展開（目標保持率と同じ流儀） */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Pressable
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          onPress={() => setShowTimerInfo((v) => !v)}
          hitSlop={6}
        >
          <Text
            style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
          >
            {t('settings.studyTimer')}
          </Text>
          <Ionicons
            name={showTimerInfo ? 'information-circle' : 'information-circle-outline'}
            size={Math.max(theme.fontSize.lg, 20)}
            color={theme.colors.textTertiary}
          />
        </Pressable>
        {showTimerInfo && (
          <View style={[styles.syncInfoBox, { backgroundColor: theme.colors.background }]}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('settings.studyTimerInfo')}
            </Text>
          </View>
        )}
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.studyTimerEnable')}
          </Text>
          <Switch
            value={studyTimerEnabled}
            onValueChange={setStudyTimerEnabled}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>

        {studyTimerEnabled && (
          <>
            {/* 時間（1〜60分） */}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('settings.studyTimerMinutes')}
                </Text>
                <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.lg, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {t('settings.studyTimerMinutesValue', { n: studyTimerMinutes })}
                </Text>
              </View>
              <Slider
                minimumValue={STUDY_TIMER_MINUTES_MIN}
                maximumValue={STUDY_TIMER_MINUTES_MAX}
                step={1}
                value={studyTimerMinutes}
                onValueChange={setStudyTimerMinutes}
                minimumTrackTintColor={theme.colors.primary}
                maximumTrackTintColor={theme.colors.iconSubtle}
                thumbTintColor={theme.colors.primary}
              />
            </View>

            {/* リングを表示 */}
            <View style={styles.notificationRow}>
              <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.studyTimerRingVisible')}
              </Text>
              <Switch
                value={studyTimerRingVisible}
                onValueChange={setStudyTimerRingVisible}
                trackColor={{ true: theme.colors.primary }}
              />
            </View>

            {/* 残り時間を表示 */}
            <View style={styles.notificationRow}>
              <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.studyTimerShowTime')}
              </Text>
              <Switch
                value={studyTimerShowTime}
                onValueChange={setStudyTimerShowTime}
                trackColor={{ true: theme.colors.primary }}
              />
            </View>

            {/* 終了時の動作 */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.studyTimerEndBehavior')}
              </Text>
              <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
                {(['alert', 'blink'] as StudyTimerEndBehavior[]).map((behavior) => {
                  const active = behavior === studyTimerEndBehavior;
                  return (
                    <Pressable
                      key={behavior}
                      style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
                      onPress={() => setStudyTimerEndBehavior(behavior)}
                    >
                      <Text style={[
                        styles.segmentText,
                        { color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.sm },
                        active && styles.segmentTextActive,
                      ]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                        {t(behavior === 'alert' ? 'settings.studyTimerEndAlert' : 'settings.studyTimerEndBlink')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        )}
      </View>
    </SettingsDetail>
  );
}

// 統計：草グラフをタップしたときに出る「学習の記録」ボトムシート。
// 継続・積み上げ系の指標（最長連続・総学習回数・総学習時間・経過日数）と、20個のバッジ枠を表示する。
// ドーナツグラフ側（正答率/学習日数/平均時間）と重複しない指標に絞っている。無料機能。
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { FontAwesome5, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as KeyCommand from 'react-native-key-command';

import { useKeyCommands } from '@/lib/useKeyCommands';
import { MAX_FONT_MULTIPLIER, FILTER_COLORS, type AppTheme } from '@/lib/theme';
import { InfoModal } from '@/components/InfoModal';
import type { LifetimeStats } from '@/lib/database/reviews';
import { BADGES, BADGE_SECTIONS, earnedBadgeCount, isBadgeEarned } from '@/lib/stats/badges';

interface Props {
  visible: boolean;
  onClose: () => void;
  stats: LifetimeStats | null;
  theme: AppTheme;
}

// 数値ブロックの表示片。unit=true の片（h/m/%）だけ小さいフォントで描画する。
type ValueSegment = { text: string; unit?: boolean };

// 右列3ブロックの表示モード（ソートトグルと同じ3アイコン切替）。回数・時間に効き、日数は特別扱い。
type RecordMode = 'total' | 'max' | 'avg';
const RECORD_MODES: { key: RecordMode; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; labelKey: string; descKey: string }[] = [
  { key: 'total', icon: 'sigma', labelKey: 'stats.recordModeTotal', descKey: 'stats.recordModeDescTotal' },
  { key: 'max', icon: 'format-vertical-align-top', labelKey: 'stats.recordModeMax', descKey: 'stats.recordModeDescMax' },
  { key: 'avg', icon: 'scale-balance', labelKey: 'stats.recordModeAvg', descKey: 'stats.recordModeDescAvg' },
];

/** ローカル YYYY-MM-DD から今日までの経過日数（当日含む）。 */
function elapsedDaysSince(firstDate: string | null): number | null {
  if (!firstDate) return null;
  const [y, m, d] = firstDate.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - start) / 86400000) + 1;
}

const IS_PAD = (Platform as any).isPad;
// 「新記録まで N 日」を表示する残り日数の上限（これ以内なら近いカウントダウンを出す）。
const RECORD_COUNTDOWN_MAX = 3;

export function LearningRecordSheet({ visible, onClose, stats, theme }: Props) {
  const { t } = useTranslation();
  const { height: screenHeight } = useWindowDimensions();
  const sheetY = useSharedValue(screenHeight);
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      overlayOpacity.value = withTiming(1, { duration: 200 });
      sheetY.value = withTiming(0, { duration: 250 });
    } else {
      overlayOpacity.value = withTiming(0, { duration: 200 });
      sheetY.value = withTiming(screenHeight, { duration: 250 });
    }
  }, [visible, screenHeight]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  // 右列3ブロックのトータル/最高/平均トグル。開くたびトータルに戻す（初期選択＝トータル）。
  const [mode, setMode] = useState<RecordMode>('total');
  // 表示モードの説明モーダル（iアイコン）。シートを閉じたら一緒に閉じる。
  const [showModeInfo, setShowModeInfo] = useState(false);
  useEffect(() => { if (visible) setMode('total'); else setShowModeInfo(false); }, [visible]);

  // Space / Return でシートを閉じる（ドーナツシートと同じトグル挙動）。表示中のみ有効。
  // 説明モーダル（i アイコン）表示中は誤ってシートを閉じないよう解除する。
  // Esc は親 stats の常時 Esc ハンドラが閉じる（月別シートと同じ方式・二重登録を避ける）。
  useKeyCommands([
    { input: ' ', handler: onClose },
    { input: KeyCommand.constants.keyInputEnter as string, handler: onClose },
  ], visible && !showModeInfo);

  // 数値＋単位を片に分解する（単位は unit:true）。h があるときのみ h を出す（従来の 1h23m / 45m を踏襲）。
  function formatDuration(ms: number): ValueSegment[] {
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const segs: ValueSegment[] = [];
    if (h > 0) segs.push({ text: String(h) }, { text: t('stats.durationUnitH'), unit: true });
    segs.push({ text: String(m) }, { text: t('stats.durationUnitM'), unit: true });
    return segs;
  }
  const plain = (text: string): ValueSegment[] => [{ text }];

  const elapsed = stats ? elapsedDaysSince(stats.firstDate) : null;
  const earned = stats ? earnedBadgeCount(stats) : 0;
  // 最長連続セル内のバッジ：現在の連続（今日起点。今日未学習なら 0）と、進行中を除く自己ベスト prevBestStreak
  // の関係で 4 状態を出し分ける。もうすぐ→タイ→達成→更新中 と日ごとに変化する。
  const recordPill = ((): { icon: React.ComponentProps<typeof Ionicons>['name']; iconColor: string; text: string } | null => {
    if (!stats || stats.currentStreak <= 0) return null;
    const cur = stats.currentStreak;
    const prev = stats.prevBestStreak;
    if (cur > prev + 1) return { icon: 'flame', iconColor: '#FFD54F', text: t('stats.recordStreakUpdating') };
    if (cur === prev + 1) return { icon: 'trophy', iconColor: '#FFD54F', text: t('stats.recordStreakNewBest') };
    if (cur === prev) return { icon: 'flame-outline', iconColor: '#FFD54F', text: t('stats.recordStreakTie') };
    const days = prev - cur + 1; // 記録を「抜く」のに必要な残り日数
    if (days <= RECORD_COUNTDOWN_MAX) return { icon: 'flag', iconColor: '#fff', text: t('stats.recordStreakCountdown', { days }) };
    return null;
  })();

  // 左列：最長連続（大・プライマリ背景）＋開始からの日数（下）。右列：総学習回数・総学習時間・総学習日数の3つ。
  const streakBlock = stats
    ? { value: String(stats.longestStreak), label: t('stats.recordLongestStreak'), color: '#F4511E' }
    : null;
  // 左下：開始からの日数（数字はグレー＝フィルター「新規」色）
  const leftBottomBlock = stats
    ? { value: elapsed != null ? String(elapsed) : '-', label: t('stats.recordElapsed'), color: theme.colors.textSecondary }
    : null;
  // 回数=青／時間=オレンジ（フィルター「復習」色）／日数=緑。モードで値とラベルを切り替える。
  // 平均は「1日あたり」＝学習日数で割る（回数・時間）。日数は継続率＝学習日数÷経過日数（%）。
  const REVIEW_COLOR = '#1976D2';
  const DAYS_COLOR = '#43A047';
  const avgReviews = stats && stats.totalDays > 0 ? stats.totalReviews / stats.totalDays : 0;
  const avgTimeMs = stats && stats.totalDays > 0 ? stats.totalTimeMs / stats.totalDays : 0;
  const continuityPct = stats && elapsed != null && elapsed > 0 ? Math.min(100, Math.round((stats.totalDays / elapsed) * 100)) : null;
  const rightBlocks: { segments: ValueSegment[]; label: string; color: string }[] = !stats
    ? []
    : mode === 'max'
    ? [
        { segments: plain(stats.maxDailyReviews.toLocaleString()), label: t('stats.recordMaxReviews'), color: REVIEW_COLOR },
        { segments: formatDuration(stats.maxDailyTimeMs), label: t('stats.recordMaxTime'), color: FILTER_COLORS.due },
        // 日数の「最高」は暦月ごとの最高学習日数（1日の最高＝常に1で無意味なため月単位に）。
        { segments: plain(stats.maxMonthlyDays.toLocaleString()), label: t('stats.recordMaxMonthlyDays'), color: DAYS_COLOR },
      ]
    : mode === 'avg'
    ? [
        { segments: plain(avgReviews.toFixed(1)), label: t('stats.recordAvgReviews'), color: REVIEW_COLOR },
        { segments: formatDuration(avgTimeMs), label: t('stats.recordAvgTime'), color: FILTER_COLORS.due },
        { segments: continuityPct != null ? [{ text: String(continuityPct) }, { text: '%', unit: true }] : plain('-'), label: t('stats.recordContinuity'), color: DAYS_COLOR },
      ]
    : [
        { segments: plain(stats.totalReviews.toLocaleString()), label: t('stats.recordTotalReviews'), color: REVIEW_COLOR },
        { segments: formatDuration(stats.totalTimeMs), label: t('stats.recordTotalTime'), color: FILTER_COLORS.due },
        { segments: plain(stats.totalDays.toLocaleString()), label: t('stats.recordTotalDays'), color: DAYS_COLOR },
      ];

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, overlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[sheetStyle, styles.sheet, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('stats.recordTitle')}
          </Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
          <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
        </Pressable>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* 見出し＋iアイコン（左）＋右列3ブロックの表示モード切替（ソートトグルと同じ3アイコン・右）。 */}
          {stats && (
            <View style={styles.toggleRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md, flexShrink: 1 }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {t('stats.recordSummaryTitle')}
                </Text>
                <Pressable onPress={() => setShowModeInfo(true)} hitSlop={8} accessibilityLabel={t('stats.recordModeInfoTitle')}>
                  <Ionicons name="information-circle-outline" size={Math.max(theme.fontSize.lg, 20)} color={theme.colors.textTertiary} />
                </Pressable>
              </View>
              <View style={styles.modeButtons}>
                {RECORD_MODES.map(({ key, icon, labelKey }) => {
                  const active = mode === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setMode(key)}
                      accessibilityLabel={t(labelKey)}
                      style={[
                        styles.modeBtn,
                        { borderColor: active ? theme.colors.primary : theme.colors.buttonBorder, paddingHorizontal: (Platform as any).isPad ? 32 : 10 },
                        active && { backgroundColor: theme.colors.primary },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={icon}
                        size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
                        color={active ? theme.colors.primaryText : theme.colors.textSecondary}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          {/* 上部の数値ブロック：左列（最長連続・大＋総学習日数）／右列（3つ縦積み） */}
          {stats && streakBlock && leftBottomBlock && (
            <View style={styles.numberRow}>
              <View style={styles.leftColumn}>
                <View style={[styles.streakCell, { backgroundColor: theme.colors.primary }]}>
                  {recordPill && (
                    <View style={styles.recordPill}>
                      <Ionicons name={recordPill.icon} size={Math.max(theme.fontSize.xs, 12)} color={recordPill.iconColor} />
                      <Text style={[styles.recordPillText, { color: '#fff', fontSize: theme.fontSize.xs }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                        {recordPill.text}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.numberValue, { color: '#fff', fontSize: theme.fontSize.xxl * 1.2 }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {streakBlock.value}
                  </Text>
                  <Text style={[styles.numberLabel, { color: 'rgba(255,255,255,0.85)', fontSize: theme.fontSize.xs }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                    {streakBlock.label}
                  </Text>
                </View>
                <View style={[styles.numberCell, { backgroundColor: theme.colors.background }]}>
                  <Text style={[styles.numberValue, { color: leftBottomBlock.color, fontSize: theme.fontSize.xxl * 0.8 }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {leftBottomBlock.value}
                  </Text>
                  <Text style={[styles.numberLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                    {leftBottomBlock.label}
                  </Text>
                </View>
              </View>
              <View style={styles.rightColumn}>
                {rightBlocks.map((b, i) => (
                  <View key={i} style={[styles.numberCell, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.numberValue, { color: b.color, fontSize: theme.fontSize.xxl * 0.8 }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {b.segments.map((s, si) => (
                        // 単位（h/m/%）は数値より一段小さく（md）・やや細く描画する。色は継承。
                        <Text key={si} style={s.unit ? { fontSize: theme.fontSize.md, fontWeight: '600' } : undefined}>
                          {s.text}
                        </Text>
                      ))}
                    </Text>
                    <Text style={[styles.numberLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                      {b.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* バッジ */}
          <View style={styles.badgeHeaderRow}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('stats.badges')}
            </Text>
            <Text style={[{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('stats.badgeEarnedCount', { earned, total: BADGES.length })}
            </Text>
          </View>

          {BADGE_SECTIONS.map((sec) => (
            <View key={sec.kind} style={styles.badgeSection}>
              <Text style={[styles.badgeSectionLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t(sec.labelKey)}
              </Text>
              <View style={[styles.badgeGrid, IS_PAD && { gap: 16 }]}>
                {/* 連続日数は未獲得を表示しない（白丸を出さず、獲得したメダルだけ並べる）。他カテゴリは全枠表示。 */}
                {BADGES.filter((b) => b.kind === sec.kind && (b.kind !== 'streak' || (stats ? isBadgeEarned(b, stats) : false))).map((b) => {
                  const got = stats ? isBadgeEarned(b, stats) : false;
                  const isStreak = b.kind === 'streak';
                  // 連続：獲得＝プライマリ背景の丸＋メダル色アイコン＋日数（未獲得は上の filter で除外済み）。
                  // その他：最初から薄いグレーのアイコン＋文字（獲得で色付き）。
                  const showIcon = isStreak ? got : true;
                  const iconColor = isStreak ? b.color : got ? b.color : theme.colors.iconSubtle;
                  const circleStyle = isStreak
                    ? got
                      ? { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary }
                      : { borderColor: theme.colors.inputBorder, backgroundColor: 'transparent' }
                    : got
                      ? { borderColor: b.color, backgroundColor: b.color + '22' }
                      : { borderColor: theme.colors.border, backgroundColor: 'transparent' };
                  const labelHidden = isStreak && !got;
                  return (
                    <View key={b.id} style={[styles.badgeCell, IS_PAD && { width: 76 }]}>
                      <View style={[styles.badgeIconWrap, circleStyle, !got && { opacity: isStreak ? 1 : 0.6 }]}>
                        {showIcon ? (
                          b.iconSet === 'ionicons' ? (
                            <Ionicons name={b.icon as keyof typeof Ionicons.glyphMap} size={20} color={iconColor} />
                          ) : (
                            <FontAwesome5 name={b.icon as keyof typeof FontAwesome5.glyphMap} size={18} color={iconColor} solid />
                          )
                        ) : null}
                      </View>
                      <Text
                        style={[styles.badgeShort, { color: labelHidden ? 'transparent' : got ? theme.colors.text : theme.colors.textTertiary, fontSize: theme.fontSize.xs }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                      >
                        {labelHidden ? ' ' : b.short}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </Animated.View>

      {/* 表示モードの説明（iアイコン）。ホームの情報モーダル風：[見出し]＋インラインアイコン＋一言。 */}
      <InfoModal
        visible={showModeInfo}
        title={t('stats.recordSummaryTitle')}
        message={
          <View>
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '700', marginBottom: 4 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {`[${t('stats.recordModeInfoTitle')}]`}
            </Text>
            {RECORD_MODES.map(({ key, icon, descKey }) => (
              <Text key={key} style={{ color: theme.colors.text, fontSize: theme.fontSize.md, lineHeight: 24, paddingLeft: 14 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                <MaterialCommunityIcons name={icon} size={theme.fontSize.md} color={theme.colors.primary} />
                {'  '}{t(descKey)}
              </Text>
            ))}
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20, marginTop: 8 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('stats.recordModeContinuityNote')}
            </Text>
          </View>
        }
        onClose={() => setShowModeInfo(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 24, maxHeight: '80%' },
  header: { alignItems: 'center', paddingHorizontal: 48, paddingVertical: 14 },
  title: { fontWeight: '700', textAlign: 'center' },
  closeBtn: { position: 'absolute', top: 14, right: 16, zIndex: 1, padding: 4 },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12, marginBottom: 10 },
  modeButtons: { flexDirection: 'row', gap: 6 },
  modeBtn: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  numberRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  leftColumn: { flex: 1, gap: 8 },
  rightColumn: { flex: 1, gap: 8 },
  streakCell: { flexGrow: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', gap: 4 },
  recordPill: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.22)' },
  recordPillText: { fontWeight: '700' },
  numberCell: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', gap: 4 },
  numberValue: { fontWeight: '700' },
  numberLabel: { textAlign: 'center' },
  badgeHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 20, marginBottom: 4 },
  sectionTitle: { fontWeight: '700' },
  badgeSection: { marginTop: 12 },
  badgeSectionLabel: { fontWeight: '600', marginBottom: 6 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badgeCell: { alignItems: 'center', width: 52, gap: 3 },
  badgeIconWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  badgeShort: { fontWeight: '600' },
});

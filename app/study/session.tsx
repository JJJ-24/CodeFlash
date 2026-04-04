import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';

import { BlocksView } from '@/components/study/BlocksView';
import { FlipCard, type FlipCardRef } from '@/components/study/FlipCard';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { LinksSheet } from '@/components/study/LinksSheet';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useCodeBlockSelection } from '@/hooks/useCodeBlockSelection';
import { useStudySession } from '@/hooks/useStudySession';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { FlipSuppressContext } from '@/lib/FlipSuppressContext';
import { updateBadgeCount } from '@/lib/notifications';
import { extractLinks } from '@/lib/study/extractLinks';
import { DONUT_CX, DONUT_CY, DONUT_INNER_R, DONUT_R, DONUT_SIZE, donutArcPath } from '@/lib/donut';
import { GRADE_COLORS, useTheme } from '@/lib/theme';
import type { Grade } from '@/lib/sm2';
import { useSettingsStore } from '@/store/settings';
import { useDeckStore } from '@/store/decks';
import { useTagStore } from '@/store/tags';

const SCROLL_STEP = 200;

const GRADES: { grade: Grade; labelKey: string; color: string }[] = [
  { grade: 0, labelKey: 'grade.again', color: GRADE_COLORS.again },
  { grade: 1, labelKey: 'grade.hard',  color: GRADE_COLORS.hard  },
  { grade: 2, labelKey: 'grade.good',  color: GRADE_COLORS.good  },
  { grade: 3, labelKey: 'grade.easy',  color: GRADE_COLORS.easy  },
];


const STUDY_SHORTCUTS = [
  { key: 'Space', descKey: 'settings.shortcutFlip' },
  { key: '1–4',  descKey: 'settings.shortcutGrade' },
  { key: 'J',    descKey: 'settings.shortcutNext' },
  { key: 'K',    descKey: 'settings.shortcutPrev' },
  { key: 'M',    descKey: 'settings.shortcutMemo' },
  { key: 'F',    descKey: 'settings.shortcutFullscreen' },
  { key: 'T',    descKey: 'settings.shortcutFocusBlock' },
  { key: 'Y',    descKey: 'settings.shortcutFocusBlockPrev' },
  { key: 'R',    descKey: 'settings.shortcutRun' },
  { key: 'E',    descKey: 'settings.shortcutEdit' },
  { key: 'U',    descKey: 'settings.shortcutScrollUp' },
  { key: 'D',    descKey: 'settings.shortcutScrollDown' },
  { key: 'B',    descKey: 'settings.shortcutBack' },
  { key: 'L',    descKey: 'settings.shortcutLinks' },
  { key: 'P',    descKey: 'settings.shortcutPencil' },
];

export default function StudySessionScreen() {
  const { deckId, tagId, filter, shuffle } = useLocalSearchParams<{ deckId?: string; tagId?: string; filter?: 'all' | 'today' | 'due' | 'unlearned'; shuffle?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const db = useSQLiteContext();
  const { loading, completed, currentCard, currentIndex, result, loadSession, submitGrade, goBack, goNext, refreshCurrentCard } =
    useStudySession();

  // モーダル遷移中は onBlur による自動再フォーカスを抑制するためのフラグ
  const { keyboardRef, isScreenFocusedRef, onScreenBlur } = useKeyboardFocus();
  useFocusEffect(
    useCallback(() => {
      isScreenFocusedRef.current = true;
      refreshCurrentCard();
      // モーダルから戻った際にキーボードショートカットを復元
      setTimeout(() => {
        if (!codeEditingRef.current) keyboardRef.current?.focus();
      }, 100);
      return () => { onScreenBlur(); };
    }, [refreshCurrentCard])
  );

  const { keyboardShortcutsEnabled } = useSettingsStore();
  const { width: screenWidth } = useWindowDimensions();
  const { decks } = useDeckStore();
  const { tags } = useTagStore();
  const sessionTitle = deckId
    ? (decks.find((d) => d.id === deckId)?.name ?? t('study.title'))
    : tagId
    ? (tags.find((tg) => tg.id === tagId)?.name ?? t('study.title'))
    : t('study.title');

  const [isFlipped, setIsFlipped] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [grading, setGrading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLinksModal, setShowLinksModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // cardId -> blockIndex -> 編集済みコード
  const [editedCodeBlocks, setEditedCodeBlocks] = useState<Record<string, Record<number, string>>>({});
  const codeEditingRef = useRef(false);
  const flipCardRef = useRef<FlipCardRef>(null);
  // コードブロックのボタンタップがFlipCardに伝播して意図せず裏返るのを防ぐ（300ms抑制）
  const suppressedRef = useRef(false);
  const suppress = useCallback(() => {
    suppressedRef.current = true;
    setTimeout(() => { suppressedRef.current = false; }, 300);
  }, []);

  const frontScrollRef = useRef<ScrollView>(null);
  const backScrollRef = useRef<ScrollView>(null);
  const frontScrollYRef = useRef(0);
  const backScrollYRef = useRef(0);
  const completeRef = useRef<TextInput>(null);
  const completeReadyRef = useRef(false);

  const cbs = useCodeBlockSelection();

  const swipe = useSwipeGesture({
    screenWidth,
    currentIndex,
    goNext,
    goBack,
    flipCardRef,
    onReset: () => {
      setIsFlipped(false);
      cbs.reset();
    },
  });

  const handleFlip = useCallback(() => setIsFlipped((v) => !v), []);
  const handleToggleMemo = useCallback(() => setShowMemo((v) => !v), []);

  const cardLinks = useMemo(
    () => extractLinks([...(currentCard?.frontContent ?? []), ...(currentCard?.backContent ?? []), ...(currentCard?.memoContent ?? [])]),
    [currentCard]
  );

  useEffect(() => {
    loadSession({ deckId, tagId, filter, shuffle: shuffle === '1' });
  }, [deckId, tagId, filter, shuffle]);

  useEffect(() => {
    if (completed) {
      updateBadgeCount(db).catch(() => {});
    }
  }, [completed, db]);

  useEffect(() => {
    if (completed) {
      setEditedCodeBlocks({});
      completeReadyRef.current = false;
      navigation.setOptions({ headerLeft: () => null });
      setTimeout(() => {
        completeRef.current?.focus();
        setTimeout(() => { completeReadyRef.current = true; }, 200);
      }, 100);
    } else {
      navigation.setOptions({ headerLeft: undefined });
    }
  }, [completed]);

  // 新しいカードに移ったらフリップ・メモをリセット、スライドイン開始
  useEffect(() => {
    swipe.applySlideIn(screenWidth);
    swipe.currentIndexSV.value = currentIndex;
    setIsFlipped(false);
    setShowMemo(false);
    cbs.reset();
    frontScrollRef.current?.scrollTo({ y: 0, animated: false });
    backScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [currentIndex]);

  // フリップ時にメモを隠し、コードブロック選択をリセット
  useEffect(() => {
    if (!isFlipped) setShowMemo(false);
    cbs.reset();
  }, [isFlipped]);

  function handleKeyPress(key: string) {
    if (!keyboardShortcutsEnabled) return;

    if (key === ' ') {
      cbs.setRunTrigger(0);
      cbs.setEditTrigger(0);
      setIsFlipped((v) => !v);
    } else if (key === 't' || key === 'T' || key === 'y' || key === 'Y') {
      cbs.cycleCodeBlock(key === 't' || key === 'T', currentCard, isFlipped, setShowMemo);
    } else if (key.toLowerCase() === 'r') {
      if (cbs.selectedCodeBlockIdx !== null) cbs.setRunTrigger((v) => v + 1);
    } else if (key.toLowerCase() === 'j') {
      swipe.navigateWithSlide('next');
    } else if (key.toLowerCase() === 'k') {
      swipe.navigateWithSlide('prev');
    } else if (key.toLowerCase() === 'm' && isFlipped) {
      setShowMemo((v) => !v);
    } else if (key.toLowerCase() === 'f') {
      setIsFullscreen((v) => !v);
      cbs.setEditTrigger(0);
      cbs.setRunTrigger(0);
    } else if (key.toLowerCase() === 'e') {
      if (cbs.selectedCodeBlockIdx !== null) cbs.setEditTrigger((v) => v + 1);
    } else if (key.toLowerCase() === 'u') {
      const ref = isFlipped ? backScrollRef : frontScrollRef;
      const y = isFlipped ? backScrollYRef.current : frontScrollYRef.current;
      ref.current?.scrollTo({ y: Math.max(0, y - SCROLL_STEP), animated: true });
    } else if (key.toLowerCase() === 'd') {
      const ref = isFlipped ? backScrollRef : frontScrollRef;
      const y = isFlipped ? backScrollYRef.current : frontScrollYRef.current;
      ref.current?.scrollTo({ y: y + SCROLL_STEP, animated: true });
    } else if (key.toLowerCase() === 'b') {
      router.back();
    } else if (key.toLowerCase() === 'l') {
      if (cardLinks.length > 0) setShowLinksModal((v) => !v);
    } else if (key.toLowerCase() === 'p') {
      if (currentCard) {
        const tab = isFlipped ? 'back' : 'front';
        router.push(`/deck/${currentCard.deckId}/card/${currentCard.id}/edit?tab=${tab}`);
      }
    } else if (isFlipped && !grading) {
      if (key === '1') handleGradeWithSlide(0);
      else if (key === '2') handleGradeWithSlide(1);
      else if (key === '3') handleGradeWithSlide(2);
      else if (key === '4') handleGradeWithSlide(3);
    }
  }

  async function handleGrade(grade: Grade) {
    if (grading) return;
    setGrading(true);
    await submitGrade(grade);
    setGrading(false);
    keyboardRef.current?.focus();
  }

  function handleGradeWithSlide(grade: Grade) {
    if (grading) return;
    swipe.navigateWithSlide('next', () => handleGrade(grade));
  }

  function handleCodeBlockChange(cardId: string, blockIndex: number, text: string, side: 'front' | 'back' | 'memo' = 'front') {
    const key = side === 'back' ? cardId + '_back' : side === 'memo' ? cardId + '_memo' : cardId;
    setEditedCodeBlocks((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [blockIndex]: text },
    }));
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  // セッション完了画面
  if (completed) {
    const { again, hard, good, easy } = result.gradeCount;
    const reviewed = result.reviewed;
    const totalCards = result.totalCards;
    const skipped = totalCards - reviewed;
    const skipColor = theme.dark ? '#6B7280' : '#9CA3AF';
    const gradeItems: { key: string; count: number; color: string }[] = [
      { key: t('grade.again'), count: again,   color: GRADE_COLORS.again },
      { key: t('grade.hard'),  count: hard,    color: GRADE_COLORS.hard  },
      { key: t('grade.good'),  count: good,    color: GRADE_COLORS.good  },
      { key: t('grade.easy'),  count: easy,    color: GRADE_COLORS.easy  },
      ...(skipped > 0 ? [{ key: t('study.skipped'), count: skipped, color: skipColor }] : []),
    ];
    const reviewRate = totalCards > 0 ? Math.round((reviewed / totalCards) * 100) : 0;
    const correctRate = reviewed > 0 ? Math.round(((hard + good + easy) / reviewed) * 100) : 0;
    const nextReviewStr = result.earliestNextReview
      ? (() => {
          const [, m, d] = result.earliestNextReview.slice(0, 10).split('-').map(Number);
          if (i18n.language === 'ja') return `${m}月${d}日`;
          const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          return `${MONTHS[m - 1]} ${d}`;
        })()
      : null;

    let cumDeg = 0;
    const donutSlices = totalCards > 0
      ? gradeItems
          .filter(({ count }) => count > 0)
          .map(({ color, count }) => {
            const sweepDeg = (count / totalCards) * 360;
            const path = donutArcPath(cumDeg, cumDeg + sweepDeg);
            cumDeg += sweepDeg;
            return { color, path };
          })
      : [];

    return (
      <>
        <Stack.Screen options={{ title: t('study.title'), headerBackTitle: '', headerBackVisible: false, headerLeft: () => null, headerRight: () => null }} />
        <TextInput
          ref={completeRef}
          style={styles.hiddenKeyboardInput}
          autoFocus
          caretHidden
          keyboardType="ascii-capable"
          showSoftInputOnFocus={false}
          onKeyPress={({ nativeEvent: { key } }) => {
            if (key === 'Enter') {
              completeReadyRef.current = false;
              router.back();
            }
          }}
          onBlur={() => {
            if (completeReadyRef.current) {
              completeReadyRef.current = false;
              router.back();
            }
          }}
        />
        <View style={[styles.completeScreen, { backgroundColor: theme.colors.background }]}>
          <Ionicons name="checkmark-circle" size={80} color="#43A047" />
          <Text style={[styles.completeTitle, { color: theme.colors.text, fontSize: theme.fontSize.xl }]}>{t('study.complete')}</Text>
          {reviewed > 0 && (
            <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface }]}>
              {/* 評価済み ◯/◯ 枚 */}
              <Text style={[styles.completeCount, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg, textAlign: 'center' }]}>
                {t('study.reviewedOf', { reviewed, total: totalCards })}
              </Text>
              {/* ドーナツチャート */}
              <View style={styles.donutContainer}>
                <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
                  <Circle cx={DONUT_CX} cy={DONUT_CY} r={DONUT_R} fill={theme.colors.progressBg} />
                  {donutSlices.map(({ color, path }, i) => (
                    <Path key={i} d={path} fill={color} />
                  ))}
                  <Circle cx={DONUT_CX} cy={DONUT_CY} r={DONUT_INNER_R} fill={theme.colors.surface} />
                  <SvgText x={DONUT_CX} y={DONUT_CY + 10} textAnchor="middle" fontSize={24} fontWeight="700" fill={theme.colors.text}>
                    {reviewRate}
                  </SvgText>
                </Svg>
              </View>

              {/* グレード別枚数 */}
              <View style={[styles.summaryGradeRow, { gap: Math.max(2, Math.min(16, Math.floor((screenWidth - 104 - gradeItems.length * 44) / Math.max(1, gradeItems.length - 1)))) }]}>
                {gradeItems.map(({ key, count, color }) => (
                  <View key={key} style={styles.gradeItem}>
                    <Text style={[styles.gradeItemCount, { color, fontSize: theme.fontSize.lg }]}>{count}</Text>
                    <Text style={[styles.gradeItemLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]}>{key}</Text>
                  </View>
                ))}
              </View>

              {/* 正答率・次回予定 */}
              <View style={styles.statRow}>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: theme.colors.text, fontSize: theme.fontSize.xl }]}>{correctRate}%</Text>
                  <Text style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]}>{t('study.correctRate')}</Text>
                </View>
                {nextReviewStr && (
                  <View style={styles.statItem}>
                    <Text style={[styles.statValue, { color: theme.colors.text, fontSize: theme.fontSize.xl }]}>{nextReviewStr}</Text>
                    <Text style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]}>{t('study.nextReview')}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: theme.colors.primary }]}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={[styles.backBtnText, { color: theme.colors.primaryText, fontSize: theme.fontSize.lg }]}>{t('common.ok')}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  if (!currentCard) return null;

  const progressRatio = result.totalCards > 0 ? (currentIndex + 1) / result.totalCards : 0;
  const hasMemo = currentCard.memoContent.some((b) => b.type !== 'image' && 'content' in b && b.content.trim() !== '' || b.type === 'image' && !!b.uri);

  // メモトグル（Pressable で処理するため memoTapGesture は使用しない）
  const memoToggle = (
    <Pressable style={styles.memoToggle} onPress={handleToggleMemo}>
      <Ionicons
        name={showMemo ? 'eye-off-outline' : 'eye-outline'}
        size={16}
        color={theme.colors.textTertiary}
      />
      <Text style={[styles.memoToggleText, { color: theme.colors.textTertiary }]}>
        {showMemo ? t('study.hideMemo') : t('study.showMemo')}
      </Text>
    </Pressable>
  );

  const memoBlock = hasMemo && (
    <View style={styles.memoSection} onTouchStart={suppress}>
      {memoToggle}
      {showMemo && (
        <View style={[styles.memoContent, { backgroundColor: theme.colors.memoBackground, borderLeftColor: theme.colors.inputBorder }]}>
          <BlocksView
            blocks={currentCard.memoContent}
            editableCode
            editedContents={editedCodeBlocks[currentCard.id + '_memo']}
            onCodeBlockChange={(i, text) => handleCodeBlockChange(currentCard.id, i, text, 'memo')}
            onEditFocus={() => { codeEditingRef.current = true; }}
            onEditBlur={() => { codeEditingRef.current = false; keyboardRef.current?.focus(); }}
            onSelectCodeBlock={(idx) => { cbs.setSelectedCodeBlockIdx(idx); cbs.setSelectedCodeBlockSide('memo'); cbs.setEditTrigger(0); }}
            runTrigger={showMemo && cbs.selectedCodeBlockSide === 'memo' ? cbs.runTrigger : undefined}
            editTrigger={showMemo && cbs.selectedCodeBlockSide === 'memo' ? cbs.editTrigger : undefined}
            selectedCodeBlockIdx={showMemo && cbs.selectedCodeBlockSide === 'memo' ? cbs.selectedCodeBlockIdx : null}
            scrollRef={backScrollRef}
          />
        </View>
      )}
    </View>
  );

  const gradeRow = (
    <View style={styles.gradeRow}>
      {GRADES.map(({ grade, labelKey, color }) => (
        <TouchableOpacity
          key={grade}
          style={[styles.gradeBtn, { borderColor: color, backgroundColor: theme.colors.surface }, grading && styles.gradeBtnDisabled]}
          onPress={() => handleGradeWithSlide(grade)}
          disabled={grading}
          activeOpacity={0.7}
        >
          <Text style={[styles.gradeBtnText, { color, fontSize: theme.fontSize.sm }]}>{t(labelKey)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (isFullscreen) {
    return (
      <>
        <StatusBar hidden />
        <Stack.Screen options={{ title: t('study.title'), headerBackTitle: '', headerShown: false }} />
        <TextInput
          ref={keyboardRef}
          style={styles.hiddenKeyboardInput}
          autoFocus
          caretHidden
          keyboardType="ascii-capable"
          showSoftInputOnFocus={false}
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          onKeyPress={({ nativeEvent: { key } }) => handleKeyPress(key)}
          onBlur={() => { setTimeout(() => { if (!codeEditingRef.current && isScreenFocusedRef.current) keyboardRef.current?.focus(); }, 50); }}
        />
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
          {/* ヘッダー行（実体あり、スクロール外） */}
          <View style={styles.fullscreenHeader}>
            <Pressable
              style={styles.fullscreenExitBtn}
              onPress={() => {
                codeEditingRef.current = false;
                setIsFullscreen(false);
                cbs.setEditTrigger(0);
                cbs.setRunTrigger(0);
                setTimeout(() => { keyboardRef.current?.focus(); }, 100);
              }}
            >
              <Ionicons name="contract-outline" size={24} color={theme.colors.iconSubtle} />
            </Pressable>
            <View style={{ flex: 1 }} />
            {cardLinks.length > 0 && (
              <Pressable
                style={styles.fullscreenEditBtn}
                onPress={() => setShowLinksModal(true)}
                accessibilityLabel={t('study.links')}
              >
                <Ionicons name="link-outline" size={24} color={theme.colors.iconSubtle} />
              </Pressable>
            )}
            <Pressable
              style={styles.fullscreenEditBtn}
              onPress={() => router.push(`/deck/${currentCard.deckId}/card/${currentCard.id}/edit?tab=${isFlipped ? 'back' : 'front'}`)}
            >
              <Ionicons name="create-outline" size={24} color={theme.colors.iconSubtle} />
            </Pressable>
          </View>

          {/* コンテンツエリア */}
          <GestureDetector gesture={swipe.panGesture}>
            <Animated.View style={[{ flex: 1 }, swipe.cardAnimStyle]}>
              <FlipSuppressContext.Provider value={{ suppress, suppressedRef }}>
                <FlipCard
                  ref={flipCardRef}
                  isFlipped={isFlipped}
                  onFlip={handleFlip}
                  cardStyle={{ borderRadius: 0, shadowOpacity: 0, elevation: 0 }}
                  innerStyle={{ padding: 0, justifyContent: 'flex-start' }}
                  front={
                    <ScrollView ref={frontScrollRef} style={{ flex: 1 }} contentContainerStyle={styles.fullscreenContent} showsVerticalScrollIndicator={false} onScroll={(e) => { frontScrollYRef.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
                      <BlocksView
                        key={currentCard.id}
                        blocks={currentCard.frontContent}
                        editableCode
                        editedContents={editedCodeBlocks[currentCard.id]}
                        onCodeBlockChange={(i, text) => handleCodeBlockChange(currentCard.id, i, text)}
                        onEditFocus={() => { codeEditingRef.current = true; }}
                        onEditBlur={() => { codeEditingRef.current = false; keyboardRef.current?.focus(); }}
                        onSelectCodeBlock={(idx) => { cbs.setSelectedCodeBlockIdx(idx); cbs.setSelectedCodeBlockSide(isFlipped ? 'back' : 'front'); cbs.setEditTrigger(0); }}
                        runTrigger={!isFlipped ? cbs.runTrigger : undefined}
                        editTrigger={!isFlipped ? cbs.editTrigger : undefined}
                        selectedCodeBlockIdx={!isFlipped ? cbs.selectedCodeBlockIdx : null}
                        scrollRef={frontScrollRef}
                      />
                    </ScrollView>
                  }
                  back={
                    <ScrollView ref={backScrollRef} style={{ flex: 1 }} contentContainerStyle={styles.fullscreenContent} showsVerticalScrollIndicator={false} onScroll={(e) => { backScrollYRef.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
                      <BlocksView
                        key={currentCard.id}
                        blocks={currentCard.backContent}
                        editableCode
                        editedContents={editedCodeBlocks[currentCard.id + '_back']}
                        onCodeBlockChange={(i, text) => handleCodeBlockChange(currentCard.id, i, text, 'back')}
                        onEditFocus={() => { codeEditingRef.current = true; }}
                        onEditBlur={() => { codeEditingRef.current = false; keyboardRef.current?.focus(); }}
                        onSelectCodeBlock={(idx) => { cbs.setSelectedCodeBlockIdx(idx); cbs.setSelectedCodeBlockSide(isFlipped ? 'back' : 'front'); cbs.setEditTrigger(0); }}
                        runTrigger={isFlipped && cbs.selectedCodeBlockSide === 'back' ? cbs.runTrigger : undefined}
                        editTrigger={isFlipped && cbs.selectedCodeBlockSide === 'back' ? cbs.editTrigger : undefined}
                        selectedCodeBlockIdx={isFlipped && cbs.selectedCodeBlockSide === 'back' ? cbs.selectedCodeBlockIdx : null}
                        scrollRef={backScrollRef}
                      />
                      {memoBlock}
                    </ScrollView>
                  }
                />
              </FlipSuppressContext.Provider>
            </Animated.View>
          </GestureDetector>

          {isFlipped && <View style={styles.bottom}>{gradeRow}</View>}
        </View>

        <LinksSheet visible={showLinksModal} onClose={() => setShowLinksModal(false)} links={cardLinks} />
      </>
    );
  }

  return (
    <>
      <StatusBar hidden />
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable
              onPress={() => setShowShortcutsModal(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: screenWidth * 0.5 }}
            >
              <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text, flexShrink: 1 }} numberOfLines={1}>
                {sessionTitle}
              </Text>
              {keyboardShortcutsEnabled && (
                <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
              )}
            </Pressable>
          ),
          headerBackTitle: '',
          headerShown: true,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {cardLinks.length > 0 && (
                <Pressable
                  onPress={() => setShowLinksModal(true)}
                  style={{ paddingHorizontal: 8 }}
                  accessibilityLabel={t('study.links')}
                >
                  <Ionicons name="link-outline" size={22} color={theme.colors.primary} />
                </Pressable>
              )}
              <Pressable
                onPress={() => router.push(`/deck/${currentCard.deckId}/card/${currentCard.id}/edit?tab=${isFlipped ? 'back' : 'front'}`)}
                style={{ paddingHorizontal: 8 }}
              >
                <Ionicons name="create-outline" size={22} color={theme.colors.primary} />
              </Pressable>
            </View>
          ),
        }}
      />
      <TextInput
        ref={keyboardRef}
        style={styles.hiddenKeyboardInput}
        autoFocus
        caretHidden
        keyboardType="ascii-capable"
        showSoftInputOnFocus={false}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        onKeyPress={({ nativeEvent: { key } }) => handleKeyPress(key)}
        onBlur={() => { setTimeout(() => { if (!codeEditingRef.current && isScreenFocusedRef.current) keyboardRef.current?.focus(); }, 50); }}
      />
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        {/* プログレスバー */}
        <View style={[styles.progressBar, { backgroundColor: theme.colors.progressBg }]}>
          <View style={[styles.progressFill, { flex: progressRatio, backgroundColor: theme.colors.primary }]} />
          <View style={{ flex: 1 - progressRatio }} />
        </View>
        <View style={styles.progressRow}>
          <View style={[styles.reviewedBadge, { backgroundColor: theme.colors.primary }]}>
            <Text style={[styles.reviewedBadgeText, { fontSize: theme.fontSize.xs }]}>{result.reviewed}</Text>
          </View>
          <Text style={[styles.progressText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }]}>
            {t('study.progress', { current: currentIndex + 1, total: result.totalCards })}
          </Text>
        </View>

        {/* カード */}
        <GestureDetector gesture={swipe.panGesture}>
          <Animated.View style={[styles.cardArea, swipe.cardAnimStyle]}>
            <FlipSuppressContext.Provider value={{ suppress, suppressedRef }}>
              <FlipCard
                ref={flipCardRef}
                isFlipped={isFlipped}
                onFlip={handleFlip}
                front={
                  <ScrollView ref={frontScrollRef} style={{ flex: 1 }} contentContainerStyle={styles.faceContent} showsVerticalScrollIndicator={false} onScroll={(e) => { frontScrollYRef.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
                    <BlocksView
                      key={currentCard.id}
                      blocks={currentCard.frontContent}
                      editableCode
                      editedContents={editedCodeBlocks[currentCard.id]}
                      onCodeBlockChange={(i, text) => handleCodeBlockChange(currentCard.id, i, text)}
                      onEditFocus={() => { codeEditingRef.current = true; }}
                      onEditBlur={() => { codeEditingRef.current = false; keyboardRef.current?.focus(); }}
                      onSelectCodeBlock={(idx) => { cbs.setSelectedCodeBlockIdx(idx); cbs.setEditTrigger(0); }}
                      runTrigger={!isFlipped ? cbs.runTrigger : undefined}
                      editTrigger={!isFlipped ? cbs.editTrigger : undefined}
                      selectedCodeBlockIdx={!isFlipped ? cbs.selectedCodeBlockIdx : null}
                      scrollRef={frontScrollRef}
                    />
                  </ScrollView>
                }
                back={
                  <ScrollView ref={backScrollRef} style={{ flex: 1 }} contentContainerStyle={styles.faceContent} showsVerticalScrollIndicator={false} onScroll={(e) => { backScrollYRef.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
                    <BlocksView
                      key={currentCard.id}
                      blocks={currentCard.backContent}
                      editableCode
                      editedContents={editedCodeBlocks[currentCard.id + '_back']}
                      onCodeBlockChange={(i, text) => handleCodeBlockChange(currentCard.id, i, text, 'back')}
                      onEditFocus={() => { codeEditingRef.current = true; }}
                      onEditBlur={() => { codeEditingRef.current = false; keyboardRef.current?.focus(); }}
                      onSelectCodeBlock={(idx) => { cbs.setSelectedCodeBlockIdx(idx); cbs.setSelectedCodeBlockSide('back'); cbs.setEditTrigger(0); }}
                      runTrigger={isFlipped && cbs.selectedCodeBlockSide === 'back' ? cbs.runTrigger : undefined}
                      editTrigger={isFlipped && cbs.selectedCodeBlockSide === 'back' ? cbs.editTrigger : undefined}
                      selectedCodeBlockIdx={isFlipped && cbs.selectedCodeBlockSide === 'back' ? cbs.selectedCodeBlockIdx : null}
                      scrollRef={backScrollRef}
                    />
                    {memoBlock}
                  </ScrollView>
                }
              />
            </FlipSuppressContext.Provider>
          </Animated.View>
        </GestureDetector>

        {/* 全画面ボタン（カードエリア右上） */}
        <Pressable
          style={styles.fullscreenBtn}
          onPress={() => {
            codeEditingRef.current = false;
            setIsFullscreen(true);
            cbs.setEditTrigger(0);
            cbs.setRunTrigger(0);
            setTimeout(() => { keyboardRef.current?.focus(); }, 100);
          }}
        >
          <Ionicons name="expand-outline" size={22} color={theme.colors.iconSubtle} />
        </Pressable>

        {/* ヒント or 自己評価ボタン */}
        <View style={styles.bottom}>
          {!isFlipped ? (
            <Pressable
              style={[styles.flipHint, { backgroundColor: theme.colors.surface }]}
              onPress={() => setIsFlipped(true)}
            >
              <Ionicons name="sync-outline" size={18} color={theme.colors.textTertiary} />
              <Text style={[styles.flipHintText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>{t('study.tapToFlip')}</Text>
            </Pressable>
          ) : gradeRow}
        </View>
      </View>

      <LinksSheet visible={showLinksModal} onClose={() => setShowLinksModal(false)} links={cardLinks} />

      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        shortcuts={STUDY_SHORTCUTS}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hiddenKeyboardInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  progressBar: {
    height: 4,
    flexDirection: 'row',
  },
  progressFill: {},
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  reviewedBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewedBadgeText: {
    fontWeight: '700',
    color: '#FFF',
  },
  progressText: {
    textAlign: 'right',
  },
  cardArea: { flex: 1, paddingHorizontal: 20, paddingVertical: 12 },
  faceContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 8 },
  faceLabel: { fontWeight: '700', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  memoSection: { marginTop: 20, gap: 8 },
  memoToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  memoToggleText: {},
  memoContent: {
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
  },
  bottom: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 8,
  },
  flipHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    borderRadius: 12,
  },
  flipHintText: {},
  gradeRow: { flexDirection: 'row', gap: 8 },
  gradeBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  gradeBtnDisabled: { opacity: 0.4 },
  gradeBtnText: { fontWeight: '700' },
  completeScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
  completeTitle: { fontWeight: '700' },
  completeCount: {},
  summaryCard: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  donutContainer: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 4,
  },
  summaryGradeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: 16,
    paddingBottom: 16,
  },
  gradeItem: {
    alignItems: 'center',
    gap: 2,
    minWidth: 44,
  },
  gradeItemCount: { fontWeight: '700' },
  gradeItemLabel: {},
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 56,
    paddingTop: 14,
  },
  statItem: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: { fontWeight: '700' },
  statLabel: {},
  backBtn: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  backBtnText: { fontWeight: '700' },
  fullscreenBtn: {
    position: 'absolute',
    top: 8,
    left: 4,
    padding: 6,
    borderRadius: 8,
    zIndex: 10,
  },
  fullscreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  fullscreenContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  fullscreenExitBtn: {
    padding: 8,
    borderRadius: 10,
  },
  fullscreenEditBtn: {
    padding: 8,
    borderRadius: 10,
  },
});

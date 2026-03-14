import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { BlocksView } from '@/components/study/BlocksView';
import { FlipCard } from '@/components/study/FlipCard';
import { useStudySession } from '@/hooks/useStudySession';
import { useTheme } from '@/lib/theme';
import type { Grade } from '@/lib/sm2';
import { useSettingsStore } from '@/store/settings';

const GRADES: { grade: Grade; labelKey: string; color: string }[] = [
  { grade: 0, labelKey: 'grade.again', color: '#E53935' },
  { grade: 1, labelKey: 'grade.hard',  color: '#FB8C00' },
  { grade: 2, labelKey: 'grade.good',  color: '#43A047' },
  { grade: 3, labelKey: 'grade.easy',  color: '#1976D2' },
];

export default function StudySessionScreen() {
  const { deckId, tagId } = useLocalSearchParams<{ deckId?: string; tagId?: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { loading, completed, currentCard, currentIndex, result, loadSession, submitGrade, goBack, goNext } =
    useStudySession();
  const { keyboardShortcutsEnabled } = useSettingsStore();

  const [isFlipped, setIsFlipped] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [grading, setGrading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const translateX = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      translateX.value = e.translationX * 0.3;
    })
    .onEnd((e) => {
      const swipeLeft  = e.translationX < -80 || e.velocityX < -500;
      const swipeRight = e.translationX > 80  || e.velocityX > 500;
      if (swipeLeft)       runOnJS(goNext)();
      else if (swipeRight) runOnJS(goBack)();
      translateX.value = withSpring(0);
    });

  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const keyboardRef = useRef<TextInput>(null);
  const completeRef = useRef<TextInput>(null);
  const completeReadyRef = useRef(false);

  useEffect(() => {
    loadSession({ deckId, tagId });
  }, [deckId, tagId]);

  useEffect(() => {
    if (completed) {
      completeReadyRef.current = false;
      setTimeout(() => {
        completeRef.current?.focus();
        setTimeout(() => { completeReadyRef.current = true; }, 200);
      }, 100);
    }
  }, [completed]);

  // 新しいカードに移ったらフリップ・メモをリセット
  useEffect(() => {
    translateX.value = 0;
    setIsFlipped(false);
    setShowMemo(false);
  }, [currentIndex]);

  // 表面に戻ったらメモを隠す
  useEffect(() => {
    if (!isFlipped) setShowMemo(false);
  }, [isFlipped]);

  function handleKeyPress(key: string) {
    if (!keyboardShortcutsEnabled) return;
    if (key === ' ') {
      setIsFlipped((v) => !v);
    } else if (key.toLowerCase() === 'j') {
      goBack();
    } else if (key.toLowerCase() === 'k') {
      goNext();
    } else if (key.toLowerCase() === 'm' && isFlipped) {
      setShowMemo((v) => !v);
    } else if (key.toLowerCase() === 'f') {
      setIsFullscreen((v) => !v);
    } else if (isFlipped && !grading) {
      if (key === '1') handleGrade(0);
      else if (key === '2') handleGrade(1);
      else if (key === '3') handleGrade(2);
      else if (key === '4') handleGrade(3);
    }
  }

  async function handleGrade(grade: Grade) {
    if (grading) return;
    setGrading(true);
    await submitGrade(grade);
    setGrading(false);
    keyboardRef.current?.focus();
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
    return (
      <>
        <Stack.Screen options={{ title: t('study.title'), headerBackTitle: '' }} />
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
          <Text style={[styles.completeTitle, { color: theme.colors.text }]}>{t('study.complete')}</Text>
          <Text style={[styles.completeCount, { color: theme.colors.textSecondary }]}>
            {t('study.reviewedCount', { count: result.reviewed })}
          </Text>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: theme.colors.primary }]}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={[styles.backBtnText, { color: theme.colors.primaryText }]}>{t('common.ok')}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  if (!currentCard) return null;

  const progressRatio = result.totalCards > 0 ? result.reviewed / result.totalCards : 0;

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
          onBlur={() => keyboardRef.current?.focus()}
        />
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
          {/* 終了ボタン（左上） */}
          <Pressable
            style={styles.fullscreenExitBtn}
            onPress={() => setIsFullscreen(false)}
          >
            <Ionicons name="contract-outline" size={24} color={theme.colors.iconSubtle} />
          </Pressable>

          {/* コンテンツエリア：タップで裏返す */}
          <GestureDetector gesture={panGesture}>
            <Animated.View style={[{ flex: 1 }, cardAnimStyle]}>
              <Pressable style={{ flex: 1 }} onPress={() => setIsFlipped((v) => !v)}>
                <ScrollView
                  contentContainerStyle={styles.fullscreenContent}
                  showsVerticalScrollIndicator={false}
                >
                  {!isFlipped ? (
                    <BlocksView blocks={currentCard.frontContent} />
                  ) : (
                    <>
                      <Text style={[styles.faceLabel, { color: theme.colors.iconSubtle }]}>{t('card.back')}</Text>
                      <BlocksView blocks={currentCard.backContent} />
                      {currentCard.memoContent.length > 0 && (
                        <View style={styles.memoSection}>
                          <Pressable
                            style={styles.memoToggle}
                            onPress={() => setShowMemo((v) => !v)}
                          >
                            <Ionicons
                              name={showMemo ? 'eye-off-outline' : 'eye-outline'}
                              size={16}
                              color={theme.colors.textTertiary}
                            />
                            <Text style={[styles.memoToggleText, { color: theme.colors.textTertiary }]}>
                              {showMemo ? t('study.hideMemo') : t('study.showMemo')}
                            </Text>
                          </Pressable>
                          {showMemo && (
                            <View style={[styles.memoContent, { backgroundColor: theme.colors.border, borderLeftColor: theme.colors.inputBorder }]}>
                              <BlocksView blocks={currentCard.memoContent} />
                            </View>
                          )}
                        </View>
                      )}
                    </>
                  )}
                </ScrollView>
              </Pressable>
            </Animated.View>
          </GestureDetector>

          {isFlipped && (
            <View style={styles.bottom}>
              <View style={styles.gradeRow}>
                {GRADES.map(({ grade, labelKey, color }) => (
                  <TouchableOpacity
                    key={grade}
                    style={[styles.gradeBtn, { borderColor: color, backgroundColor: theme.colors.surface }, grading && styles.gradeBtnDisabled]}
                    onPress={() => handleGrade(grade)}
                    disabled={grading}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.gradeBtnText, { color }]}>{t(labelKey)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      </>
    );
  }

  return (
    <>
      <StatusBar hidden />
      <Stack.Screen options={{ title: t('study.title'), headerBackTitle: '', headerShown: true }} />
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
        onBlur={() => keyboardRef.current?.focus()}
      />
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        {/* プログレスバー */}
        <View style={[styles.progressBar, { backgroundColor: theme.colors.progressBg }]}>
          <View style={[styles.progressFill, { flex: progressRatio, backgroundColor: theme.colors.primary }]} />
          <View style={{ flex: 1 - progressRatio }} />
        </View>
        <Text style={[styles.progressText, { color: theme.colors.textTertiary }]}>
          {t('study.progress', { current: result.reviewed, total: result.totalCards })}
        </Text>

        {/* カード */}
        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.cardArea, cardAnimStyle]}>
            <FlipCard
              isFlipped={isFlipped}
              onFlip={() => setIsFlipped((v) => !v)}
              front={
                <ScrollView contentContainerStyle={styles.faceContent} showsVerticalScrollIndicator={false}>
                  <BlocksView blocks={currentCard.frontContent} />
                </ScrollView>
              }
              back={
                <ScrollView contentContainerStyle={styles.faceContent} showsVerticalScrollIndicator={false}>
                  <Text style={[styles.faceLabel, { color: theme.colors.iconSubtle }]}>{t('card.back')}</Text>
                  <BlocksView blocks={currentCard.backContent} />
                  {/* メモ */}
                  {currentCard.memoContent.length > 0 && (
                    <View style={styles.memoSection}>
                      <Pressable
                        style={styles.memoToggle}
                        onPress={() => setShowMemo((v) => !v)}
                      >
                        <Ionicons
                          name={showMemo ? 'eye-off-outline' : 'eye-outline'}
                          size={16}
                          color={theme.colors.textTertiary}
                        />
                        <Text style={[styles.memoToggleText, { color: theme.colors.textTertiary }]}>
                          {showMemo ? t('study.hideMemo') : t('study.showMemo')}
                        </Text>
                      </Pressable>
                      {showMemo && (
                        <View style={[styles.memoContent, { backgroundColor: theme.colors.border, borderLeftColor: theme.colors.inputBorder }]}>
                          <BlocksView blocks={currentCard.memoContent} />
                        </View>
                      )}
                    </View>
                  )}
                </ScrollView>
              }
            />
          </Animated.View>
        </GestureDetector>

        {/* 全画面ボタン（カードエリア右上） */}
        <Pressable
          style={styles.fullscreenBtn}
          onPress={() => setIsFullscreen(true)}
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
              <Text style={[styles.flipHintText, { color: theme.colors.textTertiary }]}>{t('study.tapToFlip')}</Text>
            </Pressable>
          ) : (
            <View style={styles.gradeRow}>
              {GRADES.map(({ grade, labelKey, color }) => (
                <TouchableOpacity
                  key={grade}
                  style={[styles.gradeBtn, { borderColor: color, backgroundColor: theme.colors.surface }, grading && styles.gradeBtnDisabled]}
                  onPress={() => handleGrade(grade)}
                  disabled={grading}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.gradeBtnText, { color }]}>{t(labelKey)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
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
  progressText: {
    fontSize: 12,
    textAlign: 'right',
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  cardArea: { flex: 1, paddingHorizontal: 20, paddingVertical: 12 },
  faceContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 8 },
  faceLabel: { fontSize: 11, fontWeight: '700', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  memoSection: { marginTop: 20, gap: 8 },
  memoToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memoToggleText: { fontSize: 13 },
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
  flipHintText: { fontSize: 15 },
  gradeRow: { flexDirection: 'row', gap: 8 },
  gradeBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  gradeBtnDisabled: { opacity: 0.4 },
  gradeBtnText: { fontSize: 13, fontWeight: '700' },
  completeScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
  completeTitle: { fontSize: 24, fontWeight: '700' },
  completeCount: { fontSize: 16 },
  backBtn: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  backBtnText: { fontSize: 16, fontWeight: '700' },
  fullscreenBtn: {
    position: 'absolute',
    top: 8,
    left: 4,
    padding: 6,
    borderRadius: 8,
    zIndex: 10,
  },
  fullscreenContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  fullscreenExitBtn: {
    position: 'absolute',
    top: 48,
    left: 20,
    padding: 8,
    borderRadius: 10,
    zIndex: 10,
  },
});

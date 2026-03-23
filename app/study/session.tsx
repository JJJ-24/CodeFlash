import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { BlocksView } from '@/components/study/BlocksView';
import { FlipCard, type FlipCardRef } from '@/components/study/FlipCard';
import { useStudySession } from '@/hooks/useStudySession';
import { useTheme } from '@/lib/theme';
import type { Grade } from '@/lib/sm2';
import type { Block, TextBlock } from '@/types';
import { useSettingsStore } from '@/store/settings';

type LinkItem = { text: string; url: string };

function extractLinks(blocks: Block[]): LinkItem[] {
  const links: LinkItem[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.type !== 'text') continue;
    const content = (block as TextBlock).content;
    const mdRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdRe.exec(content)) !== null) {
      if (!seen.has(m[2])) { seen.add(m[2]); links.push({ text: m[1], url: m[2] }); }
    }
    const urlRe = /(?<!\()https?:\/\/[^\s)]+/g;
    while ((m = urlRe.exec(content)) !== null) {
      if (!seen.has(m[0])) { seen.add(m[0]); links.push({ text: m[0], url: m[0] }); }
    }
  }
  return links;
}

const GRADES: { grade: Grade; labelKey: string; color: string }[] = [
  { grade: 0, labelKey: 'grade.again', color: '#E53935' },
  { grade: 1, labelKey: 'grade.hard',  color: '#FB8C00' },
  { grade: 2, labelKey: 'grade.good',  color: '#43A047' },
  { grade: 3, labelKey: 'grade.easy',  color: '#1976D2' },
];

export default function StudySessionScreen() {
  const { deckId, tagId, filter } = useLocalSearchParams<{ deckId?: string; tagId?: string; filter?: 'all' | 'today' | 'due' | 'unlearned' }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const theme = useTheme();
  const { loading, completed, currentCard, currentIndex, result, loadSession, submitGrade, goBack, goNext, refreshCurrentCard } =
    useStudySession();

  // モーダル遷移中は onBlur による自動再フォーカスを抑制するためのフラグ
  const isScreenFocusedRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      isScreenFocusedRef.current = true;
      refreshCurrentCard();
      // モーダルから戻った際にキーボードショートカットを復元
      setTimeout(() => {
        if (!codeEditingRef.current) keyboardRef.current?.focus();
      }, 100);
      return () => { isScreenFocusedRef.current = false; };
    }, [refreshCurrentCard])
  );
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const { width: screenWidth } = useWindowDimensions();

  const [isFlipped, setIsFlipped] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [grading, setGrading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLinksModal, setShowLinksModal] = useState(false);
  const [selectedCodeBlockIdx, setSelectedCodeBlockIdx] = useState<number | null>(null);
  const [runTrigger, setRunTrigger] = useState(0);
  const [editTrigger, setEditTrigger] = useState(0);
  // cardId -> blockIndex -> 編集済みコード
  const [editedCodeBlocks, setEditedCodeBlocks] = useState<Record<string, Record<number, string>>>({});
  const codeEditingRef = useRef(false);
  const flipCardRef = useRef<FlipCardRef>(null);
  const isNavigatingRef = useRef(false);
  const frontScrollRef = useRef<ScrollView>(null);
  const backScrollRef = useRef<ScrollView>(null);

  const handleFlip = useCallback(() => setIsFlipped((v) => !v), []);
  const handleToggleMemo = useCallback(() => setShowMemo((v) => !v), []);

  const memoTapGesture = useMemo(
    () => Gesture.Tap().maxDistance(10).onEnd(() => runOnJS(handleToggleMemo)()),
    [handleToggleMemo]
  );

  const cardLinks = useMemo(
    () => extractLinks([...(currentCard?.frontContent ?? []), ...(currentCard?.backContent ?? [])]),
    [currentCard]
  );

  const translateX = useSharedValue(0);
  const slideX = useSharedValue(0);
  const currentIndexSV = useSharedValue(currentIndex);
  // 1=右からスライドイン, -1=左からスライドイン, 0=アニメーションなし
  const slideInDirRef = useRef(0);

  // JS-thread callbacks for swipe gestures (called via runOnJS — must be named functions)
  function onSwipedLeft() {
    flipCardRef.current?.resetInstant();
    setIsFlipped(false);
    slideInDirRef.current = 1;
    goNext();
  }

  function onSwipedRight() {
    flipCardRef.current?.resetInstant();
    setIsFlipped(false);
    slideInDirRef.current = -1;
    goBack();
  }

  function cancelSwipe() {
    translateX.value = withSpring(0);
  }

  const panGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      translateX.value = e.translationX * 0.3;
    })
    .onEnd((e) => {
      const swipeLeft  = e.translationX < -80 || e.velocityX < -500;
      const swipeRight = e.translationX > 80  || e.velocityX > 500;
      if (swipeLeft) {
        translateX.value = withTiming(-screenWidth, { duration: 150 }, (finished) => {
          if (finished) runOnJS(onSwipedLeft)();
          else runOnJS(cancelSwipe)();
        });
      } else if (swipeRight) {
        if (currentIndexSV.value === 0) {
          translateX.value = withSpring(0);
        } else {
          translateX.value = withTiming(screenWidth, { duration: 150 }, (finished) => {
            if (finished) runOnJS(onSwipedRight)();
            else runOnJS(cancelSwipe)();
          });
        }
      } else {
        translateX.value = withSpring(0);
      }
    });

  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value + slideX.value }],
  }));
  const keyboardRef = useRef<TextInput>(null);
  const completeRef = useRef<TextInput>(null);
  const completeReadyRef = useRef(false);

  useEffect(() => {
    loadSession({ deckId, tagId, filter });
  }, [deckId, tagId, filter]);

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

  // 新しいカードに移ったらフリップ・メモをリセット、SharedValue を同期
  // useEffect 内でスライドインを開始することで、React が新カードをコミット済みの状態でアニメーションが始まる
  useEffect(() => {
    const dir = slideInDirRef.current;
    slideInDirRef.current = 0;
    const sw = screenWidth;
    if (dir !== 0) {
      // 新カードコンテンツがコミット済み。translateX リセットとスライドインをアトミックに実行
      runOnUI(() => {
        'worklet';
        translateX.value = 0;
        slideX.value = dir > 0 ? sw : -sw;
        slideX.value = withTiming(0, { duration: 180 });
      })();
      setTimeout(() => { isNavigatingRef.current = false; }, 200);
    } else {
      // セッション初期ロード時など: 位置をリセット
      runOnUI(() => {
        'worklet';
        translateX.value = 0;
        slideX.value = 0;
      })();
    }
    setIsFlipped(false);
    setShowMemo(false);
    setSelectedCodeBlockIdx(null);
    setRunTrigger(0);
    setEditTrigger(0);
    currentIndexSV.value = currentIndex;
    frontScrollRef.current?.scrollTo({ y: 0, animated: false });
    backScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [currentIndex]);

  // 表面に戻ったらメモを隠す
  useEffect(() => {
    if (!isFlipped) setShowMemo(false);
  }, [isFlipped]);


  function navigateWithSlide(direction: 'next' | 'prev', action?: () => void) {
    if (isNavigatingRef.current) return;
    if (direction === 'prev' && currentIndex === 0) return;
    isNavigatingRef.current = true;

    const slideOut = direction === 'next' ? -screenWidth : screenWidth;

    // スライドアウト後、slideInDirRef をセットして goNext/goBack を呼ぶ
    // スライドインは useEffect([currentIndex]) 内で新カードコミット後に開始する
    slideX.value = withTiming(slideOut, { duration: 180 });
    setTimeout(() => {
      flipCardRef.current?.resetInstant();
      setIsFlipped(false);
      setRunTrigger(0);
      setEditTrigger(0);
      setSelectedCodeBlockIdx(null);
      slideInDirRef.current = direction === 'next' ? 1 : -1;
      if (action) action();
      else if (direction === 'next') goNext();
      else goBack();
    }, 180);
  }

  function handleKeyPress(key: string) {
    if (!keyboardShortcutsEnabled) return;
    const codeCount = currentCard?.frontContent.filter(b => b.type === 'code').length ?? 0;

    if (key === ' ') {
      setIsFlipped((v) => !v);
    } else if (key === 't' || key === 'T') {
      if (codeCount > 0) {
        setEditTrigger(0);
        setRunTrigger(0);
        setSelectedCodeBlockIdx(prev =>
          prev === null ? 0 : (prev + 1) % codeCount
        );
      }
    } else if (key.toLowerCase() === 'r') {
      if (selectedCodeBlockIdx !== null) {
        setRunTrigger((v) => v + 1);
      }
    } else if (key.toLowerCase() === 'j') {
      navigateWithSlide('next');
    } else if (key.toLowerCase() === 'k') {
      navigateWithSlide('prev');
    } else if (key.toLowerCase() === 'm' && isFlipped) {
      setShowMemo((v) => !v);
    } else if (key.toLowerCase() === 'f') {
      setIsFullscreen((v) => !v);
      setEditTrigger(0);
      setRunTrigger(0);
    } else if (key.toLowerCase() === 'e') {
      if (selectedCodeBlockIdx !== null) {
        setEditTrigger((v) => v + 1);
      }
    } else if (key.toLowerCase() === 'b') {
      router.back();
    } else if (key.toLowerCase() === 'l') {
      if (cardLinks.length > 0) {
        setShowLinksModal(true);
      }
    } else if (key.toLowerCase() === 'p') {
      if (currentCard) {
        router.push(`/deck/${currentCard.deckId}/card/${currentCard.id}/edit`);
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
    navigateWithSlide('next', () => handleGrade(grade));
  }

  function handleCodeBlockChange(cardId: string, blockIndex: number, text: string) {
    setEditedCodeBlocks((prev) => ({
      ...prev,
      [cardId]: { ...(prev[cardId] ?? {}), [blockIndex]: text },
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
    return (
      <>
        <Stack.Screen options={{ title: t('study.title'), headerBackTitle: '', headerBackVisible: false, headerLeft: () => null }} />
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

  const progressRatio = result.totalCards > 0 ? (currentIndex + 1) / result.totalCards : 0;
  const hasMemo = currentCard.memoContent.some((b) => b.type !== 'image' && 'content' in b && b.content.trim() !== '' || b.type === 'image' && !!b.uri);

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
                setEditTrigger(0);
                setRunTrigger(0);
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
              onPress={() => router.push(`/deck/${currentCard.deckId}/card/${currentCard.id}/edit`)}
            >
              <Ionicons name="create-outline" size={24} color={theme.colors.iconSubtle} />
            </Pressable>
          </View>

          {/* コンテンツエリア：タップで裏返す */}
          <GestureDetector gesture={panGesture}>
            <Animated.View style={[{ flex: 1 }, cardAnimStyle]}>
              <FlipCard
                ref={flipCardRef}
                isFlipped={isFlipped}
                onFlip={handleFlip}
                cardStyle={{ borderRadius: 0, shadowOpacity: 0, elevation: 0 }}
                innerStyle={{ padding: 0, justifyContent: 'flex-start' }}
                front={
                  <ScrollView ref={frontScrollRef} style={{ flex: 1 }} contentContainerStyle={styles.fullscreenContent} showsVerticalScrollIndicator={false}>
                    <BlocksView
                      key={currentCard.id}
                      blocks={currentCard.frontContent}
                      editableCode
                      editedContents={editedCodeBlocks[currentCard.id]}
                      onCodeBlockChange={(i, text) => handleCodeBlockChange(currentCard.id, i, text)}
                      onEditFocus={() => { codeEditingRef.current = true; }}
                      onEditBlur={() => { codeEditingRef.current = false; keyboardRef.current?.focus(); }}
                      onSelectCodeBlock={(idx) => { setSelectedCodeBlockIdx(idx); setEditTrigger(0); }}
                      runTrigger={runTrigger}
                      editTrigger={editTrigger}
                      selectedCodeBlockIdx={selectedCodeBlockIdx}
                      scrollRef={frontScrollRef}
                    />
                  </ScrollView>
                }
                back={
                  <ScrollView ref={backScrollRef} style={{ flex: 1 }} contentContainerStyle={styles.fullscreenContent} showsVerticalScrollIndicator={false}>
                    <BlocksView
                      key={currentCard.id}
                      blocks={currentCard.backContent}
                      scrollRef={backScrollRef}
                    />
                    {hasMemo && (
                      <View style={styles.memoSection}>
                        <GestureDetector gesture={memoTapGesture}>
                          <View style={styles.memoToggle}>
                            <Ionicons
                              name={showMemo ? 'eye-off-outline' : 'eye-outline'}
                              size={16}
                              color={theme.colors.textTertiary}
                            />
                            <Text style={[styles.memoToggleText, { color: theme.colors.textTertiary }]}>
                              {showMemo ? t('study.hideMemo') : t('study.showMemo')}
                            </Text>
                          </View>
                        </GestureDetector>
                        {showMemo && (
                          <View style={[styles.memoContent, { backgroundColor: theme.colors.memoBackground, borderLeftColor: theme.colors.inputBorder }]}>
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

          {isFlipped && (
            <View style={styles.bottom}>
              <View style={styles.gradeRow}>
                {GRADES.map(({ grade, labelKey, color }) => (
                  <TouchableOpacity
                    key={grade}
                    style={[styles.gradeBtn, { borderColor: color, backgroundColor: theme.colors.surface }, grading && styles.gradeBtnDisabled]}
                    onPress={() => handleGradeWithSlide(grade)}
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

        {/* リンク一覧モーダル（全画面モード） */}
        <Modal
          visible={showLinksModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowLinksModal(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setShowLinksModal(false)}>
            <Pressable style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{t('study.linksTitle')}</Text>
                <Pressable onPress={() => setShowLinksModal(false)} style={styles.modalCloseBtn}>
                  <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
                </Pressable>
              </View>
              <FlatList
                data={cardLinks}
                keyExtractor={(item) => item.url}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.linkRow, { borderBottomColor: theme.colors.inputBorder }]}
                    onPress={() => { setShowLinksModal(false); Linking.openURL(item.url); }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.linkText, { color: theme.colors.text }]} numberOfLines={1}>{item.text}</Text>
                      {item.text !== item.url && (
                        <Text style={[styles.linkUrl, { color: theme.colors.textTertiary }]} numberOfLines={1}>{item.url}</Text>
                      )}
                    </View>
                    <Ionicons name="open-outline" size={18} color={theme.colors.primary} />
                  </Pressable>
                )}
              />
            </Pressable>
          </Pressable>
        </Modal>
      </>
    );
  }

  return (
    <>
      <StatusBar hidden />
      <Stack.Screen
        options={{
          title: t('study.title'),
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
                onPress={() => router.push(`/deck/${currentCard.deckId}/card/${currentCard.id}/edit`)}
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
            <Text style={styles.reviewedBadgeText}>{result.reviewed}</Text>
          </View>
          <Text style={[styles.progressText, { color: theme.colors.textTertiary }]}>
            {t('study.progress', { current: currentIndex + 1, total: result.totalCards })}
          </Text>
        </View>

        {/* カード */}
        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.cardArea, cardAnimStyle]}>
            <FlipCard
              ref={flipCardRef}
              isFlipped={isFlipped}
              onFlip={handleFlip}
              front={
                <ScrollView ref={frontScrollRef} style={{ flex: 1 }} contentContainerStyle={styles.faceContent} showsVerticalScrollIndicator={false}>
                  <BlocksView
                    key={currentCard.id}
                    blocks={currentCard.frontContent}
                    editableCode
                    editedContents={editedCodeBlocks[currentCard.id]}
                    onCodeBlockChange={(i, text) => handleCodeBlockChange(currentCard.id, i, text)}
                    onEditFocus={() => { codeEditingRef.current = true; }}
                    onEditBlur={() => { codeEditingRef.current = false; keyboardRef.current?.focus(); }}
                    onSelectCodeBlock={(idx) => { setSelectedCodeBlockIdx(idx); setEditTrigger(0); }}
                    runTrigger={runTrigger}
                    editTrigger={editTrigger}
                    selectedCodeBlockIdx={selectedCodeBlockIdx}
                    scrollRef={frontScrollRef}
                  />
                </ScrollView>
              }
              back={
                <ScrollView ref={backScrollRef} style={{ flex: 1 }} contentContainerStyle={styles.faceContent} showsVerticalScrollIndicator={false}>
                  <BlocksView
                    key={currentCard.id}
                    blocks={currentCard.backContent}
                    scrollRef={backScrollRef}
                  />
                  {/* メモ */}
                  {hasMemo && (
                    <View style={styles.memoSection}>
                      <GestureDetector gesture={memoTapGesture}>
                        <View style={styles.memoToggle}>
                          <Ionicons
                            name={showMemo ? 'eye-off-outline' : 'eye-outline'}
                            size={16}
                            color={theme.colors.textTertiary}
                          />
                          <Text style={[styles.memoToggleText, { color: theme.colors.textTertiary }]}>
                            {showMemo ? t('study.hideMemo') : t('study.showMemo')}
                          </Text>
                        </View>
                      </GestureDetector>
                      {showMemo && (
                        <View style={[styles.memoContent, { backgroundColor: theme.colors.memoBackground, borderLeftColor: theme.colors.inputBorder }]}>
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
          onPress={() => {
            codeEditingRef.current = false;
            setIsFullscreen(true);
            setEditTrigger(0);
            setRunTrigger(0);
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
              <Text style={[styles.flipHintText, { color: theme.colors.textTertiary }]}>{t('study.tapToFlip')}</Text>
            </Pressable>
          ) : (
            <View style={styles.gradeRow}>
              {GRADES.map(({ grade, labelKey, color }) => (
                <TouchableOpacity
                  key={grade}
                  style={[styles.gradeBtn, { borderColor: color, backgroundColor: theme.colors.surface }, grading && styles.gradeBtnDisabled]}
                  onPress={() => handleGradeWithSlide(grade)}
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

      {/* リンク一覧モーダル */}
      <Modal
        visible={showLinksModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLinksModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowLinksModal(false)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{t('study.linksTitle')}</Text>
              <Pressable onPress={() => setShowLinksModal(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
              </Pressable>
            </View>
            <FlatList
              data={cardLinks}
              keyExtractor={(item) => item.url}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.linkRow, { borderBottomColor: theme.colors.inputBorder }]}
                  onPress={() => { setShowLinksModal(false); Linking.openURL(item.url); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.linkText, { color: theme.colors.text }]} numberOfLines={1}>{item.text}</Text>
                    {item.text !== item.url && (
                      <Text style={[styles.linkUrl, { color: theme.colors.textTertiary }]} numberOfLines={1}>{item.url}</Text>
                    )}
                  </View>
                  <Ionicons name="open-outline" size={18} color={theme.colors.primary} />
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
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
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
  },
  progressText: {
    fontSize: 12,
    textAlign: 'right',
  },
  cardArea: { flex: 1, paddingHorizontal: 20, paddingVertical: 12 },
  faceContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 8 },
  faceLabel: { fontSize: 11, fontWeight: '700', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  memoSection: { marginTop: 20, gap: 8 },
  memoToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  memoToggleText: { fontSize: 16 },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalCloseBtn: {
    padding: 4,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '500',
  },
  linkUrl: {
    fontSize: 12,
    marginTop: 2,
  },
});

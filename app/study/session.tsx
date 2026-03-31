import { Ionicons, MaterialIcons } from '@expo/vector-icons';
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
import { FlipSuppressContext } from '@/lib/FlipSuppressContext';
import { useTheme } from '@/lib/theme';
import type { Grade } from '@/lib/sm2';
import type { Block, CodeBlock, TextBlock } from '@/types';
import { useSettingsStore } from '@/store/settings';

type LinkItem = { text: string; url: string };

function extractLinks(blocks: Block[]): LinkItem[] {
  const links: LinkItem[] = [];
  const seen = new Set<string>();
  // markdown リンク [text](url) を先にマッチさせることで、括弧内の URL が生URLとして重複抽出されるのを防ぐ
  const combinedRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+/g;
  const urlRe = /https?:\/\/[^\s)]+/g;
  for (const block of blocks) {
    if (block.type === 'text') {
      const content = (block as TextBlock).content;
      let m: RegExpExecArray | null;
      combinedRe.lastIndex = 0;
      while ((m = combinedRe.exec(content)) !== null) {
        const url = m[2] ?? m[0];
        const text = m[1] ?? m[0];
        if (!seen.has(url)) { seen.add(url); links.push({ text, url }); }
      }
    } else if (block.type === 'code') {
      const content = (block as CodeBlock).content;
      let m: RegExpExecArray | null;
      urlRe.lastIndex = 0;
      while ((m = urlRe.exec(content)) !== null) {
        if (!seen.has(m[0])) { seen.add(m[0]); links.push({ text: m[0], url: m[0] }); }
      }
    }
  }
  return links;
}

const SCROLL_STEP = 200;

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
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
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
  const [selectedCodeBlockIdx, setSelectedCodeBlockIdx] = useState<number | null>(null);
  const [selectedCodeBlockSide, setSelectedCodeBlockSide] = useState<'front' | 'back' | 'memo' | null>(null);
  const [runTrigger, setRunTrigger] = useState(0);
  const [editTrigger, setEditTrigger] = useState(0);
  // cardId -> blockIndex -> 編集済みコード
  const [editedCodeBlocks, setEditedCodeBlocks] = useState<Record<string, Record<number, string>>>({});
  const codeEditingRef = useRef(false);
  const flipCardRef = useRef<FlipCardRef>(null);
  const suppressedRef = useRef(false);
  const suppress = useCallback(() => {
    suppressedRef.current = true;
    setTimeout(() => { suppressedRef.current = false; }, 300);
  }, []);
  const isNavigatingRef = useRef(false);
  const frontScrollRef = useRef<ScrollView>(null);
  const backScrollRef = useRef<ScrollView>(null);
  const frontScrollYRef = useRef(0);
  const backScrollYRef = useRef(0);

  const handleFlip = useCallback(() => setIsFlipped((v) => !v), []);
  const handleToggleMemo = useCallback(() => setShowMemo((v) => !v), []);

  const memoTapGesture = useMemo(
    () => Gesture.Tap().maxDistance(10).onEnd(() => runOnJS(handleToggleMemo)()),
    [handleToggleMemo]
  );

  const cardLinks = useMemo(
    () => extractLinks([...(currentCard?.frontContent ?? []), ...(currentCard?.backContent ?? []), ...(currentCard?.memoContent ?? [])]),
    [currentCard]
  );

  const translateX = useSharedValue(0);
  const slideX = useSharedValue(0);
  const currentIndexSV = useSharedValue(currentIndex);
  const linksSheetY = useSharedValue(500);
  const linksOverlayOpacity = useSharedValue(0);
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
  const linksSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: linksSheetY.value }],
  }));
  const linksOverlayStyle = useAnimatedStyle(() => ({
    opacity: linksOverlayOpacity.value,
  }));
  const keyboardRef = useRef<TextInput>(null);
  const completeRef = useRef<TextInput>(null);
  const completeReadyRef = useRef(false);

  useEffect(() => {
    loadSession({ deckId, tagId, filter });
  }, [deckId, tagId, filter]);

  useEffect(() => {
    if (showLinksModal) {
      linksOverlayOpacity.value = withTiming(1, { duration: 200 });
      linksSheetY.value = withTiming(0, { duration: 250 });
    } else {
      linksOverlayOpacity.value = withTiming(0, { duration: 200 });
      linksSheetY.value = withTiming(500, { duration: 250 });
    }
  }, [showLinksModal]);

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
    setSelectedCodeBlockSide(null);
    setRunTrigger(0);
    setEditTrigger(0);
    currentIndexSV.value = currentIndex;
    frontScrollRef.current?.scrollTo({ y: 0, animated: false });
    backScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [currentIndex]);

  // フリップ時にメモを隠し、コードブロック選択をリセット
  useEffect(() => {
    if (!isFlipped) setShowMemo(false);
    setSelectedCodeBlockIdx(null);
    setSelectedCodeBlockSide(null);
    setRunTrigger(0);
    setEditTrigger(0);
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
      setSelectedCodeBlockSide(null);
      slideInDirRef.current = direction === 'next' ? 1 : -1;
      if (action) action();
      else if (direction === 'next') goNext();
      else goBack();
    }, 180);
  }

  function handleKeyPress(key: string) {
    if (!keyboardShortcutsEnabled) return;

    if (key === ' ') {
      setIsFlipped((v) => !v);
    } else if (key === 't' || key === 'T' || key === 'y' || key === 'Y') {
      const forward = key === 't' || key === 'T';
      if (!isFlipped) {
        // 表面: 表面のコードブロックのみサイクル
        const frontCodeCount = currentCard?.frontContent.filter(b => b.type === 'code').length ?? 0;
        if (frontCodeCount > 0) {
          setEditTrigger(0);
          setRunTrigger(0);
          if (forward) {
            if (selectedCodeBlockIdx === null) {
              setSelectedCodeBlockSide('front');
              setSelectedCodeBlockIdx(0);
            } else if (selectedCodeBlockIdx === frontCodeCount - 1) {
              setSelectedCodeBlockSide(null);
              setSelectedCodeBlockIdx(null);
            } else {
              setSelectedCodeBlockSide('front');
              setSelectedCodeBlockIdx(selectedCodeBlockIdx + 1);
            }
          } else {
            if (selectedCodeBlockIdx === null) {
              setSelectedCodeBlockSide('front');
              setSelectedCodeBlockIdx(frontCodeCount - 1);
            } else if (selectedCodeBlockIdx === 0) {
              setSelectedCodeBlockSide(null);
              setSelectedCodeBlockIdx(null);
            } else {
              setSelectedCodeBlockSide('front');
              setSelectedCodeBlockIdx(selectedCodeBlockIdx - 1);
            }
          }
        }
      } else {
        // 裏面: 裏面＋メモのコードブロックを通しでサイクル
        const backCodeCount = currentCard?.backContent.filter(b => b.type === 'code').length ?? 0;
        const memoCodeCount = currentCard?.memoContent.filter(b => b.type === 'code').length ?? 0;
        const totalCodeCount = backCodeCount + memoCodeCount;
        if (totalCodeCount > 0) {
          setEditTrigger(0);
          setRunTrigger(0);
          // 現在の combined index（back: 0〜backCodeCount-1、memo: backCodeCount〜）
          let currentCombined: number | null = null;
          if (selectedCodeBlockIdx !== null) {
            if (selectedCodeBlockSide === 'back') currentCombined = selectedCodeBlockIdx;
            else if (selectedCodeBlockSide === 'memo') currentCombined = backCodeCount + selectedCodeBlockIdx;
          }
          const applyIndex = (combined: number) => {
            if (combined < backCodeCount) {
              setSelectedCodeBlockSide('back');
              setSelectedCodeBlockIdx(combined);
            } else {
              setSelectedCodeBlockSide('memo');
              setShowMemo(true);
              setSelectedCodeBlockIdx(combined - backCodeCount);
            }
          };
          if (forward) {
            if (currentCombined === null) {
              applyIndex(0);
            } else if (currentCombined === totalCodeCount - 1) {
              setSelectedCodeBlockSide(null);
              setSelectedCodeBlockIdx(null);
            } else {
              applyIndex(currentCombined + 1);
            }
          } else {
            if (currentCombined === null) {
              applyIndex(totalCodeCount - 1);
            } else if (currentCombined === 0) {
              setSelectedCodeBlockSide(null);
              setSelectedCodeBlockIdx(null);
            } else {
              applyIndex(currentCombined - 1);
            }
          }
        }
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
      if (cardLinks.length > 0) {
        setShowLinksModal((v) => !v);
      }
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
    navigateWithSlide('next', () => handleGrade(grade));
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
          <Text style={[styles.completeTitle, { color: theme.colors.text, fontSize: theme.fontSize.xl }]}>{t('study.complete')}</Text>
          <Text style={[styles.completeCount, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
            {t('study.reviewedCount', { count: result.reviewed })}
          </Text>
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
              onPress={() => router.push(`/deck/${currentCard.deckId}/card/${currentCard.id}/edit?tab=${isFlipped ? 'back' : 'front'}`)}
            >
              <Ionicons name="create-outline" size={24} color={theme.colors.iconSubtle} />
            </Pressable>
          </View>

          {/* コンテンツエリア：タップで裏返す */}
          <GestureDetector gesture={panGesture}>
            <Animated.View style={[{ flex: 1 }, cardAnimStyle]}>
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
                      onSelectCodeBlock={(idx) => { setSelectedCodeBlockIdx(idx); setSelectedCodeBlockSide(isFlipped ? 'back' : 'front'); setEditTrigger(0); }}
                      runTrigger={!isFlipped ? runTrigger : undefined}
                      editTrigger={!isFlipped ? editTrigger : undefined}
                      selectedCodeBlockIdx={!isFlipped ? selectedCodeBlockIdx : null}
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
                      onSelectCodeBlock={(idx) => { setSelectedCodeBlockIdx(idx); setSelectedCodeBlockSide(isFlipped ? 'back' : 'front'); setEditTrigger(0); }}
                      runTrigger={isFlipped && selectedCodeBlockSide === 'back' ? runTrigger : undefined}
                      editTrigger={isFlipped && selectedCodeBlockSide === 'back' ? editTrigger : undefined}
                      selectedCodeBlockIdx={isFlipped && selectedCodeBlockSide === 'back' ? selectedCodeBlockIdx : null}
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
                            <Text style={[styles.memoToggleText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.lg }]}>
                              {showMemo ? t('study.hideMemo') : t('study.showMemo')}
                            </Text>
                          </View>
                        </GestureDetector>
                        {showMemo && (
                          <View style={[styles.memoContent, { backgroundColor: theme.colors.memoBackground, borderLeftColor: theme.colors.inputBorder }]}>
                            <BlocksView
                              blocks={currentCard.memoContent}
                              editableCode
                              editedContents={editedCodeBlocks[currentCard.id + '_memo']}
                              onCodeBlockChange={(i, text) => handleCodeBlockChange(currentCard.id, i, text, 'memo')}
                              onEditFocus={() => { codeEditingRef.current = true; }}
                              onEditBlur={() => { codeEditingRef.current = false; keyboardRef.current?.focus(); }}
                              onSelectCodeBlock={(idx) => { setSelectedCodeBlockIdx(idx); setSelectedCodeBlockSide('memo'); setEditTrigger(0); }}
                              runTrigger={showMemo && selectedCodeBlockSide === 'memo' ? runTrigger : undefined}
                              editTrigger={showMemo && selectedCodeBlockSide === 'memo' ? editTrigger : undefined}
                              selectedCodeBlockIdx={showMemo && selectedCodeBlockSide === 'memo' ? selectedCodeBlockIdx : null}
                              scrollRef={backScrollRef}
                            />
                          </View>
                        )}
                      </View>
                    )}
                  </ScrollView>
                }
              />
              </FlipSuppressContext.Provider>
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
                    <Text style={[styles.gradeBtnText, { color, fontSize: theme.fontSize.sm }]}>{t(labelKey)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* リンク一覧オーバーレイ（全画面モード） */}
        <View
          pointerEvents={showLinksModal ? 'box-none' : 'none'}
          style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
        >
          <Animated.View style={[StyleSheet.absoluteFillObject, linksOverlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowLinksModal(false)} />
          </Animated.View>
          <Animated.View style={[linksSheetStyle, styles.modalSheet, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>{t('study.linksTitle')}</Text>
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
                    <Text style={[styles.linkText, { color: theme.colors.text, fontSize: theme.fontSize.md }]} numberOfLines={1}>{item.text}</Text>
                    {item.text !== item.url && (
                      <Text style={[styles.linkUrl, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }]} numberOfLines={1}>{item.url}</Text>
                    )}
                  </View>
                  <Ionicons name="open-outline" size={18} color={theme.colors.primary} />
                </Pressable>
              )}
            />
          </Animated.View>
        </View>
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
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text }}>
                {t('study.title')}
              </Text>
              {keyboardShortcutsEnabled && (
                <MaterialIcons name="keyboard" size={18} color={theme.colors.textSecondary} />
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
        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.cardArea, cardAnimStyle]}>
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
                    onSelectCodeBlock={(idx) => { setSelectedCodeBlockIdx(idx); setEditTrigger(0); }}
                    runTrigger={!isFlipped ? runTrigger : undefined}
                    editTrigger={!isFlipped ? editTrigger : undefined}
                    selectedCodeBlockIdx={!isFlipped ? selectedCodeBlockIdx : null}
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
                    onSelectCodeBlock={(idx) => { setSelectedCodeBlockIdx(idx); setSelectedCodeBlockSide('back'); setEditTrigger(0); }}
                    runTrigger={isFlipped && selectedCodeBlockSide === 'back' ? runTrigger : undefined}
                    editTrigger={isFlipped && selectedCodeBlockSide === 'back' ? editTrigger : undefined}
                    selectedCodeBlockIdx={isFlipped && selectedCodeBlockSide === 'back' ? selectedCodeBlockIdx : null}
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
                          <BlocksView
                            blocks={currentCard.memoContent}
                            editableCode
                            editedContents={editedCodeBlocks[currentCard.id + '_memo']}
                            onCodeBlockChange={(i, text) => handleCodeBlockChange(currentCard.id, i, text, 'memo')}
                            onEditFocus={() => { codeEditingRef.current = true; }}
                            onEditBlur={() => { codeEditingRef.current = false; keyboardRef.current?.focus(); }}
                            onSelectCodeBlock={(idx) => { setSelectedCodeBlockIdx(idx); setSelectedCodeBlockSide('memo'); setEditTrigger(0); }}
                            runTrigger={showMemo && selectedCodeBlockSide === 'memo' ? runTrigger : undefined}
                            editTrigger={showMemo && selectedCodeBlockSide === 'memo' ? editTrigger : undefined}
                            selectedCodeBlockIdx={showMemo && selectedCodeBlockSide === 'memo' ? selectedCodeBlockIdx : null}
                            scrollRef={backScrollRef}
                          />
                        </View>
                      )}
                    </View>
                  )}
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
              <Text style={[styles.flipHintText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>{t('study.tapToFlip')}</Text>
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
                  <Text style={[styles.gradeBtnText, { color, fontSize: theme.fontSize.sm }]}>{t(labelKey)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>

      {/* リンク一覧オーバーレイ */}
      <View
        pointerEvents={showLinksModal ? 'box-none' : 'none'}
        style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
      >
        <Animated.View style={[StyleSheet.absoluteFillObject, linksOverlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowLinksModal(false)} />
        </Animated.View>
        <Animated.View style={[linksSheetStyle, styles.modalSheet, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>{t('study.linksTitle')}</Text>
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
        </Animated.View>
      </View>

      <Modal
        visible={showShortcutsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowShortcutsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowShortcutsModal(false)} />
          <View style={[styles.shortcutsSheet, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.shortcutsTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>
              {t('settings.keyboardShortcuts')}
            </Text>
            <ScrollView>
              {STUDY_SHORTCUTS.map((item) => (
                <View key={item.key} style={[styles.shortcutRow, { borderBottomColor: theme.colors.border }]}>
                  <View style={[styles.keyBadge, { backgroundColor: theme.colors.background }]}>
                    <Text style={{ fontFamily: 'monospace', fontSize: theme.fontSize.sm, color: theme.colors.text }}>
                      {item.key}
                    </Text>
                  </View>
                  <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}>
                    {t(item.descKey)}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
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
    fontWeight: '500',
  },
  linkUrl: {
    marginTop: 2,
  },
  shortcutsSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  shortcutsTitle: {
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  shortcutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  keyBadge: {
    minWidth: 48,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
  },
});

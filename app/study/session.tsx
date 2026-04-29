import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { StatusBar, setStatusBarHidden as expoSetStatusBarHidden } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";

import { BlocksView } from "@/components/study/BlocksView";
import { FlipCard, type FlipCardRef } from "@/components/study/FlipCard";
import { LinksSheet } from "@/components/study/LinksSheet";
import { ShortcutsModal } from "@/components/study/ShortcutsModal";
import { useCodeBlockSelection } from "@/hooks/useCodeBlockSelection";
import { useKeyboardFocus } from "@/hooks/useKeyboardFocus";
import { useStudySession } from "@/hooks/useStudySession";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import {
  DONUT_CX,
  DONUT_CY,
  DONUT_INNER_R,
  DONUT_R,
  DONUT_SIZE,
  donutArcPath,
} from "@/lib/donut";
import { FlipSuppressContext } from "@/lib/FlipSuppressContext";
import { getReviewByCardId } from "@/lib/database/reviews";
import { updateBadgeCount } from "@/lib/notifications";
import type { Grade } from "@/lib/sm2";
import type { Block } from "@/types";
import { extractLinks } from "@/lib/study/extractLinks";
import { GRADE_COLORS, useTheme, MAX_FONT_MULTIPLIER } from "@/lib/theme";
import { useDeckStore } from "@/store/decks";
import { useSettingsStore } from "@/store/settings";
import { useTagStore } from "@/store/tags";

const SCROLL_STEP = 200;

const GRADES: { grade: Grade; labelKey: string; color: string }[] = [
  { grade: 0, labelKey: "grade.again", color: GRADE_COLORS.again },
  { grade: 1, labelKey: "grade.hard", color: GRADE_COLORS.hard },
  { grade: 2, labelKey: "grade.good", color: GRADE_COLORS.good },
  { grade: 3, labelKey: "grade.easy", color: GRADE_COLORS.easy },
];

const SESSION_SHORTCUTS = [
  { key: "Space", descKey: "shortcut.flip" },
  { key: "1–4", descKey: "shortcut.grade" },
  { key: ", / .", descKey: "shortcut.nextPrev" },
  { key: "M", descKey: "shortcut.memo" },
  { key: "F", descKey: "shortcut.fullscreen" },
  { key: "J / K", descKey: "shortcut.focusNextPrev" },
  { key: "R", descKey: "shortcut.runFocused" },
  { key: "E", descKey: "shortcut.editFocusedItem" },
  { key: "U / D", descKey: "shortcut.scrollUpDown" },
  { key: "B", descKey: "shortcut.back" },
  { key: "L", descKey: "shortcut.links" },
  { key: "P", descKey: "shortcut.pencil" },
  { key: "Q", descKey: "shortcut.finishSession" },
];

export default function StudySessionScreen() {
  const { deckId, tagId, filter, shuffle } = useLocalSearchParams<{
    deckId?: string;
    tagId?: string;
    filter?: "all" | "today" | "due" | "unlearned";
    shuffle?: string;
  }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useSQLiteContext();
  const {
    loading,
    completed,
    currentCard,
    currentIndex,
    result,
    loadSession,
    submitGrade,
    goBack,
    goNext,
    refreshCurrentCard,
    finishSession,
  } = useStudySession();

  // モーダル遷移中は onBlur による自動再フォーカスを抑制するためのフラグ
  const { keyboardRef, isScreenFocusedRef, onScreenBlur } = useKeyboardFocus();
  // 初回フォーカス（画面遷移）かどうかを追跡するフラグ
  const isFirstFocusRef = useRef(true);
  const statusBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFocusEffect(
    useCallback(() => {
      isScreenFocusedRef.current = true;
      refreshCurrentCard();
      if (isFirstFocusRef.current) {
        // 初回: フェードアニメーション完了後にステータスバーを非表示（前画面のレイアウトズレを防ぐ）
        isFirstFocusRef.current = false;
        statusBarTimerRef.current = setTimeout(() => setStatusBarHidden(true), 300);
      } else {
        // サブ画面（カード編集等）から戻った際は即座に再非表示
        setStatusBarHidden(true);
      }
      // モーダルから戻った際にキーボードショートカットを復元
      setTimeout(() => {
        if (!codeEditingRef.current) keyboardRef.current?.focus();
      }, 100);
      return () => {
        if (statusBarTimerRef.current) {
          clearTimeout(statusBarTimerRef.current);
          statusBarTimerRef.current = null;
        }
        onScreenBlur();
        setStatusBarHidden(false);
        // コンポーネントのアンマウントとバッチ処理されて StatusBar 再レンダリングが
        // 走らない場合があるため、命令型 API で確実に復元する
        expoSetStatusBarHidden(false, 'fade');
      };
    }, [refreshCurrentCard]),
  );

  const [keyboardInputKey, setKeyboardInputKey] = useState(0);
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const { width: screenWidth } = useWindowDimensions();
  // iPad: ステータスバーを隠す際にヘッダー高さが変わらないよう、初回 top inset を固定値として保持
  const insets = useSafeAreaInsets();
  const initialTopInsetRef = useRef(insets.top);
  const { decks } = useDeckStore();
  const { tags } = useTagStore();
  const sessionTitle = deckId
    ? (decks.find((d) => d.id === deckId)?.name ?? t("study.title"))
    : tagId
      ? (tags.find((tg) => tg.id === tagId)?.name ?? t("study.title"))
      : t("study.title");

  const [statusBarHidden, setStatusBarHidden] = useState(false);

  const [isFlipped, setIsFlipped] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [grading, setGrading] = useState(false);
  const [prevGrade, setPrevGrade] = useState<Grade | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLinksModal, setShowLinksModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);

  // キーボード表示時に paddingBottom を追加してスクロール余白を確保する
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // cardId -> blockIndex -> 編集済みコード
  const [editedCodeBlocks, setEditedCodeBlocks] = useState<
    Record<string, Record<number, string>>
  >({});
  const codeEditingRef = useRef(false);
  // 別 BlocksView のコードブロックへ編集が移るとき、onEditBlur の keyboardRef.focus() を抑制する
  const switchingCodeBlockRef = useRef(false);
  // 裏面↔メモ間でコード実行・選択が切り替わったとき、相手側の編集を終了させるトリガー
  const [backExitAllEditTrigger, setBackExitAllEditTrigger] = useState(0);
  const [memoExitAllEditTrigger, setMemoExitAllEditTrigger] = useState(0);
  const flipCardRef = useRef<FlipCardRef>(null);
  // コードブロックのボタンタップがFlipCardに伝播して意図せず裏返るのを防ぐ（300ms抑制）
  const suppressedRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppress = useCallback(() => {
    if (suppressTimerRef.current !== null) {
      clearTimeout(suppressTimerRef.current);
    }
    suppressedRef.current = true;
    suppressTimerRef.current = setTimeout(() => {
      suppressedRef.current = false;
      suppressTimerRef.current = null;
    }, 300);
  }, []);

  const frontScrollRef = useRef<ScrollView>(null);
  const backScrollRef = useRef<ScrollView>(null);
  const frontScrollYRef = useRef(0);
  const backScrollYRef = useRef(0);
  const memoSectionYRef = useRef(0);
  const memoContentOffsetRef = useRef(0);
  const memoScrollBaseYRef = useRef(0);
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

  // BlocksView 共通ハンドラ
  const handleCodeEditFocus = useCallback(() => {
    codeEditingRef.current = true;
  }, []);
  // メモ欄専用: 編集開始時にキーボード表示後、裏面 ScrollView を末尾へスクロール
  const handleMemoCodeEditFocus = useCallback(() => {
    codeEditingRef.current = true;
    setTimeout(() => {
      backScrollRef.current?.scrollToEnd({ animated: true });
    }, 350);
  }, []);
  const handleCodeEditBlur = useCallback(() => {
    codeEditingRef.current = false;
    if (!switchingCodeBlockRef.current && isScreenFocusedRef.current) {
      // keyboardRef TextInput を強制リマウントして autoFocus でフォーカスを確実に取得する。
      // focus() の直接呼び出しは WebView 初期化との競合で失敗する場合があるため、
      // autoFocus（フルスクリーン切替と同じ仕組み）を使う。
      // Keyboard.dismiss() でソフトキーボードを明示的に閉じてからリマウントする。
      // isScreenFocusedRef が false（カード編集画面等へ遷移済み）の場合はスキップし、
      // 遷移先の hidden TextInput のフォーカスを奪わないようにする。
      Keyboard.dismiss();
      setKeyboardInputKey((k) => k + 1);
    }
  }, []);
  // 実行ボタン経由での編集終了時に呼ぶ。switchingCodeBlockRef に関わらず
  // keyboard TextInput を強制リマウントしてショートカットキーを確実に復元する。
  // （編集 → 実行の場合、handleEditRequest が makeSelectHandler 経由で
  //   switchingCodeBlockRef=true をセットするため、handleCodeEditBlur のガードが
  //   300ms 以内に実行すると setKeyboardInputKey をスキップしてしまう。）
  const handleForceKeyboardFocus = useCallback(() => {
    codeEditingRef.current = false;
    if (isScreenFocusedRef.current) {
      Keyboard.dismiss();
      setKeyboardInputKey((k) => k + 1);
    }
  }, []);
  /**
   * onSelectCodeBlock ファクトリ
   * - side: 選択されたブロックの面（null = 変更しない）
   * - triggerOther: 相手面の編集を終了させるタイミング
   */
  const makeSelectHandler = useCallback(
    (
      side: 'front' | 'back' | 'memo' | 'frontOrBack' | null,
      triggerOther?: 'back' | 'memo' | 'memoIfFlipped',
    ) => (idx: number) => {
      switchingCodeBlockRef.current = true;
      setTimeout(() => { switchingCodeBlockRef.current = false; }, 300);
      // 他面のコードブロックが編集中の場合、exitAllEditTrigger → handleCodeEditBlur が
      // switchingCodeBlockRef ガードで setKeyboardInputKey をスキップするため、
      // ここで強制的にキーボードフォーカスを復元する
      const willExitOtherFace =
        triggerOther === 'back' ||
        triggerOther === 'memo' ||
        (triggerOther === 'memoIfFlipped' && isFlipped);
      if (willExitOtherFace && codeEditingRef.current) {
        handleForceKeyboardFocus();
      }
      if (triggerOther === 'back') setBackExitAllEditTrigger(v => v + 1);
      if (triggerOther === 'memo') setMemoExitAllEditTrigger(v => v + 1);
      if (triggerOther === 'memoIfFlipped' && isFlipped) setMemoExitAllEditTrigger(v => v + 1);
      cbs.setSelectedCodeBlockIdx(idx);
      if (side === 'memo') cbs.setSelectedCodeBlockSide('memo');
      else if (side === 'back') cbs.setSelectedCodeBlockSide('back');
      else if (side === 'frontOrBack') cbs.setSelectedCodeBlockSide(isFlipped ? 'back' : 'front');
      cbs.setEditTrigger(0);
    },
    [cbs, isFlipped, handleForceKeyboardFocus],
  );

  const cardLinks = useMemo(
    () =>
      extractLinks([
        ...(currentCard?.frontContent ?? []),
        ...(currentCard?.backContent ?? []),
        ...(currentCard?.memoContent ?? []),
      ]),
    [currentCard],
  );

  useEffect(() => {
    loadSession({ deckId, tagId, filter, shuffle: shuffle === "1" });
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
      setTimeout(() => {
        completeRef.current?.focus();
        setTimeout(() => {
          completeReadyRef.current = true;
        }, 200);
      }, 100);
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

  // カードが切り替わったら前回グレードを取得
  useEffect(() => {
    if (!currentCard) { setPrevGrade(null); return; }
    getReviewByCardId(db, currentCard.id).then((r) => {
      setPrevGrade(r != null ? (r.lastGrade as Grade) : null);
    });
  }, [currentCard?.id]);

  // フリップ時にメモを隠し、コードブロック選択をリセット
  useEffect(() => {
    if (!isFlipped) setShowMemo(false);
    cbs.reset();
  }, [isFlipped]);

  // メモを展開したらメモ欄までスクロール
  useEffect(() => {
    if (showMemo) {
      setTimeout(() => {
        backScrollRef.current?.scrollTo({
          y: memoSectionYRef.current,
          animated: true,
        });
      }, 100);
    }
  }, [showMemo]);

  function handleKeyPress(key: string) {
    if (!keyboardShortcutsEnabled) return;

    if (key === " ") {
      cbs.setRunTrigger(0);
      cbs.setEditTrigger(0);
      setIsFlipped((v) => !v);
    } else if (key === "j" || key === "J" || key === "k" || key === "K") {
      cbs.cycleCodeBlock(
        key === "j" || key === "J",
        currentCard,
        isFlipped,
        setShowMemo,
      );
    } else if (key.toLowerCase() === "r") {
      if (cbs.selectedCodeBlockIdx !== null) cbs.setRunTrigger((v) => v + 1);
    } else if (key === ".") {
      swipe.navigateWithSlide("next");
    } else if (key === ",") {
      swipe.navigateWithSlide("prev");
    } else if (key.toLowerCase() === "m" && isFlipped) {
      setShowMemo((v) => !v);
    } else if (key.toLowerCase() === "f") {
      setIsFullscreen((v) => !v);
      cbs.setEditTrigger(0);
      cbs.setRunTrigger(0);
    } else if (key.toLowerCase() === "e") {
      if (cbs.selectedCodeBlockIdx !== null) cbs.setEditTrigger((v) => v + 1);
    } else if (key.toLowerCase() === "u") {
      const ref = isFlipped ? backScrollRef : frontScrollRef;
      const y = isFlipped ? backScrollYRef.current : frontScrollYRef.current;
      ref.current?.scrollTo({
        y: Math.max(0, y - SCROLL_STEP),
        animated: true,
      });
    } else if (key.toLowerCase() === "d") {
      const ref = isFlipped ? backScrollRef : frontScrollRef;
      const y = isFlipped ? backScrollYRef.current : frontScrollYRef.current;
      ref.current?.scrollTo({ y: y + SCROLL_STEP, animated: true });
    } else if (key.toLowerCase() === "q") {
      handleFinishSession();
    } else if (key.toLowerCase() === "b") {
      router.back();
    } else if (key.toLowerCase() === "l") {
      if (cardLinks.length > 0) { Keyboard.dismiss(); setShowLinksModal((v) => !v); }
    } else if (key.toLowerCase() === "p") {
      if (currentCard) {
        const tab = isFlipped ? "back" : "front";
        router.push(
          `/deck/${currentCard.deckId}/card/${currentCard.id}/edit?tab=${tab}`,
        );
      }
    } else if (isFlipped && !grading) {
      if (key === "1") handleGradeWithSlide(0);
      else if (key === "2") handleGradeWithSlide(1);
      else if (key === "3") handleGradeWithSlide(2);
      else if (key === "4") handleGradeWithSlide(3);
    }
  }

  function handleFinishSession() {
    const remaining = result.totalCards - result.reviewed;
    Alert.alert(
      t("study.finishConfirmTitle"),
      t("study.finishConfirmMessage", { count: remaining }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.ok"), onPress: finishSession },
      ],
    );
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
    swipe.navigateWithSlide("next", () => handleGrade(grade));
  }

  function handleCodeBlockChange(
    cardId: string,
    blockIndex: number,
    text: string,
    side: "front" | "back" | "memo" = "front",
  ) {
    const key =
      side === "back"
        ? cardId + "_back"
        : side === "memo"
          ? cardId + "_memo"
          : cardId;
    setEditedCodeBlocks((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [blockIndex]: text },
    }));
  }

  // iPhone 用インラインカスタムヘッダー（headerShown:false のため全状態で共通利用）
  const iPhoneHeader = !(Platform as any).isPad ? (
    <View style={{ height: initialTopInsetRef.current + 44, backgroundColor: theme.colors.surface }}>
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: 44,
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
      }}>
        <Pressable
          onPress={!completed && keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
          style={{
            position: 'absolute', left: 0, right: 0,
            alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
            paddingHorizontal: 56, gap: 4,
          }}
        >
          <Text
            style={{ fontWeight: "600", fontSize: theme.fontSize.lg, color: theme.colors.text, maxWidth: screenWidth * 0.46, flexShrink: 1 }}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {sessionTitle}
          </Text>
          {!completed && keyboardShortcutsEnabled && (
            <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
          )}
        </Pressable>
        {!completed ? (
          <Pressable
            onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={4}
          >
            <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
        <View style={{ flex: 1 }} />
        {!completed && currentCard && (
          <>
            <Pressable
              onPress={() => router.push(`/deck/${currentCard.deckId}/card/${currentCard.id}/edit?tab=${isFlipped ? "back" : "front"}`)}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
            >
              <Ionicons name="pencil-sharp" size={26} color={theme.colors.primary} />
            </Pressable>
            <Pressable
              onPress={handleFinishSession}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
            >
              <Ionicons name="checkmark-done-outline" size={26} color={theme.colors.primary} />
            </Pressable>
          </>
        )}
      </View>
    </View>
  ) : null;

  if (loading) {
    return (
      <>
        <StatusBar hidden={statusBarHidden} />
        {iPhoneHeader}
        <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </>
    );
  }

  // セッション完了画面
  if (completed) {
    const { again, hard, good, easy } = result.gradeCount;
    const reviewed = result.reviewed;
    const totalCards = result.totalCards;
    const skipped = totalCards - reviewed;
    const skipColor = theme.dark ? "#6B7280" : "#9CA3AF";
    // 凡例用（評価なし→再度→難しい→普通→簡単 の順）
    const gradeItems: { key: string; count: number; color: string }[] = [
      ...(skipped > 0
        ? [{ key: t("study.skipped"), count: skipped, color: skipColor }]
        : []),
      { key: t("grade.again"), count: again, color: GRADE_COLORS.again },
      { key: t("grade.hard"), count: hard, color: GRADE_COLORS.hard },
      { key: t("grade.good"), count: good, color: GRADE_COLORS.good },
      { key: t("grade.easy"), count: easy, color: GRADE_COLORS.easy },
    ];
    // チャート描画用（12時から時計回りに 簡単→普通→難しい→再度→評価なし）
    const gradeChartItems: { count: number; color: string }[] = [
      { count: easy,    color: GRADE_COLORS.easy },
      { count: good,    color: GRADE_COLORS.good },
      { count: hard,    color: GRADE_COLORS.hard },
      { count: again,   color: GRADE_COLORS.again },
      ...(skipped > 0 ? [{ count: skipped, color: skipColor }] : []),
    ];
    const gradeMaxLabelLen = Math.max(...gradeItems.map(g => g.key.length));
    const gradeLabelFontSize = gradeMaxLabelLen >= 3 ? theme.fontSize.xs : theme.fontSize.sm;
    const reviewRate =
      totalCards > 0 ? Math.round((reviewed / totalCards) * 100) : 0;
    const correctRate =
      reviewed > 0 ? Math.round(((hard + good + easy) / reviewed) * 100) : 0;
    const nextReviewStr = result.earliestNextReview
      ? (() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const target = new Date(result.earliestNextReview.slice(0, 10));
          target.setHours(0, 0, 0, 0);
          const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
          if (diffDays <= 0) return t("study.nextReviewToday");
          if (diffDays === 1) return t("study.nextReviewTomorrow");
          return t("study.nextReviewDays", { count: diffDays });
        })()
      : null;

    let cumDeg = 0;
    const donutSlices =
      totalCards > 0
        ? gradeChartItems
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
        <StatusBar hidden={statusBarHidden} />
        <Stack.Screen options={{ headerShown: false }} />
        <TextInput
          ref={completeRef}
          style={styles.hiddenKeyboardInput}
          autoFocus
          caretHidden
          keyboardType="ascii-capable"
          showSoftInputOnFocus={false}
          disableKeyboardShortcuts={true}
          onKeyPress={({ nativeEvent: { key } }) => {
            if (key === "Enter") {
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
        {(Platform as any).isPad ? (
          <View
            style={{
              height: initialTopInsetRef.current + 44,
              backgroundColor: theme.colors.surface,
              justifyContent: "flex-end",
              alignItems: "center",
              paddingBottom: 10,
            }}
          >
            <Text
              style={{ fontWeight: "600", fontSize: theme.fontSize.lg, color: theme.colors.text }}
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t("study.title")}
            </Text>
          </View>
        ) : iPhoneHeader}
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.colors.background }}
          contentContainerStyle={styles.completeScreen}
          bounces={false}
        >
          <Ionicons name="checkmark-circle" size={80} color="#43A047" />
          <Text
            style={[
              styles.completeTitle,
              { color: theme.colors.text, fontSize: theme.fontSize.xl },
            ]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {t("study.complete")}
          </Text>
          {reviewed > 0 && (
            <View
              style={[
                styles.summarySection,
                { backgroundColor: theme.colors.surface },
              ]}
            >
              {/* 評価済み ◯/◯ 枚 */}
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: theme.fontSize.lg,
                  textAlign: "center",
                }}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {t("study.reviewedOf", { reviewed, total: totalCards })}
              </Text>
              {/* ドーナツチャート */}
              <View style={styles.donutContainer}>
                <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
                  <Circle
                    cx={DONUT_CX}
                    cy={DONUT_CY}
                    r={DONUT_R}
                    fill={theme.colors.progressBg}
                  />
                  {donutSlices.map(({ color, path }, i) => (
                    <Path key={i} d={path} fill={color} />
                  ))}
                  <Circle
                    cx={DONUT_CX}
                    cy={DONUT_CY}
                    r={DONUT_INNER_R}
                    fill={theme.colors.surface}
                  />
                  <SvgText
                    x={DONUT_CX}
                    y={DONUT_CY + 10}
                    textAnchor="middle"
                    fontSize={24}
                    fontWeight="700"
                    fill={theme.colors.text}
                  >
                    {reviewRate}
                  </SvgText>
                </Svg>
              </View>

              <View style={[styles.sectionSeparator, { backgroundColor: theme.colors.border }]} />

              {/* グレード別枚数 */}
              <View style={styles.summaryGradeRow}>
                {gradeItems.map(({ key, count, color }) => (
                  <View key={key} style={styles.gradeItem}>
                    <Text
                      style={[
                        styles.gradeItemCount,
                        { color, fontSize: theme.fontSize.lg },
                      ]}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                    >
                      {count}
                    </Text>
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: gradeLabelFontSize,
                      }}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}
                    >
                      {key}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={[styles.sectionSeparator, { backgroundColor: theme.colors.border }]} />

              {/* 正答率・次回予定 */}
              <View style={styles.statRow}>
                <View style={styles.statItem}>
                  <Text
                    style={[
                      styles.statValue,
                      { color: theme.colors.text, fontSize: theme.fontSize.xl },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {correctRate}%
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: theme.fontSize.xs,
                    }}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {t("study.correctRate")}
                  </Text>
                </View>
                {nextReviewStr && (
                  <View style={styles.statItem}>
                    <Text
                      style={[
                        styles.statValue,
                        {
                          color: theme.colors.text,
                          fontSize: theme.fontSize.xl,
                        },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                    >
                      {nextReviewStr}
                    </Text>
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: theme.fontSize.xs,
                      }}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                    >
                      {t("study.nextReview")}
                    </Text>
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
            <Text
              style={[
                styles.backBtnText,
                {
                  color: theme.colors.primaryText,
                  fontSize: theme.fontSize.lg,
                },
              ]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t("common.ok")}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </>
    );
  }

  if (!currentCard) {
    return (
      <>
        <StatusBar hidden={statusBarHidden} />
        {iPhoneHeader}
      </>
    );
  }

  const progressRatio =
    result.totalCards > 0 ? (currentIndex + 1) / result.totalCards : 0;
  const hasMemo = currentCard.memoContent.some(
    (b: Block) =>
      (b.type !== "image" && "content" in b && b.content.trim() !== "") ||
      (b.type === "image" && !!b.uri),
  );

  // メモトグル（Pressable で処理するため memoTapGesture は使用しない）
  const memoToggle = (
    <Pressable style={styles.memoToggle} onPress={handleToggleMemo} onTouchStart={suppress}>
      <Ionicons
        name={showMemo ? "eye-off-outline" : "eye-outline"}
        size={16}
        color={theme.colors.textTertiary}
      />
      <Text
        style={{ color: theme.colors.textTertiary }}
        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
      >
        {showMemo ? t("study.hideMemo") : t("common.memo")}
      </Text>
    </Pressable>
  );

  const memoBlock = hasMemo && (
    <View
      style={styles.memoSection}
      onLayout={(e) => {
        memoSectionYRef.current = e.nativeEvent.layout.y;
        memoScrollBaseYRef.current =
          memoSectionYRef.current + memoContentOffsetRef.current;
      }}
    >
      {memoToggle}
      {showMemo && (
        <View
          style={[
            styles.memoContent,
            {
              backgroundColor: theme.colors.memoBackground,
              borderLeftColor: theme.colors.inputBorder,
            },
          ]}
          onLayout={(e) => {
            memoContentOffsetRef.current = e.nativeEvent.layout.y;
            memoScrollBaseYRef.current =
              memoSectionYRef.current + memoContentOffsetRef.current;
          }}
        >
          <BlocksView
            blocks={currentCard.memoContent}
            editableCode
            editedContents={editedCodeBlocks[currentCard.id + "_memo"]}
            onCodeBlockChange={(i, text) =>
              handleCodeBlockChange(currentCard.id, i, text, "memo")
            }
            onEditFocus={handleMemoCodeEditFocus}
            onEditBlur={handleCodeEditBlur}
            onForceKeyboardFocus={handleForceKeyboardFocus}
            onSelectCodeBlock={makeSelectHandler('memo', 'back')}
            runTrigger={
              showMemo && cbs.selectedCodeBlockSide === "memo"
                ? cbs.runTrigger
                : undefined
            }
            editTrigger={
              showMemo && cbs.selectedCodeBlockSide === "memo"
                ? cbs.editTrigger
                : undefined
            }
            selectedCodeBlockIdx={
              showMemo && cbs.selectedCodeBlockSide === "memo"
                ? cbs.selectedCodeBlockIdx
                : null
            }
            exitAllEditTrigger={memoExitAllEditTrigger}
            scrollRef={backScrollRef}
            scrollBaseYRef={memoScrollBaseYRef}
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
          style={[
            styles.gradeBtn,
            { borderColor: color, backgroundColor: theme.colors.surface },
            grading && styles.gradeBtnDisabled,
          ]}
          onPress={() => handleGradeWithSlide(grade)}
          disabled={grading}
          activeOpacity={0.7}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[
              styles.gradeBtnText,
              { color, fontSize: theme.fontSize.sm },
            ]}
          >
            {t(labelKey)}
          </Text>
          <View style={[styles.prevGradeDot, { backgroundColor: prevGrade === grade ? color : 'transparent' }]} />
        </TouchableOpacity>
      ))}
    </View>
  );

  if (isFullscreen) {
    return (
      <>
        <StatusBar hidden={statusBarHidden} />
        <Stack.Screen
          options={{
            title: t("study.title"),
            headerBackTitle: "",
            headerShown: false,
          }}
        />
        <TextInput
          key={keyboardInputKey}
          ref={keyboardRef}
          style={styles.hiddenKeyboardInput}
          autoFocus
          caretHidden
          keyboardType="ascii-capable"
          showSoftInputOnFocus={false}
          disableKeyboardShortcuts={true}
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          onKeyPress={({ nativeEvent: { key } }) => handleKeyPress(key)}
          onSubmitEditing={() => {
            if (cbs.selectedCodeBlockIdx !== null) cbs.setEditTrigger((v) => v + 1);
          }}
          onBlur={() => {
            setTimeout(() => {
              if (!codeEditingRef.current && isScreenFocusedRef.current)
                keyboardRef.current?.focus();
            }, 50);
          }}
        />
        <View
          style={[styles.container, { backgroundColor: theme.colors.surface }]}
        >
          {/* ヘッダー行（実体あり、スクロール外） */}
          <View style={styles.fullscreenHeader}>
            <Pressable
              style={styles.fullscreenExitBtn}
              onPress={() => {
                codeEditingRef.current = false;
                setIsFullscreen(false);
                cbs.setEditTrigger(0);
                cbs.setRunTrigger(0);
                setTimeout(() => {
                  keyboardRef.current?.focus();
                }, 100);
              }}
            >
              <Ionicons
                name="contract-outline"
                size={Math.round(theme.fontSize.xxl)}
                color={theme.colors.iconSubtle}
              />
            </Pressable>
            {cardLinks.length > 0 && (
              <Pressable
                style={styles.fullscreenEditBtn}
                onPress={() => { Keyboard.dismiss(); setShowLinksModal(true); }}
                accessibilityLabel={t("study.links")}
              >
                <Ionicons
                  name="link-sharp"
                  size={Math.round(theme.fontSize.xxl)}
                  color={theme.colors.iconSubtle}
                />
              </Pressable>
            )}
            <View style={{ flex: 1 }} />
            <Pressable
              style={styles.fullscreenEditBtn}
              onPress={() =>
                router.push(
                  `/deck/${currentCard.deckId}/card/${currentCard.id}/edit?tab=${isFlipped ? "back" : "front"}`,
                )
              }
            >
              <Ionicons
                name="pencil-sharp"
                size={Math.round(theme.fontSize.xl)}
                color={theme.colors.iconSubtle}
              />
            </Pressable>
            <Pressable
              style={styles.fullscreenEditBtn}
              onPress={handleFinishSession}
            >
              <Ionicons
                name="checkmark-done-outline"
                size={Math.round(theme.fontSize.xl)}
                color={theme.colors.iconSubtle}
              />
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
                  cardStyle={{
                    borderRadius: 0,
                    shadowOpacity: 0,
                    elevation: 0,
                  }}
                  innerStyle={{ padding: 0, justifyContent: "flex-start" }}
                  front={
                    <ScrollView
                      ref={frontScrollRef}
                      style={{ flex: 1 }}
                      contentContainerStyle={[styles.fullscreenContent, kbHeight > 0 && { paddingBottom: kbHeight + 20 }]}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      bounces={false}
                      onScroll={(e) => {
                        frontScrollYRef.current = e.nativeEvent.contentOffset.y;
                      }}
                      scrollEventThrottle={16}
                    >
                      <BlocksView
                        key={currentCard.id}
                        blocks={currentCard.frontContent}
                        editableCode
                        editedContents={editedCodeBlocks[currentCard.id]}
                        onCodeBlockChange={(i, text) =>
                          handleCodeBlockChange(currentCard.id, i, text)
                        }
                        onEditFocus={handleCodeEditFocus}
                        onEditBlur={handleCodeEditBlur}
                        onForceKeyboardFocus={handleForceKeyboardFocus}
                        onSelectCodeBlock={makeSelectHandler('frontOrBack')}
                        runTrigger={!isFlipped ? cbs.runTrigger : undefined}
                        editTrigger={!isFlipped ? cbs.editTrigger : undefined}
                        selectedCodeBlockIdx={
                          !isFlipped ? cbs.selectedCodeBlockIdx : null
                        }
                        scrollRef={frontScrollRef}
                      />
                    </ScrollView>
                  }
                  back={
                    <ScrollView
                      ref={backScrollRef}
                      style={{ flex: 1 }}
                      contentContainerStyle={[styles.fullscreenContent, kbHeight > 0 && { paddingBottom: kbHeight + 20 }]}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      bounces={false}
                      onScroll={(e) => {
                        backScrollYRef.current = e.nativeEvent.contentOffset.y;
                      }}
                      scrollEventThrottle={16}
                    >
                      <BlocksView
                        key={currentCard.id}
                        blocks={currentCard.backContent}
                        editableCode
                        editedContents={
                          editedCodeBlocks[currentCard.id + "_back"]
                        }
                        onCodeBlockChange={(i, text) =>
                          handleCodeBlockChange(currentCard.id, i, text, "back")
                        }
                        onEditFocus={handleCodeEditFocus}
                        onEditBlur={handleCodeEditBlur}
                        onForceKeyboardFocus={handleForceKeyboardFocus}
                        onSelectCodeBlock={makeSelectHandler('frontOrBack', 'memoIfFlipped')}
                        runTrigger={
                          isFlipped && cbs.selectedCodeBlockSide === "back"
                            ? cbs.runTrigger
                            : undefined
                        }
                        editTrigger={
                          isFlipped && cbs.selectedCodeBlockSide === "back"
                            ? cbs.editTrigger
                            : undefined
                        }
                        selectedCodeBlockIdx={
                          isFlipped && cbs.selectedCodeBlockSide === "back"
                            ? cbs.selectedCodeBlockIdx
                            : null
                        }
                        exitAllEditTrigger={backExitAllEditTrigger}
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

        <LinksSheet
          visible={showLinksModal}
          onClose={() => setShowLinksModal(false)}
          links={cardLinks}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar hidden={statusBarHidden} />
      <Stack.Screen options={{ headerShown: false }} />
      <TextInput
        key={keyboardInputKey}
        ref={keyboardRef}
        style={styles.hiddenKeyboardInput}
        autoFocus
        caretHidden
        keyboardType="ascii-capable"
        showSoftInputOnFocus={false}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        disableKeyboardShortcuts={true}
        onKeyPress={({ nativeEvent: { key } }) => handleKeyPress(key)}
        onSubmitEditing={() => {
          if (cbs.selectedCodeBlockIdx !== null) cbs.setEditTrigger((v) => v + 1);
        }}
        onBlur={() => {
          setTimeout(() => {
            if (!codeEditingRef.current && isScreenFocusedRef.current)
              keyboardRef.current?.focus();
          }, 50);
        }}
      />
      {(Platform as any).isPad ? (
        <View
          style={{
            height: initialTopInsetRef.current + 44,
            backgroundColor: theme.colors.surface,
          }}
        >
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 44,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 8,
            }}
          >
            <Pressable
              onPress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                paddingHorizontal: 56,
                gap: 4,
              }}
            >
              <Text
                style={{ fontWeight: "600", fontSize: theme.fontSize.lg, color: theme.colors.text, maxWidth: screenWidth * 0.46, flexShrink: 1 }}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {sessionTitle}
              </Text>
              {keyboardShortcutsEnabled && (
                <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
              )}
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
            >
              <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => router.push(`/deck/${currentCard.deckId}/card/${currentCard.id}/edit?tab=${isFlipped ? "back" : "front"}`)}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
            >
              <Ionicons name="pencil-sharp" size={26} color={theme.colors.primary} />
            </Pressable>
            <Pressable
              onPress={handleFinishSession}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
            >
              <Ionicons name="checkmark-done-outline" size={26} color={theme.colors.primary} />
            </Pressable>
          </View>
        </View>
      ) : iPhoneHeader}
      <View
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        {/* プログレスバー */}
        <View
          style={[
            styles.progressBar,
            { backgroundColor: theme.colors.progressBg },
          ]}
        >
          <View
            style={{ flex: progressRatio, backgroundColor: theme.colors.primary }}
          />
          <View style={{ flex: 1 - progressRatio }} />
        </View>
        <View style={styles.progressRow}>
          <View
            style={[
              styles.reviewedBadge,
              { backgroundColor: theme.colors.primary },
            ]}
          >
            <Text
              style={[
                styles.reviewedBadgeText,
                { fontSize: theme.fontSize.sm },
              ]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {result.reviewed}
            </Text>
          </View>
          <Text
            style={[
              styles.progressText,
              { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm },
            ]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}
          >
            {t("study.progress", {
              current: currentIndex + 1,
              total: result.totalCards,
            })}
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
                  <ScrollView
                    ref={frontScrollRef}
                    style={{ flex: 1 }}
                    contentContainerStyle={[styles.faceContent, kbHeight > 0 && { paddingBottom: kbHeight + 20 }]}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    bounces={false}
                    onScroll={(e) => {
                      frontScrollYRef.current = e.nativeEvent.contentOffset.y;
                    }}
                    scrollEventThrottle={16}
                  >
                    <BlocksView
                      key={currentCard.id}
                      blocks={currentCard.frontContent}
                      editableCode
                      editedContents={editedCodeBlocks[currentCard.id]}
                      onCodeBlockChange={(i, text) =>
                        handleCodeBlockChange(currentCard.id, i, text)
                      }
                      onEditFocus={handleCodeEditFocus}
                      onEditBlur={handleCodeEditBlur}
                      onForceKeyboardFocus={handleForceKeyboardFocus}
                      onSelectCodeBlock={makeSelectHandler(null)}
                      runTrigger={!isFlipped ? cbs.runTrigger : undefined}
                      editTrigger={!isFlipped ? cbs.editTrigger : undefined}
                      selectedCodeBlockIdx={
                        !isFlipped ? cbs.selectedCodeBlockIdx : null
                      }
                      scrollRef={frontScrollRef}
                    />
                  </ScrollView>
                }
                back={
                  <ScrollView
                    ref={backScrollRef}
                    style={{ flex: 1 }}
                    contentContainerStyle={[styles.faceContent, kbHeight > 0 && { paddingBottom: kbHeight + 20 }]}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    bounces={false}
                    onScroll={(e) => {
                      backScrollYRef.current = e.nativeEvent.contentOffset.y;
                    }}
                    scrollEventThrottle={16}
                  >
                    <BlocksView
                      key={currentCard.id}
                      blocks={currentCard.backContent}
                      editableCode
                      editedContents={
                        editedCodeBlocks[currentCard.id + "_back"]
                      }
                      onCodeBlockChange={(i, text) =>
                        handleCodeBlockChange(currentCard.id, i, text, "back")
                      }
                      onEditFocus={handleCodeEditFocus}
                      onEditBlur={handleCodeEditBlur}
                      onForceKeyboardFocus={handleForceKeyboardFocus}
                      onSelectCodeBlock={makeSelectHandler('back', 'memo')}
                      runTrigger={
                        isFlipped && cbs.selectedCodeBlockSide === "back"
                          ? cbs.runTrigger
                          : undefined
                      }
                      editTrigger={
                        isFlipped && cbs.selectedCodeBlockSide === "back"
                          ? cbs.editTrigger
                          : undefined
                      }
                      selectedCodeBlockIdx={
                        isFlipped && cbs.selectedCodeBlockSide === "back"
                          ? cbs.selectedCodeBlockIdx
                          : null
                      }
                      exitAllEditTrigger={backExitAllEditTrigger}
                      scrollRef={backScrollRef}
                    />
                    {memoBlock}
                  </ScrollView>
                }
              />
            </FlipSuppressContext.Provider>
          </Animated.View>
        </GestureDetector>

        {/* 全画面ボタン＋リンクボタン（カードエリア左上） */}
        <View style={styles.fullscreenBtnRow}>
          <Pressable
            style={styles.fullscreenBtn}
            onPress={() => {
              codeEditingRef.current = false;
              setIsFullscreen(true);
              cbs.setEditTrigger(0);
              cbs.setRunTrigger(0);
              setTimeout(() => {
                keyboardRef.current?.focus();
              }, 100);
            }}
          >
            <Ionicons
              name="expand-outline"
              size={Math.round(theme.fontSize.xxl)}
              color={theme.colors.iconSubtle}
            />
          </Pressable>
          {cardLinks.length > 0 && (
            <Pressable
              style={styles.fullscreenBtn}
              onPress={() => { Keyboard.dismiss(); setShowLinksModal(true); }}
              accessibilityLabel={t("study.links")}
            >
              <Ionicons
                name="link-sharp"
                size={Math.round(theme.fontSize.xxl)}
                color={theme.colors.iconSubtle}
              />
            </Pressable>
          )}
        </View>

        {/* ヒント or 自己評価ボタン */}
        <View style={styles.bottom}>
          {!isFlipped ? (
            <Pressable
              style={[
                styles.flipHint,
                { backgroundColor: theme.colors.surface },
              ]}
              onPress={() => setIsFlipped(true)}
            >
              <Ionicons
                name="sync-outline"
                size={18}
                color={theme.colors.textTertiary}
              />
              <Text
                style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.md }}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t("study.tapToFlip")}
              </Text>
            </Pressable>
          ) : (
            gradeRow
          )}
        </View>
      </View>

      <LinksSheet
        visible={showLinksModal}
        onClose={() => setShowLinksModal(false)}
        links={cardLinks}
      />

      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        shortcuts={SESSION_SHORTCUTS}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hiddenKeyboardInput: {
    position: "absolute",
    width: 0,
    height: 0,
    opacity: 0,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  progressBar: {
    height: 4,
    flexDirection: "row",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  reviewedBadge: {
    borderRadius: 12,
    minWidth: 28,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignItems: "center",
  },
  reviewedBadgeText: {
    fontWeight: "700",
    color: "#FFF",
  },
  progressText: {
    textAlign: "right",
  },
  cardArea: { flex: 1, paddingHorizontal: 20, paddingVertical: 12 },
  faceContent: { flexGrow: 1, justifyContent: "center", paddingVertical: 8 },
  faceLabel: {
    fontWeight: "700",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  memoSection: { marginTop: 20, gap: 8 },
  memoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 16,
    borderRadius: 12,
  },
  gradeRow: { flexDirection: "row", gap: 8 },
  gradeBtn: {
    flex: 1,
    paddingVertical: (Platform as any).isPad ? 14 : 10,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
  },
  gradeBtnDisabled: { opacity: 0.4 },
  gradeBtnText: { fontWeight: "700" },
  prevGradeDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5 },
  completeScreen: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    paddingVertical: 32,
  },
  completeTitle: { fontWeight: "700" },
  summarySection: {
    width: "100%",
    paddingTop: 20,
    paddingBottom: 16,
  },
  sectionSeparator: {
    height: StyleSheet.hairlineWidth,
  },
  donutContainer: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
  },
  summaryGradeRow: {
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 16,
  },
  gradeItem: {
    flex: 1,
    maxWidth: 80,
    alignItems: "center",
    gap: 2,
  },
  gradeItemCount: { fontWeight: "700" },
  statRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 48,
    paddingTop: 16,
    paddingBottom: 4,
  },
  statItem: {
    alignItems: "center",
    gap: 4,
    minWidth: 80,
  },
  statValue: { fontWeight: "700" },
  backBtn: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  backBtnText: { fontWeight: "700" },
  fullscreenBtnRow: {
    position: "absolute",
    top: 8,
    left: 4,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 10,
  },
  fullscreenBtn: {
    padding: 6,
    borderRadius: 8,
  },
  fullscreenHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 48,
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  fullscreenContent: {
    flexGrow: 1,
    justifyContent: "center",
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

import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
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
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { constants as KeyCommand } from "react-native-key-command";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";

import { ConfirmModal } from "@/components/ConfirmModal";
import { BlocksView } from "@/components/study/BlocksView";
import { FlipCard, type FlipCardRef } from "@/components/study/FlipCard";
import { LinksSheet } from "@/components/study/LinksSheet";
import { ShortcutsModal } from "@/components/study/ShortcutsModal";
import { TagSheet } from "@/components/study/TagSheet";
import { StudyTimer } from "@/components/study/StudyTimer";
import { useCodeBlockSelection } from "@/hooks/useCodeBlockSelection";
import { useStudyTimer } from "@/hooks/useStudyTimer";
import { isRemoteKeyboardEvent } from "@/lib/keyboardEvent";
import { KEY_END, KEY_HOME, KEY_PAGE_DOWN, KEY_PAGE_UP, useKeyCommands } from "@/lib/useKeyCommands";
import { useLockedHeaderHeights } from "@/lib/useLockedTopInset";
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
import { InteractivePreviewContext } from "@/lib/InteractivePreviewContext";
import { getReviewByCardId, getTodayReviewedCount } from "@/lib/database/reviews";
import { shouldFireStudyGoal } from "@/lib/studyGoal";
import { addTagToCard, createTag, getAllTags, getTagsByCardId, removeTagFromCard } from "@/lib/database/tags";
import { cancelTodayGoalReminders, scheduleFromDb, setStudyTimerUiVisible, updateBadgeCount } from "@/lib/notifications";
import type { Grade } from "@/lib/sm2";
import type { Block, Tag } from "@/types";
import { extractLinks } from "@/lib/study/extractLinks";
import { resolveDeckIconColors } from "@/lib/deckIconColors";
import { GRADE_COLORS, useTheme, MAX_FONT_MULTIPLIER, fontSizeForDigits, themedFrameBorder, PRIMARY_COLOR } from "@/lib/theme";
import { resolveTagColor } from "@/lib/tagColors";
import { useDeckStore } from "@/store/decks";
import { useProStore } from "@/store/pro";
import { useReviewStore } from "@/store/reviews";
import { useSettingsStore } from "@/store/settings";
import { useTagStore } from "@/store/tags";

const SCROLL_STEP = 200;
// 画面下の前後ボタンの長押しオートリピート（キーボード長押しに相当）。
// 押下から HOLD_INITIAL_DELAY_MS 後に連続送り開始、以後 HOLD_REPEAT_MS 間隔で送る。
// HOLD_REPEAT_MS は useSwipeGesture の RAPID_WINDOW_MS（200ms）未満にして「連打＝スナップ」に乗せる。
const HOLD_INITIAL_DELAY_MS = 350;
const HOLD_REPEAT_MS = 120;

const GRADES: { grade: Grade; labelKey: string; color: string }[] = [
  { grade: 0, labelKey: "grade.again", color: GRADE_COLORS.again },
  { grade: 1, labelKey: "grade.hard", color: GRADE_COLORS.hard },
  { grade: 2, labelKey: "grade.good", color: GRADE_COLORS.good },
  { grade: 3, labelKey: "grade.easy", color: GRADE_COLORS.easy },
];

const SESSION_SHORTCUT_SECTIONS = [
  { titleKey: "shortcut.catDisplay", items: [
    { key: "Space", descKey: "shortcut.flip" },
    { key: "M", descKey: "shortcut.memo" },
    { key: "F", descKey: "shortcut.fullscreen" },
    { key: "U / D", descKey: "shortcut.scrollUpDown" },
    { key: "⇧U / ⇧D", descKey: "shortcut.scrollTopBottom" },
  ] },
  { titleKey: "shortcut.catFocus", items: [
    { key: "J / K", descKey: "shortcut.focusNextPrev" },
    { key: "R", descKey: "shortcut.runFocused" },
    { key: "E", descKey: "shortcut.editFocusedItem" },
  ] },
  { titleKey: "shortcut.catNavigate", items: [
    { key: ", / .", descKey: "shortcut.nextPrev" },
    { key: "P", descKey: "shortcut.pencil" },
    { key: "Q", descKey: "shortcut.finishSession" },
    { key: "B", descKey: "shortcut.back" },
  ] },
  { titleKey: "shortcut.catAction", items: [
    { key: "1–4", descKey: "shortcut.grade" },
    { key: "T", descKey: "shortcut.cardTags" },
  ] },
  { titleKey: "shortcut.catOther", items: [
    { key: "ESC", descKey: "shortcut.esc" },
    { key: "W", descKey: "shortcut.links" },
    { key: "?", descKey: "shortcut.showShortcuts" },
  ] },
];

export default function StudySessionScreen() {
  const { deckId, tagId, filter, shuffle, order, mode, browse } = useLocalSearchParams<{
    deckId?: string;
    tagId?: string;
    filter?: "all" | "today" | "due" | "unlearned";
    shuffle?: string;
    order?: string;
    mode?: string;
    browse?: string;
  }>();
  // order='1' のとき、順序を厳守する cardIds はストア経由で受け取る（巨大IDをURLに載せない）。
  const cardIdsList = order === '1' ? (useReviewStore.getState().studyCardIds ?? undefined) : undefined;
  const isFocusedReview = mode === 'focused';
  // 閲覧モード（アーカイブ中デッキをカード一覧の2択から開いたときだけ立つ）。
  // 記録を残さない＝グレードボタンを出さず submitGrade を一切呼ばないので、reviews /
  // review_logs / grade_logs のどれにも書き込みが起きない（FSRS も動かない）。
  const browseMode = browse === '1';
  const router = useRouter();
  const navigation = useNavigation();
  function safeBack() {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/study');
    }
  }
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
    shiftCardShownAt,
  } = useStudySession();

  // 034: この画面がフォアグラウンドか（モーダルが上に乗っていないか）を表す ref。
  // 旧 useKeyboardFocus が提供していたものを自前で持つ（kbHeight・ステータスバー制御で使用）。
  const isScreenFocusedRef = useRef(true);
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
      return () => {
        if (statusBarTimerRef.current) {
          clearTimeout(statusBarTimerRef.current);
          statusBarTimerRef.current = null;
        }
        isScreenFocusedRef.current = false;
        setStatusBarHidden(false);
        // コンポーネントのアンマウントとバッチ処理されて StatusBar 再レンダリングが
        // 走らない場合があるため、命令型 API で確実に復元する
        expoSetStatusBarHidden(false, 'fade');
      };
    }, [refreshCurrentCard]),
  );

  const {
    keyboardShortcutsEnabled,
    studyTimerEnabled,
    studyTimerMinutes,
    studyTimerRing,
    studyTimerTime,
    studyTimerEndBehavior,
    studyTimerBreakMinutes,
    studyTimerCycles,
    studyGoalEnabled,
    studyGoalCount,
  } = useSettingsStore();
  const { isPro } = useProStore();
  const { width: screenWidth } = useWindowDimensions();
  // iPad: ステータスバーを隠す際にヘッダー高さが変わらないよう、縮まない top inset を使う
  // （useLockedTopInset は「観測した最大値」を保持するのでフルスクリーンで insets.top=0 でも縮まない）
  const insets = useSafeAreaInsets();
  // 標準ヘッダーと同じ高さ算出（Dynamic Island 補正込み・縮まない inset）。lib/useLockedTopInset.ts 参照。
  const headerHeights = useLockedHeaderHeights();
  const { decks } = useDeckStore();
  const { tags } = useTagStore();
  const sessionDeck = deckId ? decks.find((d) => d.id === deckId) : null;
  // 現在のカードが属するデッキの SQL 初期化の一覧（045・ブロックが deckSqlStageId で1つを選ぶ）。
  // タグ学習ではカードごとにデッキが異なりうるので、カードごとに引き直す。
  const currentDeckSqlStages = currentCard
    ? (decks.find((d) => d.id === currentCard.deckId)?.sqlStages ?? [])
    : [];
  // 現在のカードが属するデッキの HTML/CSS 土台の一覧（044・ブロックが deckStageId で1つを選ぶ）
  const currentDeckHtmlStages = currentCard
    ? (decks.find((d) => d.id === currentCard.deckId)?.htmlStages ?? [])
    : [];
  // 現在のカードが属するデッキの HTML 画像ライブラリ（043・本文/土台の `img://name` の解決に使う）
  const currentDeckHtmlImages = currentCard
    ? decks.find((d) => d.id === currentCard.deckId)?.htmlImages
    : undefined;
  const sessionTitle = isFocusedReview
    ? t("study.focusedReviewTitle")
    : deckId
      ? (sessionDeck?.name ?? t("study.title"))
      : tagId
        ? (tags.find((tg) => tg.id === tagId)?.name ?? t("study.title"))
        : t("study.title");

  const [statusBarHidden, setStatusBarHidden] = useState(false);

  const [isFlipped, setIsFlipped] = useState(false);
  const [showMemo, setShowMemo] = useState(false);

  // カード編集モーダルへ遷移する前に、この画面を非フォアグラウンド扱いにし、ソフトキーボードを閉じる。
  // （isScreenFocusedRef は kbHeight 計算やステータスバー制御の早期化に使う）
  const openCardEdit = useCallback(() => {
    if (!currentCard) return;
    isScreenFocusedRef.current = false;
    Keyboard.dismiss();
    router.push(`/deck/${currentCard.deckId}/card/${currentCard.id}/edit?tab=${showMemo ? 'memo' : isFlipped ? 'back' : 'front'}`);
  }, [currentCard, showMemo, isFlipped, router]);

  const [grading, setGrading] = useState(false);
  const [prevGrade, setPrevGrade] = useState<Grade | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLinksModal, setShowLinksModal] = useState(false);
  const [showTagSheet, setShowTagSheet] = useState(false);
  // 現在カードのタグ（裏面のタグ行に表示）と、シート用の全タグ（開くたびに DB から取得）
  const [cardTags, setCardTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showTimerMenu, setShowTimerMenu] = useState(false);
  const [showTimerEndModal, setShowTimerEndModal] = useState(false);
  // 046: 1日の目標枚数の達成アラート。タイマー終了アラートと同じ ConfirmModal を使う。
  const [showGoalModal, setShowGoalModal] = useState(false);
  // 「セッション開始時点で既に達成済みだったか」。true なら**このセッションでは一切発火しない**
  // （目標は1日単位なので、達成済みの日に新しいセッションを始めた瞬間に出てしまうのを防ぐ）。
  // null = まだ判定していない（初回の集計待ち）。
  const goalMetAtStartRef = useRef<boolean | null>(null);
  // 1セッション1回に制限（「続ける」を選んだ後に再発火しないように）
  const goalFiredRef = useRef(false);
  // 041: コードブロックの全画面インタラクティブプレビュー表示中は背後キー（フリップ/採点/カード送り/戻る）を抑止する。
  const [interactivePreviewOpen, setInteractivePreviewOpen] = useState(false);
  const interactivePreviewCtx = useMemo(() => ({ setOpen: setInteractivePreviewOpen }), []);
  // 時間切れ処理（handleTimerFinish＝useCallback）から最新の開閉状態を読むための ref。
  const showTimerMenuRef = useRef(false);
  showTimerMenuRef.current = showTimerMenu;
  // 046: モーダルの二重表示を避けるための現在値参照（タイマー終了アラートと目標達成アラート）。
  // RN の <Modal> を2枚同時に visible にすると iOS で present/dismiss が重なって VC が wedged になる
  // （画面がフリーズする既知の不具合。タイマー長押しメニューで実際に踏んでいる）。
  const showTimerEndModalRef = useRef(false);
  showTimerEndModalRef.current = showTimerEndModal;
  const showGoalModalRef = useRef(false);
  showGoalModalRef.current = showGoalModal;
  const [kbHeight, setKbHeight] = useState(0);

  // キーボード表示時に paddingBottom を追加してスクロール余白を確保する。
  // Keyboard リスナーはグローバルなので、編集モーダル等でキーボードが出ると裏に居る
  // この画面の kbHeight まで増えてしまい、戻った瞬間に内容が上にズレて見える。
  // この画面がフォーカス中のときだけ kbHeight を増やす（hide は常に 0 で安全側）。
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      if (isRemoteKeyboardEvent(e)) return;
      if (isScreenFocusedRef.current) setKbHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardWillHide', (e) => {
      if (isRemoteKeyboardEvent(e)) return;
      setKbHeight(0);
    });
    return () => { show.remove(); hide.remove(); };
  }, [isScreenFocusedRef]);

  // cardId -> blockIndex -> 編集済みコード
  const [editedCodeBlocks, setEditedCodeBlocks] = useState<
    Record<string, Record<number, string>>
  >({});

  // カード編集画面でカード内容が変更されて戻ってきたら、学習画面のコードブロックの
  // 一時編集（editedCodeBlocks）を破棄して最新内容を即反映する。
  // CodeRunnerView は `editedContent ?? block.content` を表示するため、一時編集が残っていると
  // カード編集での変更が見えない。「同じカードで内容が変わったとき」だけ消すので、
  // 何も変えずに戻った場合は学習画面で打ったコードを保持する。
  const currentCardContentSig = useMemo(
    () =>
      currentCard
        ? JSON.stringify([
            currentCard.frontContent,
            currentCard.backContent,
            currentCard.memoContent,
          ])
        : null,
    [currentCard],
  );
  const prevContentSigRef = useRef<{ id: string; sig: string } | null>(null);
  useEffect(() => {
    if (!currentCard || currentCardContentSig == null) return;
    const prev = prevContentSigRef.current;
    prevContentSigRef.current = { id: currentCard.id, sig: currentCardContentSig };
    if (prev && prev.id === currentCard.id && prev.sig !== currentCardContentSig) {
      const id = currentCard.id;
      setEditedCodeBlocks((p) => {
        if (p[id] == null && p[id + "_back"] == null && p[id + "_memo"] == null) return p;
        const next = { ...p };
        delete next[id];
        delete next[id + "_back"];
        delete next[id + "_memo"];
        return next;
      });
    }
  }, [currentCard, currentCardContentSig]);

  const codeEditingRef = useRef(false);
  const setCodeEditing = (v: boolean) => {
    codeEditingRef.current = v;
  };
  // 別 BlocksView のコードブロックへ編集が移るとき、onEditBlur 側の Keyboard.dismiss() を抑制する
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

  // フルスクリーンモーダル（カード編集など）表示中は、この画面の全画面スワイプ用 PanGesture が
  // 背面に残ったまま新アーキ + RNGH のヒットテストでモーダル下部ボタンのタップを横取りし、
  // 保存/削除が初回タップで反応しなくなる。画面がフォーカスを失っている間は無効化して透過させる。
  const isScreenFocused = useIsFocused();

  // 休憩終了通知（039）のフォアグラウンド表示判定: タイマーUI（リング・ピル・遷移ハプティクス＋
  // ヒント）が実際に見えている間だけバナーを抑制する。編集モーダル中（フォーカス喪失＝リングが
  // 隠れる）や完了画面（リング非表示）は画面内の合図が届かないためバナーを表示する
  // （＝タイマーの suspended 条件の反転と同条件）。
  const timerUiVisible = isScreenFocused && !completed;
  useEffect(() => {
    setStudyTimerUiVisible(timerUiVisible);
    return () => setStudyTimerUiVisible(false);
  }, [timerUiVisible]);

  // 学習タイマー（036）: isPro && studyTimerEnabled ならセッション開始と同時に自動スタート。
  // 状態は store/studyTimer（アプリスコープ）にあり、セッションを跨いで残り時間から継続する。
  // 画面フォーカス喪失（カード編集モーダル等）・完了画面・バックグラウンドでは自動一時停止し、
  // 復帰で再開する（手動 pause とは独立）。時間切れ/手動終了後は次のセッション開始で新規スタート。
  // 039: 繰り返し2回以上なら学習→休憩→学習…のポモドーロ。遷移はハプティクスで知らせる。
  const studyTimerActive = isPro && studyTimerEnabled;
  const handleTimerFinish = useCallback(() => {
    // 'blink' はリング自身の点滅表示のみ（タップで解除）
    if (useSettingsStore.getState().studyTimerEndBehavior !== "alert") return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // 長押しメニュー（ConfirmModal）を開いたまま時間切れになると、終了アラート（別の ConfirmModal）と
    // RN の <Modal> が2枚同時に visible になり、iOS で present/dismiss が重なって VC が wedged になる
    // （閉じたあと画面がフリーズ・タイマー円だけ反応する不具合）。メニューが開いていれば先に閉じ、
    // フェード完了後（~350ms）に終了アラートを出して二重 Modal を構造的に避ける。
    // 046: 目標達成アラートが出ていた場合も同じ理由で先に閉じてから出す（タイマーの通知を優先）
    if (showTimerMenuRef.current || showGoalModalRef.current) {
      setShowTimerMenu(false);
      setShowGoalModal(false);
      setTimeout(() => setShowTimerEndModal(true), 350);
    } else {
      setShowTimerEndModal(true);
    }
  }, []);
  const handleBreakTransition = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);
  const timer = useStudyTimer({
    enabled: studyTimerActive,
    minutes: studyTimerMinutes,
    breakMinutes: studyTimerBreakMinutes,
    cycles: studyTimerCycles,
    suspended: !isScreenFocused || completed,
    onFinish: handleTimerFinish,
    onBreakStart: handleBreakTransition,
    onBreakEnd: handleBreakTransition,
    // 休憩を挟んだカードの responseTimeMs から実休憩時間を除外する（全離脱経路で呼ばれる）
    onBreakElapsed: shiftCardShownAt,
  });
  // ---- 046: 1日の目標枚数 ----------------------------------------------------
  // 目標は**1日単位**（セッション単位ではない）。閲覧モードは submitGrade を通らないので
  // 記録も判定も走らない＝ここで browseMode を除外しておけば無駄なクエリも出ない。
  const goalActive = studyGoalEnabled && !browseMode;

  // セッション開始時点で既に達成済みかを1回だけ確定する。**達成済みならこのセッションでは
  // 一切発火しない**（1日単位ゆえ、達成済みの日に新しいセッションを始めた瞬間に出るのを防ぐ）。
  useEffect(() => {
    // **セッションにつき1回だけ**確定する（すでに確定済みなら何もしない）。学習中に枚数を
    // 数え直して基準を上書きすると、このセッションで積んだぶんまで「開始時点」に含まれてしまい、
    // 達成しても発火しなくなる。基準は「セッションを始めた時点の事実」で固定する。
    if (!goalActive || goalMetAtStartRef.current !== null) return;
    let cancelled = false;
    getTodayReviewedCount(db)
      .then((count) => { if (!cancelled) goalMetAtStartRef.current = count >= studyGoalCount; })
      .catch(() => { /* 取得できなければ未判定のまま＝発火しない（安全側） */ });
    return () => { cancelled = true; };
  }, [goalActive, db, studyGoalCount]);

  /** 評価送信のたびに今日の枚数を数え直し、閾値を「またいだ」ときだけ1回アラートを出す。
   *  **ローカルで +1 しない**：`再考` で戻ってきた同じカードを再評価すると二重に数えてしまい、
   *  実カード枚数を返す getTodayReviewedCount と食い違うため、毎回 DB から引き直す（COUNT 1本）。 */
  const checkStudyGoal = useCallback(async () => {
    if (!goalActive || goalFiredRef.current) return;
    // 基準が未確定（初回クエリが未完了）なら shouldFireStudyGoal が false を返す＝誤発火より不発
    if (goalMetAtStartRef.current === null) return;
    const count = await getTodayReviewedCount(db).catch(() => -1);
    if (!shouldFireStudyGoal(count, studyGoalCount, goalMetAtStartRef.current, goalFiredRef.current)) return;
    goalFiredRef.current = true;
    // 046 Phase 2: 達成した瞬間に今日の未達成リマインダーを取り消す。
    // iOS は発火時に条件を評価できないので、この「達成した瞬間のキャンセル」が条件判定の実体。
    // 学習中はアプリが開いているため確実に効く（明日以降の予約は残す）。
    void cancelTodayGoalReminders();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // タイマー終了アラートが出ているときは譲る（2枚同時に出すと iOS で VC が wedged になる）。
    // goalFiredRef は立てたままなので、後追いで出し直すことはしない＝終了アラート側にも
    // 「学習を完了」があるので操作としては足りている。
    if (showTimerEndModalRef.current) return;
    if (showTimerMenuRef.current) {
      setShowTimerMenu(false);
      setTimeout(() => setShowGoalModal(true), 350);
    } else {
      setShowGoalModal(true);
    }
  }, [goalActive, db, studyGoalCount]);

  const timerBlinking = timer.phase === "finished" && studyTimerEndBehavior === "blink";
  // 休憩中（039）: カード面グレーアウト＋操作無効。ヘッダー（戻る/鉛筆/完了）と
  // タイマー長押しメニュー（スキップ/終了）・Q/B/Esc キーは生かす。
  const onBreak = timer.mode === "break" && timer.phase === "running";
  swipe.panGesture.enabled(isScreenFocused && !onBreak);
  // 円が非表示（ring=start/off）でもマウントはする（開始時の表示→フェードアウトと終了通知は
  // コンポーネント側の ringMode が担当）。カード内上部の余白は円非表示でも確保する
  // （フェードアウト後もゴースト円が常時タップ対象として残るため、1行目右側のボタン類と競合させない）。
  const timerMounted =
    studyTimerActive && !completed && !loading && !!currentCard &&
    (timer.phase === "running" || timer.phase === "paused" || timer.phase === "finished");
  const timerContentPad = timerMounted;
  function handleTimerPress() {
    // 休憩中のタップは無反応（休憩の一時停止は不可＝壁時計ベース。store の togglePause ガードと二重に安全）
    if (onBreak) return;
    if (timer.phase === "finished") { timer.stop(); return; }
    timer.togglePause();
  }
  function handleTimerLongPress() {
    if (timer.phase === "running" || timer.phase === "paused") setShowTimerMenu(true);
  }

  // 画面下ボタンの長押しオートリピート。setInterval は固定クロージャになるため、
  // 常に最新の navigateWithSlide / currentIndex を ref 経由で参照する（毎レンダー更新）。
  const holdTimersRef = useRef<{ delay?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> }>({});
  const pressNavigatedRef = useRef(false);
  const curIdxRef = useRef(currentIndex);
  curIdxRef.current = currentIndex;
  const navigateRef = useRef(swipe.navigateWithSlide);
  navigateRef.current = swipe.navigateWithSlide;

  const stopHold = useCallback(() => {
    const t = holdTimersRef.current;
    if (t.delay) clearTimeout(t.delay);
    if (t.interval) clearInterval(t.interval);
    holdTimersRef.current = {};
  }, []);

  const startHold = useCallback((direction: "next" | "prev") => {
    stopHold();
    pressNavigatedRef.current = true;
    navigateRef.current(direction); // 押した瞬間に1枚（単発＝スライド）
    holdTimersRef.current.delay = setTimeout(() => {
      holdTimersRef.current.interval = setInterval(() => {
        navigateRef.current(direction); // 連続送り（RAPID_WINDOW 内＝スナップでパラパラ）
      }, HOLD_REPEAT_MS);
    }, HOLD_INITIAL_DELAY_MS);
  }, [stopHold]);

  // セッション完了時・アンマウント時にリピートを必ず止める（指を離せず button がアンマウントされても安全）
  useEffect(() => {
    if (completed) stopHold();
    return stopHold;
  }, [completed, stopHold]);

  const handleFlip = useCallback(() => setIsFlipped((v) => !v), []);
  const handleToggleMemo = useCallback(() => setShowMemo((v) => !v), []);

  // BlocksView 共通ハンドラ
  const handleCodeEditFocus = useCallback(() => {
    setCodeEditing(true);
  }, []);
  // メモ欄専用: 編集開始時にキーボード表示後、裏面 ScrollView を末尾へスクロール
  const handleMemoCodeEditFocus = useCallback(() => {
    setCodeEditing(true);
    setTimeout(() => {
      backScrollRef.current?.scrollToEnd({ animated: true });
    }, 350);
  }, []);
  const handleCodeEditBlur = useCallback(() => {
    setCodeEditing(false);
    // 034: ネイティブキーコマンドは画面フォーカス中ずっと有効なので、編集終了後に
    // 隠し input を再フォーカスする必要はない。ソフトキーボードだけ確実に閉じる。
    if (!switchingCodeBlockRef.current && isScreenFocusedRef.current) {
      Keyboard.dismiss();
    }
  }, []);
  // 実行ボタン経由での編集終了時に呼ぶ。
  const handleForceKeyboardFocus = useCallback(() => {
    setCodeEditing(false);
    if (isScreenFocusedRef.current) {
      Keyboard.dismiss();
    }
  }, []);
  const handleCodeRunComplete = useCallback(() => {
    // WebView 実行完了直後に iOS がネイティブレベルでステータスバー状態を
    // 変化させる場合があるため、hidden=true を命令型 API で再アサートする
    if (isScreenFocusedRef.current) {
      expoSetStatusBarHidden(true, 'none');
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
    loadSession({ deckId, tagId, cardIds: cardIdsList, filter, shuffle: shuffle === "1" });
    // cardIdsList はストア由来の派生値のため deps には order を入れる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, tagId, order, filter, shuffle]);

  useEffect(() => {
    if (completed) {
      updateBadgeCount(db).catch(() => {});
      // 046 Phase 2: 未達成リマインダーは日付指定の前倒し予約なので、学習した結果を反映して
      // 積み直す（達成していれば今日の分が落ち、未達成なら残る）。予約が尽きないための補充も兼ねる。
      scheduleFromDb(db).catch(() => {});
    }
  }, [completed, db]);

  useEffect(() => {
    if (completed) {
      setEditedCodeBlocks({});
    }
  }, [completed]);

  // 閲覧モードは評価も記録も無いため集計画面に出すものが無い。最後まで送った／Q で終えた時点で
  // カード一覧へ戻すだけにする（completed の集計画面は描画しない）。
  useEffect(() => {
    if (browseMode && completed) safeBack();
    // safeBack は毎レンダー再生成される単純な関数なので deps から除く
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseMode, completed]);

  // 新しいカードに移ったらフリップ・メモをリセット、スライドイン開始
  useEffect(() => {
    swipe.applySlideIn(screenWidth);
    swipe.currentIndexSV.value = currentIndex;
    setIsFlipped(false);
    setShowMemo(false);
    setShowTagSheet(false);
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

  // カードが切り替わったら現在カードのタグを取得（裏面のタグ行に表示）
  useEffect(() => {
    if (!currentCard) { setCardTags([]); return; }
    getTagsByCardId(db, currentCard.id).then(setCardTags);
  }, [currentCard?.id]);

  // カード編集モーダルでタグを変更して戻ったとき即反映するため、フォーカス復帰時にも取り直す
  // （本文の refreshCurrentCard と同じタイミング）。currentCard を deps に入れると
  // カード切替でも再実行されてしまうため ref 経由で読む。
  const currentCardIdRef = useRef<string | null>(null);
  currentCardIdRef.current = currentCard?.id ?? null;
  useFocusEffect(
    useCallback(() => {
      const id = currentCardIdRef.current;
      if (id) getTagsByCardId(db, id).then(setCardTags);
    }, [db]),
  );

  // タグシートの開閉トグル（タグ行タップ / T キー）。開くたびに全タグを取り直す
  // （タグ管理での作成・改名・並べ替えを反映するため）。
  const handleToggleTagSheet = useCallback(() => {
    if (!currentCard) return;
    if (showTagSheet) { setShowTagSheet(false); return; }
    Keyboard.dismiss();
    getAllTags(db).then((rows) => { setAllTags(rows); setShowTagSheet(true); });
  }, [currentCard, showTagSheet, db]);

  // タグの付け外し（即保存）。書き込み後に取り直して表示とDBを一致させる
  const handleToggleCardTag = useCallback(async (tagId: string) => {
    if (!currentCard) return;
    const has = cardTags.some((tg) => tg.id === tagId);
    if (has) await removeTagFromCard(db, currentCard.id, tagId);
    else await addTagToCard(db, currentCard.id, tagId);
    setCardTags(await getTagsByCardId(db, currentCard.id));
  }, [currentCard, cardTags, db]);

  // タグシートからのインライン新規作成：既定色（タグ新規画面と同じ青）で作成し、
  // そのまま現在カードに付与する。重複名はタグ新規画面と同じく作成しない。
  const handleCreateTag = useCallback(async (name: string): Promise<'ok' | 'duplicate'> => {
    if (!currentCard) return 'ok';
    if (allTags.some((tg) => tg.name === name)) return 'duplicate';
    const tag = await createTag(db, { name, color: PRIMARY_COLOR });
    await addTagToCard(db, currentCard.id, tag.id);
    // タグ管理・検索などが使うストアのキャッシュにも反映（このカードに付与済み＝cardCount 1）
    useTagStore.getState().addTag({ ...tag, cardCount: 1 });
    setAllTags((prev) => [...prev, tag]);
    setCardTags(await getTagsByCardId(db, currentCard.id));
    return 'ok';
  }, [currentCard, allTags, db]);

  // フリップ時にメモ・タグシートを隠し、コードブロック選択をリセット
  useEffect(() => {
    if (!isFlipped) { setShowMemo(false); setShowTagSheet(false); }
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
    // 学習中（カード表示中）以外ではショートカットを無効化する。
    // ネイティブキーコマンドは完了画面/ロード中でも登録されたままのため明示的に弾く。
    if (completed || !currentCard) return;
    // 休憩中（039）はカード操作系のキーを無効化する（状態依存ガード方式・034 の慣習）。
    // Q（セッション終了）と B（戻る）はヘッダー活性の方針と揃えて許可。
    if (onBreak && key.toLowerCase() !== "q" && key.toLowerCase() !== "b") return;

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
    } else if (key.toLowerCase() === "t") {
      if (isFlipped) handleToggleTagSheet();
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
    } else if (key === "home") {
      const ref = isFlipped ? backScrollRef : frontScrollRef;
      ref.current?.scrollTo({ y: 0, animated: true });
    } else if (key === "end") {
      const ref = isFlipped ? backScrollRef : frontScrollRef;
      ref.current?.scrollToEnd({ animated: true });
    } else if (key.toLowerCase() === "q") {
      // 閲覧モードは集計画面が無いので「終了＝戻る」（確認も不要＝スキップする評価が無い）
      if (browseMode) safeBack();
      else handleFinishSession();
    } else if (key.toLowerCase() === "b") {
      safeBack();
    } else if (key.toLowerCase() === "w") {
      if (cardLinks.length > 0) { Keyboard.dismiss(); setShowLinksModal((v) => !v); }
    } else if (key.toLowerCase() === "p") {
      openCardEdit();
    } else if (isFlipped && !grading && !browseMode) {
      if (key === "1") handleGradeWithSlide(0);
      else if (key === "2") handleGradeWithSlide(1);
      else if (key === "3") handleGradeWithSlide(2);
      else if (key === "4") handleGradeWithSlide(3);
    }
  }

  function handleFinishSession() {
    setShowFinishModal(true);
  }

  // 閲覧モードでは 1–4（グレード）が無いので一覧からも落とす（他キーは同じ）
  const shortcutSections = SESSION_SHORTCUT_SECTIONS.map((s) => ({
    title: t(s.titleKey),
    items: browseMode ? s.items.filter((it) => it.descKey !== "shortcut.grade") : s.items,
  })).filter((s) => s.items.length > 0);

  async function handleGrade(grade: Grade) {
    if (grading) return;
    setGrading(true);
    await submitGrade(grade);
    setGrading(false);
    // 046: 記録が確定した後に今日の枚数を数え直して目標達成を判定する
    void checkStudyGoal();
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

  // 034: 隠し TextInput（3つ）を撤去しネイティブキーコマンドへ。
  // 既存の handleKeyPress(key) ディスパッチはそのまま流用し、各キーから呼び出す。
  // ★矢印・Tab はこの画面では登録しない。理由: iPad は keyCommands をキャッシュするため、矢印を
  //   優先付きで登録すると編集中もキャッシュが“ただの矢印”を奪い続け、入力欄にカーソル移動が届かない。
  //   「最初から登録しない」ことで、コードブロック編集中は矢印=カーソル移動が常に効く。
  //   ナビは J/K（コードブロック巡回）・,/.（前後カード）で行う。
  // Return: 完了画面では戻る、それ以外は選択中コードブロックを編集開始（旧 onSubmitEditing）。
  useKeyCommands([
    { input: " ", handler: () => handleKeyPress(" ") },
    { input: "j", handler: () => handleKeyPress("j") },
    { input: "k", handler: () => handleKeyPress("k") },
    { input: "r", handler: () => handleKeyPress("r") },
    { input: ".", handler: () => handleKeyPress(".") },
    { input: ",", handler: () => handleKeyPress(",") },
    { input: "m", handler: () => handleKeyPress("m") },
    { input: "f", handler: () => handleKeyPress("f") },
    { input: "e", handler: () => handleKeyPress("e") },
    { input: "u", handler: () => handleKeyPress("u") },
    { input: "d", handler: () => handleKeyPress("d") },
    // フルキーボードの PageUp/PageDown も画面スクロールに割り当て（U/D と同じ）。
    { input: KEY_PAGE_UP, handler: () => handleKeyPress("u") },
    { input: KEY_PAGE_DOWN, handler: () => handleKeyPress("d") },
    // Home/End で最上部・最下部へ一気にスクロール。
    { input: KEY_HOME, handler: () => handleKeyPress("home") },
    { input: KEY_END, handler: () => handleKeyPress("end") },
    // Home/End の無いキーボード向け：Shift+U=最上部 / Shift+D=最下部。
    { input: "u", modifierFlags: KeyCommand.keyModifierShift, handler: () => handleKeyPress("home") },
    { input: "d", modifierFlags: KeyCommand.keyModifierShift, handler: () => handleKeyPress("end") },
    { input: "q", handler: () => handleKeyPress("q") },
    { input: "b", handler: () => handleKeyPress("b") },
    // H/L でもカード送り（,/. と同じ。iPad は矢印未登録なので H/L が左右ナビになる）。
    { input: "h", handler: () => handleKeyPress(",") },
    { input: "l", handler: () => handleKeyPress(".") },
    { input: "w", handler: () => handleKeyPress("w") },
    { input: "t", handler: () => handleKeyPress("t") },
    { input: "p", handler: () => handleKeyPress("p") },
    { input: "1", handler: () => handleKeyPress("1") },
    { input: "2", handler: () => handleKeyPress("2") },
    { input: "3", handler: () => handleKeyPress("3") },
    { input: "4", handler: () => handleKeyPress("4") },
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (completed) { safeBack(); return; }
        if (!currentCard) return;
        if (onBreak) return;
        if (cbs.selectedCodeBlockIdx !== null) cbs.setEditTrigger((v) => v + 1);
      },
    },
    // 矢印は iPhone のみ登録（上下=K/J コードブロック巡回、左右=,/. 前後カード）。iPad は登録しない＝
    // コードブロック編集中のカーソル移動を優先（iPhone はフォーカスエンジンが無く両立する）。
    ...(((Platform as any).isPad ? [] : [
      { input: KeyCommand.keyInputUpArrow, handler: () => handleKeyPress("k") },
      { input: KeyCommand.keyInputDownArrow, handler: () => handleKeyPress("j") },
      { input: KeyCommand.keyInputLeftArrow, handler: () => handleKeyPress(",") },
      { input: KeyCommand.keyInputRightArrow, handler: () => handleKeyPress(".") },
    ]) as { input: string; handler: () => void }[]),
    // ?（Shift+/）= ショートカット一覧を開く（閉じる/トグルは ShortcutsModal 側が担当）
    { input: '/', modifierFlags: KeyCommand.keyModifierShift, handler: () => setShowShortcutsModal((v) => !v) },
  // リンク一覧/タグシート/終了確認/ショートカット一覧/タイマー系モーダルの表示中は背景のショートカットを解除する
  // （アラート背後で ,/.・P・Space 等が効かないように。LinksSheet/TagSheet/専用 Return は別フックが担当）。
  // タイマー終了/メニューは確定操作を含むため Return は割り当てない（タップ/Esc のみ）。
  ], !showLinksModal && !showTagSheet && !showFinishModal && !showShortcutsModal && !showTimerEndModal && !showGoalModal && !showTimerMenu && !interactivePreviewOpen);

  // ESC は編集中も含めて常時有効（編集解除／モーダル閉じ／全画面解除／戻る）。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        // 041: 全画面インタラクティブプレビュー表示中はモーダル自身の Esc が閉じる担当。
        // ここで処理を進めると最後に safeBack() が走り学習セッションごと抜けてしまうため最優先で return。
        if (interactivePreviewOpen) return;
        if (completed) { safeBack(); return; }
        // コードブロック編集中は編集解除を最優先（実入力欄を blur すると onEditBlur が走る）。
        if (codeEditingRef.current) { Keyboard.dismiss(); return; }
        if (showLinksModal) { setShowLinksModal(false); return; }
        // タグシートの Esc はシート側が担当（新規作成中=キャンセル/それ以外=閉じる の二段階のため）
        if (showTagSheet) return;
        if (showFinishModal) { setShowFinishModal(false); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
        if (showTimerEndModal) { setShowTimerEndModal(false); timer.stop(); return; }
        if (showGoalModal) { setShowGoalModal(false); return; }
        if (showTimerMenu) { setShowTimerMenu(false); return; }
        if (isFullscreen) {
          setCodeEditing(false);
          setIsFullscreen(false);
          cbs.setEditTrigger(0);
          cbs.setRunTrigger(0);
          return;
        }
        safeBack();
      },
    },
  ]);

  // 終了確認/ショートカット一覧（OK のみのアラート）表示中の Return = OK。
  // active ゲートで「アラート表示中のみ」登録（main は同時に解除されているので Return 重複しない）。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (showFinishModal) { setShowFinishModal(false); finishSession(); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
      },
    },
  ], showFinishModal || showShortcutsModal);

  // iPhone 用インラインカスタムヘッダー（headerShown:false のため全状態で共通利用）
  const iPhoneHeader = !(Platform as any).isPad ? (
    <View style={{ height: headerHeights.total, backgroundColor: theme.baseSurface }}>
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: headerHeights.content,
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
          {/* 閲覧モード（記録なし）の目印。グレードボタンが出ないことと合わせて状態を示す */}
          {browseMode && (
            <Ionicons
              name="eye-outline"
              size={20}
              color={theme.colors.textSecondary}
              accessibilityLabel={t("study.browseMode")}
            />
          )}
          {sessionDeck?.iconName && (
            <Ionicons
              name={sessionDeck.iconName as any}
              size={20}
              color={resolveDeckIconColors(sessionDeck.colorHex, theme).color}
            />
          )}
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
        {!completed && !loading ? (
          <Pressable
            onPress={() => safeBack()}
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
              onPress={openCardEdit}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
            >
              <Ionicons name="pencil-sharp" size={26} color={theme.colors.primary} />
            </Pressable>
            {/* 閲覧モードは集計画面が無く「終了＝戻る」なので、戻るボタンと重複する ✓ は出さない */}
            {!browseMode && (
              <Pressable
                onPress={handleFinishSession}
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
                hitSlop={4}
              >
                <Ionicons name="checkmark-done-outline" size={26} color={theme.colors.primary} />
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  ) : null;

  if (loading) {
    return (
      <>
        <StatusBar hidden={statusBarHidden} style={theme.dark ? 'light' : 'dark'} />
        {iPhoneHeader}
        <View style={[styles.center, { backgroundColor: theme.baseBackground }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </>
    );
  }

  // 閲覧モードの完了：集計画面を持たないので、戻る（上の effect）までヘッダーだけ出しておく。
  // null を返すと 1 フレーム白く抜けるため loading と同じ形にする。
  if (completed && browseMode) {
    return (
      <>
        <StatusBar hidden={statusBarHidden} style={theme.dark ? 'light' : 'dark'} />
        {iPhoneHeader}
        <View style={[styles.center, { backgroundColor: theme.baseBackground }]} />
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
    const gradeMaxCountDigits = Math.max(...gradeItems.map(g => String(g.count).length));
    const gradeCountFontSize = fontSizeForDigits(theme, gradeMaxCountDigits, 1.2);
    const gradeMaxLabelLen = Math.max(...gradeItems.map(g => g.key.length));
    const gradeLabelFontSize = gradeMaxLabelLen >= 3 ? theme.fontSize.xs : theme.fontSize.sm;
    const reviewRate =
      totalCards > 0 ? Math.round((reviewed / totalCards) * 100) : 0;
    // 正答率はカード統計（grade >= 2 = good/easy のみ正答）と定義を揃える。
    // again（再考）に加えて hard（苦手）も誤答扱い。
    const correctRate =
      reviewed > 0 ? Math.round(((good + easy) / reviewed) * 100) : 0;
    const nextReviewDiffDays = result.earliestNextReview
      ? (() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const target = new Date(result.earliestNextReview.slice(0, 10));
          target.setHours(0, 0, 0, 0);
          return Math.round((target.getTime() - today.getTime()) / 86400000);
        })()
      : null;
    const nextReviewValue = nextReviewDiffDays === null ? null
      : nextReviewDiffDays <= 0 ? t("stats.nextReviewToday")
      : nextReviewDiffDays === 1 ? t("stats.nextReviewTomorrow")
      : String(nextReviewDiffDays);
    const nextReviewUnit = nextReviewDiffDays !== null && nextReviewDiffDays > 1
      ? t("stats.unitDaysLater")
      : '';

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
        <StatusBar hidden={statusBarHidden} style={theme.dark ? 'light' : 'dark'} />
        <Stack.Screen options={{ headerShown: false }} />
        {(Platform as any).isPad ? (
          <View
            style={{
              height: headerHeights.total,
              backgroundColor: theme.baseSurface,
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
          style={{ flex: 1, backgroundColor: theme.cardTheme.background }}
          contentContainerStyle={styles.completeScreen}
          bounces={false}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="checkmark-circle" size={32} color="#43A047" />
            <Text
              style={[styles.completeTitle, { color: theme.colors.text, fontSize: theme.fontSize.xl }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t("study.complete")}
            </Text>
          </View>
          {reviewed > 0 && (
            <View
              style={[
                styles.summarySection,
                { backgroundColor: theme.baseSurface },
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
                    fill={theme.baseSurface}
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
                        { color, fontSize: gradeCountFontSize },
                      ]}
                      allowFontScaling={false}
                      numberOfLines={1}
                    >
                      {count}
                    </Text>
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: gradeLabelFontSize,
                        fontWeight: '600',
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

              {/* 正答率・次回予定・平均回答時間 */}
              <View style={styles.statRow}>
                <View style={styles.statItem}>
                  <Text
                    style={[styles.statValue, { color: theme.colors.text, fontSize: theme.fontSize.xl }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {correctRate}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {t("stats.correctRate")}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {t("stats.unitPercent")}
                  </Text>
                </View>
                {nextReviewValue != null && (
                  <View style={styles.statItem}>
                    <Text
                      style={[styles.statValue, { color: theme.colors.text, fontSize: theme.fontSize.xl }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                    >
                      {nextReviewValue}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {t("stats.nextReview")}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {nextReviewUnit}
                    </Text>
                  </View>
                )}
                {result.avgResponseTimeMs != null && (
                  <View style={styles.statItem}>
                    <Text
                      style={[styles.statValue, { color: theme.colors.text, fontSize: theme.fontSize.xl }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                    >
                      {(result.avgResponseTimeMs / 1000).toFixed(1)}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {t("stats.avgResponseTime")}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {t("stats.unitSeconds")}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: theme.colors.primary }]}
            onPress={() => safeBack()}
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
        <StatusBar hidden={statusBarHidden} style={theme.dark ? 'light' : 'dark'} />
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
              backgroundColor: theme.cardTheme.memoBackground,
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
            onCodeRunStart={handleCodeRunComplete}
            exitAllEditTrigger={memoExitAllEditTrigger}
            scrollRef={backScrollRef}
            scrollBaseYRef={memoScrollBaseYRef}
            deckSqlStages={currentDeckSqlStages} deckHtmlStages={currentDeckHtmlStages} deckHtmlImages={currentDeckHtmlImages}
          />
        </View>
      )}
    </View>
  );

  // 裏面のタグ行：現在タグをチップで常時表示し、タップ（/ T キー）でタグシートを開く。
  // onTouchStart={suppress} でカードフリップへの伝播を防ぐ（memoToggle と同じ）。
  const tagRow = (
    <Pressable
      style={styles.tagRow}
      onPress={handleToggleTagSheet}
      onTouchStart={suppress}
      accessibilityLabel={t("study.cardTags")}
    >
      <Ionicons name="pricetag-outline" size={16} color={theme.colors.textTertiary} />
      {cardTags.length === 0 ? (
        <Text
          style={{ color: theme.colors.textTertiary }}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
        >
          {t("study.cardTags")}
        </Text>
      ) : (
        cardTags.map((tg) => {
          // テーマ追従（__theme__）等のセンチネル色を実色に解決し、背景に溶ける色は枠線で縁取る
          const tagColor = resolveTagColor(tg.color, theme);
          const blends = tagColor === theme.colors.background;
          return (
            <View key={tg.id} style={[styles.tagChip, { borderColor: theme.colors.inputBorder }]}>
              <View style={[styles.tagDot, { backgroundColor: tagColor }, blends && { borderWidth: 1, borderColor: themedFrameBorder(theme) }]} />
              <Text
                style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}
              >
                {tg.name}
              </Text>
            </View>
          );
        })
      )}
    </Pressable>
  );

  const gradeRow = (
    <View style={styles.gradeRow}>
      {GRADES.map(({ grade, labelKey, color }) => (
        <TouchableOpacity
          key={grade}
          style={[
            styles.gradeBtn,
            { borderColor: color, backgroundColor: theme.baseSurface },
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
              { color, fontSize: theme.fontSize.lg },
            ]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}
          >
            {t(labelKey)}
          </Text>
          <View style={[styles.prevGradeDot, { backgroundColor: prevGrade === grade ? color : 'transparent' }]} />
        </TouchableOpacity>
      ))}
    </View>
  );

  // タイマーの長押しメニューと終了アラート（通常/全画面の両モードで描画する。
  // 全画面に置かないと、gate オフのままモーダルが出ず操作不能になる＝? / Q モーダルと同じ理由）。
  // 終了アラートは確定操作なので Return は割り当てない（タップ/Esc のみ・既存慣習）。
  const timerModals = (
    <>
      <ConfirmModal
        visible={showTimerMenu}
        title={t("study.timerMenuTitle")}
        message={t("study.timerMenuMessage")}
        actions={onBreak ? [
          // 休憩中の長押しメニュー: スキップ（次の学習へ）と終了の2択（039）
          { label: t("study.timerSkipBreak"), onPress: () => { setShowTimerMenu(false); timer.skipBreak(); } },
          { label: t("study.timerStop"), onPress: () => { setShowTimerMenu(false); timer.stop(); } },
        ] : [
          { label: t("study.timerRestart"), onPress: () => { setShowTimerMenu(false); timer.restart(); } },
          { label: t("study.timerStop"), onPress: () => { setShowTimerMenu(false); timer.stop(); } },
        ]}
        onClose={() => setShowTimerMenu(false)}
      />
      <ConfirmModal
        visible={showTimerEndModal}
        title={t(timer.cycleCount > 1 ? "study.timerPomodoroEndTitle" : "study.timerEndTitle")}
        message={t(timer.cycleCount > 1 ? "study.timerPomodoroEndMessage" : "study.timerEndMessage")}
        actions={[
          // 「続ける」＝タイマーを設定分数で再スタート（もう1周・ポモドーロは全サイクルをサイクル1から）。
          // タイマー無しで続けたい場合は Esc/背景タップ（onClose）で閉じる＝stop のまま
          { label: t("study.timerContinue"), onPress: () => { setShowTimerEndModal(false); timer.restart(); } },
          { label: t("study.timerFinish"), onPress: () => { setShowTimerEndModal(false); finishSession(); } },
        ]}
        onClose={() => { setShowTimerEndModal(false); timer.stop(); }}
      />
      {/* 046: 1日の目標枚数の達成アラート。目標は上限ではなく目安なので「続ける」を必ず用意する
          （閉じた後は goalFiredRef により、このセッションでは再発火しない）。 */}
      <ConfirmModal
        visible={showGoalModal}
        title={t("study.goalReachedTitle")}
        message={t("study.goalReachedMessage", { count: studyGoalCount })}
        actions={[
          { label: t("study.goalContinue"), onPress: () => setShowGoalModal(false) },
          { label: t("study.timerFinish"), onPress: () => { setShowGoalModal(false); finishSession(); } },
        ]}
        onClose={() => setShowGoalModal(false)}
      />
    </>
  );

  if (isFullscreen) {
    return (
      <>
        <StatusBar hidden={statusBarHidden} style={theme.dark ? 'light' : 'dark'} />
        <Stack.Screen
          options={{
            title: t("study.title"),
            headerBackTitle: "",
            headerShown: false,
          }}
        />
        <View
          style={[styles.container, { backgroundColor: theme.cardTheme.background }]}
        >
          {/* ヘッダー行（実体あり、スクロール外）。休憩中はオーバーレイより上に残す
              （戻る/リンク/鉛筆/完了は休憩中も活性＝離脱を塞がない方針・039） */}
          <View style={[styles.fullscreenHeader, onBreak && { zIndex: 30 }]}>
            <Pressable
              style={styles.fullscreenExitBtn}
              onPress={() => {
                setCodeEditing(false);
                setIsFullscreen(false);
                cbs.setEditTrigger(0);
                cbs.setRunTrigger(0);
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
              onPress={openCardEdit}
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

          {/* 進捗バー（ヘッダーとカードの境界線を兼ねる極細バー） */}
          <View
            style={[
              styles.fullscreenProgressBar,
              { backgroundColor: theme.cardTheme.border },
            ]}
          >
            <View
              style={{ flex: progressRatio, backgroundColor: theme.colors.primary }}
            />
            <View style={{ flex: 1 - progressRatio }} />
          </View>

          {/* コンテンツエリア */}
          <GestureDetector gesture={swipe.panGesture}>
            <Animated.View style={[{ flex: 1 }, swipe.cardAnimStyle]}>
              <InteractivePreviewContext.Provider value={interactivePreviewCtx}><FlipSuppressContext.Provider value={{ suppress, suppressedRef }}>
                <FlipCard
                  ref={flipCardRef}
                  isFlipped={isFlipped}
                  onFlip={handleFlip}
                  cardStyle={{
                    borderRadius: 0,
                    borderWidth: 0,
                    shadowOpacity: 0,
                    elevation: 0,
                  }}
                  innerStyle={{ padding: 0, justifyContent: "flex-start" }}
                  front={
                    <ScrollView
                      ref={frontScrollRef}
                      style={{ flex: 1 }}
                      // 表面は下部左右隅のフローティングボタンが常に出るので、最下部の文字が
                      // 隠れないよう（ボタン高さ＋余白＋safe area 分）下に多めにスクロールできるようにする。
                      contentContainerStyle={[styles.fullscreenContent, timerContentPad && styles.fullscreenContentTimerPad, { paddingBottom: insets.bottom + 88 }, kbHeight > 0 && { paddingBottom: kbHeight + 20 }]}
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
                        onCodeRunStart={handleCodeRunComplete}
                        scrollRef={frontScrollRef}
                        deckSqlStages={currentDeckSqlStages} deckHtmlStages={currentDeckHtmlStages} deckHtmlImages={currentDeckHtmlImages}
                      />
                    </ScrollView>
                  }
                  back={
                    <ScrollView
                      ref={backScrollRef}
                      style={{ flex: 1 }}
                      contentContainerStyle={[styles.fullscreenContent, timerContentPad && styles.fullscreenContentTimerPad, kbHeight > 0 && { paddingBottom: kbHeight + 20 }]}
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
                        onCodeRunStart={handleCodeRunComplete}
                        exitAllEditTrigger={backExitAllEditTrigger}
                        scrollRef={backScrollRef}
                        deckSqlStages={currentDeckSqlStages} deckHtmlStages={currentDeckHtmlStages} deckHtmlImages={currentDeckHtmlImages}
                      />
                      {memoBlock}
                      {tagRow}
                    </ScrollView>
                  }
                />
              </FlipSuppressContext.Provider></InteractivePreviewContext.Provider>
            </Animated.View>
          </GestureDetector>

          {/* 休憩中: カード面＋下部操作列を覆うグレーアウト（タッチ吸収）。
              タイマー（zIndex 20）とヘッダー（zIndex 30）だけ上に残す（039） */}
          {onBreak && (
            <View
              pointerEvents="auto"
              style={[styles.breakOverlay, { backgroundColor: theme.dark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.6)" }]}
            />
          )}

          {/* 学習タイマー（全画面モードでも右上に表示） */}
          {timerMounted && (
            <StudyTimer
              phase={timer.phase}
              remainingMs={timer.remainingMs}
              totalMs={timer.totalMs}
              counting={timer.counting}
              epoch={timer.epoch}
              timeMode={studyTimerTime}
              blinking={timerBlinking}
              ringMode={studyTimerRing}
              breakMode={onBreak}
              cycleIndex={timer.cycleIndex}
              cycleCount={timer.cycleCount}
              forceVisible={showTimerMenu}
              onPress={handleTimerPress}
              onLongPress={handleTimerLongPress}
              style={styles.timerFloatingFullscreen}
            />
          )}

          {isFlipped && !browseMode && <View style={styles.bottom}>{gradeRow}</View>}

          {/* 表面のみ：下部左右隅にフローティングの前後送りボタン（通常モードと同形状・配色）。
              閲覧モードは評価が無いので裏面でも前後送りを出したままにする。 */}
          {(!isFlipped || browseMode) && (
            <>
              <Pressable
                style={[styles.navFab, styles.navFabFloating, { left: 20, bottom: insets.bottom + 16, backgroundColor: theme.cardTheme.background, borderColor: theme.cardTheme.border }]}
                onPressIn={() => {
                  pressNavigatedRef.current = false;
                  if (curIdxRef.current > 0) startHold("prev");
                }}
                onPressOut={stopHold}
                onPress={() => { if (curIdxRef.current === 0 && !pressNavigatedRef.current) safeBack(); }}
                hitSlop={8}
              >
                <Ionicons
                  name="chevron-back"
                  size={24}
                  color={currentIndex === 0 ? theme.colors.primary : theme.colors.textTertiary}
                />
              </Pressable>
              <Pressable
                style={[styles.navFab, styles.navFabFloating, { right: 20, bottom: insets.bottom + 16, backgroundColor: theme.cardTheme.background, borderColor: theme.cardTheme.border }]}
                onPressIn={() => startHold("next")}
                onPressOut={stopHold}
                hitSlop={8}
              >
                <Ionicons
                  name="chevron-forward"
                  size={24}
                  color={currentIndex >= result.totalCards - 1 ? theme.colors.primary : theme.colors.textTertiary}
                />
              </Pressable>
            </>
          )}
        </View>

        <LinksSheet
          visible={showLinksModal}
          onClose={() => setShowLinksModal(false)}
          links={cardLinks}
        />
        <TagSheet
          visible={showTagSheet}
          onClose={() => setShowTagSheet(false)}
          tags={allTags}
          selectedIds={cardTags.map((tg) => tg.id)}
          onToggle={handleToggleCardTag}
          onCreateTag={handleCreateTag}
        />
        {/* 全画面モードでも ? / Q のモーダルを描画する（通常モードの末尾と同一）。
            これが無いと全画面で Q を押しても ConfirmModal が描画されず、
            showFinishModal=true でメインキーが gate オフになったまま操作不能になる。 */}
        <ShortcutsModal
          visible={showShortcutsModal}
          onClose={() => setShowShortcutsModal(false)}
          sections={shortcutSections}
        />
        <ConfirmModal
          visible={showFinishModal}
          title={t("study.finishConfirmTitle")}
          message={t("study.finishConfirmMessage", { count: result.totalCards - result.reviewed })}
          actions={[
            { label: t("common.ok"), onPress: () => { setShowFinishModal(false); finishSession(); } },
          ]}
          onClose={() => setShowFinishModal(false)}
        />
        {timerModals}
      </>
    );
  }

  return (
    <>
      <StatusBar hidden={statusBarHidden} style={theme.dark ? 'light' : 'dark'} />
      <Stack.Screen options={{ headerShown: false }} />
      {(Platform as any).isPad ? (
        <View
          style={{
            height: headerHeights.total,
            backgroundColor: theme.baseSurface,
          }}
        >
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: headerHeights.content,
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
              {/* 閲覧モード（記録なし）の目印。iPhone ヘッダーと同じ扱い */}
              {browseMode && (
                <Ionicons
                  name="eye-outline"
                  size={20}
                  color={theme.colors.textSecondary}
                  accessibilityLabel={t("study.browseMode")}
                />
              )}
              {sessionDeck?.iconName && (
                <Ionicons
                  name={sessionDeck.iconName as any}
                  size={20}
                  color={resolveDeckIconColors(sessionDeck.colorHex, theme).color}
                />
              )}
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
              onPress={() => safeBack()}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
            >
              <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={openCardEdit}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
            >
              <Ionicons name="pencil-sharp" size={26} color={theme.colors.primary} />
            </Pressable>
            {/* 閲覧モードは集計画面が無く「終了＝戻る」なので ✓ は出さない（iPhone と同じ） */}
            {!browseMode && (
              <Pressable
                onPress={handleFinishSession}
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
                hitSlop={4}
              >
                <Ionicons name="checkmark-done-outline" size={26} color={theme.colors.primary} />
              </Pressable>
            )}
          </View>
        </View>
      ) : iPhoneHeader}
      <View
        style={[styles.container, { backgroundColor: theme.baseBackground }]}
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
            <InteractivePreviewContext.Provider value={interactivePreviewCtx}><FlipSuppressContext.Provider value={{ suppress, suppressedRef }}>
              <FlipCard
                ref={flipCardRef}
                isFlipped={isFlipped}
                onFlip={handleFlip}
                front={
                  <ScrollView
                    ref={frontScrollRef}
                    style={{ flex: 1 }}
                    contentContainerStyle={[styles.faceContent, timerContentPad && styles.faceContentTimerPad, kbHeight > 0 && { paddingBottom: kbHeight + 20 }]}
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
                      onCodeRunStart={handleCodeRunComplete}
                      scrollRef={frontScrollRef}
                      deckSqlStages={currentDeckSqlStages} deckHtmlStages={currentDeckHtmlStages} deckHtmlImages={currentDeckHtmlImages}
                    />
                  </ScrollView>
                }
                back={
                  <ScrollView
                    ref={backScrollRef}
                    style={{ flex: 1 }}
                    contentContainerStyle={[styles.faceContent, timerContentPad && styles.faceContentTimerPad, kbHeight > 0 && { paddingBottom: kbHeight + 20 }]}
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
                      onCodeRunStart={handleCodeRunComplete}
                      exitAllEditTrigger={backExitAllEditTrigger}
                      scrollRef={backScrollRef}
                      deckSqlStages={currentDeckSqlStages} deckHtmlStages={currentDeckHtmlStages} deckHtmlImages={currentDeckHtmlImages}
                    />
                    {memoBlock}
                    {tagRow}
                  </ScrollView>
                }
              />
            </FlipSuppressContext.Provider></InteractivePreviewContext.Provider>
          </Animated.View>
        </GestureDetector>

        {/* 全画面ボタン＋リンクボタン（カードエリア左上） */}
        <View style={styles.fullscreenBtnRow}>
          <Pressable
            style={styles.fullscreenBtn}
            onPress={() => {
              setCodeEditing(false);
              setIsFullscreen(true);
              cbs.setEditTrigger(0);
              cbs.setRunTrigger(0);
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

        {/* 休憩中: カード面＋下部操作列を覆うグレーアウト（タッチ吸収）。タイマーだけ上に残す（039）。
            ヘッダーはこの View の外（上）にあるため覆われない＝戻る/鉛筆/完了は活性のまま */}
        {onBreak && (
          <View
            pointerEvents="auto"
            style={[styles.breakOverlay, { backgroundColor: theme.dark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.6)" }]}
          />
        )}

        {/* 学習タイマー（カード内上部の余白に収まるフローティング。欠けた部分は透明＝カード背景） */}
        {timerMounted && (
          <StudyTimer
            phase={timer.phase}
            remainingMs={timer.remainingMs}
            totalMs={timer.totalMs}
            counting={timer.counting}
            epoch={timer.epoch}
            timeMode={studyTimerTime}
            blinking={timerBlinking}
            ringMode={studyTimerRing}
            breakMode={onBreak}
            cycleIndex={timer.cycleIndex}
            cycleCount={timer.cycleCount}
            forceVisible={showTimerMenu}
            onPress={handleTimerPress}
            onLongPress={handleTimerLongPress}
            style={styles.timerFloating}
          />
        )}

        {/* ヒント or 自己評価ボタン（閲覧モードは評価が無いので常にヒント＋前後送り） */}
        <View style={styles.bottom}>
          {!isFlipped || browseMode ? (
            <View style={styles.frontNavRow}>
              {/* 左: 前カードへ。先頭カードではセッションを抜けて戻る（配色を変えて区別） */}
              <Pressable
                style={[styles.navFab, { backgroundColor: theme.cardTheme.background, borderColor: theme.cardTheme.border }]}
                onPressIn={() => {
                  pressNavigatedRef.current = false;
                  if (curIdxRef.current > 0) startHold("prev");
                }}
                onPressOut={stopHold}
                onPress={() => { if (curIdxRef.current === 0 && !pressNavigatedRef.current) safeBack(); }}
                hitSlop={8}
              >
                <Ionicons
                  name="chevron-back"
                  size={24}
                  color={currentIndex === 0 ? theme.colors.primary : theme.colors.textTertiary}
                />
              </Pressable>

              <Pressable
                style={[
                  styles.flipHint,
                  { flex: 1, backgroundColor: theme.cardTheme.background },
                ]}
                onPress={() => setIsFlipped((v) => !v)}
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

              {/* 右: 次カードへ。最後のカードでは完了画面へ（配色を変えて区別） */}
              <Pressable
                style={[styles.navFab, { backgroundColor: theme.cardTheme.background, borderColor: theme.cardTheme.border }]}
                onPressIn={() => startHold("next")}
                onPressOut={stopHold}
                hitSlop={8}
              >
                <Ionicons
                  name="chevron-forward"
                  size={24}
                  color={currentIndex >= result.totalCards - 1 ? theme.colors.primary : theme.colors.textTertiary}
                />
              </Pressable>
            </View>
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

      <TagSheet
        visible={showTagSheet}
        onClose={() => setShowTagSheet(false)}
        tags={allTags}
        selectedIds={cardTags.map((tg) => tg.id)}
        onToggle={handleToggleCardTag}
        onCreateTag={handleCreateTag}
      />

      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        sections={shortcutSections}
      />
      <ConfirmModal
        visible={showFinishModal}
        title={t("study.finishConfirmTitle")}
        message={t("study.finishConfirmMessage", { count: result.totalCards - result.reviewed })}
        actions={[
          { label: t("common.ok"), onPress: () => { setShowFinishModal(false); finishSession(); } },
        ]}
        onClose={() => setShowFinishModal(false)}
      />
      {timerModals}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  // タイマー常時表示中はカード内上部の余白を広げ、タイマー（56pt）が内容と重ならず収まるようにする。
  // 通常モードは FlipCard の cardInner padding(24) が加算されるため、その分を差し引いて
  // 「タイマー下端と1行目の間 ≈ 6pt」になる値にする（全画面モードは ≈ 12pt）。
  faceContentTimerPad: { paddingTop: 58 },
  fullscreenContentTimerPad: { paddingTop: 76 },
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
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
    paddingVertical: 4,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  // 表面のみ表示する前後送りボタンの行（ヒントを左右の丸ボタンで挟む）
  frontNavRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  // カード一覧などの丸 FAB と同形状（56 丸）。配色だけ控えめにする
  navFab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  // 全画面モードの表面で下部左右隅に重ねるフローティング配置
  navFabFloating: {
    position: "absolute",
  },
  // 学習タイマー（通常モード）: カード内上部の余白（faceContentTimerPad で確保）の右側に収める。
  // top はプログレスバー(4)+進捗行(≈30)+cardArea padding(12)+カード内マージン(20) ≈ 66
  // （カード上端に近すぎたためマージンを 8→20 に拡大。faceContentTimerPad も +12 して間隔維持）
  // zIndex は休憩オーバーレイ（15）より上（長押しメニュー＝スキップ/終了への導線を残す・039）
  timerFloating: {
    position: "absolute",
    top: 66,
    right: 40,
    zIndex: 20,
  },
  // 学習タイマー（全画面モード）: ヘッダー行（paddingTop 48 + アイコン行 ≈ 94）＋進捗バー(2)の
  // 下に 8pt 空けて配置（バーに接しないように）
  timerFloatingFullscreen: {
    position: "absolute",
    top: 104,
    right: 16,
    zIndex: 20,
  },
  // 休憩中のグレーアウト（039）: 画面全体を覆いタッチを吸収する。zIndex はタイマー（20）と
  // 全画面ヘッダー（30）より下、その他の操作要素（全画面ボタン行=10・下部操作列）より上。
  // 背景色はテーマ依存でインライン指定。
  breakOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
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
  prevGradeDot: { width: 5, height: 5, borderRadius: 3, marginTop: 0 },
  completeScreen: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 16,
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
    gap: 32,
    paddingTop: 16,
    paddingBottom: 4,
  },
  statItem: {
    alignItems: "center",
    gap: 4,
    width: 100,
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
  fullscreenProgressBar: {
    height: 2,
    flexDirection: "row",
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

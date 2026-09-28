import { Ionicons } from "@expo/vector-icons";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type Ref,
  type SetStateAction
} from "react";
import { useTranslation } from "react-i18next";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";

import { constants as KeyCommand } from "react-native-key-command";

import { AppSwitch } from "@/components/AppSwitch";
import { ArchivePill, useArchivePill } from "@/components/ArchivePill";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { DeckIcon } from "@/components/DeckIcon";
import { InfoContent } from "@/components/InfoContent";
import { MultiSelectPickerModal } from "@/components/MultiSelectPickerModal";
import { registerAlertRestoreProvider } from "@/lib/alertFocus";
import { hasBlockContent } from "@/lib/cardPreview";
import { activeDeckStageId, codeBlockSubStops, type CodeSubStop } from "@/lib/codeBlockStops";
import { centeredScrollY } from "@/lib/scrollCenter";
import { EXECUTABLE_LANGUAGES } from "@/lib/code-execution/constants";
import { isRemoteKeyboardEvent } from "@/lib/keyboardEvent";
import { deleteKeySpecs, KEY_DELETE, KEY_END, KEY_HOME, KEY_PAGE_DOWN, KEY_PAGE_UP, useKeyCommands } from "@/lib/useKeyCommands";
import { InteractivePreviewContext } from "@/lib/InteractivePreviewContext";
import type { MdAction } from "@/lib/editor/applyMarkdown";
import { MAX_FONT_MULTIPLIER, SHADOW, useTheme } from "@/lib/theme";
import { useResponsiveSize } from "@/lib/useResponsiveSize";
import { resolveTagColor } from "@/lib/tagColors";
import { useProStore } from "@/store/pro";
import { useSettingsStore } from "@/store/settings";
import { useTagStore } from "@/store/tags";
import type { Block, CodeBlock, DeckImage, DeckStage, ImageBlock, TextBlock } from "@/types";
import type { OutputKeyAction, OutputKeyTrigger } from "@/components/code/ExecutionOutput";
import { CodeBlockItem } from "./CodeBlockItem";
import { DeckStageChoiceModal } from "./DeckStageChoiceModal";
import { ImageBlockItem } from "./ImageBlockItem";
import { TagSelector } from "./TagSelector";
import { TextBlockItem } from "./TextBlockItem";

type Tab = "front" | "back" | "memo";
export type EditorMode = "edit" | "sort" | "preview";

// エディタ内部でブロックを一意に識別するためのローカルキー付き型
type EditBlock = Block & { _key: string };

/**
 * 056：ブロックの後ろに並ぶ J/K の止まり先（編集モードのみ）。巡回は
 * 「ブロック0…n → ＋ブロック追加 → タグ → アーカイブ → フォーカスなし」。
 * ブロックのフォーカス（focusedBlockIndex）とは同時に立たない。デッキ名の行は表示だけなので止めない。
 */
type FooterFocus = "add" | "tags" | "archive";
/** 058：コードの編集を始めたとき、本文の欄の下に出る記号パレットのぶん（カーソルの行と一緒に見せる） */
const CODE_PALETTE_ALLOWANCE = 56;

/**
 * 末尾に確保する余白。最下部のアーカイブ行で ⓘ を開いたとき、説明は行とこの余白のあいだに
 * 入るので、余白ぶんはスクロールせずにその場で見える（自動スクロールを持ち込まないための余白）。
 * 140 は文字サイズ「大」で説明が折り返しても収まる高さ。デッキ編集にも同じ値を入れてある。
 */
const ARCHIVE_INFO_SLACK = 140;

function makeKey() {
  return Math.random().toString(36).slice(2, 9);
}

function toEditBlocks(blocks: Block[]): EditBlock[] {
  return blocks.map((b) => ({ ...b, _key: makeKey() }));
}

function fromEditBlocks(blocks: EditBlock[]): Block[] {
  return blocks.map(({ _key, ...b }) => b as Block);
}

function newTextBlock(): EditBlock {
  return { type: "text", content: "", _key: makeKey() };
}

function newCodeBlock(): EditBlock {
  const lang = useSettingsStore.getState().lastSelectedCodeLanguage;
  return {
    type: "code",
    language: lang,
    content: "",
    executable: EXECUTABLE_LANGUAGES.includes(lang),
    _key: makeKey(),
  };
}

function newImageBlock(): EditBlock {
  return { type: "image", uri: "", alt: "", _key: makeKey() };
}

export interface BlockEditorData {
  frontBlocks: Block[];
  backBlocks: Block[];
  memoBlocks: Block[];
  tagIds: string[];
}

export interface BlockEditorRef {
  save: () => void;
  /** ナビゲーション遷移直前に呼ぶ。blur タイマーによる focus() が遷移を妨害しないようにする */
  prepareForNavigation: () => void;
  /** 現在のエディタデータを返す（未保存の変更を検知するために使用） */
  getData: () => BlockEditorData;
}

interface Props {
  initialData?: Partial<BlockEditorData>;
  initialTab?: Tab;
  deckName?: string;
  deckIconName?: string | null;
  deckColorHex?: string | null;
  /** デッキ共通の SQL 初期化（SQL コードブロックのプレビュー実行時に本体の前へ流す） */
  deckSqlStages?: DeckStage[];
  /** デッキ共通の HTML/CSS 土台（web 系コードブロックのプレビュー土台） */
  deckHtmlStages?: DeckStage[];
  /** デッキの HTML 画像ライブラリ（043）。CodeBlockItem へ素通しする */
  deckHtmlImages?: DeckImage[];
  onSave: (data: BlockEditorData) => Promise<void>;
  onFrontEmptyChange?: (isEmpty: boolean) => void;
  saving: boolean;
  /** 新規カード作成時は true → 最初のテキストブロックを自動フォーカス。編集時は false/省略 → タップするまでフォーカスなし */
  isNewCard?: boolean;
  /** X キーでキャンセル */
  onCancel?: () => void;
  /** フォーカスなし時の D キーでカード削除 */
  onDeleteCard?: () => void;
  /** C キーでカード複製（カード編集時のみ渡す。新規作成時は未指定＝無効） */
  onDuplicate?: () => void;
  /** ?（Shift+/）でショートカット一覧を開く */
  onShowShortcuts?: () => void;
  /** モード（edit / sort / preview）が変わったときに通知する */
  onModeChange?: (mode: EditorMode) => void;
  /** カードのアーカイブ状態。onArchivedChange を渡したときだけ末尾にトグルを表示する（編集時のみ） */
  archived?: boolean;
  onArchivedChange?: (v: boolean) => void;
  /** 親画面のモーダル（カード削除確認・破棄確認）表示中はエディタのキーを止める */
  suspendKeys?: boolean;
  ref?: Ref<BlockEditorRef>;
}

export function BlockEditor({
  initialData,
  initialTab,
  deckName,
  deckIconName,
  deckColorHex,
  deckSqlStages,
  deckHtmlStages,
  deckHtmlImages,
  onSave,
  onFrontEmptyChange,
  saving: _saving,
  isNewCard,
  onCancel,
  onDeleteCard,
  onDuplicate,
  onShowShortcuts,
  onModeChange,
  archived,
  onArchivedChange,
  suspendKeys = false,
  ref,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rs = useResponsiveSize();
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  // キーボード（iOSの文字入力パレット含む）が出ている間、最下部のアーカイブ欄まで
  // スクロールできるようキーボード高さ分の余白をスクロール内容の末尾に確保する。
  // モーダル表示では KeyboardAvoidingView が高さを過小評価するため明示的に補う。
  const [keyboardPadding, setKeyboardPadding] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvt, (e) => {
      if (isRemoteKeyboardEvent(e)) return;
      setKeyboardPadding(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvt, (e) => {
      if (isRemoteKeyboardEvent(e)) return;
      setKeyboardPadding(0);
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  const scrollViewHeightRef = useRef(windowHeight);
  const contentHeightRef = useRef(0);
  // 末尾の項目・コードブロックの中の止まり先へフォーカスしたら**画面の真ん中**へ送る
  //（ホーム・カード一覧・設定の J/K と同じ＝次の項目が先に見えている。端では止まる）。
  // ⚠️ **見えている項目のために上へは戻さない**：ブロック本体は上寄せ（上端 −80）で送るので、J でブロックに入った
  //   直後の止まり先（「使うデッキの土台」など）は画面の上半分にある。そこで真ん中へ送ると画面が一度だけ上へ戻り、
  //   J で下へ進んでいるのに逆に動いて見える（2026-09-28 指摘）。上端が画面内にあるなら、下へ送るときだけ動かす。
  const scrollItemToCenter = (item: { y: number; h: number }) => {
    const current = scrollPosRef.current[activeTabRef.current] ?? 0;
    const y = centeredScrollY(item, scrollViewHeightRef.current, contentHeightRef.current, current);
    if (y === null) return;
    if (y < current && item.y >= current + 8) return;
    scrollRef.current?.scrollTo({ y, animated: true });
  };
  // 058：範囲（上端〜下端）を**必要な分だけ**見せる。収まるなら下端が見えるまで下げ、上端が隠れていれば上端へ。
  // 収まらなければ上端を優先する（実行結果＝エラーを先に読む）。`preferEnd` なら下端を優先（カーソルが末尾にある編集開始）。
  // すでに見えていれば動かさない。
  const scrollRangeIntoView = (top: number, bottom: number, margin = 16, preferEnd = false) => {
    const current = scrollPosRef.current[activeTabRef.current] ?? 0;
    const vh = scrollViewHeightRef.current;
    let target = current;
    if (bottom - top + margin * 2 <= vh) {
      if (bottom + margin > current + vh) target = bottom + margin - vh;
      if (top - margin < target) target = top - margin;
    } else {
      target = preferEnd ? bottom + margin - vh : top - margin;
    }
    target = Math.max(0, target);
    if (Math.abs(target - current) >= 1) scrollRef.current?.scrollTo({ y: target, animated: true });
  };
  const scrollPosRef = useRef<Record<Tab, number>>({
    front: 0,
    back: 0,
    memo: 0,
  });
  const blockPositions = useRef<Record<string, { y: number; h: number }>>({});

  // 装飾パレットは各テキストブロックが直下にインライン描画する（InputAccessoryView 廃止）。
  // BlockEditor 側の共有登録口は不要になった（適用ロジックは各ブロックがローカルに持つ）。
  const focusedBlockIndexRef = useRef<number | null>(null);
  // 033 Phase5: 編集中テキストブロックの装飾適用関数を橋渡しする ref（ハードキーボードの Cmd 系専用）。
  // パレット（タッチ）は各ブロックがローカルに処理し続ける。非編集時は null＝Cmd+B は安全に無反応。
  const activeApplyRef = useRef<((a: MdAction) => void) | null>(null);
  const activeTabRef = useRef<Tab>("front");
  const editorModeRef = useRef<EditorMode>("edit");
  const isSortModeRef = useRef(false);
  const isPreviewRef = useRef(false);
  const currentBlocksRef = useRef<EditBlock[]>([]);
  const addMenuVisibleRef = useRef(false);
  const addMenuFocusIndexRef = useRef(0);
  const editingBlockKeyRef = useRef<string | null>(null);
  const addAreaYRef = useRef(0);
  // 056：末尾の止まり先の位置（スクロールの中身から見た y・高さ）。画面外なら見える位置までスクロールする。
  const footerLayoutRef = useRef<Partial<Record<FooterFocus, { y: number; h: number }>>>({});
  const footerFocusRef = useRef<FooterFocus | null>(null);

  // 編集中ブロックのキーを記録（keyboardWillShow 時のスクロール・ESC での編集解除に使用）。
  const setEditingBlockKey = (key: string | null) => {
    editingBlockKeyRef.current = key;
    if (key === null) editingSubRef.current = null;
  };
  // 058：編集中の入力欄が土台・初期化の欄ならその止まり先（Esc で青枠をそこへ戻す）
  const editingSubRef = useRef<CodeSubStop | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? "front");
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  const isPreview = editorMode === "preview";
  const isSortMode = editorMode === "sort";
  const isEditMode = editorMode === "edit";
  const [frontBlocks, setFrontBlocks] = useState<EditBlock[]>(() =>
    toEditBlocks(initialData?.frontBlocks ?? [newTextBlock()]),
  );
  const [backBlocks, setBackBlocks] = useState<EditBlock[]>(() =>
    toEditBlocks(initialData?.backBlocks ?? [newTextBlock()]),
  );
  const [memoBlocks, setMemoBlocks] = useState<EditBlock[]>(() =>
    toEditBlocks(initialData?.memoBlocks ?? [newTextBlock()]),
  );
  const [tagIds, setTagIds] = useState<string[]>(initialData?.tagIds ?? []);
  // アーカイブの説明（常時表示をやめ、ⓘ タップでインライン展開する）
  const [showArchiveInfo, setShowArchiveInfo] = useState(false);
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [addMenuFocusIndex, setAddMenuFocusIndex] = useState(0);
  const [selectedBlockKey, setSelectedBlockKey] = useState<string | null>(null);
  const [moveCount, setMoveCount] = useState(0);
  const [newBlockKey, setNewBlockKey] = useState<string | null>(null);
  const [autoFocusedKeys, setAutoFocusedKeys] = useState<Set<string>>(new Set());
  const [focusedBlockIndex, setFocusedBlockIndexState] = useState<number | null>(
    null,
  );
  // 058：フォーカス中のブロックの中で止まっている土台・初期化の項目（null＝ブロック本体）。
  // ⚠️ ブロックのフォーカスを動かすと必ず本体へ戻す＝下の setFocusedBlockIndex を通す（別のブロックの
  // 止まり先が残って、戻ってきたときに古い項目に青枠が出ないように）。
  const [focusedSub, setFocusedSub] = useState<CodeSubStop | null>(null);
  const focusedSubRef = useRef<CodeSubStop | null>(null);
  function setFocusedBlockIndex(v: SetStateAction<number | null>, sub: CodeSubStop | null = null) {
    setFocusedBlockIndexState(v);
    setFocusedSub(sub);
    focusedSubRef.current = sub;
  }
  const isPro = useProStore((s) => s.isPro);
  // 058：言語の一覧（コードブロックが持つ）・デッキ土台の一覧が出ている間はエディタのキーを手放す
  const [langOverlayOpen, setLangOverlayOpen] = useState(false);
  const [stageChoice, setStageChoice] = useState<{ key: string; kind: "html" | "sql" } | null>(null);
  const [langPickerTriggerMap, setLangPickerTriggerMap] = useState<Record<string, number>>({});
  // 058 Phase 3：プレビュー枠のキー操作（V＝プレビュー/ソース・⇧F＝⛶ 全画面・⇧R＝⟲ 実行前に戻す）。
  // 学習画面と同じキー＝止まり先にはせず、ブロックにフォーカス中の直接キー（学習画面は Space が表裏反転で使えないため）
  const [outputKeyTriggerMap, setOutputKeyTriggerMap] = useState<Record<string, OutputKeyTrigger>>({});
  const [initEditTriggerMap, setInitEditTriggerMap] = useState<Record<string, { sub: "sqlInit" | "htmlInit"; n: number }>>({});
  // 058：止まり先の位置（ブロックの上端から見た y・高さ）。キーは `${ブロック}:${止まり先}`
  const subLayoutsRef = useRef<Record<string, { y: number; h: number }>>({});
  const [footerFocus, setFooterFocus] = useState<FooterFocus | null>(null);
  // 056：タグ選択のシート（J/K・Space・Return で選ぶ。検索のタグ絞り込みと同じ部品）
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const tags = useTagStore((s) => s.tags);
  const tagPickerItems = useMemo(
    () => tags.map((tag) => ({ id: tag.id, name: tag.name, color: resolveTagColor(tag.color, theme) })),
    [tags, theme],
  );
  // アーカイブ欄が画面外でも結果が分かるよう、E/⇧E でのアーカイブ切替時に中央ピルで通知する。
  const { archivePill, showArchivePill } = useArchivePill();
  const [editTriggerMap, setEditTriggerMap] = useState<Record<string, number>>(
    {},
  );
  // 054：アラートをキャンセルしたとき、編集していたテキストブロックを**元のカーソル位置で**再開する
  //（editTrigger は E/Return 用＝末尾へ置く。こちらは最後の選択をそのまま使う）。
  const [restoreTriggerMap, setRestoreTriggerMap] = useState<Record<string, number>>(
    {},
  );
  // 054：アラート（削除・破棄の確認など）はキーを受け取るため、裏で編集中の入力欄のカーソルを外す。
  // ブロックの入力欄は編集をやめると消えるので、アラートが入力欄へ直接戻すことはできない＝
  // 「どのブロックを編集していたか」をここで覚えて再開する手段を渡す（キャンセルしたときだけ使われる）。
  // テキスト・コードとも restoreTrigger＝最後のカーソル位置のまま再開する（editTrigger は末尾へ置く）。
  useEffect(() => registerAlertRestoreProvider(() => {
    const key = editingBlockKeyRef.current;
    if (!key) return null;
    const block = currentBlocksRef.current.find((b) => b._key === key);
    if (!block) return null;
    const bump = (set: typeof setEditTriggerMap) => () => set((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
    return block.type === "code" || block.type === "text" ? bump(setRestoreTriggerMap) : null;
  }), []);
  const [runTriggerMap, setRunTriggerMap] = useState<Record<string, number>>(
    {},
  );
  const [blurTriggerMap, setBlurTriggerMap] = useState<Record<string, number>>(
    {},
  );
  const [pendingDeleteBlock, setPendingDeleteBlock] = useState<{ tab: Tab; key: string } | null>(null);
  // 041: コードブロックの全画面インタラクティブプレビュー表示中は編集キー（main＋Esc）を解除する（suspendKeys と同じ扱い）。
  const [interactivePreviewOpen, setInteractivePreviewOpen] = useState(false);
  const interactivePreviewCtx = useMemo(() => ({ setOpen: setInteractivePreviewOpen }), []);

  const blocksByTab: Record<Tab, EditBlock[]> = {
    front: frontBlocks,
    back: backBlocks,
    memo: memoBlocks,
  };

  const setterByTab: Record<Tab, Dispatch<SetStateAction<EditBlock[]>>> = {
    front: setFrontBlocks,
    back: setBackBlocks,
    memo: setMemoBlocks,
  };

  function updateBlock(tab: Tab, key: string, patch: Partial<Block>) {
    setterByTab[tab]((prev) =>
      prev.map((b) => (b._key === key ? ({ ...b, ...patch } as EditBlock) : b)),
    );
  }

  function deleteBlock(tab: Tab, key: string) {
    setterByTab[tab]((prev) => prev.filter((b) => b._key !== key));
  }

  function addBlock(type: "text" | "code" | "image") {
    const block =
      type === "text"
        ? newTextBlock()
        : type === "code"
          ? newCodeBlock()
          : newImageBlock();
    setterByTab[activeTab]((prev) => [...prev, block]);
    setNewBlockKey(block._key);
    setAddMenuVisible(false);
    setFooterFocus(null);
  }

  // メニューフォーカスインデックスに対応するブロックを追加（またはキャンセル）
  const ADD_MENU_ITEMS = ["text", "code", "image", "cancel"] as const;
  function selectAddMenuItem(idx: number) {
    const item = ADD_MENU_ITEMS[idx];
    if (item === "cancel") {
      setAddMenuVisible(false);
    } else {
      addBlock(item);
    }
  }

  function moveBlock(tab: Tab, key: string, direction: "up" | "down") {
    const blocks = blocksByTab[tab];
    const idx = blocks.findIndex((b) => b._key === key);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === blocks.length - 1) return;

    setSelectedBlockKey(key);
    setMoveCount((c) => c + 1);
    setterByTab[tab]((prev) => {
      const next = [...prev];
      const target = direction === "up" ? idx - 1 : idx + 1;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    // レイアウト更新後に移動先ブロックへスクロール
    setTimeout(() => {
      const pos = blockPositions.current[key];
      if (pos && scrollRef.current) {
        scrollRef.current.scrollTo({
          y: Math.max(0, pos.y - 60),
          animated: true,
        });
      }
    }, 150);
  }

  const currentBlocks = blocksByTab[activeTab];

  // Sync mutable state into refs so key handlers always see fresh values
  activeTabRef.current = activeTab;
  editorModeRef.current = editorMode;
  isSortModeRef.current = isSortMode;
  isPreviewRef.current = isPreview;
  currentBlocksRef.current = currentBlocks;
  focusedBlockIndexRef.current = focusedBlockIndex;
  focusedSubRef.current = focusedSub;
  addMenuVisibleRef.current = addMenuVisible;
  addMenuFocusIndexRef.current = addMenuFocusIndex;
  footerFocusRef.current = footerFocus;

  // 056：末尾の止まり先。タグが1つも無ければタグ欄には止めない（選べるものが無い）・アーカイブは編集時のみ。
  const footerStops: FooterFocus[] = [
    "add",
    ...(tags.length > 0 ? (["tags"] as const) : []),
    ...(onArchivedChange ? (["archive"] as const) : []),
  ];

  // 058：ブロックの中の止まり先（編集モードのコードブロックだけ・表示されているものだけ）
  const subStopsOf = (block: EditBlock | undefined): CodeSubStop[] =>
    block?.type === "code" && editorModeRef.current === "edit"
      ? codeBlockSubStops(block as CodeBlock, { isPro, htmlStages: deckHtmlStages ?? [], sqlStages: deckSqlStages ?? [] })
      : [];

  // 058：止まり先へフォーカスが来たら画面の真ん中へ送る（末尾の項目と同じ）
  useEffect(() => {
    if (!focusedSub || focusedBlockIndex === null) return;
    const key = currentBlocks[focusedBlockIndex]?._key;
    const pos = key ? blockPositions.current[key] : undefined;
    const l = key ? subLayoutsRef.current[`${key}:${focusedSub}`] : undefined;
    if (!pos || !l) return;
    scrollItemToCenter({ y: pos.y + l.y, h: l.h });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedSub, focusedBlockIndex]);

  // ブロックにフォーカスが移ったら末尾の青枠は外す（同時に2か所に立てない）
  useEffect(() => {
    if (focusedBlockIndex !== null) setFooterFocus(null);
  }, [focusedBlockIndex]);

  // 並べ替え・プレビューでは末尾に止めない（並べ替えの J/K は「動かすブロックを選ぶ」ため）
  useEffect(() => {
    if (editorMode !== "edit") setFooterFocus(null);
  }, [editorMode]);

  // ショートカットを OFF にしたら青枠を消す（055 と同じ）
  useEffect(() => {
    if (!keyboardShortcutsEnabled) setFooterFocus(null);
  }, [keyboardShortcutsEnabled]);

  // 末尾の止まり先へフォーカスが来たら画面の真ん中へ送る（他の一覧と同じ）
  useEffect(() => {
    if (!footerFocus) return;
    const l = footerLayoutRef.current[footerFocus];
    if (!l) return;
    scrollItemToCenter(l);
  }, [footerFocus]);

  function focusFooter(stop: FooterFocus | null) {
    setFocusedBlockIndex(null);
    setFooterFocus(stop);
  }

  // 055 と同じ：項目の中をタップしたら青枠をそこへ移す（ショートカット ON のときだけ・スクロールの指は除く）
  const footerTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const tapToClaimFooter = (stop: FooterFocus) => ({
    onTouchStart: (e: GestureResponderEvent) => {
      footerTouchStartRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    },
    onTouchEnd: (e: GestureResponderEvent) => {
      const s = footerTouchStartRef.current;
      footerTouchStartRef.current = null;
      if (!s || !keyboardShortcutsEnabled || isSortModeRef.current || isPreviewRef.current) return;
      if (Math.abs(e.nativeEvent.pageX - s.x) < 10 && Math.abs(e.nativeEvent.pageY - s.y) < 10) focusFooter(stop);
    },
    onTouchCancel: () => { footerTouchStartRef.current = null; },
  });
  const footerLayout = (stop: FooterFocus) => (e: LayoutChangeEvent) => {
    footerLayoutRef.current[stop] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
  };

  const isFrontEmpty = frontBlocks.every((b) => {
    if (b.type === "image") return !b.uri;
    return (b as TextBlock | CodeBlock).content.trim() === "";
  });

  useEffect(() => {
    onFrontEmptyChange?.(isFrontEmpty);
  }, [isFrontEmpty]);

  useEffect(() => {
    onModeChange?.(editorMode);
  }, [editorMode]);

  useEffect(() => {
    if (editorMode !== "sort") setSelectedBlockKey(null);
  }, [editorMode]);

  useEffect(() => {
    if (addMenuVisible) {
      setTimeout(() => {
        // scrollToEnd ではメニュー下のタグ欄まで行き過ぎるため、
        // addArea の先頭が画面上端付近に来るようスクロールする
        scrollRef.current?.scrollTo({
          y: Math.max(0, addAreaYRef.current - 16),
          animated: true,
        });
      }, 50);
    }
  }, [addMenuVisible]);

  // タブ切替でブロックフォーカスをリセット＋スクロール位置を個別に復元
  useEffect(() => {
    setFocusedBlockIndex(null);
    setFooterFocus(null);
    scrollRef.current?.scrollTo({
      y: scrollPosRef.current[activeTab],
      animated: false,
    });
  }, [activeTab]);

  // ブロック数変化時にフォーカスインデックスを補正
  // functional update にすることで、同一コミット内で先に走る [activeTab] effect の
  // setFocusedBlockIndex(null) をバッチ後の最新値として参照できる（古い値で上書きしない）
  useEffect(() => {
    setFocusedBlockIndex((prev) => {
      if (prev !== null && prev >= currentBlocks.length) {
        return currentBlocks.length > 0 ? currentBlocks.length - 1 : null;
      }
      return prev;
    });
  }, [currentBlocks.length]);

  // フォーカス中ブロックへスクロール
  useEffect(() => {
    if (focusedBlockIndex === null) return;
    const block = currentBlocks[focusedBlockIndex];
    if (!block) return;
    setTimeout(() => {
      // 058：前のブロックの止まり先へ K で戻ったときは、止まり先のスクロールに任せる
      if (focusedSubRef.current) return;
      const pos = blockPositions.current[block._key];
      if (!pos || !scrollRef.current) return;
      scrollRef.current.scrollTo({
        y: Math.max(0, pos.y - 80),
        animated: true,
      });
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedBlockIndex]);

  // ブロックの TextInput がフォーカスされたとき呼ぶ（タップ・Return/E キー共通）。
  // J/K キーボードフォーカス（focusedBlockIndex）をクリアする。
  // editingBlockKeyRef に現在編集中のブロックキーを記録し、
  // keyboardWillShow 時のスクロールに使用する。
  function handleBlockTapFocus(blockKey: string, sub?: CodeSubStop) {
    setEditingBlockKey(blockKey);
    editingSubRef.current = sub ?? null;
    setFocusedBlockIndex(null);
    setFooterFocus(null);
  }

  function handleCodeBlockRunButtonPress(blockKey: string) {
    setEditingBlockKey(null);
    const idx = currentBlocksRef.current.findIndex((b) => b._key === blockKey);
    setFocusedBlockIndex(idx !== -1 ? idx : null);
    // 034: ネイティブキーコマンドは画面フォーカス中ずっと有効なので、編集終了後に隠し
    // 入力へフォーカスを戻す必要はない（実入力が外れた時点でショートカットが効く＝住み分け）。
  }

  function handleBlockEditBlur() {
    setEditingBlockKey(null);
    // 034: 再フォーカス不要（住み分けは責任者チェーンで自動成立）。
  }

  // E（フォーカスなし）/ ⇧E からのアーカイブ切替。結果を中央ピルで数秒通知する。
  // トグルが見える編集モードだけ（並べ替え・プレビューではトグルを隠すのでキーも効かせない）。
  function toggleArchiveWithPill() {
    if (isPreviewRef.current || isSortModeRef.current || !onArchivedChange) return;
    const next = !archived;
    onArchivedChange(next);
    showArchivePill(next);
  }

  function startEditFocusedBlock() {
    const idx = focusedBlockIndexRef.current;
    const blocks = currentBlocksRef.current;
    if (idx === null || !blocks[idx]) return;
    const key = blocks[idx]._key;
    setEditTriggerMap((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
    // カーソル（末尾の行）が隠れるときだけ、見える位置までスクロールする。
    // 058：以前は常に「ブロック末尾を画面最下部へ」送っていたため、画面の上の方にあるブロックでも Return で
    // 最下部まで動いた（iPad＋ハードキーボードではキーボードが出ないので特に目立つ）。コードブロックは本文の欄＋記号パレット
    // までを見せる（下の実行結果・プレビューまでは見せない＝カーソルと関係ない）。
    // 350ms はソフトキーボードが出て表示領域が縮んだ後の見直し（縮まなければ何もしない）。
    const scrollToCursor = () => {
      const pos = blockPositions.current[key];
      if (!pos) return;
      const code = subLayoutsRef.current[`${key}:__code`];
      const end = pos.y + (code ? code.y + code.h + CODE_PALETTE_ALLOWANCE : pos.h);
      scrollRangeIntoView(pos.y, end, 24, true);
    };
    setTimeout(scrollToCursor, 100);
    setTimeout(scrollToCursor, 350);
  }

  // Delete キー共通処理：フォーカス中ブロックがあれば削除（空なら即時／非空は確認）、
  // 無ければカード削除。編集モードと並べ替えモードの両方から呼ぶ。
  function deleteFocusedBlockOrCard(blocks: EditBlock[], idx: number | null, tab: Tab) {
    if (idx !== null && blocks[idx]) {
      const block = blocks[idx];
      // 削除確認の空判定：コードブロックは本文だけでなくブロック固有の初期化SQL / HTML 土台も見る
      // （土台のみ入力済みでも確認アラートを出す。保存ゲート isFrontEmpty は本文のみで別基準）。
      const isEmpty =
        block.type === "image"
          ? !(block as ImageBlock).uri
          : block.type === "code"
            ? (block as CodeBlock).content.trim() === "" &&
              !(block as CodeBlock).sqlInit?.trim() &&
              !(block as CodeBlock).htmlInit?.trim()
            : (block as TextBlock).content.trim() === "";
      if (isEmpty) {
        deleteBlock(tab, block._key);
        setFocusedBlockIndex(null);
      } else {
        setPendingDeleteBlock({ tab, key: block._key });
      }
    } else {
      onDeleteCard?.();
    }
  }

  function handleKeyPress(key: string) {
    if (!keyboardShortcutsEnabled) return;
    const k = key.toLowerCase();
    const blocks = currentBlocksRef.current;
    const idx = focusedBlockIndexRef.current;
    const tab = activeTabRef.current;
    const inSort = isSortModeRef.current;
    const menuLen = 4; // text / code / image / cancel

    // ブロック追加メニュー表示中はメニューナビゲーションを優先
    if (addMenuVisibleRef.current) {
      if (k === "j") {
        setAddMenuFocusIndex((prev) => (prev + 1) % menuLen);
      } else if (k === "k") {
        setAddMenuFocusIndex((prev) => (prev - 1 + menuLen) % menuLen);
      } else if (k === "a") {
        setAddMenuVisible(false);
      }
      // Return は onSubmitEditing で処理
      return;
    }

    // 画面スクロール（全モード共通）。PgUp/PgDn=段階、Home/End=端へ。
    const SCROLL_STEP = 240;
    const curScrollY = () => scrollPosRef.current[activeTabRef.current] ?? 0;
    const scrollByStep = (d: number) => scrollRef.current?.scrollTo({ y: Math.max(0, curScrollY() + d), animated: true });
    if (key === KEY_PAGE_UP) { scrollByStep(-SCROLL_STEP); return; }
    if (key === KEY_PAGE_DOWN) { scrollByStep(SCROLL_STEP); return; }
    if (key === KEY_HOME) { scrollRef.current?.scrollTo({ y: 0, animated: true }); return; }
    if (key === KEY_END) { scrollRef.current?.scrollToEnd({ animated: true }); return; }

    // C = カード複製（全モード共通。下部コピーボタンと同じ動作。新規作成時は onDuplicate 未指定＝無効）
    if (k === "c") { onDuplicate?.(); return; }

    const cycleMode = (dir = 1) => {
      const modes: EditorMode[] = ["edit", "sort", "preview"];
      setEditorMode((prev) => modes[(modes.indexOf(prev) + dir + 3) % 3]);
    };

    if (inSort) {
      if (k === "j" || k === "jb") {
        setSelectedBlockKey(null);
        setFocusedBlockIndex((prev) => {
          if (prev === null) return blocks.length > 0 ? 0 : null;
          return prev < blocks.length - 1 ? prev + 1 : null;
        });
      } else if (k === "k" || k === "kb") {
        setSelectedBlockKey(null);
        setFocusedBlockIndex((prev) => {
          if (prev === null)
            return blocks.length > 0 ? blocks.length - 1 : null;
          return prev > 0 ? prev - 1 : null;
        });
      } else if (k === "u") {
        if (idx !== null && blocks[idx] && idx > 0) {
          moveBlock(tab, blocks[idx]._key, "up");
          setFocusedBlockIndex(idx - 1);
        }
      } else if (k === "d") {
        if (idx !== null && blocks[idx] && idx < blocks.length - 1) {
          moveBlock(tab, blocks[idx]._key, "down");
          setFocusedBlockIndex(idx + 1);
        }
      } else if (k === "m") {
        cycleMode();
      } else if (k === "m_rev") {
        cycleMode(-1);
      } else if (k === "s") {
        handleSave();
      } else if (k === "x") {
        onCancel?.();
      } else if (k === KEY_DELETE) {
        deleteFocusedBlockOrCard(blocks, idx, tab);
      }
      return;
    }

    // プレビューはブロック削除（✕・フォーカス）が無いが、カード削除（最下部ゴミ箱と同等）は
    // Delete キーでもできるようにタップと揃える。フォーカスが無いので常にカード削除に対応。
    if (isPreviewRef.current && k === KEY_DELETE) {
      onDeleteCard?.();
      return;
    }
    // プレビューモードでは タブ操作（,/. と 1/2/3）・スクロール（U/D）・M/S/X・Delete(カード削除) のみ許可。
    // J / K / R / T / E / A は無効化。
    if (isPreviewRef.current && !["m", "m_rev", ",", ".", "s", "x", "u", "d", "1", "2", "3"].includes(k)) {
      return;
    }

    // 056：末尾の止まり先（＋ブロック追加・タグ・アーカイブ）にフォーカス中は、ブロック単位の Delete は効かせない
    //（フォーカスなし＝カード削除にも倒さない。タグを選んでいるつもりで押してカード削除の確認に繋がらないように）。
    const ff = footerFocusRef.current;
    if (ff && k === KEY_DELETE) return;
    // 058：ブロックの中の止まり先（土台・初期化）にいるときも Delete は何もしない（同じ理由）
    const sub = focusedSubRef.current;
    if (sub && k === KEY_DELETE) return;
    const stopsAt = (i: number) => subStopsOf(blocks[i]);
    // 前のブロックへ K で戻るときは、そのブロックの最後の止まり先へ入る
    const focusLastOf = (i: number) => {
      const st = stopsAt(i);
      setFocusedBlockIndex(i, st.length > 0 ? st[st.length - 1] : null);
    };

    // J/K：ブロック0…n → 末尾の止まり先 → フォーカスなし（ヌルサイクル）。末尾へは編集モードだけ延ばす
    //（並べ替えモードは上の inSort 分岐＝ブロックだけ）。
    //（058：コードブロックの中の止まり先＝土台・初期化も、表示されているものだけ本体の次に巡回する）
    // ⇧J/⇧K（"jb"/"kb"）はブロック本体だけを巡回する（止まり先を飛ばす）。
    if (k === "j" || k === "jb") {
      const st = idx !== null && k === "j" ? stopsAt(idx) : [];
      const si = sub ? st.indexOf(sub) : -1;
      if (ff) {
        const i = footerStops.indexOf(ff);
        focusFooter(i >= 0 ? footerStops[i + 1] ?? null : null);
      } else if (idx === null) {
        if (blocks.length > 0) setFocusedBlockIndex(0);
        else focusFooter(footerStops[0]);
      } else if (si + 1 < st.length) {
        setFocusedBlockIndex(idx, st[si + 1]);
      } else if (idx < blocks.length - 1) {
        setFocusedBlockIndex(idx + 1);
      } else {
        focusFooter(footerStops[0]);
      }
    } else if (k === "k" || k === "kb") {
      const byBlock = k === "kb";
      if (ff) {
        const i = footerStops.indexOf(ff);
        if (i > 0 && !byBlock) focusFooter(footerStops[i - 1]);
        else if (blocks.length > 0) {
          setFooterFocus(null);
          if (byBlock) setFocusedBlockIndex(blocks.length - 1);
          else focusLastOf(blocks.length - 1);
        } else focusFooter(null);
      } else if (idx === null) {
        focusFooter(footerStops[footerStops.length - 1]);
      } else if (sub && !byBlock) {
        const st = stopsAt(idx);
        const si = st.indexOf(sub);
        setFocusedBlockIndex(idx, si > 0 ? st[si - 1] : null);
      } else if (idx > 0) {
        if (byBlock) setFocusedBlockIndex(idx - 1);
        else focusLastOf(idx - 1);
      } else {
        setFocusedBlockIndex(null);
      }
    } else if (key === "v" || key === "sF" || key === "sR") {
      if (idx !== null && blocks[idx]?.type === "code") {
        const blockKey = blocks[idx]._key;
        const action: OutputKeyAction = key === "v" ? "toggleSource" : key === "sF" ? "expand" : "reset";
        setOutputKeyTriggerMap((prev) => ({ ...prev, [blockKey]: { action, n: (prev[blockKey]?.n ?? 0) + 1 } }));
      }
    } else if (k === "g") {
      // 058：G＝フォーカス中のコードブロックの言語の一覧を開く（止まり先にいても＝ブロック単位の操作）
      if (idx !== null && blocks[idx]?.type === "code") {
        const blockKey = blocks[idx]._key;
        setLangPickerTriggerMap((prev) => ({ ...prev, [blockKey]: (prev[blockKey] ?? 0) + 1 }));
      }
    } else if (k === "m") {
      cycleMode();
    } else if (k === "m_rev") {
      cycleMode(-1);
    } else if (key === ",") {
      const tabOrder: Tab[] = ["front", "back", "memo"];
      setEditTriggerMap({});
      setRunTriggerMap({});
      setLangPickerTriggerMap({});
      setInitEditTriggerMap({});
      setActiveTab((prev) => tabOrder[(tabOrder.indexOf(prev) - 1 + 3) % 3]);
    } else if (key === ".") {
      const tabOrder: Tab[] = ["front", "back", "memo"];
      setEditTriggerMap({});
      setRunTriggerMap({});
      setLangPickerTriggerMap({});
      setInitEditTriggerMap({});
      setActiveTab((prev) => tabOrder[(tabOrder.indexOf(prev) + 1) % 3]);
    } else if (k === "a") {
      if (!isPreviewRef.current) {
        setAddMenuVisible((v) => {
          if (!v) {
            // メニューを開く: ブロックフォーカス解除・メニュー先頭を選択
            //（＋ブロック追加にフォーカス中なら残す＝メニューを閉じたらそこへ戻る）
            setFocusedBlockIndex(null);
            if (ff !== "add") setFooterFocus(null);
            setAddMenuFocusIndex(0);
          }
          return !v;
        });
      }
    } else if (k === "r") {
      if (idx !== null && blocks[idx]?.type === "code") {
        const blockKey = blocks[idx]._key;
        if ((blocks[idx] as CodeBlock & { _key: string }).executable) {
          setRunTriggerMap((prev) => ({
            ...prev,
            [blockKey]: (prev[blockKey] ?? 0) + 1,
          }));
        }
      }
    } else if (k === KEY_DELETE) {
      deleteFocusedBlockOrCard(blocks, idx, tab);
    } else if (k === "x") {
      onCancel?.();
    } else if (k === "s") {
      handleSave();
    } else if (k === "e") {
      startEditFocusedBlock();
    } else if (k === "t") {
      // 056：タグ欄へフォーカス（画面外ならスクロール）。Return で選択シートを開く。タグが無ければ従来どおり末尾へ。
      if (footerStops.includes("tags")) focusFooter("tags");
      else scrollRef.current?.scrollToEnd({ animated: true });
    } else if (k === "u") {
      // 編集/プレビューモードの U/D は画面スクロール（並べ替えモードはブロック移動で上の inSort 分岐が処理）。
      scrollByStep(-SCROLL_STEP);
    } else if (k === "d") {
      scrollByStep(SCROLL_STEP);
    } else if (k === "1" || k === "2" || k === "3") {
      // タブ直接選択（表/裏/メモ）。
      const tabByNum: Record<string, Tab> = { "1": "front", "2": "back", "3": "memo" };
      setEditTriggerMap({});
      setRunTriggerMap({});
      setLangPickerTriggerMap({});
      setInitEditTriggerMap({});
      setActiveTab(tabByNum[k]);
    }
  }

  async function handleSave() {
    if (isFrontEmpty) return;
    await onSave({
      frontBlocks: fromEditBlocks(frontBlocks),
      backBlocks: fromEditBlocks(backBlocks),
      memoBlocks: fromEditBlocks(memoBlocks),
      tagIds,
    });
  }

  useImperativeHandle(
    ref,
    () => ({
      save: handleSave,
      // 034: 旧来は遷移前に hidden input への再フォーカスタイマーを止めていたが、
      // ネイティブキーコマンド化で不要になったため no-op。
      prepareForNavigation: () => {},
      getData: () => ({
        frontBlocks: fromEditBlocks(frontBlocks),
        backBlocks: fromEditBlocks(backBlocks),
        memoBlocks: fromEditBlocks(memoBlocks),
        tagIds,
      }),
    }),
    [handleSave, frontBlocks, backBlocks, memoBlocks, tagIds],
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: "front", label: t("common.front") },
    { key: "back", label: t("common.back") },
    { key: "memo", label: t("common.memo") },
  ];

  // 056：末尾の止まり先の青枠（レイアウトを変えないよう絶対配置で重ねる）
  const focusRing = (stop: FooterFocus, style: object) =>
    footerFocus === stop ? (
      <View pointerEvents="none" style={[styles.focusRing, { borderColor: theme.colors.primary }, style]} />
    ) : null;

  const footerContent = (
    <>
      {/* 並べ替えモードでブロックが1つ以下＝並べ替えるものが無い。何も起きない理由を下の欄の位置に出す
          （タブごとに数える＝表面は2つ・裏面は1つ、なら裏面でだけ出る。モードはカード全体で1つなので
          「1つ以下なら並べ替えモードに入れない」はできない） */}
      {isSortMode && currentBlocks.length <= 1 && (
        <Text
          style={[styles.sortHint, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
        >
          {t("editor.sortNeedsTwoBlocks")}
        </Text>
      )}
      {/* ブロック追加ボタン。下の欄（追加・タグ・アーカイブ・デッキ名）は**編集モードだけ**に出す
          ＝並べ替え・プレビューでは隠す（並べ替えの J/K はブロックにしか止まらない＝見た目とキーをそろえ、
          「今は並べ替えだけの画面」だと一目で分かるようにする） */}
      {isEditMode && (
        <View
          style={styles.addArea}
          onLayout={(e) => {
            addAreaYRef.current = e.nativeEvent.layout.y;
            footerLayout("add")(e);
          }}
          {...tapToClaimFooter("add")}
        >
          {addMenuVisible ? (
            <View
              style={[
                styles.addMenu,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.inputBorder,
                },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.addMenuItem,
                  { borderBottomColor: theme.colors.border },
                  addMenuFocusIndex === 0 && {
                    backgroundColor: theme.colors.primaryLight,
                  },
                ]}
                onPress={() => addBlock("text")}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[styles.addMenuIcon, { fontSize: theme.fontSize.lg }]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  T
                </Text>
                <Text
                  style={[
                    styles.addMenuLabel,
                    { color: theme.colors.text, fontSize: theme.fontSize.md },
                  ]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("editor.textBlock")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.addMenuItem,
                  { borderBottomColor: theme.colors.border },
                  addMenuFocusIndex === 1 && {
                    backgroundColor: theme.colors.primaryLight,
                  },
                ]}
                onPress={() => addBlock("code")}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[styles.addMenuIcon, { fontSize: theme.fontSize.lg }]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {"</>"}
                </Text>
                <Text
                  style={[
                    styles.addMenuLabel,
                    { color: theme.colors.text, fontSize: theme.fontSize.md },
                  ]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("editor.codeBlock")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.addMenuItem,
                  { borderBottomColor: theme.colors.border },
                  addMenuFocusIndex === 2 && {
                    backgroundColor: theme.colors.primaryLight,
                  },
                ]}
                onPress={() => addBlock("image")}
              >
                <View style={styles.addMenuIconWrap}>
                  <Ionicons
                    name="image-outline"
                    size={theme.fontSize.xxl}
                    color="#1976D2"
                  />
                </View>
                <Text
                  style={[
                    styles.addMenuLabel,
                    { color: theme.colors.text, fontSize: theme.fontSize.md },
                  ]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("card.imageBlock")}
                </Text>
              </TouchableOpacity>
              <Pressable
                onPress={() => setAddMenuVisible(false)}
                style={[
                  styles.addMenuCancel,
                  addMenuFocusIndex === 3 && {
                    backgroundColor: theme.colors.primaryLight,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.addMenuCancelText,
                    {
                      color: theme.colors.textTertiary,
                      fontSize: theme.fontSize.md,
                    },
                  ]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("common.cancel")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[styles.addBtn, { borderColor: theme.colors.iconSubtle, backgroundColor: theme.colors.surface }]}
              onPress={() => {
                // 編集中ブロックを解除しキーボードを閉じてからメニューを開く。
                // 034: ネイティブキーコマンドなので隠し入力への再フォーカスは不要。
                setEditingBlockKey(null);
                Keyboard.dismiss();
                setAddMenuFocusIndex(0);
                setAddMenuVisible(true);
              }}
            >
              <Text
                style={[
                  styles.addBtnText,
                  {
                    color: theme.colors.textTertiary,
                    fontSize: theme.fontSize.md,
                  },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t("editor.addBlock")}
              </Text>
            </Pressable>
          )}
          {!addMenuVisible && focusRing("add", styles.focusRingCard)}
        </View>
      )}

      {/* タグ選択・アーカイブ・デッキ名（編集モードだけ）。タグとアーカイブはデッキ編集と同じ白枠 */}
      {isEditMode && (
        <>
          <View style={[styles.whiteCard, styles.tagSection, { backgroundColor: theme.colors.surface }]} onLayout={footerLayout("tags")} {...tapToClaimFooter("tags")}>
            <Text
              style={[
                styles.tagLabel,
                {
                  color: theme.colors.textSecondary,
                  fontSize: theme.fontSize.md,
                },
              ]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t("tag.title")}
            </Text>
            <TagSelector selectedTagIds={tagIds} onChange={setTagIds} />
            {focusRing("tags", styles.focusRingWhiteCard)}
          </View>

          {/* アーカイブトグル（編集時のみ）。タグ・デッキと並ぶカード単位のメタ情報。
              説明は常時表示せず、ⓘ タップで白枠の中にインライン展開する
              （設定画面の card + syncInfoBox と同じ形。デッキ編集も同じ）。 */}
          {onArchivedChange && (
            <View
              style={[styles.whiteCard, styles.archiveCard, { backgroundColor: theme.colors.surface }]}
              onLayout={footerLayout("archive")}
              {...tapToClaimFooter("archive")}
            >
              <View style={styles.archiveRow}>
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text
                    style={[styles.tagLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md, flexShrink: 1 }]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {t("deck.archive")}
                  </Text>
                  <Pressable
                    onPress={() => { Keyboard.dismiss(); setShowArchiveInfo((v) => !v); }}
                    hitSlop={8}
                    accessibilityLabel={t("deck.archiveInfoLabel")}
                  >
                    <Ionicons
                      name={showArchiveInfo ? "information-circle" : "information-circle-outline"}
                      size={Math.max(theme.fontSize.lg, 20)}
                      color={theme.colors.textTertiary}
                    />
                  </Pressable>
                </View>
                <AppSwitch
                  value={!!archived}
                  onValueChange={onArchivedChange}
                  thumbColor="#FFF"
                />
              </View>
              {showArchiveInfo && (
                <View style={[styles.archiveInfoBox, { backgroundColor: theme.colors.background }]}>
                  <InfoContent text={t("deck.archiveHint")} />
                </View>
              )}
              {focusRing("archive", styles.focusRingWhiteCard)}
            </View>
          )}

          {/* デッキ名は見るだけ（ここでは変えられない）＝一番下に置き、白枠にも入れない
              （白枠は「フォーカスして操作できる欄」の入れ物。操作できるタグ・アーカイブを続けて並べる） */}
          {deckName != null && (
            <View style={[styles.deckRow, { borderColor: theme.colors.border }]}>
              <Text
                style={[
                  styles.tagLabel,
                  {
                    color: theme.colors.textSecondary,
                    fontSize: theme.fontSize.md,
                  },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t("deck.name")}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8 }}>
                {deckIconName && <DeckIcon iconName={deckIconName} colorHex={deckColorHex ?? null} />}
                <Text
                  style={[
                    styles.deckName,
                    {
                      color: theme.colors.text,
                      fontSize: theme.fontSize.lg,
                      flexShrink: 1,
                    },
                  ]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {deckName}
                </Text>
              </View>
            </View>
          )}
        </>
      )}

      {/* 表面が空の場合のバリデーションエラー */}
      {isFrontEmpty && (
        <Text
          style={[
            styles.validationError,
            { color: theme.colors.danger, fontSize: theme.fontSize.sm },
          ]}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
        >
          {t("card.frontRequired")}
        </Text>
      )}
    </>
  );

  // 033 Phase5: テキスト編集中の装飾ショートカット（Cmd コンボ）を、フォーカス中ブロックの
  // 適用関数へ流す。実 TextInput は素の（リッチ非対応）入力なので ⌘B/I 等を消費せず責任者チェーンを
  // 上って発火する（Esc 代替の Cmd+. と同じ原理）。装飾対象が無いときは activeApplyRef が null＝無反応。
  const applyDeco = (action: MdAction) => {
    if (!keyboardShortcutsEnabled) return;
    activeApplyRef.current?.(action);
  };
  const CMD = KeyCommand.keyModifierCommand;
  const CMD_SHIFT = KeyCommand.keyModifierCommand | KeyCommand.keyModifierShift;
  // ⌘⇧8（箇条書き）/ ⌘⇧9（引用）: Shift+数字が '8'/'*' のどちらの input 表現で届くか環境差が
  // あるため、両候補＋修飾違いを登録して取りこぼさない（deleteKeySpecs と同じ防御的多重登録）。
  const numDeco = (base: string, shifted: string, action: MdAction) => [
    { input: base, modifierFlags: CMD_SHIFT, handler: () => applyDeco(action) },
    { input: shifted, modifierFlags: CMD_SHIFT, handler: () => applyDeco(action) },
    { input: shifted, modifierFlags: CMD, handler: () => applyDeco(action) },
  ];
  const decoSpecs = [
    { input: "b", modifierFlags: CMD, handler: () => applyDeco({ kind: "wrap", left: "**", right: "**" }) },
    { input: "i", modifierFlags: CMD, handler: () => applyDeco({ kind: "wrap", left: "*", right: "*" }) },
    { input: "u", modifierFlags: CMD, handler: () => applyDeco({ kind: "wrap", left: "++", right: "++" }) },
    { input: "e", modifierFlags: CMD, handler: () => applyDeco({ kind: "wrap", left: "`", right: "`" }) },
    { input: "x", modifierFlags: CMD_SHIFT, handler: () => applyDeco({ kind: "wrap", left: "~~", right: "~~" }) },
    { input: "m", modifierFlags: CMD_SHIFT, handler: () => applyDeco({ kind: "highlight" }) },
    { input: "h", modifierFlags: CMD_SHIFT, handler: () => applyDeco({ kind: "heading" }) },
    ...numDeco("8", "*", { kind: "prefix", prefix: "- " }),
    ...numDeco("9", "(", { kind: "prefix", prefix: "> " }),
  ];

  // 034: 既存の handleKeyPress(key) ディスパッチをそのまま流用し、各キーから呼ぶ。
  // ★矢印・Tab はこの画面では登録しない。理由: iPad は keyCommands をキャッシュするため、
  //   一度でも矢印/Tab を優先付きで登録すると、編集中もそのキャッシュが“ただの矢印/Tab”を奪い続け、
  //   入力欄にカーソル移動/インデントが届かなくなる（登録解除してもキャッシュは消えない）。
  //   そこで「最初から登録しない」ことで、編集中は矢印=カーソル移動・Tab=インデントが常に効く。
  //   ナビは J/K（ブロック移動）・,/.（表/裏/メモ切替）で行う。
  useKeyCommands([
    { input: "j", handler: () => handleKeyPress("j") },
    { input: "k", handler: () => handleKeyPress("k") },
    // 058：⇧J/⇧K＝ブロック本体だけを巡回（コードブロックの中の土台・初期化の止まり先を飛ばす）
    { input: "j", modifierFlags: KeyCommand.keyModifierShift, handler: () => handleKeyPress("jb") },
    { input: "k", modifierFlags: KeyCommand.keyModifierShift, handler: () => handleKeyPress("kb") },
    // 058：G＝フォーカス中のコードブロックの言語の一覧
    { input: "g", handler: () => handleKeyPress("g") },
    // 058 Phase 3：プレビュー枠（V＝プレビュー/ソース・⇧F＝⛶ 全画面・⇧R＝⟲ 実行前に戻す）
    { input: "v", handler: () => handleKeyPress("v") },
    { input: "f", modifierFlags: KeyCommand.keyModifierShift, handler: () => handleKeyPress("sF") },
    { input: "r", modifierFlags: KeyCommand.keyModifierShift, handler: () => handleKeyPress("sR") },
    // 058：⌘R＝入力中でも実行（カーソルは残す＝書いては試す）。⌘ 付きは入力欄に取られずアプリに届く。
    //   編集中のブロックがあればそれを、無ければフォーカス中のブロックを実行（R と同じ）。並べ替え・プレビューでは効かせない。
    { input: "r", modifierFlags: KeyCommand.keyModifierCommand, handler: () => {
      if (!keyboardShortcutsEnabled || isSortModeRef.current || isPreviewRef.current) return;
      const blocks = currentBlocksRef.current;
      const idx = focusedBlockIndexRef.current;
      const key = editingBlockKeyRef.current ?? (idx !== null ? blocks[idx]?._key : null);
      const block = key ? blocks.find((b) => b._key === key) : undefined;
      if (block?.type !== "code" || !(block as CodeBlock).executable) return;
      setRunTriggerMap((prev) => ({ ...prev, [block._key]: (prev[block._key] ?? 0) + 1 }));
    } },
    { input: "m", handler: () => handleKeyPress("m") },
    // ⇧M = モード逆順（編集→プレビュー→並べ替え→編集）。M の順送りの逆。
    { input: "m", modifierFlags: KeyCommand.keyModifierShift, handler: () => handleKeyPress("m_rev") },
    { input: "a", handler: () => handleKeyPress("a") },
    { input: "r", handler: () => handleKeyPress("r") },
    // D は並び替えモードの「下に移動」専用。編集モードの削除は Backspace/Delete キー。
    { input: "d", handler: () => handleKeyPress("d") },
    ...deleteKeySpecs(() => handleKeyPress(KEY_DELETE)),
    { input: "x", handler: () => handleKeyPress("x") },
    { input: "s", handler: () => handleKeyPress("s") },
    { input: "c", handler: () => handleKeyPress("c") },
    // ⌘S = 保存 / ⌘C = 複製（OS 慣習のエイリアス）。テキスト編集中は ⌘C はテキストのコピーが
    //   優先される（テキスト入力が先に消費）ため、非編集時のみカード複製として発火する。
    { input: "s", modifierFlags: KeyCommand.keyModifierCommand, handler: () => handleKeyPress("s") },
    { input: "c", modifierFlags: KeyCommand.keyModifierCommand, handler: () => handleKeyPress("c") },
    // ?（Shift+/）= ショートカット一覧を開く（閉じる/トグルは ShortcutsModal 側が担当）
    { input: "/", modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (keyboardShortcutsEnabled) onShowShortcuts?.(); } },
    // E = フォーカスあり→そのブロックを編集 / フォーカスなし→アーカイブ切替。
    //   Delete キーと同じ「フォーカスあり＝ブロック単位／なし＝カード単位」の流儀に合わせる。
    //   アーカイブはトグルが見える編集モードのみ有効（並べ替え・プレビューは非表示）＆
    //   新規作成では onArchivedChange 未提供＝無効。
    { input: "e", handler: () => {
      if (!keyboardShortcutsEnabled) return;
      if (focusedBlockIndexRef.current === null) {
        toggleArchiveWithPill();
        return;
      }
      handleKeyPress("e");
    } },
    // ⇧E = アーカイブ切替（フォーカスの有無に関わらず常時）。フォーカス中でもブロック編集に
    //   邪魔されずアーカイブしたいとき用。ガードは E のアーカイブ分岐と同じ。
    { input: "e", modifierFlags: KeyCommand.keyModifierShift, handler: () => {
      if (!keyboardShortcutsEnabled) return;
      toggleArchiveWithPill();
    } },
    { input: "t", handler: () => handleKeyPress("t") },
    { input: "u", handler: () => handleKeyPress("u") },
    { input: ",", handler: () => handleKeyPress(",") },
    { input: ".", handler: () => handleKeyPress(".") },
    // H/L でもタブ切替（,/. と同じ。横方向＝タブの流儀を学習画面/アイコン選択と統一）
    { input: "h", handler: () => handleKeyPress(",") },
    { input: "l", handler: () => handleKeyPress(".") },
    // タブ直接選択（表/裏/メモ）
    { input: "1", handler: () => handleKeyPress("1") },
    { input: "2", handler: () => handleKeyPress("2") },
    { input: "3", handler: () => handleKeyPress("3") },
    // 画面スクロール（PgUp/PgDn=段階、Home/End=端へ。U/D は編集/プレビューでスクロール）
    { input: KEY_PAGE_UP, handler: () => handleKeyPress(KEY_PAGE_UP) },
    { input: KEY_PAGE_DOWN, handler: () => handleKeyPress(KEY_PAGE_DOWN) },
    { input: KEY_HOME, handler: () => handleKeyPress(KEY_HOME) },
    { input: KEY_END, handler: () => handleKeyPress(KEY_END) },
    // Home/End の無いキーボード向け：Shift+U=最上部 / Shift+D=最下部。
    { input: "u", modifierFlags: KeyCommand.keyModifierShift, handler: () => handleKeyPress(KEY_HOME) },
    { input: "d", modifierFlags: KeyCommand.keyModifierShift, handler: () => handleKeyPress(KEY_END) },
    // 033 Phase5: テキスト編集中の装飾（⌘B/⌘I/⌘U/⌘E/⌘⇧X/⌘⇧M/⌘⇧H/⌘⇧8/⌘⇧9）。
    ...decoSpecs,
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (!keyboardShortcutsEnabled) return;
        if (addMenuVisibleRef.current) {
          selectAddMenuItem(addMenuFocusIndexRef.current);
          return;
        }
        // 056：末尾の止まり先は Return＝開く（＋ブロック追加＝メニュー／タグ＝選択シート）。アーカイブは Space。
        const ff = footerFocusRef.current;
        if (ff === "add") {
          Keyboard.dismiss();
          setAddMenuFocusIndex(0);
          setAddMenuVisible(true);
          return;
        }
        if (ff === "tags") {
          Keyboard.dismiss();
          setTagPickerVisible(true);
          return;
        }
        if (ff) return;
        // 058：土台・初期化の止まり先。Return＝欄を開いて入力を始める／デッキ土台が2つ以上なら一覧を開く
        const sub = focusedSubRef.current;
        const idx = focusedBlockIndexRef.current;
        const block = idx !== null ? currentBlocksRef.current[idx] : undefined;
        if (sub && block) {
          if (sub === "sqlInit" || sub === "htmlInit") {
            setInitEditTriggerMap((prev) => ({ ...prev, [block._key]: { sub, n: (prev[block._key]?.n ?? 0) + 1 } }));
          } else if (sub === "htmlStage" && (deckHtmlStages?.length ?? 0) > 1) {
            setStageChoice({ key: block._key, kind: "html" });
          } else if (sub === "sqlStage" && (deckSqlStages?.length ?? 0) > 1) {
            setStageChoice({ key: block._key, kind: "sql" });
          }
          return;
        }
        startEditFocusedBlock();
      },
    },
    // 056：Space＝スイッチ（アーカイブにフォーカス中だけ。053/055 と同じ「Return＝開く／Space＝スイッチ」）。
    //   欄が見えているので中央ピルは出さない（E/⇧E は欄が画面外でもピルで分かる）。
    {
      input: " ",
      handler: () => {
        if (!keyboardShortcutsEnabled) return;
        if (footerFocusRef.current === "archive" && onArchivedChange && !isPreviewRef.current) {
          onArchivedChange(!archived);
          return;
        }
        // 058：コードブロック。本体にフォーカス中＝実行トグル／止まり先＝その項目のスイッチ（編集モードだけ）
        if (editorModeRef.current !== "edit") return;
        const idx = focusedBlockIndexRef.current;
        const block = idx !== null ? currentBlocksRef.current[idx] : undefined;
        if (block?.type !== "code") return;
        const code = block as CodeBlock;
        const sub = focusedSubRef.current;
        const tab = activeTabRef.current;
        if (!sub) {
          if (EXECUTABLE_LANGUAGES.includes(code.language)) updateBlock(tab, block._key, { executable: !code.executable });
        } else if (sub === "previewInit") {
          updateBlock(tab, block._key, { previewInit: !code.previewInit });
        } else if (sub === "htmlStage" && deckHtmlStages?.length === 1) {
          // 土台1つ＝トグル。ON に戻すときは宙に浮いた選択 id も消す（DeckStagePicker の onPickDefault と同じ）
          const on = activeDeckStageId(deckHtmlStages, code.noDeckHtmlInit, code.deckStageId) !== null;
          updateBlock(tab, block._key, on ? { noDeckHtmlInit: true } : { noDeckHtmlInit: false, deckStageId: undefined });
        } else if (sub === "sqlStage" && deckSqlStages?.length === 1) {
          const on = activeDeckStageId(deckSqlStages, code.noDeckSqlInit, code.deckSqlStageId) !== null;
          updateBlock(tab, block._key, on ? { noDeckSqlInit: true } : { noDeckSqlInit: false, deckSqlStageId: undefined });
        }
      },
    },
    // 矢印は iPhone のみ登録（上下=K/J ブロック移動、左右=,/. タブ切替）。iPhone はフォーカスエンジンが
    // 無く、登録しても編集中は入力欄が矢印を消費する（カーソル移動）。iPad は登録しない＝編集中カーソル優先。
    ...(((Platform as any).isPad ? [] : [
      { input: KeyCommand.keyInputUpArrow, handler: () => handleKeyPress("k") },
      { input: KeyCommand.keyInputDownArrow, handler: () => handleKeyPress("j") },
      { input: KeyCommand.keyInputLeftArrow, handler: () => handleKeyPress(",") },
      { input: KeyCommand.keyInputRightArrow, handler: () => handleKeyPress(".") },
    ]) as { input: string; handler: () => void }[]),
  // 親モーダル（ショートカット一覧）・全画面プレビュー表示中はナビ系を解除（背景キー抑止）。
  // 削除確認・破棄確認（アラート）は表示中にキーを独占する（054）ので含めない。
  // タグ選択シート（056）は自前でキーを持つので、表示中は手放す。
  ], !suspendKeys && !interactivePreviewOpen && !tagPickerVisible && !langOverlayOpen && !stageChoice);

  // ESC は編集中も含めて常時有効（編集中ブロックを抜ける／キャンセル）。
  // ただし親モーダル表示中は親側が Esc を処理するため解除する。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (!keyboardShortcutsEnabled) return;
        if (addMenuVisible) { setAddMenuVisible(false); return; }
        if (editingBlockKeyRef.current) {
          const key = editingBlockKeyRef.current;
          // 058：土台・初期化の欄を編集していたなら、青枠はその止まり先へ戻す（055 の「Esc で入力をやめると青枠に戻る」）
          const editingSub = editingSubRef.current;
          setBlurTriggerMap((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
          setEditingBlockKey(null);
          // 編集を抜けてもブロックフォーカス（青枠）を保持する（学習画面の Esc と同様）。
          // これにより Esc 直後に R で実行・E で再編集ができる（実行ボタンの挙動と一致）。
          const idx = currentBlocksRef.current.findIndex((b) => b._key === key);
          setFocusedBlockIndex(idx !== -1 ? idx : null, idx !== -1 ? editingSub : null);
          Keyboard.dismiss();
          return;
        }
        // 056：フォーカス（青枠）があれば先に外す（055 のデッキ/タグ編集・053 の設定と同じ Esc の順）
        if (footerFocusRef.current) { setFooterFocus(null); return; }
        if (focusedBlockIndexRef.current !== null) { setFocusedBlockIndex(null); return; }
        onCancel?.();
      },
    },
  ], !suspendKeys && !interactivePreviewOpen && !tagPickerVisible && !langOverlayOpen && !stageChoice);

  return (
    <InteractivePreviewContext.Provider value={interactivePreviewCtx}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* タブバー */}
      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.inputBorder,
          },
        ]}
      >
        {tabs.map((tab) => {
          const blocks = blocksByTab[tab.key];
          // 「その面に中身があるか」の定義元は lib/cardPreview.ts（検索のフィールド絞り込みと共有）。
          const hasDot = hasBlockContent(blocks);
          return (
            <Pressable
              key={tab.key}
              style={[
                styles.tab,
                { paddingHorizontal: rs(14, 28) },
                activeTab === tab.key && styles.tabActive,
              ]}
              onPress={() => {
                // 034: タブ切替時は編集中ブロックを解除しキーボードを閉じる。
                // ネイティブキーコマンドは画面フォーカス中ずっと有効なので再フォーカス不要。
                setEditingBlockKey(null);
                Keyboard.dismiss();
                setAddMenuVisible(false);
                setEditTriggerMap({});
                setRunTriggerMap({});
                setLangPickerTriggerMap({});
                setInitEditTriggerMap({});
                setBlurTriggerMap({});
                setActiveTab(tab.key);
              }}
            >
              <Text
                style={[
                  styles.tabText,
                  {
                    color: theme.colors.textTertiary,
                    fontSize: rs(Math.max(theme.fontSize.md, 16), Math.max(theme.fontSize.lg, 18)),
                  },
                  activeTab === tab.key && styles.tabTextActive,
                ]}
                maxFontSizeMultiplier={1.0}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
              {hasDot && (
                <View style={styles.tabDotContainer}>
                  <View style={[styles.tabDot, { backgroundColor: theme.colors.primary }]} />
                </View>
              )}
            </Pressable>
          );
        })}
        {/* モード3択ボタン */}
        <View style={styles.modeButtons}>
          {(
            [
              { mode: "edit" as EditorMode, icon: "pencil-outline" as const },
              {
                mode: "sort" as EditorMode,
                icon: "reorder-three-outline" as const,
              },
              { mode: "preview" as EditorMode, icon: "eye-outline" as const },
            ] as const
          ).map(({ mode, icon }) => {
            const active = editorMode === mode;
            return (
              <Pressable
                key={mode}
                style={[
                  styles.modeBtn,
                  {
                    backgroundColor: theme.colors.background,
                    paddingHorizontal: rs(9, 32),
                  },
                  active && { backgroundColor: theme.colors.primary },
                ]}
                onPress={() => {
                  // 034: モード切替時に編集中ブロックがあれば解除しキーボードを閉じる（再フォーカス不要）。
                  if (editingBlockKeyRef.current) {
                    setEditingBlockKey(null);
                    Keyboard.dismiss();
                    setBlurTriggerMap({});
                  }
                  setEditorMode(mode);
                }}
              >
                <Ionicons
                  name={icon}
                  size={Math.max(theme.fontSize.lg, rs(18, 20))}
                  color={active ? "#FFFFFF" : theme.colors.textSecondary}
                />
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={[styles.scroll, { backgroundColor: theme.colors.background }]}
        // ARCHIVE_INFO_SLACK は最下部のアーカイブ行で ⓘ を開いたときのための余白。最下部まで来て
        // いるとき説明は行と余白のあいだに入るので、余白ぶんはその場に現れる（自動スクロール不要）。
        contentContainerStyle={{ flexGrow: 1, paddingBottom: keyboardPadding + ARCHIVE_INFO_SLACK }}
        onLayout={(e) => {
          scrollViewHeightRef.current = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_w, h) => { contentHeightRef.current = h; }}
        // "always": ブロックにフォーカス中（TextInput が first responder）にツールバー/補助パレットを
        // タップしても、キーボード解除＝編集解除にならないようにする。iOS の「フォーカス外の初回タップが
        // resignFirstResponder に消費される」2度タップ問題自体は残る（初回は空振り→2度目で入力）が、
        // "handled" だとその初回タップがキーボード解除まで起こして編集を失うため "always" を採用。
        // 詳細と失敗策は memory: project_editor-first-tap-toolbar-swallow。
        keyboardShouldPersistTaps="always"
        scrollEventThrottle={100}
        onScroll={(e) => {
          scrollPosRef.current[activeTabRef.current] =
            e.nativeEvent.contentOffset.y;
        }}
      >
        <Pressable
          style={[styles.content, { flexGrow: 1 }, isPreview && { paddingHorizontal: 16 + 28 + (activeTab === "memo" ? 12 : 0) }]}
          onPress={() => {
            const key = editingBlockKeyRef.current;
            if (key) setBlurTriggerMap((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
          }}
        >
        {currentBlocks.map((block, index) => {
          const moveUp =
            isSortMode && index > 0
              ? () => moveBlock(activeTab, block._key, "up")
              : undefined;
          const moveDown =
            isSortMode && index < currentBlocks.length - 1
              ? () => moveBlock(activeTab, block._key, "down")
              : undefined;
          const flashTrigger = selectedBlockKey === block._key ? moveCount : 0;
          return (
            <View
              key={block._key}
              onLayout={(e) => {
                blockPositions.current[block._key] = {
                  y: e.nativeEvent.layout.y,
                  h: e.nativeEvent.layout.height,
                };
              }}
            >
              {block.type === "text" && (
                <TextBlockItem
                  block={block as TextBlock}
                  isPreview={isPreview}
                  onChange={(content) =>
                    updateBlock(activeTab, block._key, { content })
                  }
                  onDelete={() => deleteBlock(activeTab, block._key)}
                  autoFocus={
                    !autoFocusedKeys.has(block._key) &&
                    ((isNewCard && index === 0) || block._key === newBlockKey)
                  }
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  collapsed={isSortMode}
                  flashTrigger={flashTrigger}
                  onCollapsedDoubleTap={() => setEditorMode("edit")}
                  isFocused={focusedBlockIndex === index}
                  editTrigger={editTriggerMap[block._key] ?? 0}
                  restoreTrigger={restoreTriggerMap[block._key] ?? 0}
                  blurTrigger={blurTriggerMap[block._key] ?? 0}
                  onEditBlur={handleBlockEditBlur}
                  onAutoFocused={() => setAutoFocusedKeys((prev) => new Set([...prev, block._key]))}
                  onFocusInput={() => handleBlockTapFocus(block._key)}
                  onActivateApply={(fn) => { activeApplyRef.current = fn; }}
                  onDeactivateApply={(fn) => { if (activeApplyRef.current === fn) activeApplyRef.current = null; }}
                />
              )}
              {block.type === "code" && (
                <CodeBlockItem
                  block={block as CodeBlock}
                  isPreview={isPreview}
                  deckSqlStages={deckSqlStages}
                  deckHtmlStages={deckHtmlStages}
                  deckHtmlImages={deckHtmlImages}
                  onChange={(patch) =>
                    updateBlock(activeTab, block._key, patch)
                  }
                  onDelete={() => deleteBlock(activeTab, block._key)}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  collapsed={isSortMode}
                  flashTrigger={flashTrigger}
                  autoFocus={!autoFocusedKeys.has(block._key) && block._key === newBlockKey}
                  isFocused={focusedBlockIndex === index}
                  editTrigger={editTriggerMap[block._key] ?? 0}
                  restoreTrigger={restoreTriggerMap[block._key] ?? 0}
                  blurTrigger={blurTriggerMap[block._key] ?? 0}
                  onEditBlur={handleBlockEditBlur}
                  onAutoFocused={() => setAutoFocusedKeys((prev) => new Set([...prev, block._key]))}
                  runTrigger={runTriggerMap[block._key] ?? 0}
                  onRunButtonPress={() =>
                    handleCodeBlockRunButtonPress(block._key)
                  }
                  onRunStart={() => {
                    // 058：実行結果（エラー・出力・プレビュー）を必要な分だけ見せる。収まらなければ先頭（エラー）を優先
                    //（以前は「ブロック末尾−300」へ送っていたため、プレビューの下まで進んでエラーが半分隠れた）
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos) return;
                      const out = subLayoutsRef.current[`${block._key}:__out`];
                      scrollRangeIntoView(pos.y + (out?.y ?? 0), pos.y + pos.h);
                    }, 300);
                  }}
                  onCodeAreaLayout={(y, h) => { subLayoutsRef.current[`${block._key}:__code`] = { y, h }; }}
                  onOutputLayout={(y) => { subLayoutsRef.current[`${block._key}:__out`] = { y, h: 0 }; }}
                  onFocusInput={(sub) => handleBlockTapFocus(block._key, sub)}
                  focusedSub={focusedBlockIndex === index ? focusedSub : null}
                  onSubLayout={(sub, y, h) => { subLayoutsRef.current[`${block._key}:${sub}`] = { y, h }; }}
                  initEditTrigger={initEditTriggerMap[block._key]}
                  langPickerTrigger={langPickerTriggerMap[block._key] ?? 0}
                  onOverlayChange={setLangOverlayOpen}
                  outputKeyTrigger={outputKeyTriggerMap[block._key] ?? null}
                />
              )}
              {block.type === "image" && (
                <ImageBlockItem
                  block={block as ImageBlock}
                  onChange={(patch) =>
                    updateBlock(activeTab, block._key, patch)
                  }
                  onDelete={() => deleteBlock(activeTab, block._key)}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  collapsed={isSortMode}
                  flashTrigger={flashTrigger}
                  autoFocus={!autoFocusedKeys.has(block._key) && block._key === newBlockKey}
                  isFocused={focusedBlockIndex === index}
                  blurTrigger={blurTriggerMap[block._key] ?? 0}
                  onEditBlur={handleBlockEditBlur}
                  onAutoFocused={() => setAutoFocusedKeys((prev) => new Set([...prev, block._key]))}
                  onFocusInput={() => handleBlockTapFocus(block._key)}
                  isPreview={isPreview}
                />
              )}
            </View>
          );
        })}
        {footerContent}
        </Pressable>
      </ScrollView>
      <ConfirmDeleteModal
        visible={pendingDeleteBlock !== null}
        message={t("editor.deleteBlockConfirm")}
        onConfirm={() => {
          if (pendingDeleteBlock) {
            deleteBlock(pendingDeleteBlock.tab, pendingDeleteBlock.key);
            setFocusedBlockIndex(null);
          }
          setPendingDeleteBlock(null);
        }}
        onClose={() => setPendingDeleteBlock(null)}
      />
      {/* 056：タグ選択シート（タグ欄にフォーカスして Return）。タップのチップ選択はそのまま */}
      <MultiSelectPickerModal
        visible={tagPickerVisible}
        title={t("editor.tagPickerTitle")}
        items={tagPickerItems}
        selectedIds={tagIds}
        onToggle={(id) => setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
        onClose={() => setTagPickerVisible(false)}
      />
      {/* 058：デッキ土台が2つ以上のブロックで、どれを積むかを選ぶ一覧（止まり先で Return） */}
      {(() => {
        const block = stageChoice ? currentBlocks.find((b) => b._key === stageChoice.key) as (CodeBlock & { _key: string }) | undefined : undefined;
        const kind = stageChoice?.kind ?? "html";
        const stages = (kind === "html" ? deckHtmlStages : deckSqlStages) ?? [];
        const activeId = block
          ? kind === "html"
            ? activeDeckStageId(stages, block.noDeckHtmlInit, block.deckStageId)
            : activeDeckStageId(stages, block.noDeckSqlInit, block.deckSqlStageId)
          : null;
        return (
          <DeckStageChoiceModal
            visible={!!block}
            kind={kind}
            stages={stages}
            activeStageId={activeId}
            onSelect={(id) => {
              if (!block) return;
              const patch: Partial<CodeBlock> = kind === "html"
                ? (id === null ? { noDeckHtmlInit: true } : { noDeckHtmlInit: false, deckStageId: id })
                : (id === null ? { noDeckSqlInit: true } : { noDeckSqlInit: false, deckSqlStageId: id });
              updateBlock(activeTab, block._key, patch);
            }}
            onClose={() => setStageChoice(null)}
          />
        );
      })()}
      <ArchivePill archived={archivePill} />
    </KeyboardAvoidingView>
    </InteractivePreviewContext.Provider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    gap: 0,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: "#1976D2" },
  tabText: { fontWeight: "500" },
  tabTextActive: { color: "#1976D2", fontWeight: "700" },
  tabDotContainer: {
    position: "absolute",
    top: 4,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  tabDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  modeButtons: {
    marginLeft: "auto",
    flexDirection: "row",
    alignSelf: "center",
    gap: 4,
  },
  modeBtn: {
    paddingVertical: 7,
    borderRadius: 6,
  },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  addArea: { marginTop: 4 },
  sortHint: { textAlign: "center", marginTop: 12 },
  addBtn: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  addMenu: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  addMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  addMenuIcon: {
    fontWeight: "700",
    color: "#1976D2",
    width: 36,
    textAlign: "center",
  },
  addMenuLabel: { flex: 1 },
  addMenuCancelText: { textAlign: "center" },
  addBtnText: {},
  addMenuIconWrap: { width: 36, alignItems: "center" },
  addMenuCancel: { paddingVertical: 12, alignItems: "center" },
  // デッキ/タグ編集・設定画面の白枠と同じ見た目（枠線なし・弱い影・角丸12）
  whiteCard: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...SHADOW.subtle,
  },
  tagSection: { gap: 8, marginTop: 12 },
  tagLabel: { fontWeight: "600" },
  deckRow: {
    gap: 4,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // ⓘ タップで開くインライン説明（デッキ編集と同じ見せ方）
  archiveInfoBox: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  archiveCard: { marginTop: 12 },
  archiveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  deckName: { fontWeight: "600" },
  focusRing: { position: "absolute", borderWidth: 2 },
  // ＋ブロック追加のボタンにぴったり重ねる（addArea は余白なし・ボタンの角丸 10）
  focusRingCard: { top: 0, bottom: 0, left: 0, right: 0, borderRadius: 10 },
  // タグ・アーカイブの白枠（枠線なし）の縁にぴったり重ねる
  focusRingWhiteCard: { top: 0, bottom: 0, left: 0, right: 0, borderRadius: 12 },
  validationError: { textAlign: "center" },
});

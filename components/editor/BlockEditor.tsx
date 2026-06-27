import { Ionicons } from "@expo/vector-icons";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Dispatch,
  type Ref,
  type SetStateAction
} from "react";
import { useTranslation } from "react-i18next";
import {
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";

import { constants as KeyCommand } from "react-native-key-command";

import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { DeckIcon } from "@/components/DeckIcon";
import { EXECUTABLE_LANGUAGES } from "@/lib/code-execution/constants";
import type { MdAction } from "@/lib/editor/applyMarkdown";
import { useKeyCommands } from "@/lib/useKeyCommands";
import { MAX_FONT_MULTIPLIER, useTheme } from "@/lib/theme";
import { useSettingsStore } from "@/store/settings";
import type { Block, CodeBlock, ImageBlock, TextBlock } from "@/types";
import { CodeBlockItem } from "./CodeBlockItem";
import { ImageBlockItem } from "./ImageBlockItem";
import { MarkdownToolbar, MD_TOOLBAR_ID } from "./MarkdownToolbar";
import { TagSelector } from "./TagSelector";
import { TextBlockItem } from "./TextBlockItem";

type Tab = "front" | "back" | "memo";
export type EditorMode = "edit" | "sort" | "preview";

// エディタ内部でブロックを一意に識別するためのローカルキー付き型
type EditBlock = Block & { _key: string };

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
  deckSqlInit?: string | null;
  onSave: (data: BlockEditorData) => Promise<void>;
  onFrontEmptyChange?: (isEmpty: boolean) => void;
  saving: boolean;
  /** 新規カード作成時は true → 最初のテキストブロックを自動フォーカス。編集時は false/省略 → タップするまでフォーカスなし */
  isNewCard?: boolean;
  /** C キーでキャンセル */
  onCancel?: () => void;
  /** フォーカスなし時の D キーでカード削除 */
  onDeleteCard?: () => void;
  /** モード（edit / sort / preview）が変わったときに通知する */
  onModeChange?: (mode: EditorMode) => void;
  /** カードのアーカイブ状態。onArchivedChange を渡したときだけ末尾にトグルを表示する（編集時のみ） */
  archived?: boolean;
  onArchivedChange?: (v: boolean) => void;
  ref?: Ref<BlockEditorRef>;
}

export function BlockEditor({
  initialData,
  initialTab,
  deckName,
  deckIconName,
  deckColorHex,
  deckSqlInit,
  onSave,
  onFrontEmptyChange,
  saving: _saving,
  isNewCard,
  onCancel,
  onDeleteCard,
  onModeChange,
  archived,
  onArchivedChange,
  ref,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
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
    const showSub = Keyboard.addListener(showEvt, (e) => setKeyboardPadding(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardPadding(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  const scrollViewHeightRef = useRef(windowHeight);
  const scrollPosRef = useRef<Record<Tab, number>>({
    front: 0,
    back: 0,
    memo: 0,
  });
  const blockPositions = useRef<Record<string, { y: number; h: number }>>({});

  // 共有マークダウンツールバー（InputAccessoryView）から、現在フォーカス中の
  // テキストブロックへ記法を適用するための登録口。フォーカス中ブロックが自分の
  // apply 関数を登録し、ツールバーのボタンはそれを呼ぶ。
  const activeWrapRef = useRef<((action: MdAction) => void) | null>(null);
  // InputAccessoryView のマウント戦略:
  // - iOS は「キーボード出現と同時にマウントされた accessory」しかリンクしない。先に常設すると
  //   後からのフォーカスにリンクされず、編集画面でツールバーが出ない（新規作成は autoFocus で
  //   キーボード出現と同時にマウントされるため出る）。→ 初回フォーカスでマウントする必要がある。
  // - 一方、ブラーのたびにアンマウントすると、タッチを横取りする残留ビューが生じ下部ボタンが
  //   反応しなくなる。→ 一度マウントしたらアンマウントしない。
  // 結論: 初回フォーカスでマウント（toolbarMounted を立てる）→ 以後アンマウントせず、表示/非表示は
  //   opacity で切り替える（toolbarActive）。
  const [toolbarMounted, setToolbarMounted] = useState(false);
  const [toolbarActive, setToolbarActive] = useState(false);
  const activateToolbar = useCallback((apply: (action: MdAction) => void) => {
    activeWrapRef.current = apply;
    setToolbarMounted(true);
    setToolbarActive(true);
  }, []);
  const deactivateToolbar = useCallback((apply: (action: MdAction) => void) => {
    // 別ブロックが既に登録を引き継いでいる場合は消さない（フォーカス移動時の競合対策）
    if (activeWrapRef.current === apply) {
      activeWrapRef.current = null;
      setToolbarActive(false); // マウントは維持。表示だけ消す。
    }
  }, []);
  const handleToolbarAction = useCallback((action: MdAction) => {
    activeWrapRef.current?.(action);
  }, []);
  const focusedBlockIndexRef = useRef<number | null>(null);
  const activeTabRef = useRef<Tab>("front");
  const editorModeRef = useRef<EditorMode>("edit");
  const isSortModeRef = useRef(false);
  const isPreviewRef = useRef(false);
  const currentBlocksRef = useRef<EditBlock[]>([]);
  const addMenuVisibleRef = useRef(false);
  const addMenuFocusIndexRef = useRef(0);
  const editingBlockKeyRef = useRef<string | null>(null);
  const addAreaYRef = useRef(0);

  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? "front");
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  const isPreview = editorMode === "preview";
  const isSortMode = editorMode === "sort";
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
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [addMenuFocusIndex, setAddMenuFocusIndex] = useState(0);
  const [selectedBlockKey, setSelectedBlockKey] = useState<string | null>(null);
  const [moveCount, setMoveCount] = useState(0);
  const [newBlockKey, setNewBlockKey] = useState<string | null>(null);
  const [autoFocusedKeys, setAutoFocusedKeys] = useState<Set<string>>(new Set());
  const [focusedBlockIndex, setFocusedBlockIndex] = useState<number | null>(
    null,
  );
  const [editTriggerMap, setEditTriggerMap] = useState<Record<string, number>>(
    {},
  );
  const [runTriggerMap, setRunTriggerMap] = useState<Record<string, number>>(
    {},
  );
  const [blurTriggerMap, setBlurTriggerMap] = useState<Record<string, number>>(
    {},
  );
  const [pendingDeleteBlock, setPendingDeleteBlock] = useState<{ tab: Tab; key: string } | null>(null);

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
  addMenuVisibleRef.current = addMenuVisible;
  addMenuFocusIndexRef.current = addMenuFocusIndex;

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
  function handleBlockTapFocus(blockKey: string) {
    editingBlockKeyRef.current = blockKey;
    setFocusedBlockIndex(null);
  }

  function handleCodeBlockRunButtonPress(blockKey: string) {
    editingBlockKeyRef.current = null;
    const idx = currentBlocksRef.current.findIndex((b) => b._key === blockKey);
    setFocusedBlockIndex(idx !== -1 ? idx : null);
    // 034: ネイティブキーコマンドは画面フォーカス中ずっと有効なので、編集終了後に隠し
    // 入力へフォーカスを戻す必要はない（実入力が外れた時点でショートカットが効く＝住み分け）。
  }

  function handleBlockEditBlur() {
    editingBlockKeyRef.current = null;
    // 034: 再フォーカス不要（住み分けは責任者チェーンで自動成立）。
  }

  function startEditFocusedBlock() {
    const idx = focusedBlockIndexRef.current;
    const blocks = currentBlocksRef.current;
    if (idx === null || !blocks[idx]) return;
    const key = blocks[idx]._key;
    setEditTriggerMap((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
    // ブロック末尾（カーソル位置）が画面最下部に来るようスクロール
    const scrollToBlockEnd = () => {
      const pos = blockPositions.current[key];
      if (!pos || !scrollRef.current) return;
      const viewH = scrollViewHeightRef.current;
      scrollRef.current.scrollTo({
        y: Math.max(0, pos.y + pos.h - viewH + 24),
        animated: false,
      });
    };
    setTimeout(() => scrollToBlockEnd(), 100);
    setTimeout(() => {
      const pos = blockPositions.current[key];
      if (!pos || !scrollRef.current) return;
      const viewH = scrollViewHeightRef.current;
      scrollRef.current.scrollTo({
        y: Math.max(0, pos.y + pos.h - viewH + 24),
        animated: true,
      });
    }, 350);
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

    const cycleMode = () => {
      const modes: EditorMode[] = ["edit", "sort", "preview"];
      setEditorMode((prev) => modes[(modes.indexOf(prev) + 1) % 3]);
    };

    if (inSort) {
      if (k === "j") {
        setSelectedBlockKey(null);
        setFocusedBlockIndex((prev) => {
          if (prev === null) return blocks.length > 0 ? 0 : null;
          return prev < blocks.length - 1 ? prev + 1 : null;
        });
      } else if (k === "k") {
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
      }
      return;
    }

    // プレビューモードでは ',' / '.' / M / S / X のみ受け付け、
    // J / K / R / T / D / E / A は無効化
    if (isPreviewRef.current && k !== "m" && k !== "," && k !== "." && k !== "s" && k !== "x") {
      return;
    }

    if (k === "j") {
      setFocusedBlockIndex((prev) => {
        if (prev === null) return blocks.length > 0 ? 0 : null;
        return prev < blocks.length - 1 ? prev + 1 : null;
      });
    } else if (k === "k") {
      setFocusedBlockIndex((prev) => {
        if (prev === null) return blocks.length > 0 ? blocks.length - 1 : null;
        return prev > 0 ? prev - 1 : null;
      });
    } else if (k === "m") {
      cycleMode();
    } else if (key === ",") {
      const tabOrder: Tab[] = ["front", "back", "memo"];
      setEditTriggerMap({});
      setRunTriggerMap({});
      setActiveTab((prev) => tabOrder[(tabOrder.indexOf(prev) - 1 + 3) % 3]);
    } else if (key === ".") {
      const tabOrder: Tab[] = ["front", "back", "memo"];
      setEditTriggerMap({});
      setRunTriggerMap({});
      setActiveTab((prev) => tabOrder[(tabOrder.indexOf(prev) + 1) % 3]);
    } else if (k === "a") {
      if (!isPreviewRef.current) {
        setAddMenuVisible((v) => {
          if (!v) {
            // メニューを開く: ブロックフォーカス解除・メニュー先頭を選択
            setFocusedBlockIndex(null);
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
    } else if (k === "d") {
      if (idx !== null && blocks[idx]) {
        const block = blocks[idx];
        const isEmpty =
          block.type === "image"
            ? !(block as ImageBlock).uri
            : (block as TextBlock | CodeBlock).content.trim() === "";
        if (isEmpty) {
          deleteBlock(tab, block._key);
          setFocusedBlockIndex(null);
        } else {
          setPendingDeleteBlock({ tab, key: block._key });
        }
      } else {
        onDeleteCard?.();
      }
    } else if (k === "x") {
      onCancel?.();
    } else if (k === "s") {
      handleSave();
    } else if (k === "e") {
      startEditFocusedBlock();
    } else if (k === "t") {
      scrollRef.current?.scrollToEnd({ animated: true });
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

  const footerContent = (
    <>
      {/* ブロック追加ボタン */}
      {!isPreview && (
        <View
          style={styles.addArea}
          onLayout={(e) => {
            addAreaYRef.current = e.nativeEvent.layout.y;
          }}
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
                editingBlockKeyRef.current = null;
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
        </View>
      )}

      {/* タグ選択・デッキ名（プレビュー時は非表示） */}
      {!isPreview && (
        <>
          <View style={styles.tagSection}>
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
          </View>

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

          {/* アーカイブトグル（編集時のみ）。タグ・デッキと並ぶカード単位のメタ情報 */}
          {onArchivedChange && (
            <View style={[styles.archiveRow, { borderColor: theme.colors.inputBorder, backgroundColor: theme.colors.surface }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={[styles.tagLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("deck.archive")}
                </Text>
                <Text
                  style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("deck.archiveHint")}
                </Text>
              </View>
              <Switch
                value={!!archived}
                onValueChange={onArchivedChange}
                trackColor={{ true: theme.colors.primary }}
                thumbColor="#FFF"
              />
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

  // 034: 隠し TextInput を撤去しネイティブキーコマンドへ。既存の handleKeyPress(key)
  // ディスパッチをそのまま流用し、各キーから呼ぶ。ブロックの実 TextInput がフォーカス中は
  // OS がキーを入力欄へ渡すため、ショートカットは自然と発火しない（住み分け＝本チケットの肝）。
  // Return: 追加メニュー表示中は項目決定、それ以外はフォーカス中ブロックの編集開始（旧 onSubmitEditing）。
  useKeyCommands([
    { input: "j", handler: () => handleKeyPress("j") },
    { input: "k", handler: () => handleKeyPress("k") },
    { input: "m", handler: () => handleKeyPress("m") },
    { input: "a", handler: () => handleKeyPress("a") },
    { input: "r", handler: () => handleKeyPress("r") },
    { input: "d", handler: () => handleKeyPress("d") },
    { input: "x", handler: () => handleKeyPress("x") },
    { input: "s", handler: () => handleKeyPress("s") },
    { input: "e", handler: () => handleKeyPress("e") },
    { input: "t", handler: () => handleKeyPress("t") },
    { input: "u", handler: () => handleKeyPress("u") },
    { input: ",", handler: () => handleKeyPress(",") },
    { input: ".", handler: () => handleKeyPress(".") },
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (!keyboardShortcutsEnabled) return;
        if (addMenuVisibleRef.current) {
          selectAddMenuItem(addMenuFocusIndexRef.current);
          return;
        }
        startEditFocusedBlock();
      },
    },
  ]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 共有マークダウン装飾ツールバー（キーボード上端）。
          - 初回フォーカスでマウント（toolbarMounted）→ iOS がキーボードにリンクし表示される。
            常設すると後からのフォーカスにリンクされず表示されないため、フォーカス時マウントが必須。
          - 一度マウントしたらアンマウントしない（残留ビューによる下部ボタン不調を防ぐ）。
          - 表示/非表示は opacity と pointerEvents（toolbarActive）で切り替え、非表示時はタップ透過。 */}
      {Platform.OS === "ios" && toolbarMounted && (
        <InputAccessoryView nativeID={MD_TOOLBAR_ID}>
          <View style={{ opacity: toolbarActive ? 1 : 0 }} pointerEvents={toolbarActive ? "auto" : "none"}>
            <MarkdownToolbar onAction={handleToolbarAction} />
          </View>
        </InputAccessoryView>
      )}
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
          const hasDot = blocks.some((b) =>
            b.type === 'image' ? !!b.uri : b.content.trim() !== ''
          );
          return (
            <Pressable
              key={tab.key}
              style={[
                styles.tab,
                (Platform as any).isPad && styles.tabPad,
                activeTab === tab.key && styles.tabActive,
              ]}
              onPress={() => {
                // 034: タブ切替時は編集中ブロックを解除しキーボードを閉じる。
                // ネイティブキーコマンドは画面フォーカス中ずっと有効なので再フォーカス不要。
                editingBlockKeyRef.current = null;
                Keyboard.dismiss();
                setAddMenuVisible(false);
                setEditTriggerMap({});
                setRunTriggerMap({});
                setBlurTriggerMap({});
                setActiveTab(tab.key);
              }}
            >
              <Text
                style={[
                  styles.tabText,
                  {
                    color: theme.colors.textTertiary,
                    fontSize: (Platform as any).isPad ? Math.max(theme.fontSize.lg, 18) : Math.max(theme.fontSize.md, 16),
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
                    paddingHorizontal: (Platform as any).isPad ? 32 : 9,
                  },
                  active && { backgroundColor: theme.colors.primary },
                ]}
                onPress={() => {
                  // 034: モード切替時に編集中ブロックがあれば解除しキーボードを閉じる（再フォーカス不要）。
                  if (editingBlockKeyRef.current) {
                    editingBlockKeyRef.current = null;
                    Keyboard.dismiss();
                    setBlurTriggerMap({});
                  }
                  setEditorMode(mode);
                }}
              >
                <Ionicons
                  name={icon}
                  size={(Platform as any).isPad ? Math.max(theme.fontSize.lg, 20) : Math.max(theme.fontSize.lg, 18)}
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
        contentContainerStyle={{ flexGrow: 1, paddingBottom: keyboardPadding }}
        onLayout={(e) => {
          scrollViewHeightRef.current = e.nativeEvent.layout.height;
        }}
        keyboardShouldPersistTaps="handled"
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
                  blurTrigger={blurTriggerMap[block._key] ?? 0}
                  onEditBlur={handleBlockEditBlur}
                  onAutoFocused={() => setAutoFocusedKeys((prev) => new Set([...prev, block._key]))}
                  onFocusInput={() => handleBlockTapFocus(block._key)}
                  onActivateToolbar={activateToolbar}
                  onDeactivateToolbar={deactivateToolbar}
                />
              )}
              {block.type === "code" && (
                <CodeBlockItem
                  block={block as CodeBlock}
                  isPreview={isPreview}
                  deckSqlInit={deckSqlInit}
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
                  blurTrigger={blurTriggerMap[block._key] ?? 0}
                  onEditBlur={handleBlockEditBlur}
                  onAutoFocused={() => setAutoFocusedKeys((prev) => new Set([...prev, block._key]))}
                  runTrigger={runTriggerMap[block._key] ?? 0}
                  onRunButtonPress={() =>
                    handleCodeBlockRunButtonPress(block._key)
                  }
                  onRunStart={() => {
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos || !scrollRef.current) return;
                      scrollRef.current.scrollTo({
                        y: Math.max(0, pos.y + pos.h - 300),
                        animated: true,
                      });
                    }, 300);
                  }}
                  onFocusInput={() => handleBlockTapFocus(block._key)}
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
    </KeyboardAvoidingView>
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
  tabPad: {
    paddingHorizontal: 28,
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
  tagSection: { gap: 8, marginTop: 12 },
  tagLabel: { fontWeight: "600" },
  deckRow: {
    gap: 4,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  archiveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  deckName: { fontWeight: "600" },
  validationError: { textAlign: "center" },
});

import { Ionicons } from "@expo/vector-icons";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Dispatch,
  type Ref,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";

import { EXECUTABLE_LANGUAGES } from "@/lib/code-execution/constants";
import { useTheme, MAX_FONT_MULTIPLIER } from "@/lib/theme";
import { useSettingsStore } from "@/store/settings";
import type { Block, CodeBlock, ImageBlock, TextBlock } from "@/types";
import { CodeBlockItem } from "./CodeBlockItem";
import { ImageBlockItem } from "./ImageBlockItem";
import { TagSelector } from "./TagSelector";
import { TextBlockItem } from "./TextBlockItem";

type Tab = "front" | "back" | "memo";
type EditorMode = "edit" | "sort" | "preview";

// エディタ内部でブロックを一意に識別するためのローカルキー付き型
type EditBlock = Block & { _key: string };

function makeKey() {
  return Math.random().toString(36).slice(2, 9);
}

function toEditBlocks(blocks: Block[]): EditBlock[] {
  return blocks.map((b) => ({ ...b, _key: makeKey() }));
}

function fromEditBlocks(blocks: EditBlock[]): Block[] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
}

interface Props {
  initialData?: Partial<BlockEditorData>;
  initialTab?: Tab;
  deckName?: string;
  onSave: (data: BlockEditorData) => Promise<void>;
  onFrontEmptyChange?: (isEmpty: boolean) => void;
  saving: boolean;
  /** 新規カード作成時は true → 最初のテキストブロックを自動フォーカス。編集時は false/省略 → タップするまでフォーカスなし */
  isNewCard?: boolean;
  /** C キーでキャンセル */
  onCancel?: () => void;
  /** フォーカスなし時の D キーでカード削除 */
  onDeleteCard?: () => void;
  ref?: Ref<BlockEditorRef>;
}

export function BlockEditor({
  initialData,
  initialTab,
  deckName,
  onSave,
  onFrontEmptyChange,
  saving: _saving,
  isNewCard,
  onCancel,
  onDeleteCard,
  ref,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const scrollViewHeightRef = useRef(windowHeight);
  const scrollPosRef = useRef<Record<Tab, number>>({ front: 0, back: 0, memo: 0 });
  const blockPositions = useRef<Record<string, { y: number; h: number }>>({});
  const keyboardRef = useRef<TextInput>(null);
  const focusedBlockIndexRef = useRef<number | null>(null);
  const isTransitioningRef = useRef(false);
  const isTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabRef = useRef<Tab>('front');
  const editorModeRef = useRef<EditorMode>("edit");
  const isSortModeRef = useRef(false);
  const isPreviewRef = useRef(false);
  const currentBlocksRef = useRef<EditBlock[]>([]);
  const addMenuVisibleRef = useRef(false);
  const addMenuFocusIndexRef = useRef(0);
  const editingBlockKeyRef = useRef<string | null>(null);
  const isNavigatingRef = useRef(false);
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
  const [focusedBlockIndex, setFocusedBlockIndex] = useState<number | null>(null);
  const [editTriggerMap, setEditTriggerMap] = useState<Record<string, number>>({});
  const [runTriggerMap, setRunTriggerMap] = useState<Record<string, number>>({});

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
  const ADD_MENU_ITEMS = ['text', 'code', 'image', 'cancel'] as const;
  function selectAddMenuItem(idx: number) {
    const item = ADD_MENU_ITEMS[idx];
    if (item === 'cancel') {
      setAddMenuVisible(false);
    } else {
      addBlock(item);
    }
  }

  function moveBlock(tab: Tab, key: string, direction: 'up' | 'down') {
    const blocks = blocksByTab[tab];
    const idx = blocks.findIndex((b) => b._key === key);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === blocks.length - 1) return;

    setSelectedBlockKey(key);
    setMoveCount((c) => c + 1);
    setterByTab[tab]((prev) => {
      const next = [...prev];
      const target = direction === 'up' ? idx - 1 : idx + 1;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    // レイアウト更新後に移動先ブロックへスクロール
    setTimeout(() => {
      const pos = blockPositions.current[key];
      if (pos && scrollRef.current) {
        scrollRef.current.scrollTo({ y: Math.max(0, pos.y - 60), animated: true });
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
    if (editorMode !== "sort") setSelectedBlockKey(null);
  }, [editorMode]);

  useEffect(() => {
    if (addMenuVisible) {
      setTimeout(() => {
        // scrollToEnd ではメニュー下のタグ欄まで行き過ぎるため、
        // addArea の先頭が画面上端付近に来るようスクロールする
        scrollRef.current?.scrollTo({ y: Math.max(0, addAreaYRef.current - 16), animated: true });
      }, 50);
    }
  }, [addMenuVisible]);

  // タブ切替でブロックフォーカスをリセット＋スクロール位置を個別に復元
  useEffect(() => {
    setFocusedBlockIndex(null);
    scrollRef.current?.scrollTo({ y: scrollPosRef.current[activeTab], animated: false });
  }, [activeTab]);

  // ブロック数変化時にフォーカスインデックスを補正
  // functional update にすることで、同一コミット内で先に走る [activeTab] effect の
  // setFocusedBlockIndex(null) をバッチ後の最新値として参照できる（古い値で上書きしない）
  useEffect(() => {
    setFocusedBlockIndex(prev => {
      if (prev !== null && prev >= currentBlocks.length) {
        return currentBlocks.length > 0 ? currentBlocks.length - 1 : null;
      }
      return prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBlocks.length]);

  // フォーカス中ブロックへスクロール
  useEffect(() => {
    if (focusedBlockIndex === null) return;
    const block = currentBlocks[focusedBlockIndex];
    if (!block) return;
    setTimeout(() => {
      const pos = blockPositions.current[block._key];
      if (!pos || !scrollRef.current) return;
      scrollRef.current.scrollTo({ y: Math.max(0, pos.y - 80), animated: true });
    }, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedBlockIndex]);

  // 編集画面マウント時に hidden TextInput をフォーカス
  useEffect(() => {
    if (!isNewCard && keyboardShortcutsEnabled) {
      setTimeout(() => keyboardRef.current?.focus(), 150);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ブロックの TextInput がフォーカスされたとき呼ぶ（タップ・Return/E キー共通）。
  // handleBlockEditBlur が仕掛けた「hidden TextInput へ戻す」タイマーをキャンセルし、
  // J/K キーボードフォーカス（focusedBlockIndex）もクリアする。
  // editingBlockKeyRef に現在編集中のブロックキーを記録し、
  // keyboardWillShow 時のスクロールに使用する。
  function handleBlockTapFocus(blockKey: string) {
    editingBlockKeyRef.current = blockKey;
    if (isTransitionTimerRef.current) {
      clearTimeout(isTransitionTimerRef.current);
      isTransitionTimerRef.current = null;
    }
    setFocusedBlockIndex(null);
  }

  function handleCodeBlockRunButtonPress(blockKey: string) {
    editingBlockKeyRef.current = null;
    if (isTransitionTimerRef.current) clearTimeout(isTransitionTimerRef.current);
    const idx = currentBlocksRef.current.findIndex(b => b._key === blockKey);
    setFocusedBlockIndex(idx !== -1 ? idx : null);
    isTransitionTimerRef.current = setTimeout(() => {
      keyboardRef.current?.focus();
    }, 200);
  }

  function handleBlockEditBlur() {
    editingBlockKeyRef.current = null;
    if (isTransitioningRef.current || isNavigatingRef.current) return;
    if (isTransitionTimerRef.current) clearTimeout(isTransitionTimerRef.current);
    isTransitionTimerRef.current = setTimeout(() => {
      keyboardRef.current?.focus();
    }, 200);
  }

  function startEditFocusedBlock() {
    const idx = focusedBlockIndexRef.current;
    const blocks = currentBlocksRef.current;
    if (idx === null || !blocks[idx]) return;
    const key = blocks[idx]._key;
    isTransitioningRef.current = true;
    setEditTriggerMap(prev => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
    setTimeout(() => { isTransitioningRef.current = false; }, 300);
    // ブロック末尾（カーソル位置）が画面最下部に来るようスクロール
    const scrollToBlockEnd = () => {
      const pos = blockPositions.current[key];
      if (!pos || !scrollRef.current) return;
      const viewH = scrollViewHeightRef.current;
      scrollRef.current.scrollTo({ y: Math.max(0, pos.y + pos.h - viewH + 24), animated: false });
    };
    setTimeout(() => scrollToBlockEnd(), 100);
    setTimeout(() => {
      const pos = blockPositions.current[key];
      if (!pos || !scrollRef.current) return;
      const viewH = scrollViewHeightRef.current;
      scrollRef.current.scrollTo({ y: Math.max(0, pos.y + pos.h - viewH + 24), animated: true });
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
      if (k === 'j') {
        setAddMenuFocusIndex(prev => (prev + 1) % menuLen);
      } else if (k === 'k') {
        setAddMenuFocusIndex(prev => (prev - 1 + menuLen) % menuLen);
      } else if (k === 'a') {
        setAddMenuVisible(false);
      }
      // Return は onSubmitEditing で処理
      return;
    }

    const cycleMode = () => {
      const modes: EditorMode[] = ["edit", "sort", "preview"];
      setEditorMode(prev => modes[(modes.indexOf(prev) + 1) % 3]);
    };

    if (inSort) {
      if (k === 'j') {
        setSelectedBlockKey(null);
        setFocusedBlockIndex(prev => {
          if (prev === null) return blocks.length > 0 ? 0 : null;
          return prev < blocks.length - 1 ? prev + 1 : null;
        });
      } else if (k === 'k') {
        setSelectedBlockKey(null);
        setFocusedBlockIndex(prev => {
          if (prev === null) return blocks.length > 0 ? blocks.length - 1 : null;
          return prev > 0 ? prev - 1 : null;
        });
      } else if (k === 'u') {
        if (idx !== null && blocks[idx] && idx > 0) {
          moveBlock(tab, blocks[idx]._key, 'up');
          setFocusedBlockIndex(idx - 1);
        }
      } else if (k === 'd') {
        if (idx !== null && blocks[idx] && idx < blocks.length - 1) {
          moveBlock(tab, blocks[idx]._key, 'down');
          setFocusedBlockIndex(idx + 1);
        }
      } else if (k === 'q') {
        cycleMode();
      }
      return;
    }

    if (k === 'j') {
      setFocusedBlockIndex(prev => {
        if (prev === null) return blocks.length > 0 ? 0 : null;
        return prev < blocks.length - 1 ? prev + 1 : null;
      });
    } else if (k === 'k') {
      setFocusedBlockIndex(prev => {
        if (prev === null) return blocks.length > 0 ? blocks.length - 1 : null;
        return prev > 0 ? prev - 1 : null;
      });
    } else if (k === 'q') {
      cycleMode();
    } else if (key === ',') {
      const tabOrder: Tab[] = ['front', 'back', 'memo'];
      setEditTriggerMap({});
      setRunTriggerMap({});
      setActiveTab(prev => tabOrder[(tabOrder.indexOf(prev) - 1 + 3) % 3]);
    } else if (key === '.') {
      const tabOrder: Tab[] = ['front', 'back', 'memo'];
      setEditTriggerMap({});
      setRunTriggerMap({});
      setActiveTab(prev => tabOrder[(tabOrder.indexOf(prev) + 1) % 3]);
    } else if (k === 'a') {
      if (!isPreviewRef.current) {
        setAddMenuVisible(v => {
          if (!v) {
            // メニューを開く: ブロックフォーカス解除・メニュー先頭を選択
            setFocusedBlockIndex(null);
            setAddMenuFocusIndex(0);
          }
          return !v;
        });
      }
    } else if (k === 'r') {
      if (idx !== null && blocks[idx]?.type === 'code') {
        const blockKey = blocks[idx]._key;
        if ((blocks[idx] as CodeBlock & { _key: string }).executable) {
          setRunTriggerMap(prev => ({ ...prev, [blockKey]: (prev[blockKey] ?? 0) + 1 }));
        }
      }
    } else if (k === 'd') {
      if (idx !== null && blocks[idx]) {
        const block = blocks[idx];
        const isEmpty =
          block.type === 'image'
            ? !(block as ImageBlock).uri
            : (block as TextBlock | CodeBlock).content.trim() === '';
        if (isEmpty) {
          deleteBlock(tab, block._key);
          setFocusedBlockIndex(null);
        } else {
          Alert.alert(t('card.deleteBlock'), t('card.deleteBlockConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: () => {
                deleteBlock(tab, block._key);
                setFocusedBlockIndex(null);
              },
            },
          ]);
        }
      } else {
        onDeleteCard?.();
      }
    } else if (k === 'x') {
      isNavigatingRef.current = true;
      if (isTransitionTimerRef.current) {
        clearTimeout(isTransitionTimerRef.current);
        isTransitionTimerRef.current = null;
      }
      onCancel?.();
    } else if (k === 's') {
      handleSave();
    } else if (k === 'e') {
      startEditFocusedBlock();
    } else if (k === 't') {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }

  async function handleSave() {
    if (isFrontEmpty) return;
    isNavigatingRef.current = true;
    if (isTransitionTimerRef.current) {
      clearTimeout(isTransitionTimerRef.current);
      isTransitionTimerRef.current = null;
    }
    await onSave({
      frontBlocks: fromEditBlocks(frontBlocks),
      backBlocks: fromEditBlocks(backBlocks),
      memoBlocks: fromEditBlocks(memoBlocks),
      tagIds,
    });
  }

  useImperativeHandle(ref, () => ({
    save: handleSave,
    prepareForNavigation: () => {
      isNavigatingRef.current = true;
      if (isTransitionTimerRef.current) {
        clearTimeout(isTransitionTimerRef.current);
        isTransitionTimerRef.current = null;
      }
    },
  }), [handleSave]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "front", label: t("common.front") },
    { key: "back", label: t("common.back") },
    { key: "memo", label: t("common.memo") },
  ];

  const footerContent = (
    <>
      {/* ブロック追加ボタン */}
      {!isPreview && (
        <View style={styles.addArea} onLayout={(e) => { addAreaYRef.current = e.nativeEvent.layout.y; }}>
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
                  addMenuFocusIndex === 0 && { backgroundColor: theme.colors.primaryLight },
                ]}
                onPress={() => addBlock("text")}
              >
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.addMenuIcon, { fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>T</Text>
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
                  addMenuFocusIndex === 1 && { backgroundColor: theme.colors.primaryLight },
                ]}
                onPress={() => addBlock("code")}
              >
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.addMenuIcon, { fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{"</>"}</Text>
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
                  addMenuFocusIndex === 2 && { backgroundColor: theme.colors.primaryLight },
                ]}
                onPress={() => addBlock("image")}
              >
                <View style={styles.addMenuIconWrap}>
                  <Ionicons name="image-outline" size={theme.fontSize.xxl} color="#1976D2" />
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
                  addMenuFocusIndex === 3 && { backgroundColor: theme.colors.primaryLight },
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
              style={[
                styles.addBtn,
                { borderColor: theme.colors.iconSubtle },
              ]}
              onPress={() => {
                // 編集中ブロックを解除し keyboardRef に戻してからメニューを開く
                isTransitioningRef.current = true;
                editingBlockKeyRef.current = null;
                if (isTransitionTimerRef.current) {
                  clearTimeout(isTransitionTimerRef.current);
                  isTransitionTimerRef.current = null;
                }
                keyboardRef.current?.focus();
                setTimeout(() => { isTransitioningRef.current = false; }, 100);
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

      {/* タグ選択 */}
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

      {/* デッキ名 */}
      {deckName != null && (
        <View style={[styles.deckRow, { borderColor: theme.colors.border }]}>
          <Text style={[styles.tagLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t("deck.name")}
          </Text>
          <Text style={[styles.deckName, { color: theme.colors.text, fontSize: theme.fontSize.lg, paddingLeft: 8 }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {deckName}
          </Text>
        </View>
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

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <TextInput
        ref={keyboardRef}
        style={styles.hiddenKeyboardInput}
        caretHidden
        keyboardType="ascii-capable"
        showSoftInputOnFocus={false}
        disableKeyboardShortcuts={true}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        onKeyPress={({ nativeEvent: { key } }) => handleKeyPress(key)}
        onSubmitEditing={() => {
          if (!keyboardShortcutsEnabled) return;
          if (addMenuVisibleRef.current) {
            const menuIdx = addMenuFocusIndexRef.current;
            selectAddMenuItem(menuIdx);
            // キャンセル選択時はブロックが新規フォーカスを取得しないため、
            // hidden TextInput を明示的に再フォーカスする
            if (menuIdx === 3) {
              setTimeout(() => keyboardRef.current?.focus(), 100);
            }
            return;
          }
          startEditFocusedBlock();
        }}
      />
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
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => {
              // アンマウント時に onBlur が確実に発火しないため、タブ切替時は明示的に再フォーカスする
              isTransitioningRef.current = true;
              if (isTransitionTimerRef.current) clearTimeout(isTransitionTimerRef.current);
              isTransitionTimerRef.current = setTimeout(() => {
                editingBlockKeyRef.current = null;
                isTransitioningRef.current = false;
                isTransitionTimerRef.current = null;
                keyboardRef.current?.focus();
              }, 200);
              setAddMenuVisible(false);
              setEditTriggerMap({});
              setRunTriggerMap({});
              setActiveTab(tab.key);
            }}
          >
            <Text
              style={[
                styles.tabText,
                {
                  color: theme.colors.textTertiary,
                  fontSize: theme.fontSize.md,
                },
                activeTab === tab.key && styles.tabTextActive,
              ]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
        {/* モード3択ボタン */}
        <View style={styles.modeButtons}>
          {([
            { mode: "edit" as EditorMode,    icon: "pencil-outline"       as const },
            { mode: "sort" as EditorMode,    icon: "reorder-three-outline" as const },
            { mode: "preview" as EditorMode, icon: "eye-outline"           as const },
          ] as const).map(({ mode, icon }) => {
            const active = editorMode === mode;
            return (
              <Pressable
                key={mode}
                style={[
                  styles.modeBtn,
                  { backgroundColor: theme.colors.background, paddingHorizontal: (Platform as any).isPad ? 32 : 9 },
                  active && { backgroundColor: theme.colors.primaryLight },
                ]}
                onPress={() => setEditorMode(mode)}
              >
                <Ionicons
                  name={icon}
                  size={theme.fontSize.lg}
                  color={active ? theme.colors.primary : theme.colors.textSecondary}
                />
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={[styles.scroll, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={styles.content}
        onLayout={(e) => { scrollViewHeightRef.current = e.nativeEvent.layout.height; }}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={(e) => { scrollPosRef.current[activeTabRef.current] = e.nativeEvent.contentOffset.y; }}
      >
        {currentBlocks.map((block, index) => {
          const moveUp = isSortMode && index > 0 ? () => moveBlock(activeTab, block._key, 'up') : undefined;
          const moveDown = isSortMode && index < currentBlocks.length - 1 ? () => moveBlock(activeTab, block._key, 'down') : undefined;
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
                  onChange={(content) => updateBlock(activeTab, block._key, { content })}
                  onDelete={() => deleteBlock(activeTab, block._key)}
                  autoFocus={(isNewCard && index === 0) || block._key === newBlockKey}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  collapsed={isSortMode}
                  flashTrigger={flashTrigger}
                  onCollapsedDoubleTap={() => setEditorMode("edit")}
                  isFocused={focusedBlockIndex === index}
                  editTrigger={editTriggerMap[block._key] ?? 0}
                  onEditBlur={handleBlockEditBlur}
                  onFocusInput={() => handleBlockTapFocus(block._key)}
                />
              )}
              {block.type === "code" && (
                <CodeBlockItem
                  block={block as CodeBlock}
                  isPreview={isPreview}
                  onChange={(patch) => updateBlock(activeTab, block._key, patch)}
                  onDelete={() => deleteBlock(activeTab, block._key)}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  collapsed={isSortMode}
                  flashTrigger={flashTrigger}
                  autoFocus={block._key === newBlockKey}
                  isFocused={focusedBlockIndex === index}
                  editTrigger={editTriggerMap[block._key] ?? 0}
                  onEditBlur={handleBlockEditBlur}
                  runTrigger={runTriggerMap[block._key] ?? 0}
                  onRunButtonPress={() => handleCodeBlockRunButtonPress(block._key)}
                  onRunStart={() => {
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos || !scrollRef.current) return;
                      scrollRef.current.scrollTo({ y: Math.max(0, pos.y + pos.h - 300), animated: true });
                    }, 300);
                  }}
                  onFocusInput={() => handleBlockTapFocus(block._key)}
                />
              )}
              {block.type === "image" && (
                <ImageBlockItem
                  block={block as ImageBlock}
                  onChange={(patch) => updateBlock(activeTab, block._key, patch)}
                  onDelete={() => deleteBlock(activeTab, block._key)}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  collapsed={isSortMode}
                  flashTrigger={flashTrigger}
                  autoFocus={block._key === newBlockKey}
                  isFocused={focusedBlockIndex === index}
                  onEditBlur={handleBlockEditBlur}
                  onFocusInput={() => handleBlockTapFocus(block._key)}
                />
              )}
            </View>
          );
        })}
        {footerContent}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hiddenKeyboardInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
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
  deckRow: { gap: 4, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  deckName: { fontWeight: "600" },
  validationError: { textAlign: "center" },
});

import { Ionicons } from "@expo/vector-icons";
import {
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
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
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
  const scrollRef = useRef<ScrollView>(null);
  const blockPositions = useRef<Record<string, { y: number; h: number }>>({});
  const scrollOffsetRef = useRef(0);
  const keyboardRef = useRef<TextInput>(null);
  const focusedBlockIndexRef = useRef<number | null>(null);
  const isTransitioningRef = useRef(false);
  const isTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabRef = useRef<Tab>('front');
  const isSortModeRef = useRef(false);
  const isPreviewRef = useRef(false);
  const currentBlocksRef = useRef<EditBlock[]>([]);
  const addMenuVisibleRef = useRef(false);
  const addMenuFocusIndexRef = useRef(0);
  const editingBlockKeyRef = useRef<string | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? "front");
  const [isPreview, setIsPreview] = useState(false);
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
  const [isSortMode, setIsSortMode] = useState(false);
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
    if (!isSortMode) setSelectedBlockKey(null);
  }, [isSortMode]);

  useEffect(() => {
    if (addMenuVisible) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [addMenuVisible]);

  // キーボード高さをトラッキングして contentContainerStyle の paddingBottom に反映する。
  // automaticallyAdjustKeyboardInsets を使わずに手動で制御することで、
  // iOS が contentInset を変更する際に発生するカーソル位置への自動スクロールを防ぐ。
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e: { endCoordinates: { height: number } }) => {
      setKbHeight(e.endCoordinates.height);
      // キーボードが現れるとき、編集中のブロックがキーボードで隠れないようスクロールする
      setTimeout(() => {
        const key = editingBlockKeyRef.current;
        if (!key || !scrollRef.current) return;
        const pos = blockPositions.current[key];
        if (!pos) return;
        scrollRef.current.scrollTo({ y: Math.max(0, pos.y - 80), animated: true });
      }, 50);
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => {
      setKbHeight(0);
    });
    return () => { show.remove(); hide.remove(); };
  }, []);

  // タブ切替でブロックフォーカスをリセット
  useEffect(() => {
    setFocusedBlockIndex(null);
  }, [activeTab]);

  // ブロック数変化時にフォーカスインデックスを補正
  useEffect(() => {
    if (focusedBlockIndex !== null && focusedBlockIndex >= currentBlocks.length) {
      setFocusedBlockIndex(currentBlocks.length > 0 ? currentBlocks.length - 1 : null);
    }
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

  function handleBlockEditBlur() {
    editingBlockKeyRef.current = null;
    if (isTransitioningRef.current) return;
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
      } else if (k === 'o') {
        setIsSortMode(false);
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
      const tabOrder: Tab[] = ['front', 'back', 'memo'];
      setActiveTab(prev => tabOrder[(tabOrder.indexOf(prev) + 1) % 3]);
    } else if (k === 'p') {
      setIsPreview(v => !v);
      setIsSortMode(false);
    } else if (k === 'o') {
      if (!isPreviewRef.current) setIsSortMode(true);
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
        const isLast = blocks.length === 1;
        const isEmpty =
          block.type === 'image'
            ? !(block as ImageBlock).uri
            : (block as TextBlock | CodeBlock).content.trim() === '';
        if (isLast) {
          Alert.alert(t('card.deleteBlock'), t('card.deleteBlockRequired'), [
            { text: t('common.ok') },
          ]);
        } else if (isEmpty) {
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
    } else if (k === 'c') {
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
    await onSave({
      frontBlocks: fromEditBlocks(frontBlocks),
      backBlocks: fromEditBlocks(backBlocks),
      memoBlocks: fromEditBlocks(memoBlocks),
      tagIds,
    });
  }

  useImperativeHandle(ref, () => ({ save: handleSave }), [handleSave]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "front", label: t("card.front") },
    { key: "back", label: t("card.back") },
    { key: "memo", label: t("card.memo") },
  ];

  const footerContent = (
    <>
      {/* ブロック追加ボタン */}
      {!isPreview && (
        <View style={styles.addArea}>
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
              onPress={() => setAddMenuVisible(true)}
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
    <View style={{ flex: 1 }}>
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
            onPress={() => setActiveTab(tab.key)}
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
        {/* 並替モードトグル */}
        <Pressable
          style={[
            styles.sortToggle,
            { backgroundColor: theme.colors.background },
            isSortMode && { backgroundColor: theme.colors.primaryLight },
          ]}
          onPress={() => setIsSortMode((v) => !v)}
        >
          <Ionicons
            name="reorder-three-outline"
            size={18}
            color={
              isSortMode ? theme.colors.primary : theme.colors.textSecondary
            }
          />
        </Pressable>
        {/* プレビュー切替 */}
        <Pressable
          style={[
            styles.previewToggle,
            { backgroundColor: theme.colors.background },
            isPreview && { backgroundColor: theme.colors.primaryLight },
          ]}
          onPress={() => { setIsPreview((v) => !v); setIsSortMode(false); }}
        >
          <Text
            style={[
              styles.previewToggleText,
              {
                color: theme.colors.textSecondary,
                fontSize: theme.fontSize.xs,
              },
              isPreview && styles.previewToggleTextActive,
            ]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {isPreview ? t("common.edit") : t("editor.preview")}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        style={[styles.scroll, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={[styles.content, kbHeight > 0 && { paddingBottom: kbHeight + 16 }]}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={100}
      >
        {currentBlocks.map((block, index) => {
          const isLast = currentBlocks.length === 1;
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
                  isLast={isLast}
                  onCollapsedDoubleTap={() => setIsSortMode(false)}
                  isFocused={focusedBlockIndex === index}
                  editTrigger={editTriggerMap[block._key] ?? 0}
                  onEditBlur={handleBlockEditBlur}
                  onFocusInput={() => {
                    handleBlockTapFocus(block._key);
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos || !scrollRef.current) return;
                      const currentY = scrollOffsetRef.current;
                      // すでにブロック内を表示中なら自動スクロールしない
                      if (currentY > pos.y - 80 && currentY < pos.y + pos.h) return;
                      scrollRef.current.scrollTo({ y: Math.max(0, pos.y - 80), animated: true });
                    }, 300);
                  }}
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
                  isLast={isLast}
                  autoFocus={block._key === newBlockKey}
                  isFocused={focusedBlockIndex === index}
                  editTrigger={editTriggerMap[block._key] ?? 0}
                  onEditBlur={handleBlockEditBlur}
                  runTrigger={runTriggerMap[block._key] ?? 0}
                  onRunStart={() => {
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos || !scrollRef.current) return;
                      scrollRef.current.scrollTo({ y: Math.max(0, pos.y + pos.h - 300), animated: true });
                    }, 300);
                  }}
                  onFocusInput={() => {
                    handleBlockTapFocus(block._key);
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos || !scrollRef.current) return;
                      const currentY = scrollOffsetRef.current;
                      // すでにブロック内を表示中なら自動スクロールしない
                      if (currentY > pos.y - 80 && currentY < pos.y + pos.h) return;
                      scrollRef.current.scrollTo({ y: Math.max(0, pos.y - 80), animated: true });
                    }, 300);
                  }}
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
                  isLast={isLast}
                  autoFocus={block._key === newBlockKey}
                  isFocused={focusedBlockIndex === index}
                  onEditBlur={handleBlockEditBlur}
                  onFocusInput={() => {
                    handleBlockTapFocus(block._key);
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos || !scrollRef.current) return;
                      const currentY = scrollOffsetRef.current;
                      // すでにブロック内を表示中なら自動スクロールしない
                      if (currentY > pos.y - 80 && currentY < pos.y + pos.h) return;
                      scrollRef.current.scrollTo({ y: Math.max(0, pos.y - 80), animated: true });
                    }, 300);
                  }}
                />
              )}
            </View>
          );
        })}
        {footerContent}
      </ScrollView>
    </View>
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
  sortToggle: {
    marginLeft: "auto",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: "center",
  },
  previewToggle: {
    marginLeft: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: "center",
    minWidth: 80,
    alignItems: "center",
  },
  previewToggleText: {},
  previewToggleTextActive: { color: "#1976D2", fontWeight: "600" },
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
  addBtnText: {},
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
    fontSize: 18,
    width: 36,
    textAlign: "center",
  },
  addMenuIconWrap: { width: 36, alignItems: "center" },
  addMenuLabel: {},
  addMenuCancel: { paddingVertical: 12, alignItems: "center" },
  addMenuCancelText: {},
  tagSection: { gap: 8, marginTop: 12 },
  tagLabel: { fontWeight: "600" },
  deckRow: { gap: 4, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  deckName: { fontWeight: "600" },
  validationError: { textAlign: "center" },
});

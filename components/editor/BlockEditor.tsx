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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useTheme } from "@/lib/theme";
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
    executable: false,
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
  onSave: (data: BlockEditorData) => Promise<void>;
  onFrontEmptyChange?: (isEmpty: boolean) => void;
  saving: boolean;
  ref?: Ref<BlockEditorRef>;
}

export function BlockEditor({
  initialData,
  initialTab,
  onSave,
  onFrontEmptyChange,
  saving,
  ref,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const blockPositions = useRef<Record<string, { y: number; h: number }>>({});
  const blockViewRefs = useRef<Map<string, View | null>>(new Map());

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
  const [isSortMode, setIsSortMode] = useState(false);

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
    setAddMenuVisible(false);
  }

  function moveBlock(tab: Tab, key: string, direction: 'up' | 'down') {
    setterByTab[tab]((prev) => {
      const idx = prev.findIndex((b) => b._key === key);
      if (idx === -1) return prev;
      if (direction === 'up' && idx === 0) return prev;
      if (direction === 'down' && idx === prev.length - 1) return prev;
      const next = [...prev];
      const target = direction === 'up' ? idx - 1 : idx + 1;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  const isFrontEmpty = frontBlocks.every((b) => {
    if (b.type === "image") return !b.uri;
    return (b as TextBlock | CodeBlock).content.trim() === "";
  });

  useEffect(() => {
    onFrontEmptyChange?.(isFrontEmpty);
  }, [isFrontEmpty]);

  useEffect(() => {
    if (addMenuVisible) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [addMenuVisible]);

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

  const currentBlocks = blocksByTab[activeTab];

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
                ]}
                onPress={() => addBlock("text")}
              >
                <Text style={styles.addMenuIcon}>T</Text>
                <Text
                  style={[
                    styles.addMenuLabel,
                    { color: theme.colors.text, fontSize: theme.fontSize.md },
                  ]}
                >
                  {t("editor.textBlock")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.addMenuItem,
                  { borderBottomColor: theme.colors.border },
                ]}
                onPress={() => addBlock("code")}
              >
                <Text style={styles.addMenuIcon}>{"</>"}</Text>
                <Text
                  style={[
                    styles.addMenuLabel,
                    { color: theme.colors.text, fontSize: theme.fontSize.md },
                  ]}
                >
                  {t("editor.codeBlock")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.addMenuItem,
                  { borderBottomColor: theme.colors.border },
                ]}
                onPress={() => addBlock("image")}
              >
                <View style={styles.addMenuIconWrap}>
                  <Ionicons name="image-outline" size={22} color="#1976D2" />
                </View>
                <Text
                  style={[
                    styles.addMenuLabel,
                    { color: theme.colors.text, fontSize: theme.fontSize.md },
                  ]}
                >
                  {t("card.imageBlock")}
                </Text>
              </TouchableOpacity>
              <Pressable
                onPress={() => setAddMenuVisible(false)}
                style={styles.addMenuCancel}
              >
                <Text
                  style={[
                    styles.addMenuCancelText,
                    {
                      color: theme.colors.textTertiary,
                      fontSize: theme.fontSize.md,
                    },
                  ]}
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
        >
          {t("tag.title")}
        </Text>
        <TagSelector selectedTagIds={tagIds} onChange={setTagIds} />
      </View>

      {/* 表面が空の場合のバリデーションエラー */}
      {isFrontEmpty && (
        <Text
          style={[
            styles.validationError,
            { color: theme.colors.danger, fontSize: theme.fontSize.sm },
          ]}
        >
          {t("card.frontRequired")}
        </Text>
      )}
    </>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
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
          >
            {isPreview ? t("common.edit") : t("editor.preview")}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        style={[styles.scroll, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {currentBlocks.map((block, index) => {
          const isLast = currentBlocks.length === 1;
          const moveUp = isSortMode && index > 0 ? () => moveBlock(activeTab, block._key, 'up') : undefined;
          const moveDown = isSortMode && index < currentBlocks.length - 1 ? () => moveBlock(activeTab, block._key, 'down') : undefined;
          return (
            <View
              key={block._key}
              ref={(r) => {
                if (r) blockViewRefs.current.set(block._key, r);
                else blockViewRefs.current.delete(block._key);
              }}
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
                  autoFocus={index === 0}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  collapsed={isSortMode}
                  isLast={isLast}
                  onCollapsedDoubleTap={() => setIsSortMode(false)}
                  onFocusInput={() => {
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos || !scrollRef.current) return;
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
                  isLast={isLast}
                  onRunStart={() => {
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos || !scrollRef.current) return;
                      scrollRef.current.scrollTo({ y: Math.max(0, pos.y + pos.h - 300), animated: true });
                    }, 300);
                  }}
                  onFocusInput={() => {
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos || !scrollRef.current) return;
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
                  isLast={isLast}
                  onFocusInput={() => {
                    setTimeout(() => {
                      const pos = blockPositions.current[block._key];
                      if (!pos || !scrollRef.current) return;
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
  validationError: { textAlign: "center" },
});

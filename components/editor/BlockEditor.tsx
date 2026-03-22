import { type Dispatch, type Ref, type SetStateAction, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  NestableScrollContainer,
  NestableDraggableFlatList,
  ScaleDecorator,
  type RenderItemParams,
  type DragEndParams,
} from 'react-native-draggable-flatlist';

import { CodeBlockItem } from './CodeBlockItem';
import { ImageBlockItem } from './ImageBlockItem';
import { TagSelector } from './TagSelector';
import { TextBlockItem } from './TextBlockItem';
import { useTheme } from '@/lib/theme';
import type { Block, CodeBlock, ImageBlock, TextBlock } from '@/types';

type Tab = 'front' | 'back' | 'memo';

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
  return { type: 'text', content: '', _key: makeKey() };
}

function newCodeBlock(): EditBlock {
  return { type: 'code', language: 'javascript', content: '', executable: false, _key: makeKey() };
}

function newImageBlock(): EditBlock {
  return { type: 'image', uri: '', alt: '', _key: makeKey() };
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
  onSave: (data: BlockEditorData) => Promise<void>;
  onFrontEmptyChange?: (isEmpty: boolean) => void;
  saving: boolean;
  ref?: Ref<BlockEditorRef>;
}

export function BlockEditor({ initialData, onSave, onFrontEmptyChange, saving, ref }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scrollRef = useRef<any>(null);
  const blockYPositions = useRef<Record<string, number>>({});
  const blockViewRefs = useRef<Record<string, View | null>>({});

  const [activeTab, setActiveTab] = useState<Tab>('front');
  const [isPreview, setIsPreview] = useState(false);
  const [frontBlocks, setFrontBlocks] = useState<EditBlock[]>(
    () => toEditBlocks(initialData?.frontBlocks ?? [newTextBlock()])
  );
  const [backBlocks, setBackBlocks] = useState<EditBlock[]>(
    () => toEditBlocks(initialData?.backBlocks ?? [newTextBlock()])
  );
  const [memoBlocks, setMemoBlocks] = useState<EditBlock[]>(
    () => toEditBlocks(initialData?.memoBlocks ?? [newTextBlock()])
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
      prev.map((b) => (b._key === key ? ({ ...b, ...patch } as EditBlock) : b))
    );
  }

  function deleteBlock(tab: Tab, key: string) {
    setterByTab[tab]((prev) => prev.filter((b) => b._key !== key));
  }

  function addBlock(type: 'text' | 'code' | 'image') {
    const block = type === 'text' ? newTextBlock() : type === 'code' ? newCodeBlock() : newImageBlock();
    setterByTab[activeTab]((prev) => [...prev, block]);
    setAddMenuVisible(false);
  }

  function handleDragEnd({ data }: DragEndParams<EditBlock>) {
    setterByTab[activeTab](data);
  }

  const isFrontEmpty = frontBlocks.every((b) => {
    if (b.type === 'image') return !b.uri;
    return (b as TextBlock | CodeBlock).content.trim() === '';
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
    { key: 'front', label: t('card.front') },
    { key: 'back', label: t('card.back') },
    { key: 'memo', label: t('card.memo') },
  ];

  const currentBlocks = blocksByTab[activeTab];

  const renderBlock = useCallback(({ item: block, drag, getIndex }: RenderItemParams<EditBlock>) => {
    const index = getIndex() ?? 0;
    const collapsed = isSortMode;
    const sortDrag = isSortMode ? drag : undefined;
    const isLast = currentBlocks.length === 1;

    if (block.type === 'text') {
      return (
        <ScaleDecorator activeScale={1.02}>
          <TextBlockItem
            block={block as TextBlock}
            isPreview={isPreview}
            onChange={(content) => updateBlock(activeTab, block._key, { content })}
            onDelete={() => deleteBlock(activeTab, block._key)}
            autoFocus={index === 0}
            onDragStart={sortDrag}
            collapsed={collapsed}
            isLast={isLast}
            onCollapsedDoubleTap={() => setIsSortMode(false)}
          />
        </ScaleDecorator>
      );
    }
    if (block.type === 'code') {
      return (
        <ScaleDecorator activeScale={1.02}>
          <View ref={(r) => { blockViewRefs.current[block._key] = r; }}>
            <CodeBlockItem
              block={block as CodeBlock}
              isPreview={isPreview}
              onChange={(patch) => updateBlock(activeTab, block._key, patch)}
              onDelete={() => deleteBlock(activeTab, block._key)}
              onRunStart={() => {
                const blockView = blockViewRefs.current[block._key];
                if (!blockView || !scrollRef.current) return;
                // measureLayout で scrollRef 基準の正確な座標を取得
                blockView.measureLayout(
                  scrollRef.current,
                  (_x, y, _w, h) => {
                    // ブロック下端が画面内に収まるようにスクロール（300px 余白）
                    scrollRef.current?.scrollTo({
                      y: Math.max(0, y + h - 300),
                      animated: true,
                    });
                  },
                  () => {
                    // measureLayout 失敗時は末尾へスクロール
                    scrollRef.current?.scrollToEnd({ animated: true });
                  }
                );
              }}
              onDragStart={sortDrag}
              collapsed={collapsed}
              isLast={isLast}
            />
          </View>
        </ScaleDecorator>
      );
    }
    if (block.type === 'image') {
      return (
        <ScaleDecorator activeScale={1.02}>
          <ImageBlockItem
            block={block as ImageBlock}
            onChange={(patch) => updateBlock(activeTab, block._key, patch)}
            onDelete={() => deleteBlock(activeTab, block._key)}
            onDragStart={sortDrag}
            collapsed={collapsed}
            isLast={isLast}
          />
        </ScaleDecorator>
      );
    }
    return null;
  }, [isPreview, activeTab, isSortMode, currentBlocks.length]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* タブバー */}
      <View style={[styles.tabBar, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.inputBorder }]}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, { color: theme.colors.textTertiary }, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
        {/* 並替モードトグル */}
        <Pressable
          style={[styles.sortToggle, { backgroundColor: theme.colors.background }, isSortMode && { backgroundColor: theme.colors.primaryLight }]}
          onPress={() => setIsSortMode((v) => !v)}
        >
          <Ionicons
            name="reorder-three-outline"
            size={18}
            color={isSortMode ? theme.colors.primary : theme.colors.textSecondary}
          />
        </Pressable>
        {/* プレビュー切替 */}
        <Pressable
          style={[styles.previewToggle, { backgroundColor: theme.colors.background }, isPreview && { backgroundColor: theme.colors.primaryLight }]}
          onPress={() => setIsPreview((v) => !v)}
        >
          <Text style={[styles.previewToggleText, { color: theme.colors.textSecondary }, isPreview && styles.previewToggleTextActive]}>
            {isPreview ? t('common.edit') : t('editor.preview')}
          </Text>
        </Pressable>
      </View>

      <NestableScrollContainer
        ref={scrollRef}
        style={[styles.scroll, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ブロック一覧 */}
        <NestableDraggableFlatList
          key={activeTab}
          data={currentBlocks}
          keyExtractor={(item) => item._key}
          renderItem={renderBlock}
          onDragEnd={handleDragEnd}
          activationDistance={isSortMode ? 2 : 10000}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />

        {/* ブロック追加ボタン */}
        {!isPreview && (
          <View style={styles.addArea}>
            {addMenuVisible ? (
              <View style={[styles.addMenu, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }]}>
                <TouchableOpacity style={[styles.addMenuItem, { borderBottomColor: theme.colors.border }]} onPress={() => addBlock('text')}>
                  <Text style={styles.addMenuIcon}>T</Text>
                  <Text style={[styles.addMenuLabel, { color: theme.colors.text }]}>{t('editor.textBlock')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.addMenuItem, { borderBottomColor: theme.colors.border }]} onPress={() => addBlock('code')}>
                  <Text style={styles.addMenuIcon}>{'</>'}</Text>
                  <Text style={[styles.addMenuLabel, { color: theme.colors.text }]}>{t('editor.codeBlock')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.addMenuItem, { borderBottomColor: theme.colors.border }]} onPress={() => addBlock('image')}>
                  <View style={styles.addMenuIconWrap}>
                    <Ionicons name="image-outline" size={18} color="#1976D2" />
                  </View>
                  <Text style={[styles.addMenuLabel, { color: theme.colors.text }]}>{t('card.imageBlock')}</Text>
                </TouchableOpacity>
                <Pressable onPress={() => setAddMenuVisible(false)} style={styles.addMenuCancel}>
                  <Text style={[styles.addMenuCancelText, { color: theme.colors.textTertiary }]}>{t('common.cancel')}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={[styles.addBtn, { borderColor: theme.colors.iconSubtle }]} onPress={() => setAddMenuVisible(true)}>
                <Text style={[styles.addBtnText, { color: theme.colors.textTertiary }]}>{t('editor.addBlock')}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* タグ選択 */}
        <View style={styles.tagSection}>
          <Text style={[styles.tagLabel, { color: theme.colors.textSecondary }]}>{t('tag.title')}</Text>
          <TagSelector selectedTagIds={tagIds} onChange={setTagIds} />
        </View>

        {/* 表面が空の場合のバリデーションエラー */}
        {isFrontEmpty && (
          <Text style={[styles.validationError, { color: theme.colors.danger }]}>
            {t('card.frontRequired')}
          </Text>
        )}
      </NestableScrollContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    gap: 0,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#1976D2' },
  tabText: { fontSize: 14, fontWeight: '500' },
  tabTextActive: { color: '#1976D2', fontWeight: '700' },
  sortToggle: {
    marginLeft: 'auto',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'center',
  },
  previewToggle: {
    marginLeft: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'center',
    minWidth: 80,
    alignItems: 'center',
  },
  previewToggleText: { fontSize: 12 },
  previewToggleTextActive: { color: '#1976D2', fontWeight: '600' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  addArea: { marginTop: 4 },
  addBtn: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addBtnText: { fontSize: 14 },
  addMenu: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  addMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  addMenuIcon: { fontSize: 16, fontWeight: '700', color: '#1976D2', width: 28, textAlign: 'center' },
  addMenuIconWrap: { width: 28, alignItems: 'center' },
  addMenuLabel: { fontSize: 15 },
  addMenuCancel: { paddingVertical: 12, alignItems: 'center' },
  addMenuCancelText: { fontSize: 14 },
  tagSection: { gap: 8, marginTop: 12 },
  tagLabel: { fontSize: 14, fontWeight: '600' },
  validationError: { fontSize: 13, textAlign: 'center' },
});

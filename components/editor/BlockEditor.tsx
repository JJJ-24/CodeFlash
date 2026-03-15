import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { CodeBlockItem } from './CodeBlockItem';
import { TagSelector } from './TagSelector';
import { TextBlockItem } from './TextBlockItem';
import { useTheme } from '@/lib/theme';
import type { Block, CodeBlock, TextBlock } from '@/types';

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

export interface BlockEditorData {
  frontBlocks: Block[];
  backBlocks: Block[];
  memoBlocks: Block[];
  tagIds: string[];
}

interface Props {
  initialData?: Partial<BlockEditorData>;
  onSave: (data: BlockEditorData) => Promise<void>;
  saving: boolean;
}

export function BlockEditor({ initialData, onSave, saving }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

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

  const blocksByTab: Record<Tab, EditBlock[]> = {
    front: frontBlocks,
    back: backBlocks,
    memo: memoBlocks,
  };

  const setterByTab: Record<Tab, (blocks: EditBlock[]) => void> = {
    front: setFrontBlocks,
    back: setBackBlocks,
    memo: setMemoBlocks,
  };

  function updateBlock(tab: Tab, key: string, patch: Partial<Block>) {
    setterByTab[tab]((prev) =>
      prev.map((b) => (b._key === key ? { ...b, ...patch } : b))
    );
  }

  function deleteBlock(tab: Tab, key: string) {
    setterByTab[tab]((prev) => {
      const next = prev.filter((b) => b._key !== key);
      return next.length > 0 ? next : [newTextBlock()];
    });
  }

  function addBlock(type: 'text' | 'code') {
    const block = type === 'text' ? newTextBlock() : newCodeBlock();
    setterByTab[activeTab]((prev) => [...prev, block]);
    setAddMenuVisible(false);
  }

  const isFrontEmpty = frontBlocks.every((b) => b.content.trim() === '');

  async function handleSave() {
    if (isFrontEmpty) return;
    await onSave({
      frontBlocks: fromEditBlocks(frontBlocks),
      backBlocks: fromEditBlocks(backBlocks),
      memoBlocks: fromEditBlocks(memoBlocks),
      tagIds,
    });
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'front', label: t('card.front') },
    { key: 'back', label: t('card.back') },
    { key: 'memo', label: t('card.memo') },
  ];

  const currentBlocks = blocksByTab[activeTab];

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
        {/* プレビュー切替 */}
        <Pressable
          style={[styles.previewToggle, { backgroundColor: theme.colors.background }, isPreview && { backgroundColor: theme.colors.primaryLight }]}
          onPress={() => setIsPreview((v) => !v)}
        >
          <Text style={[styles.previewToggleText, { color: theme.colors.textSecondary }, isPreview && styles.previewToggleTextActive]}>
            {isPreview ? '編集' : 'プレビュー'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={[styles.scroll, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ブロック一覧 */}
        {currentBlocks.map((block, index) => {
          if (block.type === 'text') {
            return (
              <TextBlockItem
                key={block._key}
                block={block as TextBlock}
                isPreview={isPreview}
                onChange={(content) => updateBlock(activeTab, block._key, { content })}
                onDelete={() => deleteBlock(activeTab, block._key)}
                autoFocus={index === 0}
              />
            );
          }
          if (block.type === 'code') {
            return (
              <CodeBlockItem
                key={block._key}
                block={block as CodeBlock}
                isPreview={isPreview}
                onChange={(patch) => updateBlock(activeTab, block._key, patch)}
                onDelete={() => deleteBlock(activeTab, block._key)}
              />
            );
          }
          // ImageBlock: プレースホルダー（011チケットで実装）
          return (
            <View key={block._key} style={[styles.imagePlaceholder, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }]}>
              <Text style={[styles.imagePlaceholderText, { color: theme.colors.textTertiary }]}>🖼 画像ブロック（未実装）</Text>
              <Pressable onPress={() => deleteBlock(activeTab, block._key)} hitSlop={8}>
                <Text style={[styles.deleteBtnText, { color: theme.colors.iconSubtle }]}>✕</Text>
              </Pressable>
            </View>
          );
        })}

        {/* ブロック追加ボタン */}
        {!isPreview && (
          <View style={styles.addArea}>
            {addMenuVisible ? (
              <View style={[styles.addMenu, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }]}>
                <TouchableOpacity style={[styles.addMenuItem, { borderBottomColor: theme.colors.border }]} onPress={() => addBlock('text')}>
                  <Text style={styles.addMenuIcon}>T</Text>
                  <Text style={[styles.addMenuLabel, { color: theme.colors.text }]}>テキスト</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.addMenuItem, { borderBottomColor: theme.colors.border }]} onPress={() => addBlock('code')}>
                  <Text style={styles.addMenuIcon}>{'</>'}</Text>
                  <Text style={[styles.addMenuLabel, { color: theme.colors.text }]}>コード</Text>
                </TouchableOpacity>
                <Pressable onPress={() => setAddMenuVisible(false)} style={styles.addMenuCancel}>
                  <Text style={[styles.addMenuCancelText, { color: theme.colors.textTertiary }]}>キャンセル</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={[styles.addBtn, { borderColor: theme.colors.iconSubtle }]} onPress={() => setAddMenuVisible(true)}>
                <Text style={[styles.addBtnText, { color: theme.colors.textTertiary }]}>＋ ブロックを追加</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* タグ選択 */}
        <View style={styles.tagSection}>
          <Text style={[styles.tagLabel, { color: theme.colors.textSecondary }]}>{t('tag.title')}</Text>
          <TagSelector selectedTagIds={tagIds} onChange={setTagIds} />
        </View>

        {/* 保存ボタン */}
        {isFrontEmpty && (
          <Text style={[styles.validationError, { color: theme.colors.error ?? '#EF4444' }]}>
            {t('card.frontRequired')}
          </Text>
        )}
        <TouchableOpacity
          style={[styles.saveBtn, (saving || isFrontEmpty) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving || isFrontEmpty}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>{saving ? '保存中...' : t('card.save')}</Text>
        </TouchableOpacity>
      </ScrollView>
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
  previewToggle: {
    marginLeft: 'auto',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'center',
  },
  previewToggleText: { fontSize: 12 },
  previewToggleTextActive: { color: '#1976D2', fontWeight: '600' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  imagePlaceholder: {
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  imagePlaceholderText: { fontSize: 14 },
  deleteBtnText: { fontSize: 14 },
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
  addMenuLabel: { fontSize: 15 },
  addMenuCancel: { paddingVertical: 12, alignItems: 'center' },
  addMenuCancelText: { fontSize: 14 },
  tagSection: { gap: 8 },
  tagLabel: { fontSize: 14, fontWeight: '600' },
  saveBtn: {
    backgroundColor: '#1976D2',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  validationError: { fontSize: 13, textAlign: 'center', marginBottom: -4 },
});

import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { constants as KeyCommand } from 'react-native-key-command';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

import { BlockEditor } from '@/components/editor/BlockEditor';
import type { BlockEditorData, BlockEditorRef, EditorMode } from '@/components/editor/BlockEditor';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { deleteCard, duplicateCard, getCardById, setCardArchived, updateCard } from '@/lib/database/cards';
import { getTagsByCardId, addTagToCard, removeTagFromCard } from '@/lib/database/tags';
import { getCardPreview } from '@/lib/cardPreview';
import { useDismissKeyboardOnLeave } from '@/hooks/useDismissKeyboardOnLeave';
import { CARD_EDITOR_SHORTCUTS_EDIT, CARD_EDITOR_SHORTCUTS_SORT, CARD_EDITOR_SHORTCUTS_PREVIEW } from '@/lib/cardEditorShortcuts';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import { useSettingsStore } from '@/store/settings';
import type { Card } from '@/types';

export default function EditCardScreen() {
  const { id, cardId, tab } = useLocalSearchParams<{ id: string; cardId: string; tab?: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { updateCard: updateStore, removeCard, markDuplicated } = useCardStore();
  const { decks, updateDeck } = useDeckStore();
  const theme = useTheme();
  const { keyboardShortcutsEnabled } = useSettingsStore();
  useDismissKeyboardOnLeave();

  const editorRef = useRef<BlockEditorRef>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [initialTagIds, setInitialTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [frontEmpty, setFrontEmpty] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('edit');

  // 親モーダル（削除確認/破棄確認/ショートカット一覧）表示中はエディタのキーを止め、Esc で閉じる。
  // 削除/破棄は確定操作のため Return は割り当てない（タップのみ）。フック規約上、早期 return より前で呼ぶ。
  const blockingModalOpen = showDeleteModal || showDiscardModal || showShortcutsModal;
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showDeleteModal) { setShowDeleteModal(false); return; }
        if (showDiscardModal) { setShowDiscardModal(false); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
      },
    },
    // ショートカット一覧（OK のみ）は Return でも閉じる。削除/破棄は確定操作のため Return 非割当。
    {
      input: KeyCommand.keyInputEnter,
      handler: () => { if (showShortcutsModal) setShowShortcutsModal(false); },
    },
  ], blockingModalOpen);
  const [archived, setArchived] = useState(false);
  const initialSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    // 複製で同一ルートへ replace 遷移したとき、画面が再利用されても BlockEditor を
    // 新カード内容で確実に作り直すため、cardId 変更時に一旦 null へ戻して再マウントさせる。
    setCard(null);
    setInitialTagIds([]);
    setFrontEmpty(false);
    initialSnapshotRef.current = null;
    (async () => {
      const [loaded, tags] = await Promise.all([
        getCardById(db, cardId),
        getTagsByCardId(db, cardId),
      ]);
      setCard(loaded);
      const tagIdList = tags.map((t) => t.id);
      setInitialTagIds(tagIdList);
      if (loaded) setArchived(loaded.archived);
      if (loaded) {
        initialSnapshotRef.current = JSON.stringify({
          frontBlocks: loaded.frontContent,
          backBlocks: loaded.backContent,
          memoBlocks: loaded.memoContent,
          tagIds: tagIdList,
        });
      }
    })();
  }, [cardId]);

  // 現在の編集内容を DB へ永続化する（遷移は行わない）。保存・複製で共用。
  async function persistCard(data: BlockEditorData) {
    if (!card) return;
    await updateCard(db, cardId, {
      frontContent: data.frontBlocks,
      backContent: data.backBlocks,
      memoContent: data.memoBlocks,
    });

    // タグの差分更新
    const toAdd = data.tagIds.filter((id) => !initialTagIds.includes(id));
    const toRemove = initialTagIds.filter((id) => !data.tagIds.includes(id));
    await Promise.all([
      ...toAdd.map((tagId) => addTagToCard(db, cardId, tagId)),
      ...toRemove.map((tagId) => removeTagFromCard(db, cardId, tagId)),
    ]);

    if (archived !== card.archived) {
      await setCardArchived(db, cardId, archived);
    }
    updateStore({
      ...card,
      frontContent: data.frontBlocks,
      backContent: data.backBlocks,
      memoContent: data.memoBlocks,
      archived,
    });
  }

  async function handleSave(data: BlockEditorData) {
    if (!card) return;
    setSaving(true);
    try {
      await persistCard(data);
      router.back();
    } finally {
      setSaving(false);
    }
  }

  // 現在の内容を保存したうえで複製し、複製先（A'）の編集画面へ置き換え遷移する。
  async function handleDuplicate() {
    if (!card || saving || frontEmpty) return;
    const data = editorRef.current?.getData();
    if (!data) return;
    setSaving(true);
    try {
      await persistCard(data);
      const newCard = await duplicateCard(db, cardId);
      const deck = decks.find((d) => d.id === id);
      if (deck) updateDeck({ ...deck, cardCount: deck.cardCount + 1 });
      // カード一覧に戻ったとき複製先（A'）へ「NEW」を出すため保留 ID として渡す。
      markDuplicated([newCard.id]);
      router.replace({ pathname: '/deck/[id]/card/[cardId]/edit', params: { id, cardId: newCard.id } });
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    const current = editorRef.current?.getData();
    const snapshot = initialSnapshotRef.current;
    const archivedChanged = !!card && archived !== card.archived;
    if (!archivedChanged && (!current || !snapshot || JSON.stringify(current) === snapshot)) {
      editorRef.current?.prepareForNavigation();
      router.back();
      return;
    }
    setShowDiscardModal(true);
  }

  function confirmDelete() {
    setShowDeleteModal(true);
  }

  async function handleDeleteConfirm() {
    setShowDeleteModal(false);
    await deleteCard(db, cardId, id);
    removeCard(cardId);
    const deck = decks.find((d) => d.id === id);
    if (deck) updateDeck({ ...deck, cardCount: Math.max(deck.cardCount - 1, 0) });
    router.back();
  }

  if (!card) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  const rawDeletePreview = getCardPreview(card.frontContent, t('card.imageBlock')).replace(/\n/g, ' ');
  const deletePreview = rawDeletePreview || t('card.noText');
  const deleteCardName = deletePreview.length > 20 ? deletePreview.slice(0, 20) + '…' : deletePreview;

  return (
    <>
      <Stack.Screen
        options={{

          headerTitle: () => (
            <Pressable
              onPress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: screenWidth * 0.5 }}
            >
              <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text, flexShrink: 1 }} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {editorMode === 'sort' ? t('editor.sortModeLabel') : editorMode === 'preview' ? t('editor.previewModeLabel') : t('card.edit')}
              </Text>
              {keyboardShortcutsEnabled && (
                <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
              )}
            </Pressable>
          ),
          headerLeft: () => (
            <Pressable onPress={handleClose} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="close" size={26} color={theme.colors.textSecondary} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => editorRef.current?.save()} disabled={saving || frontEmpty} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="checkmark-sharp" size={26} color={saving || frontEmpty ? theme.colors.textTertiary : theme.colors.primary} />
            </Pressable>
          ),
        }}
      />
      <View style={styles.container}>
        <BlockEditor
          ref={editorRef}
          initialData={{
            frontBlocks: card.frontContent,
            backBlocks: card.backContent,
            memoBlocks: card.memoContent,
            tagIds: initialTagIds,
          }}
          initialTab={tab === 'back' || tab === 'memo' ? tab : undefined}
          deckName={decks.find((d) => d.id === id)?.name}
          deckIconName={decks.find((d) => d.id === id)?.iconName}
          deckColorHex={decks.find((d) => d.id === id)?.colorHex}
          deckSqlInit={decks.find((d) => d.id === id)?.sqlInit}
          onSave={handleSave}
          onFrontEmptyChange={setFrontEmpty}
          saving={saving}
          onCancel={handleClose}
          onDeleteCard={confirmDelete}
          onDuplicate={handleDuplicate}
          onShowShortcuts={() => setShowShortcutsModal((v) => !v)}
          onModeChange={setEditorMode}
          archived={archived}
          onArchivedChange={setArchived}
          suspendKeys={blockingModalOpen}
        />
        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.danger }]} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={26} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnOutline, { borderColor: theme.colors.primary }, (saving || frontEmpty) && styles.actionBtnDisabled]}
            onPress={handleDuplicate}
            disabled={saving || frontEmpty}
          >
            <Ionicons name="copy-outline" size={26} color={saving || frontEmpty ? theme.colors.textTertiary : theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, (saving || frontEmpty) && styles.actionBtnDisabled]} onPress={() => editorRef.current?.save()} disabled={saving || frontEmpty}>
            <Ionicons name="checkmark-sharp" size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        maxHeight="80%"
        sections={
          editorMode === 'sort'
            ? [{ title: t('shortcut.sortMode'), items: CARD_EDITOR_SHORTCUTS_SORT }]
            : editorMode === 'preview'
            ? [{ title: t('shortcut.previewMode'), items: CARD_EDITOR_SHORTCUTS_PREVIEW }]
            : [{ title: t('shortcut.editMode'), items: CARD_EDITOR_SHORTCUTS_EDIT }]
        }
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={t('card.deleteConfirm', { name: deleteCardName })}
        onConfirm={handleDeleteConfirm}
        onClose={() => setShowDeleteModal(false)}
      />
      <ConfirmModal
        visible={showDiscardModal}
        message={t('common.discardChanges')}
        actions={!frontEmpty
          ? [
              { label: t('common.save'), onPress: () => { setShowDiscardModal(false); editorRef.current?.save(); } },
              { label: t('common.discard'), destructive: true, onPress: () => { setShowDiscardModal(false); editorRef.current?.prepareForNavigation(); router.back(); } },
            ]
          : [
              { label: t('common.discard'), destructive: true, onPress: () => { setShowDiscardModal(false); editorRef.current?.prepareForNavigation(); router.back(); } },
            ]
        }
        onClose={() => setShowDiscardModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionBtnOutline: { borderWidth: 1.5 },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnTextLight: { fontWeight: '700', color: '#FFF' },
});

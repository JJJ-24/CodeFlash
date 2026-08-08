import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { constants as KeyCommand } from 'react-native-key-command';

import { DiscardConfirmModal } from '@/components/DiscardConfirmModal';
import { FormBottomBar } from '@/components/FormBottomBar';
import { ModalFormHeader } from '@/components/ModalFormHeader';
import { BlockEditor } from '@/components/editor/BlockEditor';
import type { BlockEditorData, BlockEditorRef, EditorMode } from '@/components/editor/BlockEditor';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { useDismissKeyboardOnLeave } from '@/hooks/useDismissKeyboardOnLeave';
import { CARD_EDITOR_SECTIONS_EDIT, CARD_EDITOR_SECTIONS_SORT, CARD_EDITOR_SECTIONS_PREVIEW } from '@/lib/cardEditorShortcuts';
import { createCard } from '@/lib/database/cards';
import { addTagToCard } from '@/lib/database/tags';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import { usePendingFocusStore } from '@/store/pendingFocus';
import { useSettingsStore } from '@/store/settings';

// 新規作成では「カード複製(C)」「アーカイブ(E・フォーカスなし / ⇧E)」は無効（どちらもカード編集時のみ）。
// 編集画面と共有のセクションからこの2項目を除外し、空になったカテゴリーも落とす。
const NEW_CARD_EXCLUDED = new Set(['shortcut.duplicateCard', 'shortcut.archiveUnfocused', 'shortcut.archiveToggle']);
// 新規作成では E は編集のみ（アーカイブ不可）。編集＋アーカイブの結合表示を編集専用の文言へ差し替える。
const NEW_CARD_REMAP: Record<string, string> = { 'shortcut.editArchiveCombo': 'shortcut.editFocusedItem' };
type ShortcutSectionDef = { titleKey: string; items: { key: string; descKey: string; pro?: boolean }[] };
const filterForNew = (sections: ShortcutSectionDef[]): ShortcutSectionDef[] =>
  sections
    .map((s) => ({
      ...s,
      items: s.items
        .filter((i) => !NEW_CARD_EXCLUDED.has(i.descKey))
        .map((i) => (NEW_CARD_REMAP[i.descKey] ? { ...i, descKey: NEW_CARD_REMAP[i.descKey] } : i)),
    }))
    .filter((s) => s.items.length > 0);
const NEW_SECTIONS_EDIT = filterForNew(CARD_EDITOR_SECTIONS_EDIT);
const NEW_SECTIONS_SORT = filterForNew(CARD_EDITOR_SECTIONS_SORT);
const NEW_SECTIONS_PREVIEW = filterForNew(CARD_EDITOR_SECTIONS_PREVIEW);

export default function NewCardScreen() {
  const { id: deckId, tagId } = useLocalSearchParams<{ id: string; tagId?: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  useRestoreStatusBar();
  const { width: screenWidth } = useWindowDimensions();
  const { keyboardShortcutsEnabled } = useSettingsStore();
  useDismissKeyboardOnLeave();
  const { addCard } = useCardStore();
  const setPendingFocus = usePendingFocusStore((s) => s.setPendingFocus);
  const { decks, updateDeck } = useDeckStore();
  const currentDeck = decks.find((d) => d.id === deckId);
  const editorRef = useRef<BlockEditorRef>(null);
  const [saving, setSaving] = useState(false);
  const [frontEmpty, setFrontEmpty] = useState(true);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('edit');

  // 親モーダル（破棄確認/ショートカット一覧）表示中はエディタのキーを止め、Esc で閉じる（破棄は Return 非割当）。
  const blockingModalOpen = showDiscardModal || showShortcutsModal;
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showDiscardModal) { setShowDiscardModal(false); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
      },
    },
    // ショートカット一覧（OK のみ）は Return でも閉じる。破棄確認は確定操作のため Return 非割当。
    {
      input: KeyCommand.keyInputEnter,
      handler: () => { if (showShortcutsModal) setShowShortcutsModal(false); },
    },
  ], blockingModalOpen);

  const initialSnapshotRef = useRef<string>(
    JSON.stringify({
      frontBlocks: [{ type: 'text', content: '' }],
      backBlocks: [{ type: 'text', content: '' }],
      memoBlocks: [{ type: 'text', content: '' }],
      tagIds: tagId ? [tagId] : [],
    })
  );

  function handleClose() {
    const current = editorRef.current?.getData();
    if (!current || JSON.stringify(current) === initialSnapshotRef.current) {
      editorRef.current?.prepareForNavigation();
      router.back();
      return;
    }
    setShowDiscardModal(true);
  }

  async function handleSave(data: BlockEditorData) {
    setSaving(true);
    try {
      const card = await createCard(db, {
        deckId,
        frontContent: data.frontBlocks,
        backContent: data.backBlocks,
        memoContent: data.memoBlocks,
      });
      await Promise.all(data.tagIds.map((tagId) => addTagToCard(db, card.id, tagId)));
      addCard(card);
      const deck = decks.find((d) => d.id === deckId);
      if (deck) {
        updateDeck({ ...deck, cardCount: deck.cardCount + 1 });
      }
      // 一覧へ戻ったとき、作成したカードへフォーカスを移す
      setPendingFocus('card', card.id);
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* 標準ヘッダーは WebView がステータスバーを隠すと縮むため、自前固定ヘッダーを使う（詳細は ModalFormHeader）。 */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <ModalFormHeader
          title={editorMode === 'sort' ? t('editor.sortModeLabel') : editorMode === 'preview' ? t('editor.previewModeLabel') : t('card.new')}
          onClose={handleClose}
          onSave={() => editorRef.current?.save()}
          canSave={!(saving || frontEmpty)}
          showKeyboardIcon={keyboardShortcutsEnabled}
          onTitlePress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
          titleMaxWidth={screenWidth * 0.5}
        />
        <BlockEditor ref={editorRef} onSave={handleSave} onFrontEmptyChange={setFrontEmpty} saving={saving} isNewCard initialData={tagId ? { tagIds: [tagId] } : undefined} deckName={currentDeck?.name} deckIconName={currentDeck?.iconName} deckColorHex={currentDeck?.colorHex} deckSqlInit={currentDeck?.sqlInit} deckHtmlStages={currentDeck?.htmlStages} deckHtmlImages={currentDeck?.htmlImages} onCancel={handleClose} onShowShortcuts={() => setShowShortcutsModal((v) => !v)} onModeChange={setEditorMode} suspendKeys={blockingModalOpen} />
        <FormBottomBar onSave={() => editorRef.current?.save()} saveDisabled={saving || frontEmpty} horizontalPadding={16} />
      </View>
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        maxHeight="80%"
        subtitle={editorMode === 'sort' ? t('shortcut.sortMode') : editorMode === 'preview' ? t('shortcut.previewMode') : t('shortcut.editMode')}
        sections={(editorMode === 'sort'
          ? NEW_SECTIONS_SORT
          : editorMode === 'preview'
          ? NEW_SECTIONS_PREVIEW
          : NEW_SECTIONS_EDIT
        ).map((s) => ({ title: t(s.titleKey), items: s.items }))}
      />
      <DiscardConfirmModal
        visible={showDiscardModal}
        canSave={!frontEmpty}
        onSave={() => { setShowDiscardModal(false); editorRef.current?.save(); }}
        onDiscard={() => { setShowDiscardModal(false); editorRef.current?.prepareForNavigation(); router.back(); }}
        onClose={() => setShowDiscardModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});

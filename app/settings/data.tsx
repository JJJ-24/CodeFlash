import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { ConfirmModal, type ModalAction } from '@/components/ConfirmModal';
import { DeckPickerModal } from '@/components/DeckPickerModal';
import { InfoModal } from '@/components/InfoModal';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles as styles } from '@/components/settings/styles';

import { createDeck, getAllDecks } from '@/lib/database/decks';
import { getAllTags } from '@/lib/database/tags';
import { estimateExportSize, exportDatabase } from '@/lib/export';
import { importDatabase } from '@/lib/import';
import { exportDeckToTsv, importTsv, pickTsvFile } from '@/lib/tsv';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useDeckStore } from '@/store/decks';
import { useTagStore } from '@/store/tags';
import type { Deck } from '@/types';

type ModalConfig =
  | { kind: 'info'; title?: string; message: string }
  | { kind: 'confirm'; title?: string; message: string; actions: ModalAction[] };

export default function DataSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useSQLiteContext();
  const { decks, setDecks, addDeck } = useDeckStore();
  const { setTags } = useTagStore();
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [tsvDeckPickerVisible, setTsvDeckPickerVisible] = useState(false);
  const [tsvAction, setTsvAction] = useState<'export' | 'import' | null>(null);
  const pendingTsvUriRef = useRef<string | null>(null);
  const tsvProcessingRef = useRef(false);

  async function doExport(includeImages: boolean) {
    try {
      setLoading(true);
      await exportDatabase(db, includeImages);
    } catch {
      setModal({ kind: 'info', message: t('dataManagement.exportError') });
    } finally {
      setLoading(false);
    }
  }

  async function doExportWithSizeCheck(includeImages: boolean) {
    try {
      setLoading(true);
      const sizeBytes = await estimateExportSize(db, includeImages);
      setLoading(false);
      const WARN_BYTES = 80 * 1024 * 1024;
      const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
      if (sizeBytes > WARN_BYTES) {
        setModal({ kind: 'confirm', title: t('dataManagement.exportLargeSizeTitle'), message: t('dataManagement.exportLargeSizeMessage', { size: sizeMB }), actions: [{ label: t('dataManagement.exportContinue'), onPress: () => { setModal(null); doExport(includeImages); } }] });
      } else {
        await doExport(includeImages);
      }
    } catch {
      setLoading(false);
      setModal({ kind: 'info', message: t('dataManagement.exportError') });
    }
  }

  function handleExport() {
    setModal({
      kind: 'confirm',
      title: t('dataManagement.exportImageTitle'),
      message: t('dataManagement.exportImageMessage'),
      actions: [
        { label: t('dataManagement.exportWithImages'), onPress: () => { setModal(null); doExportWithSizeCheck(true); } },
        { label: t('dataManagement.exportWithoutImages'), onPress: () => { setModal(null); doExportWithSizeCheck(false); } },
      ],
    });
  }

  async function handleTsvExport() {
    setModal({
      kind: 'confirm',
      title: t('dataManagement.tsvExportNoteTitle'),
      message: t('dataManagement.tsvExportNoteMessage'),
      actions: [{ label: t('dataManagement.exportContinue'), onPress: () => { setModal(null); setTsvAction('export'); setTsvDeckPickerVisible(true); } }],
    });
  }

  async function handleTsvImport() {
    const uri = await pickTsvFile();
    if (!uri) return;
    pendingTsvUriRef.current = uri;
    setModal({
      kind: 'confirm',
      title: t('dataManagement.tsvImportNoteTitle'),
      message: t('dataManagement.tsvImportNoteMessage'),
      actions: [{ label: t('dataManagement.exportContinue'), onPress: () => { setModal(null); setTsvAction('import'); setTsvDeckPickerVisible(true); } }],
    });
  }

  async function handleTsvDeckSelected(deck: Deck) {
    if (tsvProcessingRef.current) return;
    tsvProcessingRef.current = true;
    setTsvDeckPickerVisible(false);
    if (tsvAction === 'export') {
      try {
        setLoading(true);
        await exportDeckToTsv(db, deck.id, deck.name);
      } catch {
        setModal({ kind: 'info', message: t('dataManagement.exportError') });
      } finally {
        setLoading(false);
        tsvProcessingRef.current = false;
      }
    } else if (tsvAction === 'import') {
      const uri = pendingTsvUriRef.current;
      if (!uri) {
        tsvProcessingRef.current = false;
        return;
      }
      try {
        setLoading(true);
        const { created, updated } = await importTsv(db, uri, deck.id);
        const [updatedDecks, updatedTags] = await Promise.all([getAllDecks(db), getAllTags(db)]);
        setDecks(updatedDecks);
        setTags(updatedTags);
        setModal({ kind: 'info', message: t('dataManagement.tsvImportSuccess', { created, updated }) });
      } catch {
        setModal({ kind: 'info', message: t('dataManagement.tsvImportError') });
      } finally {
        setLoading(false);
        pendingTsvUriRef.current = null;
        tsvProcessingRef.current = false;
      }
    } else {
      tsvProcessingRef.current = false;
    }
  }

  async function handleImport() {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
    if (result.canceled || result.assets.length === 0) return;
    const fileUri = result.assets[0].uri;

    const doImport = async (mode: 'merge' | 'replace') => {
      try {
        setLoading(true);
        await importDatabase(db, fileUri, mode);
        const [importedDecks, importedTags] = await Promise.all([getAllDecks(db), getAllTags(db)]);
        setDecks(importedDecks);
        setTags(importedTags);
        setModal({ kind: 'info', message: t('dataManagement.importSuccess') });
      } catch (e) {
        const msg = e instanceof Error && e.message === 'INVALID_FORMAT'
          ? t('dataManagement.importInvalidFile')
          : t('dataManagement.importError');
        setModal({ kind: 'info', message: msg });
      } finally {
        setLoading(false);
      }
    };

    setModal({
      kind: 'confirm',
      title: t('dataManagement.importConfirmTitle'),
      message: t('dataManagement.importConfirmMessage'),
      actions: [
        { label: t('dataManagement.importMerge'), onPress: () => { setModal(null); doImport('merge'); } },
        {
          label: t('dataManagement.importReplace'),
          destructive: true,
          onPress: () => setModal({
            kind: 'confirm',
            title: t('dataManagement.importReplaceConfirmTitle'),
            message: t('dataManagement.importReplaceConfirmMessage'),
            actions: [{ label: t('dataManagement.importReplace'), destructive: true, onPress: () => { setModal(null); doImport('replace'); } }],
          }),
        },
      ],
    });
  }

  const rows: { title: string; subtitle: string; onPress: () => void }[] = [
    { title: t('dataManagement.exportTitle'), subtitle: t('dataManagement.exportSubtitle'), onPress: handleExport },
    { title: t('dataManagement.importTitle'), subtitle: t('dataManagement.importSubtitle'), onPress: handleImport },
    { title: t('dataManagement.exportTsv'), subtitle: t('dataManagement.exportTsvSubtitle'), onPress: handleTsvExport },
    { title: t('dataManagement.importTsv'), subtitle: t('dataManagement.importTsvSubtitle'), onPress: handleTsvImport },
  ];

  const overlay = (
    <>
      <DeckPickerModal
        visible={tsvDeckPickerVisible}
        title={tsvAction === 'export' ? t('dataManagement.selectDeckForExport') : t('dataManagement.selectDeckForImport')}
        decks={decks}
        onSelect={handleTsvDeckSelected}
        onClose={() => setTsvDeckPickerVisible(false)}
        onCreateDeck={tsvAction === 'import' ? async (name) => {
          const deck = await createDeck(db, { name, description: '', language: 'ja' });
          addDeck(deck);
          return deck;
        } : undefined}
      />
      {loading && <View style={styles.loadingOverlay} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} />}
      {modal?.kind === 'info' && (
        <InfoModal visible title={modal.title} message={modal.message} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'confirm' && (
        <ConfirmModal visible title={modal.title} message={modal.message} actions={modal.actions} onClose={() => setModal(null)} />
      )}
    </>
  );

  return (
    <SettingsDetail title={t('dataManagement.title')} overlay={overlay}>
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        {loading ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          rows.map((row) => (
            <Pressable key={row.title} style={styles.dataRow} onPress={row.onPress}>
              <View style={styles.dataRowText}>
                <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{row.title}</Text>
                <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{row.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
            </Pressable>
          ))
        )}
      </View>
    </SettingsDetail>
  );
}

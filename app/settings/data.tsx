import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { ConfirmModal, type ModalAction } from '@/components/ConfirmModal';
import { DeckPickerModal } from '@/components/DeckPickerModal';
import { InfoModal } from '@/components/InfoModal';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles as styles } from '@/components/settings/styles';
import { useKeyCommands } from '@/lib/useKeyCommands';

import { createDeck, getAllDecks } from '@/lib/database/decks';
import { getAllTags } from '@/lib/database/tags';
import { estimateExportSize, exportDatabase } from '@/lib/export';
import { importDatabase } from '@/lib/import';
import { exportDeckToTsv, importTsv, inspectTsvImport, pickTsvFile } from '@/lib/tsv';
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
  const router = useRouter();
  const db = useSQLiteContext();
  const { decks, setDecks, addDeck } = useDeckStore();
  const { setTags } = useTagStore();
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [tsvDeckPickerVisible, setTsvDeckPickerVisible] = useState(false);
  const [tsvAction, setTsvAction] = useState<'export' | 'import' | null>(null);
  const pendingTsvUriRef = useRef<string | null>(null);

  // 「OK のみ」情報モーダル表示中は Return=OK で閉じる（確認モーダルは複数アクションのため Return 非割当）。
  // Esc/B は SettingsDetail の onBack が閉じる。
  useKeyCommands([
    { input: KeyCommand.keyInputEnter, handler: () => { if (modal?.kind === 'info') setModal(null); } },
  ], modal?.kind === 'info');
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

  // 通常のデッキ選択フローへ進む（注意アラート → デッキ選択）
  function startTsvImportWithDeckPicker(message: string) {
    setModal({
      kind: 'confirm',
      title: t('dataManagement.tsvImportNoteTitle'),
      message,
      actions: [{ label: t('dataManagement.exportContinue'), onPress: () => { setModal(null); setTsvAction('import'); setTsvDeckPickerVisible(true); } }],
    });
  }

  async function handleTsvImport() {
    const uri = await pickTsvFile();
    if (!uri) return;
    pendingTsvUriRef.current = uri;

    let inspection: Awaited<ReturnType<typeof inspectTsvImport>>;
    try {
      inspection = await inspectTsvImport(db, uri);
    } catch {
      inspection = { kind: 'standard' };
    }

    if (inspection.kind === 'overwrite') {
      const { deckId, deckName } = inspection;
      setModal({
        kind: 'confirm',
        title: t('dataManagement.tsvImportNoteTitle'),
        message: t('dataManagement.tsvImportChoiceMessage'),
        actions: [
          {
            label: t('dataManagement.tsvImportOverwriteExisting'),
            onPress: () => setModal({
              kind: 'confirm',
              title: t('dataManagement.tsvImportOverwriteConfirmTitle'),
              message: t('dataManagement.tsvImportOverwriteConfirmMessage', { deck: deckName }),
              actions: [{ label: t('dataManagement.tsvImportOverwriteConfirmAction'), onPress: () => { setModal(null); runTsvImport(deckId); } }],
            }),
          },
          { label: t('dataManagement.tsvImportToOtherDeck'), onPress: () => { setModal(null); setTsvAction('import'); setTsvDeckPickerVisible(true); } },
        ],
      });
    } else if (inspection.kind === 'multiDeck') {
      startTsvImportWithDeckPicker(t('dataManagement.tsvImportMultiDeckMessage'));
    } else {
      startTsvImportWithDeckPicker(t('dataManagement.tsvImportNoteMessage'));
    }
  }

  async function runTsvImport(deckId: string) {
    if (tsvProcessingRef.current) return;
    tsvProcessingRef.current = true;
    const uri = pendingTsvUriRef.current;
    if (!uri) {
      tsvProcessingRef.current = false;
      return;
    }
    try {
      setLoading(true);
      const { created, updated } = await importTsv(db, uri, deckId);
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
  }

  async function handleTsvDeckSelected(deck: Deck) {
    setTsvDeckPickerVisible(false);
    if (tsvAction === 'export') {
      if (tsvProcessingRef.current) return;
      tsvProcessingRef.current = true;
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
      await runTsvImport(deck.id);
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

  const [showExportInfo, setShowExportInfo] = useState(false);
  const [showImportInfo, setShowImportInfo] = useState(false);
  const [showTsvExportInfo, setShowTsvExportInfo] = useState(false);
  const [showTsvImportInfo, setShowTsvImportInfo] = useState(false);

  const rows: { title: string; info: string; onPress: () => void; showInfo: boolean; setShowInfo: (v: boolean) => void }[] = [
    { title: t('dataManagement.exportTitle'), info: t('dataManagement.exportInfo'), onPress: handleExport, showInfo: showExportInfo, setShowInfo: setShowExportInfo },
    { title: t('dataManagement.importTitle'), info: t('dataManagement.importInfo'), onPress: handleImport, showInfo: showImportInfo, setShowInfo: setShowImportInfo },
    { title: t('dataManagement.exportTsv'), info: t('dataManagement.exportTsvInfo'), onPress: handleTsvExport, showInfo: showTsvExportInfo, setShowInfo: setShowTsvExportInfo },
    { title: t('dataManagement.importTsv'), info: t('dataManagement.importTsvInfo'), onPress: handleTsvImport, showInfo: showTsvImportInfo, setShowInfo: setShowTsvImportInfo },
  ];

  // バックアップ(export)＋復元(import)、TSVエクスポート＋インポートを、それぞれ1カードに2行でまとめる
  const rowPairs = [[rows[0], rows[1]], [rows[2], rows[3]]];

  const renderRow = (row: (typeof rows)[number]) => (
    <View key={row.title}>
      <Pressable style={styles.dataRow} onPress={row.onPress}>
        <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md, flexShrink: 1 }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{row.title}</Text>
        <Pressable onPress={() => row.setShowInfo(!row.showInfo)} hitSlop={8}>
          <Ionicons
            name={row.showInfo ? 'information-circle' : 'information-circle-outline'}
            size={Math.max(theme.fontSize.lg, 20)}
            color={theme.colors.textTertiary}
          />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
      </Pressable>
      {row.showInfo && (
        <View style={[styles.syncInfoBox, { backgroundColor: theme.colors.background }]}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {row.info}
          </Text>
        </View>
      )}
    </View>
  );

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
    <SettingsDetail
      title={t('dataManagement.title')}
      overlay={overlay}
      onBack={(direct) => {
        if (modal) { setModal(null); return; }
        if (tsvDeckPickerVisible) { setTsvDeckPickerVisible(false); return; }
        if (!direct && (showExportInfo || showImportInfo || showTsvExportInfo || showTsvImportInfo)) {
          setShowExportInfo(false); setShowImportInfo(false); setShowTsvExportInfo(false); setShowTsvImportInfo(false);
          return;
        }
        router.back();
      }}
    >
      {loading ? (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        rowPairs.map((pair, i) => (
          <View key={i} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            {renderRow(pair[0])}
            <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 8 }} />
            {renderRow(pair[1])}
          </View>
        ))
      )}
    </SettingsDetail>
  );
}

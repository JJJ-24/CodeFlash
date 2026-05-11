import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useCallback, useRef, useState } from 'react';

import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';

import { ConfirmModal, type ModalAction } from '@/components/ConfirmModal';
import { DeckPickerModal } from '@/components/DeckPickerModal';
import { InfoModal } from '@/components/InfoModal';

import { getAllDecks } from '@/lib/database/decks';
import { getAllTags } from '@/lib/database/tags';
import { estimateExportSize, exportDatabase } from '@/lib/export';
import { importDatabase } from '@/lib/import';
import { cancelAllReminders, requestPermission, scheduleDailyReminder } from '@/lib/notifications';
import { exportDeckToTsv, importTsv, pickTsvFile } from '@/lib/tsv';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW } from '@/lib/theme';
import { useDeckStore } from '@/store/decks';
import { useProStore } from '@/store/pro';
import { useSettingsStore } from '@/store/settings';
import { useTagStore } from '@/store/tags';
import { useThemeStore } from '@/store/theme';
import type { ColorSchemePreference, FontSizePreference } from '@/store/theme';
import type { InitialFilterPreference } from '@/store/settings';
import type { Deck } from '@/types';


interface SegmentedCardProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

function SegmentedCard<T extends string>({ label, options, value, onChange }: SegmentedCardProps<T>) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{label}</Text>
      <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
        {options.map(({ value: optValue, label: optLabel }) => {
          const active = value === optValue;
          return (
            <Pressable
              key={optValue}
              style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
              onPress={() => onChange(optValue)}
            >
              <Text style={[
                styles.segmentText,
                { color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.md },
                active && styles.segmentTextActive,
              ]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {optLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useSQLiteContext();
  const router = useRouter();
  const { isPro } = useProStore();
  const { preference, setPreference, fontSizePreference, setFontSizePreference } = useThemeStore();
  const {
    initialFilterPreference, setInitialFilterPreference,
    keyboardShortcutsEnabled, setKeyboardShortcutsEnabled,
    notificationEnabled, notificationHour, notificationMinute,
    setNotificationEnabled, setNotificationTime,
  } = useSettingsStore();
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();

  useFocusEffect(
    useCallback(() => {
      onScreenFocus();
      return () => { onScreenBlur(); };
    }, [onScreenFocus, onScreenBlur])
  );
  const { decks, setDecks } = useDeckStore();
  const { setTags } = useTagStore();
  const [loading, setLoading] = useState(false);
  const [tsvDeckPickerVisible, setTsvDeckPickerVisible] = useState(false);
  const [tsvAction, setTsvAction] = useState<'export' | 'import' | null>(null);
  const pendingTsvUriRef = useRef<string | null>(null);
  const tsvProcessingRef = useRef(false);

  type ModalConfig =
    | { kind: 'info'; title?: string; message: string }
    | { kind: 'confirm'; title?: string; message: string; actions: ModalAction[] };
  const [modal, setModal] = useState<ModalConfig | null>(null);

  async function handleNotificationToggle(value: boolean) {
    if (value) {
      const granted = await requestPermission();
      if (!granted) {
        setModal({ kind: 'info', title: t('notification.permissionDenied'), message: t('notification.permissionDeniedMessage') });
        return;
      }
      setNotificationEnabled(true);
      await scheduleDailyReminder(notificationHour, notificationMinute).catch(() => {});
    } else {
      setNotificationEnabled(false);
      await cancelAllReminders().catch(() => {});
    }
  }

  async function handleNotificationTimeChange(_: unknown, date?: Date) {
    if (!date) return;
    const hour = date.getHours();
    const minute = date.getMinutes();
    setNotificationTime(hour, minute);
    await scheduleDailyReminder(hour, minute).catch(() => {});
  }

  const notificationTimeDate = new Date();
  notificationTimeDate.setHours(notificationHour, notificationMinute, 0, 0);

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
        const [decks, tags] = await Promise.all([getAllDecks(db), getAllTags(db)]);
        setDecks(decks);
        setTags(tags);
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

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.container} pointerEvents={loading ? 'none' : 'auto'}>
      {/* Pro プラン */}
      <Pressable
        style={[styles.card, styles.proCard, { backgroundColor: theme.colors.surface }]}
        onPress={() => !isPro && router.push('/paywall')}
        onLongPress={() => { if (__DEV__ && isPro) useProStore.getState().setIsPro(false); }}
        disabled={isPro && !__DEV__}
      >
        <View style={styles.proRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.proTitleRow}>
              <Text style={[styles.proTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                CodeFlash Pro
              </Text>
              {isPro && (
                <View style={[styles.proBadge, { backgroundColor: theme.colors.primary }]}>
                  <Text style={[styles.proBadgeText, { fontSize: theme.fontSize.xs }]}>Pro</Text>
                </View>
              )}
            </View>
            <Text style={[styles.proSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {isPro ? t('pro.alreadyPro') : t('pro.paywallSubtitle')}
            </Text>
          </View>
          {isPro ? (
            <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
          ) : (
            <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
          )}
        </View>
      </Pressable>

      <SegmentedCard
        label={t('settings.theme')}
        options={[
          { value: 'light' as ColorSchemePreference, label: t('settings.themeLight') },
          { value: 'dark' as ColorSchemePreference,  label: t('settings.themeDark') },
          { value: 'system' as ColorSchemePreference, label: t('settings.themeSystem') },
        ]}
        value={preference}
        onChange={setPreference}
      />

      <SegmentedCard
        label={t('settings.fontSize')}
        options={[
          { value: 'small' as FontSizePreference,  label: t('settings.fontSizeSmall') },
          { value: 'medium' as FontSizePreference, label: t('settings.fontSizeMedium') },
          { value: 'large' as FontSizePreference,  label: t('settings.fontSizeLarge') },
        ]}
        value={fontSizePreference}
        onChange={setFontSizePreference}
      />

      <SegmentedCard
        label={t('settings.initialFilter')}
        options={[
          { value: 'all' as InitialFilterPreference,    label: t('common.all') },
          { value: 'review' as InitialFilterPreference, label: t('common.due') },
          { value: 'none' as InitialFilterPreference,   label: t('settings.initialFilterNone') },
        ]}
        value={initialFilterPreference}
        onChange={setInitialFilterPreference}
      />

      {/* 通知 */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {t('notification.title')}
        </Text>
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('notification.dailyReminder')}
          </Text>
          <Switch
            value={notificationEnabled}
            onValueChange={handleNotificationToggle}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>
        {notificationEnabled && (
          <View style={styles.notificationRow}>
            <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('notification.reminderTime')}
            </Text>
            <DateTimePicker
              value={notificationTimeDate}
              mode="time"
              display="compact"
              onChange={handleNotificationTimeChange}
              themeVariant={theme.dark ? 'dark' : 'light'}
            />
          </View>
        )}
      </View>

      {/* キーボードショートカット */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {t('settings.keyboard')}
        </Text>
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.keyboardEnabled')}
          </Text>
          <Switch
            value={keyboardShortcutsEnabled}
            onValueChange={setKeyboardShortcutsEnabled}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>
      </View>

      {/* データ管理 */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {t('dataManagement.title')}
        </Text>
        {loading ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          <>
            <Pressable style={styles.dataRow} onPress={handleExport}>
              <View style={styles.dataRowText}>
                <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('dataManagement.exportTitle')}</Text>
                <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('dataManagement.exportSubtitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
            </Pressable>
            <Pressable style={styles.dataRow} onPress={handleImport}>
              <View style={styles.dataRowText}>
                <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('dataManagement.importTitle')}</Text>
                <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('dataManagement.importSubtitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
            </Pressable>
            <Pressable style={styles.dataRow} onPress={handleTsvExport}>
              <View style={styles.dataRowText}>
                <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('dataManagement.exportTsv')}</Text>
                <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('dataManagement.exportTsvSubtitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
            </Pressable>
            <Pressable style={styles.dataRow} onPress={handleTsvImport}>
              <View style={styles.dataRowText}>
                <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('dataManagement.importTsv')}</Text>
                <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('dataManagement.importTsvSubtitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
            </Pressable>
          </>
        )}
      </View>

    </ScrollView>

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
      onKeyPress={({ nativeEvent: { key } }) => {
        if (!keyboardShortcutsEnabled) return;
        if (key === '.') { router.navigate('/(tabs)'); }
        else if (key === ',') { router.navigate('/(tabs)/stats'); }
      }}
      onBlur={onInputBlur}
    />

    <DeckPickerModal
      visible={tsvDeckPickerVisible}
      title={tsvAction === 'export' ? t('dataManagement.selectDeckForExport') : t('dataManagement.selectDeckForImport')}
      decks={decks}
      onSelect={handleTsvDeckSelected}
      onClose={() => setTsvDeckPickerVisible(false)}
    />
    {loading && <View style={styles.loadingOverlay} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} />}
    {modal?.kind === 'info' && (
      <InfoModal
        visible
        title={modal.title}
        message={modal.message}
        onClose={() => setModal(null)}
      />
    )}
    {modal?.kind === 'confirm' && (
      <ConfirmModal
        visible
        title={modal.title}
        message={modal.message}
        actions={modal.actions}
        onClose={() => setModal(null)}
      />
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  card: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    ...SHADOW.subtle,
  },
  sectionLabel: { fontWeight: '600' },
  proCard: { paddingVertical: 16 },
  proRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  proTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proTitle: { fontWeight: '700' },
  proSubtitle: { lineHeight: 18 },
  proBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  proBadgeText: { color: '#fff', fontWeight: '700', letterSpacing: 1 },
  segmented: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: 'center',
  },
  segmentText: {},
  segmentTextActive: { fontWeight: '700' },
dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  dataRowText: { flex: 1, gap: 2 },
  dataRowTitle: { fontWeight: '600' },
  dataRowSubtitle: {},
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  hiddenKeyboardInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  notificationLabel: { flex: 1 },
});

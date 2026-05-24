import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';

import { ConfirmModal, type ModalAction } from '@/components/ConfirmModal';
import { DeckPickerModal } from '@/components/DeckPickerModal';
import { InfoModal } from '@/components/InfoModal';

import { createDeck, getAllDecks } from '@/lib/database/decks';
import { getAllTags } from '@/lib/database/tags';
import { estimateExportSize, exportDatabase } from '@/lib/export';
import { importDatabase } from '@/lib/import';
import { cancelAllReminders, requestPermission, scheduleDailyReminder } from '@/lib/notifications';
import {
  ICloudUnavailableError,
  NoRemoteBackupError,
  SchemaVersionMismatchError,
  syncNow,
} from '@/lib/sync/syncEngine';
import { exportDeckToTsv, importTsv, pickTsvFile } from '@/lib/tsv';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW } from '@/lib/theme';
import { useDeckStore } from '@/store/decks';
import { useProStore } from '@/store/pro';
import {
  FSRS_PRESET_RETENTION,
  FSRS_RETENTION_MAX,
  FSRS_RETENTION_MIN,
  useSettingsStore,
} from '@/store/settings';
import { useSyncStore } from '@/store/sync';
import { useTagStore } from '@/store/tags';
import { useThemeStore } from '@/store/theme';
import type { ColorSchemePreference, FontSizePreference } from '@/store/theme';
import type { FsrsPreset, InitialFilterPreference } from '@/store/settings';
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
    fsrsDesiredRetention, setFsrsDesiredRetention,
  } = useSettingsStore();
  const {
    enabled: syncEnabled,
    setEnabled: setSyncEnabled,
    status: syncStatus,
    direction: syncDirection,
    lastSyncedAt,
    errorMessage: syncErrorMessage,
    clearError: clearSyncError,
  } = useSyncStore();
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur, isScreenFocusedRef } = useKeyboardFocus();

  useFocusEffect(
    useCallback(() => {
      onScreenFocus();
      return () => { onScreenBlur(); };
    }, [onScreenFocus, onScreenBlur])
  );
  const { decks, setDecks, addDeck } = useDeckStore();
  const { setTags } = useTagStore();
  const [loading, setLoading] = useState(false);
  const [tsvDeckPickerVisible, setTsvDeckPickerVisible] = useState(false);
  const [tsvAction, setTsvAction] = useState<'export' | 'import' | null>(null);
  const pendingTsvUriRef = useRef<string | null>(null);
  const tsvProcessingRef = useRef(false);

  // DeckPickerModal の TextInput にフォーカスを渡すため hidden TextInput の自動再フォーカスを抑止する
  useEffect(() => {
    if (tsvDeckPickerVisible) {
      isScreenFocusedRef.current = false;
      keyboardRef.current?.blur();
    } else if (keyboardShortcutsEnabled) {
      isScreenFocusedRef.current = true;
      const timer = setTimeout(() => keyboardRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [tsvDeckPickerVisible, keyboardShortcutsEnabled, keyboardRef, isScreenFocusedRef]);

  type ModalConfig =
    | { kind: 'info'; title?: string; message: string }
    | { kind: 'confirm'; title?: string; message: string; actions: ModalAction[] };
  const [modal, setModal] = useState<ModalConfig | null>(null);

  function handleFsrsPresetSelect(preset: FsrsPreset) {
    setFsrsDesiredRetention(FSRS_PRESET_RETENTION[preset]);
  }

  function handleFsrsRetentionChange(value: number) {
    const rounded = Math.round(value * 100) / 100;
    setFsrsDesiredRetention(rounded);
  }

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

  function describeSyncError(e: unknown): string {
    if (e instanceof ICloudUnavailableError) return t('sync.iCloudUnavailable');
    if (e instanceof SchemaVersionMismatchError) return t('sync.schemaVersionMismatch');
    if (e instanceof NoRemoteBackupError) return t('sync.noRemoteBackup');
    return e instanceof Error ? e.message : t('sync.syncError');
  }

  async function handleSyncToggle(value: boolean) {
    clearSyncError();
    if (value) {
      // 有効化：その場で初回同期を試行
      setSyncEnabled(true);
      try {
        await syncNow(db, 'auto');
      } catch (e) {
        // syncNow が store にエラーをセットするので追加表示は不要
        setModal({ kind: 'info', title: t('sync.syncError'), message: describeSyncError(e) });
      }
    } else {
      setSyncEnabled(false);
    }
  }

  async function handleManualSync() {
    if (syncStatus === 'syncing') return;
    try {
      await syncNow(db, 'auto');
    } catch (e) {
      setModal({ kind: 'info', title: t('sync.syncError'), message: describeSyncError(e) });
    }
  }

  async function handleForceUpload() {
    setModal({
      kind: 'confirm',
      title: t('sync.forceUpload'),
      message: t('sync.forceUploadConfirm'),
      actions: [{
        label: t('sync.forceUpload'),
        destructive: true,
        onPress: async () => {
          setModal(null);
          try {
            await syncNow(db, 'upload');
          } catch (e) {
            setModal({ kind: 'info', title: t('sync.syncError'), message: describeSyncError(e) });
          }
        },
      }],
    });
  }

  async function handleForceDownload() {
    setModal({
      kind: 'confirm',
      title: t('sync.forceDownload'),
      message: t('sync.forceDownloadConfirm'),
      actions: [{
        label: t('sync.forceDownload'),
        destructive: true,
        onPress: async () => {
          setModal(null);
          try {
            await syncNow(db, 'download');
          } catch (e) {
            setModal({ kind: 'info', title: t('sync.syncError'), message: describeSyncError(e) });
          }
        },
      }],
    });
  }

  function formatLastSynced(): string {
    if (!lastSyncedAt) return t('sync.lastSyncedNever');
    const d = new Date(lastSyncedAt);
    const datetime = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return t('sync.lastSyncedAt', { datetime });
  }

  function getSyncStatusText(): string {
    if (syncStatus !== 'syncing') return '';
    if (syncDirection === 'upload') return t('sync.syncingUpload');
    if (syncDirection === 'download') return t('sync.syncingDownload');
    return t('sync.syncing');
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
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.container}
      pointerEvents={loading ? 'none' : 'auto'}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      scrollsToTop={false}
    >
      {/* Pro プラン */}
      <Pressable
        style={[styles.card, styles.proCard, { backgroundColor: theme.colors.surface }]}
        onPress={() => !isPro && router.push('/paywall')}
        onLongPress={() => { if (__DEV__) useProStore.getState().setIsPro(!isPro); }}
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
                  <Text style={[styles.proBadgeText, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>Pro</Text>
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

      {__DEV__ && (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            DEV
          </Text>
          <View style={styles.notificationRow}>
            <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              Pro 切替（開発用）
            </Text>
            <Switch
              value={isPro}
              onValueChange={(v) => useProStore.getState().setIsPro(v)}
              trackColor={{ true: theme.colors.primary }}
            />
          </View>
        </View>
      )}

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

      {/* FSRSカスタマイズ */}
      {!isPro ? (
        <Pressable
          style={[styles.card, { backgroundColor: theme.colors.surface }]}
          onPress={() => router.push('/paywall')}
        >
          <View style={styles.proRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.proTitleRow}>
                <Text style={[styles.proTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('settings.fsrs')}
                </Text>
                <Ionicons name="lock-closed" size={theme.fontSize.sm} color={theme.colors.primary} />
              </View>
              <Text style={[styles.proSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.fsrsLockedSubtitle')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
          </View>
        </Pressable>
      ) : (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.fsrs')}
          </Text>

          {/* プリセット */}
          <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
            {(['longTerm', 'standard', 'exam'] as FsrsPreset[]).map((preset) => {
                const active = FSRS_PRESET_RETENTION[preset] === fsrsDesiredRetention;
                const labelKey = ({
                  exam: 'settings.fsrsPresetFocus',
                  standard: 'settings.fsrsPresetStandard',
                  longTerm: 'settings.fsrsPresetLongTerm',
                } as const)[preset];
                return (
                  <Pressable
                    key={preset}
                    style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
                    onPress={() => handleFsrsPresetSelect(preset)}
                  >
                    <Text style={[
                      styles.segmentText,
                      { color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.sm },
                      active && styles.segmentTextActive,
                    ]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                      {t(labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
          </View>

          {/* 目標保持率 */}
          <View style={{ gap: 6 }}>
            <View style={styles.fsrsRetentionHeader}>
              <Text style={[styles.fsrsSubLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.fsrsRetention')}
              </Text>
              <Text style={[styles.fsrsRetentionValue, { color: theme.colors.primary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {Math.round(fsrsDesiredRetention * 100)}%
              </Text>
            </View>
            <Slider
              minimumValue={FSRS_RETENTION_MIN}
              maximumValue={FSRS_RETENTION_MAX}
              step={0.01}
              value={fsrsDesiredRetention}
              onValueChange={handleFsrsRetentionChange}
              minimumTrackTintColor={theme.colors.primary}
              maximumTrackTintColor={theme.colors.iconSubtle}
              thumbTintColor={theme.colors.primary}
            />
            <View style={styles.fsrsRetentionScale}>
              <Text style={[styles.fsrsScaleText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                {Math.round(FSRS_RETENTION_MIN * 100)}%
              </Text>
              <Text style={[styles.fsrsScaleText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                {Math.round(FSRS_RETENTION_MAX * 100)}%
              </Text>
            </View>
            <Text style={[styles.fsrsHint, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
              {t('settings.fsrsRetentionHint')}
            </Text>
          </View>
        </View>
      )}

      {/* iCloud 同期 */}
      {!isPro ? (
        <Pressable
          style={[styles.card, { backgroundColor: theme.colors.surface }]}
          onPress={() => router.push('/paywall')}
        >
          <View style={styles.proRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.proTitleRow}>
                <Text style={[styles.proTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('sync.title')}
                </Text>
                <Ionicons name="lock-closed" size={theme.fontSize.sm} color={theme.colors.primary} />
              </View>
              <Text style={[styles.proSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('sync.lockedSubtitle')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
          </View>
        </Pressable>
      ) : (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('sync.title')}
          </Text>
          <View style={styles.notificationRow}>
            <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('sync.enabled')}
            </Text>
            <Switch
              value={syncEnabled}
              onValueChange={handleSyncToggle}
              trackColor={{ true: theme.colors.primary }}
              disabled={syncStatus === 'syncing'}
            />
          </View>
          {syncEnabled && (
            <>
              <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                {t('sync.description')}
              </Text>
              <View style={styles.syncStatusRow}>
                <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {formatLastSynced()}
                </Text>
              </View>
              {syncErrorMessage && syncStatus !== 'syncing' && (
                <Text style={[{ color: theme.colors.danger, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {syncErrorMessage}
                </Text>
              )}
              <Pressable
                style={[styles.dataRow, { opacity: syncStatus === 'syncing' ? 0.6 : 1 }]}
                onPress={handleManualSync}
                disabled={syncStatus === 'syncing'}
              >
                <View style={styles.dataRowText}>
                  <Text style={[styles.dataRowTitle, { color: theme.colors.primary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                    {syncStatus === 'syncing' ? getSyncStatusText() : t('sync.syncNow')}
                  </Text>
                </View>
                {syncStatus === 'syncing' ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Ionicons name="sync" size={theme.fontSize.lg} color={theme.colors.primary} />
                )}
              </Pressable>
              <View style={styles.syncAdvancedRow}>
                <Pressable
                  style={[styles.syncAdvancedBtn, { opacity: syncStatus === 'syncing' ? 0.4 : 1 }]}
                  onPress={handleForceUpload}
                  disabled={syncStatus === 'syncing'}
                >
                  <Ionicons name="cloud-upload-outline" size={theme.fontSize.md} color={theme.colors.textSecondary} />
                  <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                    {t('sync.forceUpload')}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.syncAdvancedBtn, { opacity: syncStatus === 'syncing' ? 0.4 : 1 }]}
                  onPress={handleForceDownload}
                  disabled={syncStatus === 'syncing'}
                >
                  <Ionicons name="cloud-download-outline" size={theme.fontSize.md} color={theme.colors.textSecondary} />
                  <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                    {t('sync.forceDownload')}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}

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

      {/* アプリについて */}
      <Pressable
        style={[styles.card, { backgroundColor: theme.colors.surface }]}
        onPress={() => router.push('/about')}
      >
        <View style={styles.dataRow}>
          <View style={styles.dataRowText}>
            <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('about.title')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
        </View>
      </Pressable>

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
      onCreateDeck={tsvAction === 'import' ? async (name) => {
        const deck = await createDeck(db, { name, description: '', language: 'ja' });
        addDeck(deck);
        return deck;
      } : undefined}
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
  fsrsSubLabel: { fontWeight: '600' },
  fsrsRetentionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  fsrsRetentionValue: { fontWeight: '700' },
  fsrsRetentionScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  fsrsScaleText: {},
  fsrsHint: { lineHeight: 16, marginTop: 2 },
  syncStatusRow: {
    paddingVertical: 4,
  },
  syncAdvancedRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 4,
  },
  syncAdvancedBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.25)',
  },
});

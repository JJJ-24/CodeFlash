import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRef, useState } from 'react';

import { DeckPickerModal } from '@/components/DeckPickerModal';

import { getAllDecks } from '@/lib/database/decks';
import { getAllTags } from '@/lib/database/tags';
import { estimateImageExportSize, exportDatabase } from '@/lib/export';
import { importDatabase } from '@/lib/import';
import { cancelAllReminders, requestPermission, scheduleDailyReminder } from '@/lib/notifications';
import { exportDeckToTsv, importTsv, pickTsvFile } from '@/lib/tsv';
import { useTheme } from '@/lib/theme';
import { useDeckStore } from '@/store/decks';
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
      <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>{label}</Text>
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
              ]}>
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
  const { preference, setPreference, fontSizePreference, setFontSizePreference } = useThemeStore();
  const {
    initialFilterPreference, setInitialFilterPreference,
    notificationEnabled, notificationHour, notificationMinute,
    setNotificationEnabled, setNotificationTime,
  } = useSettingsStore();
  const { decks, setDecks } = useDeckStore();
  const { setTags } = useTagStore();
  const [loading, setLoading] = useState(false);
  const [tsvDeckPickerVisible, setTsvDeckPickerVisible] = useState(false);
  const [tsvAction, setTsvAction] = useState<'export' | 'import' | null>(null);
  const pendingTsvUriRef = useRef<string | null>(null);
  const tsvProcessingRef = useRef(false);

  async function handleNotificationToggle(value: boolean) {
    if (value) {
      const granted = await requestPermission();
      if (!granted) {
        Alert.alert(t('notification.permissionDenied'), t('notification.permissionDeniedMessage'));
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
      Alert.alert(t('dataManagement.exportError'));
    } finally {
      setLoading(false);
    }
  }

  async function handleExportWithImages() {
    try {
      setLoading(true);
      const sizeBytes = await estimateImageExportSize(db);
      setLoading(false);
      const WARN_BYTES = 10 * 1024 * 1024;
      const PERF_WARN_BYTES = 50 * 1024 * 1024;
      const sizeMB = ((sizeBytes * 4) / 3 / 1024 / 1024).toFixed(1);
      if (sizeBytes > PERF_WARN_BYTES) {
        Alert.alert(
          t('dataManagement.exportLargeSizeTitle'),
          t('dataManagement.exportPerfWarnMessage', { size: sizeMB }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('dataManagement.exportContinue'), onPress: () => doExport(true) },
          ]
        );
      } else if (sizeBytes > WARN_BYTES) {
        Alert.alert(
          t('dataManagement.exportLargeSizeTitle'),
          t('dataManagement.exportLargeSizeMessage', { size: sizeMB }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('dataManagement.exportContinue'), onPress: () => doExport(true) },
          ]
        );
      } else {
        await doExport(true);
      }
    } catch {
      setLoading(false);
      Alert.alert(t('dataManagement.exportError'));
    }
  }

  function handleExport() {
    Alert.alert(
      t('dataManagement.exportImageTitle'),
      t('dataManagement.exportImageMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('dataManagement.exportWithoutImages'), onPress: () => doExport(false) },
        { text: t('dataManagement.exportWithImages'), onPress: handleExportWithImages },
      ]
    );
  }

  async function handleTsvExport() {
    Alert.alert(
      t('dataManagement.tsvExportNoteTitle'),
      t('dataManagement.tsvExportNoteMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('dataManagement.exportContinue'),
          onPress: () => {
            setTsvAction('export');
            setTsvDeckPickerVisible(true);
          },
        },
      ]
    );
  }

  async function handleTsvImport() {
    const uri = await pickTsvFile();
    if (!uri) return;
    pendingTsvUriRef.current = uri;
    Alert.alert(
      t('dataManagement.tsvImportNoteTitle'),
      t('dataManagement.tsvImportNoteMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('dataManagement.exportContinue'),
          onPress: () => {
            setTsvAction('import');
            setTsvDeckPickerVisible(true);
          },
        },
      ]
    );
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
        Alert.alert(t('dataManagement.exportError'));
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
        const updatedDecks = await getAllDecks(db);
        setDecks(updatedDecks);
        Alert.alert(t('dataManagement.tsvImportSuccess', { created, updated }));
      } catch {
        Alert.alert(t('dataManagement.tsvImportError'));
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
        Alert.alert(t('dataManagement.importSuccess'));
      } catch (e) {
        const msg = e instanceof Error && e.message === 'INVALID_FORMAT'
          ? t('dataManagement.importInvalidFile')
          : t('dataManagement.importError');
        Alert.alert(msg);
      } finally {
        setLoading(false);
      }
    };

    Alert.alert(
      t('dataManagement.importConfirmTitle'),
      t('dataManagement.importConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('dataManagement.importMerge'),
          onPress: () => doImport('merge'),
        },
        {
          text: t('dataManagement.importReplace'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('dataManagement.importReplaceConfirmTitle'),
              t('dataManagement.importReplaceConfirmMessage'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('dataManagement.importReplace'),
                  style: 'destructive',
                  onPress: () => doImport('replace'),
                },
              ]
            );
          },
        },
      ]
    );
  }

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.container} pointerEvents={loading ? 'none' : 'auto'}>
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

      {/* 通知 */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>
          {t('notification.title')}
        </Text>
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]}>
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
            <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]}>
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

      <SegmentedCard
        label={t('settings.initialFilter')}
        options={[
          { value: 'all' as InitialFilterPreference,    label: t('settings.initialFilterAll') },
          { value: 'review' as InitialFilterPreference, label: t('settings.initialFilterReview') },
          { value: 'none' as InitialFilterPreference,   label: t('settings.initialFilterNone') },
        ]}
        value={initialFilterPreference}
        onChange={setInitialFilterPreference}
      />

      {/* データ管理 */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>
          {t('dataManagement.title')}
        </Text>
        {loading ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          <>
            <Pressable style={styles.dataRow} onPress={handleExport}>
              <Ionicons name="arrow-up-circle-outline" size={22} color={theme.colors.primary} />
              <View style={styles.dataRowText}>
                <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]}>{t('dataManagement.exportTitle')}</Text>
                <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>{t('dataManagement.exportSubtitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.iconSubtle} />
            </Pressable>
            <Pressable style={styles.dataRow} onPress={handleImport}>
              <Ionicons name="arrow-down-circle-outline" size={22} color={theme.colors.primary} />
              <View style={styles.dataRowText}>
                <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]}>{t('dataManagement.importTitle')}</Text>
                <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>{t('dataManagement.importSubtitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.iconSubtle} />
            </Pressable>
            <Pressable style={styles.dataRow} onPress={handleTsvExport}>
              <Ionicons name="document-text-outline" size={22} color={theme.colors.primary} />
              <View style={styles.dataRowText}>
                <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]}>{t('dataManagement.exportTsv')}</Text>
                <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>{t('dataManagement.exportTsvSubtitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.iconSubtle} />
            </Pressable>
            <Pressable style={styles.dataRow} onPress={handleTsvImport}>
              <Ionicons name="document-attach-outline" size={22} color={theme.colors.primary} />
              <View style={styles.dataRowText}>
                <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]}>{t('dataManagement.importTsv')}</Text>
                <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>{t('dataManagement.importTsvSubtitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.iconSubtle} />
            </Pressable>
          </>
        )}
      </View>

    </ScrollView>

    <DeckPickerModal
      visible={tsvDeckPickerVisible}
      title={tsvAction === 'export' ? t('dataManagement.selectDeckForExport') : t('dataManagement.selectDeckForImport')}
      decks={decks}
      onSelect={handleTsvDeckSelected}
      onClose={() => setTsvDeckPickerVisible(false)}
    />
    {loading && <View style={styles.loadingOverlay} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} />}
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionLabel: { fontWeight: '600' },
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
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  notificationLabel: { flex: 1 },
});

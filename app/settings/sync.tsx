import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Switch, Text, View } from 'react-native';

import { ConfirmModal, type ModalAction } from '@/components/ConfirmModal';
import { InfoModal } from '@/components/InfoModal';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles as styles } from '@/components/settings/styles';

import {
  type LocalBackup,
  listLocalBackups,
  restoreFromLocalBackup,
  syncNow,
  toSyncErrorCode,
} from '@/lib/sync/syncEngine';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useProStore } from '@/store/pro';
import { useSyncStore, type SyncErrorCode } from '@/store/sync';

type ModalConfig =
  | { kind: 'info'; title?: string; message: string }
  | { kind: 'confirm'; title?: string; message: string; actions: ModalAction[] };

export default function SyncSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useSQLiteContext();
  const router = useRouter();
  const { isPro } = useProStore();
  const {
    enabled: syncEnabled,
    setEnabled: setSyncEnabled,
    status: syncStatus,
    direction: syncDirection,
    lastSyncedAt,
    errorCode: syncErrorCode,
    clearError: clearSyncError,
  } = useSyncStore();
  const [modal, setModal] = useState<ModalConfig | null>(null);

  /** 同期エラーコードを翻訳済みの文言にする（モーダル・インライン表示で共用）。 */
  function syncErrorText(code: SyncErrorCode): string {
    switch (code) {
      case 'unavailable': return t('sync.iCloudUnavailable');
      case 'schemaMismatch': return t('sync.schemaVersionMismatch');
      case 'noRemoteBackup': return t('sync.noRemoteBackup');
      case 'timeout': return t('sync.syncTimeout');
      case 'storageFull': return t('sync.storageFull');
      default: return t('sync.syncError');
    }
  }

  function describeSyncError(e: unknown): string {
    return syncErrorText(toSyncErrorCode(e));
  }

  async function handleSyncToggle(value: boolean) {
    clearSyncError();
    if (value) {
      setSyncEnabled(true);
      try {
        await syncNow(db, 'auto');
      } catch (e) {
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

  function formatBackupTime(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // 自動バックアップ一覧を提示。各世代をアクションボタンとして並べ、選択で確認へ進む。
  async function handleRestore() {
    let backups: LocalBackup[];
    try {
      backups = await listLocalBackups();
    } catch {
      backups = [];
    }
    if (backups.length === 0) {
      setModal({ kind: 'info', title: t('sync.restoreTitle'), message: t('sync.restoreNone') });
      return;
    }
    setModal({
      kind: 'confirm',
      title: t('sync.restoreTitle'),
      message: t('sync.restoreSelectMessage'),
      actions: backups.map((b) => ({
        label: formatBackupTime(b.timestamp),
        onPress: () => confirmRestore(b),
      })),
    });
  }

  function confirmRestore(backup: LocalBackup) {
    setModal({
      kind: 'confirm',
      title: t('sync.restoreTitle'),
      message: t('sync.restoreConfirmMessage', { datetime: formatBackupTime(backup.timestamp) }),
      actions: [{
        label: t('sync.restoreConfirm'),
        destructive: true,
        onPress: async () => {
          setModal(null);
          try {
            await restoreFromLocalBackup(db, backup.path);
            if (syncEnabled) {
              try { await syncNow(db, 'auto'); } catch { /* 反映失敗は致命的でない。次回同期で再試行 */ }
            }
            setModal({ kind: 'info', title: t('sync.restoreTitle'), message: t('sync.restoreSuccess') });
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

  const overlay = (
    <>
      {modal?.kind === 'info' && (
        <InfoModal visible title={modal.title} message={modal.message} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'confirm' && (
        <ConfirmModal visible title={modal.title} message={modal.message} actions={modal.actions} onClose={() => setModal(null)} />
      )}
    </>
  );

  // 非 Pro でも直接到達しうるので、ロック状態はここでも提示する（ペイウォールへ誘導）。
  if (!isPro) {
    return (
      <SettingsDetail title={t('sync.title')}>
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
      </SettingsDetail>
    );
  }

  return (
    <SettingsDetail title={t('sync.title')} overlay={overlay}>
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
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
            {syncErrorCode && syncStatus !== 'syncing' && (
              <Text style={[{ color: theme.colors.danger, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {syncErrorText(syncErrorCode)}
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
            <Pressable
              style={[styles.dataRow, { opacity: syncStatus === 'syncing' ? 0.6 : 1 }]}
              onPress={handleRestore}
              disabled={syncStatus === 'syncing'}
            >
              <View style={styles.dataRowText}>
                <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('sync.restoreTitle')}
                </Text>
                <Text style={[styles.dataRowSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('sync.restoreSubtitle')}
                </Text>
              </View>
              <Ionicons name="time-outline" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
            </Pressable>
          </>
        )}
      </View>
    </SettingsDetail>
  );
}

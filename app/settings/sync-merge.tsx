import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ConfirmModal } from '@/components/ConfirmModal';
import { DeckIcon } from '@/components/DeckIcon';
import { EmptyState } from '@/components/EmptyState';
import { InfoModal } from '@/components/InfoModal';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles as styles } from '@/components/settings/styles';

import { type BackupDeckInfo, listDecksInBackup, mergeDeckFromBackup } from '@/lib/sync/deckMerge';
import { syncErrorText } from '@/lib/sync/errorText';
import { listLocalBackups, syncNow, toSyncErrorCode } from '@/lib/sync/syncEngine';
import { sortDecks } from '@/lib/sortDecks';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import { useSyncStore } from '@/store/sync';

type ModalConfig =
  | { kind: 'info'; title?: string; message: string; backOnClose?: boolean }
  | { kind: 'confirm'; title?: string; message: string; onConfirm: () => void };

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ISO 文字列（UTC）をローカルの「YYYY-MM-DD HH:MM」に整形する。 */
function formatReviewDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return formatDateTime(d.getTime());
}

/**
 * 029: 自動バックアップ内のデッキ一覧を表示し、1デッキを現在のデータにマージ復元する画面。
 * ConfirmModal（アラート）だとデッキが多いと収まらず説明が切れるため、スクロール可能な専用画面にする。
 * 遷移元（sync.tsx）はバックアップ選択（最大3件）だけ担い、選んだ世代の timestamp を `ts` で渡す。
 */
export default function SyncMergeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useSQLiteContext();
  const router = useRouter();
  const { ts } = useLocalSearchParams<{ ts: string }>();
  const { enabled: syncEnabled, bumpDataRevision } = useSyncStore();

  const [loading, setLoading] = useState(true);
  const [decks, setDecks] = useState<BackupDeckInfo[]>([]);
  const deckSortOrder = useSettingsStore((s) => s.deckSortOrder);
  // ホームのデッキ並び順を反映（manual はバックアップ内の自然順を維持）
  const sortedDecks = useMemo(() => sortDecks(decks, deckSortOrder), [decks, deckSortOrder]);
  const [backupTimestamp, setBackupTimestamp] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [processing, setProcessing] = useState(false);
  const backupPathRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const backups = await listLocalBackups();
        const backup = backups.find((b) => String(b.timestamp) === ts);
        if (!backup) {
          setModal({ kind: 'info', title: t('sync.mergeTitle'), message: t('sync.mergeLoadError'), backOnClose: true });
          return;
        }
        backupPathRef.current = backup.path;
        setBackupTimestamp(backup.timestamp);
        const list = await listDecksInBackup(db, backup.path);
        setDecks(list);
      } catch {
        setModal({ kind: 'info', title: t('sync.mergeTitle'), message: t('sync.mergeLoadError'), backOnClose: true });
      } finally {
        setLoading(false);
      }
    })();
    // ts は遷移時に固定。db/t は安定参照のため依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function confirmMerge(deck: BackupDeckInfo) {
    setModal({
      kind: 'confirm',
      title: t('sync.mergeTitle'),
      message: t('sync.mergeConfirmMessage', { name: deck.name }),
      onConfirm: () => doMerge(deck),
    });
  }

  async function doMerge(deck: BackupDeckInfo) {
    const path = backupPathRef.current;
    if (!path) return;
    setModal(null);
    setProcessing(true);
    try {
      await mergeDeckFromBackup(db, path, deck.id);
      // フォーカス中の学習/統計/ホーム/カード一覧へ即反映。
      bumpDataRevision();
      // マージで localVersion が進むので、同期が有効なら相手端末へも反映する。
      if (syncEnabled) {
        try { await syncNow(db, 'auto'); } catch { /* 反映失敗は致命的でない。次回同期で再試行 */ }
      }
      setModal({ kind: 'info', title: t('sync.mergeTitle'), message: t('sync.mergeSuccess', { name: deck.name }), backOnClose: true });
    } catch (e) {
      setModal({ kind: 'info', title: t('sync.syncError'), message: syncErrorText(toSyncErrorCode(e), t) });
    } finally {
      setProcessing(false);
    }
  }

  function onModalClose() {
    const backOnClose = modal?.kind === 'info' && modal.backOnClose;
    setModal(null);
    if (backOnClose) router.back();
  }

  const overlay = (
    <>
      {processing && (
        <View
          style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
        >
          <View style={{ backgroundColor: theme.colors.surface, paddingVertical: 24, paddingHorizontal: 32, borderRadius: 16, alignItems: 'center' }}>
            <ActivityIndicator color={theme.colors.primary} size="large" />
            <Text style={{ marginTop: 12, color: theme.colors.text, fontSize: theme.fontSize.md }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('sync.mergeProcessing')}
            </Text>
          </View>
        </View>
      )}
      {modal?.kind === 'info' && (
        <InfoModal visible title={modal.title} message={modal.message} onClose={onModalClose} />
      )}
      {modal?.kind === 'confirm' && (
        <ConfirmModal
          visible
          title={modal.title}
          message={modal.message}
          actions={[{ label: t('sync.mergeConfirm'), onPress: modal.onConfirm }]}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );

  return (
    <SettingsDetail title={t('sync.mergeTitle')} overlay={overlay}>
      {loading ? (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : decks.length === 0 ? (
        <EmptyState icon="albums-outline" title={t('sync.mergeEmpty')} />
      ) : (
        <>
          {backupTimestamp != null && (
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginBottom: 4 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('sync.mergeBackupCaption', { datetime: formatDateTime(backupTimestamp) })}
            </Text>
          )}
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20, marginBottom: 8 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('sync.mergeSelectDeckMessage')}
          </Text>
          {sortedDecks.map((deck) => (
            <Pressable
              key={deck.id}
              style={[styles.card, { backgroundColor: theme.colors.surface }]}
              onPress={() => confirmMerge(deck)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {deck.iconName && <DeckIcon iconName={deck.iconName} colorHex={deck.colorHex} />}
                <Text style={{ flex: 1, fontWeight: '600', color: theme.colors.text, fontSize: theme.fontSize.md }} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {deck.name}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('sync.mergeDeckCount', { count: deck.cardCount })}
                </Text>
              </View>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: 4 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {deck.lastReviewDate
                  ? t('sync.mergeLastReview', { date: formatReviewDateTime(deck.lastReviewDate) })
                  : t('sync.mergeNeverStudied')}
              </Text>
              {deck.lastUpdatedAt && (
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: 2 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('sync.mergeLastUpdated', { date: formatReviewDateTime(deck.lastUpdatedAt) })}
                </Text>
              )}
            </Pressable>
          ))}
        </>
      )}
    </SettingsDetail>
  );
}

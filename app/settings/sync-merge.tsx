import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { ConfirmModal, type ModalAction } from '@/components/ConfirmModal';
import { DeckIcon } from '@/components/DeckIcon';
import { EmptyState } from '@/components/EmptyState';
import { InfoModal } from '@/components/InfoModal';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { SettingsFocusRow } from '@/components/settings/settingsFocus';
import { settingsStyles as styles } from '@/components/settings/styles';
import { useKeyCommands } from '@/lib/useKeyCommands';

import { type BackupDeckInfo, listDecksInBackup, mergeDeckFromBackup } from '@/lib/sync/deckMerge';
import { syncErrorText } from '@/lib/sync/errorText';
import { listLocalBackups, syncNow, toSyncErrorCode } from '@/lib/sync/syncEngine';
import { sortDecks } from '@/lib/sortDecks';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import { useSyncStore } from '@/store/sync';

type ModalConfig =
  | { kind: 'info'; title?: string; message: string; backOnClose?: boolean }
  | { kind: 'confirm'; title?: string; message: string; actions: ModalAction[] };

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
 * 「このデッキをマージすると何が戻るか」の内訳ラベル。
 * 最終学習・最終編集の日時は端末をまたいで比べられる絶対値だが、**戻す価値があるか**は
 * 読み取れない（並べ替えとタグは日時をまったく動かさないので、時刻上は差が無いのに
 * 中身は違う、が起こる）。そこで現データと突き合わせた件数を出す。
 * ⚠️ 並び順（diffOrder）は**マージでは戻らない**のでここには入れない（別行で出す）。
 */
function restorableDiffLabels(
  deck: BackupDeckInfo,
  t: (key: string, options?: Record<string, unknown>) => string
): string[] {
  const items: { count: number; key: string }[] = [
    { count: deck.diffNewerReviews, key: 'sync.mergeDiffReview' },
    { count: deck.diffNewLogs, key: 'sync.mergeDiffLog' },
    { count: deck.diffNewerContents, key: 'sync.mergeDiffContent' },
    { count: deck.diffNewCards, key: 'sync.mergeDiffCard' },
    { count: deck.diffNewTags, key: 'sync.mergeDiffTag' },
  ];
  const labels = items.filter((i) => i.count > 0).map((i) => t(i.key, { count: i.count }));
  // デッキ自身（名前・アイコン・土台・読み上げ）は件数ではなく有無だけを示す
  if (deck.diffDeckSettings > 0) labels.push(t('sync.mergeDiffDeckSettings'));
  return labels;
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
    // 並び順が違うデッキだけ2つ目の選択肢を出す。既定（塗り）は従来どおりの加算マージで、
    // 並び順の復元は**この端末の現在の並びを上書きする**のでゴーストの副次選択肢にする。
    const actions: ModalAction[] = [
      { label: t('sync.mergeConfirm'), onPress: () => doMerge(deck, false) },
    ];
    if (deck.diffOrder > 0) {
      actions.push({ label: t('sync.mergeConfirmOrder'), secondary: true, onPress: () => doMerge(deck, true) });
    }
    setModal({
      kind: 'confirm',
      title: t('sync.mergeTitle'),
      message:
        t('sync.mergeConfirmMessage', { name: deck.name }) +
        (deck.diffOrder > 0 ? `\n\n${t('sync.mergeConfirmOrderNote')}` : ''),
      actions,
    });
  }

  async function doMerge(deck: BackupDeckInfo, restoreOrder: boolean) {
    const path = backupPathRef.current;
    if (!path) return;
    setModal(null);
    setProcessing(true);
    try {
      await mergeDeckFromBackup(db, path, deck.id, { restoreOrder });
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

  // 「OK のみ」情報モーダル表示中は Return=OK で閉じる（backOnClose も onModalClose 経由で維持）。
  // 確認モーダルは Return 非割当。Esc/B は SettingsDetail の onBack が閉じる。
  useKeyCommands([
    { input: KeyCommand.keyInputEnter, handler: () => { if (modal?.kind === 'info') onModalClose(); } },
  ], modal?.kind === 'info');

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
          actions={modal.actions}
          onClose={() => setModal(null)}
          // 053 Phase 4：「戻す」/「並び順も戻す」を J/K で選び Return で実行（最初はフォーカスなし）
          keyboard
        />
      )}
    </>
  );

  const shortcutSections = [
    { title: t('shortcut.catFocus'), items: [
      { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
    ] },
    { title: t('shortcut.catAction'), items: [
      { key: 'Return', descKey: 'shortcut.settingActivateMerge' },
    ] },
    { title: t('shortcut.catConfirmDialog'), items: [
      { key: 'J / K', descKey: 'shortcut.confirmChoose' },
      { key: 'Return', descKey: 'shortcut.confirmRun' },
    ] },
    { title: t('shortcut.catOther'), items: [
      { key: 'ESC', descKey: 'shortcut.esc' },
      { key: 'B', descKey: 'shortcut.back' },
      { key: '?', descKey: 'shortcut.showShortcuts' },
    ] },
  ];

  return (
    <SettingsDetail
      title={t('sync.mergeTitle')}
      overlay={overlay}
      shortcuts={shortcutSections}
      // ダイアログの表示中・マージの処理中は背後の項目操作を止める
      blockNav={modal !== null || processing}
      onBack={() => { if (modal) { onModalClose(); return; } router.back(); }}
    >
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
          {sortedDecks.map((deck) => {
            const diffLabels = restorableDiffLabels(deck, t);
            const hasRestorable = diffLabels.length > 0;
            // 何も戻せないデッキは淡く（押してもデータは変わらない＝アーカイブ一覧と同じ流儀）。
            // 並び順だけが違うデッキは「並び順も戻す」で戻せるので淡くしない。
            const actionable = hasRestorable || deck.diffOrder > 0;
            return (
            // 053 Phase 4：Return＝確認ダイアログ（戻せるものが無い淡い行にも止める＝タップと同じ反応）
            <SettingsFocusRow key={deck.id} variant="card" onActivate={() => confirmMerge(deck)}>
            <Pressable
              style={[styles.card, { backgroundColor: theme.colors.surface, opacity: actionable ? 1 : 0.55 }]}
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
              {/* 現データとの差分。戻せるものだけを並べ、並び順は戻らないので別行にする。 */}
              {hasRestorable ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2, marginTop: 4 }}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                    {t('sync.mergeDiffLabel')}
                  </Text>
                  {diffLabels.map((label) => (
                    <Text key={label} style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                      {label}
                    </Text>
                  ))}
                </View>
              ) : deck.diffOrder === 0 ? (
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: 4 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('sync.mergeDiffNone')}
                </Text>
              ) : null}
              {deck.diffOrder > 0 && (
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: hasRestorable ? 2 : 4 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('sync.mergeDiffOrder', { count: deck.diffOrder })}
                </Text>
              )}
            </Pressable>
            </SettingsFocusRow>
            );
          })}
          {/* 並び順の差分があるデッキが1つでもあるときだけ、戻せない理由と代わりの手段を出す
              （CLAUDE.md「オンに見えるのに効いていない状態を作らない」＝結果を書く）。 */}
          {sortedDecks.some((d) => d.diffOrder > 0) && (
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20, marginTop: 8 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('sync.mergeDiffOrderNote')}
            </Text>
          )}
        </>
      )}
    </SettingsDetail>
  );
}

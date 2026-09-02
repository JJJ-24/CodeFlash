import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { constants as KeyCommand } from "react-native-key-command";

import { AppSwitch } from "@/components/AppSwitch";
import { ConfirmModal, type ModalAction } from "@/components/ConfirmModal";
import { InfoModal } from "@/components/InfoModal";
import { SettingsDetail } from "@/components/settings/SettingsDetail";
import { settingsStyles as styles } from "@/components/settings/styles";
import { useKeyCommands } from "@/lib/useKeyCommands";

import { type BackupDiffCounts, inspectBackupReplace } from "@/lib/sync/deckMerge";
import { syncErrorText } from "@/lib/sync/errorText";
import { getRemoteStatus } from "@/lib/sync/icloud";
import {
  type LocalBackup,
  listLocalBackups,
  resetRemote,
  restoreFromLocalBackup,
  syncNowManual,
  toSyncErrorCode,
} from "@/lib/sync/syncEngine";
import { MAX_FONT_MULTIPLIER, useTheme } from "@/lib/theme";
import { useProStore } from "@/store/pro";
import { useSyncStore } from "@/store/sync";

type ModalConfig =
  | { kind: "info"; title?: string; message: string }
  | {
      kind: "confirm";
      title?: string;
      message: string;
      actions: ModalAction[];
    };

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
    lastDataSyncedAt,
    lastRemoteUpdatedAt,
    errorCode: syncErrorCode,
    clearError: clearSyncError,
  } = useSyncStore();
  const [modal, setModal] = useState<ModalConfig | null>(null);

  // ⓘタップでインライン展開する説明トグル
  const [showTagline, setShowTagline] = useState(false);
  const [showTermsHelp, setShowTermsHelp] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showRestoreSectionInfo, setShowRestoreSectionInfo] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAdvancedInfo, setShowAdvancedInfo] = useState(false);
  const [showUploadInfo, setShowUploadInfo] = useState(false);
  const [showDownloadInfo, setShowDownloadInfo] = useState(false);
  const [showResetInfo, setShowResetInfo] = useState(false);
  const [showRestoreInfo, setShowRestoreInfo] = useState(false);
  const [showMergeInfo, setShowMergeInfo] = useState(false);

  function describeSyncError(e: unknown): string {
    return syncErrorText(toSyncErrorCode(e), t);
  }

  async function handleSyncToggle(value: boolean) {
    clearSyncError();
    if (value) {
      setSyncEnabled(true);
      try {
        await syncNowManual(db, "auto");
      } catch (e) {
        setModal({
          kind: "info",
          title: t("sync.syncError"),
          message: describeSyncError(e),
        });
      }
    } else {
      setSyncEnabled(false);
    }
  }

  async function handleManualSync() {
    if (syncStatus === "syncing") return;
    try {
      await syncNowManual(db, "auto");
    } catch (e) {
      setModal({
        kind: "info",
        title: t("sync.syncError"),
        message: describeSyncError(e),
      });
    }
  }

  async function handleForceUpload() {
    setModal({
      kind: "confirm",
      title: t("sync.forceUpload"),
      message: t("sync.forceUploadConfirm"),
      actions: [
        {
          label: t("sync.forceUpload"),
          destructive: true,
          onPress: async () => {
            setModal(null);
            try {
              await syncNowManual(db, "upload");
            } catch (e) {
              setModal({
                kind: "info",
                title: t("sync.syncError"),
                message: describeSyncError(e),
              });
            }
          },
        },
      ],
    });
  }

  async function handleForceDownload() {
    // iCloud 上の最新版の更新時刻をライブ取得して確認文に出す（DB本体はDLせずファイル名から取得＝軽い）。
    // 取得できない/リモートが無いときは従来の静的メッセージにフォールバック。ハング回避に短いタイムアウト。
    let message = t("sync.forceDownloadConfirm");
    try {
      const remote = await Promise.race([
        getRemoteStatus(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ]);
      if (remote && remote.exists && remote.meta) {
        message = t("sync.forceDownloadConfirmAt", {
          datetime: formatDateTimeSec(remote.meta.updatedAt),
        });
      }
    } catch {
      // 取得失敗はフォールバック（静的メッセージ）で続行
    }
    setModal({
      kind: "confirm",
      title: t("sync.forceDownload"),
      message,
      actions: [
        {
          label: t("sync.forceDownload"),
          destructive: true,
          onPress: async () => {
            setModal(null);
            try {
              await syncNowManual(db, "download");
            } catch (e) {
              setModal({
                kind: "info",
                title: t("sync.syncError"),
                message: describeSyncError(e),
              });
            }
          },
        },
      ],
    });
  }

  // リモートをリセット: iCloud のバックアップを完全に削除し、現在のローカルで作り直す。
  // 時計の誤設定などでリモートが壊れた版に固着した場合の最終手段。
  function handleResetRemote() {
    setModal({
      kind: "confirm",
      title: t("sync.resetRemote"),
      message: t("sync.resetRemoteConfirm"),
      actions: [
        {
          label: t("sync.resetRemote"),
          destructive: true,
          onPress: async () => {
            setModal(null);
            try {
              await resetRemote(db);
              setModal({
                kind: "info",
                title: t("sync.resetRemote"),
                message: t("sync.resetRemoteSuccess"),
              });
            } catch (e) {
              setModal({
                kind: "info",
                title: t("sync.syncError"),
                message: describeSyncError(e),
              });
            }
          },
        },
      ],
    });
  }

  function formatBackupTime(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
      setModal({
        kind: "info",
        title: t("sync.restoreShort"),
        message: t("sync.restoreNone"),
      });
      return;
    }
    setModal({
      kind: "confirm",
      title: t("sync.restoreShort"),
      message: t("sync.restoreSelectMessage"),
      actions: backups.map((b) => ({
        label: formatBackupTime(b.timestamp),
        onPress: () => confirmRestore(b),
      })),
    });
  }

  /** 差分件数を「カード 12 ・ 学習 3」の並びにする（0 の項目は出さない）。 */
  function diffCountLabels(c: BackupDiffCounts): string[] {
    const items: [number, string][] = [
      [c.decks, "sync.mergeDiffDecks"],
      [c.cards, "sync.mergeDiffCard"],
      [c.contents, "sync.mergeDiffContent"],
      [c.reviews, "sync.mergeDiffReview"],
      [c.logs, "sync.mergeDiffLog"],
      [c.tags, "sync.mergeDiffTag"],
    ];
    return items.filter(([n]) => n > 0).map(([n, key]) => t(key, { count: n }));
  }

  /**
   * 置き換えの確認文に差分を挟む。**破壊的な操作なので「失うもの」が主役**
   * （日時だけでは何が消えるか分からないまま実行することになる）。
   * 差分が出せなかった場合（古いバックアップ・読み取り失敗）は黙って日時だけに戻す
   * ＝復元そのものは実行できるべきなので、ここで操作を止めない。
   */
  async function buildRestoreDiffText(backup: LocalBackup): Promise<string> {
    try {
      const diff = await inspectBackupReplace(db, backup.path);
      const restore = diffCountLabels(diff.restore);
      const lose = diffCountLabels(diff.lose);
      if (restore.length === 0 && lose.length === 0) {
        return `\n\n${t("sync.restoreDiffNone")}`;
      }
      const sep = t("sync.diffSeparator");
      const lines: string[] = [];
      if (restore.length > 0) lines.push(t("sync.restoreDiffRestore", { items: restore.join(sep) }));
      if (lose.length > 0) lines.push(t("sync.restoreDiffLose", { items: lose.join(sep) }));
      return `\n\n${lines.join("\n")}\n${t("sync.restoreDiffNote")}`;
    } catch {
      return "";
    }
  }

  async function confirmRestore(backup: LocalBackup) {
    const diffText = await buildRestoreDiffText(backup);
    setModal({
      kind: "confirm",
      title: t("sync.restoreShort"),
      message:
        t("sync.restoreConfirmMessage", {
          datetime: formatBackupTime(backup.timestamp),
        }) +
        diffText +
        `\n\n${t("sync.restoreConfirmTail")}`,
      actions: [
        {
          label: t("sync.restoreConfirm"),
          destructive: true,
          onPress: async () => {
            setModal(null);
            try {
              await restoreFromLocalBackup(db, backup.path);
              if (syncEnabled) {
                try {
                  await syncNowManual(db, "auto");
                } catch {
                  /* 反映失敗は致命的でない。次回同期で再試行 */
                }
              }
              setModal({
                kind: "info",
                title: t("sync.restoreShort"),
                message: t("sync.restoreSuccess"),
              });
            } catch (e) {
              setModal({
                kind: "info",
                title: t("sync.syncError"),
                message: describeSyncError(e),
              });
            }
          },
        },
      ],
    });
  }

  // === デッキ単位マージ復元（029）===
  // バックアップ選択（最大3件なのでアラートで収まる）→ 選んだ世代の timestamp を
  // デッキ選択専用画面へ渡す（デッキが多いとアラートでは収まらないため別画面でスクロール表示）。
  async function handleMergeStart() {
    let backups: LocalBackup[];
    try {
      backups = await listLocalBackups();
    } catch {
      backups = [];
    }
    if (backups.length === 0) {
      setModal({
        kind: "info",
        title: t("sync.mergeTitle"),
        message: t("sync.restoreNone"),
      });
      return;
    }
    setModal({
      kind: "confirm",
      title: t("sync.mergeTitle"),
      message: t("sync.mergeSelectBackupMessage"),
      actions: backups.map((b) => ({
        label: formatBackupTime(b.timestamp),
        onPress: () => {
          setModal(null);
          router.push({
            pathname: "/settings/sync-merge",
            params: { ts: String(b.timestamp) },
          });
        },
      })),
    });
  }

  function formatDateTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // iCloud 上のデータ時刻は秒まで表示する（いつの版か厳密に分かるように）。
  function formatDateTimeSec(ts: number): string {
    const d = new Date(ts);
    return `${formatDateTime(ts)}:${String(d.getSeconds()).padStart(2, "0")}`;
  }

  // iCloud 上のデータ（追いついているリモート版）の更新時刻。キャッシュ値（最後に観測した版）。
  function formatRemoteDataAt(): string | null {
    if (!lastRemoteUpdatedAt) return null;
    return t("sync.remoteDataAt", { datetime: formatDateTimeSec(lastRemoteUpdatedAt) });
  }

  // 「同期」＝実際にデータを転送した時刻（no-op 照合では動かない）。
  function formatLastSynced(): string {
    if (!lastDataSyncedAt) return t("sync.lastSyncedNever");
    return t("sync.lastSyncedAt", {
      datetime: formatDateTime(lastDataSyncedAt),
    });
  }

  // 「接続」＝最後に iCloud と照合できた時刻。同期より新しいときだけ補足表示する
  // （データ転送はなかったが、同期が生きていて最新であることを確認できた、の意）。
  function formatLastConnected(): string | null {
    if (!lastSyncedAt) return null;
    if (lastDataSyncedAt && lastSyncedAt <= lastDataSyncedAt) return null;
    return t("sync.lastConnectedAt", {
      datetime: formatDateTime(lastSyncedAt),
    });
  }

  function getSyncStatusText(): string {
    if (syncStatus !== "syncing") return "";
    if (syncDirection === "upload") return t("sync.syncingUpload");
    if (syncDirection === "download") return t("sync.syncingDownload");
    return t("sync.syncing");
  }

  const overlay = (
    <>
      {modal?.kind === "info" && (
        <InfoModal
          visible
          title={modal.title}
          message={modal.message}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "confirm" && (
        <ConfirmModal
          visible
          title={modal.title}
          message={modal.message}
          actions={modal.actions}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );

  // 「OK のみ」情報モーダル表示中は Return=OK で閉じる（確認モーダルは複数アクションのため Return 非割当）。
  // Esc/B は SettingsDetail の onBack が閉じる。早期 return より前で呼ぶ（フック規約）。
  useKeyCommands(
    [
      {
        input: KeyCommand.keyInputEnter,
        handler: () => {
          if (modal?.kind === "info") setModal(null);
        },
      },
    ],
    modal?.kind === "info",
  );

  // 非 Pro でも直接到達しうるので、ロック状態はここでも提示する（ペイウォールへ誘導）。
  if (!isPro) {
    return (
      <SettingsDetail title={t("sync.title")}>
        <Pressable
          style={[styles.card, { backgroundColor: theme.colors.surface }]}
          onPress={() => router.push("/paywall")}
        >
          <View style={styles.proRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.proTitleRow}>
                <Text
                  style={[
                    styles.proTitle,
                    { color: theme.colors.text, fontSize: theme.fontSize.md },
                  ]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("sync.title")}
                </Text>
                <Ionicons
                  name="lock-closed"
                  size={theme.fontSize.sm}
                  color={theme.colors.primary}
                />
              </View>
              <Text
                style={[
                  styles.proSubtitle,
                  {
                    color: theme.colors.textSecondary,
                    fontSize: theme.fontSize.sm,
                  },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t("sync.lockedSubtitle")}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={theme.fontSize.lg}
              color={theme.colors.iconSubtle}
            />
          </View>
        </Pressable>
      </SettingsDetail>
    );
  }

  const syncing = syncStatus === "syncing";

  // 時刻の見出し（＋用語説明のⓘ）を出すかどうか。一度も同期していない端末では
  // 3行のうち出るのは「まだ同期されていません」だけ＝見出しが指す時刻が1つも無い。
  const hasSyncTimes =
    lastDataSyncedAt != null ||
    lastSyncedAt != null ||
    lastRemoteUpdatedAt != null;

  return (
    <SettingsDetail
      title={t("sync.title")}
      overlay={overlay}
      onBack={(direct) => {
        if (modal) {
          setModal(null);
          return;
        }
        if (
          !direct && (
          showTagline ||
          showTermsHelp ||
          showRestoreSectionInfo ||
          showAdvancedInfo ||
          showUploadInfo ||
          showDownloadInfo ||
          showResetInfo ||
          showRestoreInfo ||
          showMergeInfo
          )
        ) {
          setShowTagline(false);
          setShowTermsHelp(false);
          setShowRestoreSectionInfo(false);
          setShowAdvancedInfo(false);
          setShowUploadInfo(false);
          setShowDownloadInfo(false);
          setShowResetInfo(false);
          setShowRestoreInfo(false);
          setShowMergeInfo(false);
          return;
        }
        router.back();
      }}
    >
      {/* セクション1: iCloud 同期カード */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.notificationRow}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              flexShrink: 1,
            }}
          >
            <Text
              style={[
                {
                  color: theme.colors.text,
                  fontSize: theme.fontSize.md,
                  flexShrink: 1,
                },
              ]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t("sync.enabledShort")}
            </Text>
            <Pressable onPress={() => setShowTagline((v) => !v)} hitSlop={8}>
              <Ionicons
                name={
                  showTagline
                    ? "information-circle"
                    : "information-circle-outline"
                }
                size={Math.max(theme.fontSize.lg, 20)}
                color={theme.colors.textTertiary}
              />
            </Pressable>
          </View>
          <AppSwitch
            value={syncEnabled}
            onValueChange={handleSyncToggle}
            disabled={syncing}
          />
        </View>
        {/* ⓘ タップ時のみ詳細説明を展開（タグラインは廃止し、タイトル＋ⓘ に集約）。
            同期 ON/OFF で内容が同じなので分岐せず Switch 行の直下に置く。
            時刻ラベルの用語説明は「最新の時刻」見出しのⓘが持つ（自分の直下を説明する）。 */}
        {showTagline && (
          <View
            style={[
              styles.syncInfoBox,
              { backgroundColor: theme.colors.background },
            ]}
          >
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: theme.fontSize.sm,
                lineHeight: 20,
              }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t("sync.descriptionDetail")}
            </Text>
          </View>
        )}

        {syncEnabled && (
          <>
            {/* 時刻3行の見出し。畳めないのでシェブロンは付けず、行全体も押さない（ⓘ だけ押せる）。 */}
            {hasSyncTimes && (
              <View style={styles.syncTimesHeader}>
                <Text
                  style={[
                    styles.syncAdvancedHeaderText,
                    {
                      color: theme.colors.textSecondary,
                      fontSize: theme.fontSize.sm,
                    },
                  ]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("sync.timesSectionTitle")}
                </Text>
                <Pressable
                  onPress={() => setShowTermsHelp((v) => !v)}
                  hitSlop={8}
                >
                  <Ionicons
                    name={
                      showTermsHelp
                        ? "information-circle"
                        : "information-circle-outline"
                    }
                    size={Math.max(theme.fontSize.lg, 20)}
                    color={theme.colors.textTertiary}
                  />
                </Pressable>
              </View>
            )}
            {hasSyncTimes && showTermsHelp && (
              <View
                style={[
                  styles.syncInfoBox,
                  { backgroundColor: theme.colors.background },
                ]}
              >
                <Text
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: theme.fontSize.sm,
                    lineHeight: 20,
                  }}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("sync.termsHelp")}
                </Text>
              </View>
            )}

            {/* 同期（実際にデータが転送された時刻） */}
            <Text
              style={[
                {
                  color: theme.colors.textSecondary,
                  fontSize: theme.fontSize.sm,
                },
              ]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {formatLastSynced()}
            </Text>

            {/* 接続（最後に iCloud と照合できた時刻。同期より新しいときだけ補足表示） */}
            {formatLastConnected() && (
              <Text
                style={[
                  {
                    color: theme.colors.textTertiary,
                    fontSize: theme.fontSize.xs,
                    marginTop: -2,
                  },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {formatLastConnected()}
              </Text>
            )}

            {/* iCloud 上のデータの更新時刻（キャッシュ＝最後に観測したリモート版・秒まで） */}
            {formatRemoteDataAt() && (
              <Text
                style={[
                  {
                    color: theme.colors.textTertiary,
                    fontSize: theme.fontSize.xs,
                    marginTop: -2,
                  },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {formatRemoteDataAt()}
              </Text>
            )}

            {/* エラー表示 */}
            {syncErrorCode && !syncing && (
              <Text
                style={[
                  { color: theme.colors.danger, fontSize: theme.fontSize.sm },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {syncErrorText(syncErrorCode, t)}
              </Text>
            )}

            {/* 主ボタン: 今すぐ同期 */}
            <Pressable
              style={[
                styles.syncPrimaryButton,
                {
                  backgroundColor: theme.colors.primary,
                  opacity: syncing ? 0.6 : 1,
                },
              ]}
              onPress={handleManualSync}
              disabled={syncing}
            >
              {syncing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="sync" size={theme.fontSize.md} color="#fff" />
              )}
              <Text
                style={[
                  styles.syncPrimaryButtonText,
                  { fontSize: theme.fontSize.md },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {syncing ? getSyncStatusText() : t("sync.syncNow")}
              </Text>
            </Pressable>

            {/* データ復元の折りたたみヘッダー（復旧順: 今すぐ同期 → データ復元 → 詳細操作） */}
            <Pressable
              style={styles.syncAdvancedHeader}
              onPress={() => setShowRestore((v) => !v)}
              hitSlop={4}
            >
              <Ionicons
                name={showRestore ? "chevron-down" : "chevron-forward"}
                size={theme.fontSize.md}
                color={theme.colors.textSecondary}
              />
              <Text
                style={[
                  styles.syncAdvancedHeaderText,
                  {
                    color: theme.colors.textSecondary,
                    fontSize: theme.fontSize.sm,
                  },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t("sync.restoreSectionTitle")}
              </Text>
              <Pressable
                onPress={() => setShowRestoreSectionInfo((v) => !v)}
                hitSlop={8}
              >
                <Ionicons
                  name={
                    showRestoreSectionInfo
                      ? "information-circle"
                      : "information-circle-outline"
                  }
                  size={Math.max(theme.fontSize.lg, 20)}
                  color={theme.colors.textTertiary}
                />
              </Pressable>
            </Pressable>
            {showRestoreSectionInfo && (
              <View
                style={[
                  styles.syncInfoBox,
                  { backgroundColor: theme.colors.background },
                ]}
              >
                <Text
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: theme.fontSize.sm,
                    lineHeight: 20,
                  }}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("sync.restoreSectionInfo")}
                </Text>
              </View>
            )}

            {showRestore && (
              <>
                {/* すべて置き換え */}
                <Pressable
                  style={[
                    styles.syncAdvancedItem,
                    { opacity: syncing ? 0.4 : 1 },
                  ]}
                  onPress={handleRestore}
                  disabled={syncing}
                >
                  <Text
                    style={[
                      styles.syncAdvancedItemText,
                      { color: theme.colors.text, fontSize: theme.fontSize.md },
                    ]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {t("sync.restoreShort")}
                  </Text>
                  <Pressable
                    onPress={() => setShowRestoreInfo((v) => !v)}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={
                        showRestoreInfo
                          ? "information-circle"
                          : "information-circle-outline"
                      }
                      size={Math.max(theme.fontSize.lg, 20)}
                      color={theme.colors.textTertiary}
                    />
                  </Pressable>
                </Pressable>
                {showRestoreInfo && (
                  <View
                    style={[
                      styles.syncInfoBox,
                      { backgroundColor: theme.colors.background },
                    ]}
                  >
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: theme.fontSize.sm,
                        lineHeight: 20,
                      }}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                    >
                      {t("sync.restoreInfo")}
                    </Text>
                  </View>
                )}

                {/* デッキ別追加・上書き */}
                <Pressable
                  style={[
                    styles.syncAdvancedItem,
                    { opacity: syncing ? 0.4 : 1 },
                  ]}
                  onPress={handleMergeStart}
                  disabled={syncing}
                >
                  <Text
                    style={[
                      styles.syncAdvancedItemText,
                      { color: theme.colors.text, fontSize: theme.fontSize.md },
                    ]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {t("sync.mergeShort")}
                  </Text>
                  <Pressable
                    onPress={() => setShowMergeInfo((v) => !v)}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={
                        showMergeInfo
                          ? "information-circle"
                          : "information-circle-outline"
                      }
                      size={Math.max(theme.fontSize.lg, 20)}
                      color={theme.colors.textTertiary}
                    />
                  </Pressable>
                </Pressable>
                {showMergeInfo && (
                  <View
                    style={[
                      styles.syncInfoBox,
                      { backgroundColor: theme.colors.background },
                    ]}
                  >
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: theme.fontSize.sm,
                        lineHeight: 20,
                      }}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                    >
                      {t("sync.mergeInfo")}
                    </Text>
                  </View>
                )}
              </>
            )}

            {/* 詳細操作の折りたたみヘッダー（最終手段） */}
            <Pressable
              style={styles.syncAdvancedHeader}
              onPress={() => setShowAdvanced((v) => !v)}
              hitSlop={4}
            >
              <Ionicons
                name={showAdvanced ? "chevron-down" : "chevron-forward"}
                size={theme.fontSize.md}
                color={theme.colors.textSecondary}
              />
              <Text
                style={[
                  styles.syncAdvancedHeaderText,
                  {
                    color: theme.colors.textSecondary,
                    fontSize: theme.fontSize.sm,
                  },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t("sync.advancedSection")}
              </Text>
              <Pressable
                onPress={() => setShowAdvancedInfo((v) => !v)}
                hitSlop={8}
              >
                <Ionicons
                  name={
                    showAdvancedInfo
                      ? "information-circle"
                      : "information-circle-outline"
                  }
                  size={Math.max(theme.fontSize.lg, 20)}
                  color={theme.colors.textTertiary}
                />
              </Pressable>
            </Pressable>
            {showAdvancedInfo && (
              <View
                style={[
                  styles.syncInfoBox,
                  { backgroundColor: theme.colors.background },
                ]}
              >
                <Text
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: theme.fontSize.sm,
                    lineHeight: 20,
                  }}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t("sync.advancedSectionInfo")}
                </Text>
              </View>
            )}

            {showAdvanced && (
              <>
                {/* 強制アップロード */}
                <Pressable
                  style={[
                    styles.syncAdvancedItem,
                    { opacity: syncing ? 0.4 : 1 },
                  ]}
                  onPress={handleForceUpload}
                  disabled={syncing}
                >
                  <Text
                    style={[
                      styles.syncAdvancedItemText,
                      { color: theme.colors.text, fontSize: theme.fontSize.md },
                    ]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {t("sync.forceUpload")}
                  </Text>
                  <Pressable
                    onPress={() => setShowUploadInfo((v) => !v)}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={
                        showUploadInfo
                          ? "information-circle"
                          : "information-circle-outline"
                      }
                      size={Math.max(theme.fontSize.lg, 20)}
                      color={theme.colors.textTertiary}
                    />
                  </Pressable>
                </Pressable>
                {showUploadInfo && (
                  <View
                    style={[
                      styles.syncInfoBox,
                      { backgroundColor: theme.colors.background },
                    ]}
                  >
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: theme.fontSize.sm,
                        lineHeight: 20,
                      }}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                    >
                      {t("sync.forceUploadInfo")}
                    </Text>
                  </View>
                )}

                {/* 強制ダウンロード */}
                <Pressable
                  style={[
                    styles.syncAdvancedItem,
                    { opacity: syncing ? 0.4 : 1 },
                  ]}
                  onPress={handleForceDownload}
                  disabled={syncing}
                >
                  <Text
                    style={[
                      styles.syncAdvancedItemText,
                      { color: theme.colors.text, fontSize: theme.fontSize.md },
                    ]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {t("sync.forceDownload")}
                  </Text>
                  <Pressable
                    onPress={() => setShowDownloadInfo((v) => !v)}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={
                        showDownloadInfo
                          ? "information-circle"
                          : "information-circle-outline"
                      }
                      size={Math.max(theme.fontSize.lg, 20)}
                      color={theme.colors.textTertiary}
                    />
                  </Pressable>
                </Pressable>
                {showDownloadInfo && (
                  <View
                    style={[
                      styles.syncInfoBox,
                      { backgroundColor: theme.colors.background },
                    ]}
                  >
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: theme.fontSize.sm,
                        lineHeight: 20,
                      }}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                    >
                      {t("sync.forceDownloadInfo")}
                    </Text>
                  </View>
                )}

                {/* リモートをリセット（最終手段） */}
                <Pressable
                  style={[
                    styles.syncAdvancedItem,
                    { opacity: syncing ? 0.4 : 1 },
                  ]}
                  onPress={handleResetRemote}
                  disabled={syncing}
                >
                  <Text
                    style={[
                      styles.syncAdvancedItemText,
                      {
                        color: theme.colors.danger,
                        fontSize: theme.fontSize.md,
                      },
                    ]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {t("sync.resetRemote")}
                  </Text>
                  <Pressable
                    onPress={() => setShowResetInfo((v) => !v)}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={
                        showResetInfo
                          ? "information-circle"
                          : "information-circle-outline"
                      }
                      size={Math.max(theme.fontSize.lg, 20)}
                      color={theme.colors.textTertiary}
                    />
                  </Pressable>
                </Pressable>
                {showResetInfo && (
                  <View
                    style={[
                      styles.syncInfoBox,
                      { backgroundColor: theme.colors.background },
                    ]}
                  >
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: theme.fontSize.sm,
                        lineHeight: 20,
                      }}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                    >
                      {t("sync.resetRemoteInfo")}
                    </Text>
                  </View>
                )}
              </>
            )}
          </>
        )}
      </View>
    </SettingsDetail>
  );
}

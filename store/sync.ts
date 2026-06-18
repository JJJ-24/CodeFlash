import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const SYNC_ENABLED_KEY = '@codeflash_icloud_sync_enabled';
const LAST_SYNCED_AT_KEY = '@codeflash_icloud_last_synced_at';
const LAST_DATA_SYNCED_AT_KEY = '@codeflash_icloud_last_data_synced_at';
const LAST_SYNCED_VERSION_KEY = '@codeflash_icloud_last_synced_version';
const LAST_DOWNLOADED_VERSION_KEY = '@codeflash_icloud_last_downloaded_version';
const LAST_REMOTE_UPDATED_AT_KEY = '@codeflash_icloud_last_remote_updated_at';
const LAST_REMOTE_ID_KEY = '@codeflash_icloud_last_remote_id';
const DEVICE_ID_KEY = '@codeflash_device_id';

export type SyncStatus = 'idle' | 'syncing' | 'error';
export type SyncDirection = 'upload' | 'download' | 'check';

/**
 * 同期エラーの種別コード。人間向け文言は UI 側で i18n 翻訳する
 * （ストアに翻訳済み文字列を入れると端末言語切替・言語不一致でズレるため）。
 * - unavailable: iCloud 未ログイン／iCloud Drive 無効
 * - offline: 端末がインターネット未接続（オフライン）
 * - schemaMismatch: リモートが新しいスキーマ（アプリ更新が必要）
 * - noRemoteBackup: 強制ダウンロード時にリモートが存在しない
 * - timeout: 転送がタイムアウト（無応答）
 * - storageFull: iCloud 容量不足
 * - unknown: 上記以外（想定外エラー）
 */
export type SyncErrorCode =
  | 'unavailable'
  | 'offline'
  | 'schemaMismatch'
  | 'noRemoteBackup'
  | 'timeout'
  | 'storageFull'
  | 'unknown';

/**
 * 全画面の一時通知バナー（noticeKind/noticeCode）に出す内容のコード。
 * エラー系（SyncErrorCode）に加えて、エラーではない案内系を持つ：
 * - offlinePending: オフラインで起動し、未同期のローカル変更がある（接続すれば同期される旨の案内）
 */
export type SyncNoticeCode = SyncErrorCode | 'offlinePending';

interface SyncState {
  hydrated: boolean;
  enabled: boolean;
  status: SyncStatus;
  direction: SyncDirection | null;
  /** true のとき同期中はアプリ全体をオーバーレイでブロックする（ユーザー操作の同期のみ true。自動トリガーは false） */
  blocking: boolean;
  /**
   * 最後に同期処理（リモートとの照合）を行った実時刻。表示「最終接続」用＋フォアグラウンド
   * スロットルに使う。変更が無い no-op の照合でも更新される（＝「最後に iCloud を確認できた時刻」）。
   */
  lastSyncedAt: number | null;
  /**
   * 最後に実際にデータを転送（アップロード/ダウンロード）した実時刻。表示「最終同期」用。
   * no-op（変更なし照合）では更新しない＝「最後にデータが実際に同期された時刻」を表す。
   */
  lastDataSyncedAt: number | null;
  /** 最後に同期したときのローカル変更カウンタ（sync_state.localVersion）。ローカル変更検知の基準。 */
  lastSyncedVersion: number | null;
  /**
   * 最後に「リモートを受け入れた（ダウンロード）」ときのローカル版。アップロードでは進めない。
   * これ以降にこの端末で編集・学習して localVersion が進んだ状態で再びダウンロードが走ると、
   * 自端末の作業が別端末の版で上書きされる＝競合の合図になる（競合モーダルの判定に使う）。
   * アップロードでも進む lastSyncedVersion では「アップロード後に上書きされた」ケースを取りこぼすため別に持つ。
   */
  lastDownloadedVersion: number | null;
  /**
   * 現在「追いついている」リモート版の meta.updatedAt。リモート変更検知（remoteChanged）の基準。
   * 実時刻ではなくリモート版の時刻を使うことで、まだ伝播していない相手の更新
   * （updatedAt が実時刻 now より前）を取りこぼさない & 端末間の時計ズレにも強い。
   */
  lastRemoteUpdatedAt: number | null;
  /**
   * この端末が最後に「追いついた」リモート版の識別子（`${deviceId}:${updatedAt}`）。
   * リモート変更検知（remoteChanged）はこの識別子の一致/不一致で行う。
   * lastRemoteUpdatedAt の大小比較だと、相手端末の時計が進んでいる場合に、後から
   * 伝播してきた相手の更新を「自分の最終同期より古い」と誤判定して永久に取り込まない
   * 不具合があった（A は自分の追加、B は自分の追加のまま固着）。識別子比較は時計ズレに左右されない。
   */
  lastRemoteId: string | null;
  errorCode: SyncErrorCode | null;
  deviceId: string;

  /**
   * 全画面に出す一時通知バナーの内容。自動同期の経路だけがセットする
   * （手動同期の結果は設定画面のアラート＋赤字インラインに任せ、バナーは出さない）。
   * - 'error': 赤バナー（オンラインでの自動同期失敗など）
   * - 'info': 控えめな案内バナー（オフライン起動で未同期変更ありなど）
   */
  noticeKind: 'error' | 'info' | null;
  noticeCode: SyncNoticeCode | null;
  /** 同じ内容の通知でもバナーを再点灯させるための連番（バナーはこの変化を見て表示する）。 */
  noticeId: number;
  /**
   * 競合でこの端末のデータが別端末の版に置き換わったことを知らせるモーダルの表示トリガー（連番）。
   * バナーと違い重要かつ稀なイベントなので、ユーザーが読み終えて自分で閉じるモーダルで提示する
   * （全画面の単一モーダルを app/_layout が購読して表示）。
   */
  conflictModalId: number;

  /**
   * ダウンロード同期などでローカルデータが丸ごと入れ替わるたびに増える信号。
   * 集計値をローカル state に保持する画面（学習タブなど）が、フォーカス中でも
   * これを購読して再読込し、ダウンロード完了直後に内容を反映できるようにする。
   */
  dataRevision: number;

  setEnabled: (enabled: boolean) => void;
  setStatus: (status: SyncStatus, direction?: SyncDirection | null) => void;
  setBlocking: (blocking: boolean) => void;
  setError: (code: SyncErrorCode) => void;
  clearError: () => void;
  setLastSyncedAt: (timestamp: number) => void;
  setLastDataSyncedAt: (timestamp: number) => void;
  setLastSyncedVersion: (version: number) => void;
  setLastDownloadedVersion: (version: number) => void;
  setLastRemoteUpdatedAt: (timestamp: number) => void;
  setLastRemoteId: (id: string) => void;
  showNotice: (kind: 'error' | 'info', code: SyncNoticeCode) => void;
  showConflictModal: () => void;
  bumpDataRevision: () => void;
  /**
   * 同期の進捗ウォーターマーク（最終同期・追いついているリモート版など）をすべて消去し、
   * この端末を「一度も同期していない」状態に戻す。リモートをリセットした直後に呼ぶと、
   * 次回同期で（リモートが空のため）ローカルが再 publish される。enabled / deviceId は保持する。
   */
  resetSyncState: () => void;
}

function generateDeviceId(): string {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useSyncStore = create<SyncState>((set) => ({
  hydrated: false,
  enabled: false,
  status: 'idle',
  direction: null,
  blocking: false,
  lastSyncedAt: null,
  lastDataSyncedAt: null,
  lastSyncedVersion: null,
  lastDownloadedVersion: null,
  lastRemoteUpdatedAt: null,
  lastRemoteId: null,
  errorCode: null,
  deviceId: '',
  noticeKind: null,
  noticeCode: null,
  noticeId: 0,
  conflictModalId: 0,
  dataRevision: 0,

  setEnabled: (enabled) => {
    set({ enabled });
    AsyncStorage.setItem(SYNC_ENABLED_KEY, String(enabled));
  },
  setStatus: (status, direction = null) => {
    // syncing 以外に遷移したら blocking は必ず解除する
    set(status === 'syncing' ? { status, direction } : { status, direction, blocking: false });
  },
  setBlocking: (blocking) => {
    set({ blocking });
  },
  setError: (code) => {
    set({ status: 'error', direction: null, blocking: false, errorCode: code });
  },
  clearError: () => {
    set({ errorCode: null });
  },
  setLastSyncedAt: (timestamp) => {
    set({ lastSyncedAt: timestamp });
    AsyncStorage.setItem(LAST_SYNCED_AT_KEY, String(timestamp));
  },
  setLastDataSyncedAt: (timestamp) => {
    set({ lastDataSyncedAt: timestamp });
    AsyncStorage.setItem(LAST_DATA_SYNCED_AT_KEY, String(timestamp));
  },
  setLastSyncedVersion: (version) => {
    set({ lastSyncedVersion: version });
    AsyncStorage.setItem(LAST_SYNCED_VERSION_KEY, String(version));
  },
  setLastDownloadedVersion: (version) => {
    set({ lastDownloadedVersion: version });
    AsyncStorage.setItem(LAST_DOWNLOADED_VERSION_KEY, String(version));
  },
  setLastRemoteUpdatedAt: (timestamp) => {
    set({ lastRemoteUpdatedAt: timestamp });
    AsyncStorage.setItem(LAST_REMOTE_UPDATED_AT_KEY, String(timestamp));
  },
  setLastRemoteId: (id) => {
    set({ lastRemoteId: id });
    AsyncStorage.setItem(LAST_REMOTE_ID_KEY, id);
  },
  showNotice: (kind, code) => {
    set((s) => ({ noticeKind: kind, noticeCode: code, noticeId: s.noticeId + 1 }));
  },
  showConflictModal: () => {
    set((s) => ({ conflictModalId: s.conflictModalId + 1 }));
  },
  bumpDataRevision: () => {
    set((s) => ({ dataRevision: s.dataRevision + 1 }));
  },
  resetSyncState: () => {
    set({
      lastSyncedAt: null,
      lastDataSyncedAt: null,
      lastSyncedVersion: null,
      lastDownloadedVersion: null,
      lastRemoteUpdatedAt: null,
      lastRemoteId: null,
      errorCode: null,
    });
    AsyncStorage.multiRemove([
      LAST_SYNCED_AT_KEY,
      LAST_DATA_SYNCED_AT_KEY,
      LAST_SYNCED_VERSION_KEY,
      LAST_DOWNLOADED_VERSION_KEY,
      LAST_REMOTE_UPDATED_AT_KEY,
      LAST_REMOTE_ID_KEY,
    ]);
  },
}));

(async () => {
  const [enabledRaw, lastSyncedRaw, lastDataSyncedRaw, lastSyncedVersionRaw, lastDownloadedVersionRaw, lastRemoteUpdatedRaw, lastRemoteIdRaw, deviceIdRaw] = await Promise.all([
    AsyncStorage.getItem(SYNC_ENABLED_KEY),
    AsyncStorage.getItem(LAST_SYNCED_AT_KEY),
    AsyncStorage.getItem(LAST_DATA_SYNCED_AT_KEY),
    AsyncStorage.getItem(LAST_SYNCED_VERSION_KEY),
    AsyncStorage.getItem(LAST_DOWNLOADED_VERSION_KEY),
    AsyncStorage.getItem(LAST_REMOTE_UPDATED_AT_KEY),
    AsyncStorage.getItem(LAST_REMOTE_ID_KEY),
    AsyncStorage.getItem(DEVICE_ID_KEY),
  ]);

  let deviceId = deviceIdRaw ?? '';
  if (!deviceId) {
    deviceId = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  const lastSyncedAtRaw2 = lastSyncedRaw ? Number(lastSyncedRaw) : null;
  const lastSyncedAt = Number.isFinite(lastSyncedAtRaw2) ? lastSyncedAtRaw2 : null;
  let lastDataSyncedAt = lastDataSyncedRaw ? Number(lastDataSyncedRaw) : null;
  if (!(lastDataSyncedAt != null && Number.isFinite(lastDataSyncedAt))) lastDataSyncedAt = null;
  // 旧バージョンからの移行：lastDataSyncedAt は今回追加したフィールドで、過去に同期済みの端末でも
  // 未保存(null)になっている。そのままだと「まだ同期されていません」と誤表示されるため、
  // 過去に同期実績(lastSyncedAt あり)があれば、その時刻で一度だけ初期化して永続化する。
  if (lastDataSyncedAt == null && lastSyncedAt != null) {
    lastDataSyncedAt = lastSyncedAt;
    AsyncStorage.setItem(LAST_DATA_SYNCED_AT_KEY, String(lastDataSyncedAt));
  }
  const lastSyncedVersionRaw2 = lastSyncedVersionRaw != null ? Number(lastSyncedVersionRaw) : null;
  const lastSyncedVersion = lastSyncedVersionRaw2 != null && Number.isFinite(lastSyncedVersionRaw2) ? lastSyncedVersionRaw2 : null;
  const lastRemoteUpdatedAt = lastRemoteUpdatedRaw != null ? Number(lastRemoteUpdatedRaw) : null;

  let lastDownloadedVersion = lastDownloadedVersionRaw != null ? Number(lastDownloadedVersionRaw) : null;
  if (!(lastDownloadedVersion != null && Number.isFinite(lastDownloadedVersion))) lastDownloadedVersion = null;
  // 旧バージョンからの移行：lastDownloadedVersion は今回追加したフィールド。過去に同期済みの端末では
  // 未保存(null)のため、最後の同期版(lastSyncedVersion)を「直近に揃った基準」として一度だけ初期化する。
  // これにより、更新後の最初の競合ダウンロードからバナーが出る（ウォームアップ同期を待たずに済む）。
  if (lastDownloadedVersion == null && lastSyncedVersion != null) {
    lastDownloadedVersion = lastSyncedVersion;
    AsyncStorage.setItem(LAST_DOWNLOADED_VERSION_KEY, String(lastDownloadedVersion));
  }

  useSyncStore.setState({
    enabled: enabledRaw === 'true',
    lastSyncedAt,
    lastDataSyncedAt,
    lastSyncedVersion,
    lastDownloadedVersion,
    lastRemoteUpdatedAt: lastRemoteUpdatedAt != null && Number.isFinite(lastRemoteUpdatedAt) ? lastRemoteUpdatedAt : null,
    lastRemoteId: lastRemoteIdRaw ?? null,
    deviceId,
    hydrated: true,
  });
})();

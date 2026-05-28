import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const SYNC_ENABLED_KEY = '@codeflash_icloud_sync_enabled';
const LAST_SYNCED_AT_KEY = '@codeflash_icloud_last_synced_at';
const LAST_SYNCED_VERSION_KEY = '@codeflash_icloud_last_synced_version';
const LAST_REMOTE_UPDATED_AT_KEY = '@codeflash_icloud_last_remote_updated_at';
const LAST_REMOTE_ID_KEY = '@codeflash_icloud_last_remote_id';
const DEVICE_ID_KEY = '@codeflash_device_id';

export type SyncStatus = 'idle' | 'syncing' | 'error';
export type SyncDirection = 'upload' | 'download' | 'check';

/**
 * 同期エラーの種別コード。人間向け文言は UI 側で i18n 翻訳する
 * （ストアに翻訳済み文字列を入れると端末言語切替・言語不一致でズレるため）。
 * - unavailable: iCloud 未ログイン／iCloud Drive 無効
 * - schemaMismatch: リモートが新しいスキーマ（アプリ更新が必要）
 * - noRemoteBackup: 強制ダウンロード時にリモートが存在しない
 * - timeout: 転送がタイムアウト（無応答）
 * - storageFull: iCloud 容量不足
 * - unknown: 上記以外（想定外エラー）
 */
export type SyncErrorCode =
  | 'unavailable'
  | 'schemaMismatch'
  | 'noRemoteBackup'
  | 'timeout'
  | 'storageFull'
  | 'unknown';

interface SyncState {
  hydrated: boolean;
  enabled: boolean;
  status: SyncStatus;
  direction: SyncDirection | null;
  /** true のとき同期中はアプリ全体をオーバーレイでブロックする（ユーザー操作の同期のみ true。自動トリガーは false） */
  blocking: boolean;
  /** 最後に同期処理を行った実時刻（表示「最終同期」用。変更検知には使わない）。 */
  lastSyncedAt: number | null;
  /** 最後に同期したときのローカル変更カウンタ（sync_state.localVersion）。ローカル変更検知の基準。 */
  lastSyncedVersion: number | null;
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

  setEnabled: (enabled: boolean) => void;
  setStatus: (status: SyncStatus, direction?: SyncDirection | null) => void;
  setBlocking: (blocking: boolean) => void;
  setError: (code: SyncErrorCode) => void;
  clearError: () => void;
  setLastSyncedAt: (timestamp: number) => void;
  setLastSyncedVersion: (version: number) => void;
  setLastRemoteUpdatedAt: (timestamp: number) => void;
  setLastRemoteId: (id: string) => void;
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
  lastSyncedVersion: null,
  lastRemoteUpdatedAt: null,
  lastRemoteId: null,
  errorCode: null,
  deviceId: '',

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
  setLastSyncedVersion: (version) => {
    set({ lastSyncedVersion: version });
    AsyncStorage.setItem(LAST_SYNCED_VERSION_KEY, String(version));
  },
  setLastRemoteUpdatedAt: (timestamp) => {
    set({ lastRemoteUpdatedAt: timestamp });
    AsyncStorage.setItem(LAST_REMOTE_UPDATED_AT_KEY, String(timestamp));
  },
  setLastRemoteId: (id) => {
    set({ lastRemoteId: id });
    AsyncStorage.setItem(LAST_REMOTE_ID_KEY, id);
  },
}));

(async () => {
  const [enabledRaw, lastSyncedRaw, lastSyncedVersionRaw, lastRemoteUpdatedRaw, lastRemoteIdRaw, deviceIdRaw] = await Promise.all([
    AsyncStorage.getItem(SYNC_ENABLED_KEY),
    AsyncStorage.getItem(LAST_SYNCED_AT_KEY),
    AsyncStorage.getItem(LAST_SYNCED_VERSION_KEY),
    AsyncStorage.getItem(LAST_REMOTE_UPDATED_AT_KEY),
    AsyncStorage.getItem(LAST_REMOTE_ID_KEY),
    AsyncStorage.getItem(DEVICE_ID_KEY),
  ]);

  let deviceId = deviceIdRaw ?? '';
  if (!deviceId) {
    deviceId = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  const lastSyncedAt = lastSyncedRaw ? Number(lastSyncedRaw) : null;
  const lastSyncedVersion = lastSyncedVersionRaw != null ? Number(lastSyncedVersionRaw) : null;
  const lastRemoteUpdatedAt = lastRemoteUpdatedRaw != null ? Number(lastRemoteUpdatedRaw) : null;

  useSyncStore.setState({
    enabled: enabledRaw === 'true',
    lastSyncedAt: Number.isFinite(lastSyncedAt) ? lastSyncedAt : null,
    lastSyncedVersion: lastSyncedVersion != null && Number.isFinite(lastSyncedVersion) ? lastSyncedVersion : null,
    lastRemoteUpdatedAt: lastRemoteUpdatedAt != null && Number.isFinite(lastRemoteUpdatedAt) ? lastRemoteUpdatedAt : null,
    lastRemoteId: lastRemoteIdRaw ?? null,
    deviceId,
    hydrated: true,
  });
})();

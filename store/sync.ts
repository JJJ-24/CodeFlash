import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const SYNC_ENABLED_KEY = '@codeflash_icloud_sync_enabled';
const LAST_SYNCED_AT_KEY = '@codeflash_icloud_last_synced_at';
const DEVICE_ID_KEY = '@codeflash_device_id';

export type SyncStatus = 'idle' | 'syncing' | 'error';
export type SyncDirection = 'upload' | 'download' | 'check';

interface SyncState {
  hydrated: boolean;
  enabled: boolean;
  status: SyncStatus;
  direction: SyncDirection | null;
  lastSyncedAt: number | null;
  errorMessage: string | null;
  deviceId: string;

  setEnabled: (enabled: boolean) => void;
  setStatus: (status: SyncStatus, direction?: SyncDirection | null) => void;
  setError: (message: string) => void;
  clearError: () => void;
  setLastSyncedAt: (timestamp: number) => void;
}

function generateDeviceId(): string {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useSyncStore = create<SyncState>((set) => ({
  hydrated: false,
  enabled: false,
  status: 'idle',
  direction: null,
  lastSyncedAt: null,
  errorMessage: null,
  deviceId: '',

  setEnabled: (enabled) => {
    set({ enabled });
    AsyncStorage.setItem(SYNC_ENABLED_KEY, String(enabled));
  },
  setStatus: (status, direction = null) => {
    set({ status, direction });
  },
  setError: (message) => {
    set({ status: 'error', direction: null, errorMessage: message });
  },
  clearError: () => {
    set({ errorMessage: null });
  },
  setLastSyncedAt: (timestamp) => {
    set({ lastSyncedAt: timestamp });
    AsyncStorage.setItem(LAST_SYNCED_AT_KEY, String(timestamp));
  },
}));

(async () => {
  const [enabledRaw, lastSyncedRaw, deviceIdRaw] = await Promise.all([
    AsyncStorage.getItem(SYNC_ENABLED_KEY),
    AsyncStorage.getItem(LAST_SYNCED_AT_KEY),
    AsyncStorage.getItem(DEVICE_ID_KEY),
  ]);

  let deviceId = deviceIdRaw ?? '';
  if (!deviceId) {
    deviceId = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  const lastSyncedAt = lastSyncedRaw ? Number(lastSyncedRaw) : null;

  useSyncStore.setState({
    enabled: enabledRaw === 'true',
    lastSyncedAt: Number.isFinite(lastSyncedAt) ? lastSyncedAt : null,
    deviceId,
    hydrated: true,
  });
})();

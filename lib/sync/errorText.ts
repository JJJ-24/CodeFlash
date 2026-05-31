import type { SyncErrorCode, SyncNoticeCode } from '@/store/sync';

/**
 * 同期エラーコードを翻訳済みの文言にする。
 * 設定画面のインライン表示と、全画面の同期エラーバナーで共用する
 * （ストアには翻訳済み文字列を入れず、表示時に i18n 翻訳する方針）。
 */
export function syncErrorText(
  code: SyncErrorCode,
  t: (key: string) => string,
): string {
  switch (code) {
    case 'unavailable':
      return t('sync.iCloudUnavailable');
    case 'schemaMismatch':
      return t('sync.schemaVersionMismatch');
    case 'noRemoteBackup':
      return t('sync.noRemoteBackup');
    case 'timeout':
      return t('sync.syncTimeout');
    case 'storageFull':
      return t('sync.storageFull');
    case 'offline':
      return t('sync.offline');
    default:
      return t('sync.syncError');
  }
}

/**
 * 全画面の通知バナー（SyncNoticeCode）に出す文言。
 * 案内系（offlinePending）はここで扱い、それ以外はエラー文言に委譲する。
 */
export function syncNoticeText(
  code: SyncNoticeCode,
  t: (key: string) => string,
): string {
  if (code === 'offlinePending') return t('sync.offlinePending');
  return syncErrorText(code, t);
}

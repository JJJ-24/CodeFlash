/**
 * Pro 1週間体験（チケット035）のトライアル状態管理。
 *
 * - 体験開始時刻（trialStartedAt）は iCloud KV（NSUbiquitousKeyValueStore）に保存し、
 *   Apple ID 単位で再インストール後も「1回だけ」に制限する。
 * - AsyncStorage にもキャッシュし、KV が読めない環境（iCloud 未ログイン・Android・Expo Go）では
 *   ローカル判定にフォールバックする（再インストールで再体験の余地は残るが許容＝設計方針）。
 * - 時計巻き戻しによる延長は lastSeenAt（単調増加の最終確認時刻）の逆行検知で恒久無効化する。
 *   iCloud 同期の時計スキュー対策（LWW）とは別管理。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getICloudKVString,
  isICloudKVAvailable,
  setICloudKVString,
} from '@/modules/icloud-kv';
import { useProStore } from '@/store/pro';
import { useSyncStore } from '@/store/sync';

export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// NTP 補正などの正当な小さい時刻後退を巻き戻しと誤検知しないための許容幅
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

const KV_TRIAL_STARTED_AT = 'proTrialStartedAt';
// これらのキーは意図的に lib/settings-keys.ts（JSONエクスポート対象）へ入れない。
// バックアップの書き戻しで体験状態を復元・改変できてしまうため。
const LOCAL_TRIAL_STARTED_AT = '@codeflash_trial_started_at';
const LOCAL_TRIAL_LAST_SEEN_AT = '@codeflash_trial_last_seen_at';
const LOCAL_TRIAL_INVALIDATED = '@codeflash_trial_invalidated';

function parseTimestamp(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * トライアル状態を再判定して useProStore に反映する。
 * 起動時・フォアグラウンド復帰時・startTrial() の冒頭から呼ぶ。
 * KV とローカルキャッシュの整合（repair）と時計巻き戻し検知もここで行う。
 */
export async function refreshTrial(): Promise<void> {
  const now = Date.now();
  const [localRaw, lastSeenRaw, invalidatedRaw] = await Promise.all([
    AsyncStorage.getItem(LOCAL_TRIAL_STARTED_AT),
    AsyncStorage.getItem(LOCAL_TRIAL_LAST_SEEN_AT),
    AsyncStorage.getItem(LOCAL_TRIAL_INVALIDATED),
  ]);
  const kvStartedAt = parseTimestamp(getICloudKVString(KV_TRIAL_STARTED_AT));
  const localStartedAt = parseTimestamp(localRaw);
  const lastSeenAt = parseTimestamp(lastSeenRaw);
  let invalidated = invalidatedRaw === '1';

  // KV（Apple ID 単位）を真実とし、ローカルはキャッシュ兼フォールバック
  const startedAt = kvStartedAt ?? localStartedAt;

  if (kvStartedAt != null && kvStartedAt !== localStartedAt) {
    AsyncStorage.setItem(LOCAL_TRIAL_STARTED_AT, String(kvStartedAt)).catch(() => {});
  } else if (kvStartedAt == null && localStartedAt != null && isICloudKVAvailable()) {
    // KV 障害中や未ログイン時にローカルだけで開始した場合、読めるようになった時点で
    // KV へ書き戻して再インストール防止を回復する
    setICloudKVString(KV_TRIAL_STARTED_AT, String(localStartedAt));
  }

  // 時計巻き戻しガード：最終確認時刻より過去、または開始時刻より過去なら恒久無効化
  if (!invalidated && startedAt != null) {
    const rolledBack =
      (lastSeenAt != null && now < lastSeenAt - CLOCK_TOLERANCE_MS) ||
      now < startedAt - CLOCK_TOLERANCE_MS;
    if (rolledBack) {
      invalidated = true;
      AsyncStorage.setItem(LOCAL_TRIAL_INVALIDATED, '1').catch(() => {});
    }
  }

  if (lastSeenAt == null || now > lastSeenAt) {
    AsyncStorage.setItem(LOCAL_TRIAL_LAST_SEEN_AT, String(now)).catch(() => {});
  }

  const active = !invalidated && startedAt != null && now - startedAt < TRIAL_DURATION_MS;
  useProStore.getState().setTrialState(startedAt, active);

  // 体験が終わった（期限切れ or 無効化）未購入ユーザーは同期設定もオフに戻し、
  // 設定画面のトグル表示と実挙動を無料状態に整合させる（クラウド上のデータは消さない）。
  // pro/sync ストアが未 hydrate の間は何もしない（hydrate 前は purchased が false に見え、
  // 購入済みユーザーの同期を誤ってオフにしうる。自動同期は _layout／trigger 内の実効Proゲートで
  // 既に止まっており、次のフォアグラウンド復帰の refreshTrial が拾う）。
  const pro = useProStore.getState();
  if (startedAt != null && !active && pro.hydrated && !pro.purchased) {
    const sync = useSyncStore.getState();
    if (sync.hydrated && sync.enabled) sync.setEnabled(false);
  }
}

export type StartTrialResult = 'started' | 'alreadyUsed';

/**
 * トライアルを開始する。KV・ローカルのどちらかに開始記録が既にあれば拒否（一度きり）。
 * KV へ書けない環境ではローカルのみに記録して開始を許可する（フォールバック）。
 */
export async function startTrial(): Promise<StartTrialResult> {
  await refreshTrial();
  if (useProStore.getState().trialStartedAt != null) return 'alreadyUsed';

  const now = Date.now();
  setICloudKVString(KV_TRIAL_STARTED_AT, String(now));
  await AsyncStorage.setItem(LOCAL_TRIAL_STARTED_AT, String(now));
  await AsyncStorage.setItem(LOCAL_TRIAL_LAST_SEEN_AT, String(now));
  useProStore.getState().setTrialState(now, true);
  return 'started';
}

/** 体験の残り時間（ms）。体験中でなければ 0。Paywall の残り日数表示用 */
export function getTrialRemainingMs(): number {
  const { trialStartedAt, trialActive } = useProStore.getState();
  if (!trialActive || trialStartedAt == null) return 0;
  return Math.max(0, trialStartedAt + TRIAL_DURATION_MS - Date.now());
}

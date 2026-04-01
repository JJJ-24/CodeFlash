import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getTodayDueCount } from '@/lib/database/reviews';

const NOTIFICATION_IDENTIFIER = 'daily-reminder';

function getReminderBody(): { title: string; body: string } {
  const locales = Localization.getLocales();
  const isJa = locales.length > 0 && locales[0].languageCode === 'ja';
  return {
    title: 'CodeFlash',
    body: isJa ? '今日のカードを復習しましょう' : 'Time to review your cards!',
  };
}

/** 通知許可をリクエストし、granted なら true を返す */
export async function requestPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/** 毎日指定時刻に通知をスケジュール（既存をキャンセルしてから登録） */
export async function scheduleDailyReminder(hour: number, minute: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDENTIFIER).catch(() => {});
  const { title, body } = getReminderBody();
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_IDENTIFIER,
    content: { title, body, sound: true },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour,
      minute,
      repeats: true,
    },
  });
}

/** 通知をキャンセル */
export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDENTIFIER).catch(() => {});
}

/** 今日の due カード数をアプリアイコンバッジに反映 */
export async function updateBadgeCount(db: SQLiteDatabase): Promise<void> {
  const count = await getTodayDueCount(db);
  await Notifications.setBadgeCountAsync(count);
}

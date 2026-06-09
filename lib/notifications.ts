import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getAllSchedules } from '@/lib/database/notifications';
import { getTodayDueCount } from '@/lib/database/reviews';

const LEGACY_IDENTIFIER = 'daily-reminder';

function getReminderBody(dueCount?: number): { title: string; body: string } {
  const locales = Localization.getLocales();
  const isJa = locales.length > 0 && locales[0].languageCode === 'ja';
  const title = 'CodeFlash';
  let body: string;
  if (dueCount !== undefined && dueCount > 0) {
    body = isJa
      ? `今日の復習カードが ${dueCount} 枚あります`
      : `You have ${dueCount} cards to review today`;
  } else if (dueCount === 0) {
    body = isJa ? '今日の復習カードはありません' : 'No cards to review today';
  } else {
    body = isJa ? '今日のカードを復習しましょう' : 'Time to review your cards!';
  }
  return { title, body };
}

/** 通知許可をリクエストし、granted なら true を返す */
export async function requestPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * DB の notification_schedules を読み込み、有効なスケジュールをすべて登録する。
 * 既存の全スケジュール通知をキャンセルしてから再登録する（due 枚数入り通知文）。
 */
export async function scheduleFromDb(db: SQLiteDatabase): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();

  const schedules = await getAllSchedules(db);
  const enabled = schedules.filter((s) => s.enabled);
  if (enabled.length === 0) return;

  const dueCount = await getTodayDueCount(db);
  const { title, body } = getReminderBody(dueCount);

  for (const s of enabled) {
    if (s.weekdays.length === 0) {
      await Notifications.scheduleNotificationAsync({
        identifier: `schedule-${s.id}`,
        content: { title, body, sound: true },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          hour: s.hour,
          minute: s.minute,
          repeats: true,
        },
      });
    } else {
      for (const day of s.weekdays) {
        await Notifications.scheduleNotificationAsync({
          identifier: `schedule-${s.id}-${day}`,
          content: { title, body, sound: true },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            hour: s.hour,
            minute: s.minute,
            weekday: day + 1, // expo-notifications: 1=日, 2=月, ..., 7=土
            repeats: true,
          },
        });
      }
    }
  }
}

/** すべてのスケジュール通知をキャンセル */
export async function cancelAllScheduledNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** @deprecated scheduleFromDb を使用してください */
export async function scheduleDailyReminder(hour: number, minute: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(LEGACY_IDENTIFIER).catch(() => {});
  const { title, body } = getReminderBody();
  await Notifications.scheduleNotificationAsync({
    identifier: LEGACY_IDENTIFIER,
    content: { title, body, sound: true },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour,
      minute,
      repeats: true,
    },
  });
}

/** @deprecated cancelAllScheduledNotifications を使用してください */
export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(LEGACY_IDENTIFIER).catch(() => {});
}

/** 今日の due カード数をアプリアイコンバッジに反映 */
export async function updateBadgeCount(db: SQLiteDatabase): Promise<void> {
  const count = await getTodayDueCount(db);
  await Notifications.setBadgeCountAsync(count);
}

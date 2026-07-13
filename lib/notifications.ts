import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getAllSchedules } from '@/lib/database/notifications';
import { getTodayDueCount } from '@/lib/database/reviews';
import { useStudyTimerStore } from '@/store/studyTimer';

const LEGACY_IDENTIFIER = 'daily-reminder';
// 休憩終了通知（039）。identifier 固定＝二重予約は上書きで自然解消
const BREAK_END_IDENTIFIER = 'study-break-end';

// 学習画面のタイマーUI（リング・ピル・遷移ハプティクス＋ヒント）がユーザーに見えているか。
// 休憩終了通知のフォアグラウンド表示判定に使う: 見えている間は画面内の合図が届くのでバナーを
// 出さず、それ以外（他画面・編集モーダル中・完了画面）ではバナーを表示する。
// 当初は「学習画面マウント中」で判定していたが、編集モーダル中はリングが隠れ・完了画面は
// リング自体が非表示で、合図がハプティクスのみ（iPad は非搭載＝無音無表示）になるため、
// 「フォーカス中かつ完了画面でない」（＝suspended の反転）に絞った（2026-07-13）。
// session.tsx が更新する。
let studyTimerUiVisible = false;
export function setStudyTimerUiVisible(v: boolean) {
  studyTimerUiVisible = v;
}

// フォアグラウンド受信時の表示制御（039）。ハンドラ未登録時の既定はフォアグラウンド非表示なので、
// 休憩終了通知（タイマーUIが見えていないときのみ）だけ表示を許可し、デイリーリマインダー等の
// 他の通知は従来どおり false を返して非表示を維持する。
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show =
      notification.request.identifier === BREAK_END_IDENTIFIER && !studyTimerUiVisible;
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show,
      shouldSetBadge: false,
    };
  },
});

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

/**
 * 休憩終了のローカル通知を予約する（039 ポモドーロ）。
 * 休憩開始時に予約し、休憩の全離脱経路（自然終了/スキップ/停止/リセット）でキャンセルする。
 * フォアグラウンドで発火した場合の表示可否は上の setNotificationHandler が判定する
 * （学習画面マウント中は非表示・それ以外の画面ではバナー表示）。
 * - granted でなければ何もしない（未許可でも復帰時の resolveBreak が即遷移するため機能は完全動作）
 * - 残り1秒未満は予約しない（即発火と画面内解決の競合回避）
 * - 文言は getReminderBody と同じ expo-localization 直参照（React コンテキスト外で使うため）
 */
export async function scheduleBreakEndNotification(endAt: number): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  if (endAt - Date.now() < 1000) return;
  const locales = Localization.getLocales();
  const isJa = locales.length > 0 && locales[0].languageCode === 'ja';
  await Notifications.scheduleNotificationAsync({
    identifier: BREAK_END_IDENTIFIER,
    content: {
      title: 'CodeFlash',
      body: isJa ? '休憩が終わりました。学習を再開しましょう' : 'Break is over — time to get back to studying!',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(endAt),
    },
  });
}

/** 休憩終了通知をキャンセル（未予約でも安全） */
export async function cancelBreakEndNotification(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(BREAK_END_IDENTIFIER).catch(() => {});
}

/**
 * タイマーストアの現状に合わせて休憩終了通知を予約し直す/掃除する（039）。
 * フォアグラウンド復帰時の cancel-all（scheduleFromDb / cancelAllScheduledNotifications）は
 * 予約済みの休憩終了通知も巻き込んで消すため、その直後に必ずこれを呼んで復元する。
 * 休憩中でない・終了時刻をすでに過ぎている場合はキャンセル側に倒す（残骸掃除）。
 */
export async function syncBreakEndNotification(): Promise<void> {
  const st = useStudyTimerStore.getState();
  if (
    st.mode === 'break' &&
    st.phase === 'running' &&
    st.breakEndAt != null &&
    st.breakEndAt - Date.now() >= 1000
  ) {
    await scheduleBreakEndNotification(st.breakEndAt);
  } else {
    await cancelBreakEndNotification();
  }
}

/** 今日の due カード数をアプリアイコンバッジに反映 */
export async function updateBadgeCount(db: SQLiteDatabase): Promise<void> {
  const count = await getTodayDueCount(db);
  await Notifications.setBadgeCountAsync(count);
}

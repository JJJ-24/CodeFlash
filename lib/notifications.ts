import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getAllSchedules } from '@/lib/database/notifications';
import { getActiveCardCount, getTodayDueCount, getTodayReviewedCount } from '@/lib/database/reviews';
import { computeGoalLookaheadDays, isStudyGoalUnmet } from '@/lib/studyGoal';
import { useSettingsStore } from '@/store/settings';
import type { NotificationSchedule } from '@/types';
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

/** 046: 未達成リマインダーの identifier 接頭辞。当日分だけを狙ってキャンセルするため
 *  `goal-{scheduleId}-{YYYY-MM-DD}` の形にする。 */
const GOAL_REMINDER_PREFIX = 'goal-';

// 046: 学習セッションを操作中か（学習画面がフォーカス中かつ完了画面でない）。
// 未達成リマインダーのフォアグラウンド表示判定に使う：**学習している最中に
// 「目標が残っています」と出すのは明確に誤り**なので、そのときだけ抑制する。
// タイマー用の studyTimerUiVisible とは今のところ同じ値だが、意味が違うので別に持つ
// （片方の条件を変えたときにもう片方が巻き添えにならないようにする）。session.tsx が更新する。
let studySessionActive = false;
export function setStudySessionActive(v: boolean) {
  studySessionActive = v;
}

// フォアグラウンド受信時の表示制御（039）。ハンドラ未登録時の既定はフォアグラウンド非表示なので、
// 休憩終了通知（タイマーUIが見えていないときのみ）だけ表示を許可し、デイリーリマインダー等の
// 他の通知は従来どおり false を返して非表示を維持する。
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const id = notification.request.identifier;
    // 046: 未達成リマインダーは**学習セッション中以外なら表示する**。
    // 通知は発火した時点でその日ぶんを消費し再送されないため、非表示にすると
    // 「たまたまアプリを開いていた日はリマインダーが黙って消える」＝機能の目的
    // （うっかり途切れるのを防ぐ）と噛み合わない。デイリーリマインダー（無条件・毎日来る）と
    // 挙動が違うのは意図的で、こちらは**その日限りの条件つき**だから。
    const show =
      (id === BREAK_END_IDENTIFIER && !studyTimerUiVisible) ||
      (id.startsWith(GOAL_REMINDER_PREFIX) && !studySessionActive);
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

/** 現在の通知許可の状態を**要求せずに**確認する。
 *  アプリ内で通知をオンにした後に **OS 設定側で許可を取り消される**ことがあり、その場合
 *  `notificationEnabled` は true のままなのに一切鳴らない（アプリからは分からない沈黙）。
 *  設定画面はこれを見て「許可されていない」旨を出す。 */
export async function isPermissionGranted(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

/** 046: 未達成リマインダーの通知文。**枚数は入れない**（予約時点の値しか焼き込めず、
 *  発火時にはズレているため）。 */
function getGoalUnmetBody(): { title: string; body: string } {
  const locales = Localization.getLocales();
  const isJa = locales.length > 0 && locales[0].languageCode === 'ja';
  return {
    title: 'CodeFlash',
    body: isJa ? '今日の目標がまだ残っています' : "You haven't reached today's goal yet",
  };
}

/** ローカル日付の 'YYYY-MM-DD'（lib/database/utils の localDateStr と同じ規則）。 */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * DB の notification_schedules を読み込み、有効なスケジュールをすべて登録する。
 * 既存の全スケジュール通知をキャンセルしてから再登録する（due 枚数入り通知文）。
 *
 * **046: `onlyIfGoalUnmet` のスケジュールだけ予約方式が違う。** iOS は発火時に条件を評価できない
 * （繰り返し通知を「今日だけスキップ」できない）ため、**日付指定で数日分を前倒し予約**し、
 * 目標を達成した瞬間に当日分をキャンセルする（`cancelTodayGoalReminders`）。
 * 予約が尽きないよう、フォアグラウンド復帰・セッション終了・設定変更のたびに積み直す。
 */
export async function scheduleFromDb(db: SQLiteDatabase): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();

  const schedules = await getAllSchedules(db);
  const enabled = schedules.filter((s) => s.enabled);
  if (enabled.length === 0) return;

  const dueCount = await getTodayDueCount(db);
  const { title, body } = getReminderBody(dueCount);

  const plain = enabled.filter((s) => !s.onlyIfGoalUnmet);
  const conditional = enabled.filter((s) => s.onlyIfGoalUnmet);

  for (const s of plain) {
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

  if (conditional.length > 0) await scheduleGoalReminders(db, conditional, plain);
}

/**
 * 046: 未達成リマインダー（`onlyIfGoalUnmet`）を日付指定で前倒し予約する。
 *
 * - 目標が OFF なら**何も予約しない**（常に未達成扱いで毎日鳴るのを避ける）
 * - **学習できるカードが1枚も無いとき**（非アーカイブ0枚）も予約しない
 *   ＝ユーザーに打つ手がない状態で催促しても意味がないため（好みではなく客観条件なので設定にしない）
 * - **今日ぶんは、すでに目標を達成していれば予約しない**
 * - 先読み日数は残りの予約枠から決める（64件上限に当たらないように）
 */
async function scheduleGoalReminders(
  db: SQLiteDatabase,
  conditional: NotificationSchedule[],
  plain: NotificationSchedule[]
): Promise<void> {
  const { studyGoalEnabled, studyGoalCount } = useSettingsStore.getState();
  if (!studyGoalEnabled) return;

  const studiable = await getActiveCardCount(db);
  if (studiable === 0) return;

  const todayCount = await getTodayReviewedCount(db);
  const metToday = !isStudyGoalUnmet(todayCount, studyGoalCount);

  // 無条件スケジュールが使った枠を引いた残りを、条件つきスケジュールで分け合う
  // （計算は lib/studyGoal.ts の純粋関数＝上限を超えないことを verify:db で検証している）。
  const usedByPlain = plain.reduce((n, s) => n + (s.weekdays.length === 0 ? 1 : s.weekdays.length), 0);
  const lookahead = computeGoalLookaheadDays(usedByPlain, conditional.length);

  const { title, body } = getGoalUnmetBody();
  const now = new Date();

  for (const s of conditional) {
    for (let offset = 0; offset < lookahead; offset++) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, s.hour, s.minute, 0, 0);
      if (date.getTime() <= now.getTime()) continue;           // 今日のうち過ぎた時刻は予約しない
      if (offset === 0 && metToday) continue;                  // 今日はもう達成済み
      // weekdays が空＝毎日。指定があればその曜日だけ（0=日〜6=土）
      if (s.weekdays.length > 0 && !s.weekdays.includes(date.getDay())) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `${GOAL_REMINDER_PREFIX}${s.id}-${localDateKey(date)}`,
        content: { title, body, sound: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
      });
    }
  }
}

/**
 * 046: **今日ぶん**の未達成リマインダーをキャンセルする（目標を達成した瞬間に呼ぶ）。
 * 学習中はアプリが開いているので、このキャンセルは確実に効く。
 * 明日以降の予約は残す（今日の達成は明日の催促を止める理由にならない）。
 */
export async function cancelTodayGoalReminders(): Promise<void> {
  const today = localDateKey(new Date());
  const pending = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const req of pending) {
    if (req.identifier.startsWith(GOAL_REMINDER_PREFIX) && req.identifier.endsWith(today)) {
      await Notifications.cancelScheduledNotificationAsync(req.identifier).catch(() => {});
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

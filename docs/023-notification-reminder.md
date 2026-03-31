# 023 通知リマインダー

**フェーズ:** v1.1
**ステータス:** 完了
**依存:** 001, 013

---

## 概要

毎日指定した時刻に「今日のカードを復習しましょう」という iOS ローカルプッシュ通知を送る。
設定画面でオン/オフと時刻（時・分）を設定できる。

---

## Todo

### パッケージ
- [x] `expo-notifications` インストール
- [x] `@react-native-community/datetimepicker` インストール

### app.json
- [x] `expo-notifications` プラグインを追加（icon・color 指定）

### 通知ユーティリティ
- [x] `lib/notifications.ts` を新規作成
  - [x] `requestPermission()` — 通知許可ダイアログを表示し、granted なら true を返す
  - [x] `scheduleDailyReminder(hour, minute)` — 既存通知をキャンセルしてから毎日繰り返し通知をスケジュール
    - [x] trigger type: `CALENDAR`（hour・minute 指定、repeats: true）
    - [x] identifier 固定（`'daily-reminder'`）で重複登録を防ぐ
  - [x] `cancelAllReminders()` — 通知をキャンセル
  - [x] 通知本文は端末言語（`expo-localization`）で ja/en を切り替え

### 設定ストア
- [x] `store/settings.ts` に通知設定を追加
  - [x] `notificationEnabled: boolean`（初期値: false）
  - [x] `notificationHour: number`（初期値: 9）
  - [x] `notificationMinute: number`（初期値: 0）
  - [x] `setNotificationEnabled(v)`・`setNotificationTime(hour, minute)` アクション
  - [x] AsyncStorage で永続化（専用キー3本）

### 設定画面 UI
- [x] `app/(tabs)/settings.tsx` にフォントサイズセクションの直後に「通知」セクションを追加
  - [x] 「毎日のリマインダー」 `Switch`（ON/OFF）
  - [x] ON にした瞬間に `requestPermission()` を呼び、拒否なら `Alert` でシステム設定を案内
  - [x] `DateTimePicker`（`mode="time"`, `display="spinner"`）をトグル ON 時のみ表示
  - [x] 時刻変更時に即座に `scheduleDailyReminder` を呼ぶ
  - [x] OFF にした瞬間に `cancelAllReminders` を呼ぶ

### バックグラウンド復帰時の再スケジュール
- [x] `app/_layout.tsx` の `RootStack` に `AppState` リスナーを追加
  - [x] `nextState === 'active'` かつ `notificationEnabled` のとき `scheduleDailyReminder` を再実行
  - [x] `notificationEnabled` が false のときは `cancelAllReminders` を呼ぶ

### i18n
- [x] `notification.title` — 「通知」/ "Notifications"
- [x] `notification.dailyReminder` — 「毎日のリマインダー」/ "Daily Reminder"
- [x] `notification.reminderTime` — 「時刻」/ "Time"
- [x] `notification.permissionDenied` — 「通知が許可されていません」/ "Notifications Not Allowed"
- [x] `notification.permissionDeniedMessage` — 「設定アプリから通知を許可してください」/ "Please enable notifications in the Settings app"

---

## 設計メモ

- 通知は identifier 固定（`'daily-reminder'`）の1件のみ管理する。
  `cancelScheduledNotificationAsync(id)` → `scheduleNotificationAsync` の順で呼ぶことで
  重複登録を防ぐ。
- AppState の `active` 復帰時に再スケジュールするのは、iOS が一定条件で
  スケジュール済み通知を消去するケースに対応するため。
- 通知本文は現時点では固定文字列。将来的に「今日の復習カードが X 枚あります」のように
  動的件数を含める場合は、`scheduleDailyReminder` の呼び出し前に DB クエリを追加する必要がある。
- `DateTimePicker` の `display="spinner"` は iOS のみ対応。Android ではデフォルト表示になる。

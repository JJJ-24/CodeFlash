# 031 高度な通知・リマインダー

**フェーズ:** v1.2
**ステータス:** 未着手
**依存:** 023（通知リマインダー基本実装）
**被依存:** ―
**料金区分:** 無料機能（基本拡張）/ Pro 機能（デッキ別リマインダー）

---

## 概要

023（毎日1回・固定時刻の通知）を拡張し、複数スケジュール・曜日別 ON/OFF・due 枚数入り通知文を追加する。
028 候補2「高度な通知・リマインダー」から実装スコープを確定したもの。

---

## 実装スコープ

### 今回実装する機能（無料）

1. **複数スケジュール** — 最大 5 件まで通知時刻を個別に追加・編集・削除できる
2. **曜日別 ON/OFF** — 各スケジュールに対して月〜日の曜日を個別指定（例: 土日は通知しない）
3. **due 枚数入り通知文** — 「今日の復習カードが X 枚あります」のように動的件数を含める

### 今回スコープ外（将来検討）

- デッキ別リマインダー（identifier 管理が複数×複数で複雑化、DB テーブル新設が必要）
- タグ別リマインダー（同上）
- スマート通知（連続欠席日数で文言を変える）

---

## Todo

### DB

- [x] `lib/database/schema.ts` に `notification_schedules` テーブルを追加（マイグレーション）
  - カラム: `id TEXT PRIMARY KEY, hour INTEGER, minute INTEGER, weekdays TEXT, label TEXT, enabled INTEGER DEFAULT 1`
  - `weekdays`: 有効な曜日を JSON 配列で保存（例: `[1,2,3,4,5]` = 月〜金、0=日〜6=土）
  - `label`: ユーザーが任意で付けるメモ（例:「朝の通学」「夜の復習」）、空文字可
- [x] `lib/database/notifications.ts` を新規作成
  - [x] `getAllSchedules(db)` — 全スケジュール一覧を取得（`ORDER BY hour, minute ASC`）
  - [x] `createSchedule(db, schedule)` — スケジュールを追加
  - [x] `updateSchedule(db, schedule)` — スケジュールを更新
  - [x] `deleteSchedule(db, id)` — スケジュールを削除
  - [x] `toggleScheduleEnabled(db, id, enabled)` — スケジュールの有効/無効を切り替え
  - [x] `countSchedules(db)` — スケジュール件数を取得（最大件数チェック用）

### 通知ユーティリティ（`lib/notifications.ts` 拡張）

- [x] `scheduleFromDb(db)` — DB の `notification_schedules` を読み込み、有効なスケジュールをすべて登録する
  - [x] `cancelAllScheduledNotificationsAsync()` で全通知をキャンセルしてから再登録
  - [x] 各スケジュールに `'schedule-{id}'` / `'schedule-{id}-{weekday}'` 形式の identifier を割り当て
  - [x] due 枚数を `getTodayDueCount(db)` で取得して通知本文に埋め込む（「今日 X 枚あります」）
  - [x] weekdays が空のスケジュールは毎日発火、指定がある場合は `weekday` トリガーで曜日ごとに個別登録
- [x] `cancelAllScheduledNotifications()` — 全通知をキャンセル
- [x] 後方互換: `scheduleDailyReminder` / `cancelAllReminders` を `@deprecated` として残存

### ストア

- 既存の `notificationEnabled` / `notificationHour` / `notificationMinute` を維持（移行用）
- スケジュール一覧は DB から直接ロード（Zustand キャッシュ不要）

### 設定画面 UI（`app/settings/notifications.tsx`）

- [x] グローバル ON/OFF トグル（`notificationEnabled`）
- [x] スケジュール一覧の表示（時刻・曜日サマリー・曜日ドット・ラベル・有効スイッチ）
- [x] スケジュール行タップで編集モーダルを開く
- [x] 「スケジュールを追加」ボタン（最大5件で非表示）
- [x] スケジュール追加・編集モーダル（ボトムシートアニメーション）
  - [x] 時刻選択（`DateTimePicker`、`mode="time"`, `display="spinner"`）
  - [x] 曜日選択（日〜土の7ボタン、タップでトグル、選択サマリー表示）
  - [x] ラベル入力（任意テキスト、最大40文字）
  - [x] 「削除」（編集時のみ）/「保存」ボタン
- [x] 通知権限拒否時の InfoModal 表示
- [x] 旧設定からの移行: schedules 空 + `notificationEnabled=true` 時に既存時刻で1件自動作成

### `app/_layout.tsx`

- [x] AppState `active` 時: `scheduleFromDb(db)` を呼び出す（旧 `scheduleDailyReminder` から変更）
- [x] `notificationHour` / `notificationMinute` の不要な依存を削除

### i18n

- [x] `notification.schedules` / `.addSchedule` / `.editSchedule`
- [x] `notification.noSchedules` / `.maxSchedules`
- [x] `notification.label` / `.labelPlaceholder`
- [x] `notification.weekdays` / `.weekdayEvery` / `.weekdayWeekdays` / `.weekdayWeekend` / `.weekdayShort`
- [x] `notification.deleteSchedule` / `.deleteScheduleConfirm`

---

## 設計メモ

### 通知 identifier の管理

複数スケジュール × 複数曜日の組み合わせになる場合、identifier は `schedule-{id}-{weekday}` のように曜日別に分けて登録する。`scheduleFromDb` でまず全通知をキャンセルしてから再登録することで、曜日変更時の残留通知を防ぐ。

### due 枚数の扱い

`expo-notifications` の `scheduleNotificationAsync` は通知内容を登録時点で固定する（動的更新不可）。そのため、due 枚数は以下タイミングで再登録する：
- アプリ起動時（フォアグラウンド復帰）
- 学習セッション完了時（`finishSession` 後）

→ 現在の `app/_layout.tsx` の AppState リスナー + 学習完了時の `updateBadgeCount` と同じ流れで `scheduleFromDb` を呼ぶ。

### 既存 `notificationEnabled` フラグとの共存

移行後もしばらく `notificationEnabled: false` 時は全通知キャンセルする動作を維持する。新 UI で「すべてのスケジュールを無効化」スイッチを追加し、`notificationEnabled` フラグに対応させる。

### 最大件数の理由

iOS は 1 アプリあたりスケジュール通知を 64 件まで登録できる。曜日別登録で最大 7 件/スケジュールとなるため、5 スケジュール × 7 曜日 = 35 件で余裕を持たせる。

---

## 影響ファイル

| ファイル | 変更種別 |
|---|---|
| `lib/database/schema.ts` | `notification_schedules` テーブル追加（マイグレーション） |
| `lib/database/notifications.ts` | 新規作成 |
| `lib/notifications.ts` | `scheduleFromDb` / `cancelSchedule` 追加 |
| `store/settings.ts` または 新ストア | スケジュールキャッシュ管理 |
| `app/(tabs)/settings.tsx` | 通知セクションの UI 刷新 or リンク化 |
| `app/settings/notifications.tsx` | 新規作成（スケジュール管理画面） |
| `app/_layout.tsx` | AppState リスナー内で `scheduleFromDb` 呼び出し |
| `locales/ja.json` / `locales/en.json` | i18n キー追加 |

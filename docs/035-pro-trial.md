# 035 Pro 1週間体験（無料トライアル）

**フェーズ:** 未定（キーボード/無料版変更の次リリース以降）
**ステータス:** 実装中（Phase 0〜3 完了・v1.9.0-dev。残りは Phase 4: 実機確認のみ）
**依存:** 016（買い切り課金 `useProStore`）, 014（iCloud同期）, 025（FSRS カスタマイズ）, 028-2（カード表示テーマ）
**被依存:** なし
**料金区分:** 課金導線（無料ユーザーへの体験提供）

---

## 概要

無料版ユーザーが Paywall の「Pro を1週間体験」ボタンを押すと、**7日間だけ Pro のフル機能**（iCloud同期・カード表示テーマ・FSRS保持率カスタマイズ・詳細統計など）を使用できる。7日を過ぎると自動的に無料版へ戻る:

- iCloud へのアップロード/ダウンロードができなくなる（既にクラウドにあるデータは消さず、再Pro時に再開）。
- カード表示テーマは `default`（無料配色）へ、FSRS保持率は既定 90% へ戻る。
- **ユーザーの選好値（テーマ/保持率）は保持し、購入時に自動復元**する（消さない）。

### なぜ実装しやすいか（現状分析）

Pro機能はすべて `useProStore` の `isPro` を**実行時に動的参照**しているため、`isPro` を期限切れで false にするだけで大半が自動で無料状態へ戻る。3機能を確認済み:

| 機能                   | 現状の実装                                                                                                                 | 期限切れ時                | 改修             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------- |
| カードテーマ           | `lib/theme/index.ts` L234–237：`!isPro` かつ無料配色でなければ `default` にフォールバック。選好値は保持し再Pro時に自動復元 | 自動で戻る                | **不要**         |
| FSRS保持率             | `lib/fsrs.ts` `getRequestRetention()`：`!isPro` なら既定90%、Proなら設定値。毎回 `useProStore.getState().isPro` を参照     | 自動で戻る                | **不要**         |
| iCloud同期（設定画面） | `app/settings/sync.tsx` L391 `if (!isPro)` でガード                                                                        | 画面は自動でロック        | 不要             |
| iCloud同期（自動同期） | `app/_layout.tsx` L55–88：`syncEnabled`（`useSyncStore`）で起動。**isPro を見ていない**                                    | ⚠️ そのままだと走り続ける | **要ゲート追加** |

→ 実質の改修は「トライアル状態の管理・期限判定・Paywall UI・自動同期ゲート1箇所」に集約される。

---

## 決定事項（設計の方針）

- **体験期間は 7 日**（`TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000`）。
- **`isPro` は実効値にする。** `isPro = purchased || trialActive`。
  - `purchased` … RevenueCat の実エンタイトルメント（現状の `setIsPro` が入れている値）。
  - `trialActive` … `trialStartedAt != null && now < trialStartedAt + TRIAL_DURATION_MS`。
- **再トライアル対策は iCloud KV（`NSUbiquitousKeyValueStore`）。** 体験開始時刻（`trialStartedAt`）を iCloud キーバリューに保存し、**Apple ID ごとに再インストール後も1回だけ**に制限する。端末ローカル（AsyncStorage）にもキャッシュし、KV が読めない環境では暫定的にローカル判定へフォールバック。
- **Pro設定は期限切れでも消さない。** テーマ/FSRS保持率の選好値は保持し、無視するだけ（購入で自動復元）。
- **自動同期を実効Pro でゲートする。** `_layout` の自動同期起動条件に「実効Pro」を加える。期限切れ時は `syncEnabled` を false にする（＝設定UIのトグルもオフに見える）方針で統一。
- **クラウドデータは削除しない。** 期限切れ後もクラウドの DB コピーは残し、再Pro時に同期再開。
- **App Store 審査:** これは StoreKit のサブスク無料期間ではなく、**アプリ内フラグによる機能アンロック**。買い切り（非消耗型）とは別物として問題なく成立し、StoreKit 側の変更は不要。Paywall で「一度きりの7日間体験」であることを明示する。

### 留意点（優先度低・許容範囲）

- **時計の巻き戻しによる延長**：`lastSeenAt`（単調増加の最終確認時刻）を保存し、`now < lastSeenAt` を検知したら体験を無効化する簡易ガードで十分（本格的なサーバー検証はしない）。iCloud同期の時計スキュー対策（LWW）とは別管理。
- **KV が使えない状況**（iCloud 未ログイン等）：その端末ではローカル判定にフォールバック（再インストールで再体験の余地は残るが許容）。

---

## 影響範囲

- `store/pro.ts` … `purchased` / `trialStartedAt` / `trialActive` 追加、実効 `isPro` 算出、hydrate、期限再判定 API（`refreshTrial()`）。
- `lib/purchases.ts` … 実課金は `purchased` に入れる（`isPro` を直接立てない形へ整理）。
- `lib/proTrial.ts`（新規）… トライアル開始/判定ロジック＋iCloud KV 読み書き。
- ネイティブ：iCloud KV（`NSUbiquitousKeyValueStore`）アクセス手段（Expo Module 自作 or 既存ライブラリ）。`app.json`/entitlements に iCloud KV を追加（既存の iCloud Documents 同期とは別のキーバリューストア権限）。
- `app/paywall.tsx` … 「Proを1週間体験」ボタン、残り日数表示、体験済み/期限切れ表示、体験中バッジ。
- `app/_layout.tsx` … フォアグラウンド復帰時に `refreshTrial()`、自動同期起動条件へ実効Pro を追加。
- `app/settings/sync.tsx` ほか … 体験中は通常Pro同様に解放（`isPro` 実効値を見るので基本は自動）。
- locales（ja/en） … 体験ボタン/残り日数/期限切れ/体験済みの文言。

改修**不要**（動的ゲート済み）:

- `lib/theme/index.ts`（テーマフォールバック）
- `lib/fsrs.ts`（保持率フォールバック）
- `isPro` を参照する各画面（stats/search/deck 系など。実効 `isPro` を読むだけで自動追従）

---

## Todo（フェーズ別）

### Phase 0: 設計・ネイティブ手段確定

- [x] iCloud KV アクセス手段を確定 → **自作ローカル Expo Module（`modules/icloud-kv`）**。理由: ①`modules/background-task` で同方式のビルド実績あり（autolinking 動作済み）②API が極小（get/set/remove/サインイン判定の4関数）で自作コストが依存追加リスクを下回る ③新アーキ対応は Expo Modules API なら定義上保証される。Swift 本体＋遅延 `requireNativeModule` の TS ラッパー（未リンク環境で null 安全）
- [x] `app.json` の `ios.entitlements` に `com.apple.developer.ubiquity-kvstore-identifier`（`$(TeamIdentifierPrefix)$(CFBundleIdentifier)`）を追加。`expo config --type introspect` で既存 iCloud Documents 権限（container/services）と正しく合成されることを確認済み
- [x] Development Build（再ビルド）で読み書き PoC：**実機で合格（2026-07-10）**。write（sync受理=true）→ 完全再起動で同値 read → **アプリ削除→再インストール後も同値 read（1783677738366）**＝ Apple ID 単位で残ることを確認（再トライアル防止が成立）。PoC コード（`_layout` の `__DEV__` ログ）は確認後に削除済み
  - 落とし穴（解決済み）: `modules/` にローカル Expo Module を追加しても Podfile 自体は変わらないため `expo run:ios` が pod install をスキップし、**モジュール抜きのビルド**ができる（`linked=false`）。`npx pod-install` を明示実行してからビルドすること
- [x] 既存の iCloud Documents 同期と KV の共存：entitlements は introspect＋署名済みバイナリ（`codesign -d --entitlements`）で共存確認済み。KV は Documents 権限が同居するバイナリ上で正常動作した。DB 同期を実際に ON にした状態での動作は Phase 2/4 の確認に含める

### Phase 1: トライアル状態管理（コア）

- [x] `store/pro.ts` に `purchased` / `trialStartedAt` / `trialActive` を追加し、`isPro = purchased || trialActive` を算出。永続化キーは旧 `@codeflash_is_pro` を `purchased` として踏襲（従来 `setIsPro` が保存していたのは実エンタイトルメント＝purchased そのものなので既存ユーザーの値を引き継げる）
- [x] `lib/purchases.ts` を「実課金は `purchased` へ」に整理（`setIsPro` → `setPurchased`。設定タブの `__DEV__` 長押しトグルも `purchased` を反転する形へ変更）
- [x] `lib/proTrial.ts` 新規：`startTrial()` / `refreshTrial()` / `getTrialRemainingMs()`。KV（`proTrialStartedAt`）を真実・AsyncStorage（`@codeflash_trial_started_at`）をキャッシュ兼フォールバックとし、`refreshTrial()` で双方向 repair（KV→ローカル反映／ローカルのみ開始→KV 復帰時に書き戻し）。トライアルキーは `lib/settings-keys.ts`（JSONエクスポート対象）へ**意図的に入れない**（バックアップ書き戻しで体験状態を改変できてしまうため）
- [x] 再トライアル防止：`startTrial()` 冒頭で `refreshTrial()` を呼び、KV/ローカルいずれかに `trialStartedAt` があれば `'alreadyUsed'` で拒否
- [x] 時計巻き戻しガード：`@codeflash_trial_last_seen_at`（単調増加）＋逆行検知（許容幅5分・NTP補正の誤検知防止）で `@codeflash_trial_invalidated` を立てて恒久無効化。`startedAt` が未来のケースも同様に無効化
- [x] 起動時・フォアグラウンド復帰時（`_layout` の専用 useEffect + AppState listener）に `refreshTrial()` を呼び、期限跨ぎで `isPro` を false に反映
- 動作確認は Phase 2/4 でまとめて実施（この時点では `startTrial()` を呼ぶ UI がまだ無い）

### Phase 2: 機能ゲート（同期のみ改修）

- [x] `app/_layout.tsx` の自動同期起動条件に実効Pro判定を追加（`!isPro` ならリスナー自体を張らない）。加えて `syncEngine.ts` の自動経路2本（`runForegroundSync`／`triggerBackgroundUpload`）の冒頭ガードにも `!isPro` チェックを追加＝期限切れ境界のレース（AppState 発火順で refreshTrial より先に同期が走る）も塞ぐ。手動同期は設定画面の Pro ロックが担うため自動経路のみ
- [x] 期限切れ時に `syncEnabled` を false に：`refreshTrial()` 末尾で「体験記録あり＆非アクティブ＆未購入」なら `setEnabled(false)`（設定トグル表示と実挙動を無料状態に整合・クラウドデータは消さない）。**pro/sync 両ストアの hydrated ガード必須**（hydrate 前は purchased が false に見え、購入済みユーザーの同期を誤ってオフにするため）
- [ ] 期限切れでテーマ→`default`、FSRS→90% に戻ることを確認（改修不要だが回帰確認・実機は Phase 4 でまとめて）
- [ ] クラウドデータを削除しないこと・再Pro/再体験なしで同期再開しないことを確認（実機は Phase 4 でまとめて）

### Phase 3: Paywall UI

- [x] 「Proを1週間体験」ボタン（未体験時のみ活性）：購入ボタンの下にアウトラインボタンで配置。タップ→ `ConfirmModal` で「一度きり」を明示して確認（App Store 審査対策も兼ねる。確定操作なので Return は割り当てない）→ `startTrial()`。開始成功で InfoModal→閉じると paywall も閉じる。`alreadyUsed`（別端末・再インストール前の記録を KV で検出）なら通知し、ボタンは store 更新で「体験済み」表示へ自動追従
- [x] 体験中：残り日数バッジ（`time-outline`＋「体験中：残り N 日」・`ceil` で最低1日表示）＋購入導線（購入・復元ボタンは体験中も表示し続ける）。paywall の出し分けは実効 `isPro` ではなく **`purchased` で分岐**（トライアル中に「すでに Pro」と誤表示しない）
- [x] 体験済み/期限切れ：体験ボタンを無効化（opacity 0.4）し「体験済み」表示＋購入案内ヒント＋購入導線
- [x] locales（ja/en）：`pro.trialButton / trialUsed / trialUsedHint / trialRemaining（en は _one 併設）/ trialConfirmTitle / trialConfirmMessage / trialConfirmAction / trialStarted / trialAlreadyUsed`
- [x] （追加）設定タブの Pro カード：導線判定を `purchased` に変更（トライアル中もタップで paywall を開ける＝購入導線を塞がない）。サブタイトルは購入済み=「すでに Pro」／体験中=残り日数／無料=誘導文の3分岐。Pro バッジは実効 `isPro`（体験中も表示）
- [x] （追加・開発用）`resetTrialForDev()`（`__DEV__` 限定）：**paywall の PRO バッジ長押し**でトライアル記録を全消去（Phase 4 の時計操作テストのやり直しに必須）。iCloud KV は `removeObject` だと時計操作中に同期が切れてサーバー旧値が復元されうるため、**無効値 `'0'` の上書き（tombstone・`parseTimestamp` が null 扱い）**でリセットする。診断表示（write/KV/local/iCloud）付き。※**設定タブ Pro カードの長押しは別機能（`purchased` トグル）**なので混同注意
- [x] 実機確認（2026-07-11）：未体験表示→確認モーダル→開始→体験中バッジ→設定カード残り日数→Pro機能解放→DEVリセットで未体験へ復帰、まで確認済み

### Phase 4: 確認

- [ ] 開始→7日経過（時計操作）で全Pro機能が無料へ戻ることを実機確認
- [ ] 再インストール後に再体験できない（iCloud KV）ことを実機確認
- [ ] 期限切れ→購入でテーマ/FSRS選好値が自動復元されることを確認
- [ ] iCloud 未ログイン端末でのフォールバック挙動を確認

---

## 参考

- Pro 判定の唯一の入口：`store/pro.ts` `useProStore.isPro`
- テーマフォールバック：`lib/theme/index.ts`（`FREE_CARD_THEMES` 以外は `!isPro` で `default`）
- FSRS フォールバック：`lib/fsrs.ts` `getRequestRetention()`
- 自動同期の起点：`app/_layout.tsx`（`syncEnabled` 連動、`triggerForegroundSync` / `triggerBackgroundUpload`）
- 課金：`lib/purchases.ts`（RevenueCat エンタイトルメント）

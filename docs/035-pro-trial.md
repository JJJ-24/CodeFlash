# 035 Pro 1週間体験（無料トライアル）

**フェーズ:** 未定（キーボード/無料版変更の次リリース以降）
**ステータス:** 未着手（設計検討済み・本チケットで実装計画を確定）
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

- [ ] `store/pro.ts` に `purchased` / `trialStartedAt` / `trialActive` を追加し、`isPro = purchased || trialActive` を算出
- [ ] `lib/purchases.ts` を「実課金は `purchased` へ」に整理（`isPro` を直接立てない）
- [ ] `lib/proTrial.ts` 新規：`startTrial()` / `refreshTrial()` / `getTrialRemainingMs()`、iCloud KV への `trialStartedAt` 保存・読込＋ローカルキャッシュ
- [ ] 再トライアル防止：KV に既存の `trialStartedAt` があれば `startTrial()` を拒否（体験済み判定）
- [ ] 時計巻き戻しガード：`lastSeenAt` 保存＋逆行検知で体験無効化
- [ ] 起動時・フォアグラウンド復帰時（`_layout`）に `refreshTrial()` を呼び、期限跨ぎで `isPro` を false に反映

### Phase 2: 機能ゲート（同期のみ改修）

- [ ] `app/_layout.tsx` の自動同期起動条件に実効Pro判定を追加（期限切れで停止）
- [ ] 期限切れ時に `syncEnabled` を false にし、設定トグルの表示も無料状態に整合
- [ ] 期限切れでテーマ→`default`、FSRS→90% に戻ることを確認（改修不要だが回帰確認）
- [ ] クラウドデータを削除しないこと・再Pro/再体験なしで同期再開しないことを確認

### Phase 3: Paywall UI

- [ ] 「Proを1週間体験」ボタン（未体験時のみ活性）
- [ ] 体験中：残り日数バッジ＋購入導線（体験中も購入可能）
- [ ] 体験済み/期限切れ：ボタンを無効化し「体験済み」表示＋購入導線
- [ ] locales（ja/en）：体験ボタン・残り日数・体験済み・期限切れの文言

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

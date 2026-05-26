# 014 クラウド同期

**フェーズ:** v1.1
**ステータス:** 未着手（方式仮決定：`@oleg_svetlichnyi/expo-icloud-storage` で SQLite ファイル同期）
**依存:** 001, 002, 003, 004
**被依存:** 016

---

## 概要

複数デバイス間でデータを同期する。実装方式は未決定。

---

## 方針検討メモ（2026-05-11）

### 選択肢

**A) iCloud 同期（CloudKit）**
- Apple ID のみで完結、追加アカウント不要
- iOS / Mac 専用（Android 非対応）
- 利用可能ライブラリがいずれも新しく実績なし（`expo-cloudkit`・`react-native-icloud-kit`）
- 実装リスク高

**B) Supabase / Firebase**
- iOS・Android・Web クロスプラットフォーム対応
- リアルタイム同期可能
- ユーザーにアプリ専用アカウント登録が必要
- ライブラリ成熟・実績豊富
- 実装リスク低
- **運用コスト発生**（ユーザー数増加で課金）→ 買い切りモデルと相性が悪い

**C) expo-cloudkit（DevLab-Innovations）**
- 新アーキテクチャ対応・CKRecord フル対応・Config Plugin あり
- 2026年3月公開と新しく Stars=0、API 不安定
- 今後の成熟を待って再評価

### 現状の判断
方式未決定のため実装を保留。`expo-cloudkit` の成熟度を継続観察しつつ、Supabase との比較で最終決定する。

---

## 追加調査メモ（2026-05-13）

### 各ライブラリの最新状況

| ライブラリ | Stars | 状態 | 特徴 |
|----|----|----|----|
| `expo-cloudkit` | 0 | 207コミット・継続開発中 | CKRecord フル対応・CKAsset で画像対応・iOS17+ で CKSyncEngine 自動同期 |
| `react-native-icloud-kit` | 3 | 11コミット・実績乏しい | データ型が `string\|number\|null` のみ・画像非対応 |
| `okwasniewski/expo-icloud-storage` | – | KVS ラッパー | 1MB 制限・設定値のみ・本用途には不適 |
| `@oleg_svetlichnyi/expo-icloud-storage` | – | iCloud Drive ファイル操作 | 任意ファイルのアップロード/ダウンロード可能・**画像対応** |
| `kuatsu/react-native-cloud-storage` | 167 | 中規模採用 | iCloud + Google Drive 両対応 |

### 推奨案：`@oleg_svetlichnyi/expo-icloud-storage` を使った SQLite ファイル同期

CloudKit のレコード単位同期ではなく、**SQLite ファイルをまるごと iCloud Drive にアップロード/ダウンロード**する方式。

#### 仕組み

```
[アプリの責務]                       [iCloud Drive の責務]
ローカル codeflash.db 更新
       ↓
端末A: アップロード（手動 or 自動トリガー） → iCloud Drive → Apple が全端末に複製
                                              ↑
端末B: アプリ起動時にダウンロード ←─────────┘
```

- iCloud Drive **自体は自動同期**（Apple のインフラがファイルを全端末に配信）
- アプリ側のアップロード/ダウンロードのタイミングは自分で実装
  - 推奨：アプリ起動時、バックグラウンド移行時、手動ボタン
  - 「変更のたびに即アップロード」は通信過多なので避ける
- 体感：**準リアルタイム（数秒〜数十秒遅延）**

#### 同期対象

| データ | 方法 |
|----|----|
| SQLite DB ファイル（`codeflash.db`） | iCloud Drive にアップロード |
| 画像ファイル（`documentDirectory/images/`） | 同ライブラリで個別アップロード |

#### iCloud entitlements 設定

1. **Apple Developer アカウント**
   - iCloud Container を作成（例：`iCloud.com.yourdomain.codeflash`）
   - App ID に iCloud capability を追加
2. **アプリ側（app.json）**
   - ライブラリの Config Plugin で自動設定
   ```json
   "plugins": [
     ["@oleg_svetlichnyi/expo-icloud-storage", {
       "iCloudContainerEnvironment": "Production"
     }]
   ]
   ```
3. Expo Go 非対応 → Development Build 必須（016 で構築済み）

#### iCloud 容量の使用量（ユーザー負担）

- SQLite DB ファイル：数百KB〜数MB（数千枚カードでも軽量）
- 画像ファイル：1枚あたり 100KB〜数MB
- 合計目安：**10〜100MB**（画像を多用しない限り）
- Apple 無料枠 5GB なので通常は問題なし

#### メリット・デメリット

**メリット**
- 実装がシンプル（CloudKit レコード分割不要）
- ライブラリ1本で完結
- 開発者の運用コスト ゼロ（Apple インフラ任せ）

**デメリット**
- リアルタイム同期不可（準リアルタイム）
- 両端末で同時編集すると競合（後勝ち＝直前の変更が失われる）
- iOS / Mac のみ（Android・Web 非対応）

### 既存の JSON エクスポート/インポートとの違い

**機能的にはほぼ同じ**だが UX が大幅に異なる：
- JSON エクスポート → 手動5〜7タップ（共有→保存→別端末で選択→インポート→マージ/置換）
- iCloud 同期 → ワンタップ or 自動

「同期を意識せず複数端末で使える」体験が Pro 機能としての訴求ポイント。

---

## Todo（SQLite ファイル同期方式）

### 環境構築
- [ ] Apple Developer Console で iCloud Container 作成（例：`iCloud.com.yourdomain.codeflash`）
- [ ] App ID に iCloud capability を追加
- [ ] `@oleg_svetlichnyi/expo-icloud-storage` をインストール
- [ ] `app.json` に Config Plugin 設定追加（iCloudContainerEnvironment）
- [ ] Development Build 再ビルド（`eas build` で entitlements 反映）
- [ ] 実機 / TestFlight で動作確認（シミュレーター・Expo Go は不可）

### 同期ロジック実装（`lib/sync/`）
- [ ] `lib/sync/icloud.ts` — ライブラリのラッパー（upload/download/list/delete）
- [ ] DB ファイル同期：
  - [ ] アップロード前に SQLite を `closeAsync()` で閉じる
  - [ ] アップロード後に `SQLiteProvider` 経由で再オープン → Zustand ストア全リフレッシュ
  - [ ] ダウンロード後の DB 差し替え時も同様の close/swap/open 手順
- [x] 画像ファイル同期：
  - [x] `documentDirectory/images/` 配下のファイルを iCloud Drive に追従（リモート `Images/` フォルダへ add-only。ファイル名一意・内容不変なので上書きせず追加のみ）
  - [x] ローカルにない画像のダウンロード（DL 復元後、新 DB が参照する未取得画像を取得。best-effort）
  - [x] 不要画像のクリーンアップ（ローカルは `cleanupOrphanImages` で DL 後に掃除。リモートはアップロード時、meta コミット後に最新 DB が参照しない画像を `pruneRemoteImages` で削除）
- [ ] 競合解決：last-write-wins
  - [ ] DB に `lastSyncedAt`・`deviceUpdatedAt` メタデータ追加
  - [ ] アップロード前にリモートの更新日時を確認し、ローカルが古ければマージ確認ダイアログ
- [ ] 同期状態の管理：`store/sync.ts`（idle / syncing / error / lastSyncedAt）

### 同期トリガー
- [ ] アプリ起動時の自動ダウンロード（リモート > ローカルなら反映）
- [ ] バックグラウンド移行時の自動アップロード（AppState change で発火）
- [ ] 設定画面の手動同期ボタン
- [ ] 同期中の UI 表示（ヘッダーにスピナー等）

### Pro ゲーティング（016 チケット連携）
- [ ] 設定画面の「クラウド同期」項目を Pro 限定に
- [ ] 無料版ユーザーがタップしたら paywall へ遷移
- [ ] `useProStore` で gating

### 設定画面（`app/(tabs)/settings.tsx`）
- [x] 同期 ON/OFF トグル（`store/sync.ts` に enabled・AsyncStorage 永続化）
- [x] 最終同期日時表示
- [x] 手動同期ボタン
- [x] iCloud アカウント未ログイン時の警告表示（unavailable エラーをインライン＋モーダル表示）
- [x] iCloud 容量不足時のエラー表示（storageFull）

### エラーハンドリング
- [x] iCloud 未ログイン時の検知と案内（`ICloudUnavailableError` → code `unavailable`）
- [x] iCloud 容量不足時の案内（ネイティブ文言ヒューリスティック → code `storageFull`）
- [x] ネットワーク切断時のリトライ（転送 `withTimeout` でタイムアウト→`syncTimeout` 表示。明示的リトライループは持たず、次回フォアグラウンドの自動同期で再試行＝シンプル方針）
- [x] アップロード中にアプリ終了されたケースの対応（meta=コミット標識設計。DB だけ／meta 無しの不完全リモートは `getRemoteStatus` が無効扱い＝古いまま破壊しない）
- エラーは store に**コード**（`SyncErrorCode`）で保持し UI で i18n 翻訳（`syncErrorText`）。`toSyncErrorCode` がエラー→コード正規化。

### i18n
- [x] 同期関連テキストの翻訳キー追加（ja.json / en.json）
  - 同期中・最終同期・手動同期・エラーメッセージ（`syncTimeout`・`storageFull` 追加）・Pro 限定案内 等

### テスト
- [ ] 2端末で同じ Apple ID でログインし、双方向同期の動作確認
- [ ] 競合シナリオ（両端末オフラインで編集 → 同時オンライン復帰）の挙動確認
- [ ] 大量データ（1000カード以上 + 画像複数）でのパフォーマンス確認
- [ ] iCloud OFF → ON 切替時の初回アップロード確認

---

## 技術メモ

- ライブラリは Expo Go 非対応 → Development Build 必須（016 で構築済み）
- Pro 機能（016 チケット）として提供
- SQLite ファイルは `useSQLiteContext()` が掴んでいる間は差し替え不可 → 同期処理は専用ハンドラで安全に close/open する
- 差分同期は採用しない（ファイル丸ごと同期）→ 競合は last-write-wins で割り切る
- Android 対応が必要になった場合は Supabase/Firebase へ移行を検討（その時点で再評価）

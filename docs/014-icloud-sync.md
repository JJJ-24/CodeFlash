# 014 クラウド同期

**フェーズ:** v1.1
**ステータス:** 保留（方針検討中）
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

## Todo（方式決定後に更新）

### 共通
- [ ] 同期方式の最終決定（iCloud vs Supabase/Firebase）
- [ ] ライブラリ選定・インストール
- [ ] 同期ロジック実装（Deck, Card, Tag, CardTag, Review）
- [ ] last-write-wins コンフリクト解決（updatedAt 比較）
- [ ] 差分同期
- [ ] オフライン対応

### 設定画面
- [ ] 同期 ON/OFF 設定
- [ ] 最終同期日時表示
- [ ] 手動同期ボタン

### i18n
- [ ] 同期関連テキストの翻訳キー追加

---

## 技術メモ

- CloudKit は Expo Go では動作しない → Development Build 必須（016 で構築済み）
- Pro 機能（016 チケット）として提供

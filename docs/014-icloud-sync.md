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

**C) expo-cloudkit（DevLab-Innovations）**
- 新アーキテクチャ対応・CKRecord フル対応・Config Plugin あり
- 2026年3月公開と新しく Stars=0、API 不安定
- 今後の成熟を待って再評価

### 現状の判断
方式未決定のため実装を保留。`expo-cloudkit` の成熟度を継続観察しつつ、Supabase との比較で最終決定する。

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

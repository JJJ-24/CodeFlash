# 016 買い切り課金

**フェーズ:** v1.1
**ステータス:** 進行中
**依存:** 007, 012, 013
**被依存:** 017

---

## 概要

買い切りの Pro プランを実装する。無料版と Pro 版の機能制限を管理し、App Store / Google Play での課金を処理する。

---

## Todo

### 課金基盤
- [x] `react-native-purchases`（RevenueCat）の選定・インストール
- [x] `lib/purchases.ts` — RevenueCat ラッパー（初期化・購入・リストア・ステータス取得）
- [ ] App Store Connect でのアプリ内課金設定（非消耗型）
- [ ] Google Play Console でのアプリ内課金設定
- [x] 購入処理の実装（purchasePro）
- [x] リストア購入の実装（restorePurchases）
- [ ] レシート検証（RevenueCat 経由で自動処理）
- [ ] lib/purchases.ts の API キーを本番キーに差し替え（APPLE_API_KEY / GOOGLE_API_KEY）

### Pro 機能ゲーティング
- [x] `useProStore` — Pro ステータス管理（Zustand + AsyncStorage）
- [ ] 無料版制限の実装:
  - [~] デッキ上限：制限なし（無料で無制限）
  - [~] カード上限：制限なし（無料で無制限）
  - [ ] JS・TS・Python実行のみ（SQL・C++はPro）
  - [ ] iCloud同期無効
  - [~] 全画面モード：制限なし（無料で使用可）
  - [ ] Web版無効

### ペイウォール UI
- [x] `app/paywall.tsx` — 購入画面
  - [x] 無料版 vs Pro 機能比較表
  - [x] 価格表示（RevenueCat から動的取得）
  - [x] 購入ボタン
  - [x] リストアボタン
  - [x] 利用規約・プライバシーポリシーリンク
- [x] Pro バッジ表示（設定画面に「CodeFlash Pro」カード + バッジ追加）

### i18n
- [x] 課金関連テキストの翻訳キー追加（ja.json / en.json）

---

## 技術メモ

- RevenueCat 推奨（クロスプラットフォーム対応・レシート検証内蔵）
- アプリ内購入はシミュレーター非対応 → TestFlight / 実機テスト必須
- 想定価格: ¥980〜¥1,480

# 017 App Store / Google Play 申請

**フェーズ:** v1.1
**ステータス:** 未着手
**依存:** 016
**被依存:** なし

---

## 概要

App Store（iOS）および Google Play（Android）へのストア申請準備から公開までを行う。

---

## Todo

### アセット準備
- [x] アプリアイコン（1024x1024 PNG）
- [x] スプラッシュスクリーン
- [x] App Store スクリーンショット（iPhone 6.7", 6.5", 5.5"）
- [x] iPad スクリーンショット（Pro 12.9"）
- [ ] Google Play スクリーンショット（スマートフォン / タブレット）
- [ ] プロモーション用グラフィック（Google Play: 1024x500）

### App Store 申請
- [x] `app.json` の bundle identifier 確認（`codeflashcard`）
- [x] EAS Build の iOS プロダクションビルド設定
- [x] App Store Connect アプリ登録
- [x] アプリ説明文（日本語・英語）
- [x] キーワード設定
- [x] プライバシーポリシー URL
- [x] 利用規約 URL
- [x] TestFlight での内部テスト
- [x] App Store 審査提出

### Google Play 申請
- [ ] EAS Build の Android プロダクションビルド設定
- [ ] Google Play Console アプリ登録
- [ ] APK / AAB アップロード
- [ ] ストアページ設定（説明文・スクリーンショット）
- [ ] 内部テストトラックでのテスト
- [ ] 審査提出

### 共通
- [x] プライバシーポリシーページ作成（Web）
- [x] 利用規約ページ作成（Web）
- [x] サポートページ / FAQ 作成
- [ ] EAS Update の設定（OTA アップデート用）

---

## 技術メモ

- iOS 審査は通常1〜3日、rejectionリスクはコード実行機能（WebView サンドボックス）
- Google Play 審査は通常1〜7日
- EAS Build: `eas build --platform all --profile production`

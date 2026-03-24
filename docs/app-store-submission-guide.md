# App Store 申請ガイド

## 概要

このドキュメントは、Expo (EAS Build) を使った App Store 申請の手順をまとめたものです。
**Apple Developer Program の登録は年1回のみ。新規アプリごとには不要。**

---

## 初回のみ必要な作業

### 1. Apple Developer Program 登録（年1回・¥13,800）

1. [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/) にアクセス
2. Apple ID でサインイン
3. 「個人（Individual）」を選択
4. 利用規約に同意・支払い完了
5. 「Apple Developer Program へようこそ」メールが届いたら完了
   - 購入完了から数時間かかる場合あり

### 2. EAS CLI インストール（マシンごとに1回）

```bash
npm install -g eas-cli
eas --version   # バージョン確認
eas login       # Expo アカウントでログイン
```

---

## 新規アプリの申請手順

### Step 1: app.json の設定

```json
{
  "expo": {
    "name": "アプリ表示名",
    "slug": "app-slug",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "com.yourname.appname",
      "buildNumber": "1"
    }
  }
}
```

- `bundleIdentifier`: `com.開発者名.アプリ名` の形式（英数字・ドットのみ）
- `buildNumber`: ビルドごとに増やす番号（EAS では `autoIncrement: true` で自動化可能）

### Step 2: EAS プロジェクト初期化

```bash
eas init              # Expo プロジェクトと紐付け（app.json に projectId が追加される）
eas build:configure   # eas.json を生成（プラットフォームは iOS を選択）
```

生成される `eas.json` の例:
```json
{
  "cli": {
    "version": ">= 18.4.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {}
  }
}
```

### Step 3: App Store Connect でアプリ登録

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) にアクセス
2. 「マイ App」→「＋」→「新規 App」
3. 以下を入力：

| 項目 | 例 |
|------|-----|
| プラットフォーム | iOS |
| 名前 | CodeFlash |
| 主要言語 | 日本語 |
| バンドル ID | com.jjj24.codeflash |
| SKU | codeflash（任意の一意な文字列） |
| ユーザーアクセス | フルアクセス |

### Step 4: アセット準備

App Store 申請に必要なスクリーンショット：

| デバイス | サイズ | 必須 |
|----------|--------|------|
| iPhone 6.7" (iPhone 15 Pro Max等) | 1290 × 2796 px | ✅ 必須 |
| iPhone 6.5" (iPhone 14 Plus等) | 1242 × 2688 px | 推奨 |
| iPhone 5.5" (iPhone 8 Plus等) | 1242 × 2208 px | 推奨 |
| iPad Pro 12.9" | 2048 × 2732 px | タブレット対応の場合 |

- 各サイズ最低1枚・最大10枚
- シミュレーターのスクリーンショットでも可

### Step 5: プロダクションビルド

```bash
eas build --platform ios --profile production
```

- EAS のクラウド上でビルドが実行される（ローカルの Mac 環境不要）
- 完了まで15〜30分程度
- ビルド完了後、EAS ダッシュボードまたはメールで通知

### Step 6: TestFlight で内部テスト

```bash
eas submit --platform ios --profile production
```

または App Store Connect からビルドを選択して TestFlight に追加。
内部テスター（自分）でインストール・動作確認。

### Step 7: App Store 審査提出

App Store Connect で以下を設定してから「審査へ提出」：

- [ ] スクリーンショット
- [ ] アプリ説明文（日本語・英語）
- [ ] キーワード（100文字以内）
- [ ] サポート URL
- [ ] プライバシーポリシー URL
- [ ] 年齢制限設定
- [ ] 価格設定（無料 or 有料）
- [ ] 審査に関する注意事項（コード実行機能がある場合は説明を添付）

審査期間：通常 1〜3 日

---

## 2回目以降のアップデート申請

```bash
# バージョンを上げる（app.json の version を更新）
# eas.json の autoIncrement: true により buildNumber は自動増加

eas build --platform ios --profile production
eas submit --platform ios --profile production
```

App Store Connect で新しいビルドを選択して審査提出。

---

## このアプリ固有の情報

| 項目 | 値 |
|------|-----|
| アプリ名 | CodeFlash |
| Bundle ID | com.jjj24.codeflash |
| Expo Project ID | b5f52568-524c-4fda-b674-fe895cb21a14 |
| Expo Owner | jjj24 |
| 初回 buildNumber | 1 |

---

## 注意事項

- **コード実行機能について**: WebView サンドボックスでのコード実行は審査で引っかかる可能性がある。審査メモに「ユーザーが入力したコードをサンドボックス内で実行する教育目的の機能」と説明を記載すること
- **シミュレーター vs 実機**: TestFlight でのテストは実機が必要
- **プライバシーポリシー**: App Store 申請には URL が必須。GitHub Pages 等で公開するのが最も手軽

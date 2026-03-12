# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイドです。

## コマンド

```bash
# 開発サーバーを起動（iOS / Android / Web の選択肢が表示される）
npm start

# プラットフォーム別に起動
npm run ios
npm run android
npm run web

# リント（コードチェック）
npm run lint
```

テストフレームワークはまだ設定されていません。

## アーキテクチャ

**Expo Router** を使ったアプリで、**ファイルベースのルーティング**を採用しています。エントリーポイントは `expo-router/entry`（`package.json` に設定）。

- `app/` — 画面とレイアウト。ファイルがそのままルートに対応する。`_layout.tsx` はナビゲーションのラッパー（現在は `<Stack />` のみ）。
- `app/index.tsx` — ホーム画面（現在は空の状態）。
- `app-example/` — Expo テンプレートの元コード（参照用。アクティブなアプリには含まれない）。
- `assets/images/` — 静的な画像ファイル。

**主要な設定:**
- `app.json`: スラッグ・スキームは `codeflashcard`、新アーキテクチャ有効（`newArchEnabled: true`）、型付きルートと React Compiler の実験的機能も有効。
- `tsconfig.json`: strictモード、パスエイリアス `@/*` がリポジトリルートに対応。
- VSCode: 保存時に ESLint 自動修正とインポート整理が実行される。

**技術スタック:** React Native 0.81 / React 19 / Expo 54 / expo-router 6。アニメーションに react-native-reanimated、ジェスチャー操作に react-native-gesture-handler が利用可能。

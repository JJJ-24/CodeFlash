# CodeFlash プロジェクトメモリ

## 完了チケット
- 001: プロジェクト基盤（DB schema, i18n, タブナビ）
- 002: デッキ管理 CRUD
- 003: カード管理 CRUD
- 004: タグ管理（lib/database/tags.ts, store/tags.ts, app/tags/index.tsx）
- 005: カードエディタ（components/editor/BlockEditor.tsx, TextBlockItem, CodeBlockItem, TagSelector）
- 006: SM-2アルゴリズム（lib/sm2.ts, lib/database/reviews.ts, store/reviews.ts）

## 主要ファイル構成
- `lib/database/decks.ts` — デッキCRUD
- `lib/database/cards.ts` — カードCRUD（JSON serialize/deserialize含む）
- `store/decks.ts` — Zustand デッキストア（useDeckStore）
- `store/cards.ts` — Zustand カードストア（useCardStore）
- `types/index.ts` — 全ドメイン型定義（Block, Card, Deck, Tag, Review）
- `locales/ja.json`, `locales/en.json` — i18n翻訳

## パターン・規約
- Zustand ストアは `store/` 直下（`lib/store/` ではない）
- DB関数は `lib/database/<entity>.ts` に分離
- 画面は `app/deck/[id]/` 配下のファイルベースルーティング
- モーダル画面は `app/_layout.tsx` に `presentation: 'modal'` で登録
- generateId() は各 DB ファイル内にコピー（共通化なし）
- SQLite の foreign_keys pragma は未設定 → deleteCard では明示的に card_tags/reviews を削除

- 007: 学習画面（hooks/useStudySession.ts, components/study/*, app/study/session.tsx）
- 012: 統計画面（app/(tabs)/stats.tsx, lib/database/reviews.ts に集計関数追加）

## 013 完了（ダークモード全画面 + 手動切替）
- `lib/theme/index.ts` — useTheme()はuseThemeStoreのpreferenceを優先、systemはuseColorSchemeにフォールバック
- `store/theme.ts` — useThemeStore（preference: 'light'|'dark'|'system'、AsyncStorage永続化、起動時hydrate）
- `@react-native-async-storage/async-storage` インストール済み（Expo 54対応版）
- 適用済み全画面: タブ4画面 + タブバー + ヘッダー + deck/new + deck/edit + deck/detail + tags + Stack + カードエディタ + 学習セッション
- 設定画面（app/(tabs)/settings.tsx）にライト/ダーク/システム の3択セグメントUI追加
- i18n追加: settings.theme / settings.themeLight / settings.themeDark / settings.themeSystem（ja/en両方）
- 残タスク: フォントサイズ変更（後回し推奨）

## 解決済みバグ
- [project_ipad_header_height.md](project_ipad_header_height.md) — iPad 学習画面ヘッダー高さ変化（解決済み: headerShown:false + インラインヘッダー + animation:'fade' in _layout.tsx）

## Pro プラン方針
- [project_pro_policy.md](project_pro_policy.md) — デッキ/カード/全画面は無料。Pro対象は未実装の拡張機能のみ
- [project_pro_features.md](project_pro_features.md) — Pro 予定機能リスト（014/015/018/020/024/025/026）

## 次のステップ
- チケット016 課金実装進行中（ペイウォール機能リスト修正・設定画面 Pro バッジ追加）
- 017 App Store 申請進行中 → [project_app_store.md](project_app_store.md)
- [project_border_colors.md](project_border_colors.md) — コードブロック枠線色の実装状況（未完了課題あり）
- [project_study_run_shortcut_bug.md](project_study_run_shortcut_bug.md) — 編集→実行後ショートカット無効バグ（解決済み: handleForceKeyboardFocus で switchingCodeBlockRef ガードを迂回）

## フィードバック・作業スタイル
- [feedback_edit_screen_consistency.md](feedback_edit_screen_consistency.md) — デッキ/カード/タグの編集・新規作成画面は文字サイズ・実装パターンを統一する
- [feedback_language.md](feedback_language.md) — 変更内容サマリーと動作確認方法は日本語で記述する
- [feedback_nesatable_scroll_measure.md](feedback_nesatable_scroll_measure.md) — NestableDraggableFlatList 内での位置計測は measureLayout を使う。FlipCard の 3D transform により iOS の自動スクロールが機能しないため、コードブロック編集開始時は BlocksView.handleEditRequest で 300ms 後に手動 scrollTo する
- [feedback_cleanup_after_retry.md](feedback_cleanup_after_retry.md) — 複数回試行後に正解に辿り着いたら、失敗試行の残骸コードをその場で削除する
- [feedback_sort_mode_ux.md](feedback_sort_mode_ux.md) — BlockEditor 並び替えはドラッグ廃止・↑↓ボタン方式。LayoutAnimation は新アーキテクチャ非対応。flashTrigger は boolean でなく number パターンで使う
- [feedback_navigation_bar_tint.md](feedback_navigation_bar_tint.md) — iOS push 遷移時のダークモード白線の解決策（GestureHandlerRootView backgroundColor）
- [feedback_appearance_setcolorscheme.md](feedback_appearance_setcolorscheme.md) — アプリテーマ≠端末テーマ時のヘッダーボタングレー点滅は Appearance.setColorScheme() + ThemeProvider で解決済み
- [feedback_i18n_both_languages.md](feedback_i18n_both_languages.md) — ja.json を変更したら en.json も必ずセットで見直す
- [feedback_ipad_keyboard_accessory.md](feedback_ipad_keyboard_accessory.md) — hidden TextInputには showSoftInputOnFocus={false} + disableKeyboardShortcuts={true} をセットで設定（InputAccessoryViewはNG）

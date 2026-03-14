# 008 全画面モード＋Bluetoothキーボード

**フェーズ:** v1.0
**ステータス:** 完了
**依存:** 007

---

## 概要

学習セッション画面に全画面モードと Bluetooth キーボードショートカットを追加する。
iPad + 物理キーボード環境での学習効率を最大化する。

---

## Todo

### 全画面モードUI
- [x] 全画面切替ボタン（カードエリア左上、`expand-outline` アイコン）— `app/study/session.tsx`
- [x] 全画面時はヘッダー非表示（`headerShown: false`）・StatusBar hidden
- [x] 全画面終了ボタン（左上固定、`contract-outline` アイコン）
- [x] 全画面時もタップ（Pressable）でカード裏返し可能
- [x] 全画面時も採点ボタン（グレードボタン行）を下部に表示
- [x] 全画面時もメモ表示/非表示トグルを維持

### Bluetoothキーボード操作
- [x] 非表示 TextInput でキーイベントをキャプチャ（`position: absolute, opacity: 0`）
- [x] `showSoftInputOnFocus={false}` でソフトキーボードを抑制
- [x] `onBlur={() => keyboardRef.current?.focus()}` でフォーカスを常時維持
- [x] `keyboardShortcutsEnabled` フラグで機能 ON/OFF（設定画面から制御）
- [x] `Space` — カードフリップ（表↔裏）
- [x] `1` / `2` / `3` / `4` — 採点（もう一度 / 難しい / 普通 / 簡単）
- [ ] `J` (または `ArrowRight`) — 次のカードへスキップ（評価なし）
- [ ] `K` (または `ArrowLeft`) — 前のカードに戻る
- [x] `M` — メモ表示/非表示（裏面表示中のみ有効）
- [x] `F` — 全画面モード切替

### 完了画面のEnter / Escapeキー対応
- [x] 学習完了時に専用の `completeRef`（別 TextInput）を用意 — `app/study/session.tsx`
- [x] `completed` が true になったら 100ms 後に `completeRef.current?.focus()` を呼び出し（iOS の `autoFocus` 競合を回避）
- [x] `completeReadyRef` フラグを導入し、マウント直後の誤ナビゲーションを防止（フォーカス確立後 200ms でアーム）
- [x] `Enter` キー — `onKeyPress` で検知 → `router.back()`
- [x] `Escape` キー — iOS では `onKeyPress` が発火しないため `onBlur` で検知 → `router.back()`

### 設定
- [x] `store/settings.ts` — `useSettingsStore`（Zustand + AsyncStorage 永続化）
- [x] `keyboardShortcutsEnabled: boolean`（デフォルト `true`）
- [x] 設定画面（`app/(tabs)/settings.tsx`）にスイッチ UI 追加
- [x] ショートカット一覧カード（キーバッジ + 説明テキスト）を設定画面に表示

### i18n
- [x] `settings.keyboard` — セクションラベル
- [x] `settings.keyboardEnabled` — スイッチラベル
- [x] `settings.keyboardShortcuts` — 一覧セクションラベル
- [x] `settings.shortcutFlip` — カードを裏返す
- [x] `settings.shortcutGrade` — 採点
- [x] `settings.shortcutNext` — 次のカードへスキップ
- [x] `settings.shortcutPrev` — 前のカードに戻る
- [x] `settings.shortcutMemo` — メモの表示/非表示
- [x] `settings.shortcutEscape` — 全画面モードの切替

---

## 技術メモ

- **キーキャプチャ方式**: `TextInput` に `showSoftInputOnFocus={false}` を付けることでソフトキーボードを出さずに物理キーボードイベントを受け取れる
- **フォーカス維持**: `onBlur` で即座に `focus()` を呼び直すことで、他の要素をタップしても常に TextInput がファーストレスポンダーを保持する
- **Escape キーの制約**: iOS では `Escape` キーは `onKeyPress` イベントを発火させない（システムレベルで処理されブラーが発生する）。そのため完了画面は `onBlur` でナビゲーションを行い、`completeReadyRef` で初期フォーカス時の誤検知を防ぐ
- **completeReadyRef のタイミング**: `completed` 変化 → 100ms 後に `focus()` → さらに 200ms 後にアーム（合計 300ms）。これによりマウント直後のフォーカス遷移による誤ナビゲーションを回避する

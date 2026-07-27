# 041 コード実行（全画面インタラクティブプレビュー）

**フェーズ:** 将来
**ステータス:** 実装完了（第1増分＝タッチ完動／第2増分＝キーボード背後抑止・仕上げ）。実機確認のみ残
**依存:** 040（Web プレビュー実行・HTML/CSS 土台・`buildWebSandboxHtml`）・009（コード実行基盤）
**被依存:** なし

---

## 概要

040 で追加した Web プレビュー（html / js・ts＋HTML/CSS 土台）は **一度描画のみ**（`pointerEvents="none"` の表示専用）で、`addEventListener` は登録されても**発火しない**。本チケットでは、プレビューを**全画面モーダルで開いて操作できる**ようにし、
スクロール・入力（input）・チェックボックス・ボタンクリックなどの**イベントを実際に動かせる**ようにする。
学習の幅（DOM 操作／イベントの体験）を広げるのが狙い。

**なぜ全画面（別 VC）方式か**：インラインの 220px プレビューを操作可能にすると、学習画面のカード縦
ScrollView・FlipCard、編集画面の `NestableDraggableFlatList` と**タッチ/スクロールを奪い合う**（本
プロジェクトが繰り返しハマってきたネストジェスチャー競合）。React Native の `<Modal>` は**別のネイ
ティブ VC** に描画されるため、これらの親から完全に切り離され、競合が**原理的に発生しない**。リスク回避
を最優先し、この方式で確定（別案＝インラインを操作可能化はジェスチャー調整が重くリスク大のため不採用）。

---

## 確定仕様（設計合意）

### 何ができるか
- 040 の Web プレビューが出る状態（html 実行後／js・ts＋土台）で、プレビューバーに **「全画面」ボタン**を追加。
- タップで**全画面モーダル**を開き、その中の WebView を**操作可能**（`pointerEvents` 既定・`scrollEnabled`）にして実行する。
  - スクロールイベント・input イベント・チェックボックス・ボタンクリック等の `addEventListener` が発火する。
  - モーダル下部に **ライブ console パネル**（イベントで出た `console.log`/`warn`/`error` を**逐次**表示）。
  - ヘッダーに **✕ 閉じる**・**⟲ リロード**（初期状態から再実行＝反復学習の冪等性・console クリア）。
- **対象言語**：html / javascript / typescript（＝040 の Web プレビュー対象）。python/sql/cpp は対象外（Web プレビューでないため）。
- **Pro 限定**：040 の Web プレビュー自体が Pro 前提のため、全画面ボタンも `isPro` のときだけ表示。
- **対象画面**：学習画面（`CodeRunnerView`）と 編集画面（`CodeBlockItem`）の**両方**。

### 既存インライン挙動は不変
- インラインの一度描画プレビュー（040）・その一発 postMessage 完了ロジック（`buildWebSandboxHtml`）・
  タイムアウト・`ExecutionOutput` の表示は**一切変更しない**。全画面は**別サンドボックス＋別モーダル**で完結する。

---

## 実行モデル：ライブ・サンドボックス（一発完了とは別物）

新関数 `buildInteractiveWebSandboxHtml(mode, body, htmlInits)` を新設する。040 の
`buildWebSandboxHtml` と**合成（土台＋本文/script）は同じ**だが、ランタイムの harness が異なる：

| | 040 `buildWebSandboxHtml`（インライン） | 041 `buildInteractiveWebSandboxHtml`（全画面） |
|---|---|---|
| 完了判定 | `DOMContentLoaded`→`finish` の一発 | **持たない**（生きたまま） |
| タイムアウト | 全体 5 秒 | **なし**（ユーザーが閉じるまで） |
| console | `_logs` に貯めて finish 時に1回 postMessage | **1 行ごとに逐次 postMessage**（ストリーム） |
| 例外 | `window.onerror`→finish(error) | `window.onerror`→**error を逐次 postMessage**（継続） |
| ネットワーク遮断 | あり（fetch/XHR/WebSocket/open） | **あり（同じ）** |
| タッチ | `pointerEvents="none"` 表示専用 | **操作可能**（別 VC で競合なし） |

- メッセージ形式（案）：`{ type: 'log', entry: { type: 'log'|'warn'|'error', text } }`。ヘッダーの ⟲ でリロード（`nonce` を key に WebView 再マウント＝土台の初期状態から再実行・console クリア）。
- console 氾濫（`setInterval` 連打等）対策：RN 側でパネルを直近 N 件（例: 500）に丸める。

---

## 導線とデータの流れ

- `ExecutionOutput` は「全画面」ボタンを出すだけ（新 prop `onExpand?: () => void`）。プレビュー領域が出ていて `onExpand` があるときに、⟲ の隣にアイコンを追加。
- モーダル本体 `InteractivePreviewModal` は**各呼び出し元**（`CodeRunnerView`／`CodeBlockItem`）に置く。ここには `block.content`／`block.language`／`htmlInits`（`[deck, block]`）が揃っている。
  - props（案）：`visible` / `onClose` / `language` / `body`（本文＝TS はモーダル内で sucrase 変換）/ `stages: string[]`（土台）/ `title?`。
  - 内部で `mode = language==='html' ? 'html' : 'js'` を決め、`buildInteractiveWebSandboxHtml` で HTML 生成。ライブ console 状態と `nonce` を自前管理。
- **キー抑止（背後の誤操作防止）**：モーダルは別 VC だが、アプリの `UIKeyCommand` は `AppDelegate` に付くため**表示中も背後の学習/編集キーが発火しうる**（Space=フリップ、1–4=採点、編集キー等）。既存パターンに倣い停止する：
  - 学習：`session.tsx` の main `useKeyCommands` を `active` ゲートで解除（`LinksSheet` と同型）。
  - 編集：`BlockEditor` の `suspendKeys` を立てる（親モーダル表示中と同型）。
  - 開閉状態のバブルアップは軽量 Context `lib/InteractivePreviewContext.ts`（`FlipSuppressContext` と同型）で行う。`session.tsx`／`BlockEditor` が Provider、`CodeRunnerView`／`CodeBlockItem` が open をセット、各キー hook が isOpen を読む。

---

## Todo

### Phase 1: サンドボックス（実行系）＝第1増分・完了
- [x] `lib/code-execution/sandbox.ts`：`buildInteractiveWebSandboxHtml(mode, body, htmlInits)` を新設
  - [x] `<head>` に**ネットワーク遮断**（fetch/XHR/WebSocket/open）＋ **console キャプチャ→1 行ごとに postMessage**（ストリーム）＋ **`window.onerror`／unhandledrejection→error を逐次 postMessage**
  - [x] 完了判定・5 秒タイムアウト・保留タイマー追跡は**持たない**（生きたまま）
  - [x] 合成は 040 と同じ（html＝`{土台}{本文}`／js・ts＝`{土台}<script>{本文}</script>`・`</script>` 無害化）。040 の関数には手を入れない
- [x] `lib/code-execution/types.ts`：既存 `LogEntry` を流用（新型不要）

### Phase 2: 全画面モーダル（新規コンポーネント）＝第1増分・完了
- [x] `components/code/InteractivePreviewModal.tsx` を新設
  - [x] `<Modal presentationStyle="fullScreen" animationType="slide">`＋safe-area 上部/下部インセット
  - [x] ヘッダー：タイトル（言語ラベル）／**✕ 閉じる**／**⟲ リロード**（`nonce` 再マウント＋console クリア）
  - [x] **操作可能な WebView**（`scrollEnabled`・`pointerEvents` 既定・`originWhitelist=['*']`・`baseUrl='about:blank'`）
  - [x] TS 本文は sucrase 変換（失敗時は console パネルに error 表示）。`buildInteractiveWebSandboxHtml` で HTML 生成
  - [x] **ライブ console パネル**（下部・`onMessage` で逐次 append・直近 500 件に丸め・空時ヒント・コピー可・自動最下部スクロール）
  - [x] Esc で閉じる（`useKeyCommands` を visible ガード）＋ Android 戻る（`onRequestClose`）

### Phase 3: 導線（ExecutionOutput）＝第1増分・完了
- [x] `ExecutionOutput` に `onExpand?: () => void` を追加し、プレビューバー右に「全画面」⛶ アイコンボタン（`expand`）を表示（プレビュー領域が出ている時のみ）
- [x] i18n：`code.interactHint`（ja/en）。ボタンはアイコンのみのため `code.fullscreen` ラベルは不要

### Phase 4: 学習画面（CodeRunnerView）
- [x] `CodeRunnerView`：`ExecutionOutput` に `onExpand` を渡し、`InteractivePreviewModal` を描画。開くとき `suppress()`（フリップ抑制）＋ `isPro` かつ Web プレビュー対象のときのみボタン表示（第1増分）
- [x] `lib/InteractivePreviewContext.ts` を新設（`{ setOpen }`・`FlipSuppressContext` と同型・単一 bool で足りる）＝第2増分
- [x] `session.tsx` に Provider（両 `FlipSuppressContext.Provider` に併設）。main `useKeyCommands` の active に `&& !interactivePreviewOpen`、常時 Esc ハンドラ先頭に `if (interactivePreviewOpen) return;`（safeBack 暴発防止・閉じるはモーダル自身の Esc）。`CodeRunnerView` は開閉で `setOpen` を呼ぶ＝第2増分
- [x] 実機確認：カード内スクロール中に全画面ボタンが押せ、モーダルでボタン/入力/チェック/スクロールが動くこと（タッチ＝確認済）。背後のカードが誤フリップ/誤採点しないこと・Esc でモーダルだけ閉じてセッションは残ること（BT キーボード）

### Phase 5: 編集画面（CodeBlockItem / BlockEditor）
- [x] `CodeBlockItem`：`ExecutionOutput` に `onExpand` を渡し、`InteractivePreviewModal` を描画（`isPro` の時のみ）。開閉で `setOpen` を呼ぶ（第2増分）
- [x] `BlockEditor` に Provider を設置し、main（`!suspendKeys && pendingDeleteBlock===null`）と Esc（`!suspendKeys`）の両 active に `&& !interactivePreviewOpen` を合流（`suspendKeys` は main＋Esc を切るため safeBack 問題は構造的に不発）＝第2増分
- [ ] 実機確認：編集の並べ替えリスト内でも全画面が開け、操作でき、閉じると編集キーが復帰すること

### Phase 6: 仕上げ
- [x] Pro ゲート確認（全画面ボタンは `isPro` かつ Web プレビュー対象言語＝html／js・ts＋土台 のときのみ）
- [x] `locales/ja.json` / `locales/en.json` の文言（`code.interactHint`・ja/en 揃い）
- [x] `lib/settings-keys.ts` への影響なし確認（新設定キーなし）
- [x] `CLAUDE.md` に本機能（全画面インタラクティブ・`buildInteractiveWebSandboxHtml`・`InteractivePreviewContext`・キー抑止）を追記。開くのは ⛶ ボタン（タッチ）、閉じるは Esc／✕（開くキーは割り当てない）
- [x] `docs/040` の「将来拡張＝インタラクティブ」は本チケット 041 で実装（下記メモ参照）

---

## 技術メモ / 注意点
- **ジェスチャー競合の回避が本チケットの肝**：インラインを操作可能化しない。全画面（別 VC）に隔離することで、CLAUDE.md/メモリに記録された `pressable-wrapper-scroll-freeze`・FlipCard/ScrollView 共存・`NestableDraggableFlatList` の競合を**そもそも踏まない**。
- **キーボードイベント**：モーダル内 `<input>` フォーカス時の keydown/input は動く。document 全体への修飾なし keydown（グローバルショートカット）は iOS の WKWebView が first responder でないと届かない場合があり**ベストエフォート**（主要ニーズ＝クリック/入力/チェック/スクロールは影響なし）。
- **セキュリティ**：ネットワーク API は 040 同様に無効化。`<img>`/`<link>`/`<iframe>` の取得は 040 と同じく当面許容。
- **オフライン**：CDN 依存なし（html/js/ts はローカル完結）。
- **既存不変**：040 の `buildWebSandboxHtml`・`buildStaticPreviewHtml`・`ExecutionOutput` のインライン表示・一発完了/タイムアウトには手を入れない（追加のみ）。

---

## 将来拡張（本チケット対象外）
- グローバル keydown を確実に拾う（WebView を first responder 化する明示処理）。
- プレビュー高さ自動調整（`document.body.scrollHeight` の受信）。
- インライン領域自体の操作可能化（ジェスチャー調整を伴うため当面見送り）。

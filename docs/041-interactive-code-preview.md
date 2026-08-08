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
- **セキュリティ**：ネットワーク API（fetch/XHR/WebSocket）は 040 同様に無効化。`<img>`/`<link>`/`<iframe>` の取得は 040 と同じく当面許容（**実測で外部 https 画像が表示されることを確認済み**＝下記）。
- **オフライン**：CDN 依存なし（html/js/ts はローカル完結）。
- **既存不変**：040 の `buildWebSandboxHtml`・`buildStaticPreviewHtml`・`ExecutionOutput` のインライン表示・一発完了/タイムアウトには手を入れない（追加のみ）。

---

## サンドボックスの実測制約（2026-07-28 確認）

**全画面でも「HTML の書ける範囲」は 040 と同じ。** `buildInteractiveWebSandboxHtml` も土台とブロック本文を `<body>` 直下へ連結し `<head>` は固定、`baseUrl='about:blank'`（opaque origin・`isSecureContext === false`）も同一だからである。**一覧は `docs/040` の「サンドボックスの実測制約」を唯一の定義元とする**（重複記載しない）。要点：

- **head 系タグは全部 body 送りで効かない**（`<meta charset>`/`description`/`<link rel=icon>` 等）。ただし `<html lang>`/`<body style>` の属性はマージされて効く。**`<title>` だけは例外で、041 のヘッダーに表示される**（下記）。
- **画像は data URI／インライン SVG なら確実**。相対パス・ローカル画像は不可。外部 https は実測で表示されるがオフラインで壊れるため非推奨。
- **セキュアコンテキスト限定 API は不可**（clipboard・crypto.subtle・randomUUID・SW・通知・カメラ・位置）。`crypto.getRandomValues` は可。`history.pushState` はハッシュ変更のみ可。
- Storage 系（localStorage 等）は SecurityError、cookie は保存されない。

### 041 で「解消するもの」と「それでも無意味なもの」

| | 040 インライン | 041 全画面 |
|---|---|---|
| クリック/入力/チェック/`addEventListener` | ✕（`pointerEvents="none"`） | **○** |
| 縦のはみ出し | △（高さ自動追従で解消。ただし画面高6割で頭打ち） | **○** |
| 横のはみ出し・スクロール | ✕（タッチを取らないため不可） | **○** |
| `confirm()`/`prompt()` の同期ブロック | 5 秒タイムアウトに掛かりうる | **上限なしで待てる** |
| 後出しログ（イベント発火時の console） | 完了後は届かない | **逐次 postMessage でライブ表示** |
| `:hover`/`:focus-visible` | ✕ | **✕**（指にホバーが無い＝全画面でも無意味） |
| `title` 属性のツールチップ（`<abbr title>` 等） | ✕ | **✕**（iOS/iPadOS の WebKit がツールチップ UI 自体を持たない。属性は生きているので `content: attr(title)` ＋ `:active`/`:focus` で自作する＝docs/040） |
| `<noscript>`・`target="_blank"`・`<base target>` | ✕ | **✕** |
| `<video>`/`<audio>` | ✕ | **✕**（`allowsInlineMediaPlayback={false}`＋要ユーザー操作＋ソースが無い） |
| リンクのタップ | 押せない | **遷移してしまう**（`onShouldStartLoadWithRequest` ガード無し・⟲ で復帰） |

---

## ヘッダーに `<title>` を出す（2026-07-29 追加）

`<title>` は「書いても効かない head 系タグ」の一つだったが、**全画面モーダルはアプリの中で最も
「ブラウザの窓」に近い場所**で、ヘッダーはブラウザがタブ名を出す位置にあたる。ここに出すのは
比喩として正確なので、`<title>` に表示先を与えた。

- サンドボックス（`buildInteractiveWebSandboxHtml`）が `DOMContentLoaded` と `load` の2回、
  `{ type:'title', title: document.title }` を postMessage する。**load でも送るので
  `document.title = '...'`（js/ts）の書き換えも反映される。**
- モーダルのヘッダーは `pageTitle || LANG_LABELS[language]`＝**無ければ従来どおり言語ラベル**。
  開き直し・⟲ でリセットされる。
- **body に落ちた `<title>` を `document.title` が拾うことを実機で確認済み**（HTML 仕様どおり
  「文書内で最初の title 要素」＝ head 限定ではない）。
- **インラインのプレビュー枠には出さない**：ブラウザは `<title>` をページ内に描画しないので、
  枠の中に出すと「本文に表示される要素」だと誤って覚えてしまう。
- 「他の言語と揃わない」問題は起きない：**全画面モーダルは web 系（html/css/js・ts）でしか
  開けない**（`canExpand`）ため、python/sql/cpp と比較される場面が無い。

---

## 全画面もインラインの「実行前／実行後」に合わせる（2026-07-31 修正）

当初の実装は `body={block.content}` を**常に**モーダルへ渡していたため、⛶ は実行状態に関係なく
**いつ開いても「土台＋本文をライブ実行」＝実行後相当**だった。CSS ブロックなら開いた瞬間に装飾が
当たり、js/ts なら開いた瞬間に本文が走る。設計時に実行前/実行後の区別を議論していなかったための
穴で、**040 の「実行するまで本文の結果は見せない（＝予想させる出題の答えを先に見せない）」原則が
全画面だけ素通し**になっていた（`previewInit` を既定 OFF にした理由と衝突する）。

インラインと同じ軸に乗せる：

- **未実行**（インラインが実行前プレビュー＝土台のみを出している状態）→ モーダルにも本文を渡さない
  （`body=''`）＝**土台だけを全画面で見る**。土台に追記して完成させる出題で、220px の枠より
  土台を確認しやすいという用途はそのまま残る。
- **実行中/実行後**（インラインが結果を出している状態）→ 従来どおり本文を渡してライブ実行する。
  学習画面では `run()` に渡したのと同じ本文（学習者の編集を含む）。
- **例外**：html で `previewInit` が ON のときは未実行でも本文を渡す＝インラインの `staticBody` と
  同じルール（インラインが実行前から本文を描いているので、全画面だけ隠す理由がない）。
- インラインの ⟲（リセット）で実行前に戻せば ⛶ も土台だけに戻る＝**両者が同じ「実行前/実行後」で動く**。

### モーダル内でも ▶/⟲ で往復する

当初は「開いた時点の状態で固定」にしたが、**モーダルの ⟲ が実行前に戻らない**（`reload()` は
`nonce` を増やして**同じ本文を初期状態から再実行**するだけ＝インラインの ⟲＝`onClear`＝実行結果を
捨てて土台へ戻す、と**同じアイコンで意味が違う**）ため、モーダル自身に実行前/実行後の状態を持たせた。

- モーダルは `ran` state を持ち、`initialRan`（＝開いた時点の `execActive`）で初期化する。
- ヘッダーは **`✕ ｜ タイトル ｜ ⟲ ▶`**。左右のグループを同じ `minWidth` にしてタイトルの中央を保つ。
  - **▶ 実行**：`ran=true` にして再マウント。実行中に押せば「初期状態から再実行」＝**旧 ⟲ の用途をこちらが兼ねる**（DOM も console も戻る）。
    **実行前は塗りボタン（`#1976D2`＝コードブロックの ▶ と同じ青・アイコン白）、実行後はゴースト（アイコンのみ）**に切り替える。
    実行前の全画面は「押しても無反応な土台」なので（下記）、状態を言葉で出すより**次の行動（押せば動く）を見せる**方が有効で、
    かつ `<title>` の行を侵さない＝長いタイトル／フォントサイズ「大」／狭い端末で崩れない。幅は `headerBtn` のままなのでタイトルの中央もずれない。
  - **⟲ リセット**：`ran=false`＝**実行前（土台のみ）へ戻す**。インラインの ⟲ と意味が揃う。
  - ⟲ は `ran && (stages.length > 0 || previewBody !== '')` のときだけ出す。土台の無い html/css を
    実行後に開いた場合は戻り先が空＝真っ白になるため（インラインで ⟲ を押すと枠ごと消えるのと同じ状況）。
- console 下部のヒントは実行前だけ `code.beforeRunHint`（「実行前の表示です（▶ で実行できます）」）に
  差し替える。実行後は従来の `code.interactHint`。
- これにより「未実行で開くと動かない土台しか出ない」問題も解消（その場で ▶ を押せる）。
  **実行前の全画面は「押せそうなのに無反応」に見えうる**：土台に `<script>` が無く、動きが JS ブロック側にしか
  無いカード（例＝土台にボタン、本文に `addEventListener`）では、ボタンは押し込みハイライトまで出るのに
  何も起きない。ネイティブ挙動（チェックボックス・text input・リンク）は実行前でも動くので、
  **一部だけ効く**ぶん余計に壊れて見える。対策として**「実行前」バッジは入れず ▶ の塗り分けを採用**した
  （バッジは状態を説明するだけだが、塗りは状態＋次の行動を同時に伝え、ヘッダーの幅も食わない）。
- TS の変換は `ran` に依存させず常に行い、**変換エラーを console に出すのは実行時だけ**（実行前は
  本文を走らせていないため）。

### 実装

呼び出し元は本文を2つ＋状態を渡すだけ。サンドボックス（`buildInteractiveWebSandboxHtml`）は無改造：

```ts
const execActive = previewMode && !!htmlSource;   // ExecutionOutput の execActive と同値
// <InteractivePreviewModal body={runBody} previewBody={staticBody ?? ''} initialRan={execActive} ... />
```

- `components/study/CodeRunnerView.tsx`（`runBody` = 学習者の編集を含む本文＝`run()` に渡すのと同じ）
- `components/editor/CodeBlockItem.tsx`（`runBody` = `block.content`＝打鍵追従）

**「未実行の ⛶ が真っ白になる」ことは起きない**：⛶ ボタンはプレビュー枠の中にあり、その枠は
土台か `staticBody` があるときしか出ない（`ExecutionOutput` の `activeHtml`）。土台の無い html/css
ブロックは未実行では枠ごと出ないので、⛶ にも到達しない。

---

## 将来拡張（本チケット対象外）
- グローバル keydown を確実に拾う（WebView を first responder 化する明示処理）。
- インライン領域自体の操作可能化（ジェスチャー調整を伴うため当面見送り）。

# 039 学習タイマーのポモドーロ拡張（学習→休憩の繰り返し）

**フェーズ:** 未定
**ステータス:** 完了（2026-07-13・全Phase実装＋実機確認済み）＋追記（2026-07-14・円/残り時間の表示を3択化＝末尾セクション）
**依存:** 036（学習タイマー）, 016（買い切り課金 `useProStore`）
**被依存:** なし
**料金区分:** Pro 機能

---

## 概要

036 の学習タイマーに、ポモドーロ式の**「学習→休憩→学習…」の繰り返し**を追加する。設定は「休憩時間」と「繰り返し回数」の2つだけの**簡易ポモドーロ**（長い休憩なし）。**繰り返し1回（既定）＝従来の単発タイマーと同一挙動**のため、ポモドーロ用の ON/OFF トグルは作らない。

### 動作イメージ（学習25分×3回・休憩5分の例）

```
学習25分 → 休憩5分 → 学習25分 → 休憩5分 → 学習25分 → ✅完了（既存の終了時動作）
```

- 学習インターバル終了で**自動的に休憩モードへ**（ハプティクス＋表示切替。モーダルなし＝流れを切らない・「強制的に休む」思想）。
- 休憩中はリングが**休憩色**に変わり、リング左に「☕ 休憩中」ピルを常時表示。**カード面はグレーアウト＋操作無効**。長押しメニューから「休憩をスキップ」「タイマーを終了」できる。
- 休憩は**壁時計ベース**で進む（バックグラウンド・画面離脱・編集モーダル中も進む）。バックグラウンド中に休憩が終わったらローカル通知でお知らせ。
- 休憩終了で**自動的に次の学習インターバルへ**（ハプティクス＋既存「⏱ N分」ヒントに「(2/3)」のサイクル表示付き）。
- **最後は学習インターバルで完了**（休憩は間に N−1 回）。完了時は既存の終了時動作（アラート/点滅）で「ポモドーロ完了」を通知。
- 休憩中は統計の時間計測も止める（休憩を挟んだカードの `responseTimeMs` から休憩実時間を除外）。

---

## 決定事項（設計の方針）

### 仕様（ユーザー合意済み・2026-07-13）

1. **簡易ポモドーロ**: 追加設定は「休憩時間」（1〜30分・既定5分）と「繰り返し回数」（1〜12回・既定1回）の2つだけ。長い休憩（4回ごとに15〜30分等）は v1 スコープ外（繰り返し2〜4回の使い方では出番がなく、必要になったら後から追加できる）。
2. **繰り返し1回＝従来挙動**: 既定値 1 なら休憩コードパスに一切入らない＝既存ユーザーへの影響ゼロ。
3. **学習→休憩は自動移行**（確認モーダルなし）。毎サイクルのタップを要求しない。スキップ手段は長押しメニュー。
4. **休憩中の操作**: タップ＝無反応（**休憩の一時停止は不可**＝壁時計ベースと矛盾するため）。長押し＝メニュー（「休憩をスキップ」「タイマーを終了」）。カードのフリップ・評価・送り・コード編集・スワイプ・関連キーは無効。**ヘッダー（戻る/鉛筆/完了）は無効化しない**（休憩は画面を離れても進むので離脱を塞ぐ理由がない。塞ぐと長押しメニューが唯一の出口になり閉じ込めリスク）。
5. **休憩は壁時計ベース**: `breakEndAt`（絶対時刻）が唯一の真実。学習計時（フォーカス中のみ・書き戻し方式）とは対照的に、suspended・AppState に関係なく進む。バックグラウンドでは JS が止まるが、復帰時に `breakEndAt` から解決する。
6. **最終インターバル終了＝既存の `finished`**（alert/blink）。繰り返し2回以上のときは文言を「ポモドーロ完了」版に差し替え。alert の「続ける（タイマー再開）」＝ `restart()` ＝**全サイクルをもう1周**（サイクル1から）。
7. **Pro 機能のまま**（036 と同じゲート。設定 UI は学習設定画面の Pro ゲート内に同居）。

### 状態機械（store/studyTimer.ts）

- **休憩中も `phase='running'` のまま、新規 `mode: 'study' | 'break'` で区別する**（採用）。
  - 理由: `timerMounted`・マウント時の「running/paused は継続」判定・`togglePause` の phase 分岐・`finished` の終了時動作がすべて**無改修で正しく動く**。繰り返し1回時は mode が 'study' から動かないため、既存挙動との一致が**コードパス同一で構造的に保証**される。
  - 不採用: phase に `'break'` を追加 — phase を見る全箇所（timerMounted・継続判定・togglePause・onApply reset 条件）の改修が必要になり、既存挙動との一致を目視確認に頼ることになる。
- 追加 state: `mode`・`cycleIndex`（1始まり）・`cycleCount`（start 時に設定値を確定コピー＝実行中の設定変更に影響されない）・`studyTotalMs`（`totalMs` は「現インターバルの長さ」に転用するため学習長を別途保持）・`breakTotalMs`・`breakEndAt`・`breakStartedAt`（休憩実時間の算出用）。
- actions:
  - `start(studyMs, config?)`: `config = { cycleCount, breakMs }`（省略時 `{1, 0}`）。`mode:'study', cycleIndex:1` で開始。
  - `startBreak(now)`（新規）: `mode:'break', totalMs:breakTotalMs, remainingMs:breakTotalMs, breakEndAt:now+breakTotalMs, breakStartedAt:now, epoch+1`。phase は 'running' のまま。`now` は呼び手（hook）が渡す＝ストアを「純粋な set のみ」の既存方針に保つ。
  - `startNextStudy()`（新規）: `mode:'study', cycleIndex+1` で次インターバル開始（epoch+1）。**休憩スキップもこれを共用**（専用 action は作らない）。
  - `togglePause()`: `mode==='break'` なら no-op を追加。
  - `restart()`: **ポモドーロ全体の最初から**（`mode:'study', cycleIndex:1`）。cycleCount=1 なら既存 restart と同一。
  - `stop()`/`reset()`: 新フィールド（mode/breakEndAt/breakStartedAt）もクリア（グレーアウト解除条件 `mode==='break' && phase==='running'` を単純に保つ）。
  - 不採用: 休憩中の restart＝現インターバルやり直し — メニューが3択化して複雑。要望が出たら追加。

```
idle ──start(N分, {cycles, break})──▶ running/study(1)
running/study(i) ──残り0 & i<cycles──▶ running/break(i)    [自動・ハプティクス]
running/study(cycles) ──残り0──▶ finished                   [既存 alert/blink・ポモドーロ完了文言]
running/break(i) ──now≥breakEndAt──▶ running/study(i+1)     [自動・ハプティクス＋ヒント (i+1/n)]
running/break(i) ──スキップ(メニュー)──▶ running/study(i+1)
running/study ──tap──▶ paused ──tap──▶ running/study        [休憩中の tap は無反応]
任意 ──stop──▶ stopped／finished・stopped ──次セッション──▶ 新規スタート
running/paused ──次セッション──▶ 継続（休憩中なら休憩の続きから）
```

### 計時（hooks/useStudyTimer.ts）— 2モード共存

- **学習 tick（既存 effect の最小変更）**: `counting` 条件に `mode==='study'` を追加。`rem <= 0` の分岐を「最終インターバル（`cycleIndex >= cycleCount`）なら `finish()`＋onFinish／中間なら `startBreak()`＋onBreakStart」に変更。cleanup の書き戻しは既存の epoch 一致ガードがそのまま有効（startBreak が epoch を進めるため stale 書き戻しを防ぐ）。
  - **学習→休憩の遷移検出は学習 tick 内だけで十分**: 学習計時はフォーカス中＋フォアグラウンドのみ動くので、学習インターバルの時間切れは必ず画面上で起こる。
- **休憩 tick（新規 effect）**: 発火条件 `enabled && phase==='running' && mode==='break'`。**`suspended`・`appActive` を条件に含めない**（壁時計＝編集モーダル上・完了画面でも進む）。250ms tick で `rem = breakEndAt - Date.now()` を秒粒度書込。cleanup の書き戻しは**不要**（breakEndAt が真実・remainingMs は表示キャッシュ）。
  - **表示（フック返り値）の残り時間はレンダー時に breakEndAt から導出**（`Math.min(remainingMs, breakEndAt - now)`・2026-07-13 実機で発見・修正）: 画面を出入りすると tick が止まりキャッシュが古いまま残り、StudyTimer のパイが「古い残量」を起点に再アニメーションして実際とズレるため（数字は tick 再開で直るがパイの起点は直らない）。min の形にするのは ①キャッシュは大きい側にしかズレない（breakEndAt 固定）＝小さい方が常に正 ②React Compiler のメモ化でも tick の毎秒更新で再計算される、の2点。
- **`endBreak(reason: 'natural' | 'skip' | 'stop')` に離脱を一元化**: `delta = now - breakStartedAt`（0以上に clamp）→ `onBreakElapsed(delta)`（統計除外）→ stop なら `store.stop()`／それ以外は `startNextStudy()`＋onBreakEnd → 休憩終了通知キャンセル。hook が返す `stop` は「休憩中なら endBreak('stop')」のラッパーに差し替え。`skipBreak = () => endBreak('skip')` を返す。
  - `onBreakEnd`（UX＝ハプティクス）と `onBreakElapsed`（統計＝除外時間）を分ける: **stop で休憩を抜けた場合は遷移演出は不要だが統計除外は必要**。
- **`resolveBreak()`（復帰時解決）**: `mode==='break' && now >= breakEndAt` なら `endBreak('natural')`。呼び出しは3箇所 — ①マウント時（startedRef ブロック末尾＝デッキ切替中に休憩が終わったケース）②AppState 'active' 遷移時（バックグラウンド中に終わったケース）③休憩 tick effect 冒頭（250ms 遅延の排除）。バックグラウンド中に学習は進まない設計なので、**飛び越すべき遷移は最大1つ**（多段解決ループ不要）。
- `counting`（リングアニメ駆動）: 休憩中は `suspended` を無視（`mode==='break' ? appActive : !suspended` の形）。
- options 追加: `breakMinutes`・`cycles`・`onBreakStart`・`onBreakEnd`・`onBreakElapsed(deltaMs)`。返り値追加: `mode`・`cycleIndex`・`cycleCount`・`skipBreak`。

### ローカル通知（lib/notifications.ts）

- **「休憩開始時に予約・全離脱経路でキャンセル」方式**（**2026-07-13 実機確認後に変更**）:
  - 当初は「バックグラウンド遷移時に予約・active 復帰時にキャンセル」方式（フォアグラウンドに通知を存在させない設計）を採用したが、予約リスナーが学習画面スコープ（useStudyTimer）のため、**①休憩中に学習画面から他画面（ホーム等）へ移動している間②他画面経由でバックグラウンド化した場合に通知が届かない**ことが実機確認で判明し、ユーザー要望により方式変更。
  - 新方式: `startBreak` 直後（useStudyTimer の学習 tick 内）に `scheduleBreakEndNotification(breakEndAt)` を予約する。**キャンセルは全離脱経路で行う**: `endBreak`（自然終了/スキップ/停止）・`resetStudyTimerIfActive`（設定変更・タイマーOFF）・hook マウント時の enabled=false 掃除・起動時クリーンアップ。
  - **cancel-all との干渉は「復元」で解決**: `_layout.tsx` の active 復帰時 cancel-all（`scheduleFromDb`/`cancelAllScheduledNotifications`）の直後に **`syncBreakEndNotification()`**（ストアが休憩中かつ残り≥1秒なら予約し直し・それ以外はキャンセル＝残骸掃除）を必ず呼ぶ。これで「休憩中に一度復帰→再バックグラウンド」でも消えない。
  - **フォアグラウンド表示はハンドラで制御**: `setNotificationHandler`（lib/notifications.ts のモジュールスコープで登録）が「休憩終了通知（identifier 判定）**かつ** タイマーUIが不可視」のときだけバナー/サウンドを許可する。**抑制条件は「学習画面がフォーカス中かつ完了画面でない」＝タイマーの suspended の反転**（2026-07-13 実機確認で「マウント中」から絞り込み）: 編集モーダル中はリングが隠れ・完了画面はリング自体が非表示で、合図がハプティクスのみ＝iPad（非搭載）では無音無表示になるため、これらではバナーを表示する。リング・ピル・遷移ハプティクス＋ヒントが見えている学習画面本体でのみ抑制。**デイリーリマインダー等の他通知は false を返し、従来どおりフォアグラウンド非表示を維持**（ハンドラ未登録時代の挙動を identifier 判定で保存）。可視状態は session.tsx が `setStudyTimerUiVisible()` で更新する。
- 追加関数（identifier は `'study-break-end'` 固定＝二重予約は上書きで自然解消）:
  - `scheduleBreakEndNotification(endAt)`: `getPermissionsAsync()` が granted でなければ何もしない。`endAt - now < 1000` なら予約しない（即発火と画面内解決の競合回避）。trigger は DATE、文言は `getReminderBody` と同じ **expo-localization 直参照**（React コンテキスト外で使うためこのファイルの既存慣習に従う）。
  - `cancelBreakEndNotification()`: `cancelScheduledNotificationAsync(...).catch(() => {})`。
  - `syncBreakEndNotification()`: タイマーストアの現状に合わせて予約し直し/掃除（_layout の active 復帰時に使用）。
- **権限リクエストは設定画面で**: 繰り返し回数を 1→2以上 に変えた瞬間に `requestPermission()` を fire-and-forget（`app/settings/notifications.tsx` の既存パターン）。学習中のモーダル割込みは不採用。**未許可でも通知なしで完全動作**（復帰時に `resolveBreak()` が即遷移＋ハプティクス）。
- **起動時クリーンアップ**: アプリ再起動でタイマー（インメモリ）は消えるが OS の予約通知は残り得る → `_layout.tsx` の初期化で `cancelBreakEndNotification()` を1回（cold start は AppState change が発火しないため active リスナーでは拾えない）。
- **studyTimerEnabled OFF の即時リセット**: 作動中に「タイマーを使う」を OFF にしたら onApply で即 reset（休憩中なら通知キャンセル込み）。従来の「次回セッションマウント時に掃除」だと OFF 後に休憩終了通知だけ鳴り得るため。

### UI（session.tsx / StudyTimer.tsx）

- `onBreak = timer.mode === 'break' && timer.phase === 'running'` を session.tsx で導出。
- **グレーアウト＋タッチ無効**: 通常/全画面の両モードで、カードエリア＋下部操作列を覆う **absolute-fill 半透明 View 1枚**（`pointerEvents="auto"` でタッチ吸収。dark: rgba(0,0,0,0.5) / light: rgba(255,255,255,0.6) 目安）。zIndex は**タイマーより下・カードより上**＝長押しメニュー（スキップ/終了）は生きる。
- **キーボード無効は状態依存ガード方式**（既存慣習）: `handleKeyPress` 先頭で `onBreak` なら Q/B 以外 return（ヘッダー活性の方針と揃える）。Enter ハンドラにも同ガード。ESC フック（常時有効）は変更なし（休憩中の ESC＝戻る、は許容）。
  - 不採用: `useKeyCommands` の active ゲートに `!onBreak` を追加 — 休憩遷移のたびにネイティブキーコマンドの全再登録が走り、iPad の keyCommands キャッシュ問題（CLAUDE.md 記載）を踏むリスクに対しメリットがない。
- スワイプ: `swipe.panGesture.enabled(isScreenFocused && !onBreak)`。
- タップ: `handleTimerPress` 先頭で `onBreak` なら return（store 側の togglePause ガードと二重に安全）。
- 長押しメニュー: `showTimerMenu` の ConfirmModal actions を `onBreak` で切替 — 休憩中は「休憩をスキップ（`skipBreak()`）」「タイマーを終了（`stop()`）」、学習中は既存の「再スタート/終了」。
- **StudyTimer.tsx**（新 props: `breakMode`・`cycleIndex`・`cycleCount`）:
  - リング色: `breakMode` 時は休憩色（緑/ティール系のライト・ダークペア定数。`themedAccentColor` と全カードテーマ上で識別できる色を実機で選定）。
  - 「休憩中」ピル: 既存 `startHintWrap`/`startHint` スタイルを再利用し、休憩中は**フェードなしで常時表示**（アイコンは Ionicons `cafe-outline`＋テキスト）。
  - 開始ヒントの break ガード: epoch effect に `breakMode` 中は発火しないガードを追加（`startBreak` の epoch+1 で「⏱ 5分」が誤表示されるのを防ぐ。休憩開始の合図はピル自身）。休憩→学習の epoch+1 では既存ロジックがそのまま発火し、`cycleCount > 1` ならラベルを「⏱ N分 (2/3)」に（新 i18n キー）。
  - **休憩中は円非表示（ゴースト）設定を無視してフルリング表示**: カードがグレーアウト済みで「画面をクリーンに保つ」動機が消えており、リングが見えないと残り休憩時間の確認手段がない（タップ無効のためピークも使えない）。
  - **パイは連続（スムーズ）欠けを維持**（2026-07-13 確定）: 開始「60」は正円で、1秒かけて6°（1分設定時）欠けたところで「59」＝数字の変わり目とパイの欠け量が一致。終端は残り「1」の間に細い扇がスムーズに消え 0 でちょうど空になる（最後の1秒がほぼ不可視なのは連続式の宿命・許容）。**不採用（試行済み・再試行しない）**: 「残り秒の切り上げで1秒＝1目盛りの段階欠け（ceil ステップを `useAnimatedProps` で導出）」— 数字とは常に一致するが実機でカクついて見えるためユーザー却下。
  - showTime: 休憩中も中央数字が休憩残りを自然に表示（変更不要）。paused 半透明分岐は休憩では発生しない（pause 不可）。
- 終了文言: `cycleCount > 1` のとき終了モーダル（alert）のタイトル/メッセージを「ポモドーロ完了」版に差し替え。blink は変更なし。

### 統計除外（hooks/useStudySession.ts）

- 1関数追加のみ: `shiftCardShownAt(deltaMs)` — `cardShownAtRef.current = Math.min(Date.now(), cardShownAtRef.current + deltaMs)`。session.tsx で `onBreakElapsed: shiftCardShownAt` を接続。休憩の全離脱経路（自然終了/スキップ/手動終了）で実休憩時間が渡り、休憩を挟んだカードの `responseTimeMs` から除外される（休憩前の閲覧時間は保持）。
- **`Math.min(Date.now(), …)` の clamp が必須**: デッキ切替で `loadSession` が cardShownAt を休憩中に再設定した後にフル休憩時間をシフトすると未来時刻→負の responseTimeMs になり得るため（最悪 0ms に丸まる）。
- 不採用: pause 累積型の計時への変更 — submitGrade/goNext/goBack/loadSession の全経路改修になり過剰。休憩中はカード操作不能＝評価が起こらないので一括シフトで十分。

---

## エッジケースと対処

| # | ケース | 挙動/対処 |
|---|---|---|
| 1 | 休憩中にセッション完了（ヘッダー完了 or Q） | 許可。completed で timerMounted=false（リング非表示）だが休憩 tick は継続。休憩終了で次学習へ遷移するが suspended のため計時は進まず、次セッション開始で継続（036 のデッキ跨ぎ継続と同じ思想）。**完了画面はリングが無く合図ゼロのため休憩終了バナーを表示する**（2026-07-13） |
| 2 | 休憩中にアプリ再起動 | タイマーは idle に戻る（インメモリ・036 仕様）。OS に残った予約通知は `_layout.tsx` 起動時の `cancelBreakEndNotification()` で掃除 |
| 3 | 作動中に設定変更（分数/休憩/回数） | 新2設定の onApply に既存 `studyTimerMinutes` と同じ「phase!=='idle' なら reset」。reset は mode/breakEndAt もクリア。通知キャンセル不要（設定画面＝フォアグラウンド＝予約が存在しない、が予約方式で保証される） |
| 4 | 繰り返し回数の実行中変更 | cycleCount は start 時に確定コピー＝次の新規スタートから反映（分数と同じ整理） |
| 5 | 休憩中にデッキ切替・同デッキやり直し | phase=running なのでマウント時判定は継続を選ぶ。直後の `resolveBreak()` が「未了なら休憩続行／終了済なら次学習へ遷移＋ヒント」。cardShownAt は clamp で安全 |
| 6 | 通知権限なし | 予約が静かにスキップされるだけで機能は完全動作（復帰時に即遷移）。設定画面に注記1行 |
| 7 | 休憩中に手動終了（メニュー） | `endBreak('stop')` → 統計除外も実施 → stopped・グレーアウト解除・次セッションで新規スタート |
| 8 | 休憩終了の瞬間にフォアグラウンド復帰 | 通知とアプリ内遷移が重なり得るが二重通知1回のみで実害なし・許容。残り<1秒は予約しないガードで大半を回避 |
| 9 | 休憩中に編集モーダル（鉛筆は活性） | 休憩 tick は suspended 非依存で継続。モーダル下で遷移したらハプティクス＋**バナー表示**（2026-07-13 変更: リングがモーダルに隠れ、iPad はハプティクス非搭載で合図が無くなるため）。復帰時には学習インターバル表示（suspended 中は計時停止のまま） |
| 10 | 繰り返し1回（既定） | startBreak 経路に入らない＝既存コードパスと同一（構造的保証） |
| 11 | 休憩中に studyTimerEnabled OFF / Pro 失効 | OFF は onApply で**即 reset＋通知キャンセル**（方式変更に伴い「次回マウント時掃除」から前倒し）。Pro 失効は次回マウント時クリーンアップのまま（最悪でも正しい内容の通知が1回鳴るだけ・許容） |
| 12 | **学習画面以外でバックグラウンド化**（休憩中にホームへ戻ってから背景へ） | **解決済み（2026-07-13 方式変更）**: 休憩開始時に予約するため、学習画面の外にいても・どの画面からバックグラウンド化しても通知が届く。ホーム等の他画面にフォアグラウンドでいる間もハンドラがバナー表示する |

---

## 影響範囲

- `store/settings.ts` … DEFS に2エントリ追加＋setter（`makeSetter`）＋clamp 定数（`STUDY_TIMER_BREAK_*`・`STUDY_TIMER_CYCLES_*`）:

  | 設定 | key | 既定値 |
  |---|---|---|
  | `studyTimerBreakMinutes` | `@codeflash_study_timer_break_minutes` | `5`（normalize: 1〜30 clamp・onApply: 作動中 reset） |
  | `studyTimerCycles` | `@codeflash_study_timer_cycles` | `1`（normalize: 1〜12 clamp・onApply: 作動中 reset） |

- `lib/settings-keys.ts` … 上記2キーを追加（**漏れるとJSONエクスポート/インポートで復元されない**）。
- `store/studyTimer.ts` … mode/cycleIndex/cycleCount/studyTotalMs/breakTotalMs/breakEndAt/breakStartedAt と `startBreak`/`startNextStudy`、既存 actions のガード/クリア拡張。
- `hooks/useStudyTimer.ts` … 休憩 tick・`endBreak`/`resolveBreak`/`skipBreak`・AppState リスナーでの通知予約/キャンセル・options/返り値拡張。
- `components/study/StudyTimer.tsx` … breakMode props・休憩色リング・「休憩中」ピル・開始ヒントの break ガード＋「(i/n)」・休憩中は introOnly 無効。
- `app/study/session.tsx` … onBreak 導出・グレーアウトオーバーレイ（通常/全画面）・スワイプ/キー/タップのガード・長押しメニュー分岐・ハプティクス接続・ポモドーロ完了文言。
- `hooks/useStudySession.ts` … `shiftCardShownAt(deltaMs)` 追加（return へ）。
- `lib/notifications.ts` … `scheduleBreakEndNotification`/`cancelBreakEndNotification`/`syncBreakEndNotification`・`setNotificationHandler`（フォアグラウンド表示制御）・`setStudyTimerUiVisible`。
- `app/_layout.tsx` … 起動時の残留通知クリーンアップ1回・active 復帰時の `syncBreakEndNotification()`。
- `app/settings/study.tsx` … 「学習タイマー」セクションに繰り返し回数 Slider（1〜12）・休憩時間 Slider（1〜30・回数2以上のとき表示）・通知注記・回数 1→2以上で `requestPermission()`。
- `locales/ja.json` / `en.json` … 設定ラベル・ピル・スキップ・ヒント(i/n)・ポモドーロ完了文言（必ずセットで）。
- ShortcutsModal … 変更なし（休憩中は既存キーが無効になるだけで新キーは増えない）。

**新規ライブラリ依存なし・DB スキーマ変更なし**（expo-notifications・expo-haptics は既存依存）。

### v1 スコープ外（将来候補）

- 長い休憩（N 回ごとに長め）
- 休憩中の一時停止・休憩時間の延長
- 学習画面外・アプリ全体で動く休憩タイマー（通知予約含む）
- サイクル進捗の可視化強化（ドット表示 ●●○ など）

---

## Todo（フェーズ別）

### Phase 1: 設定ストア＋設定UI
- [x] `store/settings.ts`: `studyTimerBreakMinutes`/`studyTimerCycles` を DEFS＋makeSetter に追加（onApply=作動中 reset）・clamp 定数
- [x] `lib/settings-keys.ts` に2キー追加（JSONエクスポート対象）
- [x] `app/settings/study.tsx`: 繰り返し回数 Slider（1〜12）・休憩時間 Slider（1〜30・回数2以上で表示）・通知注記・回数 1→2以上で `requestPermission()`
- [x] `locales/ja.json`・`en.json` に設定文言追加（セットで）

### Phase 2: ストア状態機械
- [x] `store/studyTimer.ts`: 新フィールド追加（mode/cycleIndex/cycleCount/studyTotalMs/breakTotalMs/breakEndAt/breakStartedAt）
- [x] `start(studyMs, config)` 拡張・`startBreak(now)`/`startNextStudy()` 新規
- [x] `togglePause`（break ガード）・`restart`（全サイクル再開）・`stop`/`reset`（新フィールドのクリア）

### Phase 3: 計時と遷移（useStudyTimer）
- [x] options/返り値の拡張（breakMinutes/cycles/onBreakStart/onBreakEnd/onBreakElapsed・mode/cycleIndex/cycleCount/skipBreak）
- [x] 学習 tick: `mode==='study'` 条件＋時間切れ分岐（最終→finish／中間→startBreak）
- [x] 休憩 tick（suspended/appActive 非依存・breakEndAt 基準・冒頭で即時解決）
- [x] `endBreak(reason)` 一元化（elapsed 通知・自然終了/スキップ/停止）・stop ラッパー差し替え
- [x] `resolveBreak()`: マウント時・AppState active 時の復帰解決
- [x] `counting` の休憩対応（リングアニメが休憩中も進む）

### Phase 4: ローカル通知
- [x] `lib/notifications.ts`: `scheduleBreakEndNotification(endAt)`/`cancelBreakEndNotification()`（identifier 固定・granted チェック・DATE トリガー・残り<1秒ガード・Localization 直参照文言）
- [x] ~~`useStudyTimer` AppState リスナー: 'background' で予約・'active' でキャンセル＋resolveBreak~~ → **方式変更（2026-07-13）**: 休憩開始時（startBreak 直後）に予約・全離脱経路（endBreak/reset/OFF）でキャンセル。AppState 'active' は resolveBreak のみ
- [x] `setNotificationHandler`（フォアグラウンド表示制御: 休憩終了通知×タイマーUI不可視時のみバナー・他通知は非表示維持）＋ `setStudyTimerUiVisible` フラグ（session.tsx が「フォーカス中かつ未完了」＝suspended の反転で更新。編集モーダル中・完了画面はバナー表示）
- [x] `syncBreakEndNotification()`: `_layout` の active 復帰 cancel-all 直後に予約復元・残骸掃除
- [x] `store/settings.ts`: `studyTimerEnabled` OFF の onApply で即 reset（休憩中なら通知キャンセル）
- [x] `_layout.tsx`: 起動時に残留通知クリーンアップ1回

### Phase 5: UI（StudyTimer/session）
- [x] `StudyTimer.tsx`: breakMode/cycleIndex/cycleCount props・休憩色リング（ライト/ダークペア・実機で選定）・「休憩中」ピル常時表示（cafe-outline）
- [x] `StudyTimer.tsx`: 開始ヒントの break ガード＋「⏱ N分 (i/n)」表示・休憩中は introOnly（ゴースト）無効
- [x] `session.tsx`: onBreak 導出・グレーアウトオーバーレイ（通常/全画面・タイマーより下・タッチ吸収）
- [x] `session.tsx`: スワイプ無効・handleKeyPress/Enter ガード（Q/B は許可）・タップ無反応
- [x] `session.tsx`: 長押しメニューの休憩分岐（スキップ/終了）・onBreakStart/End ハプティクス・ポモドーロ完了文言（cycleCount>1）
- [x] `locales/ja.json`・`en.json`: ピル・スキップ・ヒント(i/n)・完了文言（セットで）

### Phase 6: 統計除外
- [x] `hooks/useStudySession.ts`: `shiftCardShownAt(deltaMs)`（`Math.min(Date.now(), …)` clamp 付き）を追加し return へ
- [x] `session.tsx`: `onBreakElapsed: shiftCardShownAt` を接続

### Phase 7: 確認
- [x] 繰り返し1回＝036 と完全同一挙動（開始/一時停止/再スタート/終了/alert/blink/ゴースト/ヒント）
- [x] 25分×3・休憩5分で 学習→休憩→…→学習→完了（休憩は N−1 回・最後は学習で終了時動作・「ポモドーロ完了」文言）
- [x] 学習→休憩の自動移行（ハプティクス・モーダルなし）・休憩→学習でヒント「⏱ N分 (2/3)」
- [x] 休憩中: グレーアウト＋タッチ/キー無効（Q/B/戻る/鉛筆/完了は可）・タップ無反応・長押し=スキップ/終了
- [x] 休憩の壁時計: 編集モーダル中・デッキ切替中・バックグラウンド中も進む。復帰/再マウントで正しく解決
- [x] バックグラウンド中の休憩終了→通知が届く。**休憩中に一度復帰→再バックグラウンドでも通知が消えない**（_layout の cancel-all 干渉確認）
- [x] **学習画面以外（ホーム等）にいる間・他画面経由のバックグラウンドでも通知が届く**（2026-07-13 方式変更分）。学習画面本体（リング表示中）ではバナーが出ない。デイリーリマインダーは従来どおりフォアグラウンド非表示のまま
- [x] **編集モーダル中・完了画面では休憩終了バナーが出る**（2026-07-13 抑制条件の絞り込み: リングが見えず iPad はハプティクスも無いため）
- [x] 権限拒否でも動作継続（復帰時に即遷移）。作動中の設定変更・タイマーOFFで通知が残らない
- [x] 休憩を挟んだカードの responseTimeMs から休憩時間が除外される（統計の平均時間で確認）
- [x] 休憩中の設定変更 reset／アプリ再起動（残留通知キャンセル）／休憩中のセッション完了→次セッションで継続
- [x] 円非表示・数字ON/OFF・ライト/ダーク・全画面モード・フォント3段階
- [x] JSONエクスポート→インポートで新2設定が復元される
- [x] `npm run lint`・tsc が通る

---

## 追記（2026-07-14）：円/残り時間の表示を3択（常に/開始時/オフ）化

### 背景・課題

- 従来は「円を表示」「残り時間を表示」の**2トグル（ON/OFF）**だった。
- 「円 OFF＋残り時間 OFF」のとき、枠線タップのピークは**パイ（円）だけ**を再表示し、**残り時間だけを確認する手段が無かった**（ユーザーからの指摘）。
- さらに旧「円を表示 OFF」は内部的には `introOnly`＝「開始時のみ表示→ゴースト枠線→タップでピーク」で、**ラベル（OFF）と実態がズレていた**。

### 決定事項（ユーザー合意済み・2026-07-14）

1. **円・残り時間をそれぞれ `常に(on) / 開始時(start) / オフ(off)` の3択にする**（トグル→セグメント）。これにより「円だけ開始時」「時間だけ開始時」「両方開始時」など直交した9通りが表現でき、旧「OFF」のラベル矛盾も解消（実態の "開始時のみ" は `start`、真の非表示は `off`）。
2. **表示ルール**: `on`=常時表示 / `start`=開始時（＋タップのピーク時）に数秒だけ表示→フェードアウト / `off`=一切非表示。要素の on/off はウィンドウと無関係に常時反映。
3. **タップのピーク＝「`start` に設定した要素だけ」を数秒再表示**（＝開始時フラッシュのリプレイ）。
   - 円が `on`（常時表示）のときは**タップ＝一時停止**でピークしない（見えているものはタップで止める／薄いものはタップで見せる、の住み分け）。
   - **両方 `off` はピークなし**（枠線＋開始直後の「⏱ N分」ヒントのみ・タップ＝一時停止／長押し＝メニュー）。「見たい人は `start` にする」で筋が通り、9通り全パターンが**特例なしで一貫**する。
4. **検討して不採用**: 「タップのピークは設定に関わらず常に円＋時間の両方を出す」案。当初はこれを推したが、3択では `start` がすでに"ピークで出す要素の指定"になっているため、`off` の要素までピークで出すと**ユーザーの明示的な選択を上書きする**（例: 円=start＋時間=off の人＝欠け具合で把握したい人に、ピークで数字を出すと「なぜ？」）。→ ピークは `start` 要素のみに限定。
5. **許容（1点）**: 「円=on＋残り時間=start」だけは、数字が開始時に一度出るのみで**タップでの再ピーク不可**（タップ＝一時停止）。円が見えているため実害は小さい。

### 移行（AsyncStorage キーは据え置き＝値の意味だけ拡張）

- キー `@codeflash_study_timer_ring_visible` / `@codeflash_study_timer_show_time` はそのまま。旧 bool 値を読む移行つき parse を用意：
  - 円: `true`→`'on'` / `false`→`'start'`（旧「OFF」＝開始時のみ表示＋ゴースト＋ピークを正確に維持）
  - 残り時間: `true`→`'on'` / `false`→`'off'`
- **既定（円=on・時間=off）と「円OFF＋時間OFF」のピーク挙動は正確に保たれる**。
- 唯一の例外: 旧「円OFF＋残り時間ON」（＝ミニマル数字時計・円は一切出ない）だけは `start`+`on` に移行し、開始時に円が一瞬出るようになる（該当する組み合わせは稀なため許容）。cross-key 移行を避けるための割り切り（各 parse は自キーの生値しか見られないため）。

### 実装（影響ファイル）

- `store/settings.ts` … 型 `StudyTimerElementMode`（`'on'|'start'|'off'`）＋ `STUDY_TIMER_ELEMENT_MODES`・移行つき parse（`parseStudyTimerRing`/`parseStudyTimerTime`）。設定名を `studyTimerRingVisible`/`studyTimerShowTime`（bool）→ `studyTimerRing`/`studyTimerTime`（enum）へ改名。
- `components/study/StudyTimer.tsx` … props を `introOnly`/`showTime` → `ringMode`/`timeMode` に。表示ロジックを再構築（`showPie`/`timeVisible`/`transientShown` による共通「開始時ウィンドウ」＋ピーク＝`start` 要素のリプレイ）。**本文中の `introOnly`・「円非表示設定」記述（Phase 5 の該当項・エッジ #9 等）は `ringMode='start'/'off'` に読み替え**。休憩中フルリング・終了時パイ・パイの連続欠けは不変。
- `app/study/session.tsx` … 2箇所の `StudyTimer` に `ringMode`/`timeMode` を渡す。
- `app/settings/study.tsx` … 2トグル → 2セグメント（常に/開始時/オフ）。
- `locales/ja.json`・`en.json` … ラベルを「円の表示」「残り時間の表示」に、選択肢 `studyTimerDisplayAlways/Start/Off` を追加、`studyTimerInfo`（説明文）を3択＋ピーク挙動に更新。
- `npm run lint`・`tsc --noEmit` 通過（新規 warning なし）・実機で全パターン動作確認済み。

---

## 参考

- 学習タイマー本体（036）: `store/studyTimer.ts`・`hooks/useStudyTimer.ts`・`components/study/StudyTimer.tsx`・`docs/036-study-timer.md`（開始ヒント・ゴースト円・終了アラートの経緯）
- 設定 DEFS パターン: `store/settings.ts`（`makeSetter`・normalize・onApply）＋ `lib/settings-keys.ts`
- 通知の既存慣習: `lib/notifications.ts`（`getReminderBody` の Localization 直参照・identifier 固定）・`app/_layout.tsx`（active 復帰時の cancel-all→再登録）・`app/settings/notifications.tsx`（requestPermission パターン）
- 回答時間の計測: `hooks/useStudySession.ts`（`cardShownAtRef`）→ `grade_logs.responseTimeMs`（`docs/024-detailed-statistics.md`）
- アラート表示中の背景キー抑止・状態依存ガード: CLAUDE.md「Bluetooth キーボード」節（034）

# 036 学習タイマー（円形フローティングタイマー）

**フェーズ:** v1.9.0
**ステータス:** 完了（Phase 1〜6 すべて確認済み・v1.9.0 収録予定）
**依存:** 007（学習画面）, 016（買い切り課金 `useProStore`）, 025（FSRS カスタマイズ＝学習設定画面）
**被依存:** なし
**料金区分:** Pro 機能

---

## 概要

学習セッション中に残り時間を視覚的に示す**円形フローティングタイマー**を追加する。設定した時間（1〜60分）から時計回りにリングが欠けていき、カウント 0 で学習完了への移行を提案する。

### iOS 標準タイマーとの差別化

- **学習画面にいる間だけ進む。** 他画面への遷移（カード編集モーダル・戻る）やバックグラウンドで自動一時停止し、学習画面へ復帰すると再開する。つまり「純粋にカードと向き合っていた時間」だけを計れる。
- **時間切れで学習完了（サマリー画面）へジャンプできる。** `finishSession()` と連携できるのはアプリ内タイマーだけ。

### 動作イメージ

- 学習セッション開始時、`isPro && studyTimerEnabled` なら設定分数で自動スタート。
- カード内上部の余白に 56pt の正円（塗りつぶし）が収まり、パイ状に時計回りに欠けていく（欠けた部分は透明＝カード背景が見える）。進行は reanimated の UI スレッドで連続アニメーション（カクつかない）。
- タップで一時停止/再開（停止中は半透明＋pause アイコン）。長押しでメニュー（再スタート／終了）。
- カウント 0 で「アラート＋バイブ」または「円の点滅のみ」（設定で選択）。
- タイマーは**セッション（デッキ）を跨いで継続**する。学習画面の外では一時停止し、次のセッション開始で残り時間から再開（「今日は30分暗記する」をデッキ横断で計れる）。時間切れ・手動終了の後は、次のセッション開始で設定分数から新しくスタート。アプリ再起動でリセット。

---

## 決定事項（設計の方針）

- **表示・計時のスコープは学習画面のみ。** アプリ全体で動くオーバーレイにはしない（ルートレイアウト常駐はモーダル/ジェスチャー干渉リスクが高くコスト大）。
  - 一時停止トリガーは2系統: ①画面フォーカス喪失（`useIsFocused` を `suspended` として渡す）、②AppState `background`。復帰（focus / `active`）で再開。
- **タイマー状態はアプリスコープ（`store/studyTimer.ts`・Zustand インメモリ）。** 残り時間と phase はセッションを跨いで保持し、デッキを替えても・同じデッキをやり直しても続きから動く。時間切れ（finished）/手動終了（stopped）後は次のセッション開始で設定分数から新規スタート。**AsyncStorage には永続化しない**（アプリ再起動でリセット＝「セットする」行為は起動ごとの意思表示）。設定分数の変更は次の新規スタートから反映。
- **残り時間は絶対時刻ベースで管理。** `endAt = Date.now() + remainingMs` を持ち、250ms tick で `remaining = endAt - Date.now()` を再計算（setInterval の生カウントはドリフト・バックグラウンド停止に弱い）。pause 時は `remainingMs` を確定、resume 時に `endAt` を再計算。
- **配置はカード内上部余白の右側に固定。** タイマー常時表示中はカード内容の上パディング（`faceContentTimerPad`）を広げて内容と重ならないようにする。全画面学習モードでもヘッダー直下の右上（固定 top の絶対配置）。
- **サイズは 56pt**（navFab と同じ）。一時停止中は `opacity: 0.5` ＋中央に pause アイコン。
- **カラーは既定でプライマリーカラー（`theme.colors.primary`）**＝ライト/ダークテーマに自動追従。
- **回転方向は時計回り固定**（12時起点で欠けていく）。反時計回り設定は設けない（要望が出たら追加）。
- **時間表示は既定で円のみ。** 設定（`studyTimerShowTime`）で中央に残り時間の**数字のみ**（単位なし・白文字＋影の縁取り）を表示可。1分1秒までは分（floor・例「12」）、残り1分ちょうどからは秒（60→59→…）。
- **終了時動作は設定で2択**（`studyTimerEndBehavior`）:
  - `'alert'`（既定）: `expo-haptics` のバイブ＋ ConfirmModal「時間になりました」→「学習を続ける」（閉じるのみ）／「学習を完了」（`finishSession()` でサマリー画面へ）。**確定操作なので Return は割り当てない**（タップ/Esc のみ・既存の確認モーダル慣習に従う）。
  - `'blink'`: リングが点滅するのみ（バイブなし）。タップで点滅解除・非表示。
- **円非表示設定**（`studyTimerRingVisible=false`）: 計時開始時（セッション入場・再スタート・一時停止からの再開）に約3秒だけ表示してフェードアウト（開始したことが分かる）。計時は裏で継続し、終了時に再表示して通知。
- **操作: タップ＝一時停止/再開、長押し＝メニュー**（ConfirmModal で「タイマーを再スタート」「タイマーを終了」＝このセッションでは非表示）。
- **時間設定は 1〜60 分・1分刻み（既定 10 分）。** normalize で 1〜60 に clamp。**作動中（一時停止含む）に分数を変更したらタイマーをリセット**し、次の学習開始から新しい分数でスタート（旧い残り時間が続くと設定が効いていないように見えるため。DEFS の `onApply` で実装）。
- **Pro ゲート:** 設定 UI は Pro ゲート済みの学習設定画面（`app/settings/study.tsx`）に同居。学習画面側も `isPro` を実行時参照（035 のトライアル実効 `isPro` にも自動追従）。

### v1 スコープ外（将来候補）

- アラーム音（`expo-audio` の依存追加＋再ビルドが必要。v1 はバイブで代替）
- タイマー一時停止のキーボードショートカット（学習画面のキーが混みあっているため見送り）
- ドラッグ移動・位置の設定選択・反時計回り設定
- カウントアップ（経過時間計測）モード・ポモドーロ繰り返し
- 学習時間の統計連携（024 の回答時間と合わせた「今日の学習時間」など）

---

## 影響範囲

- `store/settings.ts` … DEFS に5エントリ追加＋setter（`makeSetter`）:

  | 設定 | key | 既定値 |
  |---|---|---|
  | `studyTimerEnabled` | `@codeflash_study_timer_enabled` | `false` |
  | `studyTimerMinutes` | `@codeflash_study_timer_minutes` | `10`（normalize: 1〜60 clamp） |
  | `studyTimerRingVisible` | `@codeflash_study_timer_ring_visible` | `true` |
  | `studyTimerShowTime` | `@codeflash_study_timer_show_time` | `false` |
  | `studyTimerEndBehavior` | `@codeflash_study_timer_end_behavior` | `'alert'`（`'alert' \| 'blink'`） |

- `lib/settings-keys.ts` … 上記5キーを追加（**漏れるとJSONエクスポート/インポートで復元されない**）。
- `store/studyTimer.ts`（新規）… タイマー状態（phase・remainingMs・totalMs）のインメモリストア。セッションを跨いだ継続の実体。
- `hooks/useStudyTimer.ts`（新規）… ストアを購読し、学習画面マウント中のみ絶対時刻ベースで計時（250ms tick・秒粒度で書込）・AppState 連動・セッション開始時の「継続 or 新規スタート」判定。フォーカス連動は session.tsx から `suspended` prop で渡す。
- `components/study/StudyTimer.tsx`（新規）… SVG `<Circle>` の「半径 r・ストローク幅 2r」＋`strokeDasharray`/`strokeDashoffset` によるパイ（塗りつぶし扇形）描画（`rotate(-90)` で12時起点・時計回りに欠ける）・タップ/長押し・点滅アニメーション。
- `app/study/session.tsx` … 通常画面＋全画面モードの両方に組込。表示条件 `isPro && studyTimerEnabled && !completed`。既存 `useFocusEffect`（画面フォーカス管理）に pause/resume を追加。終了モーダル表示中はメイン `useKeyCommands` の `active` ゲートに `!showTimerModal` を追加（アラート表示中の背景キー抑止の既存慣習）。
- `app/settings/study.tsx` … 画面名を「FSRSカスタマイズ」→**「学習設定」**（`settings.studySettings`）にリネームし、「FSRSカスタマイズ」「学習タイマー」の2セクション構成にする（タイマー設定が FSRS 画面に同居するとわかりにくいため。設定トップの行ラベルも変更）。タイマー側は ON/OFF・分数・円表示・数字表示・終了時動作。
- `locales/ja.json` / `en.json` … 設定ラベル・終了モーダル・長押しメニュー文言（必ずセットで追加）。

**新規ライブラリ依存なし**（`react-native-svg`・`react-native-reanimated`・`expo-haptics` はすべて既存依存。haptics は依存済みだが本チケットが初使用）。

### 再利用する既存部品

- リング描画の参考: 完了画面のドーナツ（`session.tsx` の Svg/Circle、`lib/donut.ts` の12時起点・時計回りの角度計算）。ただし進捗リングは扇形パスより `strokeDashoffset` が適切。
- アニメーション: `components/study/FlipCard.tsx` の `useSharedValue`＋`withTiming`＋`useAnimatedStyle`。点滅は `withRepeat`。
- フローティング配置: `session.tsx` の `fullscreenBtnRow`（カード左上）・`navFabFloating`（全画面モードの絶対配置）。
- バックグラウンド検知: `app/_layout.tsx` の `AppState.addEventListener('change', ...)`（フォアグラウンド復帰バッジ更新と同パターン）。
- 設定 UI: `app/settings/notifications.tsx` の `Switch` 行、`app/settings/study.tsx` の `Slider`（FSRS保持率）と `styles.segmented`。
- 終了フィードバック: `ConfirmModal`（actions 配列）・`useStudySession.finishSession()`。
- Pro ゲート: `app/settings/study.tsx` のロック UI＋`router.push('/paywall')` パターン。

---

## Todo（フェーズ別）

### Phase 1: 設定ストア
- [x] `store/settings.ts`: `SettingsValues`・DEFS・`SettingsState`・setter に5設定を追加
- [x] `lib/settings-keys.ts` に5キーを追加（エクスポート対象）

### Phase 2: タイマーコア
- [x] `hooks/useStudyTimer.ts` 新規: phase 管理・`endAt` 絶対時刻ベース計時（250ms tick）・`pause()`/`resume()`/`restart()`/`stop()`
- [x] AppState リスナー: `background` で pause、`active` で resume（画面フォーカス中のみ）
- [x] `remaining <= 0` で `finished` へ遷移し onFinish コールバック

### Phase 3: UI（リング表示）
- [x] `components/study/StudyTimer.tsx` 新規: 56pt リング（`strokeDashoffset`・時計回り・`theme.colors.primary`）
- [x] 一時停止表示（opacity 0.5＋pause アイコン）・数字表示（分/秒切替）
- [x] タップ＝一時停止/再開、長押し＝ConfirmModal（再スタート/終了）
- [x] `session.tsx` 通常画面のカード右上へ組込（`fullscreenBtnRow` と対称の絶対配置）
- [x] 全画面モードにも右上表示（ヘッダー行が固定 paddingTop のため固定 top で配置）
- [x] 画面フォーカス連動の pause/resume（`useIsFocused` を `suspended` prop として渡す方式で実装）
- [x] `studyTimerRingVisible=false` 時は計時のみ・非描画

### Phase 4: 終了時動作
- [x] `'alert'`: `Haptics.notificationAsync()`＋ConfirmModal「時間になりました」→ 続ける/完了（`finishSession()`）
- [x] `'blink'`: リング点滅（`withRepeat`）・タップで解除
- [x] 終了モーダル表示中はメイン `useKeyCommands` の `active` ゲートで背景キー抑止（Return 割当なし）

### Phase 5: 設定画面＋i18n
- [x] `app/settings/study.tsx` に「学習タイマー」セクション（Switch×3・Slider 1〜60・終了動作セグメント2択）
- [x] `locales/ja.json`・`en.json` に文言追加（セットで）

### Phase 6: 確認
- [x] セッション開始でタイマー自動開始・時計回りに欠ける（パイが UI スレッドでスムーズに動く）
- [x] タップで一時停止（半透明化）→再開、長押しメニューの再スタート/終了
- [x] カード編集モーダルへ遷移→戻るで一時停止→再開（残り時間が飛ばない）
- [x] バックグラウンド→復帰で停止していた（復帰後に残り時間が減っていない）
- [x] デッキ跨ぎ・同デッキやり直しで残り時間から継続、時間切れ/終了後は次セッションで新規スタート
- [x] 1分設定でカウント0 → alert: バイブ＋モーダル→「学習を完了」でサマリーへ／blink: 点滅のみ→タップで解除
- [x] 円非表示設定で開始 → 約3秒表示後フェードアウト・終了時に再表示して通知
- [x] 数字表示ON: 単位なしの数字（1分1秒までは分、残り1分ちょうどから 60→59→… の秒）
- [x] 全画面学習モードでも右上（進捗バーの下）に表示・通常/全画面で1行目との間隔が同等
- [x] カードテーマの codeBackground に円の色が追従（default のみ primary）
- [x] 作動中に分数変更 → リセットされ次の学習開始から新分数
- [x] Pro OFF で設定がロックUI・学習画面にタイマーが出ない
- [x] JSONエクスポート→インポートで5設定が復元される
- [x] `npm run lint`・tsc が通る

---

## 参考

- Pro 判定: `store/pro.ts` `useProStore.isPro`（035 トライアル導入後は実効値）
- 学習セッション: `app/study/session.tsx`（`useFocusEffect`・`finishSession()`・`fullscreenBtnRow`・`navFabFloating`）
- 設定 DEFS パターン: `store/settings.ts`（`makeSetter`・normalize）＋ `lib/settings-keys.ts`
- 円弧の角度計算: `lib/donut.ts`（12時起点・時計回り）
- AppState 検知: `app/_layout.tsx`（フォアグラウンド復帰時のバッジ更新）

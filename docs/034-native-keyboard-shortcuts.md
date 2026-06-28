# 034 キーボードショートカットのネイティブ化（UIKeyCommand / 隠しTextInput撤去）

**フェーズ:** 未定（安定化リファクタ。v1.8〜v1.9 候補）
**ステータス:** 未着手（設計検討済み）
**依存:** 008（全画面+Bluetoothキーボード）, 005（カードエディタ）, 007（学習画面）。Development Build 環境（`expo-dev-client` 導入済み）
**被依存:** 以降の全キーボード操作（矢印/ESC 対応はこの上に乗る）, **033 Phase 5**（装飾の修飾コンボ Cmd+B 等は本チケットのカードエディタ移行が前提）
**料金区分:** 無料機能（内部リファクタ）

---

## 概要

現在のキーボードショートカット（J/K・Space・Return・`,`/`.`・1–4・各種レター）は、**各画面に「常時フォーカスした隠し `TextInput`」を置き `onKeyPress` でキーを拾う**ハックで実装している。この「常にフォーカスされた入力欄が存在する」ことが、本アプリで繰り返したタッチ系不具合の**構造的な根本原因**だった。

本チケットは、これを **iOS ネイティブの `UIKeyCommand`（責任者チェーンでキーを受ける仕組み）** へ移行し、**隠し `TextInput` を撤去**する。タッチとキー入力が分離され、この種のバグが構造的に消える。副産物として**矢印キー・ESC・Tab** などが扱え、脆い再フォーカス系コードを大量に削除できる。

### 解決したい既知の不具合（すべて隠し入力起因）

- 復帰後のタブ切替フリーズ／各所のタップが「何度もタップでやっと反応」（first responder 解除に初回タップが食われる）。`keyboardShortcutsEnabled` を OFF にしても、フォーカス処理自体は走っていたため完全には消せなかった（暫定対策として `onScreenFocus` を flag で gate 済み＝OFF は安定。ON は宿命的に残る）。
- 学習→カード編集の下部ボタン不応・戻り時のちらつき（隠し入力の再フォーカス＋背面キーボードイベント）。
- 各画面に散在する「`onBlur` で 200ms 後に再フォーカス」「遷移中は抑制」等の脆いワークアラウンド。

### 現状の制限（ネイティブ化で解消される）

- 矢印キー・ESC を `onKeyPress` で検知できない（`ascii-capable` 固定の制約）。
- `Tab` は iPadOS のシステムフォーカス（UIFocusSystem）に取られ検知不可。
- 「フォーカスされた入力欄」がタッチを食う。

---

## 決定事項（設計の方針）

- **隠し `TextInput` は最終的に撤去する。** キー入力源を「フォーカスした入力欄＋`onKeyPress`」から「VC レベルの `UIKeyCommand` 登録」へ置き換える。
- **責任者チェーンで自然に住み分ける。** テキストブロックや検索欄など**実 `TextInput` がフォーカス中はその入力欄がキーを消費**し、フォーカスが無いとき（J/K モード等）は VC の key command が発火する。これにより「編集中は文字入力／非編集中はショートカット」が**隠し入力なしで**両立する（現状この切替を隠し入力の付け外しで無理やり実現していたのを廃止できる）。
- **キー設計（割り当て）は原則維持する。** J/K・Space・Return・`,`/`.`・1–4・各レターはそのまま。移行は「入力源の差し替え」であって UX 変更ではない。矢印/ESC/Tab は**追加**として段階的に。
- **`keyboardShortcutsEnabled` 設定は維持。** 無効時は key command を登録しない（OFF＝何も介入しない、を厳守）。
- **画面ごとに focus 連動で登録/解除する。** `useFocusEffect` 内で現在画面のキーマップを登録し、blur で解除（現状の `onScreenFocus/Blur` の責務をそのまま移植）。
- **`Return`/`Enter` の扱い。** 現状 `onSubmitEditing` で拾っている「決定」操作を Enter の key command に統一できる（`onKeyPress` で取れなかった Return 問題が解消）。
- **実装はネイティブモジュールが必要 → Development Build/EAS 前提。** Expo Go 不可。`expo-dev-client` は導入済みなので開発は可能。配布は EAS Build。

### ライブラリ vs 自前 Expo モジュール（Phase 0 で決定）

- **第一候補: `react-native-key-command`（Expensify, OSS）。** `UIKeyCommand`（iOS）/ `KeyEvent`（Android）ベースで、フォーカスした入力欄なしにハードウェアキーを受ける。矢印・ESC・Enter・Tab・修飾キーに対応。**要確認:** 新アーキ（`newArchEnabled: true`）対応、Expo config plugin/autolinking での組み込み、単一キー（修飾なし）コマンドの発火可否。
- **代替: 自前の Expo Module（Swift）。** `UIResponder.keyCommands` を返す薄いネイティブビュー/モジュールを書き、JS へキーイベントをブリッジ。依存を増やさず最小要件に最適化できるが工数増。
- Phase 0 の PoC でどちらかに確定する。

---

## 影響範囲（差し替え対象）

キー処理を持つ画面・モジュール（`onKeyPress`/`onSubmitEditing` を key command 登録へ差し替え、隠し入力を撤去）:

- `app/(tabs)/index.tsx`（ホーム）, `app/(tabs)/study.tsx`, `app/(tabs)/stats.tsx`, `app/(tabs)/settings.tsx`
- `app/tags/index.tsx`, `app/tags/[tagId]/cards.tsx`, `app/deck/[id]/index.tsx`（カード一覧）
- `app/study/session.tsx`（学習セッション）, `app/search.tsx`
- `components/editor/BlockEditor.tsx`（カードエディタ：非入力モードの J/K 等）, `components/editor/TextBlockItem.tsx`（実入力との住み分け確認）

撤去/簡素化できる見込みのもの:

- `components/HiddenKeyboardInput.tsx`（撤去）
- `hooks/useKeyboardFocus.ts`（focus 連動の責務は残すが、`keyboardRef` フォーカス/ブラー・再フォーカスタイマー群は撤去・簡素化）
- 各画面の「`onBlur` 200ms 再フォーカス」「`isTransitioning` 抑制」「`onScreenFocus` の flag gate」等のワークアラウンド
- `useListNavigation`（J/K ヌルサイクル）は**ロジックは流用**（入力源だけ差し替え）

> 関連メモ: 根本原因＝常時フォーカスの隠し入力（`project_hidden-textinput-shortcut-root-cause`）。背面 PanGesture 別件（`project_study-edit-modal-refocus-race`）、GHRV はプッシュ画面に必要（`project_nested-gesturehandlerrootview-flaky-taps`）。

---

## 実装内容

### Phase 0 — PoC・ライブラリ確定（最重要・先にやる）

- [x] Development Build に `react-native-key-command` を組み込む（v1.0.15）
- [x] 新アーキで動くこと、**単一キー（修飾なし）コマンドが発火**することを確認（iPhone 16e シミュレータ）
- [x] **実 `TextInput` フォーカス中は入力欄が文字を消費し、key command が発火しない**こと（住み分け）を確認 ← 設計の肝クリア
- [x] 矢印キーの挙動を確認（発火OK）。**iPad の `Tab`（UIFocusSystem）は未検証** → Phase 2 の iPad 検証で確認
- [x] **ライブラリ採用で確定**（`react-native-key-command`）

#### Phase 0 机上調査（2026-06-26）

本リポジトリ構成: ネイティブ `ios/`・`android/` がコミット済みの prebuild 構成。Expo `~54.0.33` / RN `0.81.5` / `newArchEnabled: true` / `expo-dev-client` 導入済み。ネイティブ組み込みは `expo run:ios` で可能。

**`react-native-key-command`（Expensify, MIT）評価:**

- 最新 `v1.0.15`、RN peer `>=0.70.4`。package.json に **codegen/Fabric の記述なし＝旧アーキ（legacy）ネイティブモジュール**。RN 0.81 + new arch では interop 層頼みで、動作保証なし（要実機確認）。
- API: `import * as KeyCommand from 'react-native-key-command'` → `registerKeyCommands([{input, modifierFlags}])` / `unregisterKeyCommands` / `eventEmitter.addListener('onKeyCommand', cb)` / `addListener(cmd, cb)`。定数 `constants.keyInputEscape`・`keyInput{Up,Down,Left,Right}Arrow`・`keyModifierCommand/Shift/Control`。
- **iOS セットアップが Obj-C `AppDelegate.m` 前提**（`- (NSArray *)keyCommands` と `handleKeyCommand:` を `HardwareShortcuts sharedInstance` に委譲）。**Expo 54 は Swift の `ExpoAppDelegate`** なので、Swift へ翻訳しつつ **prebuild で消えないよう config plugin で AppDelegate を注入**する必要がある（直接編集は `npx expo prebuild --clean` で消える）。← 本ライブラリ採用時の最大の手間/リスク。
- 仕組み上、keyCommands を AppDelegate（責任者チェーン最下層）に置くため、**上位の `TextInput` がフォーカス中は単一キーが文字挿入され key command は発火しない＝住み分けが自然に成立**する見込み（修飾コンボ Cmd+B は TextInput が消費しないので発火）。

**自前 Expo Module（Swift）評価:**

- Expo Modules API は **new arch ネイティブで autolink・prebuild と相性良好**、外部依存ゼロ。
- ただし「キーが無いとき自分が first responder になり `keyCommands` を返す」責任者チェーン制御を自前で実装する必要があり、ライブラリが解決済みの**一番難しい所を作ることになる**。

**現時点の暫定方針（PoC で確定）:**

1. まず `react-native-key-command` を **config plugin で Swift AppDelegate に注入**して PoC。new arch interop で動けば採用（設定の手間は初回のみ）。
2. interop で不可なら **自前 Expo Module** に切替（responder 制御を実装）。

- いずれも**実機（物理/Bluetooth キーボード）でのビルド・検証が必須**で、ここは要・実機作業。下記 PoC スクリーンで Phase 0 のチェック項目を一括検証する。

#### Phase 0 実機検証結果（2026-06-26・採用確定）

iPhone 16e シミュレータ（new arch・Hardware Keyboard 接続）で PoC 検証。**react-native-key-command を採用**。

- **[E] ビルド:** `expo run:ios` 成功（new arch interop で問題なし）。
- **[A] 単一キー:** フォーカス無しで `j`/`k` 発火 ✓
- **[B] 住み分け:** 入力欄フォーカス中の `j` は**文字挿入されショートカット非発火** ✓（責任者チェーンで自然成立＝隠し入力が不要な決定的証拠）
- **[C] 修飾コンボ:** 入力欄フォーカス中でも **`Cmd+B` が発火・文字は入らない** ✓（033 Phase 5 の前提を満たす）
- **[D] Esc/矢印:** すべて発火 ✓
- **未検証:** iPad の `Tab`（UIFocusSystem に取られる可能性）→ Phase 2 の iPad 検証で確認。

**実装上の確定事項（Phase 1 へ引き継ぐ）:**

- iOS セットアップ: ブリッジヘッダに `#import <react-native-key-command/HardwareShortcuts.h>`、`AppDelegate.swift`(`ExpoAppDelegate`) に `keyCommands` override と `@objc handleKeyCommand(_:)` を追加。
- **`HardwareShortcuts.sharedInstance().keyCommands()` は Obj-C メソッドなので Swift では `()` 必須**（無いと常に nil で全く効かない。ハマりポイント）。
- **イベント payload の `input` は登録時の数値定数ではなく iOS 特殊文字列で返る**（Esc=`uikeyinputescape`、矢印=`uikeyinputuparrow`/`...down/left/right`）。本実装のディスパッチはこの文字列でマッチさせる。
- 現状の AppDelegate/ブリッジヘッダ直接編集は `expo prebuild --clean` で消えるため、**Phase 1 で config plugin 化**して恒久化する。
- PoC 用の一時物（`app/keycmd-poc.tsx`・設定画面の一時ボタン）は Phase 1 着手時に削除する。

### Phase 1 — 共通レイヤ `useKeyCommands`

- [x] キーマップ（`{ input, modifierFlags?, handler }[]`）を受け取り、画面 focus 中だけ登録/解除するフックを作る（`lib/useKeyCommands.ts`。`hooks/` は権限外のため lib に配置）
- [x] `keyboardShortcutsEnabled` が false のときは登録しない（フック内で gate）
- [x] `useFocusEffect` 連動（現 `onScreenFocus/Blur` の責務を移植）
- [x] 突き合わせは payload.input を小文字正規化（特殊キーの定数と payload 文字列の揺らぎを吸収）。型は `types/react-native-key-command.d.ts`
- [x] **パイロット移行: 設定タブ**（`,`/`.` タブ切替を `useKeyCommands` 化、隠し TextInput 撤去）。実機検証で「ON でも設定メニューが1タップ・タブ切替動作」を確認＝**ON時のタップ食われ解消を実証**
- [x] **config plugin で AppDelegate 注入を恒久化**（`plugins/withKeyCommands.js`・`app.json` に登録）。`expo prebuild --clean` で再生成しても keyCommands override とブリッジヘッダ import が自動で入ることを実機確認済み
- [x] 既存の `Grade`/フィルタ等の enum やキー定義（`lib/cardEditorShortcuts.ts` 等）と整合（各画面移行時）

### Phase 2 — 画面ごとに段階移行（1画面ずつ・隠し入力と二重化しない）✅ 完了（2026-06-27）

各画面で「`onKeyPress` のロジックを `useKeyCommands` のハンドラへ移設 → 隠し入力と関連ワークアラウンドを撤去 → 実機回帰」を1セットで進めた。各画面 ON で「タップ1回・サクサク」を実機確認。

- [x] 設定タブ（最小・検証用に最初）
- [x] ホーム（デッキ一覧：J/K ヌルサイクル・並べ替えとの両立確認）
- [x] 学習タブ / 統計タブ
- [x] カード一覧（選択モード含む・SwipeToDelete との両立）
- [x] タグ管理 / タグ別カード一覧
- [x] 学習セッション（Space 反転・1–4 グレード・J/K コードブロック・全画面）
- [x] カードエディタ（非入力モード J/K と実入力の住み分け＝ Phase 0 の肝を本番適用）
- [x] 検索（**元々ショートカット未実装＝対象外**。検索欄の TextInput のみ）

### Phase 3 — 撤去と新機能 ✅ 完了（2026-06-27）

- [x] `HiddenKeyboardInput` 撤去、`useKeyboardFocus` の再フォーカス系コード削除（両ファイルとも削除）
- [x] `onScreenFocus` の flag gate など暫定対策を削除（各画面移行時に撤去。BlockEditor の死んだ ref 群も撤去）
- [x] **矢印キー**対応（**上下=K/J、左右=,/.** で実装＝既存キーと併用）、**ESC** で階層ディスマス（オーバーレイ/シート/選択モード/全画面を閉じる→ push 画面は戻る・エディタはキャンセル）
- [x] `Return` を Enter コマンド（`keyInputEnter`）へ統一（`onSubmitEditing` 依存を解消）

### Phase 4 — 仕上げ

- [x] CLAUDE.md のキーボード節を更新（「隠し TextInput」前提の記述を全面改訂・ネイティブ方式へ）
- [x] ショートカット一覧（`ShortcutsModal`）に矢印/ESC を反映
- [ ] 回帰チェックリスト（下記）を実機で一通り確認（移行ごとに ON 検証済み。矢印/ESC の通し確認は継続中）
- [ ] Android のキー対応方針を決定（当面 iOS 専用 or `KeyEvent` 対応）
- [ ] **iPad の `Tab`（UIFocusSystem）挙動は未検証**のまま（割り当ては避けている）

---

## リスク・要検証

- **単一キーコマンドの安定性。** iOS で修飾なし単一キーの `UIKeyCommand` が全画面で確実に発火するか（責任者チェーン・presentation 形態に依存）。Phase 0 で要確証。
- **実入力との競合。** テキスト編集中にショートカットが暴発しないこと（責任者チェーンで解決する想定だが実機確認必須）。
- **iPad の Tab/矢印。** UIFocusSystem に取られる可能性。取れない場合は割り当てを避ける。
- **新アーキ互換。** ライブラリが `newArchEnabled` で動くか。動かなければ自前 Expo Module。
- **ビルド/配布。** ネイティブ依存のため Expo Go 不可・EAS Build 必須。CI/署名の確認。
- **Discoverability HUD。** Cmd 長押しの一覧に出るのは修飾キー付きのみ。単一キー（J/K 等）は出ないが、アプリ内 `ShortcutsModal` があるため許容。
- **段階移行中の一貫性。** 1画面ずつ移行する間、移行済み画面（key command）と未移行画面（隠し入力）が混在する。**同一画面で二重化しない**ことを徹底（混在によるフォーカス競合を避ける）。

---

## 回帰チェックリスト（Phase 2/4 で使用）

- [ ] 各画面で割り当てキーが1回で反応（J/K・Space・Return・`,`/`.`・1–4・各レター）
- [ ] **タッチ操作が常に1回で効く**（下部ボタン・タブ・行タップ・戻る/新規作成）
- [ ] バックグラウンド→復帰後もフリーズしない（本チケットの主目的）
- [ ] テキスト編集中はキーが文字入力として働き、ショートカットが暴発しない
- [ ] カード編集の編集⇄非編集モード切替で住み分けが正しい
- [ ] `keyboardShortcutsEnabled` OFF で一切介入しない
- [ ] 物理キーボード無し（画面のみ）でも全タッチ操作が正常

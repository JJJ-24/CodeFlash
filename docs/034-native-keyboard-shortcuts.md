# 034 キーボードショートカットのネイティブ化（UIKeyCommand / 隠しTextInput撤去）

**フェーズ:** 未定（安定化リファクタ。v1.8〜v1.9 候補）
**ステータス:** 未着手（設計検討済み）
**依存:** 008（全画面+Bluetoothキーボード）, 005（カードエディタ）, 007（学習画面）。Development Build 環境（`expo-dev-client` 導入済み）
**被依存:** 以降の全キーボード操作（矢印/ESC 対応はこの上に乗る）
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

- [ ] Development Build に `react-native-key-command`（または自前 Expo Module）を組み込む
- [ ] 新アーキで動くこと、**単一キー（修飾なし）コマンドが発火**することを実機確認
- [ ] **実 `TextInput` フォーカス中は入力欄が文字を消費し、key command が発火しない**こと（住み分け）を確認 ← 設計の肝
- [ ] iPad の `Tab`（UIFocusSystem）と矢印キーの挙動を確認（Tab は取れない可能性。可否をメモ）
- [ ] ライブラリ採用 or 自前実装を確定し、ここに追記

### Phase 1 — 共通レイヤ `useKeyCommands`

- [ ] キーマップ（`{ key, modifiers?, handler }[]`）を受け取り、画面 focus 中だけ登録/解除するフックを作る
- [ ] `keyboardShortcutsEnabled` が false のときは登録しない
- [ ] `useFocusEffect` 連動（現 `onScreenFocus/Blur` の責務を移植）
- [ ] 既存の `Grade`/フィルタ等の enum やキー定義（`lib/cardEditorShortcuts.ts` 等）と整合

### Phase 2 — 画面ごとに段階移行（1画面ずつ・隠し入力と二重化しない）

各画面で「`onKeyPress` のロジックを `useKeyCommands` のハンドラへ移設 → 隠し入力と関連ワークアラウンドを撤去 → 実機回帰」を1セットで進める。

- [ ] 設定タブ（最小・検証用に最初）
- [ ] ホーム（デッキ一覧：J/K ヌルサイクル・並べ替えとの両立確認）
- [ ] 学習タブ / 統計タブ
- [ ] カード一覧（選択モード含む・SwipeToDelete との両立）
- [ ] タグ管理 / タグ別カード一覧
- [ ] 学習セッション（Space 反転・1–4 グレード・J/K コードブロック・全画面）
- [ ] カードエディタ（非入力モード J/K と実入力の住み分け＝ Phase 0 の肝を本番適用）
- [ ] 検索

### Phase 3 — 撤去と新機能

- [ ] `HiddenKeyboardInput` 撤去、`useKeyboardFocus` の再フォーカス系コード削除
- [ ] `onScreenFocus` の flag gate など暫定対策を削除（不要になる）
- [ ] **矢印キー**対応（J/K と併用 or 置換は要 UX 判断）、**ESC** でモーダル/選択モード解除
- [ ] `Return` を Enter コマンドへ統一（`onSubmitEditing` 依存を解消）

### Phase 4 — 仕上げ

- [ ] CLAUDE.md のキーボード節を更新（「隠し TextInput」前提の記述を全面改訂）
- [ ] ショートカット一覧（`ShortcutsModal`）に矢印/ESC を反映
- [ ] 回帰チェックリスト（下記）を実機で一通り確認
- [ ] Android のキー対応方針を決定（当面 iOS 専用 or `KeyEvent` 対応）

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

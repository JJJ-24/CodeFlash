# 061 iPhone Duo のレイアウト見直し（帯の扱い・タブ以外の画面）

**フェーズ:** Phase 0〜3
**ステータス:** Phase 0 着手（2026-10-29）。本格的な作業は 060 を main へ入れた後
**要ネイティブ再ビルド:** 不要の見込み（`expo-status-bar` 58.0.4 の API は入っている。使い方次第で要確認）
**DB 変更:** なし
**依存:** 060（iOS 27 SDK でのビルドが前提）

---

## 背景

060 Phase 4 で、iPhone Duo の閉じた状態・開いた横向き・開いた縦向きに最低限対応した（左右の safe area をネイティブで避ける・タブを右の帯の中へ・ヘッダーを 80pt の1行にそろえる・帯をヘッダーの色で塗る）。
残っているのは、**タブの4画面以外**（push 画面・入力系モーダル・設定の詳細・全画面プレビュー・学習画面）で右の帯（84pt）をどう扱うか。今はどの画面も帯を白く空けているだけ。

Duo の safe area（実測・2026-10-29）：

| 状態 | 画面 | 上 | 右 | 下 | 時刻・Wi-Fi |
|---|---|---|---|---|---|
| 閉じた状態 | 466×678 | 0 | 84 | 34 | 右の帯の上部に縦並び（時刻 y≈92pt） |
| 開いた横向き | 951×669 | 0 | 84（逆向きは左 84） | 34 | 右の帯の上部に縦並び（時刻 y≈40pt・Wi-Fi は約 100pt まで） |
| 開いた縦向き | 669×951 | 82 | 0 | 34 | 右上の角に横並び（中心 y≈48pt） |

⚠️ アプリは iPhone を縦固定（`orientation: portrait`）だが、Duo を開いた状態では固定が効かず横にも回る。横向きに対応させても safe area も時刻・Wi-Fi の並び方も変わらなかった（2026-10-29 に試して戻した）。

---

## Phase 0 の調査結果（2026-10-29）

### 学習画面でステータスバーを隠しても、Duo の帯は消えない

学習画面は開いた直後にステータスバーを隠す（`app/study/session.tsx` の `setStatusBarHidden(true)`。その後 060 で画面ごとの `statusBarHidden` に移した＝下の「普通の iPhone でも…」）。Duo でログを取ると、隠した後も safe area は変わらない（閉じた状態・開いた横＝右 84・開いた縦＝上 82）うえ、時刻・Wi-Fi も消えない。

原因は `expo-status-bar` 58.0.4 の型の説明に書いてある：**`hidden` は iPhone Duo では効かない**（ステータスバーが縦の帯にあるため）。帯を上へ戻すには **`verticalBarBehaviorIOS: 'disabled'`** を使う、とある。

### `expo-status-bar` 58.0.4 の Duo 向け API（iOS 27.1 以降）

- `<StatusBar verticalBarBehaviorIOS="disabled" />` ／ `StatusBar.setVerticalBarBehaviorIOS('disabled')`：ステータスバーとシステムのバーを**縦の帯に移さず、横（上端）のまま**にする（`UIViewController.preferredVerticalBarBehavior` を差し替える）。マウントしている間だけ効き、複数あれば最後にマウントしたものが勝つ。
- `StatusBar.getVerticalBarEdgeIOS()` ／ `useVerticalBarEdgeIOS()`：縦の帯がどちらの辺にあるか（`'leading'` / `'trailing'` / `null`）。帯の変化はイベントで届く。

→ **帯を消して画面を広げることは、`'disabled'` でできる見込み**（未検証）。その場合、時刻・Wi-Fi は普通の iPhone のように上端に戻り、上の safe area が増えるはず（値は要実測）。隠す（`hidden`）も効くようになるはず。
→ **Duo の判定は `useVerticalBarEdgeIOS()` に置き換えられる見込み**。今は「画面の短い辺が 450pt を超える iPhone」で判定し、時刻・Wi-Fi の位置も Safari の画面写真から測った決め打ち（`lib/useLockedTopInset.ts` の `useIsDuo`・`DUO_*`）。

### 普通の iPhone でも学習画面のステータスバーが消えていない（060 の退行の疑い）

iPhone 18 Pro（iOS 27.0 シミュレータ・SDK 58 のビルド）でも、学習画面で時刻・Wi-Fi が出たまま。今までの iPhone・iPad では消えていた（ユーザー談）。
`RCTStatusBarManager`（RN 0.88）は `UIApplication.setStatusBarHidden:`（`UIViewControllerBasedStatusBarAppearance = NO` 前提の古い API）で隠しているので、**UIScene（iOS 27 SDK）でこの API が効かなくなった**可能性が高い。Duo とは別の問題で、060 の退行として扱う（→ `docs/060` の Phase 3 に追記）。
同じ API で文字の色（`style`＝ダークのとき白）も設定しているので、そちらも効いていない可能性がある。
直し方の候補：react-native-screens の画面ごとの `statusBarHidden`／`statusBarStyle`（expo-router の Stack の options。`UIViewControllerBasedStatusBarAppearance = YES` で view controller から設定する）へ移す。
→ **060 で A 案（画面ごとの指定）に移した（2026-10-29・v1.14.0）**＝`expo-status-bar` はもう使っていない。⚠️ 下の `verticalBarBehaviorIOS` を試すときは `expo-status-bar` を再び使うことになるので、`UIViewControllerBasedStatusBarAppearance = YES`＋画面ごとの指定の下でも効くか（どの view controller の `preferredVerticalBarBehavior` を差し替えるか）を合わせて確かめる。react-native-screens に同じ指定があればそちらを優先する。

---

## 進め方

### Phase 0：調べる（コードは変えない）

- [x] 学習画面でステータスバーを隠したときの safe area → 変わらない（上記）
- [x] `expo-status-bar` 58.0.4 の Duo 向け API を確認（上記）
- [ ] `verticalBarBehaviorIOS: 'disabled'` を一時的に付けて、3つの状態の safe area・時刻・Wi-Fi の位置・`hidden` が効くかを実測する
- [ ] `useVerticalBarEdgeIOS()` の値を3つの状態で実測する（閉じた状態・開いた横＝`trailing`／開いた縦＝`null` になるか）
- [ ] 対象の画面を一覧にし、閉じた状態・開いた横・開いた縦で画面写真を撮る

対象の画面（タブの4画面以外）：

| 種類 | 画面 |
|---|---|
| push 画面 | デッキ詳細（カード一覧）・タグ管理・タグ別カード一覧・検索・アーカイブ・このアプリについて |
| 学習 | 学習セッション（通常・全画面）・学習完了 |
| 入力系モーダル | デッキ新規/編集・カード新規/編集・タグ新規/編集 |
| 設定の詳細 | 表示・学習・通知・同期・データ・同期の復元・Pro 案内（paywall） |
| 全画面プレビュー | 実行プレビュー（041）・ページを見る（059） |
| シート・ダイアログ | ショートカット一覧・デッキ選択・土台の一覧・読み上げの設定など（帯との重なりだけ確認） |

### Phase 1：画面の種類ごとに方針を決める

選択肢（画面の種類ごとに1つ選ぶ。1画面ずつ決めない＝作りがそろう）：

1. **帯は空けたまま**（今の白）
2. **帯にボタンを入れる**（Safari の閉じた状態と同じ：上＝戻る・下＝主な操作。例：学習画面＝カード送り、入力系モーダル＝保存・閉じる）
3. **帯を消して広げる**（`verticalBarBehaviorIOS: 'disabled'`。Phase 0 で効くと分かった場合。学習画面の全画面表示が第一候補）

決めるときに気をつけること：

- 帯のボタンは JS の判定で出し分けるので、開閉の1〜2コマ後に切り替わる。**開閉で中身の大きさが変わる作りにしない**（060 で踏んだ＝タブを閉じた状態だけ帯にしたら＋ボタンや行が動いた）。
- `'disabled'` を画面ごとに切り替えると、画面の行き来で上の safe area・帯が変わる＝ヘッダーの高さが揺れうる。

### Phase 2 以降：決めた方針の順に直す

- [ ] Duo の判定と寸法を `useVerticalBarEdgeIOS()` ベースに置き換えるか決める（決め打ちの寸法を減らせる）
- [ ] （種類ごとのチェックリストは Phase 1 で作る）

---

## 関連

- `docs/060-expo-sdk-58-ios27.md` の Phase 4（Duo の最低限の対応・不採用にした案）
- CLAUDE.md「カスタムヘッダーパターン」の「左右の safe area（060・iPhone Duo）」
- 後回しにした案：ヘッダー・タブバー・帯をテーマの色にする（060 の後、ホームのヘッダーを標準に戻す件と一緒に）

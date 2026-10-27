# 060 Expo SDK 58 への移行（iOS 27 SDK でのビルド・UIScene 対応・iPhone Duo）

**フェーズ:** Phase 0〜5
**ステータス:** Phase 2 完了（2026-10-26・`feature/060-expo-sdk-58` ブランチ）。次は Phase 3（動作確認）
**要ネイティブ再ビルド:** 必要（`ios/` を prebuild で作り直す）
**DB 変更:** なし
**依存:** なし（ただし**審査中のバージョンがある間は着手しない**＝同じ環境で作り直せなくなる）

---

## 背景

- 現在は **Expo SDK 54（RN 0.81.5）＋ Xcode 26.6（iOS 26 SDK）** でビルドしている。iOS 27 の端末では互換モードで動く（実機確認済み）。
- **iOS 27 SDK（Xcode 27）でビルドすると UIScene ライフサイクルが必須**になり、非対応のままだと起動時に真っ白になる。SDK 54 は非対応。
  SDK 57.0.23 で opt-in（`ios.enableSceneSupport`）、**SDK 58（RN 0.88）で scene が既定**になり、prebuild が `SceneDelegate.swift` を生成する。
- **iPhone Duo**（折りたたみ）は、iOS 26 SDK のビルドでも動くが**互換モード＝画面に合わせた動的リサイズをしない**。動的リサイズは iOS 27 SDK でビルドしたアプリだけ。
- Apple が iOS 27 SDK でのビルドを必須にする時期までに移行が要る（期限は App Store Connect の告知で確認する）。
- Xcode 27 は Simulator.app が **Device Hub** に置き換わり、SDK 54 の CLI では `expo run:ios` が失敗する報告がある（expo#46882）。SDK 58 の CLI は Device Hub に対応。

### 段階1（完了・2026-10-25）

Xcode 27.1 を `/Applications/Xcode-27.1.app` に並べて置き（`xcode-select` は 26.6 のまま）、Duo のシミュレータで開発できるようにした。

```bash
X27=/Applications/Xcode-27.1.app/Contents/Developer
DUO=<Duo の UDID>   # DEVELOPER_DIR=$X27 xcrun simctl list devices | grep -i duo
DEVELOPER_DIR=$X27 xcrun simctl boot $DUO
# ビルドは Xcode 26.6
xcodebuild -workspace ios/CodeFlash.xcworkspace -scheme CodeFlash -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build/duo build
DEVELOPER_DIR=$X27 xcrun simctl install $DUO ios/build/duo/Build/Products/Debug-iphonesimulator/CodeFlash.app
DEVELOPER_DIR=$X27 xcrun simctl launch $DUO com.jjj24.codeflash
```

このチケットは**段階2＝SDK 58 へ上げて Xcode 27 でビルドする**作業。

---

## このアプリで重い理由

54 → 58 は4つ飛ばしになるうえ、このアプリはネイティブ側に手を入れている箇所が多い。

1. **パッチ6本の当たり直し**（`patches/`）。上流で直っていればパッチごと消す。

   | パッチ | 中身 | 確認のしかた |
   |---|---|---|
   | `react-native+0.81.5` | ①KAV のリモートキーボード除外 ②Fabric ScrollView のリモートキーボード除外＋`prepareForRecycle` での inset 戻し ③Paper ScrollView のリモートキーボード除外 ④`RCTTextLayoutManager` の描画高さ +1pt | 4ファイルとも 0.88 のソースで該当箇所を読み、直っていなければ当て直す（CLAUDE.md「iPad マルチウィンドウとキーボード通知」「主要な設定」） |
   | `react-native-key-command+1.0.15` | `matchesInput:` のポインタ比較 → `isEqualToString:`／PageUp/PageDown/Home/End の定数 | ライブラリの新版があるか・New Arch／RN 0.88 で動くか |
   | `@react-native-community+slider+5.0.1` | Fabric の `updateProps` で min/max/step を毎回・value より先に適用／ドラッグ中は適用しない／`prepareForRecycle` で `isSliding` を倒す | SDK 58 のピンの版で同じ問題が残っているか |
   | `react-native-draggable-flatlist+4.0.3` | `onDragEnd` 後に必ず `reset()` | 新版の有無。reanimated の新版で動くか |
   | `@oleg_svetlichnyi+expo-icloud-storage+1.1.3` | アップロード完了判定（`is Bool` → 値・percent>=100）＋バックグラウンドアップロード | SDK 58 の expo-modules-core で動くか |
   | `expo-speech+14.0.8` | iOS でも `volume` を渡す（起こしの発話用） | SDK 58 のピンの版で `volume` が iOS に来ているか |

2. **`buildReactNativeFromSource: true` ＋ `plugins/withPrebuiltRNDeps.js`**（RN 本体はソース・fmt/folly/glog/boost はプリビルド）。
   Xcode 27 の Clang で fmt の consteval エラーを再び踏みうる。RN 0.88 で Podfile の `ENV['RCT_USE_RN_DEP']` 行が残っているか（plugin はこの行をアンカーにしている）を確認する。
   ⚠️ パッチ①が RN 本体のネイティブを触っている限り、ソースビルドは外せない（プリビルドの RN コアにはパッチが入らない）。上流で全部直っていれば、ソースビルドと plugin ごと撤去できる＝ビルド時間も大きく縮む。

3. **`plugins/withKeyCommands.js`**：
   - `class AppDelegate:\s*ExpoAppDelegate\s*\{` をアンカーに Swift を注入している。SDK 58 の AppDelegate の形が変わると throw する（黙って壊れはしない）。
   - ⚠️ **UIScene にしても AppDelegate の `keyCommands` が責任者チェーンで拾われるかは要確認**。拾われなければ注入先を SceneDelegate（または root VC）へ移す。症状は「全ショートカットが効かない」なので、Phase 2 で最初に確かめる。
   - ブリッジヘッダ（`<project>-Bridging-Header.h`）が SDK 58 の prebuild でも生成されるか。

4. **`package.json` の `expo.install.exclude`（`react-native-webview`）**：SDK 58 のピンが 13.16.1 以上なら exclude を外してピンに戻す。下回るなら残す（13.15.0 は相対 URL への遷移でクラッシュする）。

---

## 進め方

### Phase 0：準備・調査（コード変更なし）

- [x] 審査中のバージョンが無いことを確認する（v1.13.2 は 2026-10-25 にリリース済み・以降のコミットはドキュメントとリファクタリングだけ＝申請中のビルドは無い。記録からの確認なので、ASC 側で別の申請を出していないかは作業前にもう一度見る）
- [x] Expo の SDK 55・56・57・58 のリリースノート／アップグレードガイドの「破壊的変更」を読み、このアプリで当たるものを一覧にする（expo-router・expo-sqlite・expo-notifications・expo-speech・reanimated・gesture-handler は特に）→ 下の「Phase 0 の調査結果」
- [x] 上の表の6パッチについて、移行先の版で直っているか・当て直しが要るかを調べる → 同上
- [x] Apple の iOS 27 SDK 必須化の期限を確認する → **2027年4月から**（日付は未発表。Apple は「iOS 27 SDK 以降でビルド・iOS 15 以降が対象」を 2027年4月からの最低要件として掲載。開発者フォーラムでも正確な日付は答えないとの回答＝ASC の告知を待つ。iOS 26 SDK の必須化が 2026年4月だったのと同じ周期）
- [x] 作業場所を決める → **ブランチ `feature/060-expo-sdk-58` で進め、Phase 3 の動作確認まで通ってから main へ入れる**（2026-10-26 決定）。それまでの v1.13.x の修正は main で行い、必要ならブランチへ取り込む

#### Phase 0 の調査結果（2026-10-26）

**移行先の版**（`expo@58.0.19` の `bundledNativeModules.json`）：RN 0.88.0／React 19.3.0／expo-router 58.0.26／expo-sqlite 58.0.14／expo-speech 58.0.3／reanimated 4.7.1（worklets 0.13.0）／**gesture-handler 3.3.0（メジャー更新）**／screens 4.30／safe-area-context 5.10.1／svg 15.16.0／slider 5.2.1／datetimepicker 9.2.1／webview 14.0.1。Node は 22.13+／24.3+ が必要（手元は 24.14.0＝OK）。

**6パッチの判定**

| パッチ | 判定 | 根拠 |
|---|---|---|
| RN ①KAV のリモートキーボード除外 | **要る**（そのまま当て直し） | 0.88 の `_onKeyboardChange` に `isEventFromThisApp` の判定が無い |
| RN ②Fabric ScrollView のリモートキーボード除外 | **要る** | `_keyboardWillChangeFrame:` に `UIKeyboardIsLocalUserInfoKey` の判定が無い |
| RN ②' `prepareForRecycle` の inset 戻し | **ほぼ上流で直った**＝外せる見込み | 0.88 は `contentInset` を `props.contentInset` へ戻す。さらに `updateProps` が `_automaticallyAdjustKeyboardInsets` を差分なしで毎回代入するようになったので、上流がフラグを NO に倒しても CLAUDE.md の懸念（同じフラグの画面へ使い回すと追従が効かない）は起きない。残るのはキーボードで動いた `verticalScrollIndicatorInsets`（スクロールバーの位置だけ）＝見た目だけなので当て直さなくてよい |
| RN ③Paper ScrollView | **不要**（ファイルごと削除された） | 0.88 に `React/Views/ScrollView/RCTScrollView.m` が無い（旧アーキテクチャの撤去） |
| RN ④`RCTTextLayoutManager` +1pt | **要る** | `drawAttributedString` は `size:frame.size` のまま |
| `react-native-key-command` | **要る**（新版 1.0.19 でも未修正） | 1.0.19 の iOS ソースはパッチ部分以外 1.0.15 と同一＝`==` のポインタ比較のまま・PageUp 等の定数も無い。`RCTEventEmitter` の旧モジュールだが 0.88 にも interop 層（`RCTInteropTurboModule`）が残る |
| `slider` | **外せる見込み**（Phase 3 で確認） | 5.2.1 が `+ (BOOL)shouldBeRecycled { return NO; }` を足した＝ビューを使い回さないので、パッチが防いでいた「前の利用先の min/max/step/value が残る」「`isSliding` が再利用を跨いで残る」の前提が消えた。ドラッグ中のちらつきはパッチの「毎回適用」が引き起こしていたものなので、差分適用のままの上流では起きない |
| `draggable-flatlist` | **要る＋書き換えが増える** | 4.0.3 が最新（2025-05 から更新なし）。①パッチが使う **`InteractionManager` は RN 0.88 で削除**＝`reset()` の予約を `setTimeout`/`requestAnimationFrame` などへ置き換える ②gesture-handler 3 で `FlatList`/`ScrollView` が新実装に替わり、ライブラリが渡す `simultaneousHandlers` は `simultaneousWith` に改名＋**新旧の API の間では関係（simultaneous 等）を結べない**＝ライブラリ内の import を `LegacyFlatList`/`LegacyScrollView` に差し替えるのが最小の変更 |
| `expo-icloud-storage` | **要る**（そのまま当て直し） | 1.1.3 が最新。Module DSL（`AsyncFunction`・`Events`・`sendEvent`）と Foundation しか使っておらず、expo-modules-core 58 の破壊的変更（JSI 層の Swift 化など）には当たらない |
| `expo-speech` | **不要**（パッチ削除） | 58.0.3 の iOS が `options.volume` を受けて `utterance.volume` に渡すようになった |

⚠️ **SDK 58 は Expo モジュールをプリコンパイル済み XCFramework で入れる（`EXPO_USE_PRECOMPILED_MODULES`）が、RN コアをソースビルドしていると自動で無効になる**（`RCT_USE_PREBUILT_RNCORE=1` が無いと無効化される）。このアプリは `buildReactNativeFromSource: true` なので今は効かない＝icloud-storage のパッチも通る。**将来 RN のパッチが全部不要になってソースビルドを外すときは、プリコンパイルが有効になって node_modules の Swift パッチが黙って効かなくなる**（`ios.usePrecompiledModules: false` などで外す必要がある）。

**ネイティブの構成**

- `withPrebuiltRNDeps`：SDK 58 のテンプレートの Podfile にもアンカーの `ENV['RCT_USE_RN_DEP'] ||= …` 行がある＝そのまま通る見込み。
- `withKeyCommands`：**SDK 58 の AppDelegate は `class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {`** なので、アンカー `/class AppDelegate:\s*ExpoAppDelegate\s*\{/` に一致せず prebuild で throw する＝正規表現を `class AppDelegate:[^{]*\{` などへ直す。ブリッジヘッダ（`<project>-Bridging-Header.h`）はテンプレートに残っている。
- UIScene でも責任者チェーンは view → VC → window → scene → `UIApplication` → **AppDelegate**（`UIResponder` のとき）なので、AppDelegate の `keyCommands` は理屈上は拾われる。SceneDelegate（`ExpoAppSceneDelegate`）はチェーンに入らないので注入先にしない。実機での確認は Phase 2 のとおり。
- `expo.install.exclude` の `react-native-webview`：SDK 58 のピンは **14.0.1**（13.16.1 以上）＝exclude を外してピンに戻せる。14.0.0 の破壊的変更は Android の最低 API 24 だけ（iOS の記載なし）。

**このアプリで当たる破壊的変更（SDK 55〜58）**

| SDK | 変更 | このアプリでの対応 |
|---|---|---|
| 55 | 旧アーキテクチャ撤去・`newArchEnabled` を app.json から削除／Android の `edgeToEdgeEnabled` 削除 | app.json の `newArchEnabled: true`・`android.edgeToEdgeEnabled` を消す |
| 55 | expo-status-bar の `backgroundColor`/`translucent` が無効化 | 使っていない（`style`/`hidden`/`setStatusBarHidden`/`setStatusBarStyle` だけ）＝影響なし |
| 56 | **expo-router が React Navigation に依存しなくなり、アプリから `@react-navigation/*` を import できない**（バンドラがエラーにする） | 9ファイル：`useFocusEffect`（7）・`useIsFocused`/`useNavigation`（`app/study/session.tsx`）・`ThemeProvider`/`DarkTheme`/`DefaultTheme`（`app/_layout.tsx`）→ **`expo-router` から**／`getDefaultHeaderHeight`（`lib/useLockedTopInset.ts`）→ **`expo-router/react-navigation`**（中身は今と同じ＝Dynamic Island の −5.33 補正もそのまま）。codemod `npx expo-codemod sdk-56-expo-router-react-navigation-replace` あり。`package.json` の `@react-navigation/*` 3つも外す。CLAUDE.md の記述も直す |
| 56 | 最低 iOS 16.4・最低 Xcode 26.4・Hermes V1 が既定・TypeScript 6.0.3 | iOS 16.4 未満の端末（iPhone 7・初代 SE・iPad Air 2 など）がサポート外になる＝ストアの対応 OS が上がる。Hermes V1 で `Intl` の有無が変わるか（`Intl.PluralRules`・`Intl.DisplayNames` が無い前提の実装がある）を Phase 3 で見る |
| 56 | expo-file-system の新 API の `copy()`/`move()` が非同期化 | 使っているのは `expo-file-system/legacy` だけ（58 にも残っている）＝影響なし |
| 56 | `expo/fetch` が `globalThis.fetch` に | C++ の Wandbox 呼び出し（`AbortController` のタイムアウト）を Phase 3 で確認 |
| 58 | **RN 0.88：`InteractionManager` 削除**・`react-native/Libraries/*` の deep import が型エラー・ref の型が `ViewInstance` などへ | アプリ本体は `InteractionManager`・deep import とも未使用（draggable-flatlist のパッチだけ＝上の表）。ref の型は `tsc` で洗い出す（`DraggableFlatList` の `ref as any` 周り） |
| 58 | **iOS 26 以降で Stack の標準ヘッダーが既定で透明（Liquid Glass）・内容がヘッダーの下に潜る**（`headerTransparent` の既定が iOS だけ true） | push 画面・入力系モーダルは全部 `headerShown: false` なので影響なし。標準ヘッダーなのは **`paywall`（`presentation: 'modal'`）** ＝`headerTransparent: false` を付けるか見た目を確認。タブの標準ヘッダー（学習/統計/設定）は JS のタブのヘッダーなので対象外のはずだが Phase 3 で見る |
| 58 | **`navigation.addListener('beforeRemove')` 削除**（`removed`/`removePrevented` へ） | `hooks/useDismissKeyboardOnLeave.ts`（入力系6画面＋検索で使用）＝`blur` は残るので `beforeRemove` を外すか置き換える |
| 58 | `useNavigation` は navigator の外で throw／`dispatch` は commit 後に遅延／`router.push` の `screen`/`params` を入れ子の指示と見なさない／`freezeOnBlur` 無効 | 該当なし（`dispatch`・入れ子の push・`freezeOnBlur` は未使用）。`useNavigation` は `session.tsx` と `useShortcutsHeader` で画面内からだけ使用 |
| 58 | expo-notifications：`setNotificationHandler` が無いとフォアグラウンドで表示が既定に | `lib/notifications.ts` で明示的に登録している＝影響なし |
| 58 | expo-sqlite の libSQL 削除 | 未使用。`scripts/db-harness.ts` の互換 API（`openDatabaseAsync`・`runAsync` 等）は変更なし |
| 58 | expo-localization：iOS で端末のロケールから RTL を強制しない | 右から左の言語に未対応＝影響なし |
| 58 | `Linking.parse()` がクエリを二重デコードしない | 未使用（`Linking.openURL` だけ） |
| 58 | Expo CLI が `NODE_ENV` を上書き | `.env` が無い＝影響なし |

**gesture-handler 3（2.28 → 3.3）**

- `Gesture.Pan()`/`Gesture.Tap()` と `GestureDetector`（アプリの6ファイル）は**旧 API のまま動く**（v3 の `GestureDetector` が旧 API のジェスチャーを受けると旧実装へ回す）。
- ⚠️ `ScrollView`/`FlatList` は名前そのままで**新実装に置き換わった**（旧実装は `LegacyScrollView`/`LegacyFlatList`）。**新旧の API の間では simultaneous などの関係を結べない**ので、旧 API のジェスチャー（カード送りの横 Pan・draggable のドラッグ）と同じ場所で使っている `ScrollView`（`ExecutionOutput`・`TextBlockItem`・`CodeBlockItem`・`ActivityHeatmap`）は、**まず `LegacyScrollView` に差し替えて挙動を据え置く**のを推奨（ジェスチャーをフックの API へ移すのは別作業）。新実装の `ScrollView` は `keyboardShouldPersistTaps="handled"` のときキーボードの閉じ方を自前で持つようになっている点も、据え置きを推す理由。
- ⚠️ `ReanimatedSwipeable`（`components/SwipeToDeleteRow.tsx`）は**新 API で書き直された**（旧版は残っていない）。`dragOffsetFromRight` が負の値を受けるようになり「正の値は符号を反転する」との記載＝`dragOffsetFromRightEdge={28}` の意味が変わっていないかを確認する。draggable-flatlist（旧 API）の行の中で使っているので、上の「新旧で関係を結べない」にも当たりうる＝スワイプとドラッグ並べ替えの共存は Phase 3 の重点。

**決めること（3）への材料**：SDK 55・56・58 にそれぞれ別の大きな変更（旧アーキ撤去／React Navigation 離脱／RN 0.88・gesture-handler 3）がある。一気に上げて `tsc`・バンドルのエラーを順に潰すのが早いが、実行時の挙動（ジェスチャー・ヘッダー）が崩れたときは原因が SDK 58 側（RN 0.88・gesture-handler 3・ヘッダー）にほぼ集中しているので、切り分けのために1つずつ上げる必要は薄い。

### Phase 1：依存を上げて JS 側を通す

- [x] `npx expo install expo@^58` → `npx expo install --fix`（一気に 54 → 58。`expo` は `~58.0.19`）
- [x] `npx expo-doctor`（20/20 通過）
- [x] `npx tsc --noEmit`（0 件）・`npm run lint`（エラー 0・警告 358）
- [x] 検証ハーネス：`verify:db`（228）・`verify:speech`（196）・`verify:timer`（17）・`verify:i18n`（エラー 0）・`verify:pyrequests`（63）・`verify:markdown`（46）すべて成功。ハーネスの修正は不要だった（TypeScript 6 対応の `/// <reference types="node" />` だけ）
- [x] `npx expo export --platform ios` で JS のバンドルが通る
- [x] `@react-navigation/bottom-tabs`・`elements`・`native` を package.json から外す（アプリからの import は無くなった）

#### Phase 1 でやったこと（2026-10-26）

- **依存**：`react-native-webview` を `expo.install.exclude` から外してピンの 14.0.1 へ。i18next 25 が TypeScript 6 を許さず衝突したので、同じメジャーの最新（i18next 25.10.10・react-i18next 16.6.6）へ。
- **パッチ**（Phase 2 の項目だが postinstall が通らないので先にやった）：`expo-speech`・`slider` のパッチを削除。`react-native` は 0.88.0 向けに3ファイル（KAV・Fabric ScrollView のリモートキーボード除外・文字描画 +1pt）で作り直し。`draggable-flatlist` は `InteractionManager.runAfterInteractions` → `requestIdleCallback`（RN の案内どおり）＋ライブラリ内の `FlatList`/`ScrollView` を `LegacyFlatList`/`LegacyScrollView` に。key-command・icloud-storage はそのまま当たる。
- **`@react-navigation/*` → `expo-router`**（9ファイル）：`useFocusEffect`・`useIsFocused`・`useNavigation`・`ThemeProvider`・`DarkTheme`・`DefaultTheme` は `expo-router`、`getDefaultHeaderHeight` は `expo-router/react-navigation`。
- **`beforeRemove` の削除**：`hooks/useDismissKeyboardOnLeave.ts` から外した（代わりの `removed` はアンマウント後に届く＝既存のアンマウント時の保険と同じなので足さない）。
- **gesture-handler 3**：アプリの `ScrollView`（4ファイル）を `LegacyScrollView` に。`ReanimatedSwipeable` の `dragOffsetFromRightEdge={28}`/`dragOffsetFromLeftEdge={28}` → `dragOffsetFromRight={-28}`/`dragOffsetFromLeft={28}`（改名＋右は 0 以下。正の値は開発ビルドで例外）。
- **RN 0.88 の型**：ref の型を `ScrollViewInstance`・`TextInputInstance`・`ViewInstance` へ、`StyleSheet.absoluteFillObject` → `absoluteFill`、`FlatList` の `ListHeaderComponent`/`ListEmptyComponent` に `null` ではなく `undefined`、`isRemoteKeyboardEvent` の引数を `KeyboardEvent`（Android の通知には `isEventFromThisApp` が無い）、タブアイコンの `color` を `ColorValue`。react-native-webview 14 の型が `WebView<P = undefined>`＝props が never になるので `useRef<WebView<object>>`。
- **`expo-modules-core`** が `expo` の配下に入ったので `lib/sync/icloud.ts` は `requireNativeModule` を `expo` から import。
- **app.json**：`newArchEnabled`・`android.edgeToEdgeEnabled` を削除。`paywall` に `headerTransparent: false`（iOS 26 以降の透明ヘッダーを避けて従来の見た目に据え置く）。
- **lint**：eslint-config-expo 58 から React Compiler の診断（`react-hooks/refs` など5規則・計 337 件）がエラーで入った＝既存コードの書き方への指摘で、移行の不具合ではない。**当面は警告に落とした**（`eslint.config.js`）。直すのは別作業。`app-example/`（gitignore 済みのテンプレートの残り）は lint の対象から外した。

### Phase 2：ネイティブを作り直す（Xcode 27）

- [x] パッチを当て直し、`npx patch-package` で作り直す（不要になったものは削除）→ Phase 1 で実施済み
- [x] `npx expo prebuild --clean -p ios`
- [x] `withKeyCommands`・`withPrebuiltRNDeps` が通るか → `withKeyCommands` のアンカーを `/class AppDelegate:\s*ExpoAppDelegate\b[^{]*\{/` に直した（SDK 58 は `class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {`）。`withPrebuiltRNDeps` はそのまま通る。ブリッジヘッダも生成される
- [x] `ios/Podfile.lock` の構成 → `React-Core` は `../node_modules/react-native/`（ソース）＋`ReactNativeDependencies`（プリビルド）。⚠️ RN 0.88 では **`fmt`・`glog`・`fast_float` が Pod として載るが、中身は `build/rndeps-facades/fmt` のファサード（`ReactNativeDependencies` に依存するだけ）＝ソースからはビルドしない**。「`fmt` Pod が無い」ではなく「`fmt` が `:path: build/rndeps-facades/fmt`」を見る（CLAUDE.md の確認方法も Phase 5 で直す）
- [x] Xcode 27 でビルド（`DEVELOPER_DIR=/Applications/Xcode-27.1.app/Contents/Developer`・`-derivedDataPath ios/build/sdk58`）→ **RevenueCat 5.72.0 が新しい Swift で `invalid redeclaration of synthesized memberwise 'init(stringRepresentation:)'`** になった。RevenueCat は 5.78.0 で Xcode 27 対応済みなので、`react-native-purchases` を同じメジャーの **10.15.1**（PurchasesHybridCommon 19.14.1・RevenueCat 5.96.1）へ上げて解決（`pod update PurchasesHybridCommon RevenueCat RNPurchases`）。ローカルモジュール2つ（`modules/*/ios/*.podspec`）の最低 iOS を 15.1 → 16.4 に（pod install が警告して引き上げていた）
- [x] 起動して真っ白にならない（UIScene）→ iPhone 18 Pro（iOS 27.0 シミュレータ）でホーム画面まで表示。⚠️ Duo（iOS 27.1）は `simctl` でヘッドレス起動すると画面写真が真っ黒だった（JS は動いていた）＝Device Hub で開いた状態で Phase 4 で確かめる
- [x] **ハードウェアキーボードのショートカットが効く**（keyCommands の責任者チェーン）→ `?`（一覧）・Tab（タブ切替）・N（新規デッキ）が効いた＝UIScene でも AppDelegate の `keyCommands` が拾われる

⚠️ **シミュレータで dev client を Metro へつなぐとき**：`simctl openurl` で `codeflashcard://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081` を開くと、iOS 27 は「"CodeFlash" で開きますか？」の確認を出す（コマンドからは押せない）。`simctl` で起動したシミュレータはヘッドレスなので、`open /Applications/Xcode-27.1.app/Contents/Applications/DeviceHub.app` で Device Hub を開いて画面を出して押す（または dev client の「Enter URL manually」）。⚠️ `npx expo run:ios` は `xcode-select` の Xcode 26.6 でビルドし直すので、Xcode 27 の確認には使わない。

⚠️ **このブランチで作った `ios/`・`node_modules` は SDK 58 のもの**。main（SDK 54）へ戻って作業するときは `npm install` → `npx expo prebuild --clean -p ios` をやり直す（`ios/` は gitignore の生成物）。

### Phase 3：動作確認（シミュレータ → 実機）

OS 依存の実装が集中している順：

確認用データは、アプリの DB 層（`scripts/db-harness.ts`）で作った DB をシミュレータのアプリの `Documents/SQLite/codeflash.db` に差し替えて入れた（3デッキ・50枚＝コード実行8種・並べ替え40枚・読み上げ2枚。Pro は設定タブの Pro カードの長押し＝開発ビルドの切り替え）。

- [x] HTML/CSS プレビュー（WKWebView・`window.open` → Safari・`window.close()`・フォーム送信のリロード・相対 URL でクラッシュしない）→ iPhone 18 Pro（iOS 27.0 シミュ）で OK（10/26）
- [x] コード実行後のステータスバーとヘッダー高さ（`useLockedTopInset`・Dynamic Island の −5.33 補正）→ iPhone 18 Pro で OK。あわせて iPhone で、編集プレビューのコードの横スクロール（`LegacyScrollView`）・カード一覧/学習画面のキー操作・学習のスワイプ送り・読み上げ・声の一覧・写真ピッカー・通知の許可も OK
- [x] iPad：ウィンドウ表示の赤黄青ボタンの補正（`useWindowControlsTopInset`）→ iPad Pro 11（M5・iOS 27.0 シミュ）で OK。4タブのヘッダーの高さもそろう
- [ ] **実機で確認する**：iPad の Split View で隣のアプリのキーボードを出したときのエディタ（パッチ①）・キーボードを出したまま閉じた後の無限スクロール（パッチ②）（シミュレータには入力できる標準アプリがほぼ無いため）
- [x] ハードウェアキーボード：矢印・Tab の iPad 優先・PageUp/PageDown/Home/End（パッチ）→ iPad シミュで OK（ホームの ↑/↓・Tab/⇧Tab・学習画面の H/L・PageUp/PageDown/Home/End のキー・U/D・⇧U/⇧D・編集中の矢印でカーソル移動）。⚠️ fn＋矢印は Device Hub が「fn 付きの矢印」として送るので効かない＝割り当ては PageUp などのキーそのもの（無いキーボード向けは U/D・⇧U/⇧D）で、移行による変化ではない
- [ ] **実機で確認する**：Split View 往復後のハードウェアキーボード
- [x] スライダー（範囲の違う設定を続けて開く・ドラッグでちらつかない）・ドラッグ並べ替え（同じ位置に落とした後のオートスクロール）→ OK（slider パッチ削除後も問題なし）。あわせてスワイプ行（左＝アーカイブ/削除・右＝ここから学習・斜めの縦スクロールが取られない）も OK
- [x] カード一覧の2行目が空白にならない（パッチ④）→ OK
- [ ] **実機で確認する**：画面キーボードを出したまま入力画面を閉じた後、次の画面が下端を越えてスクロールしない（シミュレータは Device Hub がハードウェアキーボード扱いで画面キーボードが出ないため実機へ回した）
- [ ] **実機で確認する**：通知の発火・バッジ・iCloud 同期（アップロード完了の判定）・読み上げの AirPods のプツッ（通知の許可・写真ピッカー・読み上げ・声の一覧はシミュで OK）
- [x] Python（Pyodide）・SQL・C++（Wandbox）の実行 → OK（JS の setTimeout 延長・CSS の土台装飾も OK）

### Phase 4：iPhone Duo

- [ ] 閉じた状態・開いた状態・開閉の途中で、レイアウトが追従する
  - [x] **開閉・回転の途中、幅から JS で計算した値が1〜2コマ古いまま出る**（新しい幅・safe area が JS に届くのが画面より遅れるため）→ ホームのフィルターブロックは `width` の計算をやめ、空き2つを足して `flex: 1` の4列に（学習タブと同じ＝ネイティブのレイアウトが同じコマで割り直す）。回転時のヘッダーの高さは、画面の大きさが変わってから1秒間 `useLockedTopInset` がその場で新しい上端を返す（描き直し1回ぶん短くなった）。`rs()` のボタンの余白・角の余白の遅れは許容（％指定では表せない・iPad のステージマネージャでも同じ）
  - [x] **開いた縦で回転・開閉した後、閉じてもヘッダーが伸びたまま戻らない** → 修正（`useLockedTopInset` は「見た最大の上端を保持」なので、開いた縦の 82 を閉じた後も持ち続けていた。画面の大きさが変わったら1秒間は下方向にも追従する）。実測の safe area：閉じた状態 466×678＝上 0・右 84／開いた縦 669×951＝上 82／開いた横 951×669＝上 0・右 84。⚠️ iPhone の向きの固定（`orientation: portrait`）は Duo を開いた状態では効かず横にも回る
  - [x] **閉じた状態・開いた横で、右 84pt（カメラ＋ステータスバーの帯。閉じた状態は右上へ縦に移る）に自前ヘッダーと本文が潜る**＝アプリ全体で左右の safe area を見ていなかった。A 案（上から下まで避ける・ヘッダーは背景を端まで伸ばして中身だけ避ける）で対応する（2026-10-27 決定）→ 対応済み：本文は根元で避ける（Stack＝`contentStyle`／タブの4画面＝各画面の根元・`(tabs)` には付けない＝標準ヘッダーとタブバーが自分で避けるので二重になる）・自前ヘッダーは `useHeaderHorizontal()`（背景は端まで・ボタン行だけ内側）・全画面のプレビュー2つ（別 VC）は自前で避ける。Duo の閉じた状態・開いた横、今までの iPhone で見た目を確認済み
  - ⚠️ lint の警告は変更前の時点で 386 件（チケットの基準 358 件より 28 件多い）＝今回の変更では増えていない。どこで増えたかは未調査
- [x] **`Platform.isPad` に依存する箇所の扱いを決める**（下の「決めること」）→ 寸法（`usePadScale`）は**iPhone でも窓の幅で補間する**（`IS_PAD` ゲートを外した。iPhone は縦固定で幅 440pt 以下＝0 のまま不変。Duo は開いた縦 669pt＝中間・開いた横 951pt＝iPad 寸法）。矢印・Tab・`scrollsToTop`・`useLockedTopInset` は端末の判定のまま。ダイアログの幅・学習画面のヘッダーの分岐・統計の列幅など `isPad` で直接分けている箇所は、下の見た目の確認で崩れていなければ触らない
  - [x] **開いた横向きでヘッダーが細い（32pt）・ホームとほかのタブで高さが違う** → `getDefaultHeaderHeight` は iPhone の横向きに 32pt を返す（縦固定なので今まで当たらなかった）。iPad ではない端末の横向きは縦と同じ計算にし、タブの標準ヘッダーにも同じ高さを `headerStyle.height` で渡してそろえた
  - [x] **閉じた状態・開いた横で、左上の検索・戻るボタンが画面の角に窮屈** → 上端の safe area が 0＝ヘッダーの行が画面の角の丸みに接している。そのときだけ、safe area の無い側に角の余白 `rs(4, 24)`（閉じた状態 約 6pt・開いた横 24pt）を**行の内側の余白**として足す（行の位置に足すと中央のタイトルが半分だけずれた）。標準ヘッダーは `useShortcutsHeader` の左右のコンテナに同じ値を足す
- [ ] 学習画面のカードの幅・フィルターブロック（`useBlockMetrics`）・一覧行の数字が、開いた幅で破綻しない

### Phase 5：仕上げ

- [ ] CLAUDE.md の更新（技術スタックの版・パッチの記述・`withPrebuiltRNDeps` の要否・`expo.install.exclude`・Xcode 26.6 の直接起動の話は不要になる）
- [ ] メモリの更新（`project_ios27-and-sdk-upgrade`）
- [ ] TestFlight で実機確認してからリリース
- [ ] main へ入れた後、React Compiler の lint（Phase 1 で警告に落とした5規則・計337件）を直す専用チケットを作る＝1規則ずつ直し、直した規則は `eslint.config.js` の `'warn'` 行を消してエラーに戻す（2026-10-26 合意）。それまでは lint の警告が 358 件より増えていないかを見る

---

## 決めること

1. **作業場所**：ふだんは main へ直接コミットしているが、この移行は数日〜それ以上 main がビルドできない状態になりうる。
   その間に v1.13.x の修正版を出す必要が出ると困るので、**この作業だけはブランチ（または worktree）で進め、通ってから main へ入れる**のを推奨する。
2. **Duo の開いた状態を iPhone として扱うか iPad 寄りに扱うか**：このアプリは `Platform.isPad` で分けている箇所が多い（`useResponsiveSize` は iPhone なら 0 固定＝常に iPhone 寸法／`MAX_FONT_MULTIPLIER`／矢印・Tab の登録有無／ショートカット一覧のキーの幅）。
   Duo は `isPad` が false のはずなので、開いても iPhone の寸法のまま広がる。まず Phase 4 でそのまま見てみて、間延びするなら `rs()` の「iPhone は 0 固定」を幅で判定する形にするかを決める（⚠️ 横向きの大型 iPhone で iPad 寸法に化けないようにする条件が要る）。
   → **決定（2026-10-27）：iPhone でも幅で補間する**。開いた状態は横向きが主なので「縦向きのときだけ」の条件は付けない（iPhone は縦固定なので、横向きで iPad 寸法に化ける心配は無い）。
   ⚠️ 矢印・Tab の扱い（iPad のフォーカスエンジン対策）は**端末の判定のまま**にする＝幅で切り替えるものではない。
3. **1つずつ上げるか一気に上げるか**：一気（54 → 58）が早いが、壊れたときにどの SDK の変更か切り分けにくい。Phase 1 で一気に試し、詰まったら1つずつに戻す。

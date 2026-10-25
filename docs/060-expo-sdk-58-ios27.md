# 060 Expo SDK 58 への移行（iOS 27 SDK でのビルド・UIScene 対応・iPhone Duo）

**フェーズ:** Phase 0〜5
**ステータス:** 未着手
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

- [ ] 審査中のバージョンが無いことを確認する
- [ ] Expo の SDK 55・56・57・58 のリリースノート／アップグレードガイドの「破壊的変更」を読み、このアプリで当たるものを一覧にする（expo-router・expo-sqlite・expo-notifications・expo-speech・reanimated・gesture-handler は特に）
- [ ] 上の表の6パッチについて、移行先の版で直っているか・当て直しが要るかを調べる
- [ ] Apple の iOS 27 SDK 必須化の期限を確認する
- [ ] 作業場所を決める（下の「決めること」）

### Phase 1：依存を上げて JS 側を通す

- [ ] `npx expo install expo@^58` → `npx expo install --fix`（4つ飛ばしで不具合が切り分けにくければ 55 → 56 → 57 → 58 と1つずつ）
- [ ] `npx expo-doctor`
- [ ] `npx tsc --noEmit`・`npm run lint`
- [ ] 検証ハーネス：`verify:db`・`verify:speech`・`verify:timer`・`verify:i18n`・`verify:pyrequests`・`verify:markdown`（`scripts/db-harness.ts` が expo-sqlite 互換を前提にしているので、API が変わっていればハーネス側を直す）

### Phase 2：ネイティブを作り直す（Xcode 27）

- [ ] パッチを当て直し、`npx patch-package` で作り直す（不要になったものは削除）
- [ ] `npx expo prebuild --clean -p ios`
- [ ] `withKeyCommands`・`withPrebuiltRNDeps` が通るか（失敗したら AppDelegate／Podfile の新しい形に合わせて直す）
- [ ] `ios/Podfile.lock` で「`React-Core (from ../node_modules/react-native/)` と `ReactNativeDependencies` が共存・`fmt` Pod が無い」を確認
- [ ] Xcode 27 でビルド（`xcode-select` を 27 に切り替えるか `DEVELOPER_DIR` を付ける）
- [ ] 起動して真っ白にならない（UIScene）
- [ ] **ハードウェアキーボードのショートカットが効く**（keyCommands の責任者チェーン）

### Phase 3：動作確認（シミュレータ → 実機）

OS 依存の実装が集中している順：

- [ ] HTML/CSS プレビュー（WKWebView・`window.open` → Safari・`window.close()`・フォーム送信のリロード・相対 URL でクラッシュしない）
- [ ] コード実行後のステータスバーとヘッダー高さ（`useLockedTopInset`・Dynamic Island の −5.33 補正）
- [ ] iPad：ウィンドウ表示の赤黄青ボタンの補正（`useWindowControlsTopInset`）・Split View で隣のアプリのキーボードを出したときのエディタ（パッチ①）・キーボードを出したまま閉じた後の無限スクロール（パッチ②）
- [ ] ハードウェアキーボード：矢印・Tab の iPad 優先・PageUp/PageDown/Home/End（パッチ）・Split View 往復後
- [ ] スライダー（範囲の違う設定を続けて開く・ドラッグでちらつかない）・ドラッグ並べ替え（同じ位置に落とした後のオートスクロール）
- [ ] カード一覧の2行目が空白にならない（パッチ④）
- [ ] 通知・バッジ・iCloud 同期（アップロード完了の判定）・写真ピッカー・読み上げ（声の一覧・AirPods のプツッ）
- [ ] Python（Pyodide）・SQL・C++（Wandbox）の実行

### Phase 4：iPhone Duo

- [ ] 閉じた状態・開いた状態・開閉の途中で、レイアウトが追従する
- [ ] **`Platform.isPad` に依存する箇所の扱いを決める**（下の「決めること」）
- [ ] 学習画面のカードの幅・フィルターブロック（`useBlockMetrics`）・一覧行の数字が、開いた幅で破綻しない

### Phase 5：仕上げ

- [ ] CLAUDE.md の更新（技術スタックの版・パッチの記述・`withPrebuiltRNDeps` の要否・`expo.install.exclude`・Xcode 26.6 の直接起動の話は不要になる）
- [ ] メモリの更新（`project_ios27-and-sdk-upgrade`）
- [ ] TestFlight で実機確認してからリリース

---

## 決めること

1. **作業場所**：ふだんは main へ直接コミットしているが、この移行は数日〜それ以上 main がビルドできない状態になりうる。
   その間に v1.13.x の修正版を出す必要が出ると困るので、**この作業だけはブランチ（または worktree）で進め、通ってから main へ入れる**のを推奨する。
2. **Duo の開いた状態を iPhone として扱うか iPad 寄りに扱うか**：このアプリは `Platform.isPad` で分けている箇所が多い（`useResponsiveSize` は iPhone なら 0 固定＝常に iPhone 寸法／`MAX_FONT_MULTIPLIER`／矢印・Tab の登録有無／ショートカット一覧のキーの幅）。
   Duo は `isPad` が false のはずなので、開いても iPhone の寸法のまま広がる。まず Phase 4 でそのまま見てみて、間延びするなら `rs()` の「iPhone は 0 固定」を幅で判定する形にするかを決める（⚠️ 横向きの大型 iPhone で iPad 寸法に化けないようにする条件が要る）。
   ⚠️ 矢印・Tab の扱い（iPad のフォーカスエンジン対策）は**端末の判定のまま**にする＝幅で切り替えるものではない。
3. **1つずつ上げるか一気に上げるか**：一気（54 → 58）が早いが、壊れたときにどの SDK の変更か切り分けにくい。Phase 1 で一気に試し、詰まったら1つずつに戻す。

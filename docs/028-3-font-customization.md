# 028-3 デッキ・カードのカスタマイズ（フェーズ3: フォント変更）

**フェーズ:** v1.6 候補
**ステータス:** 未着手
**依存:** 013（ダークモード）, 016（Pro 課金）, 028-2（カード表示テーマ）
**被依存:** ―

---

## 概要

アプリ全体のフォントを **数種類のプリセット**から選択できるようにする Pro 機能。
028-1（デッキの識別）、028-2（カード背景の雰囲気）に続き、本フェーズは
**文字そのもの**のカスタマイズを提供し、「自分のアプリ感」を完成させる。

ただし日本語フォントはバンドルサイズが大きく App Store の DL サイズに直結するため、
**MVP は最小スコープ（システム + 丸ゴシック1種）**で出し、ユーザー反応を見てから
追加プリセットを検討する慎重なロードマップを取る。

---

## スコープ

### 含むもの（MVP）
- グローバル設定 `fontFamilyPreference`（`'system' | 'rounded'`）の2択
- `'rounded'` = Noto Sans JP Rounded（または LINE Seed JP 等の丸ゴシック日本語フォント）
- `expo-font` でバンドル（**Subset 化**で容量削減を試みる）
- アプリ全体の `Text` に適用（コードブロックは除外、モノスペース固定）
- 非 Pro はプリセット選択 UI で `'rounded'` を選択するとペイウォール起動

### 含まないもの（将来候補）
- 3種類目以降のフォント（serif・手書き風など）→ MVP の反応を見てから判断
- フォントサイズの個別調整（既存の `fontSizePreference` で十分）
- デッキ別フォント（複雑度の割に訴求が弱い）
- ユーザー任意フォントの読み込み（管理コストが高い）
- コードブロックのフォント変更（モノスペース固定）

---

## Todo

### フォント選定・調査
- [ ] **ライセンス確認**: SIL OFL / Apache License など商用利用可フォントに限定
- [ ] 候補フォント
  - [ ] Noto Sans JP Rounded（Google Fonts, SIL OFL）
  - [ ] LINE Seed JP（LINE 社, SIL OFL 相当）
  - [ ] その他: M PLUS Rounded 1c（SIL OFL）
- [ ] バンドルサイズ実測（Regular / Bold の2 weight で MB 単位の確認）
- [ ] Subset 化の検討
  - [ ] 日本語常用漢字 + ひらがな + カタカナ + 英数記号で部分集合化
  - [ ] `pyftsubset`（fontTools）等で TTF を縮小
  - [ ] ユーザー入力テキストは subset 外の文字を含み得るため、**完全 subset は危険**
  - [ ] 安全策: ひらがな・カタカナ・JIS 第一水準漢字までを含める最小構成

### パッケージ・設定
- [ ] `expo-font` が未導入なら追加（Expo 54 同梱の可能性あり、要確認）
- [ ] `assets/fonts/` ディレクトリ作成
- [ ] フォントファイル配置（Regular / Bold の2 weight 推奨）
  - [ ] `NotoSansJPRounded-Regular.ttf`
  - [ ] `NotoSansJPRounded-Bold.ttf`
- [ ] `app.json` の `assets` または `expo-font` プラグインで読み込み宣言

### フォントロード
- [ ] `app/_layout.tsx` で `useFonts({ ... })` を呼び出し
  - [ ] ロード完了まで `<RootStack />` を描画しない（既存の `hydrated` チェックと並列）
  - [ ] SplashScreen を維持
- [ ] フォントロード失敗時はシステムフォントにフォールバック（クラッシュさせない）

### 設定ストア
- [ ] `store/settings.ts`
  - [ ] `fontFamilyPreference: 'system' | 'rounded'`（初期値: `'system'`）
  - [ ] `setFontFamilyPreference(name)` アクション
  - [ ] AsyncStorage 永続化（専用キー `@codeflash_font_family`）

### フォント適用
- [ ] 適用方式の決定（推奨: **B 案 = AppText 化**）
  - [ ] A 案: `Text.defaultProps.style.fontFamily` でグローバル適用
    - [ ] 利点: 既存コード無変更
    - [ ] 欠点: defaultProps は React Native で非推奨、3rd-party コンポーネントに効かない
  - [ ] B 案: 全 `Text` を `<AppText>` に置換
    - [ ] 利点: 明示的・型安全・将来拡張容易
    - [ ] 欠点: 既存全画面の `Text` 置換コストが大きい
- [ ] `components/AppText.tsx` を新規作成（B 案採用時）
  - [ ] `useTheme()` から `fontFamily` を取得して `style` にマージ
  - [ ] `Text` の全 props を透過
  - [ ] `maxFontSizeMultiplier` も既定値（`MAX_FONT_MULTIPLIER.ui`）を持たせる
- [ ] 既存 `Text` を `AppText` に一括置換（IDE のリファクタリング機能）
- [ ] 例外: コードブロック関連は `Text` のまま（モノスペース固定）
  - [ ] `components/study/SyntaxHighlightedCode.tsx`
  - [ ] `components/editor/CodeBlockItem.tsx`
  - [ ] `components/code/ExecutionOutput.tsx`

### テーマフック拡張
- [ ] `lib/theme/index.ts` の `useTheme()` を拡張
  - [ ] `fontFamily: string | undefined` を返す
  - [ ] `'system'` のときは `undefined`（RN がシステムフォントを使う）
  - [ ] `'rounded'` のときは `'NotoSansJPRounded-Regular'`（読み込み名と合わせる）
  - [ ] Bold weight は `'NotoSansJPRounded-Bold'` を返す別プロパティ `fontFamilyBold` も追加

### Bold 対応
- [ ] React Native は `fontWeight: 'bold'` 指定で自動的に Bold ウェイトを選ばない（特に日本語フォントで顕著）
- [ ] `AppText` で `style.fontWeight === 'bold' | '600' | '700'` のときに `fontFamilyBold` を当てる
- [ ] 既存の `fontWeight: '600' / '700'` 多用箇所で正しく Bold 描画されるか目視確認

### 設定画面 UI
- [ ] `app/settings/display.tsx` に「フォント」セクションを追加
  - [ ] ラジオ風の2択リスト
    - [ ] 「システム」/「丸ゴシック」
  - [ ] 各項目に「あいうえお ABCDE」サンプル文字を表示（フォント切替の実感を持たせる）
  - [ ] 選択中はチェックマーク
  - [ ] Pro ガード: `'rounded'` 選択時のみペイウォール起動（`'system'` は常に選択可能）

### Pro ガード
- [ ] 選択時にペイウォール起動
- [ ] Pro 失効時は `'system'` に戻す処理を `setIsPro(false)` 内で実装
- [ ] AsyncStorage の値も `'system'` に書き戻す

### i18n
- [ ] `ja.json` / `en.json` 両方に追加
  - [ ] `display.fontFamily` — 「フォント」/ "Font"
  - [ ] `display.fontSystem` — 「システム」/ "System"
  - [ ] `display.fontRounded` — 「丸ゴシック」/ "Rounded"
  - [ ] `display.fontSampleText` — 「あいうえお ABCDE 12345」/ "AaBbCc 12345 こんにちは"
  - [ ] `paywall.fontFamily` — 「フォント変更は Pro 機能です」/ "Custom fonts are a Pro feature"

### 動作確認
- [ ] フォント切替がアプリ全体に即座に反映される
- [ ] コードブロックはモノスペースのまま変わらない
- [ ] Bold（太字）が正しく描画される（特に日本語の Bold）
- [ ] 学習画面の表面・裏面・メモ・ボタンラベルすべて反映
- [ ] ホーム・タブ・統計・設定・モーダルすべて反映
- [ ] ペイウォール画面自体もフォント反映（ただし `'system'` 起動時にチラつきがないか）
- [ ] アプリ再起動後も選択フォントが保持される
- [ ] フォントロード失敗時にシステムフォントへフォールバックする
- [ ] **App Store DL サイズへの影響**を実測（Subset 化前後で比較）
- [ ] iCloud 同期では本設定は **同期しない**（端末ごとの好み）

### App Store / リリース
- [ ] フォントのライセンスを `app/legal/licenses` 等に記載（SIL OFL の表示義務）
- [ ] リリースノートで「アプリサイズが N MB 増加」を明示
- [ ] フォント差分が iOS の OTA アップデートに収まるか確認（Expo Updates 利用時）

---

## 設計メモ

### なぜ MVP は2択に絞るか
- 日本語フォントはバンドルサイズが大きい（NotoSansJP は2 weight で 5〜10 MB 級）
- 3種類目を入れるとアプリサイズが顕著に増え、Pro 訴求と相反する（重いアプリは敬遠される）
- ユーザーが本当に欲しいのは「システムフォント以外の選択肢が1つ」かもしれない
- 反応を見てから serif などを追加する方が ROI が高い

### Subset 化の現実的な範囲
- 完全 subset（カード本文に含まれる文字のみ）は危険：ユーザーが新規入力した文字が描画されない
- 安全策: JIS 第一水準漢字 + ひらがな + カタカナ + 英数記号
- 第二水準以降は描画時にシステムフォントへフォールバックされる（やや見た目が混ざる）
- 完全フォントを入れる場合のサイズと subset 版のサイズを比較してから判断

### Bold ウェイトの落とし穴
- iOS は日本語フォントの fontWeight を自動補間しない（合成 Bold はみすぼらしい）
- 必ず Regular と Bold の2ファイルを同梱する
- `AppText` で `fontWeight` を見て適切な family を選ぶロジックが必須
- これを怠ると「Pro にしたら太字が普通の太さに見える」という品質低下が起きる

### B 案（AppText 化）を推奨する理由
- React Native 公式が `Text.defaultProps` を実質非推奨化している
- 3rd-party ライブラリ（react-navigation のヘッダー等）は defaultProps を尊重しない
- 既存全画面の置換コストはあるが、一度やれば将来の変更が容易
- 028-1 / 028-2 で `useTheme()` パターンが定着しているため AppText も同じ流儀で書ける

### コードブロックを除外する理由
- プログラミング学習アプリにとってコード = モノスペースは絶対要件
- 丸ゴシック等で `if (x === y)` を描画すると `===` の整列が崩れて読めない
- `SyntaxHighlightedCode` の `fontFamily: 'monospace'` を死守する

### iCloud 同期から除外する理由
- 028-2 と同様、端末ごとの好み（読みやすさは画面サイズに依存）
- 設定が同期されると iPad と iPhone で同じになり不便なケースが多い

### Pro 失効時のフォールバック挙動
- `setIsPro(false)` で `fontFamilyPreference` を `'system'` にリセット
- ユーザーは設定画面で「Pro が必要」と表示される
- AsyncStorage の値も `'system'` に書き戻す

### ペイウォール表示時のチラつき対策
- ペイウォール起動 → 購入完了 → Pro 反映 → フォント切替 の流れで一瞬チラつき得る
- 解決策: ペイウォール画面自体は固定で `system` フォントで描画（チラつきを発生させない）
- 購入完了後の設定画面に戻った瞬間に新フォントが反映される

---

## 関連チケット

- **028（親）**: Pro 機能 追加候補
- **028-1**: 色付きアイコン
- **028-2（前フェーズ）**: カード表示テーマ
- **013**: ダークモード — `useTheme()` 拡張パターンの参考
- **016**: Pro 課金 — ペイウォール起動の連携

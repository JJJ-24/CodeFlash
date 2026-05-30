# 028-2 デッキ・カードのカスタマイズ（フェーズ2: カード表示テーマ）

**フェーズ:** v1.5 候補
**ステータス:** 実装完了（動作確認済み・コミット済み）
**配信:** Pro 機能
**依存:** 013（ダークモード）, 016（Pro 課金）, 028-1（色付きアイコン）
**被依存:** 028-3（フォント変更）

---

## 概要

学習画面（カード表面・裏面・メモ）の **背景・枠線・コードブロック背景**を
プリセットテーマから選択できるようにする Pro 機能。
028-1 がデッキ単位の差別化だったのに対し、本フェーズは **アプリ全体に効く
グローバル設定**として実装する。

学習時間が長いユーザーに対し「自分の好みの紙質・背景に長時間学習できる」という
体験価値を提供する。ライト/ダーク両モードでそれぞれ別パレットを用意し、
既存のテーマシステムを壊さずにレイヤーとして上乗せする。

---

## スコープ

### 含むもの
- グローバル設定 `cardThemePreference`（`'default' | 'paper' | 'mint' | 'graphite' | 'lavender' | 'sepia'`）
- 各プリセットごとに `{ background, memoBackground, border, codeBackground }` の4色定義
- ライト・ダーク両モードで別パレットを用意（同名でも実色が異なる）
- 適用箇所: 学習画面のカード本体（表面・裏面）・**メモ背景**・コードブロック背景
- メモ背景は本体背景と**同系の若干違う色**で差分表現（現状の `surface` と `memoBackground` の関係を踏襲）
- 設定画面（`app/settings/display.tsx`）にプリセット選択 UI
- 非 Pro は選択 UI を見せつつ、選択時にペイウォール起動

### 含まないもの
- シンタックスハイライト色のカスタマイズ（モノカラーの darkPlus 固定のまま）
- カード単位のテーマ（デッキ単位の `colorHex` は 028-1 で完結）
- ホーム/タブ/設定など学習画面外の背景
- ユーザー定義の自由色（カスタムカラーピッカー）
- グレードボタン（もう一度/うろ覚え/わかった/バッチリ）の色 — 既存カラー固定（可読性最優先）

---

## Todo

### プリセット定義
- [x] `lib/theme/cardThemes.ts` を新規作成
  ```ts
  export type CardThemeName = 'default' | 'paper' | 'mint' | 'graphite' | 'lavender' | 'sepia';

  export interface CardThemePalette {
    background: string;       // 表面・裏面のカード本体背景
    memoBackground: string;   // メモ背景（background と同系の少し異なる色）
    border: string;
    codeBackground: string;
  }

  export const CARD_THEMES: Record<'light' | 'dark', Record<CardThemeName, CardThemePalette>> = {
    light: {
      // ライト: memoBackground は background より僅かに濃い（現状 #FFFFFF → #EFEFEF の関係を踏襲）
      default:  { background: '#FFFFFF', memoBackground: '#EFEFEF', border: '#F0F0F0', codeBackground: '#2A2A2A' },
      paper:    { background: '#FAF7F0', memoBackground: '#F0EBE0', border: '#E8DFC8', codeBackground: '#2A2A2A' },
      mint:     { background: '#F2FBF7', memoBackground: '#E5F2EB', border: '#C7E8D9', codeBackground: '#1F3530' },
      graphite: { background: '#ECEEF1', memoBackground: '#DDE2EA', border: '#D5D9E0', codeBackground: '#1B1F26' },
      lavender: { background: '#F6F2FB', memoBackground: '#ECE4F4', border: '#DBCFEA', codeBackground: '#27203A' },
      sepia:    { background: '#F4ECDC', memoBackground: '#E8DEC6', border: '#D9C7A4', codeBackground: '#2C2317' },
    },
    dark: {
      // ダーク: memoBackground は background より僅かに明るい（現状 #1E1E1E → #383838 の関係を踏襲）
      default:  { background: '#1E1E1E', memoBackground: '#383838', border: '#2C2C2C', codeBackground: '#2A2A2A' },
      paper:    { background: '#2A271F', memoBackground: '#3A3528', border: '#3A3528', codeBackground: '#1F1C16' },
      mint:     { background: '#1A2A24', memoBackground: '#25382F', border: '#274037', codeBackground: '#0F1F19' },
      graphite: { background: '#1B1F26', memoBackground: '#2A303A', border: '#2C3340', codeBackground: '#10141C' },
      lavender: { background: '#221C2E', memoBackground: '#322942', border: '#352B47', codeBackground: '#15101F' },
      sepia:    { background: '#2A2117', memoBackground: '#382C1E', border: '#3D3022', codeBackground: '#1A150E' },
    },
  };
  ```
- [x] サムネイル用のスワッチ色（プレビュー丸ボタン用）も同ファイルからエクスポート

### 設定ストア
- [x] `store/settings.ts`
  - [x] `cardThemePreference: CardThemeName`（初期値: `'default'`）を追加
  - [x] `setCardThemePreference(name: CardThemeName)` アクション
  - [x] AsyncStorage 永続化（専用キー `@codeflash_card_theme`）
  - [x] hydrate 完了まで `'default'` で描画

### テーマフック拡張
- [x] `lib/theme/index.ts` の `useTheme()` を拡張
  - [x] `useSettingsStore((s) => s.cardThemePreference)` を購読
  - [x] 戻り値に `cardTheme: CardThemePalette` を追加
  - [x] `cardTheme = CARD_THEMES[dark ? 'dark' : 'light'][preference]`
- [x] 既存呼び出し箇所への影響は **追加プロパティのみ**なので破壊的変更なし

### 適用箇所
- [x] `components/study/FlipCard.tsx`
  - [x] カード本体（表面・裏面）の `backgroundColor` を `theme.cardTheme.background` に
  - [x] 枠線色を `theme.cardTheme.border` に
- [x] `components/study/BlocksView.tsx`
  - [x] コードブロックの背景を `theme.cardTheme.codeBackground` に
  - [x] テキストブロックは透過（`FlipCard` の background が透ける）
- [x] `components/study/CodeRunnerView.tsx`
  - [x] ヘッダー背景（状態色: 選択/編集/実行）は **そのまま**維持
  - [x] アイドル時の背景のみ `theme.cardTheme.codeBackground` に揃える
- [x] **メモエリアの背景** を `theme.cardTheme.memoBackground` に（`app/study/session.tsx` または該当する Memo View）
  - [x] テーマと同系の「少し違う色」で表裏とのコントラストを保つ
  - [x] 既存の `theme.colors.memoBackground` 参照箇所のうち、学習画面外（カードエディタ等）は **据え置き**（学習画面のみ `cardTheme.memoBackground` を使う）

### 設定画面 UI
- [x] `app/settings/display.tsx` に「カードテーマ」セクションを追加
  - [x] 横並びのスワッチ（直径 56 円形）+ 名前ラベル
  - [x] 選択中はチェックマーク + 太枠
  - [x] スワッチ色は `cardTheme.background` を表示（プリセットの「らしさ」を視認できる）
  - [x] Pro ガード: タップ時に `useProStore.getState().isPro === false` ならペイウォール起動
- [x] プレビュー領域（任意）
  - [x] 選択中テーマで「ミニカード」を1枚描画してリアルタイム確認

### Pro ガード
- [x] 選択時にペイウォール起動（保存時ではなく**選択時**=即時反映が前提のため）
- [x] 非 Pro でも `'default'` は常に選択可能（フォールバック）
- [x] Pro 失効時は `'default'` に戻す処理を `useProStore` の `setIsPro(false)` 内で実装

### i18n
- [x] `ja.json` / `en.json` 両方に追加
  - [x] `display.cardTheme` — 「カードテーマ」/ "Card Theme"
  - [x] `display.cardThemeDefault` — 「デフォルト」/ "Default"
  - [x] `display.cardThemePaper` — 「ペーパー」/ "Paper"
  - [x] `display.cardThemeMint` — 「ミント」/ "Mint"
  - [x] `display.cardThemeGraphite` — 「グラファイト」/ "Graphite"
  - [x] `display.cardThemeLavender` — 「ラベンダー」/ "Lavender"
  - [x] `display.cardThemeSepia` — 「セピア」/ "Sepia"
  - [x] `paywall.cardTheme` — 「カードテーマ変更は Pro 機能です」/ "Card themes are a Pro feature"

### 動作確認
- [x] 各プリセットを選択して学習画面に即座に反映される
- [x] ライト/ダーク切替時にそれぞれのプリセット色に追従する
- [x] 端末を縦/横に回転してもテーマが維持される
- [x] コードブロック内のシンタックスハイライトが各テーマ背景でも視認できる
- [x] FSRS の「もう一度/うろ覚え/わかった/バッチリ」ボタン色が背景に埋もれない
- [x] 非 Pro が選択しようとするとペイウォールが出る
- [x] アプリ再起動後も選択テーマが保持される（AsyncStorage 永続化確認）
- [x] iCloud 同期（014）では本設定は **同期しない**（端末ごとの好みのため）

---

## 設計メモ

### なぜグローバル設定にするか（デッキ別ではない）
- デッキ別だとデッキ切替時にテーマが変わって認知負荷が高い
- ユーザーの「目に優しい」「気分が乗る」テーマは個人の好みでありデッキに紐付かない
- 028-1（デッキカラー）が「デッキの識別」を担うので役割が重ならない

### なぜ「選択時にペイウォール」か（保存時ではない）
- 028-1 はデッキデータに保存する明示的操作なので「保存時」が自然
- 本フェーズはトグル感覚の即時反映 UI なので「選択時」のほうが流れが良い
- Pro 既存パターン（FSRS カスタマイズ・025）と揃える

### ライト/ダーク別パレットを用意する理由
- 同じ「mint」でもダーク背景に lightTheme.mint を載せると眩しすぎる
- 既存の `lightTheme` / `darkTheme` と分離して**カード本体のみ**に効くレイヤーとして実装
- ダーク版は彩度を 30% 程度に抑え、ライト版は 5〜10% の彩度で「色付きの白」を作る

### コードブロック背景を含める理由
- カード背景だけ変えるとコードブロックの濃い背景が浮いて統一感が崩れる
- 各テーマで「カード背景の濃い版」をコードブロックに当てると馴染む
- シンタックスハイライトは darkPlus 固定（変えると可読性検証コストが膨大）

### iCloud 同期から除外する理由
- iPad と iPhone で好みのテーマが違うケースが多い（画面サイズで体感が変わる）
- 同期されると片方の端末で変更したら相手も変わる、というのは UX として煩わしい
- 同様に `themePreference`（ライト/ダーク）も現状端末ごと

### `theme.colors.codeBackground` との関係
- 既存の `theme.colors.codeBackground` は **学習画面以外のコードブロック表示**で
  使われている（カード一覧プレビュー・検索結果プレビュー等）。そちらはそのまま。
- 本機能は学習画面に限定して `theme.cardTheme.codeBackground` を使う。

### Pro 失効時のフォールバック挙動
- `setIsPro(false)` が呼ばれた瞬間に `cardThemePreference` を `'default'` にリセット
- ユーザーは設定画面で「Pro が必要」と表示される
- AsyncStorage の値も `'default'` に書き戻す

---

## 関連チケット

- **028（親）**: Pro 機能 追加候補
- **028-1（前フェーズ）**: 色付きアイコン
- **028-3（次フェーズ）**: フォント変更
- **013**: ダークモード — 既存テーマシステム拡張のベース
- **016**: Pro 課金 — ペイウォール起動の連携
- **025**: FSRS カスタマイズ — Pro ロック UI パターンの参考

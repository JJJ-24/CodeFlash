# 028-1 デッキ・カードのカスタマイズ（フェーズ1: 色付きアイコン）

**フェーズ:** v1.4 候補
**ステータス:** 実装完了（動作確認待ち）
**配信:** **無料機能**（Pro ガードなし）
**依存:** 002（デッキ CRUD）, 013（ダークモード）
**被依存:** 028-2（カード表示テーマ）, 028-3（フォント変更）, 027（ウィジェット）

> **配信方針の変更履歴:** 当初は Pro 機能として企画したが、(1)絵文字をデッキ名に入れれば実質代替できること、(2)他の Pro 機能（iCloud 同期・FSRS・統計・フォント）の格を相対的に下げてしまうこと、(3)無料ユーザーの初期体験を豊かにすることが Pro 訴求につながると判断し、無料化した。Pro 訴求の主役は 028-2（カードテーマ）以降に移す。

---

## 概要

デッキに **アイコン**と **カラーテーマ**を設定できるようにする Pro 機能。
本フェーズではこの2つを同時に実装し、「**色付きアイコン**」として体験価値を成立させる。

絵文字をデッキ名に入れれば無料でアイコン的な表現は可能だが、
本機能の差別化ポイントは「ベクターアイコン × デッキカラーの統一カラーリング」にある。
ホーム / 学習タブ / 学習セッションヘッダー / 統計画面のデッキ別表示で
アイコンとアクセントカラーが一貫して使われ、視認性とブランディング感を提供する。

将来 027（ウィジェット）でタイル状に並べる際、絵文字より遥かにクリアに描画できる点も狙い。

---

## スコープ

### 含むもの
- デッキ編集画面（新規・既存）で **Ionicons プリセット**から選択
- 同画面で **プリセットカラー**から選択（タグと同じ 12 色）
- ホーム / 学習タブ / 学習セッションヘッダー / 統計のデッキ別習熟度に反映
- 非 Pro ユーザーには項目を見せつつ、保存時にペイウォール起動
- 既存デッキ（`iconName=null` / `colorHex=null`）はアイコンなし・`theme.colors.primary` フォールバック

### 含まないもの（フェーズ2以降）
- カード本体のテーマカラー → **028-2**
- フォント変更 → **028-3**
- 任意 Ionicons 名指定（プリセット外の自由選択）
- カスタムカラーピッカー（HEX 直入力）
- ウィジェット連動 → 027 のチケットで対応

---

## Todo

### DB マイグレーション
- [x] `lib/database/schema.ts` の `migrateDbIfNeeded` 末尾に `decks` への ALTER を追加
  - [x] `iconName TEXT NULL`（既存行は NULL = アイコンなし）
  - [x] `colorHex TEXT NULL`（既存行は NULL = primary フォールバック）
  - [x] PRAGMA で既存カラム有無を確認してから ALTER（他のマイグレーションと同パターン）
- [x] `docs/db-migration-checklist.md` を更新（フルバックアップ対象に追加）
- [x] `lib/export.ts` / `lib/import.ts` を確認（`decks` テーブル全体を扱う実装なら自動で含まれる。要検証）
- [x] `lib/tsv.ts` は **対象外**（TSV はカード本体のみ）

### 型定義
- [x] `types/index.ts` の `Deck` に追加
  ```ts
  iconName: string | null;
  colorHex: string | null;
  ```

### DB 関数
- [x] `lib/database/decks.ts`
  - [x] `createDeck` の引数に `iconName?: string | null`・`colorHex?: string | null` を追加
  - [x] `updateDeck` の引数に同上を追加
  - [x] SELECT 系（`listDecks`・`getDeck` 等）の戻り値に2カラムを含める
  - [x] `Deck` 型と整合する形で null を返す

### Zustand ストア
- [x] `store/decks.ts` の `useDeckStore`
  - [x] `Deck` 型の更新で対応（特に追加ロジック不要なら確認のみ）

### プリセット定義
- [x] `lib/theme/index.ts` に追加
  ```ts
  export const DECK_PRESET_COLORS = [
    '#E53935', '#fd9023', '#F6BF26', '#33B679',
    '#0B8043', '#039BE5', '#0e4cdd', '#7986CB',
    '#8E24AA', '#828080', '#795548', '#F48FB1',
  ] as const;
  ```
- [x] `lib/deckIcons.ts` を新規作成
  - [x] Ionicons 名のキュレーション配列をエクスポート（30〜40 個程度）
  - [x] カテゴリ別にグルーピング: 学習（`book`, `school`, `library`, `glasses`）、コード（`code-slash`, `terminal`, `git-branch`）、理科（`flask`, `magnet`, `planet`）、言語（`language`, `chatbubbles`）、その他（`bulb`, `medkit`, `musical-notes`, `briefcase`, `heart`, `star` ...）
  - [x] `type DeckIconName = (typeof DECK_ICONS)[number]`

### デッキ編集 UI
- [x] `app/deck/new.tsx`・`app/deck/[id]/edit.tsx` 共通で以下を追加
  - [x] 「アイコン」フィールド（プレビュー丸ボタン → タップで `IconPickerModal` 起動）
  - [x] 「カラー」フィールド（`tags/new.tsx` の `colorGrid` を踏襲）
  - [x] プレビュー領域: 選択アイコン × 選択カラーで描画
  - [x] Pro ガード: `useProStore.isPro === false` の場合、保存ボタン押下時にペイウォール起動（既存パターンを踏襲）
- [x] `components/IconPickerModal.tsx` を新規作成
  - [x] グリッド表示（FlatList numColumns=5）
  - [x] 選択中アイコンを枠線でハイライト
  - [x] 「アイコンなし」セルを先頭に配置（× アイコン）
  - [x] 共通モーダルパターン（`presentation: 'modal'` ではなく Reanimated オーバーレイ。Bluetooth キーボードのフォーカス保持のため）

### 表示適用箇所
- [x] `app/(tabs)/index.tsx`（ホーム デッキ一覧）
  - [x] 各デッキ行の左端にアイコン円（背景= `colorHex + '20'`、アイコン色= `colorHex`）
  - [x] `iconName === null` のときはアイコン円自体を非表示（または既存レイアウト維持）
- [x] `app/(tabs)/study.tsx`（学習タブのデッキ一覧）
  - [x] 同様にアイコン円を行頭に追加
- [x] `app/study/session.tsx`（学習セッションヘッダー）
  - [x] ヘッダー背景に `colorHex + '15'` 程度のうっすらアクセント（オプション、UX 確認後）
  - [x] タイトル横にアイコン表示
- [x] `app/(tabs)/stats.tsx`（統計のデッキ別習熟度）
  - [x] デッキ名横にアイコン表示
- [x] `app/deck/[id]/index.tsx`（デッキ詳細ヘッダー）
  - [x] タイトル横にアイコン表示

### Pro ガード
- [x] 設定 UI は表示しつつ、保存処理の冒頭で `useProStore.getState().isPro` を確認
  - [x] false なら `setShowPaywall(true)` 等でペイウォールを起動
  - [x] true なら通常通り保存
- [x] 既存デッキの編集時、`iconName=null && colorHex=null` のままなら非 Pro でも保存可能（後方互換）

### i18n
- [x] `ja.json` / `en.json` 両方に追加
  - [x] `deck.icon` — 「アイコン」/ "Icon"
  - [x] `deck.color` — 「カラー」/ "Color"
  - [x] `deck.iconNone` — 「アイコンなし」/ "No Icon"
  - [x] `deck.iconPickerTitle` — 「アイコンを選択」/ "Select Icon"
  - [x] `deck.iconCategoryStudy` / `deck.iconCategoryCode` / ...（カテゴリ表示する場合）
  - [x] `paywall.deckCustomization` — 「デッキのカスタマイズは Pro 機能です」/ "Deck customization is a Pro feature"

### 動作確認
- [x] 新規デッキ作成時にアイコン・カラーを設定して保存できる
- [x] 既存デッキ（null）を編集してアイコン・カラーを後付けできる
- [x] 非 Pro ユーザーは保存時にペイウォールが表示される
- [x] 非 Pro ユーザーが既存デッキの「名前のみ」を編集して保存できる（後方互換）
- [x] ライト/ダーク両モードでアイコンの色とプレビューが視認できる
- [x] iCloud 同期（014）でアイコン・カラーが別端末に伝搬する
- [x] JSON エクスポート/インポートでアイコン・カラーが保持される
- [x] アプリ削除→再インストール後、購入復元すれば Pro 機能が再有効化される

---

## 設計メモ

### Ionicons プリセットの選定基準
- **単色ベクター**であることが必須（カラー連動の前提）
- 文化的にニュートラルなものを優先（特定の宗教・国旗等は避ける）
- 学習ドメインに偏りすぎず、汎用性のあるアイコンも含める（ユーザーは「日記」「TODO」用にも使う想定）
- 30〜40 個程度が選択 UX の上限。それ以上はスクロール疲れする

### カラーパレットを `tags` と揃える理由
- ユーザーが既にタグで使っている色感を再利用できる
- 別パレットだと統一感が崩れる
- ダーク/ライトモード両方でコントラストが検証済みの色を流用できる

### アクセントカラーの当て方
- **NG**: デッキカード全面を `colorHex` で塗る（派手すぎ、ダークモードで読めない）
- **OK**:
  - アイコン円の背景に `colorHex + '20'`（alpha 12%）
  - アイコン本体を `colorHex`
  - 学習セッションヘッダーに `colorHex + '15'` のうっすら背景（要 UX 確認）

### Pro ガードのタイミング
- 「保存時にペイウォール」を採用する理由:
  - 機能の存在を非 Pro にも認知させられる（=訴求になる）
  - 設定 UI を見て触らせてから「あと一歩で使える」状態に持っていく
- 「設定 UI を隠す」は採用しない（016 の他機能と方針を揃える）

### 既存デッキとの後方互換
- 新規カラム `iconName`・`colorHex` は **NULL 許容**
- 既存デッキは `null` のまま動作（アイコンなし・primary フォールバック）
- 非 Pro ユーザーが `null` のまま編集・保存できることを保証

### フォールバック描画
```tsx
const iconColor = deck.colorHex ?? theme.colors.primary;
const iconBg = deck.colorHex ? deck.colorHex + '20' : theme.colors.primaryLight;
{deck.iconName && (
  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: iconBg, ... }}>
    <Ionicons name={deck.iconName as any} size={20} color={iconColor} />
  </View>
)}
```

### iCloud 同期との整合
- `sync_state` トリガー対象テーブルに `decks` は既に含まれているため、
  カラム追加でも自動的に変更検知される
- `lib/sync/icloud.ts` のスナップショット転送は全カラム転送なので追加対応不要（要検証）

### 028-2 / 028-3 への布石
- 本チケットで `lib/deckIcons.ts` を整備したことで、028-2（カードテーマ）で
  デッキアイコンを「カードの装飾」として再利用できる
- `colorHex` を持つことで、028-2 の「カード枠線をデッキカラーに連動」も実装可能

---

## 関連チケット

- **028（親）**: Pro 機能 追加候補
- **028-2（次フェーズ）**: カード表示のテーマカラー
- **028-3（その次）**: フォント変更
- **027**: ウィジェット — 本機能のアイコン/カラーが視覚的に最も活きる場所
- **016**: Pro 課金 — ペイウォール起動の連携
- **014**: iCloud 同期 — `decks` のカラム追加の伝搬

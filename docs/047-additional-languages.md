# 047 対応言語の追加（日本語・英語 → 多言語）

**フェーズ:** 将来
**ステータス:** Phase 0 完了（2026-08-26）。**Phase 1 完了・Phase 2 はアプリ本体の翻訳完了**（2026-08-27。
ストア掲載情報の翻訳と Phase 3 の実機確認が残り）
**着手中の言語:** スペイン語（実データと候補の両方に入る唯一の言語＝下記）
**要ネイティブ再ビルド:** 不要（JS のみ）
**依存:** なし（i18n 基盤・言語設定は実装済み）
**被依存:** なし

---

## 概要

現在の対応言語は**日本語・英語のみ**。ここに言語を追加する。

候補（2026-08-09 時点の検討）：**繁体字中国語・韓国語・スペイン語**。
実データでは**メキシコ・中国・ブラジル**からのインストールがある（下記）。

---

## 判断材料

### 実績（App Store Connect・2026-08-09 時点）

- ストアのプライマリ言語は**英語**（＝英語圏では既に発見される状態）
- 英語圏以外では **メキシコ・中国・ブラジル** からのインストールあり

### ⚠️ 候補と実データのズレ（着手前に確認すること）

| 実データの国 | 対応する言語 | 候補に入っているか |
|---|---|---|
| メキシコ | スペイン語 | ✅ 入っている |
| 中国 | 簡体字中国語 | △ 候補は**繁体字**（台湾・香港向けで別物） |
| ブラジル | **ポルトガル語（ブラジル）** | ❌ 入っていない |
| — | 韓国語 | ⚠️ **実データには現れていない** |

**スペイン語だけが実データと候補の両方に入っている**＝最も根拠が強い。
繁体字・韓国語は「iOS シェアが高く学習アプリ文化が根付いている・文字幅が日本語に近く
レイアウトが崩れない」という**構造からの推測**であって、このアプリの実測ではない。

着手前に App Store Connect の国別インプレッション/ダウンロードを見直し、
**推測ではなく実データで優先順位を決める**こと。特にブラジル（ポルトガル語）が
実際に出ているのに候補から漏れている点は要検討。

### このアプリ固有の有利な点

- **学習者向け**＝英語耐性が最も低い層が対象なので、開発者向けツール一般より
  ローカライズ価値が高い（プロの開発者なら英語 UI でも使える）
- **コンテンツの翻訳が不要**＝カードの中身はユーザーが作り、コードのキーワードは元々英語。
  翻訳するのは **UI の外枠だけ**で、教材を言語ごとに用意する必要がない

---

## 現状の規模

| 項目 | 2026-08-09 | **2026-08-26（再測定）** |
|---|---|---|
| 翻訳キー | 817個・19セクション | **1040個**・21セクション |
| 総文字数（日本語） | 約 14,800字 | **約 16,900字** |
| 言語追加に触るコード | 5ファイル・30行程度 | 同左（Phase 0 完了で**分岐の追加修正は不要**になった） |

⚠️ **半月で 220 キー増えている**。継続コスト（末尾）の見積もりはこの増加率で読むこと。

**i18n 基盤は既に正しく組まれている**（`lib/i18n/index.ts`・`fallbackLng: 'en'`）。
翻訳が一部欠けていても**英語で表示されて落ちない**ので、段階的に追加できる。

> **`Deck.language` は UI 言語とは無関係**（デッキ作成時に `'ja'` 固定で入るだけの事実上の
> 未使用フィールド）。言語追加のときに触らないこと。

---

## Todo

### Phase 0: 2言語前提の解消（**言語を増やさなくても価値がある**）＝**完了（2026-08-26）**

現状のコードには「日本語か、それ以外は英語」という**二択で書かれた分岐**が残っている。
第3の言語を足しても壊れはしないが、**その言語だけ通知とグラフが英語のまま**になる。
ここを先に直せば、以降は JSON を足すだけになる。

- [x] **`lib/notifications.ts` の `isJa` 三項演算子を `i18n.t()` に置き換える**（3箇所）
  - `getReminderBody()`（デイリーリマインダー本文・due 枚数入り）
  - `getGoalUnmetBody()`（046 の未達成リマインダー）
  - `scheduleBreakEndNotification()`（039 の休憩終了通知）
  - ⚠️ **React コンポーネント外**なので `useTranslation()` は使えない。
    `i18n` インスタンスを import して `i18n.t(...)` を直接呼ぶ（`store/settings.ts` が
    `i18n.changeLanguage` を呼んでいるのと同じ経路）。現状 `expo-localization` の
    `getLocales()` を直参照しているが、**これだとアプリ内の言語設定（`languagePreference`）を
    無視して端末言語で出る**という既存のバグでもある（日本語端末で UI を英語にしても
    通知だけ日本語で来る）。`i18n.t()` にすれば同時に直る
- [x] **月名・曜日ラベルを `Intl.DateTimeFormat` に置き換える**（2箇所）
  - `app/(tabs)/stats.tsx`（`MONTH_LABELS_EN` のハードコード table）
  - `components/stats/ActivityHeatmap.tsx`（曜日ラベル）
  - `Intl` なら全言語に自動対応し、テーブル自体が不要になる
- [x] **複数形を `(s)` 方式から i18next の複数形キーへ**（実際は **12キー**・英語のみ）
  - 現状 `{{count}} card(s)` のように括弧で逃げている。スペイン語では不自然さが目立つ
  - `key_one` / `key_other` に分割する。**日本語は複数形が無いので ja.json は変更不要**
  - 該当：`deck.sqlStagesSet` / `deck.htmlStagesSet` / `tag.removeFromCardsConfirm` /
    `tag.deleteSelectedConfirm` / `card.moveConfirmMessage` / `card.deleteSelectedConfirm` /
    `card.duplicateSuccess` / `card.searchResultCount` /
    `settings.goalScheduleConflictMessage` / `settings.goalScheduleRestoreMessage`
- [x] **表示言語の変更時に通知を予約し直す**（`app/_layout.tsx`）＝予約済み通知の文言は焼き込みのため
- [x] `npx tsc --noEmit` エラーなし／`npm run lint` 0 errors・48 warnings（増えていない）／`verify:db` 130・`verify:speech` 153・`verify:timer` 9 すべて成功
- [x] **実機確認（2026-08-26・OK）**：アプリの表示言語で通知が届く（「時刻を設定 → 言語を変更」の
      順でも新しい言語）／**休憩中に言語を変えても休憩終了通知が消えず、新しい言語で届く**／
      統計の曜日・月別グラフ・ヒートマップのラベルが従来と同じ表示

#### Phase 0 の実装メモ（2026-08-26）

- **通知**：`lib/notifications.ts` から `expo-localization` の直参照を落とし、`i18n` インスタンスを
  import して `i18n.t()` を呼ぶ。文言は `notification.body*` の5キー（`bodyDue`/`bodyNoDue`/
  `bodyDefault`/`bodyGoalUnmet`/`bodyBreakEnd`）。**due 枚数入りの文は複数形キーにした**
  （`bodyDue_one`）。⚠️ これは**既存バグの修正**でもある＝端末言語を見ていたため、日本語端末で
  UI を英語にしても通知だけ日本語で届いていた
  - ⚠️ **予約済みの通知は文言が焼き込まれている**：`scheduleNotificationAsync` は本文を予約時に
    確定するので、あとから言語を変えても古い文言のまま発火する。**実機で発覚**（「①時刻を設定
    → ②言語を変更」の順で日本語のまま届く。逆順だと新しい言語で予約されるので気づけない）。
    `app/_layout.tsx` が `i18n.language` の変化を見て `scheduleFromDb(db)` で張り直す
    （フォアグラウンド復帰と**同じ組み合わせ**＝cancel-all を含むので直後に
    `syncBreakEndNotification()` で休憩終了通知を復元する／初回マウントでは走らせない）
- **曜日・月名**：`lib/dateLabels.ts` を新設（`weekdayLabels(locale, 'short'|'narrow')` /
  `monthLabel(locale, monthIndex)`）。`app/(tabs)/stats.tsx` の `DAY_LABELS_JA`/`DAY_LABELS_EN`/
  `MONTH_LABELS_EN` を削除し、`components/stats/ActivityHeatmap.tsx` の曜日ラベルもこれに寄せた。
  出力は現行のハードコードと**完全一致**（ja `日月火水木金土`・en `Sun…Sat`・narrow `S M T W T F S`・
  ja 月 `1月`・en 月 `Jan`）を確認済み。スペイン語は `dom lun mar mié jue vie sáb` / `ene feb…`
  - ⚠️ 基準日は **UTC** で作り `timeZone:'UTC'` で整形する（ローカル時刻だと端末の TZ で1日ずれる）
  - ⚠️ `notification.weekdayShort`（`["Su","Mo",…]`）は**変えていない**＝`Intl` の短縮形は `Sun` で
    字数が変わり、既存画面の見た目が変わるため。これは翻訳側（JSON）にあるので言語追加で埋まる
- **複数形**：チケットの10キーに `deck.htmlImagesOnly` と `deck.htmlStagesAndImages` を加えた12キー。
  規約は **en＝サフィックス無しが `other`＋`_one` を追加／ja＝サフィックス無しのみ**
  （`pro.trialRemaining` の既存の書き方に合わせた）。i18next 25.8 の実物で 1/3 の両方を解決確認
  - ⚠️ **`deck.htmlStagesAndImages` は分割**（1文に `count` が2つあると複数形が効かない）。
    `土台 N件`（`htmlStagesSet`）と `画像 N枚`（**新規** `htmlImagesSet`）を各々複数形つきで作り、
    `{{stages}}、{{images}}` のつなぎキーで合成する。**つなぎ方も言語で変わる**ので翻訳キーに残す
  - ⚠️ **機械的な置換で `_one` を作らない**：`1 reminder fire` / `1 … are currently off` のような
    動詞の不一致が残る（実際に一度そうなったので手で直した）

### Phase 1: 言語を増やす仕組み（1言語につき30行程度）

- [x] `lib/i18n/index.ts`：`resources` に追加＋**対応言語リストを `SUPPORTED_LANGUAGES` に一本化**
- [x] `store/settings.ts`：`LanguagePreference` の型と `oneOf([...])` の2箇所に追加
- [x] `app/settings/display.tsx`：言語選択の選択肢を追加
- [x] `locales/es.json` を新規作成
- [x] `locales/ja.json`・`en.json`・`es.json` に言語名ラベル `settings.languageEs` を追加
- [x] **キーの網羅チェック**（⚠️ **翻訳の前に作る**＝1040キーを人手で追わないため）
      → `scripts/verify-i18n.ts` / `npm run verify:i18n`（2026-08-26）。`locales/*.json` を全部読むので
      **`es.json` を置けば自動で対象**になる。基準は `ja`。**現在の結果：エラー 0・警告 0**（見つかった不整合は同日すべて修正・実機確認済み 2026-08-26）。
  - **キーの欠落**（エラー）。⚠️ **複数形サフィックスを畳んでから比べる**＝en にだけ
    `pro.trialRemaining_one` があるのは**正常な差分**で、素朴な比較は誤検知する。配列
    （`notification.weekdayShort`）は `.0`〜`.6` に潰すので**要素数の違いも拾える**
  - **`{{token}}` の一致**（エラー）。翻訳で `{{count}}` が消える/名前が変わるのが最も
    起きやすい破損。アイコントークン（`{{albums}}` 等）もここで守られる
  - **行記法の保持**（エラー）。`■` / `[…]` / `>` の**行数**を突き合わせる。
    ⚠️ **`※` と行数そのものは見ない**＝実測すると ja/en で 16 キーが行数違い・5 キーが
    `※`/段落の違いで、翻訳として正当な差だった。`■`/`[…]`/`>` に絞ると**不一致は1件だけ**で、
    それは実際の不具合だった（下記）
  - **複数形の欠落**（警告）。その言語に `one` の区分があるとき、`{{count}}` を含むキーに
    `_one` が無いものを出す。⚠️ **`{{count}}` は数値とは限らない**（`InfoContent` の
    アイコントークンにも `count`＝枚数アイコンがある）ので、数が 1 でも壊れない書き方は
    スクリプト内の `COUNT_INVARIANT` に**理由つきで**列挙して除外する

**このチェックで見つかった既存の不具合（2026-08-26 に修正）**：`settings.studyTimerInfo` の
日本語が見出しを **`【…】`** で書いていた（`InfoContent` の見出し記法は**半角 `[…]` だけ**）。
⚠️ **真因はもっと手前にあった**＝この説明箱（`app/settings/study.tsx` の `infoBox`）は
**素の `<Text>` に文字列を流していて `InfoContent` を通していなかった**ので、記法自体が
一切解釈されていなかった（`[…]` に直しても太字にならず、実機確認で発覚）。`infoBox` を
`InfoContent` に通す形へ直して解決。記法を持たない説明文は1行ずつ同じ大きさ・色（sm・
textSecondary）で出るため、他の11個の説明箱の見た目は変わらない。
**教訓：翻訳ファイル側の記法を疑う前に、その文字列が誰にどう描かれているかを確認する。**

**チェッカーが出した警告 11 件も同時に解消した（2026-08-26）**。いずれも英語の既存文言で、
`{{count}}` が 1 のとき `Reviewed 1 cards` / `1 cards` のように出ていた（Phase 0 で直した `(s)`
表記とは別種で、名詞をそのまま複数形で書いていたもの）。内訳は3種類：

- **`_one` を追加**（9キー）＝`study.reviewedCount`/`finishConfirmMessage`/`goalReachedMessage`/
  `goalDone`/`goalPill`・`stats.goalLineInfoMessage`/`recordModeGoalNote`・`common.cardsCount`・
  `sync.mergeDeckCount`。日本語は変更不要
- **未使用キーの削除**＝`stats.nextReviewDays` は**どこからも呼ばれていない**（実際に使われて
  いるのは `nextReviewToday`/`nextReviewTomorrow`/`unitDaysLater`）。翻訳対象を増やさないため
  ja/en とも削除した。⚠️ 動的にキーを組む箇所（`t(\`stats.${key}\`)`）が固定リストであることを
  確認してから消すこと
- **分割**＝`archive.deleteDecksConfirm` はデッキ数とカード枚数の**2つの数**を含むので、
  `deleteDecksConfirmDecks` / `deleteDecksConfirmCards` に分け `{{decks}}\n{{cards}}` で合成
  （`deck.htmlStagesAndImages` と同じ手）。⚠️ この分割は英語の **its / their** の使い分けも
  正しくする＝1文にまとめたまま `{{cardCount}}` を素の数値にすると、デッキ1件・カード1枚でも
  `their` になる

**実機確認でさらに6件見つかった（2026-08-26・同日修正）**。W1 は `{{count}}` を含むキーしか
見ないので、**数を別の名前で渡している**文を取りこぼしていた（`Studied {{reviewed}} /
{{total}} cards` は総数が1でも「1 cards」）。i18next の複数形は **`count` にしか効かない**ので、
名詞に掛かる側の数を `count` に改名するところから直す必要がある。

- `study.reviewedOf`・`stats.todayDoneOf`・`stats.learnedOf` … `{{total}}` → `{{count}}`＋`_one`
- `settings.studyGoalCountValue`・`settings.studyGoalSummary` … `{{n}}` → `{{count}}`＋`_one`
- `deck.speechLangsSet` … 「N件」相当だと思って `COUNT_INVARIANT` に入れていたが、英語は
  「1 overrides」だった。⚠️ **除外リストに入れる前に「1 のとき実際にどう出るか」を確かめる**
- `stats.unitDays`（英語）を空にした＝ラベルが `Study days` なので単位 `(days)` と重複し
  「1 Study days (days)」になっていた。単位は別の `<Text>` なので空でも行数は変わらず、
  隣の2つ（`(%)`・`(sec)`）との縦位置も揃ったまま。⚠️ **ラベル `Study days` は 1 でも複数形の
  まま**でよい＝これは**指標の名前**であって文の目的語ではない（`Correct rate` / `Avg. time` と
  同じ並び。英語のダッシュボードは値が 1 でもラベルを変えない）。文中の名詞（`1 card`）とは別扱い

同じ取りこぼしを繰り返さないよう、チェッカーに **W2「補間の直後が複数形の名詞なのに `_one`
が無い」** を追加した。これで **エラー 0・警告 0**。以後この検査を緑に保つ。

#### Phase 1・2 の実装メモ（2026-08-27）

- **対応言語リストは `lib/i18n/index.ts` の `SUPPORTED_LANGUAGES` が唯一の定義元**にした
  （**コード → 自言語表記**の表＋`isSupportedLanguage()`／`resolveSystemLanguage()`）。従来は
  `lib/i18n` と `store/settings.ts` の `resolveLanguage()` に `['ja','en'].includes(...)` が**2つ複製**
  されていて、片方だけ足すと「設定では選べるのに端末言語では選ばれない」というズレが出る。
  次の言語追加で触るのは**この表 1 行と `import` 1 行だけ**
  - ⚠️ **言語名は翻訳ファイルに置かない**＝`日本語`/`English`/`Español` は自言語表記なので
    **どの UI 言語でも同じ文字列**。`settings.languageJa/En/Es` として持つと言語数の二乗ぶん
    同じ値が並ぶ（3言語で 9 個）ので、上の表へ移して locales からは削除した。
    `Intl.DisplayNames` は Hermes に無く OS からも取れないため、表を持つこと自体は避けられない

##### 表示言語の UI＝セグメントをやめて「行＋一覧」に（2026-08-27）

言語が増えるたびにセグメントの区画が増えて破綻するため、`SegmentedCard` から
**行（ラベル左・現在の言語右・シェブロン）＋ `LanguagePickerModal`** へ移した。
表示設定の他の3つ（テーマ／文字サイズ／初期フィルター）は**すべて3択固定**で、
言語だけが唯一「増え続ける」設定だった＝セグメントはこのアプリでは3択の部品。

- **「システム」は独立した部品ではなく一覧の先頭行**にした。セグメント2つ（`言語選択`／`システム`）
  という案もあったが、`言語選択` は**値ではなく操作**なので、選択中でも**何語かが画面に出ない**
  ＝結局もう1行必要になり、1つの設定を2つの部品で表すことになる
- 「システム」を選んでいるときは**実際に使われる言語まで出す**（`システム（日本語）`）＝
  読み上げの「アプリ設定に従う」行が同じ理由で結果を添えているのと揃えた
- ⚠️ **モーダルが自前で Esc を持つなら、親の `SettingsDetail` に `suspendKeys` を渡す**：
  `useKeyCommands` は**登録ごとに listener を張る**ので、親（常時 Esc）と子（表示中 Esc）が
  両方登録していると**両方のハンドラが発火**し「モーダルを閉じる＋画面ごと戻る」になる。
  - この二重発火は**既存の `SpeechLanguageModal`／`SpeechVoiceModal`（050）にもあった**ので、
    同じ 2026-08-27 に `SettingsDetail` へ `suspendKeys` prop を足して 3 画面（display/study/data）
    まとめて直した。⚠️ **モーダル側は直さない**＝`SpeechLanguageModal` は
    `DeckSpeechModal`（デッキ編集）からも使われ、そちらは親が `picking === null` で
    自分の Esc を外す形で**既に正しく住み分けている**。真因は「親が手放していない」側にある
  - `data.tsx` だけは `onBack` の早期 return（`if (tsvDeckPickerVisible) …; return;`）で
    **結果的に戻らずに済んでいた**＝二重発火自体は起きていたので、あわせて明示的にした
- ⚠️ **iOS（Hermes）に `Intl.PluralRules` は無い**。実測（`hermes.framework` の文字列）で
  `DateTimeFormat`・`NumberFormat`・`Collator` はあるが `PluralRules`・`DisplayNames` は無い。
  i18next 25.8 は `new Intl.PluralRules()` の例外を捕まえて **`count === 1 ? 'one' : 'other'` の
  内蔵ルールへ落ちる**（`dummyRule`）。**英語・スペイン語はこれで正しい**（どちらも 1 だけが
  `one`）ので `_one` は実機でも効くが、**`few`/`many`/`zero` を持つ言語（ポーランド語・ロシア語・
  アラビア語・チェコ語など）を足すと複数形が黙って壊れる**＝その言語を入れるときは
  `Intl.PluralRules` のポリフィルが要る。**先に「en/es だから成立している」ことを知らずに
  追加しないこと**
- **翻訳中は `locales/` に置かない**：`verify-i18n` は `locales/*.json` を全部読むので、途中の
  `es.json` を置くとキー欠落が**エラー扱い**になり（1044件）翻訳期間ずっと検査が赤くなる＝
  ja/en 側の劣化を検知できなくなる。`locales/wip/es.json`（サブディレクトリは走査されない）で
  組み立て、完成してから移動した。**セクション単位で積むたびに検査を回す**運用にすると、
  補間トークンと行記法の崩れをその場で潰せる

##### スペイン語の訳語（次の言語でも同じ判断が要る）

- **語彙**：カード＝`tarjeta` ／ デッキ＝`mazo`（Anki の定訳） ／ タグ＝`etiqueta` ／
  表面・裏面＝`Anverso`・`Reverso` ／ メモ＝`Nota` ／ 土台＝`base` ／ SQL初期化＝`inicialización` ／
  評価＝`Repetir`/`Difícil`/`Bien`/`Fácil`
  - ⚠️ 評価ボタンに Anki の `Otra vez` を採らなかったのは**2語で長く**、`adjustsFontSizeToFit` が
    そのボタンだけ縮めて4つの文字サイズが不揃いになるため。1語の `Repetir` で長さを揃えた
- ⚠️ **性の一致が取れないキーがある**＝`common.all`・`common.active` は**デッキ（男性）にも
  カード（女性）にも使う1つの文字列**。`Todos/Todas`・`Activos/Activas` はどちらかが必ず誤りに
  なるので、**性を持たない語に逃がした**（`Todo` ／ `En uso`）。
  ⚠️ この手は**フランス語・ポルトガル語・イタリア語でも同じ問題**が起きる
- **フィルターの4ラベルは字数を揃える**（2026-08-27 に短縮）＝当初 `Todo`(4) / `Estudiadas`(10) /
  `Repaso`(6) / `Nuevas`(6) としたが、フィルターブロックは `adjustsFontSizeToFit` なので
  **「済み」だけが一段小さく縮んで不揃いに見えた**。`Hechas`(6) に替えて 4/6/6/6 に揃えた
  （`Vistas`＝評価せずめくっただけでも当てはまり不正確、`Repasadas`＝ほぼ縮まないため不採用）。
  「有効」も `Sin archivar`(12) → **`En uso`(6)**（どちらも性変化しない）。
  ⚠️ **ラベルを変えたら、本文中でラベル名を参照している9キーも直す**（`stats.topBlocksInfoMessage`・
  `goalLineInfoMessage`〈＋`_one`〉・`barTapInfoMessage`・`todaySummaryInfoMessage`・
  `shortcut.switchFilter`・`cycleChart`・`switchFilterAllActive`・`home.noActiveDecks`・
  `card.noActiveCards`）＝説明文と画面の呼び名が食い違う。⚠️ 一方
  `Estudiadas {{done}} / {{count}} tarjetas` のような**文中の語は縮めない**（幅の制約が無く、
  短縮形にすると逆に不自然）
- **地域変種は中南米寄りの中立**（実データがメキシコのため）＝`Agregar`（`Añadir` ではなく）。
  ただし**OS の設定アプリは名前で呼ばない**（スペイン `Ajustes` ／ 中南米 `Configuración` で
  食い違い、「その名前の項目が無い」案内になる）＝`los ajustes del dispositivo` と**普通名詞**で書く
- **`settings.language`（アプリ言語）と `settings.speechLanguage`（読み上げ）は別語**にした
  （`Idioma de la app` / `Idioma`）＝CLAUDE.md の「共用すると片方を短くしたときにもう片方の
  行名まで変わる」規約どおり
- `stats.unitDays` は**英語と同じく空**にした（ラベル `Días de estudio` と単位が重複するため）

### Phase 2: 翻訳

- [x] 対象言語の `locales/es.json` を翻訳する（**1044キー・約17,000字**・2026-08-27）
- [x] ⚠️ **機械翻訳をそのまま入れない**。このアプリは説明文が長く（ショートカット一覧・
      情報モーダル・機能説明）、文言の意図が失われやすい。特に 046 で確立した
      「**状態ではなく結果を書く**」（「オフです」ではなく「動作しません」）のような
      判断は、直訳すると消える
- [ ] ストア掲載情報（アプリ名・サブタイトル・キーワード100字・説明文4000字）も
      **アプリ本体とは別に**ローカライズできる。**先にこちらだけ追加して反応を見る**のが
      安価な実験になる（アプリ内は英語のままでも成立する）

### Phase 3: レイアウト検証（**言語ごとに必要**）

- [ ] **狭い場所の文字あふれ**を実機で確認する。危ないのは自動縮小が入っていない箇所：
  - 2択ダイアログのボタン（046 で「オフにする」の長さを調整した箇所）
  - 未達成通知バッジ（曜日ドット・ラベルと同じ行に並ぶ）
  - 学習タブの目標行、評価ボタン（再考/苦手/正解/即答）
  - ※ フィルターブロックは `numberOfLines={1} adjustsFontSizeToFit` で自動縮小するので比較的安全
- [ ] **スペイン語で特に見るところ**（翻訳時点で長くなると分かっている箇所）：
  - ~~**表示言語のセグメント**が 3 → 4 つ~~ → **解消済み**（2026-08-27 に行＋一覧へ変更。上記）
  - **下タブの `Estadísticas`**（英語 `Stats` の 2 倍以上）
  - **通知スケジュールのバッジ**＝`Si falta` / `Si falta (sin objetivo)`（英語 `If unmet` 相当。
    短く詰めたので**意味が通るかも**あわせて確認する）
  - ※ フィルターの `Hechas` / `En uso` は 2026-08-27 に短縮済み（上の実装メモ）
  - 統計の指標ラベル `Días de estudio` / `Tiempo medio` / `Aciertos`（3つ横並び）
- [ ] **フォントサイズ「大」**（`fontSizePreference: 'large'`＝1.2倍）でも崩れないこと
- [ ] iPhone / iPad の両方（iPad は横幅があるぶん有利）

---

## 言語ごとの注意点

| 言語 | 文字数（英語比） | レイアウト risk | 固有の注意 |
|---|---|---|---|
| **繁体字中国語** | 短い | **小** | 日本語と文字幅が近く崩れにくい。簡体字とは別言語として扱う（自動変換で済ませない） |
| **韓国語** | ほぼ同等 | **小** | 同上。学習アプリ文化との相性が良い |
| **スペイン語** | +15〜30% | **中** | 複数形は `_one`/`_other` が必須級。`¿` `¡` の開き記号を忘れない。名詞に性があるが、このアプリの補間は**数値と固有名詞がほとんど**なので性の不一致は起きにくい |
| **ポルトガル語（ブラジル）** | +15〜30% | **中** | スペイン語とほぼ同じ性質。**実データに出ているのに候補から漏れている** |
| 簡体字中国語 | 短い | 小 | 中国本土 App Store は審査・競合・決済が別枠で参入コストが高い。繁体字で反応を見てからでも遅くない |
| ドイツ語・フランス語 | +20〜30% | **大** | 課金単価は高いが**英語堪能な層が厚く増分が小さい**。文字数リスクは最大 |

---

## 不採用・保留（再提案しないこと）

- **アラビア語・ヘブライ語（RTL）** — レイアウトの左右反転が必要で、他言語とは次元の違う
  コストになる。上記の言語とは別チケットで扱うべきで、まとめて検討しない
- **カードの中身（教材）の翻訳** — カードはユーザーが作るもので、アプリが用意する対象ではない
- **UI 言語に合わせて `Deck.language` を変える** — この列は UI 言語と無関係（未使用フィールド）

---

## 継続コスト（着手判断の材料）

言語を増やすと、**機能追加のたびに翻訳が増える**。参考として、2026-08-09 の1日（044〜046 の
実装）で追加した翻訳キーは **20個以上**。3言語なら毎回3倍、4言語なら4倍の作業になる。

「翻訳が欠けても英語で出る」ので**破綻はしない**が、放置すると**画面ごとに言語が混ざる**。
Phase 1 の「キーの網羅チェック」を先に用意しておくと、この劣化を検知できる。

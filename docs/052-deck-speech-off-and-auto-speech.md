# 052 デッキごとの読み上げ OFF ＋ 自動読み上げ（アプリ設定／デッキ上書き）

**フェーズ:** 将来
**ステータス:** Phase 1 完了（`aa3e507`・2026-09-16・実機確認済み）／Phase 2 完了（2026-09-16・実機確認済み）／Phase 3 未着手（設計合意 2026-09-16）
**要ネイティブ再ビルド:** 不要（`expo-speech` は導入済み・DB 列の追加と設定キーの追加のみ）
**依存:** 049（読み上げ本体・Phase 2 が本チケットへ移った）・050（デッキ単位の上書き＝`DeckSpeechModal`）・051（デッキ設定の Pro 化）
**被依存:** なし

---

## 概要

読み上げに**デッキ単位の2つのつまみ**と、**自動再生**を足す。

```
いま        アプリ設定の「読み上げ」ON/OFF が全デッキに効く
            再生は学習画面のスピーカーボタン／S キーの手動だけ

本チケット  ① デッキごとに読み上げを OFF にできる（ボタンごと消える）        … 無料
            ② 表示・反転のたびに自動で読む（オフ／表面／裏面／両面）         … Pro
            ③ ②をデッキごとに上書きできる（アプリ設定に従う／各値）         … Pro
```

想定は「デッキ A はプログラミングなので読み上げ不要＝ボタンも要らない／デッキ B は語学なので
表示のたびに自動で読んでほしい」。①が**減らす**方向、②③が**増やす**方向で、Pro の線引きも
その向きで決める（下記）。

049 の Phase 2（自動読み上げ）はここで実装する＝**049 の Phase 表は本チケットを指すよう更新する**。

---

## 確定仕様（設計合意・2026-09-16）

| 論点 | 決定 |
|---|---|
| ① デッキごと OFF | `decks.speechDisabled`（INTEGER 0/1・既定 0）。**無料**。学習画面の `canSpeak` に足すだけでボタン・`S` キー・自動読み上げが一括で消える |
| ① の UI | デッキ新規/編集の「読み上げの言語」行の**上**に**別のトグル行**「読み上げ」＋ⓘ（アーカイブ行と同じ形＝テキスト＋ⓘ＋スイッチ・小見出しなし。既定 ON・保存値は否定形＝`noDeckHtmlInit` と同じ流儀）。OFF のとき言語行は `opacity: 0.55`＋「動作しません」の注記 |
| 行の並び | **読み上げ → 読み上げの言語 → HTML/CSS 土台 → SQL 初期化 → アーカイブ**（2026-09-16 変更）＝全員に出る行を先・Pro だけの行（HTML/SQL）を後にして、非 Pro と Pro で読み上げの位置が変わらないようにする。ショートカット一覧も同じ順 |
| 言語行の要約 | **常に言語名だけ**（1件「中国語」／2件「英語 / 中国語」／表裏「表 英語・中国語／裏 スペイン語」）＝学習設定の要約と同じ形。かつては「ラテン文字：英語」「2件を上書き」「言語名だけ」の3通りが混在していた（052 で同時に直した・`speechLangsOne`/`speechLangsSet` は削除） |
| ② 自動読み上げの面 | **4択**＝オフ／表面／裏面／両面（`SpeechAutoMode = 'off' \| 'front' \| 'back' \| 'both'`）。3択セグメントには収まらないので**行タップ → 一覧モーダル** |
| ② の保存 | `useSettingsStore.speechAuto`（既定 `'off'`・AsyncStorage・`lib/settings-keys.ts` にも追加） |
| ② の発火 | **カードの表示と表裏の反転**のたび。**メモの開閉では発火しない**（自動で読むのは面の本文だけ）。閲覧モードでも読む。**休憩中は読み始めず、読んでいる途中で休憩に入ったら止める**（休憩中は FAB も S キーも効かず止める手段が無いため。休憩明けに読み直しはしない＝カードは変わっていない） |
| ③ デッキ上書き | `decks.speechAuto`（TEXT・NULL＝アプリ設定に従う／`off`/`front`/`back`/`both`）。`DeckSpeechModal` の先頭行。ピッカー先頭「アプリ設定に従う」が唯一の解除手段（050 の流儀） |
| Pro ゲート | ①無料 ／ ②③ **Pro**。⚠️ **051 と違い、適用側（`session.tsx`）にも `isPro` を入れる**（下記「Pro ゲートの深さ」） |
| 声・速度・言語 | 変更なし（無料のまま）。自動読み上げは手動と**同じ経路**（`useSpeech.speak`）で読む＝読み方は不変 |

---

## 設計

### 1. データ

```ts
// lib/speech.ts
export type SpeechAutoMode = 'off' | 'front' | 'back' | 'both';

// types/index.ts（Deck）
speechDisabled: boolean;              // SQLite は 0/1 → toDeck で boolean に正規化（archived と同じ）
speechAuto: SpeechAutoMode | null;    // null = アプリ設定に従う

// store/settings.ts
speechAuto: SpeechAutoMode;           // 既定 'off'
```

- `schema.ts`：`PRAGMA table_info` で存在確認して `ALTER TABLE decks ADD COLUMN`（050/051 と同型）
- `lib/database/decks.ts`：`RawDeck`・`toDeck`・`createDeck`・`updateDeck`。⚠️ **`updateDeck` は渡されたときだけ書く**（`updatesSpeechDisabled` / `updatesSpeechAuto`）
- `lib/import.ts` の `decks` の列リストに2つ足す（052 以前のファイルは `0` / `NULL` に吸収）
- JSON エクスポートは `SELECT *` なので自動。iCloud は DB ファイルごと往復＝旧バージョンは新列を無視するだけ
- TSV は往復しない：`inspectTsvExport` の読み上げ設定の件数（`deckSpeechLangs`）に **`speechDisabled` と `speechAuto` も1件ずつ数える**。文言は「読み上げの設定（デッキ設定）N件」に広げる（`tsvLossDeckSpeechLangs`）

### 2. 解決（`app/study/session.tsx`）

```ts
const deckSpeechOff = currentDeck?.speechDisabled === true;
const canSpeak = speechEnabled && !deckSpeechOff && speechText.trim() !== '';

// ⚠️ 051 と違って isPro が要る（自動読み上げ自体が Pro 機能＝受け取ったデッキの値を非 Pro に
//    適用すると漏れる。HTML 土台の「非 Pro には積まない」と同じ構造）
const autoMode: SpeechAutoMode = isPro ? (currentDeck?.speechAuto ?? speechAuto) : 'off';
const autoText = isFlipped ? blocksToSpeech(back) : blocksToSpeech(front);   // メモは含めない
const autoNow = canSpeak && autoText.trim() !== ''
  && (autoMode === 'both' || autoMode === (isFlipped ? 'back' : 'front'));
```

**発火は1箇所**：既存の「表示が変わったら止める」effect（`[currentCard?.id, isFlipped, showMemo]`）は
そのまま残し、その**直後**に `[currentCard?.id, isFlipped]` だけを依存に持つ effect を1つ足す。
同じコミット内では宣言順に走るので「止める → 自動なら読む」の順になり、メモの開閉では
止める側だけが走る（＝自動読み上げは再発火しない）。

- ⚠️ 読む内容（`autoNow`・`autoText`・`speak`）は **ref で最新値を参照**し、依存には入れない
  （入れると設定変更や声の一覧取得のたびに読み直す）。`eslint-disable` の理由をコメントに書く
- ⚠️ `useFocusEffect` のクリーンアップ（画面離脱で止める）は従来どおり。**戻ってきたときに
  読み直さない**（カードは変わっていない＝effect も走らない）
- ⚠️ 経路ごと（`,`/`.`・スワイプ・FAB・評価）に `speak()` を書かない（049 の止め忘れと同じ罠）
- 読み上げ中は FAB が「停止」の見た目になるので、自動で始まった声はそのまま FAB／`S` で止められる
- タグ学習は1セッションに複数デッキが混ざるので、**いま読むカードの所属デッキ**の値を見る
  （`speechLangs` と同じ引き方）
- 反転アニメーション中に始まって早すぎると感じたら **300ms 遅らせる**（`setTimeout`＋cleanup で
  `clearTimeout`）。実機で判断＝設定にはしない

### 3. UI

#### ① デッキ新規/編集（`deck/new.tsx`・`deck/[id]/edit.tsx`）

```
  ┌──────────────────────────────────────┐
  │ 読み上げ ⓘ                        [ON] │   ← 新設（無料・既定 ON・⇧R）。アーカイブ行と同じ形
  └──────────────────────────────────────┘
読み上げの言語（既存）
  ┌──────────────────────────────────────┐
  │ 🔊 表 英語／裏 スペイン語     🔒  ›   │   ← OFF のとき opacity 0.55
  └──────────────────────────────────────┘
  ※ 読み上げを使わない設定のため動作しません   ← OFF のときだけ
HTML/CSS 土台（Pro）
SQL 初期化（Pro）
アーカイブ（編集のみ）
```

- トグル行に小見出しを付けない：スイッチは行のテキストが項目名を兼ねるので、上に「読み上げ」を
  置くと同じ語が2段に並ぶ（アーカイブ行に小見出しが無いのも同じ理由＝2026-09-16 に確認して現状維持）。
  説明は ⓘ のインライン展開（`deck.speechUseHint`）＝「オフにすると学習画面にボタンが出ない／言語の
  設定は残る」の2文。⚠️ ⓘ に S キーは書かない（ⓘ＝指の操作の規約）

- **アプリ設定で読み上げが OFF のとき**は、トグル行と言語行の両方を淡くして注記を
  「アプリの設定で読み上げがオフのため動作しません」にする（こちらが優先）。
  ⚠️ **今は言語行がアプリ OFF でも普通に設定できる**＝「設定できるのに効かない」状態を
  ここで塞ぐ（CLAUDE.md の鉄則）
- 隠さず淡くする＝「言語を設定したのに行が無い」を作らない。設定値はそのまま残る
  （OFF は**モード**であって設定の有無ではない＝051 の「裏面トグル OFF で消す」とは違う）
- キー：**`⇧R`**＝トグル反転（`R`＝読み上げの設定を開く、の Shift 版。`E`＝アーカイブと同じ
  「トグルはキー1つ」の流儀）。ショートカット一覧にも1行
- `isDirty` に `speechDisabled` を足す

#### ② 学習設定（`app/settings/study.tsx`・読み上げセクション）

「読み上げ」トグルの直下に **「自動読み上げ　オフ ›」** の行。タップで一覧モーダル
（オフ／表面／裏面／両面）。

- **非 Pro**：行に鍵アイコン、値は常に「オフ」、タップで paywall（デッキ編集の読み上げ行と同じ形）。
  ⚠️ 体験終了後に設定値が残っていても、適用側が `isPro` で止めるので「オンに見えるのに効かない」に
  ならない＝**表示する値も適用と同じ「オフ」**にする
- 一覧モーダルは `SpeechLanguageModal` と同型（**中央ダイアログ＝`animationType="none"`＋
  JS フェード**の規約・Esc で閉じる・表示中は親の `suspendKeys`）。デッキ側でも使うので
  `allowInherit`（先頭に「アプリ設定に従う（現在：◯◯）」）を持たせる
- セクションの要約（折りたたみ時）と ⓘ（`settings.speechHint`）に自動読み上げの1文を足す

#### ③ `DeckSpeechModal`（デッキ上書き）

先頭に **「自動読み上げ　アプリ設定に従う ›」** の行（文字体系の一覧の上）。タップで②と
同じモーダルを `allowInherit` で開く。

- `deckSpeechSummary` に自動読み上げを足す（例：「自動:両面 ／ 表:英語」）。
  `speechConfigured`（鍵つき行の「設定済み」判定）にも `speechAuto !== null` を足す
- 非 Pro の［設定を解除］は **`speechAuto` も `null` に戻す**（解除で全部消える＝051 の詰み防止）
- このシートは 051 で Pro ゲート済みなので、③に追加のゲートは要らない

#### paywall

`pro.featureDeckSpeech` の見出しと説明を「自動読み上げ・デッキごとの読み上げ言語」に広げる
（項目を増やさない＝一覧を伸ばさない）。

### 4. Pro ゲートの深さ（051 との違い）

| | 051（デッキ別言語） | 052 ②③（自動読み上げ） |
|---|---|---|
| 設定 UI | Pro | Pro |
| 適用（学習画面） | **通す** | **`isPro` で止める** |
| 理由 | 止めても守られる Pro 機能が無い（読み上げ本体が無料） | **自動読み上げ自体が Pro 機能**。同期・インポートで `speechAuto='both'` のデッキを受け取った非 Pro に適用すると漏れる＝HTML 土台と同じ構造 |
| 前例 | — | 学習タイマー `studyTimerActive = isPro && studyTimerEnabled`（`session.tsx`） |

①（デッキごと OFF）は無料：**減らす方向を Pro にすると非 Pro が逃げられない**（プログラミング
デッキでボタンを消せない／同期で `speechDisabled=1` のデッキを受け取っても戻せない）。
051 の「解除は非 Pro にも許す」と同根。

**自動読み上げ本体を Pro にする根拠**（設計合意 2026-09-16）：
1. 049 の時点で「Pro にするなら自動読み上げだけが候補」と決めてあった
2. いまの Pro の売りは SQL/C++/Web プレビュー/統計とほぼプログラマー向けで、語学用途は
   「デッキ別言語」1つだけ。自動読み上げは語学学習者に**いちばん刺さる**機能
3. 読み上げは未リリース＝いま Pro にしても取り上げにならず、後からの無料開放は安全（051 と同じ論理）
4. 051 で無料に残したのは「**正しく読むために要る**設定」（言語・声・速度）。自動は利便であって
   正しさではないので、無料版の読み上げは壊れない

---

## 不採用（再提案しないこと）

### 自動読み上げ本体を無料にし、デッキ上書きだけ Pro にする

051 の字面には最も忠実だが、語学ユーザーが Pro を買う理由が「一部のデッキだけ挙動を変えたい」
だけになって弱い。無料で出すと二度と戻せない。

### 適用側を `isPro` なしで通す（051 の流儀をそのまま使う）

自動読み上げはそれ自体が Pro 機能なので、通すと配布・同期デッキ経由で漏れる。上の表参照。

### デッキごと OFF を `DeckSpeechModal` の中に置く

シートを開く行が 051 で Pro ゲート済みなので、非 Pro が OFF に到達できない。ゲートを
シートの内側（行ごとの鍵）へ移す改修は 051 の「設定済みなら解除だけ通す」ダイアログの
移設も伴い大きい。別トグル行なら既存のゲートに触らない。

### デッキごと OFF で言語設定を消す／行を隠す

OFF は**モード**であって設定の有無ではない（051 の裏面トグルは「裏面の設定を持つか」そのもの
だったので OFF で消すのが正しかった）。消すと一時的に OFF にしただけで Pro で組んだ言語設定が
失われる。隠すと「言語を設定したのに行が無い」になる。淡く＋注記で「なぜ効かないか」を出す。

### 自動読み上げをセグメント3択に押し込む

「裏面のみ」が落ちる。JA→EN デッキ（表が日本語・裏が英単語）では答えの英語だけ聞きたい＝
裏面のみが本命の使い方の1つ。

### 自動読み上げでメモも読む

メモを開くたびに裏面が読み直される（`speechText` は裏面＋メモを1本に繋いでいる）。
メモは手動ボタンで従来どおり読める。

### 自動読み上げをカード単位で設定する

050/051 と同じ理由（1000枚に手作業・新規カードのたびに指定が要る）。

### 遅延（反転から何 ms 後に読むか）を設定にする

実機で1つに決める。つまみを増やしても判断材料が無い。

---

## 落とし穴（実装前に潰す）

- **カードが変わる瞬間の二重発話** — 止める effect と読む effect を別々に書くので、順序が逆だと
  「読んでから止める」になり無音になる。**宣言順**を止める→読むにし、コメントで固定する
- **設定変更で読み直す** — 読む effect の依存に `autoNow`/`speak` を入れると、声の一覧取得
  （`knownVoiceIds`）が終わった瞬間や速度変更で同じカードを読み直す。ref で参照する
- **非 Pro に効く** — 適用側の `isPro` を忘れると同期で受け取ったデッキで自動読み上げが動く。
  実機の Todo に入れる
- **アプリ設定 OFF ＋ デッキ設定あり** — デッキ編集の行が普通に触れる現状は「設定できるのに
  効かない」。本チケットの注記で塞ぐ（①の UI 参照）
- **`lib/settings-keys.ts` の追加漏れ** — 漏れると JSON エクスポート/インポートで `speechAuto` が
  復元されない（CLAUDE.md の store の項）
- **`verify:i18n` は3言語そろって無いキーを検出できない** — `pro.featureDeckSpeech` の改稿と
  新キーは E4（コード側の参照）で拾えるよう、`t('...')` かオブジェクトのリテラルで書く

---

## Phase 構成

| Phase | 内容 | 概算 |
|---|---|---|
| **Phase 1** | ① デッキごと OFF（無料）＝列・型・CRUD・`session.tsx` の `canSpeak`・デッキ新規/編集のトグル行＋注記（アプリ OFF の注記も）・`⇧R`・翻訳3言語・`verify:db` | 0.5日 |
| **Phase 2** | ② 自動読み上げ（アプリ設定・Pro）＝設定キー・`settings-keys`・学習設定の行＋一覧モーダル・`session.tsx` の発火 effect（`isPro`）・paywall の文言・ⓘ | 0.5日 |
| **Phase 3** | ③ デッキ上書き＝列・CRUD・`DeckSpeechModal` の行・サマリー・解除ダイアログ・`import`/`tsv`・`verify:db` | 0.3日 |
| **仕上げ** | `CLAUDE.md`（読み上げの節・DB 列・store の一覧）・`docs/049` の Phase 表・release-notes | — |

---

## Todo

### Phase 1（デッキごと OFF・無料）

- [x] `schema.ts` に `decks.speechDisabled`（INTEGER・既定 0）の `ALTER TABLE`
- [x] `types/index.ts` に `speechDisabled: boolean`
- [x] `lib/database/decks.ts`：`RawDeck`（0/1）・`toDeck`（boolean 化）・`createDeck`・`updateDeck`（**渡されたときだけ書く**）
- [x] `lib/import.ts` の列リスト
- [x] `app/study/session.tsx`：`canSpeak` に `!currentDeck?.speechDisabled`
- [x] `deck/new.tsx`・`deck/[id]/edit.tsx`：トグル行（既定 ON・肯定形ラベル）・OFF 時の言語行の淡色＋注記・**アプリ設定 OFF の注記**・`⇧R`・`isDirty`・保存
- [x] ショートカット一覧に `⇧R`
- [x] `ja.json`／`en.json`／`es.json` ＋ `npm run verify:i18n`
- [x] `verify:db` に T18c（列追加・既定 0・往復・渡さない更新で変わらない・boolean 正規化・12 アサーション＝合計 200）
- [x] 実機：OFF のデッキで FAB と `S` が消える／タグ学習で OFF デッキのカードだけ消える／ON に戻すと復活する

### Phase 2（自動読み上げ・アプリ設定・Pro）

- [x] `lib/speech.ts` に `SpeechAutoMode` と「この面で自動か」の判定ヘルパ（`autoSpeaksSide`・`parseSpeechAutoMode`・`verify:speech` に 13 アサーション＝合計 172）
- [x] `store/settings.ts` の DEFS に `speechAuto`（既定 `'off'`）＋ setter、**`lib/settings-keys.ts` に追加**
- [x] 一覧モーダル（`SpeechAutoModal`・中央ダイアログの規約・`allowInherit`）
- [x] `app/settings/study.tsx`：行＋モーダル・非 Pro は鍵＋「オフ」＋paywall・`suspendKeys`・要約と ⓘ の1文
- [x] `app/study/session.tsx`：読む effect（`[currentCard?.id, isFlipped]`・ref 参照・**`isPro`**・メモ除外・休憩中は読まない）。**049 の stop effect も `onBreak` の定義の後へ移し、依存に `onBreak` を足す**（読んでいる途中で休憩に入ったら止める。実機で発覚＝当初は「読み始めない」だけだった）
- [x] paywall：`pro.featureDeckSpeech` を「自動読み上げ・デッキごとの読み上げ言語」に改稿（3言語）
- [x] 実機：表面／裏面／両面で発火する面が合う・メモ開閉で読み直さない・評価連打で被らない・編集から戻って読み直さない・閲覧モードでも読む
- [x] 実機：読んでいる途中で休憩に入ったら止まる（休憩明けに読み直さない）
- [x] 実機：**非 Pro では設定値が残っていても読まない**（体験終了後の確認）
- [x] 実機：反転アニメーションとの間合い（遅延なしで OK）

### Phase 3（自動読み上げ・デッキ上書き・Pro）

- [ ] `schema.ts` に `decks.speechAuto`（TEXT・NULL）の `ALTER TABLE`
- [ ] `types/index.ts` に `speechAuto: SpeechAutoMode | null`
- [ ] `lib/database/decks.ts`：`RawDeck`・`toDeck`（不正値は `null` に落とす）・`createDeck`・`updateDeck`（**渡されたときだけ書く**）
- [x] `lib/import.ts` の列リスト／`lib/tsv.ts` の件数（`tsvLossDeckSpeechLangs` の文言を「読み上げの設定」へ）
- [ ] `DeckSpeechModal`：先頭行＋`allowInherit` のモーダル（**この Modal の children の中**に置く）
- [ ] `deckSpeechSummary`・`speechConfigured` に `speechAuto` を含める／非 Pro の［設定を解除］で `null` に戻す
- [ ] `session.tsx`：`currentDeck?.speechAuto ?? speechAuto`（`isPro` の内側）
- [x] `ja.json`／`en.json`／`es.json` ＋ `npm run verify:i18n`
- [ ] `verify:db` の T18c を拡張（`speechAuto` の往復・NULL＝従う・不正値の正規化）
- [ ] 実機：アプリ「オフ」＋デッキ「両面」で読む／アプリ「両面」＋デッキ「オフ」で読まない／「アプリ設定に従う」に戻すとアプリ側に落ちる／非 Pro は解除だけできる

### 仕上げ

- [ ] `CLAUDE.md`：読み上げの節（デッキごと OFF・自動読み上げ・**適用側の `isPro` が 051 と違う理由**）・`store/settings.ts` の一覧・DB 列
- [ ] `docs/049` の Phase 2 を「052 で実装」に更新
- [ ] release-notes に1行

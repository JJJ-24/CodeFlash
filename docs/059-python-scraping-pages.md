# 059 Python のスクレイピング練習：`requests.get()` にデッキの HTML/CSS 土台で答える

**フェーズ:** Phase 1〜2（Phase 3 は保留）
**ステータス:** Phase 1 完了（実機確認済み 2026-10-03）・Phase 2 完了（実機確認済み 2026-10-03）・Phase 3 保留
**要ネイティブ再ビルド:** 不要（JS のみ）
**DB 変更:** なし（既存の `decks.htmlStages` をそのまま使う）
**依存:** 044（デッキの HTML/CSS 土台の複数持ち）・040（土台の Pro ゲート・`proStageHint`）

---

## 背景

Python ブロックでスクレイピングを学びたい、という要望（2026-10-03）。現状を調べた結果：

- **HTML の解析は今でもできる**：`# pip: beautifulsoup4` ＋ HTML を文字列で書けば BeautifulSoup が動く（実機確認済み 2026-10-03）。
- **ページの取得はほぼできない**：
  - `requests` / `urllib` は Pyodide にソケットが無いので動かない。
  - `pyodide.http.pyfetch` は動くが、実行ページのオリジンが `https://cdn.jsdelivr.net`（`useCodeExecution` の `baseUrl`）なので
    **CORS を許可しているサイトしか読めない**＝普通のサイトはほぼ全滅。オフラインでも当然動かない。

文字列で書く方式の不足は2つ：①ページの HTML を**カードごとに書き写す**ことになる ②スクレイピングの本体である
**「取得 → 解析 → リンクをたどって次のページ」の流れ**を練習できない。

## 方針（案B・2026-10-03 合意）

**デッキの HTML/CSS 土台を「架空のサイトのページ」として扱い、Python の `requests.get(URL)` に土台の中身で答える。**
実際の通信はしない＝オフラインでも動き、相手のサイトにも迷惑が掛からない。

```python
# pip: beautifulsoup4
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

res = requests.get("https://example.com/news")
soup = BeautifulSoup(res.text, "html.parser")
for a in soup.select("li.item a"):
    detail = requests.get(urljoin(res.url, a["href"]))      # 一覧 → 詳細へたどる
    print(a.text, BeautifulSoup(detail.text, "html.parser").h1.text)
```

### 1. どの土台がページになるか＝**名前が `http://` / `https://` で始まる土台**

- デッキの土台一覧（`DeckStagesModal`）で、土台の名前に URL を書けば、それがそのページの URL になる。
- **名前が URL でない土台は Python からは見えない**（今までどおり js/ts/html/css の土台としてだけ働く）。
- ⚠️ **ブロックごとの土台選択（`deckStageId`／`noDeckHtmlInit`）は Python では使わない**＝URL が付いた土台は**全部**取得できる。
  1ページしか選べないと「リンクをたどる」練習ができないため。Python ブロックには土台のピッカーを出さない（Phase 2 で状態の表示だけ出す）。
- **DB 変更なし**：URL は既存の `DeckStage.name` に入る。マイグレーション・TSV・JSON エクスポートは無改造
  （TSV で土台が落ちる警告＝`inspectTsvExport` は既に土台の件数を数えている）。
- 不採用：土台に「URL」欄を新設する（列を足す・編集面の UI が増える。名前と URL が二重になる）。
  ブロック単位でページを1つ選ぶ（上記＝リンクをたどれない）。

### 2. 本物と違うところを「隠さずに見せる」

このアプリは「ブラウザと同じに動く」を大事にしてきた（040 のフォーム送信の差し戻しなど）。今回は**意図して本物と違う動きをする**ので：

- **実行結果の末尾に1行の注記**を出す（`proStageHint` と同じ場所・同じ見た目）：
  「requests はデッキの HTML/CSS 土台（N ページ）から応答しました。実際の通信はしていません。」
  ＝**`requests` を実際に呼んだときだけ**出す（`import` しただけ・呼ばなかったカードでは出さない）。
- 登録されていない**ホスト**への要求は `requests.exceptions.ConnectionError`。メッセージに**取得できる URL の一覧**を入れる
  （学習者が URL の打ち間違いに自分で気づけるように。本物でも存在しないホストは接続エラーになるので、型としても自然）。
- ホストは登録済みで**パスが無い**ときは `404 Not Found` の Response を返す（本物の requests と同じく**例外にはしない**＝
  `raise_for_status()` の練習になる）。

### 3. `requests` の互換範囲（`lib/code-execution/pyRequestsShim.ts` に Python のソースとして持つ）

| 対応する | 内容 |
|---|---|
| `requests.get(url, params=None, headers=None, timeout=None, **kw)` | `params` は URL に付ける（`urlencode`）。`headers`/`timeout` は受け取って無視 |
| `requests.head(...)` | 本文が空の Response |
| `requests.Session()` | `get`/`head`/`headers`/`with` 構文。中身は上と同じ |
| `requests.post/put/delete/patch` | `405 Method Not Allowed`（ページしか無い＝受け取る側が存在しない） |
| `Response` | `status_code`・`ok`・`reason`・`url`・`text`・`content`（UTF-8 の bytes）・`encoding`/`apparent_encoding`（`'utf-8'`）・`headers`（`Content-Type`）・`json()`・`raise_for_status()`・`iter_lines()` |
| `requests.exceptions` | `RequestException`・`ConnectionError`・`HTTPError`・`Timeout`（Timeout は送出しないが `except` に書けるように定義だけ） |

- **`Content-Type` は中身から決める**：JSON として読めれば `application/json`、それ以外は `text/html; charset=utf-8`。
  ＝土台に JSON を置けば **API から取る練習**（`res.json()`）にもなる。
- **URL の照合**：`#` 以降は捨てる／スキームとホストは小文字化／末尾の `/` の有無は同一視（ルート以外）／クエリは完全一致。
  土台の名前も同じ正規化をかけて比べる。`http` と `https` は別物（本物と同じ）。
- **リダイレクト・Cookie・認証・文字コードの自動判定は無い**（Phase 3 でも扱わない）。
- ⚠️ ユーザーが `# pip: requests` と書いていたら、**その pip 指定だけ取り除いて**こちらの `requests` を使う
  （本物の requests は Pyodide では通信できず、入れても失敗するだけ）。
- ⚠️ **ページが1つも無いときは差し込まない**＝今までどおり `import requests` は `ModuleNotFoundError`
  （何も設定していないデッキの挙動は不変）。

### 4. Pro ゲート＝JS の土台と同じ「非 Pro には積まない」

- HTML/CSS 土台は Pro 機能・Python の実行は無料。**非 Pro ではページを渡さない**（`CodeRunnerView`/`CodeBlockItem` の
  `htmlInits` と同じ経路で空にする）。
- 非 Pro で URL の土台があるデッキの Python を実行したら、結果パネルに `proStageHint` 相当の1行
  「デッキのページを取得するのは Pro 機能です。このブロックはページなしで実行しました。」を出す
  （JS の `stageDroppedByPro` と同じ考え方。実行は止めない＝Python 実行は無料機能）。
  ⚠️ 条件は「URL の土台がある」だけでなく**本文に `requests` が出てくる**ときに絞る（Python で解析だけするカードに毎回出さない）。

## Phase 1：`requests` の差し込み（実行の中身）

- [x] `lib/code-execution/pyRequestsShim.ts`：Python のソース文字列（上の互換範囲）＋ページ一覧の受け渡し
- [x] `buildPythonSandboxHtml(code, pages)`：ページがあるとき、ユーザーコードの前に `sys.modules['requests']` を差し込む。
      ページは `JSON.stringify` で埋め込む（`</script>` を含む土台で HTML が壊れないようエスケープする）
- [x] 注記の出し分け：shim が「呼ばれたか」を JS 側へ返す（`finish` の payload に `pages: { used: true, count }`）
- [x] `useCodeExecution.run()` に Python 用のページ（`{ url, content }[]`）を渡す口。`CodeRunnerView`／`CodeBlockItem` で組み立てる
      （**URL 名の土台の抽出は `lib/deckStages.ts` に1関数**＝`pagesFromDeckStages(stages)`。両画面で同じ関数を使う）
- [x] `ExecutionOutput`：注記2種（通信していない／Pro でないので渡していない）。文言は ja/en/es
- [x] `npm run verify:pyrequests`：shim のソースを**ローカルの python3 で直接**動かして確かめる
      （URL 照合・params・404・ConnectionError のメッセージ・json()・Content-Type の判定・Session・405）。
      Pyodide そのものは Node で動かせないので、実機確認は Phase 1 の最後に1回
- [x] 実機確認：上の例（一覧 → 詳細）・`res.json()`・存在しないホスト・`raise_for_status()`・非 Pro

実装メモ（2026-10-03）：
- 検証は 45 項目（URL の照合・params・404・ConnectionError の一覧・json()・Content-Type・Session・405・生成 HTML の構文）。
- ついでに直した既存の不具合：Python の本文に `</script>` という文字列があると（BeautifulSoup の練習で HTML を文字列に書くと起こりうる）、
  サンドボックスの `<script>` がそこで閉じて実行できなかった。本文もページも `scriptJson()`（`<` を `\u003c` にする）で埋め込むようにした。

## Phase 2：作る側の見え方（UI）

- [x] 土台一覧（`DeckStagesModal`・HTML のときだけ）：名前が URL の行に**地球儀アイコン**（Python から取得できる印）。長い URL は中ほどを省略
- [x] 土台一覧の ⓘ（`deck.stagesHint`）に「名前を `https://…` にすると Python の `requests.get()` で取得できるページになる」を追記
- [x] Python ブロック（編集モードだけ・Pro のときだけ・**プレビューモードでは出さない**）に折りたたみの「デッキのページ（N）」
      ＝URL の一覧＋各行のコピー（コードに書く URL を写すため）＋ⓘ。既定は閉じる。**ページが無いデッキでは出さない**
- [x] 058 の J/K の止まり先に `pyPages` を追加（Return＝開閉・Space/Delete は何もしない）
- [x] CLAUDE.md のコード実行の節に追記
- [x] 実機確認

設計の変更（2026-10-03）：当初案の「タップで土台一覧を開く」はやめた。土台一覧はデッキ編集の部品で、
カード編集から開くとデッキの保存（土台の変更）をカード編集の中で扱うことになる＝保存の単位が混ざる。
カード編集で作る側に要るのは「どの URL を書けばよいか」なので、**見るだけ＋URL のコピー**にした。
土台の追加・編集の場所は ⓘ で案内する。

## Phase 3（保留・やるかは Phase 2 の後で決める）

- **カード固有のページ**（ブロック固有土台 `CodeBlock.htmlInit` を Python でも使えるようにする）：URL をどう決めるかが未定。
- **ページを見る手段**：土台一覧から ⛶ でページを描画して見る（作る側が見た目を確かめる用途）。
- `urllib.request.urlopen`・`pyodide.http.pyfetch` への対応（教材の多くが requests なので後回し）。

## 許容すること

- 実行の 5 秒の制限は今までどおり（ページの取得は一瞬なので実質影響なし。`time.sleep(1)` を挟む礼儀の練習は数ページまで）。
- BeautifulSoup の読み込みは今までどおり `# pip: beautifulsoup4` が必要（**初回実行は通信が要る**＝Pyodide 本体も CDN 読み込み。
  「オフラインで動く」のは `requests` の部分だけ）。
- 土台の `img://` はそのまま文字列として返る（Python では画像を扱わない）。

// ---- Block types ----

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface CodeBlock {
  type: 'code';
  language: string;
  content: string;
  executable: boolean;
  /** SQL ブロック固有の初期化SQL（このブロックの実行前にデッキ共通の後に流す）。SQL 言語時のみ意味を持つ */
  sqlInit?: string;
  /** 045：このブロックが使うデッキ SQL 土台（`Deck.sqlStages` の `id`）。
   *  規則は `deckStageId` と同一（未指定＝先頭／解決不能＝積まない／`noDeckSqlInit` が true なら無視）。 */
  deckSqlStageId?: string;
  /** 045：このブロックではデッキ共通の SQL 初期化を流さない（既定 false＝流す）。
   *  044 の `noDeckHtmlInit` と同型。「このカードだけ別スキーマ」「初期化なしの素の DB を見せる」出題向け。 */
  noDeckSqlInit?: boolean;
  /** web 系ブロック（html / js・ts / css）固有の HTML/CSS 土台。デッキ共通の後・本文の前に積む（加算）。
   *  実行前から見える「出題の前提」で、本文＝実行して初めて出る「答え」と対になる */
  htmlInit?: string;
  /** 044：このブロックが使うデッキ土台（`Deck.htmlStages` の `id`）。
   *  **未指定＝先頭の土台**（＝044 以前のカードの挙動）。`noDeckHtmlInit` が true ならこの値は無視される。
   *  解決できない id（土台が削除された）は「土台なし」に落とす＝先頭にフォールバックしない */
  deckStageId?: string;
  /** web 系ブロック：このブロックではデッキ共通の HTML/CSS 土台を積まない（既定 false＝積む）。
   *  「このカードはコンソール出力だけ」のように土台が無関係なブロックで、無関係なプレビューを消すため。
   *  js/ts は土台が空になるとコンソール実行に戻る（＝実行前プレビューも出なくなる）。 */
  noDeckHtmlInit?: boolean;
  /** html ブロック：実行前プレビューに**本文も**描画する（土台に書き足して完成させる出題向け）。
   *  既定 false＝実行するまで本文は描画しない（「表示結果を予想させる」出題の答えを先に見せないため）。 */
  previewInit?: boolean;
}

export interface ImageBlock {
  type: 'image';
  uri: string;
  alt: string;
  /** 学習画面での表示サイズ（最大幅プリセット）。未設定は既定 'M'。画像データ自体は不変（表示のみ） */
  size?: 'S' | 'M' | 'L';
}

export type Block = TextBlock | CodeBlock | ImageBlock;

// ---- Domain types ----

/** デッキに登録した HTML 画像ライブラリの 1 枚（043）。
 *  HTML ブロック／HTML 土台から `img://{name}` で参照し、実行時に data URI へ置換される。
 *  画像本体は画像ブロックと同じ `images/` に置く（同期・孤児掃除・エクスポートに自動で乗る）。 */
export interface DeckImage {
  /** 参照名（デッキ内で一意・`[A-Za-z0-9_-]+`） */
  name: string;
  /** `local://images/xxx.jpg` 形式 */
  uri: string;
}

/** 044：デッキが持つ名前付きの土台。**HTML/CSS 土台（`Deck.htmlStages`）と SQL 初期化（`Deck.sqlStages`）で
 *  同じ型を使う**（持ち方・一覧 UI・選択 UI・解決規則がまったく同じもので、違うのは中身の言語だけ）。
 *  コードブロックは `CodeBlock.deckStageId` / `deckSqlStageId` で1つを選ぶ。 */
export interface DeckStage {
  /** 参照キー。名前ではなく id で参照するのでリネームしても参照が壊れない */
  id: string;
  /** 表示名。**空文字を許容**し、そのときは UI が「土台N」（並び順ベース）で表示する
   *  （旧 `htmlInit`/`sqlInit` から合成した土台は DB 層で名前を付けられないため空になる） */
  name: string;
  /** 土台の中身（HTML/CSS 土台なら HTML、SQL 土台なら SQL）。
   *  ⚠️ 044 初期実装ではこのキーが `html` だった。DB に残っている旧キーは
   *  `parseDeckStages` が吸収するので、**新しく書くコードは `content` だけを見ればよい** */
  content: string;
}

export interface Deck {
  id: string;
  name: string;
  description: string;
  language: string;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  iconName: string | null;
  colorHex: string | null;
  /** 【045 以降は互換用ミラー】デッキ共通の SQL 初期化（先頭土台の写し）。
   *  **読み取りには使わない**（`sqlStages` が正）。旧バージョンのアプリと旧エクスポートのために残している */
  sqlInit: string | null;
  /** 045：名前付き SQL 初期化の一覧。`htmlStages` と同じ持ち方（DB には JSON 文字列）。
   *  旧 `sqlInit` しか無いデッキは `toDeck` が1件の土台に合成するので、**画面はこの配列だけを見ればよい**。未設定は [] */
  sqlStages: DeckStage[];
  /** 【044 以降は互換用ミラー】デッキ共通の HTML/CSS 土台（先頭土台の写し）。
   *  **読み取りには使わない**（`htmlStages` が正）。旧バージョンのアプリと旧エクスポートのために残している */
  htmlInit: string | null;
  /** 044：名前付き HTML/CSS 土台の一覧。DB には JSON 文字列で保存し、読み取り時に配列へ正規化する。
   *  旧 `htmlInit` しか無いデッキは `toDeck` が1件の土台に合成するので、**画面はこの配列だけを見ればよい**。未設定は [] */
  htmlStages: DeckStage[];
  /** HTML 画像ライブラリ（043）。DB には JSON 文字列で保存し、読み取り時に配列へ正規化する。未登録は [] */
  htmlImages: DeckImage[];
  /** アーカイブ済み（学習サイクル・将来指標から除外）。配下カードも含めて除外される */
  archived: boolean;
}

export interface Card {
  id: string;
  deckId: string;
  frontContent: Block[];
  backContent: Block[];
  memoContent: Block[];
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  /** アーカイブ済み（学習サイクル・将来指標から除外） */
  archived: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  sortOrder: number;
}

export interface CardTag {
  cardId: string;
  tagId: string;
}

export interface Review {
  cardId: string;
  easeFactor: number;    // 仮想値（FSRS difficulty から変換、マスタリー表示用）
  interval: number;      // レガシー（未使用）
  repetitions: number;   // レガシー（未使用）
  nextReviewDate: string;
  lastReviewDate: string;
  lastGrade: number; // 0=もう一度, 1=難しい, 2=普通, 3=簡単
  // FSRS フィールド（SM-2 時代のレビューは null）
  stability: number | null;
  difficulty: number | null;
  fsrsState: number | null;
  fsrsReps: number | null;
  fsrsLapses: number | null;
  fsrsScheduledDays: number | null;
}

export interface NotificationSchedule {
  id: string;
  hour: number;
  minute: number;
  /** 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土。空配列 = 毎日 */
  weekdays: number[];
  label: string;
  enabled: boolean;
  /** 046：1日の目標枚数が**未達成のときだけ**通知する（既定 false＝従来どおり無条件で通知）。
   *  iOS は発火時に条件を評価できないため、このスケジュールは繰り返しではなく
   *  日付指定で数日分を前倒し予約し、目標達成時に当日分をキャンセルする（`lib/notifications.ts`）。 */
  onlyIfGoalUnmet: boolean;
}

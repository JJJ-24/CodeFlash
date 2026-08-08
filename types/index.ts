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
  /** web 系ブロック（html / js・ts / css）固有の HTML/CSS 土台。デッキ共通の後・本文の前に積む（加算）。
   *  実行前から見える「出題の前提」で、本文＝実行して初めて出る「答え」と対になる */
  htmlInit?: string;
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
  /** デッキ共通の SQL 初期化（SQL ブロック実行時に毎回最初に流すスキーマ＋初期データ）。未設定は null */
  sqlInit: string | null;
  /** デッキ共通の HTML/CSS 土台（web 系ブロックのプレビュー土台）。未設定は null */
  htmlInit: string | null;
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
}

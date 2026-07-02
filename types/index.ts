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

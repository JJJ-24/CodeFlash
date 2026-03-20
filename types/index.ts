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
}

export interface ImageBlock {
  type: 'image';
  uri: string;
  alt: string;
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
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewDate: string;
  lastReviewDate: string;
  lastGrade: number; // 0=もう一度, 1=難しい, 2=普通, 3=簡単
}

import type { DeckSortOrder } from '@/store/settings';

/** sortDecks が必要とする最小限のフィールド（Deck / BackupDeckInfo の両方が満たす） */
type SortableDeck = { name: string; cardCount: number };

/**
 * デッキ一覧の並び替え。ホームのデッキ一覧・デッキ選択モーダル・統計のデッキ別習熟度などで共通利用する。
 * 'manual' は元の配列順（手動並べ替え順）をそのまま返す。
 */
export function sortDecks<T extends SortableDeck>(decks: T[], order: DeckSortOrder): T[] {
  if (order === 'name') {
    return [...decks].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
  if (order === 'cardCount') {
    return [...decks].sort((a, b) => b.cardCount - a.cardCount);
  }
  return decks;
}

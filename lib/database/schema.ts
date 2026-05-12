import type { SQLiteDatabase } from 'expo-sqlite';

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS decks (
      id          TEXT PRIMARY KEY NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      language    TEXT NOT NULL DEFAULT 'ja',
      cardCount   INTEGER NOT NULL DEFAULT 0,
      createdAt   TEXT NOT NULL,
      updatedAt   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id           TEXT PRIMARY KEY NOT NULL,
      deckId       TEXT NOT NULL,
      frontContent TEXT NOT NULL DEFAULT '[]',
      backContent  TEXT NOT NULL DEFAULT '[]',
      memoContent  TEXT NOT NULL DEFAULT '[]',
      createdAt    TEXT NOT NULL,
      updatedAt    TEXT NOT NULL,
      FOREIGN KEY (deckId) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS card_contents (
      cardId       TEXT PRIMARY KEY NOT NULL,
      frontContent TEXT NOT NULL DEFAULT '[]',
      backContent  TEXT NOT NULL DEFAULT '[]',
      memoContent  TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS tags (
      id        TEXT PRIMARY KEY NOT NULL,
      name      TEXT NOT NULL,
      color     TEXT NOT NULL DEFAULT '#888888',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_tags (
      cardId TEXT NOT NULL,
      tagId  TEXT NOT NULL,
      PRIMARY KEY (cardId, tagId),
      FOREIGN KEY (cardId) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId)  REFERENCES tags(id)  ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      cardId         TEXT PRIMARY KEY NOT NULL,
      easeFactor     REAL    NOT NULL DEFAULT 2.5,
      interval       INTEGER NOT NULL DEFAULT 0,
      repetitions    INTEGER NOT NULL DEFAULT 0,
      nextReviewDate TEXT    NOT NULL,
      lastReviewDate TEXT    NOT NULL,
      FOREIGN KEY (cardId) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS review_logs (
      cardId       TEXT NOT NULL,
      reviewedDate TEXT NOT NULL,
      PRIMARY KEY (cardId, reviewedDate)
    );
  `);

  // sortOrder カラムのマイグレーション（既存ユーザー・新規インストール両対応）
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(decks)');
  if (!cols.some((c) => c.name === 'sortOrder')) {
    await db.execAsync(`
      ALTER TABLE decks ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE cards ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tags  ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0;
    `);
    await db.execAsync(`
      UPDATE decks SET sortOrder = rowid;
      UPDATE cards SET sortOrder = rowid;
      UPDATE tags  SET sortOrder = rowid;
    `);
  }

  // lastGrade カラムのマイグレーション（0=もう一度, 1=難しい, 2=普通, 3=簡単）
  const reviewCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(reviews)');
  if (!reviewCols.some((c) => c.name === 'lastGrade')) {
    await db.execAsync(`ALTER TABLE reviews ADD COLUMN lastGrade INTEGER NOT NULL DEFAULT 2;`);
  }

  // FSRS カラムのマイグレーション
  if (!reviewCols.some((c) => c.name === 'stability')) {
    await db.execAsync(`
      ALTER TABLE reviews ADD COLUMN stability REAL;
      ALTER TABLE reviews ADD COLUMN difficulty REAL;
      ALTER TABLE reviews ADD COLUMN fsrsState INTEGER;
      ALTER TABLE reviews ADD COLUMN fsrsReps INTEGER;
      ALTER TABLE reviews ADD COLUMN fsrsLapses INTEGER;
      ALTER TABLE reviews ADD COLUMN fsrsScheduledDays INTEGER;
    `);
  }

  // card_contents テーブルへの分離マイグレーション
  // cards に frontContent が残っている場合（旧スキーマ）は card_contents へ移行して cards を再作成する
  const cardCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(cards)');
  if (cardCols.some((c) => c.name === 'frontContent')) {
    await db.runAsync(
      'INSERT OR IGNORE INTO card_contents (cardId, frontContent, backContent, memoContent) SELECT id, frontContent, backContent, memoContent FROM cards'
    );
    await db.execAsync(`
      CREATE TABLE cards_new (
        id        TEXT PRIMARY KEY NOT NULL,
        deckId    TEXT NOT NULL,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      INSERT INTO cards_new (id, deckId, sortOrder, createdAt, updatedAt)
        SELECT id, deckId, sortOrder, createdAt, updatedAt FROM cards;
      DROP TABLE cards;
      ALTER TABLE cards_new RENAME TO cards;
    `);
  }

  // deckId インデックス（大量カードのデッキ別クエリ高速化）
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_cards_deckId ON cards (deckId);
  `);

  // grade_logs テーブル（カード別正答率算出用）
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS grade_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      cardId      TEXT    NOT NULL,
      grade       INTEGER NOT NULL,
      reviewedAt  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_grade_logs_cardId ON grade_logs (cardId);
  `);

  // grade_logs へ responseTimeMs カラム追加（回答時間ミリ秒）
  const gradeLogCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(grade_logs)');
  if (!gradeLogCols.some((c) => c.name === 'responseTimeMs')) {
    await db.execAsync(`ALTER TABLE grade_logs ADD COLUMN responseTimeMs INTEGER;`);
  }
}

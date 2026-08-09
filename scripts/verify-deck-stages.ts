/**
 * デッキ土台の複数持ちの検証（044: HTML/CSS 土台 ／ 045: SQL 初期化）。
 * `docs/044-multiple-deck-stages.md`（HTML・Phase 6）と `docs/045-multiple-deck-sql-stages.md`（SQL）に対応する。
 *
 * 実行: `npm run verify:db`
 *
 * RN コンポーネントは Node で描画できないため、ここで見るのは**データ層と分岐ロジック**：
 * 旧DBの正規化・エクスポート/インポートの往復・土台削除時の解決・互換ミラー・同期トリガー。
 * UI（トグル↔チップの切替、既定バッジ、プレビューの見え方）は実機で確認する。
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { createAsserts, fsFiles, installModuleStubs, makeDb } from './db-harness';

// ⚠️ アプリのモジュールを読む前にスタブを入れる（import は巻き上げられるので require で読むこと）
installModuleStubs({
  // インポート完了後の設定 hydrate は検証対象外（i18n・通知など重い依存を引き込むため no-op に）
  '@/store/settings': { hydrateSettings: async () => {} },
  '@/store/theme': { hydrateTheme: async () => {} },
});

const { migrateDbIfNeeded } = require('@/lib/database/schema');
const { createDeck, updateDeck, getAllDecks, getDeckById } = require('@/lib/database/decks');
const { LEGACY_STAGE_ID, resolveDeckStageHtml, resolveDeckStageSql, legacyInitMirror, normalizeDeckStages, parseDeckStages } =
  require('@/lib/deckStages');
const { exportDatabase } = require('@/lib/export');
const { importDatabase } = require('@/lib/import');
const { inspectTsvExport, hasTsvExportLoss } = require('@/lib/tsv');

const { check, eq, report } = createAsserts();

const STAGES = [
  { id: 's1', name: 'フレックス', content: '<div class="row">A</div>' },
  { id: 's2', name: 'グリッド', content: '<div class="grid">B</div>' },
];

async function main() {
  // ===========================================================================
  console.log('\n[T1] 旧DB（htmlStages 列なし）で起動 → 既存デッキの土台が1件に正規化される');
  // ===========================================================================
  const db1 = makeDb();
  await migrateDbIfNeeded(db1);
  // 044 以前の DB を再現する（列を落として旧バージョンの状態に戻す）
  db1.raw.exec('ALTER TABLE decks DROP COLUMN htmlStages');
  const cols0 = await db1.getAllAsync('PRAGMA table_info(decks)');
  check('前提: htmlStages 列が無い状態', !cols0.some((c: { name: string }) => c.name === 'htmlStages'));
  await db1.runAsync(
    `INSERT INTO decks (id,name,description,language,cardCount,sortOrder,htmlInit,createdAt,updatedAt)
     VALUES ('d-old','旧デッキ','','ja',0,1,'<div id="box"></div>','2026-01-01','2026-01-01')`
  );
  // 新バージョンで起動＝マイグレーション再実行
  await migrateDbIfNeeded(db1);
  const cols1 = await db1.getAllAsync('PRAGMA table_info(decks)');
  check('マイグレーションで htmlStages 列が追加される', cols1.some((c: { name: string }) => c.name === 'htmlStages'));
  const [oldDeck] = await getAllDecks(db1);
  eq('toDeck が htmlInit から土台1件を合成', oldDeck.htmlStages, [
    { id: LEGACY_STAGE_ID, name: '', content: '<div id="box"></div>' },
  ]);
  check(
    '合成した土台の id は固定（LEGACY_STAGE_ID）＝再読込で揺れない',
    (await getDeckById(db1, 'd-old')).htmlStages[0].id === LEGACY_STAGE_ID
  );
  check('名前は空＝UI 側が「土台N」と表示する規則', oldDeck.htmlStages[0].name === '');
  await db1.runAsync(
    `INSERT INTO decks (id,name,description,language,cardCount,sortOrder,htmlInit,createdAt,updatedAt)
     VALUES ('d-none','土台なし','','ja',0,2,NULL,'2026-01-01','2026-01-01')`
  );
  eq('土台の無い旧デッキは空配列', (await getDeckById(db1, 'd-none')).htmlStages, []);
  eq('空白だけの htmlInit も空配列', normalizeDeckStages(null, '   '), []);
  eq('壊れた JSON は空配列に倒れる（デッキ読込を殺さない）', parseDeckStages('{壊れ'), []);
  eq('形の違う要素は捨てる', parseDeckStages('[{"id":"a"},{"id":"b","name":"n","content":"h"}]'), [
    { id: 'b', name: 'n', content: 'h' },
  ]);

  // ===========================================================================
  console.log('\n[T2] 保存経路：htmlStages が正・htmlInit は先頭土台のミラー');
  // ===========================================================================
  const db2 = makeDb();
  await migrateDbIfNeeded(db2);
  const created = await createDeck(db2, { name: 'HTML入門', description: '', language: 'ja', htmlStages: STAGES });
  eq('createDeck の戻り値の htmlStages', created.htmlStages, STAGES);
  eq('createDeck が htmlInit に先頭土台をミラー書き', created.htmlInit, STAGES[0].content);
  const rowA = await db2.getFirstAsync('SELECT htmlInit, htmlStages FROM decks WHERE id = ?', [created.id]);
  eq('DB の htmlInit も先頭土台', rowA.htmlInit, STAGES[0].content);
  eq('DB の htmlStages は JSON', JSON.parse(rowA.htmlStages), STAGES);

  // 並びを入れ替えたら（＝先頭が変わったら）ミラーも追従する
  await updateDeck(db2, created.id, { name: 'HTML入門', description: '', language: 'ja', htmlStages: [STAGES[1], STAGES[0]] });
  const rowB = await db2.getFirstAsync('SELECT htmlInit FROM decks WHERE id = ?', [created.id]);
  eq('先頭が変わればミラーも追従', rowB.htmlInit, STAGES[1].content);
  await updateDeck(db2, created.id, { name: 'HTML入門', description: '', language: 'ja', htmlStages: STAGES });

  // htmlStages を渡さない更新（他画面からのデッキ更新）で土台が消えないこと
  await updateDeck(db2, created.id, { name: '改名', description: 'x', language: 'ja' });
  eq('htmlStages を渡さない更新では土台が残る', (await getDeckById(db2, created.id)).htmlStages, STAGES);

  // 旧バージョンのアプリによる UPDATE（htmlStages 列を知らない）を模す
  await db2.runAsync('UPDATE decks SET name = ?, htmlInit = ? WHERE id = ?', ['旧アプリ更新', '<div id="box"></div>', created.id]);
  eq('旧バージョンが更新しても htmlStages 列は残る（＝新バージョンで復帰）', (await getDeckById(db2, created.id)).htmlStages, STAGES);
  eq('legacyInitMirror: 空土台なら NULL', legacyInitMirror([{ id: 'x', name: '', content: '  ' }]), null);
  eq('legacyInitMirror: 空配列なら NULL', legacyInitMirror([]), null);

  // ===========================================================================
  console.log('\n[T3] JSON エクスポート → replace インポートで htmlStages / deckStageId が復元される');
  // ===========================================================================
  const db3 = makeDb();
  await migrateDbIfNeeded(db3);
  const deck3 = await createDeck(db3, { name: 'デッキ', description: '', language: 'ja', htmlStages: STAGES });
  const backBlocks = [
    { id: 'b1', type: 'code', language: 'javascript', content: 'a', executable: true, deckStageId: 's2' },
    { id: 'b2', type: 'code', language: 'html', content: 'b', executable: true, noDeckHtmlInit: true },
    { id: 'b3', type: 'code', language: 'javascript', content: 'c', executable: true }, // 未指定＝先頭
  ];
  await db3.runAsync(
    `INSERT INTO cards (id,deckId,sortOrder,archived,createdAt,updatedAt) VALUES ('c1',?,0,0,'2026-01-01','2026-01-01')`,
    [deck3.id]
  );
  await db3.runAsync(`INSERT INTO card_contents (cardId,frontContent,backContent,memoContent) VALUES ('c1','[]',?,'[]')`, [
    JSON.stringify(backBlocks),
  ]);

  await exportDatabase(db3, false);
  const exportedUri = Object.keys(fsFiles).find((k) => k.endsWith('.json'))!;
  const exported = JSON.parse(fsFiles[exportedUri]);
  check('エクスポートの decks に htmlStages が入る（SELECT * 経由）', typeof exported.decks[0].htmlStages === 'string');
  eq('エクスポートの htmlStages 中身', JSON.parse(exported.decks[0].htmlStages), STAGES);
  check('エクスポートの card_contents に deckStageId が残る', exported.cards[0].backContent.includes('"deckStageId":"s2"'));

  const db3b = makeDb();
  await migrateDbIfNeeded(db3b);
  await importDatabase(db3b, exportedUri, 'replace');
  const imported = await getDeckById(db3b, deck3.id);
  eq('replace インポートで htmlStages が復元', imported.htmlStages, STAGES);
  eq('replace インポートで htmlInit ミラーも復元', imported.htmlInit, STAGES[0].content);
  const importedContent = await db3b.getFirstAsync('SELECT backContent FROM card_contents WHERE cardId = ?', ['c1']);
  const importedBlocks = JSON.parse(importedContent.backContent);
  eq('deckStageId が復元', importedBlocks.map((b: { deckStageId?: string }) => b.deckStageId), ['s2', undefined, undefined]);
  eq('復元した参照が土台を解決できる', resolveDeckStageHtml(imported.htmlStages, importedBlocks[0]), STAGES[1].content);

  const db3c = makeDb();
  await migrateDbIfNeeded(db3c);
  await importDatabase(db3c, exportedUri, 'merge');
  eq('merge インポートでも htmlStages が復元', (await getDeckById(db3c, deck3.id)).htmlStages, STAGES);

  // ===========================================================================
  console.log('\n[T4] 旧バージョンのエクスポートファイル（htmlStages キーなし）を新バージョンで読める');
  // ===========================================================================
  const legacyExport = JSON.parse(fsFiles[exportedUri]);
  for (const d of legacyExport.decks) {
    delete d.htmlStages;
    delete d.htmlImages;
  }
  legacyExport.decks[0].htmlInit = '<div id="legacy"></div>';
  delete legacyExport.grade_logs; // さらに古いエクスポート（grade_logs 以前）も同時に確認
  const legacyUri = '/cache/legacy_export.json';
  fsFiles[legacyUri] = JSON.stringify(legacyExport);
  const db4 = makeDb();
  await migrateDbIfNeeded(db4);
  await importDatabase(db4, legacyUri, 'replace');
  const legacyImported = await getDeckById(db4, deck3.id);
  eq('旧エクスポートは htmlInit から土台1件に合成される', legacyImported.htmlStages, [
    { id: LEGACY_STAGE_ID, name: '', content: '<div id="legacy"></div>' },
  ]);
  eq('旧デッキ＋未指定ブロック → 合成された土台が積まれる', resolveDeckStageHtml(legacyImported.htmlStages, {}), '<div id="legacy"></div>');
  eq('旧デッキ＋死んだ deckStageId → 土台なし', resolveDeckStageHtml(legacyImported.htmlStages, { deckStageId: 's2' }), '');

  // ===========================================================================
  console.log('\n[T5] 土台を削除 → 参照カードが「土台なし」に落ちる（先頭にフォールバックしない）');
  // ===========================================================================
  const db5 = makeDb();
  await migrateDbIfNeeded(db5);
  const deck5 = await createDeck(db5, { name: 'D', description: '', language: 'ja', htmlStages: STAGES });
  const blockRefS2 = { deckStageId: 's2' };
  eq('削除前: s2 を指すブロックは s2 の土台', resolveDeckStageHtml((await getDeckById(db5, deck5.id)).htmlStages, blockRefS2), STAGES[1].content);
  await updateDeck(db5, deck5.id, { name: 'D', description: '', language: 'ja', htmlStages: [STAGES[0]] });
  const after5 = await getDeckById(db5, deck5.id);
  eq('削除後: 参照は解決できず土台なし（先頭に落ちない）', resolveDeckStageHtml(after5.htmlStages, blockRefS2), '');
  eq('未指定のブロックは残った先頭土台を使う', resolveDeckStageHtml(after5.htmlStages, {}), STAGES[0].content);
  eq('先頭土台を削除すると既定が次にずれる', resolveDeckStageHtml([STAGES[1]], {}), STAGES[1].content);

  // resolveDeckStageHtml の残りの分岐
  eq('noDeckHtmlInit が最優先（deckStageId があっても積まない）', resolveDeckStageHtml(STAGES, { noDeckHtmlInit: true, deckStageId: 's2' }), '');
  eq('土台0件＋未指定 → 空', resolveDeckStageHtml([], {}), '');
  eq('stages が undefined → 空', resolveDeckStageHtml(undefined, {}), '');

  // ===========================================================================
  console.log('\n[T6] TSV エクスポートの損失内訳（htmlStages 件数）');
  // ===========================================================================
  const loss = await inspectTsvExport(db3, await getDeckById(db3, deck3.id));
  eq('TSV 損失: 土台の件数を数える', loss.deckHtmlStages, 2);
  check('TSV 損失あり判定', hasTsvExportLoss(loss));
  const lossNone = await inspectTsvExport(db1, await getDeckById(db1, 'd-none'));
  eq('土台なしデッキは 0 件', lossNone.deckHtmlStages, 0);
  eq('SQL 初期化の件数も数える', loss.deckSqlStages, 0);
  check('土台なしデッキは警告を出さない', !hasTsvExportLoss(lossNone));
  const lossLegacy = await inspectTsvExport(db1, await getDeckById(db1, 'd-old'));
  eq('旧 htmlInit のデッキも1件として数える（合成後）', lossLegacy.deckHtmlStages, 1);

  // ===========================================================================
  console.log('\n[T7] iCloud 同期：土台だけの変更でも localVersion が進む（列指定なしトリガー）');
  // ===========================================================================
  const db7 = makeDb();
  await migrateDbIfNeeded(db7);
  const deck7 = await createDeck(db7, { name: 'D', description: '', language: 'ja', htmlStages: [STAGES[0]] });
  const v0 = await db7.getFirstAsync('SELECT localVersion FROM sync_state WHERE id = 1');
  await updateDeck(db7, deck7.id, { name: 'D', description: '', language: 'ja', htmlStages: STAGES });
  const v1 = await db7.getFirstAsync('SELECT localVersion FROM sync_state WHERE id = 1');
  check('土台の追加で localVersion が進む', v1.localVersion > v0.localVersion, { before: v0.localVersion, after: v1.localVersion });

  // ===========================================================================
  console.log('\n[T8] 045・SQL 初期化：旧DB（sqlStages 列なし）→ sqlInit から1件に正規化される');
  // ===========================================================================
  const db8 = makeDb();
  await migrateDbIfNeeded(db8);
  db8.raw.exec('ALTER TABLE decks DROP COLUMN sqlStages');
  await db8.runAsync(
    `INSERT INTO decks (id,name,description,language,cardCount,sortOrder,sqlInit,createdAt,updatedAt)
     VALUES ('d-sql','旧SQLデッキ','','ja',0,1,'CREATE TABLE users(id);','2026-01-01','2026-01-01')`
  );
  await migrateDbIfNeeded(db8);
  const sqlLegacyDeck = await getDeckById(db8, 'd-sql');
  eq('toDeck が sqlInit から SQL 土台1件を合成', sqlLegacyDeck.sqlStages, [
    { id: LEGACY_STAGE_ID, name: '', content: 'CREATE TABLE users(id);' },
  ]);
  eq('HTML 側は空のまま（互いに独立）', sqlLegacyDeck.htmlStages, []);

  // ===========================================================================
  console.log('\n[T9] 045・SQL 初期化：保存経路と互換ミラー');
  // ===========================================================================
  const SQL_STAGES = [
    { id: 'q1', name: 'users テーブル', content: 'CREATE TABLE users(id INTEGER, name TEXT);' },
    { id: 'q2', name: 'orders テーブル', content: 'CREATE TABLE orders(id INTEGER, userId INTEGER);' },
  ];
  const db9 = makeDb();
  await migrateDbIfNeeded(db9);
  const deck9 = await createDeck(db9, { name: 'SQL入門', description: '', language: 'ja', sqlStages: SQL_STAGES, htmlStages: STAGES });
  eq('createDeck の戻り値の sqlStages', deck9.sqlStages, SQL_STAGES);
  eq('createDeck が sqlInit に先頭土台をミラー書き', deck9.sqlInit, SQL_STAGES[0].content);
  eq('HTML と SQL が同じデッキで共存する', deck9.htmlStages, STAGES);

  await updateDeck(db9, deck9.id, { name: 'SQL入門', description: '', language: 'ja', sqlStages: [SQL_STAGES[1]] });
  const after9 = await getDeckById(db9, deck9.id);
  eq('sqlStages 更新でミラーも追従', after9.sqlInit, SQL_STAGES[1].content);
  eq('sqlStages を渡しても htmlStages は消えない', after9.htmlStages, STAGES);
  await updateDeck(db9, deck9.id, { name: 'SQL入門', description: '', language: 'ja' });
  const untouched9 = await getDeckById(db9, deck9.id);
  eq('どちらも渡さない更新で両方残る', untouched9.sqlStages, [SQL_STAGES[1]]);
  // 土台を渡さない更新で**互換ミラーだけ NULL になる**と、新バージョンでは気づけないまま
  // 旧バージョン／旧エクスポートから土台が消える。旧列も「渡されたときだけ」書く実装になっていること。
  eq('土台を渡さない更新でも sqlInit ミラーが残る', untouched9.sqlInit, SQL_STAGES[1].content);
  eq('土台を渡さない更新でも htmlInit ミラーが残る', untouched9.htmlInit, STAGES[0].content);

  // ===========================================================================
  console.log('\n[T10] 045・SQL 初期化：解決規則（HTML と同一）');
  // ===========================================================================
  eq('未指定 → 先頭', resolveDeckStageSql(SQL_STAGES, {}), SQL_STAGES[0].content);
  eq('id 指定 → その土台', resolveDeckStageSql(SQL_STAGES, { deckSqlStageId: 'q2' }), SQL_STAGES[1].content);
  eq('削除済み id → 積まない（先頭に落ちない）', resolveDeckStageSql(SQL_STAGES, { deckSqlStageId: 'gone' }), '');
  eq('noDeckSqlInit が最優先', resolveDeckStageSql(SQL_STAGES, { noDeckSqlInit: true, deckSqlStageId: 'q2' }), '');
  eq('0件 → 空', resolveDeckStageSql([], {}), '');
  // HTML 側のフラグは SQL の解決に影響しない（フィールドが独立していること）
  eq('noDeckHtmlInit は SQL に影響しない', resolveDeckStageSql(SQL_STAGES, { noDeckHtmlInit: true } as never), SQL_STAGES[0].content);
  eq('noDeckSqlInit は HTML に影響しない', resolveDeckStageHtml(STAGES, { noDeckSqlInit: true } as never), STAGES[0].content);

  // ===========================================================================
  console.log('\n[T11] 045・SQL 初期化：エクスポート → インポート往復');
  // ===========================================================================
  await db9.runAsync(
    `INSERT INTO cards (id,deckId,sortOrder,archived,createdAt,updatedAt) VALUES ('c9',?,0,0,'2026-01-01','2026-01-01')`,
    [deck9.id]
  );
  await db9.runAsync(`INSERT INTO card_contents (cardId,frontContent,backContent,memoContent) VALUES ('c9','[]',?,'[]')`, [
    JSON.stringify([{ id: 'sb1', type: 'code', language: 'sql', content: 'SELECT 1', executable: true, deckSqlStageId: 'q2' }]),
  ]);
  for (const k of Object.keys(fsFiles)) if (k.endsWith('.json')) delete fsFiles[k];
  await exportDatabase(db9, false);
  const sqlExportUri = Object.keys(fsFiles).find((k) => k.endsWith('.json'))!;
  const db11 = makeDb();
  await migrateDbIfNeeded(db11);
  await importDatabase(db11, sqlExportUri, 'replace');
  eq('replace インポートで sqlStages が復元', (await getDeckById(db11, deck9.id)).sqlStages, [SQL_STAGES[1]]);
  const sqlContent = await db11.getFirstAsync('SELECT backContent FROM card_contents WHERE cardId = ?', ['c9']);
  eq('deckSqlStageId が復元', JSON.parse(sqlContent.backContent)[0].deckSqlStageId, 'q2');

  // 045 以前のエクスポート（sqlStages キーなし）
  const oldSqlExport = JSON.parse(fsFiles[sqlExportUri]);
  for (const d of oldSqlExport.decks) delete d.sqlStages;
  fsFiles['/cache/old_sql.json'] = JSON.stringify(oldSqlExport);
  const db11b = makeDb();
  await migrateDbIfNeeded(db11b);
  await importDatabase(db11b, '/cache/old_sql.json', 'replace');
  eq('045 以前のエクスポートは sqlInit から1件に合成', (await getDeckById(db11b, deck9.id)).sqlStages, [
    { id: LEGACY_STAGE_ID, name: '', content: SQL_STAGES[1].content },
  ]);

  // ===========================================================================
  console.log('\n[T12] 044 初期実装の旧キー `html` を読める（045 の content へのリネーム互換）');
  // ===========================================================================
  eq('旧キー html を content として読む', parseDeckStages('[{"id":"a","name":"旧","html":"<b>x</b>"}]'), [
    { id: 'a', name: '旧', content: '<b>x</b>' },
  ]);
  eq('content と html が両方あれば content 優先', parseDeckStages('[{"id":"a","name":"n","content":"new","html":"old"}]'), [
    { id: 'a', name: 'n', content: 'new' },
  ]);
  const db12 = makeDb();
  await migrateDbIfNeeded(db12);
  await db12.runAsync(
    `INSERT INTO decks (id,name,description,language,cardCount,sortOrder,htmlStages,createdAt,updatedAt)
     VALUES ('d-oldkey','旧キー','','ja',0,1,?,'2026-01-01','2026-01-01')`,
    [JSON.stringify([{ id: 'x1', name: '土台A', html: '<div>A</div>' }])]
  );
  const oldKeyDeck = await getDeckById(db12, 'd-oldkey');
  eq('旧キーで保存済みのデッキがそのまま読める', oldKeyDeck.htmlStages, [{ id: 'x1', name: '土台A', content: '<div>A</div>' }]);
  await updateDeck(db12, 'd-oldkey', { name: '旧キー', description: '', language: 'ja', htmlStages: oldKeyDeck.htmlStages });
  const rewritten = await db12.getFirstAsync('SELECT htmlStages FROM decks WHERE id = ?', ['d-oldkey']);
  check('保存し直すと新キー content で書き戻される', rewritten.htmlStages.includes('"content"') && !rewritten.htmlStages.includes('"html"'));

  report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

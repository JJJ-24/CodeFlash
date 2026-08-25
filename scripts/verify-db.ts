/**
 * DB ロジックと判定ロジックの検証（テストフレームワーク未導入のための代替）。
 *
 * 対象: 044/045 デッキ土台の複数持ち（`docs/044` / `docs/045`）・
 *       046 1日の目標枚数（`docs/046`）・050 Phase 2 デッキ単位の読み上げ言語（`docs/050`）。
 *       **新しい機能を足したらここにセクションを追加する。**
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
const { parseScriptLangs } = require('@/lib/speech');
const { getTodayReviewedCount } = require('@/lib/database/reviews');
const { shouldFireStudyGoal, isStudyGoalUnmet, computeGoalLookaheadDays, computeGoalDayStats, PENDING_NOTIFICATION_LIMIT } =
  require('@/lib/studyGoal');
const { getLifetimeStats } = require('@/lib/database/reviews');
const { searchCards, SEARCH_RESULT_LIMIT, SEARCH_DATE_RESULT_LIMIT } = require('@/lib/database/cards');
const { getActiveCardCount } = require('@/lib/database/reviews');
const { getAllSchedules, createSchedule, updateSchedule, MAX_SCHEDULES } = require('@/lib/database/notifications');

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

  // ===========================================================================
  console.log('\n[T13] 046・1日の目標枚数：達成判定（またぎ判定）');
  // ===========================================================================
  // 引数は (今日の枚数, 目標, 開始時点で達成済みか, 既に出したか)
  check('未達成 → 出さない', !shouldFireStudyGoal(19, 20, false, false));
  check('ちょうど到達 → 出す', shouldFireStudyGoal(20, 20, false, false));
  check('超過 → 出す', shouldFireStudyGoal(25, 20, false, false));
  check('**開始時点で達成済み → 出さない**（1日単位ゆえの誤発火防止）', !shouldFireStudyGoal(30, 20, true, false));
  check('**基準が未確定（null）→ 出さない**（誤発火より不発）', !shouldFireStudyGoal(30, 20, null, false));
  check('このセッションで既に出した → 出さない', !shouldFireStudyGoal(30, 20, false, true));
  check('目標1枚：1枚学習で出す', shouldFireStudyGoal(1, 1, false, false));
  check('取得失敗（-1）→ 出さない', !shouldFireStudyGoal(-1, 20, false, false));
  check('未達成判定（リマインダー用）', isStudyGoalUnmet(9, 10) && !isStudyGoalUnmet(10, 10));

  // ===========================================================================
  console.log('\n[T14] 046・枚数の数え方：同じカードを複数回評価しても1枚');
  // ===========================================================================
  const db14 = makeDb();
  await migrateDbIfNeeded(db14);
  const deck14 = await createDeck(db14, { name: 'D', description: '', language: 'ja' });
  const now14 = new Date().toISOString();
  for (const cid of ['k1', 'k2']) {
    await db14.runAsync(
      `INSERT INTO cards (id,deckId,sortOrder,archived,createdAt,updatedAt) VALUES (?,?,0,0,?,?)`,
      [cid, deck14.id, now14, now14]
    );
  }
  // reviews は cardId が主キー＝同じカードを何度評価しても行は1つ（＝実カード枚数になる）
  for (const cid of ['k1', 'k2']) {
    await db14.runAsync(
      `INSERT INTO reviews (cardId,easeFactor,interval,repetitions,nextReviewDate,lastReviewDate)
       VALUES (?,2.5,0,1,?,?)`,
      [cid, now14, now14]
    );
  }
  eq('2枚学習 → 2', await getTodayReviewedCount(db14), 2);
  // 「再考」で同じカードを再評価（lastReviewDate だけ更新）しても増えない
  await db14.runAsync('UPDATE reviews SET repetitions = 2, lastReviewDate = ? WHERE cardId = ?', [now14, 'k1']);
  eq('同じカードを再評価しても増えない', await getTodayReviewedCount(db14), 2);
  // アーカイブしたカードは数えない（activeCardCond）
  await db14.runAsync('UPDATE cards SET archived = 1 WHERE id = ?', ['k2']);
  eq('アーカイブしたカードは数えない', await getTodayReviewedCount(db14), 1);

  // ===========================================================================
  console.log('\n[T15] 046 Phase 2・通知スケジュールの onlyIfGoalUnmet 列');
  // ===========================================================================
  const db15 = makeDb();
  await migrateDbIfNeeded(db15);
  // 045 以前の DB を再現（列なし）→ 再マイグレーションで既定 0 が入る
  db15.raw.exec('ALTER TABLE notification_schedules DROP COLUMN onlyIfGoalUnmet');
  await db15.runAsync(
    `INSERT INTO notification_schedules (id,hour,minute,weekdays,label,enabled) VALUES ('s-old',8,0,'[]','朝',1)`
  );
  await migrateDbIfNeeded(db15);
  const cols15 = await db15.getAllAsync('PRAGMA table_info(notification_schedules)');
  check('マイグレーションで onlyIfGoalUnmet 列が追加される',
    cols15.some((c: { name: string }) => c.name === 'onlyIfGoalUnmet'));
  const [oldSched] = await getAllSchedules(db15);
  check('既存スケジュールは false（＝従来どおり無条件で通知）', oldSched.onlyIfGoalUnmet === false);
  check('SQLite の 0/1 が boolean に正規化される', typeof oldSched.onlyIfGoalUnmet === 'boolean');

  const created15 = await createSchedule(db15, {
    hour: 20, minute: 0, weekdays: [1, 2, 3, 4, 5], label: '夜', enabled: true, onlyIfGoalUnmet: true,
  });
  const all15 = await getAllSchedules(db15);
  const night = all15.find((x: { id: string }) => x.id === created15.id);
  check('作成時に onlyIfGoalUnmet が保存される', night.onlyIfGoalUnmet === true);
  eq('曜日指定も保持される', night.weekdays, [1, 2, 3, 4, 5]);
  await updateSchedule(db15, { ...night, onlyIfGoalUnmet: false });
  const afterUpd = (await getAllSchedules(db15)).find((x: { id: string }) => x.id === created15.id);
  check('更新で false に戻せる', afterUpd.onlyIfGoalUnmet === false);

  // ===========================================================================
  console.log('\n[T16] 046 Phase 2・学習できるカードの有無（催促を抑止する客観条件）');
  // ===========================================================================
  const db16 = makeDb();
  await migrateDbIfNeeded(db16);
  eq('カードが無いアプリ → 0（未達成リマインダーを予約しない）', await getActiveCardCount(db16), 0);
  const deck16 = await createDeck(db16, { name: 'D', description: '', language: 'ja' });
  const now16 = new Date().toISOString();
  await db16.runAsync(
    `INSERT INTO cards (id,deckId,sortOrder,archived,createdAt,updatedAt) VALUES ('m1',?,0,0,?,?)`,
    [deck16.id, now16, now16]
  );
  eq('カードが1枚 → 1', await getActiveCardCount(db16), 1);
  await db16.runAsync('UPDATE cards SET archived = 1 WHERE id = ?', ['m1']);
  eq('アーカイブしたら 0（打つ手がない状態）', await getActiveCardCount(db16), 0);
  // デッキごとアーカイブしても 0（activeCardCond はデッキ側も見る）
  await db16.runAsync('UPDATE cards SET archived = 0 WHERE id = ?', ['m1']);
  await db16.runAsync('UPDATE decks SET archived = 1 WHERE id = ?', [deck16.id]);
  eq('デッキごとアーカイブでも 0', await getActiveCardCount(db16), 0);

  // ===========================================================================
  console.log('\n[T17] 046 Phase 2・予約本数が iOS の上限（64件）を超えない');
  // ===========================================================================
  // 未達成リマインダーは繰り返し予約が使えず日付指定で数日分を個別に予約するため、
  // 曜日指定つきの通常スケジュールと合わせると理屈の上では上限に届きうる。
  // **超えると古い予約から黙って捨てられ「一部の通知だけ来ない」という壊れ方をする**ので、
  // 最悪ケース（全スケジュールが全曜日指定）を総当たりで検算しておく。
  // ⚠️ MAX_SCHEDULES を増やすとここが落ちる＝そのときに先読み日数か枠の設計を見直すこと。
  const WEEKDAYS = 7;      // 曜日指定つき通常スケジュールが使う予約数（最悪ケース）
  const RESERVED = 1;      // 休憩終了通知（039）などの臨時予約
  let worst = 0;
  let worstShape = '';
  for (let plainCount = 0; plainCount <= MAX_SCHEDULES; plainCount++) {
    const conditionalCount = MAX_SCHEDULES - plainCount;
    const plainRegistrations = plainCount * WEEKDAYS;
    const lookahead = computeGoalLookaheadDays(plainRegistrations, conditionalCount);
    const total = plainRegistrations + conditionalCount * lookahead + RESERVED;
    if (total > worst) { worst = total; worstShape = `通常${plainCount}件+条件つき${conditionalCount}件(先読み${lookahead}日)`; }
  }
  check(
    `最悪ケースでも上限内（最大 ${worst} 件 / 上限 ${PENDING_NOTIFICATION_LIMIT} 件・${worstShape}）`,
    worst <= PENDING_NOTIFICATION_LIMIT,
    { worst, limit: PENDING_NOTIFICATION_LIMIT }
  );
  // 先読み日数の分岐そのもの
  eq('枠に余裕があれば最大7日', computeGoalLookaheadDays(0, 1), 7);
  eq('条件つきが多ければ配分が減る', computeGoalLookaheadDays(0, 30), 2);
  eq('枠を使い切っていても最低1日は予約する', computeGoalLookaheadDays(1000, 5), 1);
  eq('条件つきが無ければ0日（予約しない）', computeGoalLookaheadDays(0, 0), 0);

  // ===========================================================================
  console.log('\n[T18] 050 Phase 2・デッキ単位の読み上げ言語（speechLangs 列）');
  // ===========================================================================
  const db18 = makeDb();
  await migrateDbIfNeeded(db18);
  // 050 以前の DB を再現（列を落として旧バージョンの状態に戻す）
  db18.raw.exec('ALTER TABLE decks DROP COLUMN speechLangs');
  await db18.runAsync(
    `INSERT INTO decks (id,name,description,language,cardCount,sortOrder,createdAt,updatedAt)
     VALUES ('d-spk','旧デッキ','','ja',0,1,'2026-01-01','2026-01-01')`
  );
  await migrateDbIfNeeded(db18);
  const cols18 = await db18.getAllAsync('PRAGMA table_info(decks)');
  check('マイグレーションで speechLangs 列が追加される', cols18.some((c: { name: string }) => c.name === 'speechLangs'));
  eq('既存デッキは未設定（{}）', (await getDeckById(db18, 'd-spk')).speechLangs, {});

  const deck18 = await createDeck(db18, {
    name: '中国語', description: '', language: 'ja', speechLangs: { han: 'zh-CN' },
  });
  eq('createDeck の戻り値に上書きが入る', deck18.speechLangs, { han: 'zh-CN' });
  eq('読み直しても同じ', (await getDeckById(db18, deck18.id)).speechLangs, { han: 'zh-CN' });

  // ⚠️ 044 の教訓：渡さない更新で黙って消えてはいけない
  await updateDeck(db18, deck18.id, { name: '中国語', description: '', language: 'ja' });
  eq('speechLangs を渡さない更新では消えない', (await getDeckById(db18, deck18.id)).speechLangs, { han: 'zh-CN' });
  await updateDeck(db18, deck18.id, { name: '中国語', description: '', language: 'ja', speechLangs: {} });
  eq('空を渡せば解除できる（NULL に戻る）', (await getDeckById(db18, deck18.id)).speechLangs, {});

  // 壊れた値・知らないキーは捨てる（iCloud / JSON インポート経由の防御）
  await db18.runAsync('UPDATE decks SET speechLangs = ? WHERE id = ?', ['{"han":"zh-CN","zzz":"xx","latin":""}', deck18.id]);
  eq('知らないキーと空の値は捨てる', (await getDeckById(db18, deck18.id)).speechLangs, { han: 'zh-CN' });
  await db18.runAsync('UPDATE decks SET speechLangs = ? WHERE id = ?', ['{壊れた', deck18.id]);
  eq('壊れた JSON は未設定に倒す', (await getDeckById(db18, deck18.id)).speechLangs, {});
  eq('配列も未設定に倒す', parseScriptLangs('["latin"]'), {});

  // ⚠️ 解決規則（`mergeScriptLangs`）とキー比較（`scriptLangsEqual`）は純関数なので
  // `npm run verify:speech` が見る（lib/speech.ts の持ち場）。ここは DB 経路だけを見る。

  // TSV は往復しないので件数を警告に出す
  await updateDeck(db18, deck18.id, { name: '中国語', description: '', language: 'ja', speechLangs: { han: 'zh-CN' } });
  const loss18 = await inspectTsvExport(db18, await getDeckById(db18, deck18.id));
  eq('TSV 損失: 上書きの件数を数える', loss18.deckSpeechLangs, 1);
  check('上書きだけでも警告を出す', hasTsvExportLoss(loss18));

  // JSON エクスポート → インポート往復
  for (const k of Object.keys(fsFiles)) if (k.endsWith('.json')) delete fsFiles[k];
  await exportDatabase(db18, false);
  const spkUri = Object.keys(fsFiles).find((k) => k.endsWith('.json'))!;
  const db18b = makeDb();
  await migrateDbIfNeeded(db18b);
  await importDatabase(db18b, spkUri, 'replace');
  eq('replace インポートで speechLangs が復元', (await getDeckById(db18b, deck18.id)).speechLangs, { han: 'zh-CN' });
  // 050 以前のエクスポート（speechLangs キーなし）
  const oldSpkExport = JSON.parse(fsFiles[spkUri]);
  for (const d of oldSpkExport.decks) delete d.speechLangs;
  fsFiles['/cache/old_speech.json'] = JSON.stringify(oldSpkExport);
  const db18c = makeDb();
  await migrateDbIfNeeded(db18c);
  await importDatabase(db18c, '/cache/old_speech.json', 'replace');
  eq('050 以前のエクスポートは未設定として読める', (await getDeckById(db18c, deck18.id)).speechLangs, {});

  // ===========================================================================
  console.log('\n[T19] 046 Phase 5・統計「学習の記録」の目標達成（現在の目標で過去も判定）');
  // ===========================================================================
  // 日別の枚数から「達成日数・最長連続達成・達成率」を出す純粋関数。
  // ⚠️ **目標値の履歴は持たない**（A案）＝同じ日別データでも goal を変えれば結果が変わる。
  const daily = [
    { date: '2026-01-01', count: 25 }, // 達成
    { date: '2026-01-02', count: 30 }, // 達成（連続2）
    { date: '2026-01-03', count: 5 },  // 未達成 → ここで切れる
    { date: '2026-01-04', count: 20 }, // 達成（連続1）
    // 2026-01-05 は学習していない（行が無い）→ 連続が切れる
    { date: '2026-01-06', count: 40 }, // 達成（連続1）
  ];
  const g20 = computeGoalDayStats(daily, 20);
  eq('達成日数（20枚目標）', g20.achievedDays, 4);
  eq('最長連続達成は暦日が連続した分だけ', g20.longestAchievedStreak, 2);
  eq('達成率の分母は「学習した日」（4/5）', g20.achievementRate, 80);
  // 学習していない日（1/5）は分母にも連続にも入らない＝経過日数を分母にしていないことの確認
  check('学習していない日は分母に入らない（6日間だが分母は5日）', daily.length === 5);
  const g30 = computeGoalDayStats(daily, 30);
  eq('目標を上げると過去の達成日数も減る', g30.achievedDays, 2);
  eq('目標を上げると連続も切れる（1/2 と 1/6 は非連続）', g30.longestAchievedStreak, 1);
  eq('達成率も現在の目標で計算し直す（2/5）', g30.achievementRate, 40);
  const gEmpty = computeGoalDayStats([], 20);
  eq('未学習なら達成日数 0', gEmpty.achievedDays, 0);
  eq('未学習なら達成率は null（0% と区別する）', gEmpty.achievementRate, null);
  eq('全日達成なら連続＝日数', computeGoalDayStats(
    [{ date: '2026-03-01', count: 5 }, { date: '2026-03-02', count: 5 }, { date: '2026-03-03', count: 5 }], 5
  ).longestAchievedStreak, 3);
  // 月をまたぐ連続（UTC 換算の日数差で判定しているか）
  eq('月またぎでも連続と判定する', computeGoalDayStats(
    [{ date: '2026-01-31', count: 9 }, { date: '2026-02-01', count: 9 }], 5
  ).longestAchievedStreak, 2);

  // dailyCounts の作られ方（review_logs は (cardId, reviewedDate) が PK ＝1行1枚）。
  // ⚠️ ここが崩れると「その日に学習した実カード枚数」という目標の定義とズレる。
  const db19 = makeDb();
  await migrateDbIfNeeded(db19);
  for (const [cardId, date] of [['c1', '2026-02-01'], ['c2', '2026-02-01'], ['c3', '2026-02-02']]) {
    await db19.runAsync('INSERT OR IGNORE INTO review_logs (cardId, reviewedDate) VALUES (?,?)', [cardId, date]);
  }
  // 同じカードを同じ日に何度評価しても増えない（PK で弾かれる）
  await db19.runAsync('INSERT OR IGNORE INTO review_logs (cardId, reviewedDate) VALUES (?,?)', ['c1', '2026-02-01']);
  const life19 = await getLifetimeStats(db19);
  eq('dailyCounts は日別の実カード枚数（昇順）', life19.dailyCounts, [
    { date: '2026-02-01', count: 2 },
    { date: '2026-02-02', count: 1 },
  ]);
  eq('totalDays は dailyCounts の行数と一致', life19.totalDays, life19.dailyCounts.length);
  eq('目標2枚なら達成は 2/1 の1日だけ', computeGoalDayStats(life19.dailyCounts, 2).achievedDays, 1);

  // ===========================================================================
  console.log('\n[T20] 検索の「学習した日」フィルター（1日単位・学習順・上限別建て）');
  // ===========================================================================
  const db20 = makeDb();
  await migrateDbIfNeeded(db20);
  const deckA = await createDeck(db20, { name: 'A', description: '', language: 'ja' });
  const deckB = await createDeck(db20, { name: 'B', description: '', language: 'ja' });
  const t20 = '2026-08-20T00:00:00.000Z';
  for (const [id, deckId, front] of [
    ['c1', deckA.id, 'カードいち'],
    ['c2', deckA.id, 'カードに'],
    ['c3', deckB.id, 'カードさん'],
    ['c4', deckA.id, 'カードよん'],
  ] as [string, string, string][]) {
    await db20.runAsync(
      `INSERT INTO cards (id,deckId,sortOrder,archived,createdAt,updatedAt) VALUES (?,?,0,0,?,?)`,
      [id, deckId, t20, t20]
    );
    await db20.runAsync(
      `INSERT INTO card_contents (cardId,frontContent,backContent,memoContent) VALUES (?,?,'[]','[]')`,
      [id, JSON.stringify([{ id: 'b1', type: 'text', content: front }])]
    );
  }
  // 8/24 に c1・c2・c3 を学習、8/23 に c4 を学習
  for (const [cardId, date] of [['c1', '2026-08-24'], ['c2', '2026-08-24'], ['c3', '2026-08-24'], ['c4', '2026-08-23']] as [string, string][]) {
    await db20.runAsync('INSERT OR IGNORE INTO review_logs (cardId, reviewedDate) VALUES (?,?)', [cardId, date]);
  }
  // 学習時刻（並び順の元）。⚠️ `date(reviewedAt,'localtime')` で判定されるので、UTC-11〜+11 の
  // どのタイムゾーンで実行しても 8/24 になる昼の時刻を使う。c2 のほうが後 ＝ 先に並ぶ。
  for (const [cardId, at] of [['c1', '2026-08-24T12:00:00.000Z'], ['c2', '2026-08-24T13:00:00.000Z']] as [string, string][]) {
    await db20.runAsync('INSERT INTO grade_logs (cardId, grade, reviewedAt, responseTimeMs) VALUES (?,2,?,1000)', [cardId, at]);
  }

  const byDate = await searchCards(db20, '', 'all', undefined, undefined, '2026-08-24');
  eq('文字クエリが空でも学習日だけで検索できる', byDate.map((c: { id: string }) => c.id).sort().join(','), 'c1,c2,c3');
  eq('別の日のカードは入らない', byDate.some((c: { id: string }) => c.id === 'c4'), false);
  // 並び順：grade_logs があるものが新しい順、無いものは末尾（SQLite は NULL が最小＝DESC で最後）
  eq('その日の学習が新しい順に並ぶ（記録の無いものは末尾）', byDate.map((c: { id: string }) => c.id).join(','), 'c2,c1,c3');

  const byDateDeck = await searchCards(db20, '', 'all', [deckA.id], undefined, '2026-08-24');
  eq('学習日とデッキを掛け合わせられる', byDateDeck.map((c: { id: string }) => c.id).join(','), 'c2,c1');

  const byDateText = await searchCards(db20, 'さん', 'all', undefined, undefined, '2026-08-24');
  eq('文字クエリとも併用できる', byDateText.map((c: { id: string }) => c.id).join(','), 'c3');

  eq('条件が何も無ければ空（全件返さない）', (await searchCards(db20, '', 'all')).length, 0);
  eq('学習日なしの文字検索は従来どおり', (await searchCards(db20, 'カード', 'all')).length, 4);

  // アーカイブ済みも出す（過去実績なので activeCardCond は掛けない規約）
  await db20.runAsync('UPDATE cards SET archived = 1 WHERE id = ?', ['c1']);
  eq('アーカイブ済みカードも学習日検索には出る', (await searchCards(db20, '', 'all', undefined, undefined, '2026-08-24')).length, 3);

  check(
    `学習日の上限は文字検索より大きい（${SEARCH_DATE_RESULT_LIMIT} > ${SEARCH_RESULT_LIMIT}）`,
    SEARCH_DATE_RESULT_LIMIT > SEARCH_RESULT_LIMIT
  );

  report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

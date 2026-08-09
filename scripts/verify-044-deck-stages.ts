/**
 * 044（デッキ土台の複数持ち）の検証。`docs/044-multiple-deck-stages.md` の Phase 6 に対応する。
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
const { LEGACY_STAGE_ID, resolveDeckStageHtml, legacyHtmlInitMirror, normalizeDeckStages, parseDeckStages } =
  require('@/lib/deckStages');
const { exportDatabase } = require('@/lib/export');
const { importDatabase } = require('@/lib/import');
const { inspectTsvExport, hasTsvExportLoss } = require('@/lib/tsv');

const { check, eq, report } = createAsserts();

const STAGES = [
  { id: 's1', name: 'フレックス', html: '<div class="row">A</div>' },
  { id: 's2', name: 'グリッド', html: '<div class="grid">B</div>' },
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
    { id: LEGACY_STAGE_ID, name: '', html: '<div id="box"></div>' },
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
  eq('形の違う要素は捨てる', parseDeckStages('[{"id":"a"},{"id":"b","name":"n","html":"h"}]'), [
    { id: 'b', name: 'n', html: 'h' },
  ]);

  // ===========================================================================
  console.log('\n[T2] 保存経路：htmlStages が正・htmlInit は先頭土台のミラー');
  // ===========================================================================
  const db2 = makeDb();
  await migrateDbIfNeeded(db2);
  const created = await createDeck(db2, { name: 'HTML入門', description: '', language: 'ja', htmlStages: STAGES });
  eq('createDeck の戻り値の htmlStages', created.htmlStages, STAGES);
  eq('createDeck が htmlInit に先頭土台をミラー書き', created.htmlInit, STAGES[0].html);
  const rowA = await db2.getFirstAsync('SELECT htmlInit, htmlStages FROM decks WHERE id = ?', [created.id]);
  eq('DB の htmlInit も先頭土台', rowA.htmlInit, STAGES[0].html);
  eq('DB の htmlStages は JSON', JSON.parse(rowA.htmlStages), STAGES);

  // 並びを入れ替えたら（＝先頭が変わったら）ミラーも追従する
  await updateDeck(db2, created.id, { name: 'HTML入門', description: '', language: 'ja', htmlStages: [STAGES[1], STAGES[0]] });
  const rowB = await db2.getFirstAsync('SELECT htmlInit FROM decks WHERE id = ?', [created.id]);
  eq('先頭が変わればミラーも追従', rowB.htmlInit, STAGES[1].html);
  await updateDeck(db2, created.id, { name: 'HTML入門', description: '', language: 'ja', htmlStages: STAGES });

  // htmlStages を渡さない更新（他画面からのデッキ更新）で土台が消えないこと
  await updateDeck(db2, created.id, { name: '改名', description: 'x', language: 'ja' });
  eq('htmlStages を渡さない更新では土台が残る', (await getDeckById(db2, created.id)).htmlStages, STAGES);

  // 旧バージョンのアプリによる UPDATE（htmlStages 列を知らない）を模す
  await db2.runAsync('UPDATE decks SET name = ?, htmlInit = ? WHERE id = ?', ['旧アプリ更新', '<div id="box"></div>', created.id]);
  eq('旧バージョンが更新しても htmlStages 列は残る（＝新バージョンで復帰）', (await getDeckById(db2, created.id)).htmlStages, STAGES);
  eq('legacyHtmlInitMirror: 空土台なら NULL', legacyHtmlInitMirror([{ id: 'x', name: '', html: '  ' }]), null);
  eq('legacyHtmlInitMirror: 空配列なら NULL', legacyHtmlInitMirror([]), null);

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
  eq('replace インポートで htmlInit ミラーも復元', imported.htmlInit, STAGES[0].html);
  const importedContent = await db3b.getFirstAsync('SELECT backContent FROM card_contents WHERE cardId = ?', ['c1']);
  const importedBlocks = JSON.parse(importedContent.backContent);
  eq('deckStageId が復元', importedBlocks.map((b: { deckStageId?: string }) => b.deckStageId), ['s2', undefined, undefined]);
  eq('復元した参照が土台を解決できる', resolveDeckStageHtml(imported.htmlStages, importedBlocks[0]), STAGES[1].html);

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
    { id: LEGACY_STAGE_ID, name: '', html: '<div id="legacy"></div>' },
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
  eq('削除前: s2 を指すブロックは s2 の土台', resolveDeckStageHtml((await getDeckById(db5, deck5.id)).htmlStages, blockRefS2), STAGES[1].html);
  await updateDeck(db5, deck5.id, { name: 'D', description: '', language: 'ja', htmlStages: [STAGES[0]] });
  const after5 = await getDeckById(db5, deck5.id);
  eq('削除後: 参照は解決できず土台なし（先頭に落ちない）', resolveDeckStageHtml(after5.htmlStages, blockRefS2), '');
  eq('未指定のブロックは残った先頭土台を使う', resolveDeckStageHtml(after5.htmlStages, {}), STAGES[0].html);
  eq('先頭土台を削除すると既定が次にずれる', resolveDeckStageHtml([STAGES[1]], {}), STAGES[1].html);

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

  report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

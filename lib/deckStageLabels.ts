/**
 * 044/045：デッキ土台の UI 文言キーの対応表。
 *
 * 土台の**持ち方・一覧 UI・選択 UI・解決規則は HTML と SQL で共通**（`lib/deckStages.ts`・
 * `DeckStagesModal`・`CodeBlockItem` のチップ選択）だが、**呼び名だけは分けている**：
 * HTML は「土台」、SQL は「初期化」。実物の語彙（HTML/CSS 土台／初期化SQL）が既に違うので、
 * 片方に寄せると画面ごとに言い方が食い違って読み手が迷うため。
 *
 * 共通部品はこの表を引いて文言を出す＝**部品側に html/sql の分岐を持ち込まない**。
 */

export type DeckStageKind = 'html' | 'sql';

export const DECK_STAGE_KEYS = {
  html: {
    /** 一覧モーダルのタイトル・デッキ編集の行ラベル */
    title: 'deck.htmlInitLabel',
    /** 一覧の説明文 */
    listHint: 'deck.stagesHint',
    /** 土台が0件のときの表示 */
    listEmpty: 'deck.stagesEmpty',
    /** 名前が空の土台の表示名（`{{n}}` に並び順） */
    defaultName: 'deck.stageDefaultName',
    /** 編集面の説明文・プレースホルダ */
    editorHint: 'deck.htmlInitHint',
    editorPlaceholder: 'deck.htmlInitPlaceholder',
    /** 削除確認（先頭を消すときだけ既定がずれる旨の別文言を出す） */
    deleteConfirm: 'deck.stageDeleteConfirm',
    deleteFirstConfirm: 'deck.stageDeleteFirstConfirm',
    /** デッキ編集の行の要約（`{{count}}` に件数） */
    countSummary: 'deck.htmlStagesSet',
    /** ブロック側：土台が2つ以上のときのチップ選択 */
    pickerLabel: 'editor.deckStagePickerLabel',
    pickerHint: 'editor.deckStagePickerHint',
    /** ブロック側：土台が1つのときの ON/OFF トグル */
    toggleLabel: 'editor.useDeckHtmlInitLabel',
    toggleHint: 'editor.useDeckHtmlInitHint',
  },
  sql: {
    title: 'deck.sqlInitLabel',
    listHint: 'deck.sqlStagesHint',
    listEmpty: 'deck.sqlStagesEmpty',
    defaultName: 'deck.sqlStageDefaultName',
    editorHint: 'deck.sqlInitHint',
    editorPlaceholder: 'deck.sqlInitPlaceholder',
    deleteConfirm: 'deck.sqlStageDeleteConfirm',
    deleteFirstConfirm: 'deck.sqlStageDeleteFirstConfirm',
    countSummary: 'deck.sqlStagesSet',
    pickerLabel: 'editor.deckSqlStagePickerLabel',
    pickerHint: 'editor.deckSqlStagePickerHint',
    toggleLabel: 'editor.useDeckSqlInitLabel',
    toggleHint: 'editor.useDeckSqlInitHint',
  },
} as const satisfies Record<DeckStageKind, Record<string, string>>;

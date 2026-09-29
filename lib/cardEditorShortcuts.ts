// カードエディタ（新規/編集）のショートカット一覧。6カテゴリー分類。
// 新規作成時は「カード複製(C)」「アーカイブ(E・フォーカスなし／Space)」を new.tsx の filterForNew が除外する。
// 056：編集モードの J/K はブロックの後ろ（＋ブロック追加・タグ・アーカイブ）まで巡回する。並べ替えモードはブロックだけ。
// 058：コードブロックの中の土台・初期化にも J/K が止まる（⇧J/⇧K はブロック単位）。G＝言語・Space＝実行トグル。V・⇧F・⇧R＝プレビュー枠（学習画面と同じ）。
export const CARD_EDITOR_SECTIONS_EDIT = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: '1-3',      descKey: 'shortcut.tabSelectCard' },
    { key: 'U / D',    descKey: 'shortcut.scrollUpDown' },
    { key: '⇧U / ⇧D', descKey: 'shortcut.scrollTopBottom' },
        { key: 'M / ⇧M',        descKey: 'shortcut.cycleMode' },
  ] },
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K',    descKey: 'shortcut.focusNextPrev' },
    { key: '⇧J / ⇧K', descKey: 'shortcut.blockNextPrev' },
    { key: 'T',        descKey: 'shortcut.scrollToTags' },
    { key: 'E',        descKey: 'shortcut.editArchiveCombo' },
    { key: 'R',        descKey: 'shortcut.runFocused' },
    { key: 'G',        descKey: 'shortcut.codeLanguage' },
    { key: 'V',        descKey: 'shortcut.previewSourceToggle', pro: true },
    { key: '⇧F',       descKey: 'shortcut.previewExpand', pro: true },
    { key: '⇧R',       descKey: 'shortcut.previewReset' },
    { key: 'Delete',   descKey: 'shortcut.delete' },
    { key: 'A',        descKey: 'shortcut.toggleAddMenu' },
    { key: 'Return',   descKey: 'shortcut.editorReturn' },
    { key: 'Space',    descKey: 'shortcut.editorSpace' },
  ] },
  { titleKey: 'shortcut.catAction', items: [
    { key: '⇧E',       descKey: 'shortcut.archiveToggle' },
    { key: 'S',        descKey: 'shortcut.save' },
    { key: 'C',        descKey: 'shortcut.duplicateCard' },
    { key: 'X',        descKey: 'shortcut.close' },
  ] },
  { titleKey: 'shortcut.catFormat', items: [
    { key: '⌘B',  descKey: 'shortcut.decoBold' },
    { key: '⌘I',  descKey: 'shortcut.decoItalic' },
    { key: '⌘U',  descKey: 'shortcut.decoUnderline' },
    { key: '⌘E',  descKey: 'shortcut.decoCode' },
    { key: '⌘⇧X', descKey: 'shortcut.decoStrike' },
    { key: '⌘⇧M', descKey: 'shortcut.decoMark' },
    { key: '⌘⇧H', descKey: 'shortcut.decoHeading' },
    { key: '⌘⇧8', descKey: 'shortcut.decoBullet' },
    { key: '⌘⇧9', descKey: 'shortcut.decoQuote' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC',      descKey: 'shortcut.esc' },
    { key: '?',        descKey: 'shortcut.showShortcuts' },
  ] },
];

export const CARD_EDITOR_SECTIONS_SORT = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: 'M / ⇧M',      descKey: 'shortcut.cycleMode' },
  ] },
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K',  descKey: 'shortcut.focusNextPrev' },
    { key: 'U / D',  descKey: 'shortcut.moveFocused' },
    { key: 'E',      descKey: 'shortcut.archiveUnfocused' },
    { key: 'Delete', descKey: 'shortcut.delete' },
  ] },
  { titleKey: 'shortcut.catAction', items: [
    { key: '⇧E',     descKey: 'shortcut.archiveToggle' },
    { key: 'S',      descKey: 'shortcut.save' },
    { key: 'C',      descKey: 'shortcut.duplicateCard' },
    { key: 'X',      descKey: 'shortcut.close' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC',    descKey: 'shortcut.esc' },
    { key: '?',      descKey: 'shortcut.showShortcuts' },
  ] },
];

export const CARD_EDITOR_SECTIONS_PREVIEW = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: '1-3',      descKey: 'shortcut.tabSelectCard' },
    { key: 'U / D',    descKey: 'shortcut.scrollUpDown' },
    { key: '⇧U / ⇧D', descKey: 'shortcut.scrollTopBottom' },
    { key: 'M / ⇧M',        descKey: 'shortcut.cycleMode' },
  ] },
  { titleKey: 'shortcut.catAction', items: [
    { key: 'S',        descKey: 'shortcut.save' },
    { key: 'C',        descKey: 'shortcut.duplicateCard' },
    { key: 'Delete',   descKey: 'shortcut.deleteCard' },
    { key: 'X',        descKey: 'shortcut.close' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC',      descKey: 'shortcut.esc' },
    { key: '?',        descKey: 'shortcut.showShortcuts' },
  ] },
];

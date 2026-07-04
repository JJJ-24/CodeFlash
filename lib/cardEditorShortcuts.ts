// カードエディタ（新規/編集）のショートカット一覧。6カテゴリー分類。
// 新規作成時は「カード複製(C)」「アーカイブ切替(⇧E)」を new.tsx の filterForNew が除外する。
export const CARD_EDITOR_SECTIONS_EDIT = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: '1-3',      descKey: 'shortcut.tabSelectCard' },
    { key: 'U / D',    descKey: 'shortcut.scrollUpDown' },
    { key: '⇧U / ⇧D', descKey: 'shortcut.scrollTopBottom' },
    { key: 'T',        descKey: 'shortcut.scrollToTags' },
    { key: 'M',        descKey: 'shortcut.cycleMode' },
  ] },
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K',    descKey: 'shortcut.focusNextPrev' },
    { key: 'E',        descKey: 'shortcut.editFocusedItem' },
    { key: 'R',        descKey: 'shortcut.runFocused' },
    { key: 'Delete',   descKey: 'shortcut.delete' },
    { key: 'A',        descKey: 'shortcut.toggleAddMenu' },
    { key: 'Return',   descKey: 'shortcut.addBlock' },
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
    { key: 'M',      descKey: 'shortcut.cycleMode' },
  ] },
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K',  descKey: 'shortcut.focusNextPrev' },
    { key: 'U / D',  descKey: 'shortcut.moveFocused' },
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
    { key: 'M',        descKey: 'shortcut.cycleMode' },
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

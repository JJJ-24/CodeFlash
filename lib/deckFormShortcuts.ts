// デッキの新規作成・編集で共通のショートカット一覧の断片。
// 土台/初期化の一覧（H/Q で開くモーダル＝DeckStagesModal）の中のキー。画面のキーとは■見出しで分ける（統計と同じ2階層）。
export const DECK_STAGE_SHEET_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K', descKey: 'shortcut.focusNextPrev', pro: true },
    { key: 'Return', descKey: 'shortcut.stageOpen', pro: true },
    { key: 'Delete', descKey: 'shortcut.deleteFocused', pro: true },
    { key: 'V', descKey: 'shortcut.stageViewPage', pro: true },
  ] },
  { titleKey: 'shortcut.catAction', items: [
    { key: 'N', descKey: 'shortcut.stageAdd', pro: true },
  ] },
];

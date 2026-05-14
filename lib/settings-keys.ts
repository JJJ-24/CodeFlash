/** エクスポート/インポート対象の AsyncStorage キー一覧。
 *  Pro ステータス（@codeflash_is_pro）は意図的に除外（RevenueCat 経由で正規に復元するため）。 */
export const SETTINGS_ASYNC_STORAGE_KEYS = [
  '@codeflash_theme',
  '@codeflash_font_size',
  '@codeflash_keyboard_shortcuts',
  '@codeflash_initial_filter',
  '@codeflash_last_code_language',
  '@codeflash_last_deck_detail_filter',
  '@codeflash_notification_enabled',
  '@codeflash_notification_hour',
  '@codeflash_notification_minute',
  '@codeflash_deck_sort',
  '@codeflash_tag_sort',
  '@codeflash_card_sort',
  '@codeflash_shuffle',
  '@codeflash_last_search_field',
  '@codeflash_fsrs_retention',
] as const;

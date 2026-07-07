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
  '@codeflash_deck_sort_locked',
  '@codeflash_tag_sort',
  '@codeflash_card_sort',
  '@codeflash_manual_sort_locked',
  '@codeflash_shuffle',
  '@codeflash_last_search_field',
  '@codeflash_fsrs_retention',
  '@codeflash_study_hide_empty',
  '@codeflash_grade_ranking_by_time',
  '@codeflash_grade_ranking_period',
  // デッキIDの配列。別データへの merge では存在しないIDになりうるが、
  // 統計画面側で存在しないIDは実質無視されるため無害（replace では整合する）。
  '@codeflash_grade_ranking_deck_ids',
  '@codeflash_card_theme',
  '@codeflash_language_pref',
  '@codeflash_last_home_filter',
  '@codeflash_last_tag_card_filter',
] as const;

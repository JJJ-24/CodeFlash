/** エクスポート/インポート対象の AsyncStorage キー一覧。
 *  Pro ステータス（@codeflash_is_pro）は意図的に除外（RevenueCat 経由で正規に復元するため）。
 *  Pro トライアル関連（@codeflash_trial_*、lib/proTrial.ts）も意図的に除外
 *  （バックアップの書き戻しで体験状態を復元・改変できてしまうため）。 */
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
  '@codeflash_tag_sort_locked',
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
  // 評価別ランキングを「学習履歴が残るカード」だけに絞るか
  '@codeflash_grade_ranking_recordable_only',
  // 統計タブの折りたたみ中セクションID配列（'chart' 等の固定IDなので端末間で常に有効）
  '@codeflash_stats_collapsed_sections',
  // 「学習の記録」シートの表示モード（'total'|'max'|'avg'）
  '@codeflash_record_sheet_mode',
  // 「学習履歴」（草グラフ）の表示モード（'volume'|'goal'）
  '@codeflash_heatmap_mode',
  // 学習設定の折りたたみ中セクションID配列（同上）
  '@codeflash_study_collapsed_sections',
  '@codeflash_card_theme',
  '@codeflash_language_pref',
  '@codeflash_last_home_filter',
  '@codeflash_last_tag_card_filter',
  '@codeflash_study_timer_enabled',
  '@codeflash_study_timer_minutes',
  '@codeflash_study_timer_ring_visible',
  '@codeflash_study_timer_show_time',
  '@codeflash_study_timer_end_behavior',
  '@codeflash_study_timer_break_minutes',
  '@codeflash_study_timer_cycles',
  // 046: 1日の目標枚数
  '@codeflash_study_goal_enabled',
  '@codeflash_study_goal_count',
  '@codeflash_study_goal_reached_behavior',
  // バッジ周回の段階開放（分母 50→80→110）の案内メッセージ既読段階
  '@codeflash_badge_lap_stage_seen',
  // 049: カード本文の読み上げ
  '@codeflash_speech_enabled',
  '@codeflash_speech_rate',
  // 050：文字体系ごとの読み上げ言語（JSON）。旧2キーは 049 の遺産で、
  // 新キーが無い端末でだけ移行元として読まれる（エクスポートには残しておく）。
  '@codeflash_speech_script_langs',
  // 050 Phase 3：言語ごとに選んだ声（identifier）。⚠️ identifier は端末固有なので、
  // 別端末へインポートしても存在しないものは filterKnownVoices が落とす（無音にならない）。
  '@codeflash_speech_voices',
  '@codeflash_speech_no_mixed_switch',
  // 052：自動読み上げの面（Pro。適用側が isPro で止めるので、非 Pro に復元されても効かない）
  '@codeflash_speech_auto',
  '@codeflash_speech_latin_lang',
  '@codeflash_speech_non_latin_lang',
] as const;

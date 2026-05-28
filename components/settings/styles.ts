import { StyleSheet } from 'react-native';

import { SHADOW } from '@/lib/theme';

/**
 * 設定画面（トップのナビ一覧＋各ドリルインのサブ画面）で共有するスタイル。
 * 旧 app/(tabs)/settings.tsx に直書きされていたものを切り出して再利用する。
 */
export const settingsStyles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  card: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    ...SHADOW.subtle,
  },
  sectionLabel: { fontWeight: '600' },

  // トップのナビ一覧 行
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  navRowTitle: { flex: 1, fontWeight: '600' },

  // Pro カード
  proCard: { paddingVertical: 16 },
  proRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  proTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proTitle: { fontWeight: '700' },
  proSubtitle: { lineHeight: 18 },
  proBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  proBadgeText: { color: '#fff', fontWeight: '700', letterSpacing: 1 },

  // セグメント切替
  segmented: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: 'center',
  },
  segmentText: {},
  segmentTextActive: { fontWeight: '700' },

  // データ管理などの行
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  dataRowText: { flex: 1, gap: 2 },
  dataRowTitle: { fontWeight: '600' },
  dataRowSubtitle: {},

  // トグル行（通知・キーボード・同期）
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  notificationLabel: { flex: 1 },

  // FSRS
  fsrsSubLabel: { fontWeight: '600' },
  fsrsRetentionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  fsrsRetentionValue: { fontWeight: '700' },
  fsrsRetentionScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  fsrsScaleText: {},
  fsrsHint: { lineHeight: 16, marginTop: 2 },

  // 同期
  syncStatusRow: { paddingVertical: 4 },
  syncAdvancedRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 4,
  },
  syncAdvancedBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.25)',
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
});

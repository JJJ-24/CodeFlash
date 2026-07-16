import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { MAX_FONT_MULTIPLIER, SHADOW, useTheme } from '@/lib/theme';

const PILL_DURATION_MS = 2500;

/**
 * アーカイブ切替の結果を中央ピルで数秒通知する。
 *
 * 一覧（ホーム/カード一覧/タグカード一覧）では「復習」「新規」「有効」フィルター中に
 * アーカイブすると activeCardCond でその行がリストから即座に消える。何が起きたか分からないと
 * 「カードが消えた」に見えるため、キー操作にはこの通知を必ず添える。
 */
export function useArchivePill() {
  const [archivePill, setArchivePill] = useState<null | boolean>(null); // true=アーカイブ / false=解除
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const showArchivePill = useCallback((archived: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setArchivePill(archived);
    timerRef.current = setTimeout(() => setArchivePill(null), PILL_DURATION_MS);
  }, []);

  return { archivePill, showArchivePill };
}

/**
 * `useArchivePill` の状態をそのまま渡す。null のあいだは何も描画しない。
 *
 * 配色はテーマの反転（背景 = text 色／前景 = background 色）。surface 背景にすると
 * 一覧のカードと同じ色になって埋もれるため使わない（実測。ライトテーマはどちらも白）。
 * 反転ならライト＝黒地に白、ダーク＝白地に黒となり、どちらでもカードから浮く。
 */
export function ArchivePill({ archived }: { archived: null | boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (archived === null) return null;

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <View style={[styles.pill, { backgroundColor: theme.colors.text }]}>
        <Ionicons name={archived ? 'archive' : 'arrow-undo-outline'} size={18} color={theme.colors.background} />
        <Text
          style={{ color: theme.colors.background, fontSize: theme.fontSize.sm, fontWeight: '600' }}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
        >
          {archived ? t('card.archivedPill') : t('card.unarchivedPill')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    // 反転配色でカードとのコントラストは足りているのでボーダーは不要。影は「浮いている」感を出す分だけ。
    ...SHADOW.card,
  },
});

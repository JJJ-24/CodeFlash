import { Ionicons } from '@expo/vector-icons';
import { View, type ViewStyle } from 'react-native';

import { resolveDeckIconColors } from '@/lib/deckIconColors';
import { useTheme } from '@/lib/theme';

/**
 * デッキの丸アイコン（色付き）。ホーム/学習タブのデッキ行と同じ見た目を、
 * デッキ選択モーダルやマージ復元画面でも使い回すための共通コンポーネント。
 * サイズは文字サイズ設定（fontScale）に連動する。余白は呼び出し側が `style` で付与する。
 */
export function DeckIcon({
  iconName,
  colorHex,
  style,
}: {
  iconName: string;
  colorHex: string | null;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const box = Math.round(32 * theme.fontScale);
  const glyph = Math.round(18 * theme.fontScale);
  const { color, bg } = resolveDeckIconColors(colorHex, theme);
  return (
    <View
      style={[
        { width: box, height: box, borderRadius: box / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg },
        style,
      ]}
    >
      <Ionicons name={iconName as any} size={glyph} color={color} />
    </View>
  );
}

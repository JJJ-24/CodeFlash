import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import { useTheme, TAG_PRESET_COLORS } from '@/lib/theme';
import { TAG_THEME_COLOR, TAG_MONO_COLOR, contrastText } from '@/lib/tagColors';

interface Props {
  color: string;
  onChange: (color: string) => void;
}

/**
 * タグの色ピッカー（作成・編集で共用）。デッキのカラーピッカーと同じ寸法・レイアウト：
 * - セル 36px、iPad は1行 / iPhone は2行（7色 / 残り5色＋追従＋白黒）
 * - 追従スウォッチ（sync）＝カードテーマの代表色に連動、白黒スウォッチ（contrast）＝ライト黒/ダーク白
 */
export function TagColorPicker({ color, onChange }: Props) {
  const theme = useTheme();
  const themeAccent = theme.colors.background;

  const colorSwatch = (c: string) => (
    <TouchableOpacity
      key={c}
      style={[styles.colorCell, { backgroundColor: c }, color === c && styles.colorCellSelected]}
      onPress={() => onChange(c)}
    >
      {color === c && <Ionicons name="checkmark-sharp" size={18} color="#FFF" />}
    </TouchableOpacity>
  );

  // テーマ追従（設定の配色色に連動）
  const themeSwatch = (
    <TouchableOpacity
      key="__theme__"
      style={[styles.colorCell, { backgroundColor: themeAccent, borderColor: theme.colors.inputBorder, borderWidth: 1 }, color === TAG_THEME_COLOR && styles.colorCellSelected]}
      onPress={() => onChange(TAG_THEME_COLOR)}
    >
      <Ionicons name={color === TAG_THEME_COLOR ? 'checkmark-sharp' : 'sync'} size={color === TAG_THEME_COLOR ? 18 : 22} color={contrastText(themeAccent)} />
    </TouchableOpacity>
  );

  // 白黒（ライト=黒 / ダーク=白）
  const monoSwatch = (
    <TouchableOpacity
      key="__mono__"
      style={[styles.colorCell, { backgroundColor: theme.colors.text, borderColor: theme.colors.inputBorder, borderWidth: 1 }, color === TAG_MONO_COLOR && styles.colorCellSelected]}
      onPress={() => onChange(TAG_MONO_COLOR)}
    >
      <Ionicons name={color === TAG_MONO_COLOR ? 'checkmark-sharp' : 'contrast'} size={color === TAG_MONO_COLOR ? 18 : 24} color={contrastText(theme.colors.text)} />
    </TouchableOpacity>
  );

  if ((Platform as any).isPad) {
    return (
      <View style={styles.colorGrid}>
        {TAG_PRESET_COLORS.map(colorSwatch)}
        {themeSwatch}
        {monoSwatch}
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.colorGrid}>{TAG_PRESET_COLORS.slice(0, 7).map(colorSwatch)}</View>
      <View style={styles.colorGrid}>{TAG_PRESET_COLORS.slice(7).map(colorSwatch)}{themeSwatch}{monoSwatch}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorCell: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  colorCellSelected: { borderWidth: 2, borderColor: '#FFF' },
});

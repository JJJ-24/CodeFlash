import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import { useTheme, TAG_PRESET_COLORS, PRIMARY_COLOR } from '@/lib/theme';
import { TAG_THEME_COLOR, TAG_MONO_COLOR, contrastText } from '@/lib/tagColors';

/**
 * 色を C／⇧C（`,`／`.`）で送るときの順番＝ピッカーの並びと同じ（青 → プリセット → テーマ追従 → 白黒）。
 * タグの新規・編集と、タグ管理の選択モードの一括色変更で共用する。
 */
export const TAG_COLOR_CYCLE: readonly string[] = [PRIMARY_COLOR, ...TAG_PRESET_COLORS, TAG_THEME_COLOR, TAG_MONO_COLOR];

/** 色を1つ前後へ送る。今の色が一覧に無い（未選択など）なら、順送りは先頭・逆送りは末尾から始める */
export function stepTagColor(current: string | null, dir: number): string {
  const n = TAG_COLOR_CYCLE.length;
  const i = current === null ? -1 : TAG_COLOR_CYCLE.indexOf(current);
  if (i === -1) return dir > 0 ? TAG_COLOR_CYCLE[0] : TAG_COLOR_CYCLE[n - 1];
  return TAG_COLOR_CYCLE[(i + dir + n) % n];
}

interface Props {
  /** 選ばれている色。null＝どれも選んでいない（一括色変更で、選んだタグの色がばらばらのとき） */
  color: string | null;
  onChange: (color: string) => void;
}

/**
 * タグの色ピッカー（作成・編集で共用）。デッキのカラーピッカーと同じ寸法・レイアウト：
 * - セル 34px、iPad は1行 / iPhone は2行（上段8色 / 下段7色）
 * - 先頭はプライマリー青（既定色）、追従スウォッチ（sync）＝画面背景色に連動、白黒（contrast）＝ライト黒/ダーク白
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

  // テーマ追従（画面背景色に連動）
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
        {[PRIMARY_COLOR, ...TAG_PRESET_COLORS].map(colorSwatch)}
        {themeSwatch}
        {monoSwatch}
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {/* 上段8色：青＋プリセット先頭7 */}
      <View style={styles.colorGrid}>{[PRIMARY_COLOR, ...TAG_PRESET_COLORS.slice(0, 7)].map(colorSwatch)}</View>
      {/* 下段7色：残りプリセット5＋追従＋白黒 */}
      <View style={styles.colorGrid}>{TAG_PRESET_COLORS.slice(7).map(colorSwatch)}{themeSwatch}{monoSwatch}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorCell: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  colorCellSelected: { borderWidth: 2, borderColor: '#FFF' },
});

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

interface Props {
  onSave: () => void;
  saveDisabled: boolean;
  /** 削除ボタン（ゴミ箱・danger）。編集画面のみ渡す。 */
  onDelete?: () => void;
  /** 複製ボタン（アウトライン）。カード編集のみ渡す。 */
  onDuplicate?: () => void;
  duplicateDisabled?: boolean;
  /** 水平パディング。デッキ/タグ＝20（既定）、カードエディタ＝16。 */
  horizontalPadding?: number;
}

/**
 * 入力系モーダル（デッキ/タグ/カードの新規・編集）共通の底部アクションバー。
 * 並び: 削除（danger・任意）→ 複製（アウトライン・任意）→ 保存（primary）。
 * ボタンはアイコンのみ（言語/フォントサイズ非依存＝CLAUDE.md の方針）。
 */
export function FormBottomBar({ onSave, saveDisabled, onDelete, onDuplicate, duplicateDisabled, horizontalPadding = 20 }: Props) {
  const theme = useTheme();
  const { bottom: bottomInset } = useSafeAreaInsets();
  return (
    <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingHorizontal: horizontalPadding, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
      {onDelete && (
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.danger }]} onPress={onDelete}>
          <Ionicons name="trash-outline" size={26} color="#FFF" />
        </TouchableOpacity>
      )}
      {onDuplicate && (
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnOutline, { borderColor: theme.colors.primary }, duplicateDisabled && styles.actionBtnDisabled]}
          onPress={onDuplicate}
          disabled={duplicateDisabled}
        >
          <Ionicons name="copy-outline" size={26} color={duplicateDisabled ? theme.colors.textTertiary : theme.colors.primary} />
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, saveDisabled && styles.actionBtnDisabled]}
        onPress={onSave}
        disabled={saveDisabled}
      >
        <Ionicons name="checkmark-sharp" size={26} color="#FFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionBtnOutline: { borderWidth: 1.5 },
  actionBtnDisabled: { opacity: 0.5 },
});

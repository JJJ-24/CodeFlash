import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { StyleProp, ViewStyle } from 'react-native';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

interface Props {
  children: React.ReactNode;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
  collapsed?: boolean;
  style?: StyleProp<ViewStyle>;
  isEmpty?: boolean;
  onHeaderPress?: () => void;
  hideDelete?: boolean;
}

export function BlockItemHeader({ children, onMoveUp, onMoveDown, onDelete, collapsed, style, isEmpty, onHeaderPress, hideDelete }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isSortMode = onMoveUp !== undefined || onMoveDown !== undefined;
  const [confirmVisible, setConfirmVisible] = useState(false);

  function confirmDelete() {
    if (isEmpty) {
      onDelete();
      return;
    }
    setConfirmVisible(true);
  }

  return (
    <View style={[styles.header, style]}>
      {onHeaderPress ? (
        <Pressable style={styles.contentArea} onPress={onHeaderPress}>{children}</Pressable>
      ) : (
        <View style={styles.contentArea}>{children}</View>
      )}
      {isSortMode ? (
        <View style={styles.moveButtons}>
          <Pressable onPress={onMoveUp} disabled={!onMoveUp} hitSlop={8} style={styles.moveBtn}>
            <Ionicons name="chevron-up" size={22} color={onMoveUp ? theme.colors.textSecondary : theme.colors.textTertiary} />
          </Pressable>
          <Pressable onPress={onMoveDown} disabled={!onMoveDown} hitSlop={8} style={styles.moveBtn}>
            <Ionicons name="chevron-down" size={22} color={onMoveDown ? theme.colors.textSecondary : theme.colors.textTertiary} />
          </Pressable>
        </View>
      ) : (
        !collapsed && !hideDelete && (
          <Pressable onPress={confirmDelete} hitSlop={8} style={styles.deleteBtn}>
            <Text style={[styles.deleteBtnText, { color: theme.colors.iconSubtle, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>✕</Text>
          </Pressable>
        )
      )}
      <ConfirmDeleteModal
        visible={confirmVisible}
        message={t('editor.deleteBlockConfirm')}
        onConfirm={() => {
          setConfirmVisible(false);
          onDelete();
        }}
        onClose={() => setConfirmVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  contentArea: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  moveButtons: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  moveBtn: { padding: 4 },
  deleteBtn: { padding: 6 },
  deleteBtnText: {},
});

import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

interface Props {
  children: React.ReactNode;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
  collapsed?: boolean;
  style?: StyleProp<ViewStyle>;
  isEmpty?: boolean;
  isLast?: boolean;
}

export function BlockItemHeader({ children, onMoveUp, onMoveDown, onDelete, collapsed, style, isEmpty, isLast }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isSortMode = onMoveUp !== undefined || onMoveDown !== undefined;

  function confirmDelete() {
    if (isLast) {
      Alert.alert(t('card.deleteBlock'), t('card.deleteBlockRequired'), [
        { text: t('common.ok') },
      ]);
      return;
    }
    if (isEmpty) {
      onDelete();
      return;
    }
    Alert.alert(t('card.deleteBlock'), t('card.deleteBlockConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: onDelete },
    ]);
  }

  return (
    <View style={[styles.header, style]}>
      <View style={styles.contentArea}>{children}</View>
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
        !collapsed && (
          <Pressable onPress={confirmDelete} hitSlop={8} style={styles.deleteBtn}>
            <Text style={[styles.deleteBtnText, { color: theme.colors.iconSubtle }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>✕</Text>
          </Pressable>
        )
      )}
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
  deleteBtnText: { fontSize: 18 },
});

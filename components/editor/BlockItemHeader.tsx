import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme';

interface Props {
  children: React.ReactNode;
  onDragStart?: () => void;
  onDelete: () => void;
  collapsed?: boolean;
  style?: StyleProp<ViewStyle>;
  isEmpty?: boolean;
  isLast?: boolean;
}

export function BlockItemHeader({ children, onDragStart, onDelete, collapsed, style, isEmpty, isLast }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

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
      {onDragStart ? (
        <Pressable style={styles.dragArea} onLongPress={onDragStart} delayLongPress={500}>
          {children}
        </Pressable>
      ) : (
        <View style={styles.dragArea}>{children}</View>
      )}
      {!collapsed && (
        <Pressable onPress={confirmDelete} hitSlop={8} style={styles.deleteBtn}>
          <Text style={[styles.deleteBtnText, { color: theme.colors.iconSubtle, fontSize: theme.fontSize.lg }]}>✕</Text>
        </Pressable>
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
  dragArea: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  deleteBtn: { padding: 6 },
  deleteBtnText: {},
});

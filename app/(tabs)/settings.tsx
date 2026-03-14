import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Pressable
        style={[styles.row, { backgroundColor: theme.colors.surface }]}
        onPress={() => router.push('/tags')}
      >
        <Ionicons name="pricetags-outline" size={22} color={theme.colors.primary} />
        <Text style={[styles.rowText, { color: theme.colors.text }]}>{t('tag.title')}</Text>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.iconSubtle} style={styles.chevron} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  rowText: { flex: 1, fontSize: 16 },
  chevron: { marginLeft: 'auto' },
});

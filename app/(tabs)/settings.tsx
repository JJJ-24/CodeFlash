import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.row}
        onPress={() => router.push('/tags')}
      >
        <Ionicons name="pricetags-outline" size={22} color="#1976D2" />
        <Text style={styles.rowText}>{t('tag.title')}</Text>
        <Ionicons name="chevron-forward" size={18} color="#BDBDBD" style={styles.chevron} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
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
  rowText: { flex: 1, fontSize: 16, color: '#212121' },
  chevron: { marginLeft: 'auto' },
});

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

interface Props {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
}

export function EmptyState({ icon, title, subtitle }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={64} color={theme.colors.iconSubtle} />
      <Text style={[styles.title, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
        {title}
      </Text>
      {subtitle && (
        <Text style={[styles.subtitle, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  title: { fontWeight: '600' },
  subtitle: {},
});

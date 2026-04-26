import { useLayoutEffect } from 'react';
import { Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import { useTheme } from '@/lib/theme';

export function useShortcutsHeader(enabled: boolean, onPress: () => void) {
  const navigation = useNavigation();
  const theme = useTheme();

  useLayoutEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigation as any).setOptions({
      headerRight: enabled ? () => (
        <Pressable onPress={onPress} style={{ paddingHorizontal: 8 }}>
          <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
        </Pressable>
      ) : undefined,
      headerRightContainerStyle: enabled ? { paddingRight: 8 } : undefined,
    });
  }, [enabled, theme, onPress, navigation]);
}

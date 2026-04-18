import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import type { LinkItem } from '@/lib/study/extractLinks';

interface Props {
  visible: boolean;
  onClose: () => void;
  links: LinkItem[];
}

export function LinksSheet({ visible, onClose, links }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const sheetY = useSharedValue(500);
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      overlayOpacity.value = withTiming(1, { duration: 200 });
      sheetY.value = withTiming(0, { duration: 250 });
    } else {
      overlayOpacity.value = withTiming(0, { duration: 200 });
      sheetY.value = withTiming(500, { duration: 250 });
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, overlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[sheetStyle, styles.sheet, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('study.linksTitle')}
          </Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
          </Pressable>
        </View>
        <FlatList
          data={links}
          keyExtractor={(item) => item.url}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.linkRow, { borderBottomColor: theme.colors.inputBorder }]}
              onPress={() => { onClose(); Linking.openURL(item.url); }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.linkText, { color: theme.colors.text, fontSize: theme.fontSize.md }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {item.text}
                </Text>
                {item.text !== item.url && (
                  <Text style={[styles.linkUrl, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {item.url}
                  </Text>
                )}
              </View>
              <Ionicons name="open-outline" size={18} color={theme.colors.primary} />
            </Pressable>
          )}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
    maxHeight: '60%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  title: { fontWeight: '700' },
  closeBtn: { padding: 4 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkText: { fontWeight: '500' },
  linkUrl: { marginTop: 2 },
});

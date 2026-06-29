import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useKeyCommands } from '@/lib/useKeyCommands';
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

  // キーボード操作（034）：J/K（iPhoneは↑/↓）でフォーカス、Return/Space でリンク先へ。
  const [focusedIndex, setFocusedIndex] = useState(0);
  const listRef = useRef<FlatList>(null);
  useEffect(() => { if (visible) setFocusedIndex(0); }, [visible]);

  function move(dir: number) {
    setFocusedIndex((p) => {
      const n = links.length;
      if (n === 0) return p;
      const next = (p + dir + n) % n;
      setTimeout(() => listRef.current?.scrollToIndex({ index: next, viewPosition: 0.5, animated: true }), 0);
      return next;
    });
  }
  function openFocused() {
    const l = links[focusedIndex];
    if (l) { onClose(); Linking.openURL(l.url); }
  }
  // 親（学習画面）のキーは表示中に active ゲートで解除済み。Esc は学習画面側が閉じる。
  // W は開閉トグル：開くのは学習画面の W、閉じるのは表示中のここが担う（親キーは解除されているため）。
  useKeyCommands([
    { input: 'j', handler: () => { if (visible) move(1); } },
    { input: 'k', handler: () => { if (visible) move(-1); } },
    { input: ' ', handler: () => { if (visible) openFocused(); } },
    { input: 'w', handler: () => { if (visible) onClose(); } },
    { input: KeyCommand.keyInputEnter, handler: () => { if (visible) openFocused(); } },
    ...(((Platform as any).isPad ? [] : [
      { input: KeyCommand.keyInputDownArrow, handler: () => { if (visible) move(1); } },
      { input: KeyCommand.keyInputUpArrow, handler: () => { if (visible) move(-1); } },
    ]) as { input: string; handler: () => void }[]),
  ], visible);

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, overlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[sheetStyle, styles.sheet, { backgroundColor: theme.baseSurface }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('study.linksTitle')}
          </Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
          </Pressable>
        </View>
        <FlatList
          ref={listRef}
          data={links}
          keyExtractor={(item) => item.url}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item, index }) => (
            <Pressable
              style={[styles.linkRow, { borderBottomColor: theme.colors.inputBorder }, focusedIndex === index && { backgroundColor: theme.colors.primaryLight }]}
              onPress={() => { setFocusedIndex(index); onClose(); Linking.openURL(item.url); }}
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

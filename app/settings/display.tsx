import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { SegmentedCard } from '@/components/settings/SegmentedCard';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles as styles } from '@/components/settings/styles';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { CARD_THEME_NAMES, CARD_THEMES, type CardThemeName } from '@/lib/theme/cardThemes';
import { useSettingsStore, type InitialFilterPreference } from '@/store/settings';
import { useThemeStore, type ColorSchemePreference, type FontSizePreference } from '@/store/theme';
import { useProStore } from '@/store/pro';

export default function DisplaySettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const { preference, setPreference, fontSizePreference, setFontSizePreference } = useThemeStore();
  const {
    initialFilterPreference, setInitialFilterPreference,
    keyboardShortcutsEnabled, setKeyboardShortcutsEnabled,
    cardThemePreference, setCardThemePreference,
  } = useSettingsStore();
  const { isPro } = useProStore();

  function handleCardThemeSelect(name: CardThemeName) {
    // 'default' は常に無料。それ以外は Pro 限定。
    if (name !== 'default' && !isPro) {
      router.push('/paywall');
      return;
    }
    setCardThemePreference(name);
  }

  const palette = CARD_THEMES[theme.dark ? 'dark' : 'light'];

  // 選択中テーマがスクロール領域の右半分にある場合、初期表示でその近くまで自動スクロール。
  // useState の init 関数でマウント時の値だけを使うことで、後続のタップ→再レンダリングでも
  // contentOffset の参照が変わらず、iOS の ScrollView がスクロール位置をリセットしない。
  const swatchScrollRef = useRef<ScrollView>(null);
  const [initialContentOffset] = useState(() => {
    const SWATCH_ITEM_TOTAL_WIDTH = 104 + 8; // width + gap
    const idx = CARD_THEME_NAMES.indexOf(cardThemePreference);
    const x = idx >= 3 ? (idx - 2) * SWATCH_ITEM_TOTAL_WIDTH : 0;
    return { x, y: 0 };
  });
  useEffect(() => {
    // Android フォールバック（iOS は contentOffset で位置済み）
    if (initialContentOffset.x > 0) {
      swatchScrollRef.current?.scrollTo({ ...initialContentOffset, animated: false });
    }
    // 初回マウントのみ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SettingsDetail title={t('settings.display')}>
      <SegmentedCard
        label={t('settings.theme')}
        options={[
          { value: 'light' as ColorSchemePreference, label: t('settings.themeLight') },
          { value: 'dark' as ColorSchemePreference, label: t('settings.themeDark') },
          { value: 'system' as ColorSchemePreference, label: t('settings.themeSystem') },
        ]}
        value={preference}
        onChange={setPreference}
      />

      <SegmentedCard
        label={t('settings.fontSize')}
        options={[
          { value: 'small' as FontSizePreference, label: t('settings.fontSizeSmall') },
          { value: 'medium' as FontSizePreference, label: t('settings.fontSizeMedium') },
          { value: 'large' as FontSizePreference, label: t('settings.fontSizeLarge') },
        ]}
        value={fontSizePreference}
        onChange={setFontSizePreference}
      />

      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.cardTheme')}
          </Text>
          {!isPro && (
            <View style={[cardThemeStyles.proBadge, { backgroundColor: theme.colors.primary }]}>
              <Text style={{ color: '#FFF', fontSize: theme.fontSize.xs, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('pro.badge')}
              </Text>
            </View>
          )}
        </View>
        <ScrollView
          ref={swatchScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={cardThemeStyles.swatchRow}
          contentOffset={initialContentOffset}
        >
          {CARD_THEME_NAMES.map((name) => {
            const p = palette[name];
            const isSelected = cardThemePreference === name;
            const isLocked = name !== 'default' && !isPro;
            return (
              <Pressable
                key={name}
                onPress={() => handleCardThemeSelect(name)}
                style={cardThemeStyles.swatchItem}
              >
                <View
                  style={[
                    cardThemeStyles.swatch,
                    { backgroundColor: p.background, borderColor: isSelected ? theme.colors.primary : p.border },
                    isSelected && cardThemeStyles.swatchSelected,
                  ]}
                >
                  {/* 内側にメモ背景プレビューを小さく描いてテーマ感を出す */}
                  <View style={[cardThemeStyles.swatchMemoStripe, { backgroundColor: p.memoBackground }]} />
                  {isSelected && (
                    <View style={[cardThemeStyles.swatchCheck, { backgroundColor: theme.colors.primary }]}>
                      <Ionicons name="checkmark-sharp" size={16} color="#FFF" />
                    </View>
                  )}
                  {isLocked && (
                    <View style={cardThemeStyles.swatchLock}>
                      <Ionicons name="lock-closed" size={14} color={theme.colors.primary} />
                    </View>
                  )}
                </View>
                <Text
                  style={{
                    color: isSelected ? theme.colors.primary : theme.colors.text,
                    fontSize: theme.fontSize.sm,
                    fontWeight: isSelected ? '700' : '500',
                    marginTop: 6,
                    textAlign: 'center',
                  }}
                  maxFontSizeMultiplier={theme.fontSize.md / theme.fontSize.sm}
                  numberOfLines={1}
                >
                  {t(`settings.cardThemeName.${name}`)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <SegmentedCard
        label={t('settings.initialFilter')}
        info={t('settings.initialFilterInfo')}
        options={[
          { value: 'all' as InitialFilterPreference, label: t('common.all') },
          { value: 'review' as InitialFilterPreference, label: t('common.due') },
          { value: 'none' as InitialFilterPreference, label: t('settings.initialFilterNone') },
        ]}
        value={initialFilterPreference}
        onChange={setInitialFilterPreference}
      />

      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {t('settings.keyboard')}
        </Text>
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.keyboardEnabled')}
          </Text>
          <Switch
            value={keyboardShortcutsEnabled}
            onValueChange={setKeyboardShortcutsEnabled}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>
      </View>
    </SettingsDetail>
  );
}

const cardThemeStyles = StyleSheet.create({
  proBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  swatchRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 10,
    paddingHorizontal: 2,
    paddingBottom: 4,
  },
  swatchItem: {
    width: 104,
    alignItems: 'center',
  },
  swatch: {
    width: '100%',
    height: 76,
    borderRadius: 10,
    borderWidth: 1.5,
    overflow: 'hidden',
    position: 'relative',
  },
  swatchSelected: {
    borderWidth: 3,
  },
  swatchMemoStripe: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '35%',
  },
  swatchCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLock: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

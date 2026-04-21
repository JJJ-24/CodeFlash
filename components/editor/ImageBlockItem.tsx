import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BlockItemHeader } from './BlockItemHeader';
import { pickAndSaveImage, resolveImageUri } from '@/lib/image';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import type { ImageBlock } from '@/types';

interface Props {
  block: ImageBlock;
  onChange: (patch: Partial<ImageBlock>) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  collapsed?: boolean;
  flashTrigger?: number;
  isLast?: boolean;
  onFocusInput?: () => void;
  onEditBlur?: () => void;
  autoFocus?: boolean;
  isFocused?: boolean;
}

export function ImageBlockItem({ block, onChange, onDelete, onMoveUp, onMoveDown, collapsed, flashTrigger = 0, isLast, onFocusInput, onEditBlur, autoFocus, isFocused }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [picking, setPicking] = useState(false);
  const [focused, setFocused] = useState(false);
  const prevCollapsedRef = useRef(collapsed);
  const altInputRef = useRef<TextInput>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!collapsed && prevCollapsedRef.current) {
      setFocused(false);
    }
    prevCollapsedRef.current = collapsed;
  }, [collapsed]);

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => altInputRef.current?.focus(), 50);
    }
  }, []);

  useEffect(() => {
    if (flashTrigger > 0) {
      flashAnim.setValue(1);
      Animated.timing(flashAnim, { toValue: 0, duration: 600, useNativeDriver: true }).start();
    }
  }, [flashTrigger]);

  async function handlePick() {
    setPicking(true);
    try {
      const uri = await pickAndSaveImage();
      if (uri) {
        onChange({ uri });
        setTimeout(() => altInputRef.current?.focus(), 100);
      }
    } finally {
      setPicking(false);
    }
  }

  const hasImage = !!block.uri;
  const imageUri = hasImage ? resolveImageUri(block.uri) : null;
  const isEmpty = !block.uri;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: flashTrigger > 0 ? theme.colors.primary : ((focused || isFocused) ? theme.colors.primary : theme.colors.inputBorder) }]}>
      <BlockItemHeader
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDelete={onDelete}
        collapsed={collapsed}
        isEmpty={isEmpty}
        isLast={isLast}
        style={{
          backgroundColor: focused ? '#4A3400' : isFocused ? '#1A3050' : (theme.dark ? '#252525' : '#FAFAFA'),
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Ionicons name="image-outline" size={theme.fontSize.xxl} color={theme.colors.textTertiary} />
      </BlockItemHeader>

      {collapsed ? (
        <Text style={[styles.collapsedPreview, { color: theme.colors.textTertiary }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {hasImage ? `📷 ${t('card.imageBlock')}` : t('card.imageNoSelection')}
        </Text>
      ) : (
        <>
          {/* 画像エリア */}
          {hasImage && imageUri ? (
            <View style={styles.imageArea}>
              <Image
                source={{ uri: imageUri }}
                style={styles.image}
                contentFit="contain"
                transition={200}
                accessibilityLabel={block.alt || undefined}
              />
              <Pressable
                style={[styles.changeBtn, { backgroundColor: theme.colors.primaryLight }]}
                onPress={handlePick}
                disabled={picking}
              >
                {picking ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Text style={[styles.changeBtnText, { color: theme.colors.primary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                    {t('card.imageChange')}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[styles.pickBtn, { borderColor: theme.colors.iconSubtle, backgroundColor: theme.colors.background }]}
              onPress={handlePick}
              disabled={picking}
            >
              {picking ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : (
                <>
                  <Text style={[styles.pickBtnIcon, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xxl }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>📷</Text>
                  <Text style={[styles.pickBtnText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                    {t('card.imageSelect')}
                  </Text>
                </>
              )}
            </Pressable>
          )}

          {/* 画像の説明 */}
          <TextInput
            ref={altInputRef}
            style={[styles.altInput, { color: theme.colors.text, borderColor: theme.colors.inputBorder, fontSize: theme.fontSize.sm }]}
            value={block.alt}
            onChangeText={(alt) => onChange({ alt })}
            placeholder={t('card.imageAltPlaceholder')}
            placeholderTextColor={theme.colors.textTertiary}
            onFocus={() => { setFocused(true); onFocusInput?.(); }}
            onBlur={() => { setFocused(false); onEditBlur?.(); }}
            autoCorrect={false}
            spellCheck={false}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}
          />
        </>
      )}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: flashAnim, backgroundColor: theme.colors.primaryLight, borderRadius: 10 }]}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageArea: {
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 6,
  },
  changeBtn: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 6,
  },
  changeBtnText: { fontWeight: '600' },
  pickBtn: {
    marginHorizontal: 12,
    marginTop: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
  },
  altInput: {
    margin: 12,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  collapsedPreview: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    lineHeight: 20,
  },
});

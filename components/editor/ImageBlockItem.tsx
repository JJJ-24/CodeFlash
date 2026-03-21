import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BlockItemHeader } from './BlockItemHeader';
import { pickAndSaveImage, resolveImageUri } from '@/lib/image';
import { useTheme } from '@/lib/theme';
import type { ImageBlock } from '@/types';

interface Props {
  block: ImageBlock;
  onChange: (patch: Partial<ImageBlock>) => void;
  onDelete: () => void;
  onDragStart?: () => void;
  collapsed?: boolean;
  isLast?: boolean;
}

export function ImageBlockItem({ block, onChange, onDelete, onDragStart, collapsed, isLast }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [picking, setPicking] = useState(false);
  const [focused, setFocused] = useState(false);
  const prevCollapsedRef = useRef(collapsed);

  useEffect(() => {
    if (!collapsed && prevCollapsedRef.current) {
      setFocused(false);
    }
    prevCollapsedRef.current = collapsed;
  }, [collapsed]);

  async function handlePick() {
    setPicking(true);
    try {
      const uri = await pickAndSaveImage();
      if (uri) onChange({ uri });
    } finally {
      setPicking(false);
    }
  }

  const hasImage = !!block.uri;
  const imageUri = hasImage ? resolveImageUri(block.uri) : null;
  const isEmpty = !block.uri;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: focused ? theme.colors.primary : theme.colors.inputBorder }]}>
      <BlockItemHeader
        onDragStart={onDragStart}
        onDelete={onDelete}
        collapsed={collapsed}
        isEmpty={isEmpty}
        isLast={isLast}
        style={{
          backgroundColor: theme.dark ? '#252525' : '#FAFAFA',
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Ionicons name="image-outline" size={14} color={theme.colors.textTertiary} style={styles.typeLabel} />
      </BlockItemHeader>

      {collapsed ? (
        <Text style={[styles.collapsedPreview, { color: theme.colors.textTertiary }]}>
          {hasImage ? '📷 画像' : '（画像未選択）'}
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
                  <Text style={[styles.changeBtnText, { color: theme.colors.primary }]}>
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
                  <Text style={[styles.pickBtnIcon, { color: theme.colors.textTertiary }]}>📷</Text>
                  <Text style={[styles.pickBtnText, { color: theme.colors.textTertiary }]}>
                    {t('card.imageSelect')}
                  </Text>
                </>
              )}
            </Pressable>
          )}

          {/* alt テキスト */}
          <TextInput
            style={[styles.altInput, { color: theme.colors.text, borderColor: theme.colors.inputBorder }]}
            value={block.alt}
            onChangeText={(alt) => onChange({ alt })}
            placeholder={t('card.imageAltPlaceholder')}
            placeholderTextColor={theme.colors.textTertiary}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  typeLabel: { fontSize: 12, fontWeight: '700' },
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
  changeBtnText: { fontSize: 13, fontWeight: '600' },
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
  pickBtnIcon: { fontSize: 28 },
  pickBtnText: { fontSize: 14 },
  altInput: {
    margin: 12,
    marginTop: 8,
    fontSize: 13,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  collapsedPreview: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 20,
  },
});

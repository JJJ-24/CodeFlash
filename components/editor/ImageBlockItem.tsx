import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { pickAndSaveImage, resolveImageUri } from '@/lib/image';
import { useTheme } from '@/lib/theme';
import type { ImageBlock } from '@/types';

interface Props {
  block: ImageBlock;
  onChange: (patch: Partial<ImageBlock>) => void;
  onDelete: () => void;
}

export function ImageBlockItem({ block, onChange, onDelete }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [picking, setPicking] = useState(false);

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

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }]}>
      {/* ヘッダー */}
      <View style={[styles.header, { backgroundColor: theme.dark ? '#252525' : '#FAFAFA', borderBottomColor: theme.colors.border }]}>
        <Ionicons name="image-outline" size={14} color={theme.colors.textTertiary} style={styles.typeLabel} />
        <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteBtnWrapper}>
          <Text style={[styles.deleteBtnText, { color: theme.colors.iconSubtle }]}>✕</Text>
        </Pressable>
      </View>

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    gap: 8,
  },
  typeLabel: { fontSize: 12, fontWeight: '700', flex: 1 },
  deleteBtnWrapper: { padding: 2 },
  deleteBtnText: { fontSize: 12 },
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
});

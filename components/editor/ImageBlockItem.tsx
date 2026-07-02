import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BlockItemHeader } from './BlockItemHeader';
import { InfoModal } from '@/components/InfoModal';
import { pickAndSaveImage, resolveImageUri, imageMaxWidth, DEFAULT_IMAGE_SIZE, type ImageSizeKey } from '@/lib/image';
import { useTheme, MAX_FONT_MULTIPLIER, CODE_STATE_HEADERS } from '@/lib/theme';
import type { ImageBlock } from '@/types';

interface Props {
  block: ImageBlock;
  onChange: (patch: Partial<ImageBlock>) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  collapsed?: boolean;
  flashTrigger?: number;
  onFocusInput?: () => void;
  onEditBlur?: () => void;
  autoFocus?: boolean;
  isFocused?: boolean;
  onAutoFocused?: () => void;
  blurTrigger?: number;
  isPreview?: boolean;
}

export function ImageBlockItem({ block, onChange, onDelete, onMoveUp, onMoveDown, collapsed, flashTrigger = 0, onFocusInput, onEditBlur, autoFocus, isFocused, onAutoFocused, blurTrigger, isPreview }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  const isPad = (Platform as any).isPad;
  const [picking, setPicking] = useState(false);
  const [focused, setFocused] = useState(false);
  const [sizeErrorVisible, setSizeErrorVisible] = useState(false);
  // 画像の実寸アスペクト比（幅/高さ）と利用可能幅（onLayout）。両方そろったら幅・高さを具体値で
  // 確定する（aspectRatio + maxWidth のクランプずれで画像下に余白が出るのを避けるため）。
  const [ratio, setRatio] = useState<number | null>(null);
  const [availWidth, setAvailWidth] = useState(0);
  const prevCollapsedRef = useRef(collapsed);
  const altInputRef = useRef<TextInput>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (collapsed) {
      setFocused(false);
      altInputRef.current?.blur();
    } else if (prevCollapsedRef.current === true) {
      setFocused(false);
    }
    prevCollapsedRef.current = collapsed;
  }, [collapsed]);

  useEffect(() => {
    if ((blurTrigger ?? 0) > 0) { altInputRef.current?.blur(); }
  }, [blurTrigger]);

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => altInputRef.current?.focus(), 50);
      onAutoFocused?.();
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
      const result = await pickAndSaveImage();
      if (!result) return;
      if ('error' in result) {
        setSizeErrorVisible(true);
        return;
      }
      onChange({ uri: result.uri });
      setTimeout(() => altInputRef.current?.focus(), 100);
    } finally {
      setPicking(false);
    }
  }

  const hasImage = !!block.uri;
  const imageUri = hasImage ? resolveImageUri(block.uri) : null;
  const isEmpty = !block.uri;

  // 画像の表示サイズ（学習画面と同じ最大幅クランプ）。測定・読込前は仮の高さ 200。
  let imgBoxStyle: { width: number | `${number}%`; height: number };
  if (ratio && availWidth) {
    let w = Math.min(imageMaxWidth(block.size), availWidth);
    let h = w / ratio;
    const maxH = Dimensions.get('window').height * 0.7;
    if (h > maxH) { h = maxH; w = h * ratio; }
    imgBoxStyle = { width: w, height: h };
  } else {
    imgBoxStyle = { width: '100%', height: 200 };
  }

  return (
    <View style={[
      styles.container,
      isPreview
        ? { backgroundColor: 'transparent', borderWidth: 0 }
        : { backgroundColor: theme.colors.surface, borderColor: flashTrigger > 0 ? theme.colors.primary : focused ? '#FB8C00' : isFocused ? theme.colors.primary : theme.colors.inputBorder, borderWidth: (focused || isFocused) ? 2 : 1 },
    ]}>
      {!isPreview && (
        <BlockItemHeader
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDelete={onDelete}
          collapsed={collapsed}
          isEmpty={isEmpty}
          onHeaderPress={focused ? () => { altInputRef.current?.blur(); } : undefined}
          hideDelete={isPreview}
          style={{
            backgroundColor: focused ? CODE_STATE_HEADERS[theme.dark ? 'dark' : 'light'].editing : isFocused ? CODE_STATE_HEADERS[theme.dark ? 'dark' : 'light'].focus : (theme.dark ? '#252525' : '#FAFAFA'),
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Ionicons name="image-outline" size={theme.fontSize.xxl} color={theme.colors.textTertiary} />
        </BlockItemHeader>
      )}

      {collapsed ? (
        <Text style={[styles.collapsedPreview, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {hasImage ? `📷 ${t('card.imageBlock')}` : t('editor.imageNoSelection')}
        </Text>
      ) : (
        <>
          {/* 画像エリア */}
          {hasImage && imageUri ? (
            <View
              style={[styles.imageArea, isPreview && { paddingHorizontal: 0, paddingTop: 0 }]}
              onLayout={(e) => setAvailWidth(e.nativeEvent.layout.width - (isPreview ? 0 : 24))}
            >
              <Image
                source={{ uri: imageUri }}
                style={[styles.image, imgBoxStyle]}
                contentFit="contain"
                transition={200}
                accessibilityLabel={block.alt || undefined}
                onLoad={(e) => {
                  const w = e.source?.width;
                  const h = e.source?.height;
                  if (w && h) setRatio(w / h);
                }}
              />
              {!isPreview && (
                <View style={styles.controlsRow}>
                  {/* サイズ切替（学習画面での最大幅プリセット S/M/L）。既定は M。 */}
                  <View style={[styles.sizeGroup, { borderColor: theme.colors.inputBorder }]}>
                    {(['S', 'M', 'L'] as ImageSizeKey[]).map((s) => {
                      const active = (block.size ?? DEFAULT_IMAGE_SIZE) === s;
                      return (
                        <Pressable
                          key={s}
                          onPress={() => onChange({ size: s })}
                          style={[styles.sizeBtn, { paddingHorizontal: isPad ? 24 : 16, minWidth: isPad ? 74 : 50 }, active && { backgroundColor: theme.colors.primary }]}
                          hitSlop={4}
                        >
                          <Text style={{ color: active ? '#FFF' : theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                            {t(`editor.imageSize${s}`)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable
                    style={[styles.changeBtn, { paddingHorizontal: isPad ? 44 : 20, backgroundColor: theme.colors.primaryLight }]}
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
              )}
            </View>
          ) : isPreview ? (
            <View style={[styles.imagePlaceholder, { backgroundColor: theme.colors.border }]}>
              <Text style={[styles.imagePlaceholderText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xxl }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>🖼</Text>
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
          {isPreview ? (
            !!block.alt && (
              <Text style={[styles.altText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                {block.alt}
              </Text>
            )
          ) : (
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
          )}
        </>
      )}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: flashAnim, backgroundColor: theme.colors.primaryLight, borderRadius: 10 }]}
        pointerEvents="none"
      />
      <InfoModal
        visible={sizeErrorVisible}
        title={t('card.imageSizeErrorTitle')}
        message={t('card.imageSizeError')}
        onClose={() => setSizeErrorVisible(false)}
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
    alignSelf: 'center',
    borderRadius: 6,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  sizeGroup: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  sizeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    minWidth: 40,
    alignItems: 'center',
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
  pickBtnIcon: { textAlign: 'center' },
  pickBtnText: { textAlign: 'center' },
  altInput: {
    margin: 12,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  altText: {
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 6,
  },
  imagePlaceholder: {
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
  },
  imagePlaceholderText: {},
  collapsedPreview: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    lineHeight: 20,
  },
});

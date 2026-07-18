import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { truncateTag } from '@/components/editor/TagSelector';
import { isRemoteKeyboardEvent } from '@/lib/keyboardEvent';
import { resolveTagColor, contrastText } from '@/lib/tagColors';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useTheme, MAX_FONT_MULTIPLIER, themedFrameBorder } from '@/lib/theme';
import type { Tag } from '@/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 全タグ（タグ管理の並び順） */
  tags: Tag[];
  /** 現在のカードに付いているタグID */
  selectedIds: string[];
  /** タグの付け外し（即保存）。シートは開いたまま複数操作できる */
  onToggle: (tagId: string) => void;
  /** インライン新規作成（既定色で作成→現在カードに付与）。重複名は 'duplicate' を返す */
  onCreateTag: (name: string) => Promise<'ok' | 'duplicate'>;
}

/**
 * 学習画面（裏面）用のタグ付けボトムシート。LinksSheet と同じインライン overlay 構造。
 * チップは編集画面の TagSelector と同スタイル（選択=背景色塗り / 未選択=ドット＋枠線＋減光）に
 * 揃え、「編集画面のタグ欄と同じ付け外し操作」であることを見た目で伝える。
 * 末尾の「＋新規タグ」チップからインライン作成できる（DeckPickerModal と同じ流儀）。
 */
export function TagSheet({ visible, onClose, tags, selectedIds, onToggle, onCreateTag }: Props) {
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

  // インライン新規作成の状態
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [dupError, setDupError] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // ソフトキーボードで入力欄が隠れないようシートを持ち上げる（リモートキーボードは無視・共通ルール）
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      if (isRemoteKeyboardEvent(e)) return;
      setKbHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardWillHide', (e) => {
      if (isRemoteKeyboardEvent(e)) return;
      setKbHeight(0);
    });
    return () => { show.remove(); hide.remove(); };
  }, []);

  // キーボード操作（034）：J/K・H/L・,/.（iPhoneは矢印も）でフォーカス、Space で付け外し、Return で閉じる。
  // チップは折り返し配置のため配列順（タグ管理の並び順）で直線的に送る。末尾の「＋新規タグ」も対象。
  const [focusedIndex, setFocusedIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const chipYs = useRef<number[]>([]);
  useEffect(() => {
    if (visible) { setFocusedIndex(0); setCreating(false); setNewName(''); setDupError(false); }
  }, [visible]);

  const itemCount = tags.length + 1; // ＋新規タグ チップを含む

  function move(dir: number) {
    setFocusedIndex((p) => {
      const next = (p + dir + itemCount) % itemCount;
      const y = chipYs.current[next];
      if (y != null) {
        setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true }), 0);
      }
      return next;
    });
  }

  function startCreate() {
    setCreating(true);
    setNewName('');
    setDupError(false);
  }
  function cancelCreate() {
    setCreating(false);
    setNewName('');
    setDupError(false);
    Keyboard.dismiss();
  }
  async function submitCreate() {
    const trimmed = newName.trim();
    if (!trimmed) { cancelCreate(); return; }
    const res = await onCreateTag(trimmed);
    if (res === 'duplicate') {
      // 名前を修正したい場面なのでカーソルを入力欄に残す（submitBehavior="submit" で blur を
      // 抑止した上で、ソフトキーボード経由など blur 済みの経路でも確実に戻す）
      setDupError(true);
      inputRef.current?.focus();
      return;
    }
    setCreating(false);
    setNewName('');
    setDupError(false);
    Keyboard.dismiss();
  }

  function activateFocused() {
    if (focusedIndex < tags.length) {
      if (tags[focusedIndex]) onToggle(tags[focusedIndex].id);
    } else {
      startCreate();
    }
  }

  // 親（学習画面）のメインキーは表示中に active ゲートで解除済み。
  // Esc は作成中＝キャンセル／それ以外＝閉じる、の二段階のためシート側が担当する
  // （親の常時 Esc はシート表示中スキップ）。名前入力中は文字キーが TextInput に消費される（住み分け）。
  // T は開閉トグル：開くのは学習画面の T、閉じるのは表示中のここが担う。
  useKeyCommands([
    { input: 'j', handler: () => { if (visible) move(1); } },
    { input: 'k', handler: () => { if (visible) move(-1); } },
    // チップは横流れの折り返し配置のため、横方向キー（H/L・,/.）でも同じ前後移動にする
    // （行ジャンプは可変幅チップでは過剰。iPad は矢印非登録なので H/L がその代替も担う）。
    { input: 'l', handler: () => { if (visible) move(1); } },
    { input: 'h', handler: () => { if (visible) move(-1); } },
    { input: '.', handler: () => { if (visible) move(1); } },
    { input: ',', handler: () => { if (visible) move(-1); } },
    { input: ' ', handler: () => { if (visible) activateFocused(); } },
    { input: 't', handler: () => { if (visible) onClose(); } },
    // Return は Space と同じ「フォーカス項目の決定」（タグの付け外し/新規作成開始。作成入力中は確定）。
    // アプリ全体の「Return = フォーカス項目の決定」規約に合わせ、閉じるのは T/Esc/タップが担当。
    { input: KeyCommand.keyInputEnter, handler: () => { if (!visible) return; if (creating) { submitCreate(); } else { activateFocused(); } } },
    { input: KeyCommand.keyInputEscape, handler: () => { if (!visible) return; if (creating) { cancelCreate(); } else { onClose(); } } },
    ...(((Platform as any).isPad ? [] : [
      { input: KeyCommand.keyInputDownArrow, handler: () => { if (visible) move(1); } },
      { input: KeyCommand.keyInputUpArrow, handler: () => { if (visible) move(-1); } },
      { input: KeyCommand.keyInputRightArrow, handler: () => { if (visible) move(1); } },
      { input: KeyCommand.keyInputLeftArrow, handler: () => { if (visible) move(-1); } },
    ]) as { input: string; handler: () => void }[]),
  ], visible);

  const outline = themedFrameBorder(theme);

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, overlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[sheetStyle, styles.sheet, { backgroundColor: theme.baseSurface, marginBottom: kbHeight }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('study.cardTags')}
          </Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
          </Pressable>
        </View>
        {creating && (
          <View style={styles.createArea}>
            <View style={styles.createRow}>
              <TextInput
                ref={inputRef}
                autoFocus
                value={newName}
                onChangeText={(v) => { setNewName(v); setDupError(false); }}
                placeholder={t('tag.namePlaceholder')}
                placeholderTextColor={theme.colors.textTertiary}
                maxLength={50}
                returnKeyType="done"
                submitBehavior="submit"
                onSubmitEditing={submitCreate}
                style={[
                  styles.createInput,
                  {
                    borderColor: dupError ? theme.colors.danger : theme.colors.inputBorder,
                    color: theme.colors.text,
                    fontSize: theme.fontSize.md,
                    backgroundColor: theme.colors.background,
                  },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              />
              <Pressable onPress={submitCreate} style={styles.createBtn} hitSlop={4}>
                <Ionicons name="checkmark" size={24} color={theme.colors.primary} />
              </Pressable>
              <Pressable onPress={cancelCreate} style={styles.createBtn} hitSlop={4}>
                <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
              </Pressable>
            </View>
            {dupError && (
              <Text style={[styles.createError, { color: theme.colors.danger, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('tag.duplicateName')}
              </Text>
            )}
          </View>
        )}
        <ScrollView ref={scrollRef} contentContainerStyle={styles.chipWrap} keyboardShouldPersistTaps="handled">
          {tags.map((item, index) => {
            const selected = selectedIds.includes(item.id);
            const focused = focusedIndex === index;
            const tagColor = resolveTagColor(item.color, theme);
            // テーマ追従（__theme__）や色なしのタグは背景色に溶けるため枠線で縁取る（TagSelector と同処理）
            const blendsWithBackdrop = tagColor === theme.colors.background;
            return (
              <View
                key={item.id}
                style={[styles.focusRing, focused && { borderColor: theme.colors.primary }]}
                onLayout={(e) => { chipYs.current[index] = e.nativeEvent.layout.y; }}
              >
                <Pressable
                  style={[
                    styles.chip,
                    selected
                      ? { backgroundColor: tagColor }
                      : { backgroundColor: theme.colors.background, borderColor: tagColor, borderWidth: 1.5, opacity: 0.45 },
                    blendsWithBackdrop && { borderColor: outline, borderWidth: 1.5 },
                  ]}
                  onPress={() => { setFocusedIndex(index); onToggle(item.id); }}
                >
                  {!selected && (
                    <View style={[styles.dot, { backgroundColor: tagColor }, blendsWithBackdrop && { borderWidth: 1, borderColor: outline }]} />
                  )}
                  <Text style={[styles.chipText, { color: selected ? contrastText(tagColor) : theme.colors.text, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                    {truncateTag(item.name)}
                  </Text>
                </Pressable>
              </View>
            );
          })}
          {/* ＋新規タグ（インライン作成の開始。フォーカス順の末尾） */}
          <View
            style={[styles.focusRing, focusedIndex === tags.length && { borderColor: theme.colors.primary }]}
            onLayout={(e) => { chipYs.current[tags.length] = e.nativeEvent.layout.y; }}
          >
            <Pressable
              style={[styles.chip, styles.createChip, { borderColor: outline }]}
              onPress={() => { setFocusedIndex(tags.length); startCreate(); }}
            >
              <Ionicons name="add" size={theme.fontSize.md} color={theme.colors.textSecondary} />
              <Text style={[styles.chipText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('study.newTag')}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
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
  createArea: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 6,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  createInput: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  createBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createError: {},
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  // キーボードフォーカスの青枠。常時 borderWidth を確保してフォーカス移動時のレイアウトずれを防ぐ
  focusRing: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 20,
    padding: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  createChip: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    gap: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontWeight: '500' },
});

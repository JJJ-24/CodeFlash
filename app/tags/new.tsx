import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { constants as KeyCommand } from 'react-native-key-command';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';

import { useTheme, MAX_FONT_MULTIPLIER, PRIMARY_COLOR, TAG_PRESET_COLORS } from '@/lib/theme';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { useLockedTopInset } from '@/lib/useLockedTopInset';
import { resolveTagColor, TAG_THEME_COLOR, TAG_MONO_COLOR } from '@/lib/tagColors';
import { TagColorPicker } from '@/components/TagColorPicker';
import { ConfirmModal } from '@/components/ConfirmModal';
import { createTag } from '@/lib/database/tags';
import { useDismissKeyboardOnLeave } from '@/hooks/useDismissKeyboardOnLeave';
import { KEY_END, KEY_HOME, KEY_PAGE_DOWN, KEY_PAGE_UP, useKeyCommands } from '@/lib/useKeyCommands';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { usePendingFocusStore } from '@/store/pendingFocus';
import { useTagStore } from '@/store/tags';
import { useSettingsStore } from '@/store/settings';

const TAG_NEW_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: 'U / D', descKey: 'shortcut.scrollUpDown' },
    { key: '⇧U / ⇧D', descKey: 'shortcut.scrollTopBottom' },
  ] },
  { titleKey: 'shortcut.catAction', items: [
    { key: 'N', descKey: 'shortcut.focusTagName' },
    { key: 'C / ⇧C', descKey: 'shortcut.cycleColor' },
    { key: 'S', descKey: 'shortcut.save' },
    { key: 'X', descKey: 'shortcut.close' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC', descKey: 'shortcut.esc' },
    { key: '?', descKey: 'shortcut.showShortcuts' },
  ] },
];

export default function NewTagScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  useRestoreStatusBar();
  const lockedTopInset = useLockedTopInset();
  const { tags, addTag } = useTagStore();
  const setPendingFocus = usePendingFocusStore((s) => s.setPendingFocus);
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const { bottom: bottomInset } = useSafeAreaInsets();
  useDismissKeyboardOnLeave();

  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PRIMARY_COLOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = !!name.trim() && !saving;
  const isDirty = name.trim() !== '';
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  const nameRef = useRef<TextInput>(null);
  const editingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const SCROLL_STEP = 240;

  function handleClose() {
    if (!isDirty) { router.back(); return; }
    setShowDiscardModal(true);
  }

  // C キー：カラーを循環（TagColorPicker の並び順＝青→プリセット→テーマ色→白黒）。Shift+C で逆順。
  function cycleColor(dir = 1) {
    const cycle = [PRIMARY_COLOR, ...TAG_PRESET_COLORS, TAG_THEME_COLOR, TAG_MONO_COLOR];
    const i = cycle.indexOf(color);
    const n = cycle.length;
    setColor(cycle[(i + dir + n) % n]);
  }

  function scrollBy(delta: number) {
    scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current + delta), animated: true });
  }

  // 034: ハードキーボードショートカット。文字キーはテキスト欄フォーカス中は入力に消費される（住み分け）。
  // Tab/矢印は不使用（iPad 対策）。破棄確認モーダル表示中は親キーを無効化。
  const subModalOpen = () => showDiscardModal || showShortcutsModal;
  useKeyCommands([
    { input: 'n', handler: () => { if (subModalOpen()) return; nameRef.current?.focus(); } },
    { input: 'c', handler: () => { if (subModalOpen()) return; cycleColor(); } },
    { input: 'c', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; cycleColor(-1); } },
    { input: 's', handler: () => { if (subModalOpen()) return; if (canSave) handleSave(); } },
    { input: 'x', handler: () => { if (subModalOpen()) return; handleClose(); } },
    // 画面スクロール。
    { input: 'u', handler: () => { if (subModalOpen()) return; scrollBy(-SCROLL_STEP); } },
    { input: 'd', handler: () => { if (subModalOpen()) return; scrollBy(SCROLL_STEP); } },
    { input: KEY_PAGE_UP, handler: () => { if (subModalOpen()) return; scrollBy(-SCROLL_STEP); } },
    { input: KEY_PAGE_DOWN, handler: () => { if (subModalOpen()) return; scrollBy(SCROLL_STEP); } },
    { input: KEY_HOME, handler: () => { if (subModalOpen()) return; scrollRef.current?.scrollTo({ y: 0, animated: true }); } },
    { input: KEY_END, handler: () => { if (subModalOpen()) return; scrollRef.current?.scrollToEnd({ animated: true }); } },
    // Home/End の無いキーボード向け：Shift+U=最上部 / Shift+D=最下部。
    { input: 'u', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; scrollRef.current?.scrollTo({ y: 0, animated: true }); } },
    { input: 'd', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; scrollRef.current?.scrollToEnd({ animated: true }); } },
    // ショートカット一覧（OK のみ）表示中は Return=OK で閉じる。
    { input: KeyCommand.keyInputEnter, handler: () => { if (showShortcutsModal) setShowShortcutsModal(false); } },
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showShortcutsModal) { setShowShortcutsModal(false); return; } // ショートカット一覧を閉じる
        if (subModalOpen()) return;
        if (editingRef.current) { Keyboard.dismiss(); return; }
        handleClose();
      },
    },
  // ショートカット一覧 表示中はメインキーを解除（モーダル側スクロールキーとの相互削除を防ぐ。
  // 一覧の Esc 閉じは ShortcutsModal が担当）。
  ], !showShortcutsModal);

  // ?（Shift+/）= ショートカット一覧を開く。閉じる/トグルは ShortcutsModal 側が担当。
  // 一覧表示中は登録を外す（= モーダル側の ? と同一内容コマンドが共存して相互削除されるのを防ぐ。
  // 閉じると再登録され、再表示できる）。
  useKeyCommands([
    { input: '/', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; Keyboard.dismiss(); setShowShortcutsModal(true); } },
  ], !showShortcutsModal);

  // 一覧表示中のみ有効な Esc / Return 閉じ（メイン配列を解除している間の分を補う。メイン側とは排他）。
  useKeyCommands([
    { input: KeyCommand.keyInputEscape, handler: () => setShowShortcutsModal(false) },
    { input: KeyCommand.keyInputEnter, handler: () => setShowShortcutsModal(false) },
  ], showShortcutsModal);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (tags.some((tag) => tag.name === trimmed)) {
      setError(t('tag.duplicateName'));
      return;
    }
    setSaving(true);
    try {
      const tag = await createTag(db, { name: trimmed, color });
      addTag({ ...tag, cardCount: 0 });
      // 一覧へ戻ったとき、作成したタグへフォーカスを移す
      setPendingFocus('tag', tag.id);
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* fullScreenModal の標準ヘッダーはステータスバー inset に追従して縮むため、検索画面と同じ
          高さ固定のカスタムヘッダー（useLockedTopInset）にする。表示・色は useRestoreStatusBar が担当。 */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <View style={{ height: lockedTopInset + 44, backgroundColor: theme.colors.surface }}>
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
            <Pressable onPress={handleClose} style={{ paddingHorizontal: 4, zIndex: 1 }} hitSlop={8}>
              <Ionicons name="close" size={26} color={theme.colors.textSecondary} />
            </Pressable>
            <View style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }} pointerEvents="box-none">
              <Pressable
                onPress={keyboardShortcutsEnabled ? () => { Keyboard.dismiss(); setShowShortcutsModal(true); } : undefined}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Text style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('tag.new')}</Text>
                {keyboardShortcutsEnabled && (
                  <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
                )}
              </Pressable>
            </View>
            <View style={{ flex: 1 }} />
            <Pressable onPress={handleSave} disabled={!canSave} style={{ paddingHorizontal: 4, zIndex: 1 }} hitSlop={8}>
              <Ionicons name="checkmark-sharp" size={26} color={canSave ? theme.colors.primary : theme.colors.textTertiary} />
            </Pressable>
          </View>
        </View>
        <ScrollView
          ref={scrollRef}
          onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('tag.name')}
            </Text>
            <TextInput
              ref={nameRef}
              style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder, color: theme.colors.text, fontSize: theme.fontSize.md }]}
              placeholder={t('tag.namePlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              value={name}
              onChangeText={(v) => { setName(v); setError(''); }}
              autoFocus
              onFocus={() => { editingRef.current = true; }}
              onBlur={() => { editingRef.current = false; }}
              autoCorrect={false}
              spellCheck={false}
              maxLength={50}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            />
            {!!error && (
              <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{error}</Text>
            )}
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('tag.color')}
            </Text>
            <TagColorPicker color={color} onChange={setColor} />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('tag.previewLabel')}
            </Text>
            <View style={[styles.preview, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.previewDot, { backgroundColor: resolveTagColor(color, theme) }]} />
              <Text style={[styles.previewName, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {name || t('tag.namePlaceholder')}
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, !canSave && styles.actionBtnDisabled]}
            onPress={handleSave}
            disabled={!canSave}
          >
            <Ionicons name="checkmark-sharp" size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
      <ConfirmModal
        visible={showDiscardModal}
        message={t('common.discardChanges')}
        actions={canSave
          ? [
              { label: t('common.save'), onPress: () => { setShowDiscardModal(false); handleSave(); } },
              { label: t('common.discard'), destructive: true, onPress: () => { setShowDiscardModal(false); router.back(); } },
            ]
          : [
              { label: t('common.discard'), destructive: true, onPress: () => { setShowDiscardModal(false); router.back(); } },
            ]
        }
        onClose={() => setShowDiscardModal(false)}
      />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        sections={TAG_NEW_SHORTCUT_SECTIONS.map((s) => ({ title: t(s.titleKey), items: s.items }))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: 20, gap: 20 },
  field: { gap: 8 },
  label: { fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorCell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCellSelected: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    padding: 14,
  },
  previewDot: { width: 14, height: 14, borderRadius: 7 },
  previewName: { flex: 1 },
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnTextLight: { fontWeight: '700', color: '#FFF' },
});

import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { constants as KeyCommand } from 'react-native-key-command';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useTheme, MAX_FONT_MULTIPLIER, PRIMARY_COLOR, TAG_PRESET_COLORS } from '@/lib/theme';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { resolveTagColor, TAG_THEME_COLOR, TAG_MONO_COLOR } from '@/lib/tagColors';
import { TagColorPicker } from '@/components/TagColorPicker';
import { DiscardConfirmModal } from '@/components/DiscardConfirmModal';
import { FormBottomBar } from '@/components/FormBottomBar';
import { ModalFormHeader } from '@/components/ModalFormHeader';
import { createTag } from '@/lib/database/tags';
import { useDismissKeyboardOnLeave } from '@/hooks/useDismissKeyboardOnLeave';
import { scrollKeySpecs, useKeyCommands, useShortcutsToggleKeys } from '@/lib/useKeyCommands';
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
  const { tags, addTag } = useTagStore();
  const setPendingFocus = usePendingFocusStore((s) => s.setPendingFocus);
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
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

  // 034: ハードキーボードショートカット。文字キーはテキスト欄フォーカス中は入力に消費される（住み分け）。
  // Tab/矢印は不使用（iPad 対策）。破棄確認モーダル表示中は親キーを無効化。
  const subModalOpen = () => showDiscardModal || showShortcutsModal;
  useKeyCommands([
    { input: 'n', handler: () => { if (subModalOpen()) return; nameRef.current?.focus(); } },
    { input: 'c', handler: () => { if (subModalOpen()) return; cycleColor(); } },
    { input: 'c', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; cycleColor(-1); } },
    { input: 's', handler: () => { if (subModalOpen()) return; if (canSave) handleSave(); } },
    { input: 's', modifierFlags: KeyCommand.keyModifierCommand, handler: () => { if (subModalOpen()) return; if (canSave) handleSave(); } },
    { input: 'x', handler: () => { if (subModalOpen()) return; handleClose(); } },
    // 画面スクロール（U/D＝段階、PgUp/PgDn＝同、Home/End＝最上部/最下部、⇧U/⇧D＝端）。
    ...scrollKeySpecs({ scrollRef, scrollYRef, guard: subModalOpen }),
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

  // ?（Shift+/）= ショートカット一覧を開く／表示中は Esc・Return で閉じる（共通フック）。
  useShortcutsToggleKeys(
    showShortcutsModal,
    () => { if (subModalOpen()) return; Keyboard.dismiss(); setShowShortcutsModal(true); },
    () => setShowShortcutsModal(false),
  );

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
      {/* 標準ヘッダーは WebView がステータスバーを隠すと縮むため、自前固定ヘッダーを使う（詳細は ModalFormHeader）。 */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <ModalFormHeader
          title={t('tag.new')}
          onClose={handleClose}
          onSave={handleSave}
          canSave={canSave}
          showKeyboardIcon={keyboardShortcutsEnabled}
          onTitlePress={keyboardShortcutsEnabled ? () => { Keyboard.dismiss(); setShowShortcutsModal(true); } : undefined}
        />
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

        <FormBottomBar onSave={handleSave} saveDisabled={!canSave} />
      </View>
      <DiscardConfirmModal
        visible={showDiscardModal}
        canSave={canSave}
        onSave={() => { setShowDiscardModal(false); handleSave(); }}
        onDiscard={() => { setShowDiscardModal(false); router.back(); }}
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
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    padding: 14,
  },
  previewDot: { width: 14, height: 14, borderRadius: 7 },
  previewName: { flex: 1 },
});

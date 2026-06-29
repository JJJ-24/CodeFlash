import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { constants as KeyCommand } from 'react-native-key-command';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  Platform,
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

import { useTheme, MAX_FONT_MULTIPLIER, DECK_PRESET_COLORS, PRIMARY_COLOR } from '@/lib/theme';
import { DECK_THEME_COLOR, resolveDeckIconColors } from '@/lib/deckIconColors';
import { ConfirmModal } from '@/components/ConfirmModal';
import { IconPickerModal } from '@/components/IconPickerModal';
import { SqlInitModal } from '@/components/SqlInitModal';
import type { DeckIconName } from '@/lib/deckIcons';
import { createDeck } from '@/lib/database/decks';
import { useDismissKeyboardOnLeave } from '@/hooks/useDismissKeyboardOnLeave';
import { KEY_END, KEY_HOME, KEY_PAGE_DOWN, KEY_PAGE_UP, useKeyCommands } from '@/lib/useKeyCommands';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useDeckStore } from '@/store/decks';
import { useProStore } from '@/store/pro';
import { useSettingsStore } from '@/store/settings';

const DECK_NEW_SHORTCUTS = [
  { key: 'N', descKey: 'shortcut.focusDeckName' },
  { key: 'M', descKey: 'shortcut.focusDeckDesc' },
  { key: 'C / ⇧C', descKey: 'shortcut.cycleColor' },
  { key: 'I', descKey: 'shortcut.pickIcon' },
  { key: 'Q', descKey: 'shortcut.sqlInit', pro: true },
  { key: 'U / D', descKey: 'shortcut.scrollUpDown' },
  { key: '⇧U / ⇧D', descKey: 'shortcut.scrollTopBottom' },
  { key: 'S', descKey: 'shortcut.save' },
  { key: 'X', descKey: 'shortcut.close' },
  { key: 'ESC', descKey: 'shortcut.esc' },
];

export default function NewDeckScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { addDeck } = useDeckStore();
  const isPro = useProStore((s) => s.isPro);
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const { bottom: bottomInset } = useSafeAreaInsets();
  useDismissKeyboardOnLeave();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [iconName, setIconName] = useState<DeckIconName | null>(null);
  const [colorHex, setColorHex] = useState<string | null>(PRIMARY_COLOR);
  const [sqlInit, setSqlInit] = useState('');
  const [showSqlInitModal, setShowSqlInitModal] = useState(false);
  const language = 'ja';
  const [saving, setSaving] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);

  // ネイティブキーコマンド用：各テキスト欄の ref と編集中フラグ（Esc の挙動分岐に使う）。
  const nameRef = useRef<TextInput>(null);
  const descRef = useRef<TextInput>(null);
  const editingRef = useRef(false);
  // 画面スクロール（U/D・PgUp/PgDn・Home/End）用。
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const SCROLL_STEP = 240;

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const deck = await createDeck(db, {
        name: trimmed,
        description: description.trim(),
        language,
        iconName,
        colorHex,
        sqlInit: sqlInit.trim() || null,
      });
      addDeck(deck);
      router.back();
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!name.trim() && !saving;
  const isDirty = name.trim() !== '' || description.trim() !== '' || iconName !== null || colorHex !== PRIMARY_COLOR || sqlInit.trim() !== '';
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  function handleClose() {
    if (!isDirty) { router.back(); return; }
    setShowDiscardModal(true);
  }

  // C キー：カラーを循環（UI の並び順＝青→プリセット→テーマ色→白黒）。Shift+C で逆順。
  function cycleColor(dir = 1) {
    const cycle: (string | null)[] = [PRIMARY_COLOR, ...DECK_PRESET_COLORS, DECK_THEME_COLOR, null];
    const i = cycle.findIndex((c) => c === colorHex);
    const n = cycle.length;
    setColorHex(cycle[(i + dir + n) % n]);
  }

  // 画面スクロール（U/D は段階・Home/End は端へ）。アーカイブ等の下方フィールドへキーボードで到達するため。
  function scrollBy(delta: number) {
    scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current + delta), animated: true });
  }

  // ハードキーボードのショートカット（034 / ネイティブ UIKeyCommand）。
  // 文字キーはテキスト欄フォーカス中は入力欄が消費するため、非編集時のみ発火する（住み分け）。
  // Tab/矢印は iPad のフォーカスエンジン対策で使わず、N/E でフィールドへ直接カーソルを移す。
  // サブモーダル（アイコン/SQL/破棄確認）は RN Modal。開いている間はそのモーダル側が
  // キーを処理するため、親画面のショートカットは無効化する（キーコマンドは AppDelegate に
  // 付くため開いていても発火しうる＝明示ガードが必要）。
  const subModalOpen = () => showIconPicker || showSqlInitModal || showDiscardModal || showShortcutsModal;
  useKeyCommands([
    { input: 'n', handler: () => { if (subModalOpen()) return; nameRef.current?.focus(); } },
    { input: 'm', handler: () => { if (subModalOpen()) return; descRef.current?.focus(); } },
    { input: 's', handler: () => { if (subModalOpen()) return; if (canSave) handleCreate(); } },
    { input: 'x', handler: () => { if (subModalOpen()) return; handleClose(); } },
    { input: 'c', handler: () => { if (subModalOpen()) return; cycleColor(); } },
    { input: 'c', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; cycleColor(-1); } },
    { input: 'i', handler: () => { if (subModalOpen()) return; Keyboard.dismiss(); setShowIconPicker(true); } },
    { input: 'q', handler: () => { if (subModalOpen()) return; if (isPro) { Keyboard.dismiss(); setShowSqlInitModal(true); } } },
    // 画面スクロール（U/D＝段階、PgUp/PgDn＝同、Home/End＝最上部/最下部）。
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
        if (subModalOpen()) return; // 他モーダル側の Esc に委ねる
        // 編集中は Esc でカーソル解除のみ。非編集なら閉じる（変更あれば破棄確認）。
        if (editingRef.current) { Keyboard.dismiss(); return; }
        handleClose();
      },
    },
  ]);

  const { color: previewIconColor, bg: previewIconBg } = resolveDeckIconColors(colorHex, theme);

  const colorSwatch = (c: string) => (
    <Pressable
      key={c}
      onPress={() => { Keyboard.dismiss(); setColorHex(c); }}
      style={[styles.colorCell, { backgroundColor: c }, colorHex === c && styles.colorCellSelected]}
    >
      {colorHex === c && <Ionicons name="checkmark-sharp" size={18} color="#FFF" />}
    </Pressable>
  );
  // 設定の「配色」に追従する2トーン（アイコン=primary／丸背景=カードテーマ色）を1色として追加する
  const themeSwatchColors = resolveDeckIconColors(DECK_THEME_COLOR, theme);
  const themeSwatch = (
    <Pressable
      key="__theme__"
      onPress={() => { Keyboard.dismiss(); setColorHex(DECK_THEME_COLOR); }}
      style={[styles.colorCell, { backgroundColor: themeSwatchColors.bg, borderColor: theme.colors.inputBorder, borderWidth: 1 }, colorHex === DECK_THEME_COLOR && styles.colorCellSelected]}
    >
      <Ionicons name={colorHex === DECK_THEME_COLOR ? 'checkmark-sharp' : 'sync'} size={colorHex === DECK_THEME_COLOR ? 18 : 22} color={theme.colors.primary} />
    </Pressable>
  );
  const clearSwatch = (
    <Pressable
      key="__clear__"
      onPress={() => { Keyboard.dismiss(); setColorHex(null); }}
      style={[styles.colorCell, { backgroundColor: theme.colors.background, borderColor: theme.colors.inputBorder, borderWidth: 1 }, colorHex === null && { borderColor: theme.colors.primary, borderWidth: 2 }]}
    >
      <Ionicons name={colorHex === null ? 'checkmark-sharp' : 'contrast'} size={colorHex === null ? 18 : 24} color={theme.colors.text} />
    </Pressable>
  );

  return (
    <>
      <Stack.Screen
        options={{

          headerTitle: () => (
            <Pressable
              onPress={keyboardShortcutsEnabled ? () => { Keyboard.dismiss(); setShowShortcutsModal(true); } : undefined}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Text style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('deck.new')}</Text>
              {keyboardShortcutsEnabled && (
                <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
              )}
            </Pressable>
          ),
          headerLeft: () => (
            <Pressable onPress={handleClose} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="close" size={26} color={theme.colors.textSecondary} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={handleCreate} disabled={!canSave} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="checkmark-sharp" size={26} color={canSave ? theme.colors.primary : theme.colors.textTertiary} />
            </Pressable>
          ),
        }}
      />
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <ScrollView
          ref={scrollRef}
          onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('deck.name')}
            </Text>
            <TextInput
              ref={nameRef}
              style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder, color: theme.colors.text, fontSize: theme.fontSize.lg }]}
              placeholder={t('deck.namePlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={50}
              autoFocus
              returnKeyType="next"
              onFocus={() => { editingRef.current = true; }}
              onBlur={() => { editingRef.current = false; }}
              onSubmitEditing={() => descRef.current?.focus()}
              autoCorrect={false}
              spellCheck={false}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('deck.description')}
            </Text>
            <TextInput
              ref={descRef}
              style={[styles.input, styles.multiline, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder, color: theme.colors.text, fontSize: theme.fontSize.lg }]}
              placeholder={t('deck.descriptionPlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              onFocus={() => { editingRef.current = true; }}
              onBlur={() => { editingRef.current = false; }}
              autoCorrect={false}
              spellCheck={false}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('deck.icon')}
            </Text>
            <Pressable
              style={[styles.iconButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }]}
              onPress={() => { Keyboard.dismiss(); setShowIconPicker(true); }}
            >
              <View style={[styles.iconCircle, { backgroundColor: previewIconBg }]}>
                <Ionicons
                  name={(iconName ?? 'add') as any}
                  size={22}
                  color={iconName ? previewIconColor : theme.colors.textSecondary}
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: name ? theme.colors.text : theme.colors.textTertiary, fontSize: theme.fontSize.md, fontWeight: '600' }} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {name || t('deck.namePlaceholder')}
                </Text>
                {!!description && (
                  <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                    {description}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('deck.color')}
            </Text>
            {(Platform as any).isPad ? (
              // iPad: 横一連に 青+全色 + テーマカラー + 白黒
              <View style={styles.colorGrid}>
                {[PRIMARY_COLOR, ...DECK_PRESET_COLORS].map(colorSwatch)}
                {themeSwatch}
                {clearSwatch}
              </View>
            ) : (
              // iPhone: 上段8色（青+先頭7） / 下段7色（残り5 + テーマカラー + 白黒）
              <View style={{ gap: 8 }}>
                <View style={styles.colorGrid}>{[PRIMARY_COLOR, ...DECK_PRESET_COLORS.slice(0, 7)].map(colorSwatch)}</View>
                <View style={styles.colorGrid}>{DECK_PRESET_COLORS.slice(7).map(colorSwatch)}{themeSwatch}{clearSwatch}</View>
              </View>
            )}
          </View>

          {isPro && (
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('deck.sqlInitLabel')}
              </Text>
              <Pressable
                style={[styles.iconButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }]}
                onPress={() => { Keyboard.dismiss(); setShowSqlInitModal(true); }}
              >
                <View style={[styles.iconCircle, { backgroundColor: sqlInit.trim() ? theme.colors.primaryLight : theme.colors.background }]}>
                  <Ionicons name="server-outline" size={20} color={sqlInit.trim() ? theme.colors.primary : theme.colors.textSecondary} />
                </View>
                <Text style={{ color: sqlInit.trim() ? theme.colors.text : theme.colors.textSecondary, fontSize: theme.fontSize.md, flex: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {sqlInit.trim() ? t('deck.sqlInitSet') : t('deck.sqlInitNone')}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          )}

        </ScrollView>
        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, !canSave && styles.actionBtnDisabled]}
            onPress={handleCreate}
            disabled={!canSave}
          >
            <Ionicons name="checkmark-sharp" size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
      <IconPickerModal
        visible={showIconPicker}
        selected={iconName}
        highlightColor={previewIconColor}
        onSelect={setIconName}
        onClose={() => setShowIconPicker(false)}
      />
      <SqlInitModal
        visible={showSqlInitModal}
        value={sqlInit}
        onChangeText={setSqlInit}
        onClose={() => setShowSqlInitModal(false)}
      />
      <ConfirmModal
        visible={showDiscardModal}
        message={t('common.discardChanges')}
        actions={canSave
          ? [
              { label: t('common.save'), onPress: () => { setShowDiscardModal(false); handleCreate(); } },
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
        shortcuts={DECK_NEW_SHORTCUTS}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 20, gap: 20 },
  field: { gap: 6 },
  label: { fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multiline: { height: 90, textAlignVertical: 'top' },
  iconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  colorCell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCellSelected: {
    borderWidth: 2,
    borderColor: '#FFF',
  },
  langRow: { flexDirection: 'row', gap: 10 },
  langBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  headerBtn: { fontWeight: '600' },
  disabled: { opacity: 0.35 },
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

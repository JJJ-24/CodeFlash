import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { constants as KeyCommand } from 'react-native-key-command';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { DiscardConfirmModal } from '@/components/DiscardConfirmModal';
import { FormBottomBar } from '@/components/FormBottomBar';
import { ModalFormHeader } from '@/components/ModalFormHeader';
import { IconPickerModal } from '@/components/IconPickerModal';
import { HtmlImageLibrary } from '@/components/deck/HtmlImageLibrary';
import { SqlInitModal } from '@/components/SqlInitModal';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { useTheme, MAX_FONT_MULTIPLIER, DECK_PRESET_COLORS, PRIMARY_COLOR } from '@/lib/theme';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { DECK_THEME_COLOR, resolveDeckIconColors } from '@/lib/deckIconColors';
import { normalizeDeckStages } from '@/lib/deckStages';
import type { DeckIconName } from '@/lib/deckIcons';
import type { DeckImage } from '@/types';
import { deleteDeck, setDeckArchived, updateDeck } from '@/lib/database/decks';
import { useDismissKeyboardOnLeave } from '@/hooks/useDismissKeyboardOnLeave';
import { deleteKeySpecs, scrollKeySpecs, useKeyCommands, useShortcutsToggleKeys } from '@/lib/useKeyCommands';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useDeckStore } from '@/store/decks';
import { useProStore } from '@/store/pro';
import { useSettingsStore } from '@/store/settings';

const DECK_EDIT_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: 'U / D', descKey: 'shortcut.scrollUpDown' },
    { key: '⇧U / ⇧D', descKey: 'shortcut.scrollTopBottom' },
  ] },
  { titleKey: 'shortcut.catAction', items: [
    { key: 'N', descKey: 'shortcut.focusDeckName' },
    { key: 'M', descKey: 'shortcut.focusDeckDesc' },
    { key: 'C / ⇧C', descKey: 'shortcut.cycleColor' },
    { key: 'I', descKey: 'shortcut.pickIcon' },
    { key: 'Q', descKey: 'shortcut.sqlInit', pro: true },
    { key: 'H', descKey: 'shortcut.htmlInit', pro: true },
    { key: 'E', descKey: 'shortcut.toggleArchive' },
    { key: 'S', descKey: 'shortcut.save' },
    { key: 'Delete', descKey: 'shortcut.deleteDeck' },
    { key: 'X', descKey: 'shortcut.close' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC', descKey: 'shortcut.esc' },
    { key: '?', descKey: 'shortcut.showShortcuts' },
  ] },
];

export default function EditDeckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  useRestoreStatusBar();
  const { decks, updateDeck: updateStore, removeDeck } = useDeckStore();
  const isPro = useProStore((s) => s.isPro);
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  useDismissKeyboardOnLeave();

  const deck = decks.find((d) => d.id === id);

  const [name, setName] = useState(deck?.name ?? '');
  const [description, setDescription] = useState(deck?.description ?? '');
  const [iconName, setIconName] = useState<DeckIconName | null>((deck?.iconName as DeckIconName | null) ?? null);
  const [colorHex, setColorHex] = useState<string | null>(deck?.colorHex ?? null);
  const [sqlInit, setSqlInit] = useState(deck?.sqlInit ?? '');
  const [showSqlInitModal, setShowSqlInitModal] = useState(false);
  const [htmlInit, setHtmlInit] = useState(deck?.htmlInit ?? '');
  // 043: HTML 画像ライブラリ。土台と同じくライブ編集し、確定は画面の保存で行う。
  const [htmlImages, setHtmlImages] = useState<DeckImage[]>(deck?.htmlImages ?? []);
  const [showHtmlInitModal, setShowHtmlInitModal] = useState(false);
  // 043: 行の「設定済み」表示は土台テキストと画像ライブラリのどちらかがあれば点灯させる
  // （行が両方への入口なので、画像だけ登録した状態を「未設定」と見せないため）。
  const htmlConfigured = htmlInit.trim() !== '' || htmlImages.length > 0;

  const [archived, setArchived] = useState<boolean>(deck?.archived ?? false);
  const language = (deck?.language as 'ja' | 'en') ?? 'ja';
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);

  // ネイティブキーコマンド用：各テキスト欄の ref と編集中フラグ（Esc の挙動分岐に使う）。
  const nameRef = useRef<TextInput>(null);
  const descRef = useRef<TextInput>(null);
  const editingRef = useRef(false);
  // 画面スクロール（U/D・PgUp/PgDn・Home/End）用。
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);

  // C キー：カラーを循環（UI の並び順＝青→プリセット→テーマ色→白黒）。Shift+C で逆順。
  function cycleColor(dir = 1) {
    const cycle: (string | null)[] = [PRIMARY_COLOR, ...DECK_PRESET_COLORS, DECK_THEME_COLOR, null];
    const i = cycle.findIndex((c) => c === colorHex);
    const n = cycle.length;
    setColorHex(cycle[(i + dir + n) % n]);
  }

  // 034: ハードキーボードショートカット（フック規約上、早期 return より前で呼ぶ。
  // ハンドラが後方定義の値を参照するのはクロージャなので可＝キー押下時には初期化済み）。
  // サブモーダル（アイコン/SQL/削除確認/破棄確認）は RN Modal。開いている間は親のキーを無効化する。
  const subModalOpen = () => showIconPicker || showSqlInitModal || showHtmlInitModal || showDeleteModal || showDiscardModal;
  useKeyCommands([
    { input: 'n', handler: () => { if (subModalOpen()) return; nameRef.current?.focus(); } },
    { input: 'm', handler: () => { if (subModalOpen()) return; descRef.current?.focus(); } },
    { input: 's', handler: () => { if (subModalOpen()) return; if (canSave) handleSave(); } },
    { input: 's', modifierFlags: KeyCommand.keyModifierCommand, handler: () => { if (subModalOpen()) return; if (canSave) handleSave(); } },
    { input: 'x', handler: () => { if (subModalOpen()) return; handleClose(); } },
    { input: 'c', handler: () => { if (subModalOpen()) return; cycleColor(); } },
    { input: 'c', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; cycleColor(-1); } },
    { input: 'i', handler: () => { if (subModalOpen()) return; Keyboard.dismiss(); setShowIconPicker(true); } },
    { input: 'q', handler: () => { if (subModalOpen()) return; if (isPro) { Keyboard.dismiss(); setShowSqlInitModal(true); } } },
    { input: 'h', handler: () => { if (subModalOpen()) return; if (isPro) { Keyboard.dismiss(); setShowHtmlInitModal(true); } } },
    { input: 'e', handler: () => { if (subModalOpen()) return; Keyboard.dismiss(); setArchived((v) => !v); } }, // アーカイブ切替（全画面で E に統一）
    ...deleteKeySpecs(() => { if (subModalOpen()) return; confirmDelete(); }), // 削除（Backspace/Delete）
    // 画面スクロール（U/D＝段階、PgUp/PgDn＝同、Home/End＝最上部/最下部、⇧U/⇧D＝端）。
    ...scrollKeySpecs({ scrollRef, scrollYRef, guard: subModalOpen }),
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (subModalOpen()) return; // モーダル側の Esc に委ねる
        if (editingRef.current) { Keyboard.dismiss(); return; }
        handleClose();
      },
    },
  // ショートカット一覧 表示中はメインキーを解除（モーダル側スクロールキーとの相互削除を防ぐ。
  // 一覧の Esc/Return 閉じは下の排他フックが担当）。
  ], !showShortcutsModal);

  // ?（Shift+/）= ショートカット一覧を開く／表示中は Esc・Return で閉じる（共通フック）。
  useShortcutsToggleKeys(
    showShortcutsModal,
    () => { if (subModalOpen()) return; Keyboard.dismiss(); setShowShortcutsModal(true); },
    () => setShowShortcutsModal(false),
  );

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || !deck) return;
    setSaving(true);
    try {
      const normalizedSqlInit = sqlInit.trim() || null;
      const normalizedHtmlInit = htmlInit.trim() || null;
      await updateDeck(db, id, { name: trimmed, description: description.trim(), language, iconName, colorHex, sqlInit: normalizedSqlInit, htmlInit: normalizedHtmlInit, htmlImages });
      if (archived !== deck.archived) {
        await setDeckArchived(db, id, archived);
      }
      // 044 Phase 1: この画面はまだ旧 htmlInit を編集するため、ストアの htmlStages も
      // toDeck と同じ規則で作り直す（そうしないと再読み込みまで古い土台が残る）。
      // htmlStages 列は書いていない＝この画面で編集したデッキの土台は常に1件なので合成でよい。
      // Phase 2 でこの画面が土台リストを直接編集するようになったら、この行ごと置き換える。
      updateStore({ ...deck, name: trimmed, description: description.trim(), language, iconName, colorHex, sqlInit: normalizedSqlInit, htmlInit: normalizedHtmlInit, htmlStages: normalizeDeckStages(null, normalizedHtmlInit), htmlImages, archived });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    setShowDeleteModal(true);
  }

  async function handleDeleteConfirm() {
    setShowDeleteModal(false);
    await deleteDeck(db, id);
    removeDeck(id);
    router.back();
  }

  if (!deck) return null;

  const canSave = !!name.trim() && !saving;
  const isDirty = name.trim() !== deck.name
    || description.trim() !== (deck.description ?? '')
    || iconName !== (deck.iconName ?? null)
    || colorHex !== (deck.colorHex ?? null)
    || (sqlInit.trim() || null) !== (deck.sqlInit ?? null)
    || (htmlInit.trim() || null) !== (deck.htmlInit ?? null)
    || JSON.stringify(htmlImages) !== JSON.stringify(deck.htmlImages ?? [])
    || archived !== deck.archived;

  function handleClose() {
    if (!isDirty) { router.back(); return; }
    setShowDiscardModal(true);
  }

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
      {/* 標準ヘッダーは WebView がステータスバーを隠すと縮むため、自前固定ヘッダーを使う（詳細は ModalFormHeader）。 */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <ModalFormHeader
          title={t('deck.edit')}
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
                  <Ionicons name={sqlInit.trim() ? 'server' : 'server-outline'} size={20} color={sqlInit.trim() ? theme.colors.primary : theme.colors.textSecondary} />
                </View>
                <Text style={{ color: sqlInit.trim() ? theme.colors.text : theme.colors.textSecondary, fontSize: theme.fontSize.md, flex: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {sqlInit.trim() ? t('deck.sqlInitSet') : t('deck.sqlInitNone')}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          )}

          {isPro && (
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('deck.htmlInitLabel')}
              </Text>
              <Pressable
                style={[styles.iconButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }]}
                onPress={() => { Keyboard.dismiss(); setShowHtmlInitModal(true); }}
              >
                <View style={[styles.iconCircle, { backgroundColor: htmlConfigured ? theme.colors.primaryLight : theme.colors.background }]}>
                  <Ionicons name={htmlConfigured ? 'globe' : 'globe-outline'} size={20} color={htmlConfigured ? theme.colors.primary : theme.colors.textSecondary} />
                </View>
                <Text style={{ color: htmlConfigured ? theme.colors.text : theme.colors.textSecondary, fontSize: theme.fontSize.md, flex: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {htmlConfigured ? t('deck.htmlInitSet') : t('deck.htmlInitNone')}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          )}

          <View style={styles.field}>
            <View style={[styles.archiveRow, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {t('deck.archive')}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('deck.archiveHint')}
                </Text>
              </View>
              <Switch
                value={archived}
                onValueChange={(v) => { Keyboard.dismiss(); setArchived(v); }}
                trackColor={{ true: theme.colors.primary }}
                thumbColor="#FFF"
              />
            </View>
          </View>
        </ScrollView>
        <FormBottomBar onSave={handleSave} saveDisabled={!canSave} onDelete={confirmDelete} />
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
      <SqlInitModal
        visible={showHtmlInitModal}
        value={htmlInit}
        onChangeText={setHtmlInit}
        onClose={() => setShowHtmlInitModal(false)}
        title={t('deck.htmlInitLabel')}
        hint={t('deck.htmlInitHint')}
        placeholder={t('deck.htmlInitPlaceholder')}
        footer={<HtmlImageLibrary images={htmlImages} onChange={setHtmlImages} />}
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={t('deck.deleteConfirm', { name: deck.name.length > 20 ? deck.name.slice(0, 20) + '…' : deck.name })}
        onConfirm={handleDeleteConfirm}
        onClose={() => setShowDeleteModal(false)}
      />
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
        sections={DECK_EDIT_SHORTCUT_SECTIONS.map((s) => ({ title: t(s.titleKey), items: s.items }))}
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
  archiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});

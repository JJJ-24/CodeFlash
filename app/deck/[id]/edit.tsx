import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { constants as KeyCommand } from 'react-native-key-command';
import { SettingsFocusContext, useFocusRegistry } from '@/components/settings/settingsFocus';
import { DeckFormCard, DeckFormDivider, DeckFormField, DeckFormNavRow, DeckFormSectionTitle, DeckFormToggleRow } from '@/components/deck/DeckFormParts';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { DiscardConfirmModal } from '@/components/DiscardConfirmModal';
import { FormBottomBar } from '@/components/FormBottomBar';
import { ModalFormHeader } from '@/components/ModalFormHeader';
import { IconPickerModal } from '@/components/IconPickerModal';
import { DeckSpeechModal, deckSpeechSummary } from '@/components/deck/DeckSpeechModal';
import { scriptLangsEqual, type ScriptLangs, type SpeechAutoMode } from '@/lib/speech';
import { DeckStagesModal } from '@/components/deck/DeckStagesModal';
import { HtmlImageLibrary } from '@/components/deck/HtmlImageLibrary';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { useTheme, MAX_FONT_MULTIPLIER, DECK_PRESET_COLORS, PRIMARY_COLOR } from '@/lib/theme';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { DECK_THEME_COLOR, resolveDeckIconColors } from '@/lib/deckIconColors';
import { legacyInitMirror } from '@/lib/deckStages';
import type { DeckIconName } from '@/lib/deckIcons';
import type { DeckImage, DeckStage } from '@/types';
import { deleteDeck, setDeckArchived, updateDeck } from '@/lib/database/decks';
import { useDismissKeyboardOnLeave } from '@/hooks/useDismissKeyboardOnLeave';
import { deleteKeySpecs, scrollKeySpecs, useKeyCommands, useShortcutsToggleKeys } from '@/lib/useKeyCommands';
import { ArchivePill, useArchivePill } from '@/components/ArchivePill';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useDeckStore } from '@/store/decks';
import { useProStore } from '@/store/pro';
import { useSettingsStore } from '@/store/settings';

const DECK_EDIT_SHORTCUT_SECTIONS = [
  // 055：J/K で項目を選んで操作する（文字キーは下の「操作」のまま使える）
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
    { key: '⇧J / ⇧K', descKey: 'shortcut.sectionNextPrev' },
    { key: 'Return', descKey: 'shortcut.formActivate' },
    { key: 'Space', descKey: 'shortcut.settingToggle' },
    { key: ', / .', descKey: 'shortcut.formColorStep' },
  ] },
  { titleKey: 'shortcut.catDisplay', items: [
    { key: 'U / D', descKey: 'shortcut.scrollUpDown' },
    { key: '⇧U / ⇧D', descKey: 'shortcut.scrollTopBottom' },
  ] },
  { titleKey: 'shortcut.catAction', items: [
    { key: 'N', descKey: 'shortcut.focusDeckName' },
    { key: 'M', descKey: 'shortcut.focusDeckDesc' },
    { key: 'C / ⇧C', descKey: 'shortcut.cycleColor' },
    { key: 'I', descKey: 'shortcut.pickIcon' },
    // 並びは画面の行順（057：基本〈…アーカイブ〉→ 読み上げ → 読み上げの設定 → HTML/CSS 土台 → SQL 初期化）に合わせる。
    // 読み上げは無料機能なので pro フラグを付けない
    { key: 'E', descKey: 'shortcut.toggleArchive' },
    { key: '⇧R', descKey: 'shortcut.toggleDeckSpeech' },
    { key: 'R', descKey: 'shortcut.deckSpeechSettings' },
    { key: 'H', descKey: 'shortcut.htmlInit', pro: true },
    { key: 'Q', descKey: 'shortcut.sqlInit', pro: true },
    { key: 'S', descKey: 'shortcut.save' },
    { key: 'Delete', descKey: 'shortcut.deleteDeck' },
    { key: 'X', descKey: 'shortcut.close' },
  ] },
  { titleKey: 'shortcut.catStageSheet', items: [
    { key: 'J / K', descKey: 'shortcut.focusNextPrev', pro: true },
    { key: 'Return', descKey: 'shortcut.stageOpen', pro: true },
    { key: 'Delete', descKey: 'shortcut.deleteFocused', pro: true },
    { key: 'N', descKey: 'shortcut.stageAdd', pro: true },
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
  const { keyboardShortcutsEnabled, speechEnabled } = useSettingsStore();
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  useDismissKeyboardOnLeave();

  const deck = decks.find((d) => d.id === id);

  const [name, setName] = useState(deck?.name ?? '');
  const [description, setDescription] = useState(deck?.description ?? '');
  const [iconName, setIconName] = useState<DeckIconName | null>((deck?.iconName as DeckIconName | null) ?? null);
  const [colorHex, setColorHex] = useState<string | null>(deck?.colorHex ?? null);
  // 045: 名前付き初期化SQLのリスト（044 の htmlStages と同じ持ち方・ライブ編集）
  const [sqlStages, setSqlStages] = useState<DeckStage[]>(deck?.sqlStages ?? []);
  const [showSqlInitModal, setShowSqlInitModal] = useState(false);
  // 044: 名前付き土台のリスト。土台テキストと同じくライブ編集し、確定は画面の保存で行う。
  const [htmlStages, setHtmlStages] = useState<DeckStage[]>(deck?.htmlStages ?? []);
  // 043: HTML 画像ライブラリ。土台と同じくライブ編集し、確定は画面の保存で行う。
  const [htmlImages, setHtmlImages] = useState<DeckImage[]>(deck?.htmlImages ?? []);
  const [showHtmlInitModal, setShowHtmlInitModal] = useState(false);
  // 043/044: 行の「設定済み」表示は土台と画像ライブラリのどちらかがあれば点灯させる
  // （行が両方への入口なので、画像だけ登録した状態を「未設定」と見せないため）。
  const filledStages = htmlStages.filter((s) => s.content.trim() !== '').length;
  const htmlConfigured = filledStages > 0 || htmlImages.length > 0;
  const filledSqlStages = sqlStages.filter((s) => s.content.trim() !== '').length;
  // 050 Phase 2: このデッキだけの読み上げ言語（文字体系 → 言語の上書き。未設定は {}）
  const [speechLangs, setSpeechLangs] = useState<ScriptLangs>(deck?.speechLangs ?? {});
  // 051: 裏面用の上書き（空 = 表面と同じ）
  const [speechLangsBack, setSpeechLangsBack] = useState<ScriptLangs>(deck?.speechLangsBack ?? {});
  const [showSpeechModal, setShowSpeechModal] = useState(false);
  // 051: 非 Pro が設定済みデッキを開いたときの案内（解除だけは通す）
  const [showSpeechProModal, setShowSpeechProModal] = useState(false);
  // 052: このデッキの自動読み上げの面（null＝アプリ設定に従う・Pro）
  const [speechAuto, setSpeechAuto] = useState<SpeechAutoMode | null>(deck?.speechAuto ?? null);
  const speechConfigured = Object.keys(speechLangs).length > 0 || Object.keys(speechLangsBack).length > 0 || speechAuto !== null;
  // 052: このデッキで読み上げを使うか（無料・既定 ON）。保存値は否定形＝トグルの value は `!speechDisabled`
  const [speechDisabled, setSpeechDisabled] = useState<boolean>(deck?.speechDisabled ?? false);
  // 読み上げの説明（アーカイブと同じく ⓘ タップで行の下にインライン展開する）
  const [showSpeechInfo, setShowSpeechInfo] = useState(false);

  const [archived, setArchived] = useState<boolean>(deck?.archived ?? false);
  // アーカイブの説明（常時表示をやめ、ⓘ タップでこの行の下にインライン展開する）
  const [showArchiveInfo, setShowArchiveInfo] = useState(false);
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
  // 055：J/K で項目を選び Return/Space/`,`/`.` で操作する（053 の設定の詳細画面と同じ仕組み）。文字キー（N/M/C/I/R/H/Q/E）は残す。
  const nav = useFocusRegistry(scrollRef, scrollYRef);
  // E でアーカイブを切り替えたとき、欄が画面外でも分かるよう中央ピルで通知する（カード編集と同じ）
  const { archivePill, showArchivePill } = useArchivePill();
  // 055：どの入力欄にカーソルがあるか（Return で説明欄へ移ったとき・タップで入れたときも青枠を追従させる）
  const [inputFocus, setInputFocus] = useState<'name' | 'desc' | null>(null);

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

  /**
   * 051：読み上げのデッキ設定を開く。**設定するのは Pro／見る・消すは無料**。
   * 非 Pro でも設定済みなら解除だけは通す＝インポートや iCloud で受け取ったデッキを
   * 直す手段が画面から無くなるのを防ぐ（デッキ設定はアプリ設定に勝つので打ち消せない）。
   */
  function openSpeechSettings() {
    Keyboard.dismiss();
    if (isPro) { setShowSpeechModal(true); return; }
    if (speechConfigured) { setShowSpeechProModal(true); return; }
    router.push('/paywall');
  }

  // アラート（削除・破棄・Pro の案内）は表示中にキーを独占する（054）ので含めない。
  const subModalOpen = () => showIconPicker || showSqlInitModal || showHtmlInitModal || showSpeechModal;
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
    // 050 Phase 2: 読み上げ（Read）。⚠️ Pro ゲートは無い（読み上げは無料機能）
    { input: 'r', handler: () => { if (subModalOpen()) return; openSpeechSettings(); } },
    // 052: ⇧R = このデッキの読み上げ ON/OFF（R＝読み上げの設定を開く、の Shift 版。E＝アーカイブと同じ「トグルはキー1つ」）
    { input: 'r', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; Keyboard.dismiss(); setSpeechDisabled((v) => !v); } },
    // アーカイブ切替（全画面で E に統一）。欄が画面外でも分かるよう中央ピルで通知＋ヘッダーにアイコン（ModalFormHeader）
    { input: 'e', handler: () => { if (subModalOpen()) return; Keyboard.dismiss(); const next = !archived; setArchived(next); showArchivePill(next); } },
    ...deleteKeySpecs(() => { if (subModalOpen()) return; confirmDelete(); }), // 削除（Backspace/Delete）
    // 画面スクロール（U/D＝段階、PgUp/PgDn＝同、Home/End＝最上部/最下部、⇧U/⇧D＝端）。
    // 055：J/K＝項目のフォーカス・Return＝開く/入力を始める・Space＝スイッチ・`,`/`.`＝色を送る
    //（H/L は使わない＝H は「HTML/CSS 土台を開く」。矢印も使わない＝この画面は iPad のフォーカスエンジン対策で不使用）
    { input: 'j', handler: () => { if (subModalOpen()) return; nav.moveFocus(1); } },
    { input: 'k', handler: () => { if (subModalOpen()) return; nav.moveFocus(-1); } },
    // 057：⇧J/⇧K＝前後のセクション（基本／読み上げ／コード実行）の先頭の項目へ（学習設定の見出し移動と同じ）
    { input: 'j', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; nav.moveSection(1); } },
    { input: 'k', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; nav.moveSection(-1); } },
    { input: ',', handler: () => { if (subModalOpen()) return; nav.focused()?.onLeft?.(); } },
    { input: '.', handler: () => { if (subModalOpen()) return; nav.focused()?.onRight?.(); } },
    { input: KeyCommand.keyInputEnter, handler: () => { if (subModalOpen()) return; nav.focused()?.onActivate?.(); } },
    { input: ' ', handler: () => { if (subModalOpen()) return; nav.focused()?.onToggle?.(); } },
    ...scrollKeySpecs({ scrollRef, scrollYRef, guard: subModalOpen }),
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (subModalOpen()) return; // モーダル側の Esc に委ねる
        // 開いているインライン説明を先に閉じる（設定サブ画面の Esc と同じ流儀）
        if (showArchiveInfo || showSpeechInfo) { setShowArchiveInfo(false); setShowSpeechInfo(false); return; }
        if (editingRef.current) { Keyboard.dismiss(); return; }
        // 055：フォーカス（青枠）があれば先に外す
        if (nav.focusedIdRef.current !== null) { nav.setFocusedId(null); return; }
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
      // 044/045: 中身が空の土台は保存しない（名前だけ作って離脱した行が残らないように）
      const normalizedSqlStages = sqlStages.filter((s) => s.content.trim() !== '');
      const normalizedStages = htmlStages.filter((s) => s.content.trim() !== '');
      await updateDeck(db, id, { name: trimmed, description: description.trim(), language, iconName, colorHex, sqlStages: normalizedSqlStages, htmlStages: normalizedStages, htmlImages, speechLangs, speechLangsBack, speechAuto, speechDisabled });
      if (archived !== deck.archived) {
        await setDeckArchived(db, id, archived);
      }
      // 044/045: sqlInit / htmlInit は互換用ミラー。DB 側（updateDeck）と同じ値をストアにも入れて食い違わせない。
      updateStore({ ...deck, name: trimmed, description: description.trim(), language, iconName, colorHex,
        sqlInit: legacyInitMirror(normalizedSqlStages), sqlStages: normalizedSqlStages,
        htmlInit: legacyInitMirror(normalizedStages), htmlStages: normalizedStages, htmlImages, speechLangs, speechLangsBack, speechAuto, speechDisabled, archived });
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
    || JSON.stringify(sqlStages.filter((s) => s.content.trim() !== '')) !== JSON.stringify(deck.sqlStages ?? [])
    || JSON.stringify(htmlStages.filter((s) => s.content.trim() !== '')) !== JSON.stringify(deck.htmlStages ?? [])
    || JSON.stringify(htmlImages) !== JSON.stringify(deck.htmlImages ?? [])
    // ⚠️ キーの並び順は追加した順に決まるので、比較はキーを並べ替えてから行う
    //（`{han:..., latin:...}` と `{latin:..., han:...}` を「変更あり」と誤判定しないため）
    || !scriptLangsEqual(speechLangs, deck.speechLangs ?? {})
    || !scriptLangsEqual(speechLangsBack, deck.speechLangsBack ?? {})
    || speechAuto !== (deck.speechAuto ?? null)
    || speechDisabled !== deck.speechDisabled
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
          archived={archived}
        />
        <ScrollView
          ref={scrollRef}
          onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
          onLayout={nav.onViewportLayout}
          onContentSizeChange={nav.onContentSizeChange}
          scrollEventThrottle={16}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <SettingsFocusContext.Provider value={nav.registry}>
          {/* 057：見出しで「基本／読み上げ／コード実行」に区切る（タブ分けは不採用＝docs/057） */}
          <DeckFormSectionTitle title={t('deck.sectionBasic')} />
          <DeckFormCard>
            <DeckFormField label={t('deck.name')} section claim={inputFocus === 'name'} onActivate={() => nameRef.current?.focus()}>
              <TextInput
                ref={nameRef}
                style={[styles.input, { backgroundColor: theme.colors.background, borderColor: theme.colors.inputBorder, color: theme.colors.text, fontSize: theme.fontSize.lg }]}
                placeholder={t('deck.namePlaceholder')}
                placeholderTextColor={theme.colors.textTertiary}
                value={name}
                onChangeText={setName}
                maxLength={50}
                returnKeyType="next"
                onFocus={() => { editingRef.current = true; setInputFocus('name'); }}
                onBlur={() => { editingRef.current = false; setInputFocus((f) => (f === 'name' ? null : f)); }}
                onSubmitEditing={() => descRef.current?.focus()}
                autoCorrect={false}
                spellCheck={false}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              />
            </DeckFormField>
          </DeckFormCard>
          <DeckFormCard>
            <DeckFormField label={t('deck.description')} claim={inputFocus === 'desc'} onActivate={() => descRef.current?.focus()}>
              <TextInput
                ref={descRef}
                style={[styles.input, styles.multiline, { backgroundColor: theme.colors.background, borderColor: theme.colors.inputBorder, color: theme.colors.text, fontSize: theme.fontSize.lg }]}
                placeholder={t('deck.descriptionPlaceholder')}
                placeholderTextColor={theme.colors.textTertiary}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                onFocus={() => { editingRef.current = true; setInputFocus('desc'); }}
                onBlur={() => { editingRef.current = false; setInputFocus((f) => (f === 'desc' ? null : f)); }}
                autoCorrect={false}
                spellCheck={false}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              />
            </DeckFormField>
          </DeckFormCard>

          <DeckFormCard>
            <DeckFormField label={t('deck.icon')} onActivate={() => { Keyboard.dismiss(); setShowIconPicker(true); }}>
              <Pressable
                style={styles.iconButton}
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
            </DeckFormField>
            {/* カラーはアイコンの色なので同じ白枠に入れる（アイコン選択の画面に入れる案は、1タップ増えるうえ
                J/K・`,`/`.` が格子の移動と取り合うため不採用）。アイコンが無いと色はどこにも出ないので、
                未設定のあいだは淡くして注記する＝「選べるのに効いていない」を画面に出す。選ぶことはできる。 */}
            <DeckFormDivider />
            <DeckFormField
              label={t('deck.color')}
              onLeft={() => cycleColor(-1)}
              onRight={() => cycleColor(1)}
              dim={!iconName}
              note={iconName ? null : t('deck.colorNeedsIconNote')}
            >
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
            </DeckFormField>
          </DeckFormCard>

          {/* 057：アーカイブは「基本」の末尾（カード単位ではなくデッキ自体の状態＝名前・色と同じ段） */}
          <DeckFormCard>
            <DeckFormToggleRow
              label={t('deck.archive')}
              value={archived}
              onValueChange={(v) => { Keyboard.dismiss(); setArchived(v); }}
              infoLabel={t('deck.archiveInfoLabel')}
              infoText={t('deck.archiveHint')}
              showInfo={showArchiveInfo}
              onToggleInfo={() => { Keyboard.dismiss(); setShowArchiveInfo((v) => !v); }}
            />
          </DeckFormCard>

          {/* 052: このデッキで読み上げを使うか（無料・既定 ON）。OFF で学習画面のスピーカーボタン・
              S キー・自動読み上げが一括で消える。保存値は否定形 `speechDisabled`。
              ⚠️ OFF でも下の「読み上げの設定」は**隠さず淡くする**＝OFF はモードであって設定の有無ではない。
              アプリ設定で読み上げが OFF なら両方の行を淡くし、注記はそちらを優先する（CLAUDE.md の
              「オンに見えるのに効いていない状態を作らない」）。
              057：セクションの並びは 基本 → 読み上げ → コード実行（Pro だけの行を後にして、非 Pro と Pro で
              読み上げの位置が変わらないようにする）。 */}
          <DeckFormSectionTitle title={t('deck.sectionSpeech')} />
          <DeckFormCard>
            <DeckFormToggleRow
              section
              label={t('deck.speechLabel')}
              value={!speechDisabled}
              onValueChange={(v) => { Keyboard.dismiss(); setSpeechDisabled(!v); }}
              infoLabel={t('deck.speechInfoLabel')}
              infoText={t('deck.speechUseHint')}
              showInfo={showSpeechInfo}
              onToggleInfo={() => { Keyboard.dismiss(); setShowSpeechInfo((v) => !v); }}
              dim={!speechEnabled}
              note={!speechEnabled ? t('deck.speechAppOffNote') : null}
            />
            <DeckFormDivider />
            {/* 051: デッキに保存する読み上げ設定は Pro。⚠️ **行ごと隠さない**（土台の行と違う）＝
                設定済みのデッキを非 Pro が受け取ったとき、解除する手段が画面から消えるため。
                ⚠️ **適用（学習画面）には isPro を入れない**。 */}
            <DeckFormNavRow
              configured={speechConfigured}
              label={t('deck.speechSettingsLabel')}
              summary={deckSpeechSummary(speechLangs, speechLangsBack, speechAuto, t)}
              locked={!isPro}
              dim={!speechEnabled || speechDisabled}
              // 052: デッキ OFF のときだけ（アプリ OFF は上のスイッチ行の注記が担当＝二重に出さない）
              note={speechEnabled && speechDisabled ? t('deck.speechDeckOffNote') : null}
              onPress={openSpeechSettings}
            />
          </DeckFormCard>

          {/* HTML/CSS 土台を先に置く：土台を使う言語は html/css/js/ts の4つ（js/ts は無料言語）で、
              SQL ブロックだけが使う SQL 初期化より触る頻度が高いため。キー割り当て（H/Q）は
              頭文字由来なのでこの並びとは独立。 */}
          {isPro && (
            <>
              <DeckFormSectionTitle title={t('deck.sectionCode')} />
              <DeckFormCard>
                <DeckFormNavRow
                  section
                  configured={htmlConfigured}
                  label={t('deck.htmlInitLabel')}
                  // この行は土台と画像ライブラリの両方への入口なので、**中にある物をそのまま出す**。
                  // 047 Phase 0: 1文に count が2つあると複数形が効かないので、各々複数形つきで作ってから繋ぐ。
                  summary={filledStages > 0
                    ? htmlImages.length > 0
                      ? t('deck.htmlStagesAndImages', {
                        stages: t('deck.htmlStagesSet', { count: filledStages }),
                        images: t('deck.htmlImagesSet', { count: htmlImages.length }),
                      })
                      : t('deck.htmlStagesSet', { count: filledStages })
                    : htmlImages.length > 0
                      ? t('deck.htmlImagesOnly', { count: htmlImages.length })
                      : t('deck.htmlInitNone')}
                  onPress={() => { Keyboard.dismiss(); setShowHtmlInitModal(true); }}
                />
                <DeckFormDivider />
                <DeckFormNavRow
                  configured={filledSqlStages > 0}
                  label={t('deck.sqlInitLabel')}
                  summary={filledSqlStages > 0 ? t('deck.sqlStagesSet', { count: filledSqlStages }) : t('deck.sqlInitNone')}
                  onPress={() => { Keyboard.dismiss(); setShowSqlInitModal(true); }}
                />
              </DeckFormCard>
            </>
          )}
          </SettingsFocusContext.Provider>
        </ScrollView>
        <FormBottomBar onClose={handleClose} onSave={handleSave} saveDisabled={!canSave} onDelete={confirmDelete} />
        <ArchivePill archived={archivePill} />
      </View>
      <IconPickerModal
        visible={showIconPicker}
        selected={iconName}
        highlightColor={previewIconColor}
        onSelect={setIconName}
        onClose={() => setShowIconPicker(false)}
      />
      <DeckStagesModal
        visible={showSqlInitModal}
        kind="sql"
        stages={sqlStages}
        onChange={setSqlStages}
        onClose={() => setShowSqlInitModal(false)}
      />
      <DeckStagesModal
        visible={showHtmlInitModal}
        kind="html"
        stages={htmlStages}
        onChange={setHtmlStages}
        onClose={() => setShowHtmlInitModal(false)}
        listFooter={<HtmlImageLibrary images={htmlImages} onChange={setHtmlImages} />}
      />
      <ConfirmModal
        visible={showSpeechProModal}
        title={t('deck.speechSettingsTitle')}
        message={t('deck.speechProMessage')}
        actions={[
          { label: t('deck.speechProClear'), onPress: () => { setShowSpeechProModal(false); setSpeechLangs({}); setSpeechLangsBack({}); setSpeechAuto(null); } },
          { label: t('deck.speechProSeePro'), secondary: true, onPress: () => { setShowSpeechProModal(false); router.push('/paywall'); } },
        ]}
        onClose={() => setShowSpeechProModal(false)}
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={t('deck.deleteConfirm', { name: deck.name.length > 20 ? deck.name.slice(0, 20) + '…' : deck.name })}
        onConfirm={handleDeleteConfirm}
        onClose={() => setShowDeleteModal(false)}
      />
      <DeckSpeechModal
        visible={showSpeechModal}
        langs={speechLangs}
        langsBack={speechLangsBack}
        auto={speechAuto}
        onChange={setSpeechLangs}
        onChangeBack={setSpeechLangsBack}
        onChangeAuto={setSpeechAuto}
        onClose={() => setShowSpeechModal(false)}
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
  // 末尾の余白は「最下部の行で ⓘ を開いたとき、スクロールせずに説明が全部見える」ための場所
  //（057 以降、最下部の ⓘ 行は非 Pro の「読み上げ」＝Pro はコード実行のカードが下に来る）。
  // 最下部まで来ているとき説明（高さ H）は行と余白のあいだに入るので、余白 ≧ H なら
  // その場に現れる（自動スクロール不要）。140 は文字サイズ「大」で折り返した説明でも収まる高さ。
  container: { padding: 20, gap: 20, paddingBottom: 140 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multiline: { height: 90, textAlignVertical: 'top' },
  // 白枠の中なので枠は付けない（入力欄ではなく、開くだけの行＝右の ＞ で示す）
  iconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
});

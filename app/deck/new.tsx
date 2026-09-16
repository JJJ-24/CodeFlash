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
  View,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { useTheme, MAX_FONT_MULTIPLIER, DECK_PRESET_COLORS, PRIMARY_COLOR } from '@/lib/theme';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { DECK_THEME_COLOR, resolveDeckIconColors } from '@/lib/deckIconColors';
import { AppSwitch } from '@/components/AppSwitch';
import { InfoContent } from '@/components/InfoContent';
import { ConfirmModal } from '@/components/ConfirmModal';
import { DiscardConfirmModal } from '@/components/DiscardConfirmModal';
import { FormBottomBar } from '@/components/FormBottomBar';
import { ModalFormHeader } from '@/components/ModalFormHeader';
import { IconPickerModal } from '@/components/IconPickerModal';
import { DeckSpeechModal, deckSpeechSummary } from '@/components/deck/DeckSpeechModal';
import { DeckStagesModal } from '@/components/deck/DeckStagesModal';
import { HtmlImageLibrary } from '@/components/deck/HtmlImageLibrary';
import type { DeckIconName } from '@/lib/deckIcons';
import type { ScriptLangs } from '@/lib/speech';
import type { DeckImage, DeckStage } from '@/types';
import { createDeck } from '@/lib/database/decks';
import { useDismissKeyboardOnLeave } from '@/hooks/useDismissKeyboardOnLeave';
import { scrollKeySpecs, useKeyCommands, useShortcutsToggleKeys } from '@/lib/useKeyCommands';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useDeckStore } from '@/store/decks';
import { usePendingFocusStore } from '@/store/pendingFocus';
import { useProStore } from '@/store/pro';
import { useSettingsStore } from '@/store/settings';

const DECK_NEW_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: 'U / D', descKey: 'shortcut.scrollUpDown' },
    { key: '⇧U / ⇧D', descKey: 'shortcut.scrollTopBottom' },
  ] },
  { titleKey: 'shortcut.catAction', items: [
    { key: 'N', descKey: 'shortcut.focusDeckName' },
    { key: 'M', descKey: 'shortcut.focusDeckDesc' },
    { key: 'C / ⇧C', descKey: 'shortcut.cycleColor' },
    { key: 'I', descKey: 'shortcut.pickIcon' },
    // 並びは画面の行順（読み上げ → 読み上げの言語 → HTML/CSS 土台 → SQL 初期化）に合わせる。
    // 読み上げは無料機能なので pro フラグを付けない
    { key: '⇧R', descKey: 'shortcut.toggleDeckSpeech' },
    { key: 'R', descKey: 'shortcut.deckSpeechLangs' },
    { key: 'H', descKey: 'shortcut.htmlInit', pro: true },
    { key: 'Q', descKey: 'shortcut.sqlInit', pro: true },
    { key: 'S', descKey: 'shortcut.save' },
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

export default function NewDeckScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  useRestoreStatusBar();
  const { addDeck } = useDeckStore();
  const setPendingFocus = usePendingFocusStore((s) => s.setPendingFocus);
  const isPro = useProStore((s) => s.isPro);
  const { keyboardShortcutsEnabled, speechEnabled } = useSettingsStore();
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  useDismissKeyboardOnLeave();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [iconName, setIconName] = useState<DeckIconName | null>(null);
  const [colorHex, setColorHex] = useState<string | null>(PRIMARY_COLOR);
  // 045: 名前付き初期化SQLのリスト（044 の htmlStages と同じ持ち方）
  const [sqlStages, setSqlStages] = useState<DeckStage[]>([]);
  const [showSqlInitModal, setShowSqlInitModal] = useState(false);
  // 044: 名前付き土台のリスト（作成時はまだ DB に無いのでローカル state のみ）
  const [htmlStages, setHtmlStages] = useState<DeckStage[]>([]);
  // 043: HTML 画像ライブラリ。土台と同じくライブ編集し、確定は画面の保存で行う。
  const [htmlImages, setHtmlImages] = useState<DeckImage[]>([]);
  const [showHtmlInitModal, setShowHtmlInitModal] = useState(false);
  // 043: 行の「設定済み」表示は土台テキストと画像ライブラリのどちらかがあれば点灯させる
  // （行が両方への入口なので、画像だけ登録した状態を「未設定」と見せないため）。
  const filledStages = htmlStages.filter((s) => s.content.trim() !== '').length;
  const htmlConfigured = filledStages > 0 || htmlImages.length > 0;
  const filledSqlStages = sqlStages.filter((s) => s.content.trim() !== '').length;
  // 050 Phase 2: このデッキだけの読み上げ言語（文字体系 → 言語の上書き。未設定は {}）
  const [speechLangs, setSpeechLangs] = useState<ScriptLangs>({});
  // 051: 裏面用の上書き（空 = 表面と同じ）
  const [speechLangsBack, setSpeechLangsBack] = useState<ScriptLangs>({});
  const [showSpeechModal, setShowSpeechModal] = useState(false);
  // 051: 非 Pro が設定済みデッキを開いたときの案内（解除だけは通す）
  const [showSpeechProModal, setShowSpeechProModal] = useState(false);
  const speechConfigured = Object.keys(speechLangs).length > 0 || Object.keys(speechLangsBack).length > 0;
  // 052: このデッキで読み上げを使うか（無料・既定 ON）。保存値は否定形＝トグルの value は `!speechDisabled`
  const [speechDisabled, setSpeechDisabled] = useState(false);
  // 読み上げの説明（ⓘ タップで行の下にインライン展開する。編集画面のアーカイブ行と同じ形）
  const [showSpeechInfo, setShowSpeechInfo] = useState(false);

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
        // 044/045: 中身が空の土台は保存しない（名前だけ作って離脱した行が残らないように）
        sqlStages: sqlStages.filter((s) => s.content.trim() !== ''),
        htmlStages: htmlStages.filter((s) => s.content.trim() !== ''),
        htmlImages,
        speechLangs,
        speechLangsBack,
        speechDisabled,
      });
      addDeck(deck);
      // 一覧へ戻ったとき、作成したデッキへフォーカスを移す
      setPendingFocus('deck', deck.id);
      router.back();
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!name.trim() && !saving;
  const isDirty = name.trim() !== '' || description.trim() !== '' || iconName !== null || colorHex !== PRIMARY_COLOR || filledSqlStages > 0 || filledStages > 0 || htmlImages.length > 0 || speechConfigured || speechDisabled;
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

  // ハードキーボードのショートカット（034 / ネイティブ UIKeyCommand）。
  // 文字キーはテキスト欄フォーカス中は入力欄が消費するため、非編集時のみ発火する（住み分け）。
  // Tab/矢印は iPad のフォーカスエンジン対策で使わず、N/E でフィールドへ直接カーソルを移す。
  // サブモーダル（アイコン/SQL/破棄確認）は RN Modal。開いている間はそのモーダル側が
  // キーを処理するため、親画面のショートカットは無効化する（キーコマンドは AppDelegate に
  // 付くため開いていても発火しうる＝明示ガードが必要）。

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

  const subModalOpen = () => showIconPicker || showSqlInitModal || showHtmlInitModal || showSpeechModal || showSpeechProModal || showDiscardModal || showShortcutsModal;
  useKeyCommands([
    { input: 'n', handler: () => { if (subModalOpen()) return; nameRef.current?.focus(); } },
    { input: 'm', handler: () => { if (subModalOpen()) return; descRef.current?.focus(); } },
    { input: 's', handler: () => { if (subModalOpen()) return; if (canSave) handleCreate(); } },
    { input: 's', modifierFlags: KeyCommand.keyModifierCommand, handler: () => { if (subModalOpen()) return; if (canSave) handleCreate(); } },
    { input: 'x', handler: () => { if (subModalOpen()) return; handleClose(); } },
    { input: 'c', handler: () => { if (subModalOpen()) return; cycleColor(); } },
    { input: 'c', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; cycleColor(-1); } },
    { input: 'i', handler: () => { if (subModalOpen()) return; Keyboard.dismiss(); setShowIconPicker(true); } },
    { input: 'q', handler: () => { if (subModalOpen()) return; if (isPro) { Keyboard.dismiss(); setShowSqlInitModal(true); } } },
    { input: 'h', handler: () => { if (subModalOpen()) return; if (isPro) { Keyboard.dismiss(); setShowHtmlInitModal(true); } } },
    // 050 Phase 2: 読み上げ（Read）。⚠️ Pro ゲートは無い（読み上げは無料機能）
    { input: 'r', handler: () => { if (subModalOpen()) return; openSpeechSettings(); } },
    // 052: ⇧R = このデッキの読み上げ ON/OFF（R＝読み上げの設定を開く、の Shift 版）
    { input: 'r', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (subModalOpen()) return; Keyboard.dismiss(); setSpeechDisabled((v) => !v); } },
    // 画面スクロール（U/D＝段階、PgUp/PgDn＝同、Home/End＝最上部/最下部、⇧U/⇧D＝端）。
    ...scrollKeySpecs({ scrollRef, scrollYRef, guard: subModalOpen }),
    // ショートカット一覧（OK のみ）表示中は Return=OK で閉じる。
    { input: KeyCommand.keyInputEnter, handler: () => { if (showShortcutsModal) setShowShortcutsModal(false); } },
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showShortcutsModal) { setShowShortcutsModal(false); return; } // ショートカット一覧を閉じる
        if (subModalOpen()) return; // 他モーダル側の Esc に委ねる
        // 開いているインライン説明を先に閉じる（設定サブ画面の Esc と同じ流儀）
        if (showSpeechInfo) { setShowSpeechInfo(false); return; }
        // 編集中は Esc でカーソル解除のみ。非編集なら閉じる（変更あれば破棄確認）。
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
          title={t('deck.new')}
          onClose={handleClose}
          onSave={handleCreate}
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

          {/* 052: このデッキで読み上げを使うか（無料・既定 ON）。編集画面と同じ行（説明と並び順の理由はそちらのコメント）。 */}
          <View style={styles.field}>
            <View style={[styles.toggleCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }, !speechEnabled && styles.inactive]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600', flexShrink: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {t('deck.speechLabel')}
                  </Text>
                  <Pressable onPress={() => { Keyboard.dismiss(); setShowSpeechInfo((v) => !v); }} hitSlop={8} accessibilityLabel={t('deck.speechInfoLabel')}>
                    <Ionicons
                      name={showSpeechInfo ? 'information-circle' : 'information-circle-outline'}
                      size={Math.max(theme.fontSize.lg, 20)}
                      color={theme.colors.textTertiary}
                    />
                  </Pressable>
                </View>
                <AppSwitch
                  value={!speechDisabled}
                  onValueChange={(v) => { Keyboard.dismiss(); setSpeechDisabled(!v); }}
                  thumbColor="#FFF"
                />
              </View>
              {showSpeechInfo && (
                <View style={[styles.toggleInfoBox, { backgroundColor: theme.colors.background }]}>
                  <InfoContent text={t('deck.speechUseHint')} />
                </View>
              )}
            </View>
            {!speechEnabled && (
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('deck.speechAppOffNote')}
              </Text>
            )}
          </View>

          {/* 051: デッキに保存する読み上げ設定は Pro。⚠️ **行ごと隠さない**（土台の行と違う）＝
              設定済みのデッキを非 Pro が受け取ったとき、解除する手段が画面から消えるため。
              ⚠️ **適用（学習画面）には isPro を入れない**＝読み上げ自体は無料機能で、
              止めても守られる Pro 機能が無く、配布デッキが作者の意図と違う言語で読まれるだけ。 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('deck.speechLangsLabel')}
            </Text>
            <Pressable
              style={[styles.iconButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }, (!speechEnabled || speechDisabled) && styles.inactive]}
              onPress={openSpeechSettings}
            >
              <View style={[styles.iconCircle, { backgroundColor: speechConfigured ? theme.colors.primaryLight : theme.colors.background }]}>
                <Ionicons name={speechConfigured ? 'volume-high' : 'volume-high-outline'} size={20} color={speechConfigured ? theme.colors.primary : theme.colors.textSecondary} />
              </View>
              <Text style={{ color: speechConfigured ? theme.colors.text : theme.colors.textSecondary, fontSize: theme.fontSize.md, flex: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {deckSpeechSummary(speechLangs, speechLangsBack, t)}
              </Text>
              {!isPro && <Ionicons name="lock-closed" size={theme.fontSize.sm} color={theme.colors.primary} />}
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
            </Pressable>
            {/* 052: デッキ OFF のときだけ（アプリ OFF は上のトグル行の注記が担当＝二重に出さない） */}
            {speechEnabled && speechDisabled && (
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('deck.speechDeckOffNote')}
              </Text>
            )}
          </View>

          {/* HTML/CSS 土台を先に置く：土台を使う言語は html/css/js/ts の4つ（js/ts は無料言語）で、
              SQL ブロックだけが使う SQL 初期化より触る頻度が高いため。キー割り当て（H/Q）は
              頭文字由来なのでこの並びとは独立。 */}
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
                  {/* この行は土台と画像ライブラリの両方への入口なので、**中にある物をそのまま出す**。
                      「設定済み」の一語だと中身が分からず、土台0件で開くと空の一覧が出て矛盾に見えた。 */}
                  {filledStages > 0
                    ? htmlImages.length > 0
                      // 047 Phase 0: 1文に count が2つあると複数形が効かないので、
                      //   「土台 N件」「画像 N枚」を各々複数形つきで作ってから繋ぐ
                      //   （繋ぎ方（区切り文字）も言語で変わるので翻訳キーに残す）。
                      ? t('deck.htmlStagesAndImages', {
                        stages: t('deck.htmlStagesSet', { count: filledStages }),
                        images: t('deck.htmlImagesSet', { count: htmlImages.length }),
                      })
                      : t('deck.htmlStagesSet', { count: filledStages })
                    : htmlImages.length > 0
                      ? t('deck.htmlImagesOnly', { count: htmlImages.length })
                      : t('deck.htmlInitNone')}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          )}

          {isPro && (
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('deck.sqlInitLabel')}
              </Text>
              <Pressable
                style={[styles.iconButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }]}
                onPress={() => { Keyboard.dismiss(); setShowSqlInitModal(true); }}
              >
                <View style={[styles.iconCircle, { backgroundColor: filledSqlStages > 0 ? theme.colors.primaryLight : theme.colors.background }]}>
                  <Ionicons name={filledSqlStages > 0 ? 'server' : 'server-outline'} size={20} color={filledSqlStages > 0 ? theme.colors.primary : theme.colors.textSecondary} />
                </View>
                <Text style={{ color: filledSqlStages > 0 ? theme.colors.text : theme.colors.textSecondary, fontSize: theme.fontSize.md, flex: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {filledSqlStages > 0 ? t('deck.sqlStagesSet', { count: filledSqlStages }) : t('deck.sqlInitNone')}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          )}

        </ScrollView>
        <FormBottomBar onSave={handleCreate} saveDisabled={!canSave} />
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
      <DeckSpeechModal
        visible={showSpeechModal}
        langs={speechLangs}
        langsBack={speechLangsBack}
        onChange={setSpeechLangs}
        onChangeBack={setSpeechLangsBack}
        onClose={() => setShowSpeechModal(false)}
      />
      <ConfirmModal
        visible={showSpeechProModal}
        title={t('deck.speechLangsTitle')}
        message={t('deck.speechProMessage')}
        actions={[
          { label: t('deck.speechProClear'), onPress: () => { setShowSpeechProModal(false); setSpeechLangs({}); setSpeechLangsBack({}); } },
          { label: t('deck.speechProSeePro'), secondary: true, onPress: () => { setShowSpeechProModal(false); router.push('/paywall'); } },
        ]}
        onClose={() => setShowSpeechProModal(false)}
      />
      <DiscardConfirmModal
        visible={showDiscardModal}
        canSave={canSave}
        onSave={() => { setShowDiscardModal(false); handleCreate(); }}
        onDiscard={() => { setShowDiscardModal(false); router.back(); }}
        onClose={() => setShowDiscardModal(false)}
      />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        sections={DECK_NEW_SHORTCUT_SECTIONS.map((s) => ({ title: t(s.titleKey), items: s.items }))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 末尾の余白は編集画面と同じ量にする。新規作成にはアーカイブ行（＝ⓘ を開くための余白が
  // 要る行）が無いので機能的には不要だが、**双子の画面で末尾の見え方を変えない**ため揃える
  // （カードは new/edit で `BlockEditor` を共有していて、同じ理由で新規にも余白が付く）。
  container: { padding: 20, gap: 20, paddingBottom: 140 },
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
  // 052: トグル行の白枠（編集画面の archiveCard / archiveRow と同じ寸法）
  toggleCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // ⓘ タップで開くインライン説明（編集画面の archiveInfoBox と同じ見せ方）
  toggleInfoBox: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  // 052: 効かない状態（アプリ設定 OFF／デッキ OFF）を淡く見せる（一覧のアーカイブ済みと同じ 0.55）
  inactive: { opacity: 0.55 },
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

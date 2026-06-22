import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { IconPickerModal } from '@/components/IconPickerModal';
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
  TouchableOpacity,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

import { useTheme, MAX_FONT_MULTIPLIER, DECK_PRESET_COLORS } from '@/lib/theme';
import { DECK_THEME_COLOR, resolveDeckIconColors } from '@/lib/deckIconColors';
import type { DeckIconName } from '@/lib/deckIcons';
import { deleteDeck, setDeckArchived, updateDeck } from '@/lib/database/decks';
import { useDismissKeyboardOnLeave } from '@/hooks/useDismissKeyboardOnLeave';
import { useDeckStore } from '@/store/decks';
import { useProStore } from '@/store/pro';

export default function EditDeckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { decks, updateDeck: updateStore, removeDeck } = useDeckStore();
  const isPro = useProStore((s) => s.isPro);
  useDismissKeyboardOnLeave();

  const deck = decks.find((d) => d.id === id);

  const [name, setName] = useState(deck?.name ?? '');
  const [description, setDescription] = useState(deck?.description ?? '');
  const [iconName, setIconName] = useState<DeckIconName | null>((deck?.iconName as DeckIconName | null) ?? null);
  const [colorHex, setColorHex] = useState<string | null>(deck?.colorHex ?? null);
  const [sqlInit, setSqlInit] = useState(deck?.sqlInit ?? '');
  const [showSqlInitModal, setShowSqlInitModal] = useState(false);
  const [archived, setArchived] = useState<boolean>(deck?.archived ?? false);
  const language = (deck?.language as 'ja' | 'en') ?? 'ja';
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || !deck) return;
    setSaving(true);
    try {
      const normalizedSqlInit = sqlInit.trim() || null;
      await updateDeck(db, id, { name: trimmed, description: description.trim(), language, iconName, colorHex, sqlInit: normalizedSqlInit });
      if (archived !== deck.archived) {
        await setDeckArchived(db, id, archived);
      }
      updateStore({ ...deck, name: trimmed, description: description.trim(), language, iconName, colorHex, sqlInit: normalizedSqlInit, archived });
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
      <Stack.Screen
        options={{

          headerTitle: () => <Text style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('deck.edit')}</Text>,
          headerLeft: () => (
            <Pressable onPress={handleClose} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="close" size={26} color={theme.colors.textSecondary} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={handleSave} disabled={!canSave} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="checkmark-sharp" size={26} color={canSave ? theme.colors.primary : theme.colors.textTertiary} />
            </Pressable>
          ),
        }}
      />
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('deck.name')}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder, color: theme.colors.text, fontSize: theme.fontSize.lg }]}
              placeholder={t('deck.namePlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={50}
              returnKeyType="next"
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
              style={[styles.input, styles.multiline, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder, color: theme.colors.text, fontSize: theme.fontSize.lg }]}
              placeholder={t('deck.descriptionPlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
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
              // iPad: 横一連に全色 + テーマカラー + 末尾に ✕
              <View style={styles.colorGrid}>
                {DECK_PRESET_COLORS.map(colorSwatch)}
                {themeSwatch}
                {clearSwatch}
              </View>
            ) : (
              // iPhone: 1行目=7色 / 2行目=残り5色 + テーマカラー + 末尾に ✕
              <View style={{ gap: 10 }}>
                <View style={styles.colorGrid}>{DECK_PRESET_COLORS.slice(0, 7).map(colorSwatch)}</View>
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
        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.danger }]} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={26} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, !canSave && styles.actionBtnDisabled]} onPress={handleSave} disabled={!canSave}>
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
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={t('deck.deleteConfirm', { name: deck.name.length > 20 ? deck.name.slice(0, 20) + '…' : deck.name })}
        onConfirm={handleDeleteConfirm}
        onClose={() => setShowDeleteModal(false)}
      />
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
    gap: 10,
  },
  colorCell: {
    width: 36,
    height: 36,
    borderRadius: 18,
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

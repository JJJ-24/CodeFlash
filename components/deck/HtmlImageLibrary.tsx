import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { InfoModal } from '@/components/InfoModal';
import { buildImageTag, invalidateHtmlImageCache, isValidImageName } from '@/lib/htmlImages';
import {
  IMAGE_LIBRARY_MAX_DIMENSION,
  IMAGE_LIBRARY_WARN_BYTES,
  pickAndSaveImage,
  resolveImageUri,
} from '@/lib/image';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import type { DeckImage } from '@/types';

interface Props {
  images: DeckImage[];
  onChange: (images: DeckImage[]) => void;
}

/** `img1`, `img2`… のうち未使用の最小番号を既定名にする。 */
function nextDefaultName(images: DeckImage[]): string {
  const used = new Set(images.map((i) => i.name));
  for (let n = 1; ; n++) {
    const candidate = `img${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * 043: デッキの HTML 画像ライブラリ。**土台一覧（`DeckStagesModal`）の `listFooter`** に差し込む。
 *
 * 画像はデッキ単位のデータなので、デッキ単位の画面（土台一覧）が置き場所。土台1件の編集面には
 * 置かない（理由は `DeckStagesModal` の `listFooter` の項）。縦の場所を奪いすぎないよう、
 * リストは高さ上限つきで、説明は ⓘ で開閉する。
 *
 * 画像の実体は追加した時点で `images/` に保存される（＝デッキ保存をキャンセルしても残る）が、
 * `decks.htmlImages` に入らなければ起動時の孤児掃除が回収するので、画像ブロックと同じ挙動になる。
 * 削除も**配列から外すだけ**でファイルは消さない（保存前にキャンセルされたら参照が生き残るため）。
 */
export function HtmlImageLibrary({ images, onChange }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  // 初期状態は「画像があるときだけ展開」。デッキ編集の行が「画像 N枚」と出しているので、
  // 開いた先でその N 枚がすぐ見えるほうが自然につながる（登録済みの画像に気づけない、という
  // 報告が実際にあった）。空のときは畳んでおく＝空セクションを開いておく意味がないため。
  // 見出しの ＋ は畳んだ状態でも見えるので、追加したいときの発見性は保たれる。
  const [expanded, setExpanded] = useState(images.length > 0);
  const [picking, setPicking] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeckImage | null>(null);
  const [sizeErrorVisible, setSizeErrorVisible] = useState(false);
  const [warnVisible, setWarnVisible] = useState(false);
  // 名前の編集中テキスト（key: uri）。不正な間は配列へ書かず、blur で確定 or 破棄する。
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  async function handleAdd() {
    Keyboard.dismiss();
    setPicking(true);
    try {
      const result = await pickAndSaveImage({ maxDimension: IMAGE_LIBRARY_MAX_DIMENSION });
      if (!result) return;
      if ('error' in result) {
        setSizeErrorVisible(true);
        return;
      }
      onChange([...images, { name: nextDefaultName(images), uri: result.uri }]);
      setExpanded(true);
      if (result.bytes > IMAGE_LIBRARY_WARN_BYTES) setWarnVisible(true);
    } finally {
      setPicking(false);
    }
  }

  async function handleCopy(image: DeckImage) {
    await Clipboard.setStringAsync(buildImageTag(image.name));
    setCopiedName(image.name);
    setTimeout(() => setCopiedName(null), 1000);
  }

  function handleDelete(image: DeckImage) {
    // 参照解決のキャッシュに残ったままだと、同名で登録し直したときに古い絵が出る
    invalidateHtmlImageCache(image.uri);
    onChange(images.filter((i) => i.uri !== image.uri));
    setPendingDelete(null);
  }

  /** 編集中の名前が確定できるか（形式が正しく、他と重複しない）。 */
  function isDraftValid(image: DeckImage, draft: string): boolean {
    if (!isValidImageName(draft)) return false;
    return !images.some((i) => i.uri !== image.uri && i.name === draft);
  }

  function commitName(image: DeckImage) {
    const draft = nameDrafts[image.uri];
    setNameDrafts((prev) => {
      const next = { ...prev };
      delete next[image.uri];
      return next;
    });
    if (draft === undefined || draft === image.name) return;
    if (!isDraftValid(image, draft)) return; // 不正ならそのまま破棄＝元の名前に戻る
    onChange(images.map((i) => (i.uri === image.uri ? { ...i, name: draft } : i)));
  }

  return (
    <View style={[styles.container, { borderTopColor: theme.colors.border }]}>
      <Pressable style={styles.header} onPress={() => setExpanded((v) => !v)}>
        <Ionicons
          name={images.length > 0 ? 'images' : 'images-outline'}
          size={18}
          color={images.length > 0 ? theme.colors.primary : theme.colors.textSecondary}
        />
        <Text
          style={[styles.headerLabel, { color: theme.colors.text, fontSize: theme.fontSize.sm }]}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
        >
          {t('deck.htmlImagesLabel')}
          {images.length > 0 ? ` (${images.length})` : ''}
        </Text>
        {/* 説明は ⓘ で開閉（既定は閉じる）。開閉は expanded とは独立＝畳んだままでも読める。
            見出しのすぐ右に置くため、ラベルは flex を持たせず、この後ろに伸縮スペーサーを入れる。 */}
        <Pressable onPress={() => setShowInfo((v) => !v)} hitSlop={8}>
          <Ionicons
            name={showInfo ? 'information-circle' : 'information-circle-outline'}
            size={Math.max(theme.fontSize.lg, 20)}
            color={theme.colors.textTertiary}
          />
        </Pressable>
        <View style={styles.headerSpacer} />
        <Pressable onPress={handleAdd} hitSlop={8} disabled={picking} style={styles.addBtn}>
          {picking ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Ionicons name="add-circle-outline" size={24} color={theme.colors.primary} />
          )}
        </Pressable>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.colors.textSecondary}
        />
      </Pressable>

      {showInfo && (
        <View style={[styles.infoBox, { backgroundColor: theme.colors.background }]}>
          <Text
            style={[styles.hint, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
          >
            {t('deck.htmlImagesHint')}
          </Text>
        </View>
      )}

      {expanded && (
        <>
          {images.length === 0 ? (
            <Text
              style={[styles.empty, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t('deck.htmlImagesEmpty')}
            </Text>
          ) : (
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {images.map((image) => {
                const draft = nameDrafts[image.uri];
                const invalid = draft !== undefined && !isDraftValid(image, draft);
                return (
                  <View key={image.uri} style={styles.row}>
                    <Image
                      source={{ uri: resolveImageUri(image.uri) }}
                      style={[styles.thumb, { backgroundColor: theme.colors.background }]}
                      contentFit="cover"
                    />
                    <TextInput
                      style={[
                        styles.nameInput,
                        {
                          backgroundColor: theme.colors.background,
                          borderColor: invalid ? theme.colors.danger : theme.colors.inputBorder,
                          color: theme.colors.text,
                          fontSize: theme.fontSize.sm,
                        },
                      ]}
                      value={draft ?? image.name}
                      onChangeText={(v) => setNameDrafts((prev) => ({ ...prev, [image.uri]: v }))}
                      onBlur={() => commitName(image)}
                      onSubmitEditing={() => commitName(image)}
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      returnKeyType="done"
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                    />
                    <Pressable onPress={() => handleCopy(image)} hitSlop={6} style={styles.rowBtn}>
                      <Ionicons
                        name={copiedName === image.name ? 'checkmark-sharp' : 'copy-outline'}
                        size={20}
                        color={theme.colors.textSecondary}
                      />
                    </Pressable>
                    <Pressable onPress={() => setPendingDelete(image)} hitSlop={6} style={styles.rowBtn}>
                      <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </>
      )}

      <ConfirmDeleteModal
        visible={pendingDelete !== null}
        message={t('deck.htmlImagesDeleteConfirm', { name: pendingDelete?.name ?? '' })}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
        onClose={() => setPendingDelete(null)}
      />
      <InfoModal
        visible={sizeErrorVisible}
        title={t('card.imageSizeErrorTitle')}
        message={t('card.imageSizeError')}
        onClose={() => setSizeErrorVisible(false)}
      />
      <InfoModal
        visible={warnVisible}
        title={t('deck.htmlImagesLargeTitle')}
        message={t('deck.htmlImagesLargeMessage')}
        onClose={() => setWarnVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderTopWidth: 1, marginTop: 10, paddingTop: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  // ⓘ を見出しのすぐ右に置くため flex を持たせない（伸縮は headerSpacer が担う）
  headerLabel: { fontWeight: '600', flexShrink: 1 },
  headerSpacer: { flex: 1 },
  addBtn: { paddingHorizontal: 2 },
  // 説明ボックス（設定画面の syncInfoBox と同じ見た目）
  infoBox: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  hint: { lineHeight: 16 },
  empty: { paddingVertical: 10, textAlign: 'center' },
  // 高さ上限を設けて、開いてもテキスト入力欄を潰さないようにする
  list: { maxHeight: 168 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  thumb: { width: 40, height: 40, borderRadius: 6 },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontFamily: 'monospace',
  },
  rowBtn: { padding: 4 },
});

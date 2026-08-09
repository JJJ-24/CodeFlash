import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { constants as KeyCommand } from 'react-native-key-command';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { SqlInitModal } from '@/components/SqlInitModal';
import { generateId } from '@/lib/database/utils';
import { DECK_STAGE_KEYS, type DeckStageKind } from '@/lib/deckStageLabels';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';
import type { DeckStage } from '@/types';

interface Props {
  visible: boolean;
  stages: DeckStage[];
  onChange: (stages: DeckStage[]) => void;
  onClose: () => void;
  /** 何の土台の一覧か（044: HTML/CSS 土台 ／ 045: SQL 初期化）。文言だけが変わる */
  kind: DeckStageKind;
  /** 編集面の入力欄の下に差し込む追加UI（HTML では 043 の画像ライブラリ）。
   *  デッキ単位のデータなので、どの土台を編集していても同じものが出る */
  editorFooter?: React.ReactNode;
}

/**
 * 044/045: デッキの土台の一覧モーダル。**HTML/CSS 土台と SQL 初期化で共用**する
 * （持ち方も操作も同じで、違うのは `kind` で切り替わる文言と編集面の footer だけ）。
 * デッキ編集/新規作成の該当行と `H`（HTML）/`Q`（SQL）キーから開く。
 * 行をタップすると `SqlInitModal`（テキスト編集面）が上に開く2段構成。
 *
 * **名前の編集は編集面のヘッダーで行う**（リストに入力欄を置くとリスト側にもキーボード追従の
 * 面倒を持ち込むため）。一覧は「見て・選んで・消す」だけに絞ってある。
 *
 * 先頭の土台には「既定」バッジを出す。ブロックが土台を選んでいない（`deckStageId` 未指定）
 * ときに使われるのが先頭だからで、**先頭を削除すると既定が次の土台にずれる**ため削除確認の
 * 文言も分けている。
 */
export function DeckStagesModal({ visible, stages, onChange, onClose, kind, editorFooter }: Props) {
  const keys = DECK_STAGE_KEYS[kind];
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: winHeight } = useWindowDimensions();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeckStage | null>(null);

  const editingIndex = stages.findIndex((s) => s.id === editingId);
  const editingStage = editingIndex >= 0 ? stages[editingIndex] : null;

  /** 名前は空を許容するので、表示は「土台N」/「初期化N」で埋める（旧列から合成した土台も名前が空）。 */
  function displayName(stage: DeckStage, index: number): string {
    return stage.name.trim() || t(keys.defaultName, { n: index + 1 });
  }

  /** 一覧に出す1行プレビュー（最初の非空行）。土台の中身を開かずに見分けるためのもの。 */
  function previewLine(stage: DeckStage): string {
    const line = stage.content.split('\n').find((l) => l.trim() !== '');
    return line ? line.trim() : '';
  }

  function handleAdd() {
    const stage: DeckStage = { id: generateId(), name: '', content: '' };
    onChange([...stages, stage]);
    // 追加した直後は中身が空＝一覧に戻す意味がないので、そのまま編集面を開く
    setEditingId(stage.id);
  }

  function handleDelete(stage: DeckStage) {
    onChange(stages.filter((s) => s.id !== stage.id));
    setPendingDelete(null);
  }

  function updateStage(id: string, patch: Partial<DeckStage>) {
    onChange(stages.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  // Esc は階層ディスマス（削除確認 → 編集面は自前の Esc に委譲 → 一覧を閉じる）。
  // 親のデッキ編集画面は subModalOpen() でキーを止めているので、ここが最上位になる。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (!visible) return;
        if (pendingDelete) { setPendingDelete(null); return; }
        if (editingId) return; // SqlInitModal 側の Esc が閉じる
        onClose();
      },
    },
  ]);

  // デッキ編集画面の保存ボタンが下にのぞくため、シートをその分だけ持ち上げる（SqlInitModal と同じ）。
  const sheetLift = Math.max(insets.bottom, 16) + 76;
  const sheetMaxHeight = winHeight - sheetLift - insets.top - 96;

  const deleteMessage = (() => {
    if (!pendingDelete) return '';
    const index = stages.findIndex((s) => s.id === pendingDelete.id);
    const name = displayName(pendingDelete, index < 0 ? 0 : index);
    // 先頭を消すと「既定」が次の土台にずれる＝土台を選んでいないカードの見え方が変わる。
    // 残りが無いなら単に土台なしになるので通常文言でよい。
    return index === 0 && stages.length > 1
      ? t(keys.deleteFirstConfirm, { name })
      : t(keys.deleteConfirm, { name });
  })();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.closeArea} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface, marginBottom: sheetLift, maxHeight: sheetMaxHeight }]}>
            <View style={styles.header}>
              <Text
                style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {t(keys.title)}
              </Text>
              <View style={styles.headerRight}>
                <Pressable onPress={handleAdd} hitSlop={8} style={styles.headerBtn}>
                  <Ionicons name="add-circle-outline" size={26} color={theme.colors.primary} />
                </Pressable>
                <Pressable onPress={onClose} hitSlop={8} style={styles.headerBtn}>
                  <Ionicons name="checkmark-sharp" size={26} color={theme.colors.primary} />
                </Pressable>
              </View>
            </View>

            <Text
              style={[styles.hint, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t(keys.listHint)}
            </Text>

            {stages.length === 0 ? (
              <Text
                style={[styles.empty, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {t(keys.listEmpty)}
              </Text>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled">
                {stages.map((stage, index) => {
                  const preview = previewLine(stage);
                  return (
                    <View
                      key={stage.id}
                      style={[styles.row, { backgroundColor: theme.colors.background, borderColor: theme.colors.inputBorder }]}
                    >
                      <Pressable style={styles.rowMain} onPress={() => setEditingId(stage.id)}>
                        <View style={styles.rowTitleLine}>
                          <Text
                            style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}
                            numberOfLines={1}
                            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                          >
                            {displayName(stage, index)}
                          </Text>
                          {index === 0 && (
                            <View style={[styles.badge, { backgroundColor: theme.colors.primaryLight }]}>
                              <Text
                                style={{ color: theme.colors.primary, fontSize: theme.fontSize.xs, fontWeight: '700' }}
                                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                              >
                                {t('deck.stageDefaultBadge')}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text
                          style={[styles.preview, { color: preview ? theme.colors.textSecondary : theme.colors.textTertiary, fontSize: theme.fontSize.xs }]}
                          numberOfLines={1}
                          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                        >
                          {preview || t('deck.stageEmptyBody')}
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => setPendingDelete(stage)} hitSlop={6} style={styles.rowBtn}>
                        <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                      </Pressable>
                      <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                    </View>
                  );
                })}
              </ScrollView>
            )}
        </View>

        {/* ⚠️ 下の2つは**この Modal の中**に置くこと（兄弟にしてはいけない）。
            iOS は「すでに modal を提示している VC」からもう1枚を提示できず、兄弟に置くと
            2枚目の presentation が黙って失敗する（編集面も削除確認も開かないうえ、提示状態が
            固着して閉じた後もデッキ編集画面がタップを受け付けなくなる）。
            入れ子なら一覧シートの VC から提示されるので正しく重なる（043 の HtmlImageLibrary が
            SqlInitModal の中に確認モーダルを持っているのと同じ形）。 */}

        {/* 土台1つ分のテキスト編集面。名前もここで編集する（タイトルが入力欄になる） */}
        <SqlInitModal
          visible={editingStage !== null}
          value={editingStage?.content ?? ''}
          onChangeText={(v) => editingStage && updateStage(editingStage.id, { content: v })}
          onClose={() => setEditingId(null)}
          title={editingStage?.name ?? ''}
          onTitleChange={(v) => editingStage && updateStage(editingStage.id, { name: v })}
          titlePlaceholder={editingStage ? t(keys.defaultName, { n: editingIndex + 1 }) : undefined}
          hint={t(keys.editorHint)}
          placeholder={t(keys.editorPlaceholder)}
          footer={editorFooter}
        />

        <ConfirmDeleteModal
          visible={pendingDelete !== null}
          message={deleteMessage}
          onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  closeArea: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
  title: { fontWeight: '700', flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerBtn: { paddingHorizontal: 4 },
  hint: { marginBottom: 12, lineHeight: 20 },
  empty: { paddingVertical: 24, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  preview: { fontFamily: 'monospace' },
  rowBtn: { padding: 4 },
});

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { constants as KeyCommand } from 'react-native-key-command';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { SqlInitModal } from '@/components/SqlInitModal';
import { generateId } from '@/lib/database/utils';
import { DECK_STAGE_KEYS, type DeckStageKind } from '@/lib/deckStageLabels';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useSheetKeyboardLift } from '@/lib/useSheetKeyboardLift';
import type { DeckStage } from '@/types';

interface Props {
  visible: boolean;
  stages: DeckStage[];
  onChange: (stages: DeckStage[]) => void;
  onClose: () => void;
  /** 何の土台の一覧か（044: HTML/CSS 土台 ／ 045: SQL 初期化）。文言だけが変わる */
  kind: DeckStageKind;
  /** **一覧の末尾だけ**に差し込む追加UI（HTML では 043 の画像ライブラリ）。
   *
   *  ⚠️ **編集面（`SqlInitModal`）には置かない。戻さないこと。** 2つの理由がある：
   *  ① 土台が0件だと編集面を開けず、画像ライブラリへ到達する手段がゼロになる（デッキ編集画面の
   *     行は画像があれば点灯するので「設定済みなのに開くと空」に見える。実際に報告された）
   *  ② iPhone でキーボードを出したまま編集面で一覧を展開すると、シートの高さ（約345pt）を
   *     一覧が食い尽くして**土台の入力欄が1行に潰れる**。狭い画面でキーボードと一覧は同居できない
   *
   *  画像ライブラリはデッキ単位のデータなので、デッキ単位の画面（この一覧）が本来の置き場所。
   *  土台を書きながらタグが要るときは、一覧でコピーしてから編集面を開く（土台テキストは
   *  `onChangeText` で親 state に即時反映されるので、閉じて開き直しても内容は失われない）。 */
  listFooter?: React.ReactNode;
}

/**
 * 044/045: デッキの土台の一覧モーダル。**HTML/CSS 土台と SQL 初期化で共用**する
 * （持ち方も操作も同じで、違うのは `kind` で切り替わる文言と、一覧に差し込む `listFooter` だけ）。
 * デッキ編集/新規作成の該当行と `H`（HTML）/`Q`（SQL）キーから開く。
 * 行をタップすると `SqlInitModal`（テキスト編集面）が上に開く2段構成。
 *
 * **土台の名前の編集は編集面のヘッダーで行う**。一覧は「見て・選んで・消す」に絞ってある
 * （当初はリストにキーボード追従を持ち込まないための判断でもあったが、043 の画像リネームで
 * 結局この一覧も追従が必要になったため、いまは「役割を分ける」ことだけが理由）。
 *
 * 先頭の土台には「既定」バッジを出す。ブロックが土台を選んでいない（`deckStageId` 未指定）
 * ときに使われるのが先頭だからで、**先頭を削除すると既定が次の土台にずれる**ため削除確認の
 * 文言も分けている。
 */
export function DeckStagesModal({ visible, stages, onChange, onClose, kind, listFooter }: Props) {
  const keys = DECK_STAGE_KEYS[kind];
  const theme = useTheme();
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeckStage | null>(null);
  /** 一覧の ScrollView（キーボード表示時に末尾＝画像ライブラリへ送るために持つ）。 */
  const listRef = useRef<ScrollView>(null);

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

  // 位置と高さは共通フックへ（SqlInitModal と同じ規則）。**キーボード追従は必須**：一覧の末尾に
  // 差す 043 の画像ライブラリには名前のリネーム入力があり、固定の持ち上げ量だとキーボードに隠れる。
  const { sheetLift, sheetMaxHeight, keyboardVisible } = useSheetKeyboardLift();

  // キーボードが出たら一覧を末尾までスクロールする。このシートで入力欄を持つのは
  // listFooter（画像ライブラリのリネーム）だけで、それは常に末尾にあるため、
  // 「末尾へ送る＝入力欄を見える位置へ出す」が成立する。
  useEffect(() => {
    if (keyboardVisible) listRef.current?.scrollToEnd({ animated: true });
  }, [keyboardVisible]);

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
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface, maxHeight: sheetMaxHeight }]}>
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

            {/* 土台の行と listFooter（043 の画像ライブラリ）は同じ ScrollView に入れる。
                **土台が0件でも listFooter は出す**：ここが画像ライブラリの唯一の入口なので、
                出さないと到達手段がゼロになる（listFooter の項参照）。 */}
            <ScrollView ref={listRef} keyboardShouldPersistTaps="handled">
              {stages.length === 0 ? (
                <Text
                  style={[styles.empty, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {t(keys.listEmpty)}
                </Text>
              ) : (
                stages.map((stage, index) => {
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
                })
              )}
              {listFooter}
            </ScrollView>
        </View>
        {/* 持ち上げた分の隙間を**シートと同じ色で塗る**（marginBottom の代わり）。透明のままだと
            親のデッキ編集画面の保存/削除ボタンが暗幕越しに透けて「押せそう」に見えるため。
            親から FormBottomBar を消す方式は、レイアウトが縮んで裏の ScrollView 位置がずれるので不可。
            ここはモーダル内に1枚敷くだけなので親のレイアウトには影響しない。 */}
        <View style={{ height: sheetLift, backgroundColor: theme.colors.surface }} />

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

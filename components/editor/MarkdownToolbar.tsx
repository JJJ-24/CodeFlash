// 033 Phase 2/3/4: テキストブロック編集中にキーボード上端（InputAccessoryView）へ出す
// マークダウン装飾ツールバー。選択範囲を囲みタイプ／行頭タイプの記法で装飾する。
import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme';
import type { MdAction } from '@/lib/editor/applyMarkdown';

// カードエディタ全体で共有する InputAccessoryView の nativeID。
// ブロックごとに別々の InputAccessoryView を mount/unmount すると、iOS で
// タッチを横取りする残留ビューが生じるため、エディタに1つだけ常設して共有する。
export const MD_TOOLBAR_ID = 'card-markdown-toolbar';

export interface ToolbarButton {
  key: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  action: MdAction;
  labelKey: string;
  /** このボタンの前に区切り線を入れる（グループの境目） */
  groupStart?: boolean;
}

// 囲みタイプ（選択を両端で挟む）＋ 行頭タイプ（行頭に付与）。表示は markdown レンダラ側で対応済み。
export const TOOLBAR_BUTTONS: readonly ToolbarButton[] = [
  { key: 'bold', icon: 'format-bold', action: { kind: 'wrap', left: '**', right: '**' }, labelKey: 'editor.toolbar.bold' },
  { key: 'italic', icon: 'format-italic', action: { kind: 'wrap', left: '*', right: '*' }, labelKey: 'editor.toolbar.italic' },
  { key: 'code', icon: 'code', action: { kind: 'wrap', left: '`', right: '`' }, labelKey: 'editor.toolbar.code' },
  { key: 'strikethrough', icon: 'format-strikethrough', action: { kind: 'wrap', left: '~~', right: '~~' }, labelKey: 'editor.toolbar.strikethrough' },
  { key: 'highlight', icon: 'border-color', action: { kind: 'wrap', left: '==', right: '==' }, labelKey: 'editor.toolbar.highlight' },
  { key: 'heading', icon: 'title', action: { kind: 'prefix', prefix: '# ' }, labelKey: 'editor.toolbar.heading', groupStart: true },
  { key: 'bullet', icon: 'format-list-bulleted', action: { kind: 'prefix', prefix: '- ' }, labelKey: 'editor.toolbar.bulletList' },
  { key: 'quote', icon: 'format-quote', action: { kind: 'prefix', prefix: '> ' }, labelKey: 'editor.toolbar.quote' },
] as const;

interface Props {
  /** 記法アクションを適用する。 */
  onAction: (action: MdAction) => void;
}

// 横スクロールは使わない。ScrollView を InputAccessoryView 内に置くと、アンマウント時に
// タッチを横取りする残留ビューが生じ下部ボタンが反応しなくなるため、flex で等幅配置して全幅に収める。
export function MarkdownToolbar({ onAction }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.bar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
      {TOOLBAR_BUTTONS.map((b) => (
        <Fragment key={b.key}>
          {b.groupStart && <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />}
          <Pressable
            onPress={() => onAction(b.action)}
            style={({ pressed }) => [styles.btn, pressed && { backgroundColor: theme.colors.primaryLight }]}
            accessibilityRole="button"
            accessibilityLabel={t(b.labelKey)}
            hitSlop={4}
          >
            <MaterialIcons name={b.icon} size={22} color={theme.colors.text} />
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    marginHorizontal: 4,
  },
  btn: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    marginHorizontal: 1,
  },
});

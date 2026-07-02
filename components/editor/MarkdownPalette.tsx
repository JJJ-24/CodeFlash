// 033/iPad対応: テキストブロック編集中に「ブロック直下」へインライン描画する
// マークダウン装飾パレット。InputAccessoryView は使わない（iPad でフリーズ→クラッシュ
// する独立バグの回避＋iPhone のコールド起動初回1タップ空振りも解消）。コードブロックの
// SymbolPalette と同じく、フォーカス中ブロックの直下に普通の View として出す。
import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import type { AppTheme } from '@/lib/theme';
import type { MdAction } from '@/lib/editor/applyMarkdown';

// アイコンは FontAwesome5（solid）で統一する。装飾系（bold/italic/code/strikethrough/highlighter/
// heading/list-ul/quote）が1セットに揃い、線幅・余白の作法が揃う。特にハイライトは蛍光ペン型の
// highlighter、見出しは普通サイズの綺麗な H が得られる（MaterialIcons 混在時のサイズ調整が不要）。
export interface ToolbarButton {
  key: string;
  icon: keyof typeof FontAwesome5.glyphMap;
  action: MdAction;
  labelKey: string;
  /** このボタンの前に区切り線を入れる（グループの境目） */
  groupStart?: boolean;
}

// 囲みタイプ（選択を両端で挟む）＋ 行頭タイプ（行頭に付与）。表示は markdown レンダラ側で対応済み。
export const TOOLBAR_BUTTONS: readonly ToolbarButton[] = [
  { key: 'bold', icon: 'bold', action: { kind: 'wrap', left: '**', right: '**' }, labelKey: 'editor.toolbar.bold' },
  { key: 'italic', icon: 'italic', action: { kind: 'wrap', left: '*', right: '*' }, labelKey: 'editor.toolbar.italic' },
  { key: 'code', icon: 'code', action: { kind: 'wrap', left: '`', right: '`' }, labelKey: 'editor.toolbar.code' },
  { key: 'strikethrough', icon: 'strikethrough', action: { kind: 'wrap', left: '~~', right: '~~' }, labelKey: 'editor.toolbar.strikethrough' },
  { key: 'highlight', icon: 'highlighter', action: { kind: 'wrap', left: '==', right: '==' }, labelKey: 'editor.toolbar.highlight' },
  { key: 'heading', icon: 'heading', action: { kind: 'heading' }, labelKey: 'editor.toolbar.heading', groupStart: true },
  { key: 'bullet', icon: 'list-ul', action: { kind: 'prefix', prefix: '- ' }, labelKey: 'editor.toolbar.bulletList' },
  { key: 'quote', icon: 'quote-right', action: { kind: 'prefix', prefix: '> ' }, labelKey: 'editor.toolbar.quote' },
] as const;

interface Props {
  visible: boolean;
  /** 記法アクションを適用する（フォーカス中ブロックの apply 関数）。 */
  onAction: (action: MdAction) => void;
  theme: AppTheme;
}

export function MarkdownPalette({ visible, onAction, theme }: Props) {
  const { t } = useTranslation();
  if (!visible) return null;

  return (
    <View style={[styles.bar, { backgroundColor: theme.dark ? '#252525' : '#FAFAFA', borderTopColor: theme.colors.border }]}>
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
            <FontAwesome5 name={b.icon} size={20} color={theme.colors.text} solid />
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

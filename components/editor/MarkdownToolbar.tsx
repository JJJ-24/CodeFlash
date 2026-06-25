// 033 Phase 2/3: テキストブロック編集中にキーボード上端（InputAccessoryView）へ出す
// マークダウン装飾ツールバー。選択範囲を囲みタイプの記法で装飾する。
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme';

// カードエディタ全体で共有する InputAccessoryView の nativeID。
// ブロックごとに別々の InputAccessoryView を mount/unmount すると、iOS で
// タッチを横取りする残留ビューが生じるため、エディタに1つだけ常設して共有する。
export const MD_TOOLBAR_ID = 'card-markdown-toolbar';

export interface WrapAction {
  key: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  left: string;
  right: string;
  labelKey: string;
}

// 囲みタイプ（選択を両端で挟む）記法。表示は markdown レンダラ側で対応済み。
export const WRAP_ACTIONS: readonly WrapAction[] = [
  { key: 'bold', icon: 'format-bold', left: '**', right: '**', labelKey: 'editor.toolbar.bold' },
  { key: 'italic', icon: 'format-italic', left: '*', right: '*', labelKey: 'editor.toolbar.italic' },
  { key: 'code', icon: 'code', left: '`', right: '`', labelKey: 'editor.toolbar.code' },
  { key: 'strikethrough', icon: 'format-strikethrough', left: '~~', right: '~~', labelKey: 'editor.toolbar.strikethrough' },
  { key: 'highlight', icon: 'border-color', left: '==', right: '==', labelKey: 'editor.toolbar.highlight' },
] as const;

interface Props {
  /** 記法を適用する。left/right は選択範囲を囲む文字列。 */
  onAction: (left: string, right: string) => void;
}

export function MarkdownToolbar({ onAction }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.bar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
      {WRAP_ACTIONS.map((a) => (
        <Pressable
          key={a.key}
          onPress={() => onAction(a.left, a.right)}
          style={({ pressed }) => [styles.btn, pressed && { backgroundColor: theme.colors.primaryLight }]}
          accessibilityRole="button"
          accessibilityLabel={t(a.labelKey)}
          hitSlop={4}
        >
          <MaterialIcons name={a.icon} size={22} color={theme.colors.text} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  btn: {
    width: 46,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
});

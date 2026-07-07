import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useLockedTopInset } from '@/lib/useLockedTopInset';

interface Props {
  title: string;
  /** 左端 ×。変更ありなら破棄確認を出す handleClose を渡す。 */
  onClose: () => void;
  /** 右端 ✓（保存）。 */
  onSave: () => void;
  canSave: boolean;
  /** タイトルタップ時（ショートカット一覧を開く等）。未指定なら非活性。 */
  onTitlePress?: () => void;
  /** タイトル横のキーボードアイコン表示（keyboardShortcutsEnabled を渡す）。 */
  showKeyboardIcon: boolean;
  /** タイトルの最大幅。指定時は 1 行省略表示になる（カードエディタ＝画面幅の 50%）。 */
  titleMaxWidth?: number;
}

/**
 * 入力系モーダル（fullScreenModal）共通の自前固定ヘッダー。
 *
 * 標準（native-stack）ヘッダーはコード実行 WebView がステータスバーを隠すと高さが縮み、
 * ネイティブバーボタンのハイライトカプセルも変形するため、これらの画面は
 * `headerShown: false` ＋ このヘッダーを使う（高さは useLockedTopInset ＝縮まない）。
 * 詳細は CLAUDE.md「カスタムヘッダーパターン」。ステータスバーの表示・色の復元は
 * 各画面の useRestoreStatusBar が担当する。
 *
 * 構造: 左＝×（閉じる）／中央＝タイトル（ショートカット有効時はキーボードアイコン付きで
 * タップ→一覧表示）／右＝✓（保存）。
 */
export function ModalFormHeader({ title, onClose, onSave, canSave, onTitlePress, showKeyboardIcon, titleMaxWidth }: Props) {
  const theme = useTheme();
  const lockedTopInset = useLockedTopInset();
  return (
    <View style={{ height: lockedTopInset + 44, backgroundColor: theme.colors.surface }}>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        <Pressable onPress={onClose} style={{ paddingHorizontal: 4, zIndex: 1 }} hitSlop={8}>
          <Ionicons name="close" size={26} color={theme.colors.textSecondary} />
        </Pressable>
        <View style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }} pointerEvents="box-none">
          <Pressable
            onPress={onTitlePress}
            style={[{ flexDirection: 'row', alignItems: 'center', gap: 4 }, titleMaxWidth != null && { maxWidth: titleMaxWidth }]}
          >
            <Text
              style={[{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }, titleMaxWidth != null && { flexShrink: 1 }]}
              numberOfLines={titleMaxWidth != null ? 1 : undefined}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {title}
            </Text>
            {showKeyboardIcon && (
              <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
            )}
          </Pressable>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onSave} disabled={!canSave} style={{ paddingHorizontal: 4, zIndex: 1 }} hitSlop={8}>
          <Ionicons name="checkmark-sharp" size={26} color={canSave ? theme.colors.primary : theme.colors.textTertiary} />
        </Pressable>
      </View>
    </View>
  );
}

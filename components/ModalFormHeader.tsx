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
  /**
   * タイトルの最大幅。指定時は 1 行省略表示になる。
   * カードエディタは `screenWidth - 112`＝左右の ×／✓（各 42pt＝アイコン 26 ＋ 左右パディング 4
   * ＋ 外側パディング 8）とゆとり 14pt を引いた幅。中央寄せなので左右対称に見積もる。
   */
  titleMaxWidth?: number;
  /**
   * アーカイブが ON のあいだタイトルの左にアーカイブのアイコンを出す（デッキ編集・カード編集）。
   * E キーで切り替えたとき、アーカイブの欄が画面外でも状態が分かるように（一覧のアーカイブ済みの行と同じアイコン）。
   * ⚠️ 画面全体を薄くしない＝このアプリで薄いグレーは「効いていない・触れない」の印で、編集できないように
   * 見えるうえ、保存前（まだアーカイブされていない）の予約を確定済みのように見せてしまう。
   */
  archived?: boolean;
}

/** タイトル横のアイコン（キーボード・アーカイブ）1つが占める幅（アイコン 20 ＋ gap 4）。 */
const TITLE_ICON_SPACE = 24;

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
export function ModalFormHeader({ title, onClose, onSave, canSave, onTitlePress, showKeyboardIcon, titleMaxWidth, archived }: Props) {
  const theme = useTheme();
  const lockedTopInset = useLockedTopInset();
  // ⚠️ タイトルの省略は Text の **maxWidth** で行う（`flexShrink: 1` にしない）。
  // 行が溢れたときの flexShrink は Yoga がテキストを測り直すが、**日本語はどの文字間でも
  // 改行できるので最小幅が「1文字」になり**、箱は縮んだ幅のまま中身だけ `カ…` に潰れる
  // （字とアイコンのあいだが大きく空く）。英語は最小幅が単語単位なうえ、そもそも収まって
  // 縮める経路に入らないため露見しない＝「（コピー）」付きの日本語で実際に踏んだ。
  // maxWidth なら測定は AtMost の1回で決まり、箱の幅と省略位置が必ず一致する。
  const titleTextMaxWidth =
    titleMaxWidth == null ? undefined : Math.max(0, titleMaxWidth - (showKeyboardIcon ? TITLE_ICON_SPACE : 0) - (archived ? TITLE_ICON_SPACE : 0));
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
            {archived && (
              <Ionicons name="archive" size={20} color={theme.colors.textTertiary} />
            )}
            <Text
              style={[{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }, titleTextMaxWidth != null && { maxWidth: titleTextMaxWidth }]}
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

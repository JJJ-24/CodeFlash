import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppSwitch } from '@/components/AppSwitch';
import { InfoContent } from '@/components/InfoContent';
import { SettingsFocusGroup, SettingsFocusRow, type SettingsFocusHandlers } from '@/components/settings/settingsFocus';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';

/**
 * 057：デッキ新規・編集画面を「基本／読み上げ／コード実行」の見出しで区切り、開くだけの行を1行形式に詰める部品。
 * 新規と編集で同じ見た目にするための共通部品（入力欄・アイコン・カラーは各画面にそのまま残す）。
 */

/** セクションの見出し（J/K の止まり先にはしない＝⇧J/⇧K は各セクションの先頭行へ跳ぶ） */
export function DeckFormSectionTitle({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <Text
      style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}
      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
    >
      {title}
    </Text>
  );
}

/**
 * 行を並べる白枠（カード）。中の行（`DeckFormNavRow`・`SettingsFocusRow`）は**このカードの直接の子**に置く
 * （フォーカスの位置は親のカードの中の y で控えるため＝055 の `SettingsFocusGroup` の規則）。
 */
export function DeckFormCard({ children, dim }: { children: ReactNode; dim?: boolean }) {
  const theme = useTheme();
  return (
    <SettingsFocusGroup style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }, dim && styles.inactive]}>
      {children}
    </SettingsFocusGroup>
  );
}

/** カードの中の行と行のあいだの区切り線 */
export function DeckFormDivider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.colors.inputBorder }]} />;
}

/**
 * 開くだけの行（読み上げの設定・HTML/CSS 土台・SQL 初期化）。左に項目名、右に要約と ＞。
 * かつては項目名を上の段に置き、その下に要約のボタンを並べていた（1項目で2段）。
 */
export function DeckFormNavRow({
  icon, configured, label, summary, locked, dim, note, onPress, ...handlers
}: SettingsFocusHandlers & {
  icon: ComponentProps<typeof Ionicons>['name'];
  /** 設定済みなら塗りのアイコン＋primary（未設定は outline＋グレー） */
  configured: boolean;
  label: string;
  summary: string;
  /** 非 Pro の鍵 */
  locked?: boolean;
  /** 効いていない状態（読み上げ OFF など）を淡く見せる */
  dim?: boolean;
  /** 行の下に出す注記（なぜ効かないか） */
  note?: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <SettingsFocusRow onActivate={onPress} {...handlers}>
      <Pressable style={[styles.navRow, dim && styles.inactive]} onPress={onPress}>
        <Ionicons
          name={(configured ? icon : `${icon}-outline`) as ComponentProps<typeof Ionicons>['name']}
          size={20}
          color={configured ? theme.colors.primary : theme.colors.textSecondary}
        />
        <Text
          style={[styles.navLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
        >
          {label}
        </Text>
        <Text
          style={[styles.navSummary, { color: configured ? theme.colors.text : theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
          numberOfLines={2}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
        >
          {summary}
        </Text>
        {locked && <Ionicons name="lock-closed" size={theme.fontSize.sm} color={theme.colors.primary} />}
        <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
      </Pressable>
      {!!note && (
        <Text style={[styles.note, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {note}
        </Text>
      )}
    </SettingsFocusRow>
  );
}

/**
 * スイッチの行（読み上げ・アーカイブ）。左からアイコン・項目名・ⓘ・スイッチ。ⓘ の説明は行の下にインライン展開する
 * （ⓘ はアイコンのタップだけで開く＝ラベルには持たせない）。Space＝スイッチ（055）。
 */
export function DeckFormToggleRow({
  icon, label, value, onValueChange, infoLabel, infoText, showInfo, onToggleInfo, dim, note, ...handlers
}: SettingsFocusHandlers & {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  infoLabel: string;
  infoText: string;
  showInfo: boolean;
  onToggleInfo: () => void;
  dim?: boolean;
  note?: string | null;
}) {
  const theme = useTheme();
  return (
    <SettingsFocusRow onToggle={() => onValueChange(!value)} {...handlers}>
      <View style={[styles.navRow, dim && styles.inactive]}>
        <Ionicons name={icon} size={20} color={theme.colors.textSecondary} />
        <View style={styles.toggleLabelWrap}>
          <Text
            style={[styles.toggleLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {label}
          </Text>
          <Pressable onPress={onToggleInfo} hitSlop={8} accessibilityLabel={infoLabel}>
            <Ionicons
              name={showInfo ? 'information-circle' : 'information-circle-outline'}
              size={Math.max(theme.fontSize.lg, 20)}
              color={theme.colors.textTertiary}
            />
          </Pressable>
        </View>
        <AppSwitch value={value} onValueChange={onValueChange} thumbColor="#FFF" />
      </View>
      {showInfo && (
        <View style={[styles.infoBox, { backgroundColor: theme.colors.background }]}>
          <InfoContent text={infoText} />
        </View>
      )}
      {!!note && (
        <Text style={[styles.note, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {note}
        </Text>
      )}
    </SettingsFocusRow>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontWeight: '700', marginBottom: -8 },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
  },
  divider: { height: StyleSheet.hairlineWidth },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  navLabel: { fontWeight: '600', flexShrink: 0, maxWidth: '55%' },
  navSummary: { flex: 1, textAlign: 'right' },
  toggleLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleLabel: { fontWeight: '600', flexShrink: 1 },
  // ⓘ で開くインライン説明（設定サブ画面の syncInfoBox と同じ見せ方）
  infoBox: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  note: { marginBottom: 10 },
  // 効かない状態（一覧のアーカイブ済みと同じ 0.55）
  inactive: { opacity: 0.55 },
});

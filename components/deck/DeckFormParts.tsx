import { Ionicons } from '@expo/vector-icons';
import { Children, createContext, isValidElement, useContext } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppSwitch } from '@/components/AppSwitch';
import { InfoContent } from '@/components/InfoContent';
import { SettingsFocusGroup, SettingsFocusRow, type SettingsFocusHandlers } from '@/components/settings/settingsFocus';
import { MAX_FONT_MULTIPLIER, SHADOW, useTheme } from '@/lib/theme';

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
 * カードの角丸。**設定画面の白枠（`settingsStyles.card`）と同じ見た目**＝枠線なし・弱い影・角丸12。
 * かつては入力欄と同じ「枠線1pt・影なし」だった（057 以前のアーカイブ行の形が広がったもの）が、
 * この白枠は項目をまとめる入れ物で、設定画面の白枠と役割が同じなので見た目もそろえた。
 * 枠線が残るのは「ここに書ける」入力欄と、状態を色で示すカード編集のブロックだけ。
 */
const CARD_RADIUS = 12;
const RING_RADIUS = CARD_RADIUS;

/** カードの中での行の位置（先頭・末尾）＝青枠の角をカードの角に合わせるため */
const RowPositionContext = createContext({ first: true, last: true });

/**
 * 行が使う青枠の指定。行はカードの端から端まで広がり（左右の余白は行が持つ）、青枠は行ぴったり＝**白枠いっぱい**に出る。
 * 角はカードの先頭の行なら上だけ・末尾の行なら下だけ丸める（途中の行は区切り線で切れる四角）。
 */
function useRowRing() {
  const { first, last } = useContext(RowPositionContext);
  return { variant: 'fill' as const, ringRadius: { top: first ? RING_RADIUS : 0, bottom: last ? RING_RADIUS : 0 } };
}

/**
 * 行を並べる白枠（カード）。中の行（`DeckFormField`・`DeckFormNavRow`・`DeckFormToggleRow`）は**このカードの直接の子**に置く
 * （フォーカスの位置は親のカードの中の y で控えるため＝055 の `SettingsFocusGroup` の規則）。
 * タグの新規・編集画面も同じ部品を使う（見た目をそろえるため）。
 */
export function DeckFormCard({ children, dim }: { children: ReactNode; dim?: boolean }) {
  const theme = useTheme();
  // 子の先頭・末尾を控えて行へ渡す（Provider は View を作らないので「直接の子」の規則は崩れない）
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <SettingsFocusGroup style={[styles.card, { backgroundColor: theme.colors.surface }, dim && styles.inactive]}>
      {items.map((child, i) => (
        <RowPositionContext.Provider key={child.key ?? i} value={{ first: i === 0, last: i === items.length - 1 }}>
          {child}
        </RowPositionContext.Provider>
      ))}
    </SettingsFocusGroup>
  );
}

/**
 * 項目名＋中身（入力欄・アイコン・カラーなど）の行。白枠1つに1項目で置く（入力欄は枠の中で薄いグレーの枠）。
 */
export function DeckFormField({ label, small, claim, dim, note, children, ...handlers }: SettingsFocusHandlers & {
  label: string;
  /** 項目名を小さく（タグ画面は sm で揃えてある） */
  small?: boolean;
  /** 中の入力欄にカーソルが入ったら青枠の対象にする（055） */
  claim?: boolean;
  /** 効いていない状態（アイコン未設定のカラーなど）を淡く見せる。注記は淡くしない */
  dim?: boolean;
  /** 中身の下に出す注記（なぜ効かないか） */
  note?: string | null;
  children: ReactNode;
}) {
  const theme = useTheme();
  const ring = useRowRing();
  return (
    <SettingsFocusRow style={styles.field} claim={claim} {...ring} {...handlers}>
      <View style={[styles.fieldBody, dim && styles.inactive]}>
        <DeckFormFieldLabel label={label} small={small} />
        {children}
      </View>
      {!!note && (
        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {note}
        </Text>
      )}
    </SettingsFocusRow>
  );
}

/** 項目名（フォーカスしない行＝タグのプレビューでも使う） */
export function DeckFormFieldLabel({ label, small }: { label: string; small?: boolean }) {
  const theme = useTheme();
  return (
    <Text
      style={[styles.fieldLabel, { color: theme.colors.textSecondary, fontSize: small ? theme.fontSize.sm : theme.fontSize.md }]}
      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
    >
      {label}
    </Text>
  );
}

/** フォーカスしない項目（タグのプレビュー）。`DeckFormField` と同じ余白 */
export function DeckFormStaticField({ children }: { children: ReactNode }) {
  return <View style={styles.field}>{children}</View>;
}

/** カードの中の行と行のあいだの区切り線 */
export function DeckFormDivider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.colors.inputBorder }]} />;
}

/**
 * 開くだけの行（詳細設定・HTML/CSS 土台・SQL 初期化）。左に項目名、右に要約と ＞。
 * かつては項目名を上の段に置き、その下に要約のボタンを並べていた（1項目で2段）。
 * 左のアイコンは撤去した（状態は右の要約と重複・項目名で見分けがつく・デッキ編集の他の行にアイコンが無い）。
 */
export function DeckFormNavRow({
  configured, label, summary, locked, dim, note, onPress, ...handlers
}: SettingsFocusHandlers & {
  /**
   * 中身があるか＝項目名の右に青いドット（カード編集の表/裏/メモのタブの点と同じ「中身あり」の印）。
   * ドットは有無だけ・中身は右の要約で読む。
   */
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
  const ring = useRowRing();
  return (
    <SettingsFocusRow style={styles.row} onActivate={onPress} {...ring} {...handlers}>
      <Pressable style={[styles.navRow, dim && styles.inactive]} onPress={onPress}>
        <View style={styles.navLabelWrap}>
          <Text
            style={[styles.navLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {label}
          </Text>
          {configured && <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />}
        </View>
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
 * スイッチの行（このデッキで使用・アーカイブ）。左から項目名・ⓘ・スイッチ。ⓘ の説明は行の下にインライン展開する
 * （ⓘ はアイコンのタップだけで開く＝ラベルには持たせない）。Space＝スイッチ（055）。
 */
export function DeckFormToggleRow({
  label, value, onValueChange, infoLabel, infoText, showInfo, onToggleInfo, dim, note, ...handlers
}: SettingsFocusHandlers & {
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
  const ring = useRowRing();
  return (
    <SettingsFocusRow style={styles.row} onToggle={() => onValueChange(!value)} {...ring} {...handlers}>
      <View style={[styles.navRow, dim && styles.inactive]}>
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
  // 左右の余白は行が持つ（青枠を白枠いっぱいに出すため）
  card: {
    borderRadius: CARD_RADIUS,
    ...SHADOW.subtle,
  },
  row: { paddingHorizontal: 14 },
  field: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  fieldBody: { gap: 8 },
  fieldLabel: { fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  // minHeight＝スイッチの行の高さ（スイッチ 31 ＋上下 12×2）。開く行は文字の高さしか無く約10pt 低かった
  // ＝同じ白枠の中・白枠どうしで行の高さをそろえる。余白ではなく最小の高さなので、文字が大きいときは余計に伸びない
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    minHeight: 55,
  },
  navLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0, maxWidth: '55%' },
  navLabel: { fontWeight: '600', flexShrink: 1 },
  // カード編集のタブの「中身あり」の点と同じ大きさ
  dot: { width: 5, height: 5, borderRadius: 3 },
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

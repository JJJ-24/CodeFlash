import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { AppSwitch } from '@/components/AppSwitch';
import { SPEECH_SCRIPT_LABEL_KEYS, SpeechLanguageModal } from '@/components/settings/SpeechLanguageModal';
import {
  CONFIGURABLE_SCRIPTS,
  getConfigurableScriptLanguages,
  SCRIPT_DEFAULT_LANGS,
  speechLanguageLabel,
  type ScriptLangs,
  type SpeechScript,
} from '@/lib/speech';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useSettingsStore } from '@/store/settings';

interface Props {
  visible: boolean;
  /** このデッキの上書き（未設定の文字体系はキーごと無い）＝**表面**用 */
  langs: ScriptLangs;
  /** 051：**裏面**用の上書き。空 = 表面と同じ（メモは裏面に従う） */
  langsBack: ScriptLangs;
  onChange: (langs: ScriptLangs) => void;
  onChangeBack: (langs: ScriptLangs) => void;
  onClose: () => void;
}

/**
 * 050 Phase 2：**このデッキを読み上げるときの言語**を文字体系ごとに上書きする一覧。
 * デッキ新規作成/編集の行と `R` キーから開き、行をタップすると `SpeechLanguageModal` が上に開く
 * 2段構成（`DeckStagesModal` → `SqlInitModal` と同じ形）。
 *
 * 上書きは**設定した文字体系だけ**アプリ設定に重なる（`mergeScriptLangs`）。漢字だけ中国語に
 * したいデッキでラテン文字まで巻き込まれると、英語の技術用語が中国語読みになってしまうため。
 *
 * 051：**「裏面を別の言語で読む」トグル**（既定 OFF）で裏面用の一覧を足せる。両面が同じ
 * 文字体系で言語だけ違うデッキ（英語 ⇄ スペイン語）は文字体系では分けられないため。
 * ⚠️ **[表面|裏面] のセグメントで常時2面にしない**＝1文字体系あたり3行あるので縦を食い尽くす。
 * 既定 OFF のトグルなら、表裏を分けないデッキの見た目と操作は 050 のままになる。
 * ⚠️ **OFF にしたら裏面の設定は消す**＝残すと「トグルは OFF なのに裏面だけ別の言語で読まれる」
 * ＝画面に出ていない設定が効く状態になる（CLAUDE.md の鉄則）。
 *
 * 051：**このシートを開けるのは Pro だけ**（デッキに保存する読み上げ設定＝050 のデッキ別言語も含めて）。
 * ⚠️ ただし**ゲートは呼び出し側（デッキ編集の行）に置く**＝このシート自体は isPro を知らない。
 * 非 Pro でも「設定済みの解除」は通す必要があり（受け取ったデッキを直す手段が消えるため）、
 * その導線は行のダイアログが持つ。⚠️ **適用（学習画面）には isPro を入れない**（読み上げ本体は無料）。
 * ⚠️ 選択肢に出す文字体系は**設定画面とまったく同じ規則**（`CONFIGURABLE_SCRIPTS` かつ
 * 端末にその文字体系の音声が2つ以上ある）。1つしか無いものは選ばせても結果が変わらない。
 * ⚠️ 2枚目のモーダル（言語ピッカー）は**この Modal の children の中**に置く。兄弟に並べると
 * iOS が2枚目を提示できず、閉じた後に親画面がタップを受け付けなくなる（044 で踏んだ）。
 */
export function DeckSpeechModal({ visible, langs, langsBack, onChange, onChangeBack, onClose }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const appLangs = useSettingsStore((s) => s.speechScriptLangs);
  const [showInfo, setShowInfo] = useState(false);
  /** 言語ピッカーを開いている文字体系と面（null＝閉じている） */
  const [picking, setPicking] = useState<{ script: SpeechScript; back: boolean } | null>(null);
  /** 文字体系ごとに端末が持っている音声の言語。null＝未取得 */
  const [scriptOptions, setScriptOptions] = useState<Partial<Record<SpeechScript, string[]>> | null>(null);
  /** 051：裏面を分けるか。開くたびに保存値から作り直す（＝設定済みなら ON で開く） */
  const [splitSides, setSplitSides] = useState(false);

  useEffect(() => {
    if (!visible) return;
    getConfigurableScriptLanguages().then(setScriptOptions).catch(() => {});
    // ⚠️ 依存に langsBack を入れない（編集のたびにトグルが作り直され、最後の1件を消した
    //    瞬間に一覧ごと閉じてしまう）。開いた時点の保存値だけを見る。
    setSplitSides(Object.keys(langsBack).length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 表示中だけ Esc を担当する。⚠️ 言語ピッカーが上に乗っている間は**そちらが最上位**なので外す
  // （両方が登録すると Esc で2枚とも閉じる）。
  useKeyCommands([{ input: KeyCommand.keyInputEscape, handler: onClose }], visible && picking === null);

  /** 選べる文字体系（未取得のあいだは設定画面と同じく全部出しておく＝取得後に減る） */
  const scripts = CONFIGURABLE_SCRIPTS.filter(
    (s) => scriptOptions === null || (scriptOptions[s]?.length ?? 0) >= 2,
  );

  /** 上書きが無いときに実際に読まれる言語（アプリ設定 → 文字体系の既定）。 */
  const inheritedLang = (script: SpeechScript) => appLangs[script] ?? SCRIPT_DEFAULT_LANGS[script];

  const setLang = (script: SpeechScript, code: string | null, back: boolean) => {
    const next = { ...(back ? langsBack : langs) };
    // null＝「アプリ設定に従う」＝**キーごと消す**（空文字を残すと未設定と区別できない）
    if (code === null) delete next[script];
    else next[script] = code;
    (back ? onChangeBack : onChange)(next);
  };

  /** 051：裏面を分けるトグル。OFF は裏面の設定を消す（隠れて効く状態を作らない）。 */
  const toggleSplit = (on: boolean) => {
    setSplitSides(on);
    if (!on) onChangeBack({});
  };

  /** 文字体系1つぶんの行（表面／裏面で同じ形）。 */
  const renderRow = (script: SpeechScript, back: boolean) => {
    const sideLangs = back ? langsBack : langs;
    const override = sideLangs[script];
    return (
      <Pressable
        key={`${back ? 'back' : 'front'}-${script}`}
        style={[styles.row, { borderColor: theme.colors.border }]}
        onPress={() => setPicking({ script, back })}
      >
        <Text
          style={[styles.rowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
        >
          {t(SPEECH_SCRIPT_LABEL_KEYS[script] ?? 'settings.speechScriptLatin')}
        </Text>
        {/* 上書きがあれば言語名（青）、無ければ「アプリ設定」（グレー）＝一覧で差が分かる。
            ⚠️ 裏面で未設定のときは「表面と同じ」＝アプリ設定ではないので文言を変える。 */}
        <Text
          style={{
            color: override ? theme.colors.primary : theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            fontWeight: override ? '700' : '400',
            flexShrink: 1,
          }}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
        >
          {override
            ? speechLanguageLabel(override, t, scriptOptions?.[script] ?? [])
            : back
              ? t('deck.speechSameAsFront')
              : t('deck.speechInherit')}
        </Text>
        <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
      </Pressable>
    );
  };

  /**
   * 面の見出し（トグル ON のときだけ出す＝OFF なら 050 と同じ見た目）。
   *
   * 見た目は `ShortcutsModal` のカテゴリー小見出しと同じ「帯＋青文字」。素の
   * `textSecondary` の太字だと、下に続く行タイトル（`text` の太字）と重さが変わらず
   * 見出しに見えない＝どこから裏面なのかを目で追えなかった。
   * ⚠️ 帯はシートの左右いっぱいに出す＝インセットのままだと角丸の行カードと同じ見え方になり、
   *   「区切り」ではなくもう1枚のカードとして読める。そのため **sheet 側の
   *   `paddingHorizontal` を外し、左右の余白は中の要素それぞれが持つ**（`ShortcutsModal`
   *   と同じ構成）。⚠️ `marginHorizontal: -16` で外へはみ出させる手は使えない＝
   *   RN の `ScrollView` は `overflow: 'scroll'`（`clipsToBounds = YES`）なので、
   *   はみ出したぶんは描画されずテキストだけ右へずれる。
   */
  const sideHeading = (label: string, separated?: boolean) => (
    <View
      style={[
        styles.sideLabelBand,
        { backgroundColor: theme.colors.background, borderTopColor: theme.colors.border },
        separated && styles.sideLabelBandSeparated,
      ]}
    >
      <Text
        style={[styles.sideLabel, { color: theme.colors.primary, fontSize: theme.fontSize.sm }]}
        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
      >
        {label}
      </Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.closeArea} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.header}>
            <View style={styles.titleLine}>
              <Text
                style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {t('deck.speechLangsTitle')}
              </Text>
              <Pressable onPress={() => setShowInfo((v) => !v)} hitSlop={8}>
                <Ionicons
                  name={showInfo ? 'information-circle' : 'information-circle-outline'}
                  size={Math.max(theme.fontSize.lg, 20)}
                  color={theme.colors.textTertiary}
                />
              </Pressable>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.headerBtn}>
              <Ionicons name="checkmark-sharp" size={26} color={theme.colors.primary} />
            </Pressable>
          </View>

          {showInfo && (
            <View style={[styles.infoBox, { backgroundColor: theme.colors.background }]}>
              <Text
                style={[styles.hint, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t('deck.speechLangsHint')}
              </Text>
            </View>
          )}

          <ScrollView>
            {scripts.length === 0 ? (
              <Text
                style={[styles.empty, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t('deck.speechLangsNoOptions')}
              </Text>
            ) : (
              <>
                {/* 051：既定 OFF。ON のときだけ裏面の一覧が続く */}
                <View style={[styles.toggleRow, { borderColor: theme.colors.border }]}>
                  <Text
                    style={[styles.rowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {t('deck.speechSplitSides')}
                  </Text>
                  <AppSwitch value={splitSides} onValueChange={toggleSplit} />
                </View>
                {/* 面の呼び名は `common.front` / `common.back`（カード編集のタブと同じ定義元）。 */}
                {splitSides && sideHeading(t('common.front'))}
                {scripts.map((script) => renderRow(script, false))}
                {splitSides && (
                  <>
                    {sideHeading(t('common.back'), true)}
                    {scripts.map((script) => renderRow(script, true))}
                  </>
                )}
              </>
            )}
          </ScrollView>

          {/* ⚠️ 言語ピッカーは**この Modal の中**（兄弟に並べない）。 */}
          <SpeechLanguageModal
            visible={picking !== null}
            script={picking?.script ?? 'latin'}
            value={picking ? (picking.back ? langsBack : langs)[picking.script] ?? null : null}
            allowInherit
            // 裏面の「上書きしない」は**表面と同じ**を意味する（アプリ設定ではない）＝
            // 表示する言語も、表面に上書きがあればそれ、無ければアプリ設定になる。
            inheritLabel={picking?.back ? t('deck.speechSameAsFront') : undefined}
            inheritLang={
              picking
                ? picking.back
                  ? (langs[picking.script] ?? inheritedLang(picking.script))
                  : inheritedLang(picking.script)
                : undefined
            }
            onSelect={(code) => { if (picking) setLang(picking.script, code, picking.back); }}
            onClose={() => setPicking(null)}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  closeArea: { flex: 1 },
  // ⚠️ 左右パディングは持たせない（面の見出しの帯を端まで出すため）。左右 16 は
  //    header/infoBox/empty/row/toggleRow がそれぞれ marginHorizontal で持つ。
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 16,
    maxHeight: '75%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, marginHorizontal: 16 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  title: { fontWeight: '700', flexShrink: 1 },
  headerBtn: { paddingHorizontal: 4 },
  infoBox: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, marginHorizontal: 16 },
  hint: { lineHeight: 20 },
  empty: { paddingVertical: 24, textAlign: 'center', marginHorizontal: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  rowTitle: { flex: 1, fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    marginHorizontal: 16,
  },
  sideLabel: { fontWeight: '700' },
  sideLabelBand: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  // 2枚目（裏面）だけ上を空ける＝1枚目はトグル行の marginBottom:12 が既に空けているため。
  sideLabelBandSeparated: { marginTop: 4 },
});

/**
 * デッキ編集/新規作成の行に出す要約。**中身をそのまま出す**（「設定済み」の一語だと
 * 何語で読まれるのか分からず、開くまで確認できない＝043 の行で同じ失敗をしている）。
 *
 * 052：**常に言語名だけ**を並べる（1件「中国語」／2件「英語 / 中国語」）。学習設定の読み上げ
 * セクションの要約（`英語 / 日本語`）と同じ形で、かつ 1件・2件以上・表裏を分けたとき の3通りで
 * 書き方が変わらない（かつては「ラテン文字：英語」「2件を上書き」「言語名だけ」が混在していた）。
 * 文字体系を出さないのは、上書きする言語はたいてい文字体系を含意する（中国語＝漢字・ロシア語＝キリル）
 * うえ、全部出すと行に収まらないため。並びは `CONFIGURABLE_SCRIPTS` の順＝ピッカーの行順。
 *
 * ⚠️ 言語名は地域を省いた短い形にする（`peers` に `[]` を渡す）＝行は幅が限られており、
 * ここで区別が要る場面（同じ言語の地域違い）はピッカーを開けば分かる。
 * ⚠️ 表裏を分けたときは面の中を `deck.speechLangsJoin`（ja「・」／en「, 」）で結ぶ＝面の区切り
 * （`speechLangsSides` の「／」「 / 」）と同じ記号を使うとどこまでが表面か読めなくなる。
 */
export function deckSpeechSummary(
  langs: ScriptLangs,
  langsBack: ScriptLangs,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  // 051：裏面を分けていないデッキ（＝大多数）は学習設定の要約と同じ区切り（' / '）。
  if (Object.keys(langsBack).length === 0) return sideSummary(langs, t, ' / ');
  return t('deck.speechLangsSides', {
    front: sideSummary(langs, t, t('deck.speechLangsJoin')),
    back: sideSummary(langsBack, t, t('deck.speechLangsJoin')),
  });
}

/** 片面ぶんの要約＝上書きした言語名を `sep` で結ぶ。上書きが無ければ「アプリ設定」。 */
function sideSummary(
  langs: ScriptLangs,
  t: (key: string, opts?: Record<string, unknown>) => string,
  sep: string,
): string {
  // ⚠️ `Object.entries` の順は代入順で揺れるので、ピッカーと同じ `CONFIGURABLE_SCRIPTS` の順に固定する
  const names = CONFIGURABLE_SCRIPTS
    .map((script) => langs[script])
    .filter((lang): lang is string => !!lang)
    .map((lang) => speechLanguageLabel(lang, t, []));
  // 上書きが1つも無い＝アプリ設定のまま。⚠️ ピッカーの先頭行と**同じキー**を使う
  // （同じ意味の文字列を2本持つと、片方だけ直して食い違う）。
  if (names.length === 0) return t('deck.speechInherit');
  return names.join(sep);
}

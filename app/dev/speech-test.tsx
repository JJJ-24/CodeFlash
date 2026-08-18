import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as Speech from 'expo-speech';

import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles } from '@/components/settings/styles';
import { useTheme } from '@/lib/theme';

/**
 * 049 Phase 1a：読み上げ（TTS）の実測用の**使い捨て**検証画面（`__DEV__` 限定）。
 *
 * 判断したいことは2つ。
 *  1. **日英混在を日本語の声で読ませて許容できるか**（許容できるなら分割＝1c は不要）
 *  2. **分割が多言語へ伸びるか**（＝ラテン文字の読み上げ言語を差し替えるだけで日西・日仏に効くか）
 *
 * 判断が済んだらこの画面ごと削除する（`docs/049` の Todo 参照）。
 */

// ---- 検証用サンプル ----------------------------------------------------------

const SAMPLE_JA = '非同期処理は、あとで終わる処理をまとめて扱うための仕組みです。';
const SAMPLE_EN = 'Asynchronous code lets you handle operations that finish later.';
// 「日本語の説明文に英語の技術用語が埋まっている」＝このアプリで主流になる形。
// 長い専門語（idempotent）・短い略語（API）・キャメルケース（useEffect）を意図的に混ぜてある。
const SAMPLE_MIX =
  'React の useEffect は、副作用を扱うための Hook です。API を叩く処理は idempotent にしておくと安全です。';
// 日本語＋スペイン語。**ラテン文字側の言語を差し替えるだけ**で同じ分割が効くことの確認用
// （かな漢字 vs ラテン文字という切り方は、ラテン文字がどの言語でも変わらない）。
const SAMPLE_MIX_ES =
  'スペイン語で ありがとう は gracias、おはよう は buenos días と言います。';
// 純ラテン文字の短いカード（単語カードの表面）。**閾値の穴**の確認用。
// 「短いラテン片は日本語側へ」を無条件に適用すると、これが「ゲット」と読まれてしまう。
const SAMPLE_SHORT_EN = 'GET';

// ---- 文字種分割のプロトタイプ（1c の判断材料。昇格するときは lib/ へ移す） ----

/**
 * 分割は**文字体系**でしか割れない（`Hola` と `Hello` はどちらもラテン文字で区別できない）。
 * したがって区間の種類は「かな漢字」か「ラテン文字」かの2つで、
 * **ラテン文字を何語として読むかは設定で決める**（自動判別はしない・できない）。
 */
type Script = 'ja' | 'latin';
interface Segment {
  text: string;
  script: Script;
}

const RE_JA = /[぀-ヿ㐀-䶿一-鿿　-〿＀-￯]/;
// スペイン語の á/ñ・フランス語の é などラテン文字の拡張（Latin-1 Supplement / Latin Extended-A）も含める。
const RE_LATIN = /[A-Za-zÀ-ÖØ-öø-ſ]/;

/**
 * テキストを「日本語の声で読む区間」と「ラテン文字の声で読む区間」に割る。
 *
 * - 数字・記号・空白は**中立**として直前の区間へ吸わせる（単独で声を切り替えると間延びするため）
 * - `shortLatinMax` 文字以下のラテン片は日本語側に含める（「OK です」「PC の設定」対策）。0 なら無効
 *
 * ⚠️ **短いラテン片の日本語寄せは「日本語が混ざっている文」にだけ適用する**。
 * 無条件に適用すると、表面が `GET` だけの単語カード（＝ラテン文字しか無い）まで
 * 日本語の声で「ゲット」と読まれる。単語カードでは致命的なので、日本語区間が1つも
 * 無いテキストでは絶対に倒さない。
 */
function splitByScript(text: string, shortLatinMax: number): Segment[] {
  const runs: Segment[] = [];
  for (const ch of text) {
    const script: Script | null = RE_LATIN.test(ch) ? 'latin' : RE_JA.test(ch) ? 'ja' : null;
    const last = runs[runs.length - 1];
    // 中立文字（数字・記号・空白）は直前の区間へ吸わせる。先頭にあるときは日本語扱いで始める。
    if (script === null) {
      if (last) last.text += ch;
      else runs.push({ text: ch, script: 'ja' });
      continue;
    }
    if (last && last.script === script) last.text += ch;
    else runs.push({ text: ch, script });
  }

  // 短いラテン片を日本語側へ倒す。**混在文のときだけ**（上のコメント参照）。
  const hasJa = runs.some((r) => r.script === 'ja');
  if (shortLatinMax > 0 && hasJa) {
    for (const run of runs) {
      if (run.script !== 'latin') continue;
      const letters = run.text.replace(/[^A-Za-zÀ-ÖØ-öø-ſ]/g, '').length;
      if (letters <= shortLatinMax) run.script = 'ja';
    }
  }

  // 倒した結果として隣り合った同種の区間をつなぎ直す（無駄な発話境界＝間を作らないため）。
  const merged: Segment[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.script === run.script) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged.filter((s) => s.text.trim() !== '');
}

// ---- 画面 --------------------------------------------------------------------

const RATES = [0.7, 0.85, 1.0, 1.2];
const SHORT_LATIN_OPTIONS = [
  { value: 0, label: 'なし' },
  { value: 2, label: '2文字以下' },
  { value: 3, label: '3文字以下' },
];
// ラテン文字区間をどの言語として読むか。**自動判別できない部分＝設定にする部分**。
const LATIN_LANGS = [
  { value: 'en-US', label: '英語' },
  { value: 'es-ES', label: 'スペイン語' },
  { value: 'fr-FR', label: 'フランス語' },
];

export default function SpeechTestScreen() {
  const theme = useTheme();
  const [rate, setRate] = useState(1.0);
  const [shortLatinMax, setShortLatinMax] = useState(0);
  const [latinLang, setLatinLang] = useState('en-US');
  // iOS 限定オプション。false にすると OS が専用のオーディオセッションを作る。
  // **サイレントスイッチ ON で音が出るかどうか**がここで変わる可能性があるので実測する。
  const [ownSession, setOwnSession] = useState(true);
  const [freeText, setFreeText] = useState(SAMPLE_MIX);
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const [lastSplit, setLastSplit] = useState<Segment[] | null>(null);

  useEffect(() => {
    // **フィルターしない**（端末で実際に読める言語をそのまま見るのが目的）。
    Speech.getAvailableVoicesAsync()
      .then((all) => setVoices(all))
      .catch(() => setVoices([]));
    // 画面を離れるときは必ず止める（1b で全経路に入れる処理の雛形）。
    return () => { Speech.stop(); };
  }, []);

  const sortedVoices = useMemo(
    () => [...voices].sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name)),
    [voices],
  );
  const languageCount = useMemo(() => new Set(voices.map((v) => v.language)).size, [voices]);

  const speakOne = (text: string, language: string) => {
    Speech.stop();
    setLastSplit(null);
    Speech.speak(text, { language, rate, useApplicationAudioSession: ownSession });
  };

  /** 文字種で割って声を変えながら順に読む。`speak()` は連続で呼ぶとキューに積まれる。 */
  const speakSplit = (text: string) => {
    Speech.stop();
    const segments = splitByScript(text, shortLatinMax);
    setLastSplit(segments);
    for (const seg of segments) {
      Speech.speak(seg.text, {
        language: seg.script === 'ja' ? 'ja-JP' : latinLang,
        rate,
        useApplicationAudioSession: ownSession,
      });
    }
  };

  /** 音声一覧の行タップ：その声で自由入力欄を読む（voice を指定すると language より優先される）。 */
  const speakWithVoice = (voice: Speech.Voice) => {
    Speech.stop();
    setLastSplit(null);
    Speech.speak(freeText, { voice: voice.identifier, rate, useApplicationAudioSession: ownSession });
  };

  const card = [settingsStyles.card, { backgroundColor: theme.colors.surface }];
  const label = { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm };
  const body = { color: theme.colors.text, fontSize: theme.fontSize.sm, lineHeight: 20 };

  const Btn = ({ title, onPress, tone }: { title: string; onPress: () => void; tone?: 'plain' }) => (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center',
        backgroundColor: tone === 'plain' ? 'transparent' : theme.colors.primary,
        borderWidth: tone === 'plain' ? 1 : 0, borderColor: theme.colors.border,
      }}
    >
      <Text style={{ color: tone === 'plain' ? theme.colors.text : '#FFF', fontWeight: '700', fontSize: theme.fontSize.sm }}>
        {title}
      </Text>
    </Pressable>
  );

  const Segmented = <T,>({ options, value, onChange }: {
    options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
  }) => (
    <View style={[settingsStyles.segmented, { backgroundColor: theme.colors.background }]}>
      {options.map((o) => (
        <Pressable
          key={String(o.value)}
          onPress={() => onChange(o.value)}
          style={[settingsStyles.segment, o.value === value && { backgroundColor: theme.colors.surface }]}
        >
          <Text style={{
            color: o.value === value ? theme.colors.primary : theme.colors.textSecondary,
            fontWeight: o.value === value ? '700' : '400', fontSize: theme.fontSize.sm,
          }}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <SettingsDetail title="読み上げ検証 (DEV)">
      {/* 判定の要点を画面にも出しておく（docs/049 の表と対応） */}
      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>判定したいこと</Text>
        <Text style={body}>
          ③（混在 × 日本語の声）が「まあ許せる」なら文字種分割は不要で、Phase 1 は単一声のまま出せる。
          許せないなら ⑤ と聞き比べて分割を入れる。結果は docs/049 の表に記入する。
        </Text>
        <Text style={[label, { marginTop: 4 }]}>
          ⚠️ 音が出ないときは端末のサイレントスイッチを確認する（これ自体が 1b で注記が要る落とし穴）
        </Text>
      </View>

      {/* ---- 6パターン ---- */}
      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>① 純日本語 × ja-JP</Text>
        <Text style={label}>{SAMPLE_JA}</Text>
        <Btn title="読む" onPress={() => speakOne(SAMPLE_JA, 'ja-JP')} />
      </View>

      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>② 純英語 × en-US</Text>
        <Text style={label}>{SAMPLE_EN}</Text>
        <Btn title="読む" onPress={() => speakOne(SAMPLE_EN, 'en-US')} />
      </View>

      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>③ 日英混在 × ja-JP ← 本命</Text>
        <Text style={label}>{SAMPLE_MIX}</Text>
        <Btn title="読む" onPress={() => speakOne(SAMPLE_MIX, 'ja-JP')} />
      </View>

      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>④ 日英混在 × en-US</Text>
        <Text style={label}>（英語の声が日本語をどう扱うかの確認。実用ではなく挙動の記録用）</Text>
        <Btn title="読む" onPress={() => speakOne(SAMPLE_MIX, 'en-US')} />
      </View>

      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>⑤ 日英混在 × 文字種で分割（2声）</Text>
        <Text style={label}>③ と聞き比べる。切り替わりの間・声色の変化が許容できるか</Text>
        <Btn title="読む" onPress={() => speakSplit(SAMPLE_MIX)} />
      </View>

      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>⑥ 日本語＋スペイン語 × 分割</Text>
        <Text style={label}>
          {SAMPLE_MIX_ES}
          {'\n'}下の「ラテン文字の言語」を スペイン語 にしてから押す。
          同じ分割コードのまま多言語へ伸びることの確認
        </Text>
        <Btn title="読む" onPress={() => speakSplit(SAMPLE_MIX_ES)} />
      </View>

      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>⑦ 純ラテン文字の短いカード（閾値の穴）</Text>
        <Text style={label}>
          「{SAMPLE_SHORT_EN}」を分割して読む。閾値を 3文字以下 にしても
          日本語が混ざっていないので英語のまま読まれるのが正しい挙動
        </Text>
        <Btn title="読む" onPress={() => speakSplit(SAMPLE_SHORT_EN)} />
      </View>

      {lastSplit && (
        <View style={card}>
          <Text style={[body, { fontWeight: '700' }]}>直前の分割結果</Text>
          {lastSplit.map((s, i) => (
            <Text key={i} style={label}>[{s.script === 'ja' ? 'ja-JP' : latinLang}] {s.text}</Text>
          ))}
        </View>
      )}

      {/* ---- チューニング ---- */}
      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>ラテン文字の言語</Text>
        <Text style={label}>
          分割は文字体系しか見ないので、ラテン文字を何語として読むかは自動判別できない＝設定になる。
          ここが将来の「デッキごとの言語」設定に相当する
        </Text>
        <Segmented options={LATIN_LANGS} value={latinLang} onChange={setLatinLang} />
      </View>

      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>短いラテン文字片を日本語側に含める</Text>
        <Text style={label}>
          「API」「OK」「PC」を英語の声で読むか日本語の声で読むか。
          日本語が混ざっている文にだけ適用される（⑦ で確認）
        </Text>
        <Segmented options={SHORT_LATIN_OPTIONS} value={shortLatinMax} onChange={setShortLatinMax} />
      </View>

      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>速度（rate）</Text>
        <Text style={label}>1.0 が標準。既定値をここで決める</Text>
        <Segmented
          options={RATES.map((r) => ({ value: r, label: r.toFixed(2) }))}
          value={rate}
          onChange={setRate}
        />
      </View>

      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>useApplicationAudioSession</Text>
        <Text style={label}>
          iOS 限定。false にすると OS が専用セッションを作る。サイレントスイッチ ON での挙動が
          変わるかを両方で確認する
        </Text>
        <Segmented
          options={[{ value: true, label: 'true（既定）' }, { value: false, label: 'false' }]}
          value={ownSession}
          onChange={setOwnSession}
        />
      </View>

      {/* ---- 自由入力（実カードの本文を貼って試す） ---- */}
      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>自由入力</Text>
        <Text style={label}>実際のカード本文を貼り付けて試す。下の音声一覧の行タップでもこの文を読む</Text>
        <TextInput
          value={freeText}
          onChangeText={setFreeText}
          multiline
          style={{
            minHeight: 90, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8,
            padding: 10, color: theme.colors.text, fontSize: theme.fontSize.sm,
            textAlignVertical: 'top',
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Btn title="ja" onPress={() => speakOne(freeText, 'ja-JP')} /></View>
          <View style={{ flex: 1 }}><Btn title="ラテン" onPress={() => speakOne(freeText, latinLang)} /></View>
          <View style={{ flex: 1 }}><Btn title="分割" onPress={() => speakSplit(freeText)} /></View>
        </View>
      </View>

      <View style={card}>
        <Btn title="停止（Speech.stop）" onPress={() => Speech.stop()} tone="plain" />
      </View>

      {/* ---- 端末の音声一覧（全言語） ---- */}
      <View style={card}>
        <Text style={[body, { fontWeight: '700' }]}>
          この端末の音声：{languageCount} 言語 / {voices.length} 音声
        </Text>
        <Text style={label}>
          行をタップするとその声で自由入力欄を読む（対応言語を実測できる）。
          Enhanced は「設定 &gt; アクセシビリティ &gt; 読み上げコンテンツ &gt; 声」から個別ダウンロードが必要で、
          未ダウンロード端末での聞こえ方（Default）が既定値になる
        </Text>
        {sortedVoices.map((v) => (
          <Pressable
            key={v.identifier}
            onPress={() => speakWithVoice(v)}
            style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
          >
            <Text style={label}>
              {v.language} / {v.name}
              {v.quality === Speech.VoiceQuality.Enhanced ? ' / Enhanced' : ''}
            </Text>
          </Pressable>
        ))}
      </View>
    </SettingsDetail>
  );
}

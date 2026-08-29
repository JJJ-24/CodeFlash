import { getLocales } from 'expo-localization';
import * as Speech from 'expo-speech';

/**
 * 049/050：カード本文の読み上げ（TTS）。iOS の音声合成（`AVSpeechSynthesizer`）を
 * `expo-speech` 経由で使う。オフライン・無料・API キー不要。
 *
 * ここが解いている問題は **1発話＝1つの声** という制約。`Speech.speak()` はテキストの中身を見て
 * 言語を切り替えたりしないので、「日本語の説明文に英語の技術用語が埋まっている」カード
 * （＝このアプリで最も多い形）を日本語の声だけで読ませると、`idempotent` が「イデンポテント」に
 * なってしまう。そこで**文字体系ごとに区間へ割り、区間ごとに声を変えて順に流す**
 * （`speak()` は連続で呼ぶとキューに積まれる）。
 *
 * 処理は3段（**この順序に意味がある**。詳細は `docs/050`）：
 *
 * 1. `splitByScript`   … 文字体系で**細かく**割る（かな／漢字／ラテン／ハングル…）
 * 2. 言語への解決       … 文字体系 → 言語。漢字の日中判別はここ
 * 3. 言語で畳む         … 隣り合う**同じ言語**の区間をつなぐ
 *
 * ⚠️ 3 を「同じ文字体系で畳む」にしてはいけない。日本語は漢字とかなで文字体系が違うので、
 * 文字体系のまま畳むと1文が細切れになり、発話境界だらけで間延びする。
 */

/** 速度。1.0 が標準（実測で自然だったので既定値） */
export const SPEECH_RATE_DEFAULT = 1.0;

/**
 * タップで選べる3段階（遅い／標準／速い）。細かい値はスライダーで決めるので、
 * ここは「よく使う値」だけを置く（FSRS のプリセットとスライダーと同じ関係）。
 *
 * ⚠️ **値は4択だった頃のものをそのまま使う**（0.85 / 1.0 / 1.2）。プリセットを動かすと、
 * いまその値を使っている人の設定が「プリセットのどれでもない＝無選択」に化けるため。
 * 4択のうち 0.7 だけ落としたが、値は保持されスライダーに出る。
 */
export const SPEECH_RATE_PRESETS = [0.85, 1.0, 1.2];

/**
 * スライダーで選べる範囲と刻み。
 *
 * `expo-speech` は `utterance.rate = rate × AVSpeechUtteranceDefaultSpeechRate`（= 0.5）で
 * 渡し、AVFoundation が `AVSpeechUtteranceMinimum/MaximumSpeechRate`（= 0.0 / 1.0）で
 * クランプする。つまりアプリ側の倍率は **0.0〜2.0 が効く範囲**で、2.0 を超える値を選ばせると
 * 「上げたのに速くならない」＝オンに見えるのに効いていない状態になる。
 *
 * ⚠️ **その効く範囲いっぱい（0.5〜2.0）ではなく 0.30〜1.80 にしてある。** 上は 1.8
 * （AV 上限の 90%）より速いと実用にならず、下はもっと遅くまで要る、という実機判断。
 * ⚠️ **端が丸い数でないのは意図的**（FSRS の 70〜99% と同じ）。この範囲だと標準の 1.00 が
 * スライダーのほぼ中央（47%）に来る＝0.5〜2.0 では 33% で左に寄り、遅くする余地が狭く見えた。
 */
export const SPEECH_RATE_MIN = 0.3;
export const SPEECH_RATE_MAX = 1.8;
export const SPEECH_RATE_STEP = 0.05;

/** 範囲内へ丸める（スライダーの浮動小数の誤差も刻みに揃える）。 */
export function clampSpeechRate(v: number): number {
  const stepped = Math.round(v / SPEECH_RATE_STEP) * SPEECH_RATE_STEP;
  return Math.min(SPEECH_RATE_MAX, Math.max(SPEECH_RATE_MIN, Math.round(stepped * 100) / 100));
}

/**
 * この文字数以下のラテン片は隣の区間の言語へ倒す。
 *
 * **2 は実測で決めた値**（当初は 3）。狙いは `OK です`・`ID を入力`・`DB に保存` のような
 * **1〜2文字の断片のために声が切り替わるのを防ぐ**こと。この長さだと切り替えの間のほうが
 * 目立つうえ、日本語の声が「オーケー」「アイディー」と自然に読む。
 *
 * ⚠️ **3 にしない理由**：`CSS`（3文字）まで倒れると、同じ文の `HTML`（4文字）は英語の声に
 * 残るので**1つの文の中で読み分けが起きて分かりにくい**（実機で指摘された）。
 * ⚠️ 当初 3 にしたのは「英語の声が `API` を単語として発音して『アピ』になる」実測からだが、
 * **声を選べるようになった今の音声では `API` を正しく綴り読みする**ことを実機で確認した。
 * ⚠️ **正しい閾値は選んだ声に依存する**（略語を綴り読みしない声なら 3 が良い）。アプリからは
 * 判別できないので、ここは「今の既定の声で自然な値」として決めている。
 * ⚠️ これ以上上げると `useEffect` のような本来英語で読ませたい語まで倒れるので上げない。
 * ⚠️ **実測したのは日本語の声だけ**なので、倒すのは隣が日本語のときに限る（`isJapanese`）。
 */
const SHORT_LATIN_MAX = 2;

// ---- 文字体系 ---------------------------------------------------------------

export type SpeechScript =
  | 'latin' | 'kana' | 'han' | 'hangul' | 'cyrillic' | 'greek' | 'hebrew' | 'arabic'
  | 'devanagari' | 'bengali' | 'gurmukhi' | 'gujarati' | 'tamil' | 'telugu' | 'kannada'
  | 'malayalam' | 'sinhala' | 'thai' | 'lao' | 'tibetan' | 'myanmar' | 'georgian'
  | 'armenian' | 'khmer' | 'amharic';

/** 区間。`script` が `null` なら中立文字だけ（数字・記号）＝ どの声で読んでも同じ。 */
export interface SpeechSegment {
  text: string;
  script: SpeechScript | null;
}

/**
 * ラテン文字とみなす文字。**この文字列が定義元**（2つの正規表現が同じ集合を見るため）。
 *
 * - `A-Za-z` … ASCII
 * - `À-ÖØ-öø-ɏ` … U+00C0〜U+024F（Latin-1 補助の文字・拡張A・**拡張B**）。
 *   スペイン語 `ñ`・フランス語 `é`・ポーランド語 `ż`・トルコ語 `ğ` に加え、
 *   **ベトナム語の `ơ ư`・ルーマニア語の `ș ț`・拼音の `ǎ`**（いずれも拡張B）まで入る。
 * - `Ḁ-ỿ` … U+1E00〜U+1EFF（Latin Extended Additional）。**ベトナム語の声調つき `ạ ế ộ ứ`**。
 *
 * ⚠️ **拡張B・拡張追加を外すとベトナム語が壊れる**：外れた文字は「中立」に落ちるため、
 * 文の**先頭**に来ると区間の始まりを他の文字体系に譲り、短ラテン寄せの判定も狂う。
 * ⚠️ **`SCRIPT_RANGES` の他の範囲と交わらせない**（重ねると、文字単位ではない判定
 * ＝テキスト全体への `test` が誤爆する。実際にベトナム語の `ứng` が日本語側へ倒れた）。
 */
const LATIN_CHARS = 'A-Za-zÀ-ÖØ-öø-ɏḀ-ỿ';
const RE_LATIN = new RegExp(`[${LATIN_CHARS}]`);
const RE_NOT_LATIN_G = new RegExp(`[^${LATIN_CHARS}]`, 'g');

/**
 * 文字体系の範囲表。**先に一致したものが勝つ**ので、よく出るものから並べてある
 * （範囲は互いに交わらないので、順序は速度だけの問題）。
 *
 * ⚠️ **句読点・記号はどこにも入れない**＝中立にする。CJK 記号（U+3000–U+303F＝`、。「」`）も
 * **全角の約物**（U+FF01–U+FF65 の `，．！？`）も日中で共有するので、片方に寄せると
 * ①隣の本文から切り離されて発話が割れる ②`，` があるだけで「かなを含む」と誤判定され
 *   **中国語の文が日本語の声で読まれる**（実際に踏んだ）。全角英数も同じ理由で中立にし、
 *   隣の区間へ吸わせる（日本語文中なら日本語の声、中国語文中なら中国語の声になる）。
 * ⚠️ ここに無い文字体系（未対応）は中立になり、隣の区間へ吸われる。
 */
const SCRIPT_RANGES: { script: SpeechScript; re: RegExp }[] = [
  { script: 'latin', re: RE_LATIN },
  { script: 'kana', re: /[\u3040-\u30FF\u31F0-\u31FF\uFF66-\uFF9F]/ },
  { script: 'han', re: /[\u2E80-\u2FDF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/ },
  { script: 'hangul', re: /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7FF\uFFA0-\uFFDC]/ },
  { script: 'cyrillic', re: /[\u0400-\u052F\u1C80-\u1C8F\u2DE0-\u2DFF\uA640-\uA69F]/ },
  { script: 'greek', re: /[\u0370-\u03FF\u1F00-\u1FFF]/ },
  { script: 'arabic', re: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/ },
  { script: 'hebrew', re: /[\u0590-\u05FF\uFB1D-\uFB4F]/ },
  { script: 'devanagari', re: /[\u0900-\u097F\uA8E0-\uA8FF]/ },
  { script: 'thai', re: /[\u0E00-\u0E7F]/ },
  { script: 'bengali', re: /[\u0980-\u09FF]/ },
  { script: 'gurmukhi', re: /[\u0A00-\u0A7F]/ },
  { script: 'gujarati', re: /[\u0A80-\u0AFF]/ },
  { script: 'tamil', re: /[\u0B80-\u0BFF]/ },
  { script: 'telugu', re: /[\u0C00-\u0C7F]/ },
  { script: 'kannada', re: /[\u0C80-\u0CFF]/ },
  { script: 'malayalam', re: /[\u0D00-\u0D7F]/ },
  { script: 'sinhala', re: /[\u0D80-\u0DFF]/ },
  { script: 'lao', re: /[\u0E80-\u0EFF]/ },
  { script: 'tibetan', re: /[\u0F00-\u0FFF]/ },
  { script: 'myanmar', re: /[\u1000-\u109F]/ },
  { script: 'georgian', re: /[\u10A0-\u10FF\u1C90-\u1CBF]/ },
  { script: 'armenian', re: /[\u0530-\u058F]/ },
  { script: 'khmer', re: /[\u1780-\u17FF\u19E0-\u19FF]/ },
  { script: 'amharic', re: /[\u1200-\u137F]/ },
];

function scriptOf(ch: string): SpeechScript | null {
  for (const { script, re } of SCRIPT_RANGES) if (re.test(ch)) return script;
  return null;
}

/** テキストにその文字体系の文字が1つでもあるか。 */
function hasScript(text: string, script: SpeechScript): boolean {
  const re = SCRIPT_RANGES.find((s) => s.script === script)?.re;
  return re ? re.test(text) : false;
}

/**
 * テキストを文字体系で**細かく**割る（言語への解決はしない）。
 *
 * - 数字・記号・空白は**中立**として直前の区間へ吸わせる（単独で声を切り替えると間延びするため）
 * - **先頭の中立文字は次の区間へ吸わせる**。⚠️ かつては「先頭の中立は非ラテン区間として始める」
 *   だったため、`1. GET` のような英語カードが「非ラテン文字を含む」と誤判定され、
 *   短ラテン寄せで `GET` が「ゲット」と読まれていた
 * - 中立しか無いテキスト（`123` など）は1区間・`script: null` になる
 */
export function splitByScript(text: string): SpeechSegment[] {
  const runs: SpeechSegment[] = [];
  for (const ch of text) {
    const script = scriptOf(ch);
    const last = runs[runs.length - 1];
    if (script === null) {
      if (last) last.text += ch;
      else runs.push({ text: ch, script: null });
      continue;
    }
    if (!last) runs.push({ text: ch, script });
    else if (last.script === script) last.text += ch;
    else if (last.script === null) { last.text += ch; last.script = script; } // 先頭の中立を吸わせる
    else runs.push({ text: ch, script });
  }
  return runs;
}

// ---- 文字体系 → 言語 ---------------------------------------------------------

/** 文字体系ごとの言語の上書き（未指定は `SCRIPT_DEFAULT_LANGS`）。 */
export type ScriptLangs = Partial<Record<SpeechScript, string>>;

/**
 * 言語ごとに使う声（BCP-47 → `identifier`）。**文字体系ではなく言語で持つ**のは、
 * 区間が解決後の言語で畳まれるため（かなと漢字が同じ `ja-JP` になったとき、
 * 文字体系キーだとどちらの声か決まらない）。言語を変えても前の選択が残る利点もある。
 */
export type VoiceByLang = Record<string, string>;

/**
 * 端末の言語から漢字の既定を決める。日本語端末なら日本語、中国語端末なら中国語。
 * ⚠️ 対応表は持たない。`languageCode`＋`regionCode` を繋いで `ja-JP` / `zh-TW` を作る
 * （iOS の音声もこの形）。端末に無い組み合わせになっても iOS が近い声へ倒す。
 */
export function hanLangForLocale(locale?: { languageCode?: string | null; regionCode?: string | null }): string {
  const code = locale?.languageCode?.toLowerCase();
  if (!code || !HAN_LANG_PREFIXES.includes(code)) return 'ja-JP';
  return locale?.regionCode ? `${code}-${locale.regionCode.toUpperCase()}` : code;
}

const deviceHanLang = (() => {
  try {
    return hanLangForLocale(getLocales()[0]);
  } catch {
    return 'ja-JP';
  }
})();

/**
 * 文字体系の既定言語。**1つの文字体系を1つの言語しか使わないものは、これで確定**
 * （＝設定を出す必要が無い）。複数の言語で共有される文字体系だけ `CONFIGURABLE_SCRIPTS`。
 */
export const SCRIPT_DEFAULT_LANGS: Record<SpeechScript, string> = {
  latin: 'en-US',
  kana: 'ja-JP',
  han: deviceHanLang,
  hangul: 'ko-KR',
  cyrillic: 'ru-RU',
  greek: 'el-GR',
  hebrew: 'he-IL',
  arabic: 'ar-SA',
  devanagari: 'hi-IN',
  bengali: 'bn-IN',
  gurmukhi: 'pa-IN',
  gujarati: 'gu-IN',
  tamil: 'ta-IN',
  telugu: 'te-IN',
  kannada: 'kn-IN',
  malayalam: 'ml-IN',
  sinhala: 'si-LK',
  thai: 'th-TH',
  lao: 'lo-LA',
  tibetan: 'bo-CN',
  myanmar: 'my-MM',
  georgian: 'ka-GE',
  armenian: 'hy-AM',
  khmer: 'km-KH',
  amharic: 'am-ET',
};

/**
 * **設定を出す文字体系**＝複数の言語が同じ文字を使うため機械的に決められないもの。
 * ここに無い文字体系（ハングル・タイ・ギリシャ…）は1対1なので設定を出さない
 * （選ばせても意味が無く、設定画面が無駄に伸びる）。
 */
export const CONFIGURABLE_SCRIPTS: SpeechScript[] = ['latin', 'han', 'cyrillic', 'arabic', 'devanagari'];

// ---- デッキ単位の上書き（050 Phase 2）----------------------------------------

/**
 * デッキの上書きをアプリ設定に重ねる。**解決順はデッキ → アプリ → 文字体系の既定**。
 *
 * ⚠️ **上書きは「設定した文字体系だけ」**（丸ごと置き換えない）。中国語デッキで漢字だけ
 * 中国語にしたいときに、ラテン文字まで巻き込まれると英語の用語が中国語読みになる。
 * ⚠️ 空文字は「未設定」として無視する（JSON インポートや壊れた保存値の防御）。
 */
export function mergeScriptLangs(app: ScriptLangs, deck?: ScriptLangs | null): ScriptLangs {
  // 上書きが無いデッキでは**アプリ設定の参照をそのまま返す**（毎回新しいオブジェクトを作ると
  // `useSpeech` の `useMemo` が空振りし、そこから作る `speak` の参照まで毎回変わる）。
  if (!deck || Object.keys(deck).length === 0) return app;
  const out: ScriptLangs = { ...app };
  for (const [script, lang] of Object.entries(deck)) {
    if (typeof lang === 'string' && lang.trim() !== '') out[script as SpeechScript] = lang;
  }
  return out;
}

/**
 * DB の JSON 文字列（`decks.speechLangs`）を上書きマップに正規化する。
 *
 * ⚠️ **知らないキー・空の値は捨てる**＝iCloud や JSON インポートで新しいバージョンの値や
 * 壊れた値が来ても、読み上げ側は「未設定」に倒れるだけで落ちない。
 */
export function parseScriptLangs(json: string | null | undefined): ScriptLangs {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: ScriptLangs = {};
    for (const [script, lang] of Object.entries(raw as Record<string, unknown>)) {
      if (!(script in SCRIPT_DEFAULT_LANGS)) continue;
      if (typeof lang === 'string' && lang.trim() !== '') out[script as SpeechScript] = lang;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 上書きマップが同じ内容か。**キーの並び順に依存しない**（`JSON.stringify` で比べると
 * `{han,latin}` と `{latin,han}` が別物になり、デッキ編集の「変更あり」判定が誤爆する）。
 */
export function scriptLangsEqual(a: ScriptLangs, b: ScriptLangs): boolean {
  const ka = Object.keys(a) as SpeechScript[];
  const kb = Object.keys(b) as SpeechScript[];
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** 上書きマップを DB へ書く形にする。**空なら NULL**（列を「未設定」として扱えるように）。 */
export function serializeScriptLangs(langs: ScriptLangs | undefined): string | null {
  if (!langs) return null;
  const cleaned = parseScriptLangs(JSON.stringify(langs));
  return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
}

/** 一覧を絞るための「その文字体系を使う言語」の接頭辞。`latin` だけは除外リストで判定する。 */
const HAN_LANG_PREFIXES = ['ja', 'zh', 'yue', 'ko'];
const SCRIPT_LANG_PREFIXES: Partial<Record<SpeechScript, string[]>> = {
  han: HAN_LANG_PREFIXES,
  cyrillic: ['ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk', 'ky', 'mn', 'tg'],
  arabic: ['ar', 'fa', 'ur', 'ps', 'sd', 'ku', 'ug'],
  devanagari: ['hi', 'mr', 'ne', 'sa'],
};

/** `ja` / `ja-JP` のように日本語を指しているか。 */
const isJapanese = (lang: string) => lang.toLowerCase().startsWith('ja');

/**
 * 区間を言語へ解決する。**漢字の日中判別はここ**。
 *
 * 漢字は日本語と中国語（と韓国語の漢字）で同じコードポイントなので機械的には決まらない。
 * そこで**読み上げるテキスト全体**を見て推定する：
 *
 * 1. **かながあれば** → その漢字は日本語（かなと同じ声＝あとで1発話に畳まれる）
 * 2. **ハングルがあれば** → 韓国語（漢字ハングル混じり）
 * 3. どちらも無ければ → 設定値（既定は端末言語）
 *
 * ⚠️ **推定なので外れることがある**。`非同期処理` のような純漢字の日本語は、設定を中国語に
 * していると中国語で読まれる。逆に1つの面に `你好 ＝ こんにちは` と書くと、かなが優先されて
 * 中国語部分も日本語で読まれる。**デッキ単位の上書き（050 Phase 2）が本来の解**。
 */
function langForScript(script: SpeechScript | null, langs: ScriptLangs, text: string): string {
  if (script === 'han') {
    if (hasScript(text, 'kana')) return langs.kana ?? SCRIPT_DEFAULT_LANGS.kana;
    if (hasScript(text, 'hangul')) return langs.hangul ?? SCRIPT_DEFAULT_LANGS.hangul;
  }
  // 中立しか無いテキスト（数字だけ等）は漢字の言語で読む＝このアプリの「もう一方の声」。
  const key = script ?? 'han';
  return langs[key] ?? SCRIPT_DEFAULT_LANGS[key];
}

export interface ResolvedSegment {
  text: string;
  language: string;
}

/**
 * テキストを「読み上げる単位」へ変換する＝**分割 → 言語へ解決 → 言語で畳む**。
 * `speakText` の中身だが、検証（`npm run verify:speech`）から直接呼べるように分けてある。
 */
export function resolveSpeechSegments(
  text: string,
  langs: ScriptLangs = {},
  options: { noMixedSwitch?: boolean } = {},
): ResolvedSegment[] {
  const runs = splitByScript(text).map((run) => ({
    text: run.text,
    script: run.script,
    language: langForScript(run.script, langs, text),
  }));

  // 「混在文では声を分けない」＝ラテン区間を**周りの非ラテン文字と同じ声**にする。
  // ⚠️ **非ラテン文字を含むテキストのときだけ**効かせる。常に倒すと英語だけのカードまで
  // 日本語の声になり、このアプリの本命（英語の技術用語の発音を聞く）が失われる。
  // ⚠️ 倒す先は**その文に最初に出てくる非ラテン区間の言語**。`han` に固定すると、
  // ハングルやキリル文字と混ざる文でラテン文字だけ日本語の声になる（`Привет CSS` が
  // ロシア語＋日本語で読まれた）。最初の区間の言語なら日本語・韓国語・ロシア語のいずれでも
  // 文脈どおりになり、かな/漢字の推定（`langForScript`）もそのまま効く。
  if (options.noMixedSwitch) {
    const host = runs.find((r) => r.script !== null && r.script !== 'latin');
    if (host) for (const run of runs) if (run.script === 'latin') run.language = host.language;
  }

  // 短いラテン片を隣へ倒す（隣が日本語のときだけ＝閾値は日本語音声の実測値のため）。
  runs.forEach((run, i) => {
    if (run.script !== 'latin') return;
    if (run.text.replace(RE_NOT_LATIN_G, '').length > SHORT_LATIN_MAX) return;
    const neighbor = runs[i - 1] ?? runs[i + 1];
    if (neighbor && neighbor.script !== 'latin' && isJapanese(neighbor.language)) {
      run.language = neighbor.language;
    }
  });

  // ⚠️ 畳むのは**解決後の言語**が同じ区間（文字体系ではない）。漢字＋かなが1発話に戻る。
  const merged: ResolvedSegment[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.language === run.language) last.text += run.text;
    else merged.push({ text: run.text, language: run.language });
  }

  // 前後の空白を落とす。**同じ語がカードのどこにあっても同じ読みになる**ようにするため。
  // iOS の音声は**末尾に空白があると綴り読み/単語読みの判断を反転させる**（実機で確認）：
  //   "API"  → エーピーアイ ／ "API " → アピ
  //   "GUI"  → グイ         ／ "GUI " → ジーユーアイ
  // 中立文字は直前の区間へ吸わせる規則なので、**後ろに日本語が続くときだけ**ラテン区間の末尾に
  // 空白が付く＝同じ語なのに文中の位置で読みが変わっていた。区間は別々の発話としてキューへ
  // 積まれるので、空白を落としても**次の区間と文字列が連結されることはない**（単語が繋がる
  // 心配はない）。⚠️ **必ず畳んだ後に行う**＝畳む前に trim すると、同じ言語の区間を連結する
  // ときに本来あった語間の空白まで消える（`"これは " + "です"` → `"これはです"`）。
  return merged.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text !== '');
}

// ---- 文末の間（ピリオドの後が小文字のとき） ---------------------------------

/**
 * ピリオドの直前がこれらの語なら**文末ではない**ので切らない（`e.g. this` / `9 a.m. and`）。
 * 小文字にして末尾一致で見る。⚠️ **1文字の語（`J. r. r.` のようなイニシャル）も切らない**。
 */
const SENTENCE_ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'fig', 'no', 'approx',
  'inc', 'ltd', 'co', 'dept', 'est', 'al', 'e.g', 'i.e', 'a.m', 'p.m', 'u.s', 'u.k',
]);

/**
 * ピリオドで終わる断片の**最後の語**が「そこで切ってはいけない語」か。
 *
 * ①略語（`... e.g.` → `e.g`）②1文字のイニシャル（`J.`）
 * ③**全大文字の略語**（`API.` `HTML.` `S3.`）＝ ⚠️ **実機で見つかった理由がある**：
 * iOS の英語の声は `API. Next word`（文中）なら「エーピーアイ」と綴り読みするのに、
 * **`API.` が発話の末尾に来ると「アピ」と単語のように読む**。文を切ると末尾に来てしまうので、
 * ここでは切らずに1発話のまま読ませる（間より読みの正しさを優先する）。
 * 049 の「`API` と `API `（末尾空白つき）で読みが反転する」と同じ性質の現象。
 */
function endsWithAbbreviation(piece: string): boolean {
  const m = /([A-Za-z][A-Za-z0-9.]*)\.$/.exec(piece);
  if (!m) return false;
  const word = m[1];
  if (word.length === 1) return true;              // イニシャル（`J. r. r.`）
  if (/^[A-Z0-9.]+$/.test(word)) return true;      // 全大文字の略語（`API.` `HTML.` `S3.`）
  return SENTENCE_ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * **iOS が文末と判定してくれないピリオドの位置だけ**で文を切る（別々の発話にして間を作る）。
 *
 * iOS の音声エンジンは「ピリオド＋空白＋**大文字**」を文末と見なして一呼吸置くが、
 * **小文字や数字が続くと文末と見なさない**（`1.5` や `e.g.` と区別できないため）。実機と
 * iOS 純正の読み上げの両方で確認済み＝アプリの実装ではなくエンジンの仕様。
 * コード学習では `useEffect は…. props は…` のように**識別子から始まる文**が避けられず、
 * 書き手が正しく書いても小文字始まりになるので、そこだけアプリが補う。
 *
 * ⚠️ **大文字が続く位置では切らない**＝エンジンが既に間を入れているところに手を出さない
 * （二重の間にならないし、正しく書かれた英文の聞こえ方は今のまま）。
 * ⚠️ 空白を必須にするので `1.5` や `array.map()` は自動的に対象外。
 * ⚠️ **全大文字の略語の後でも切らない**（`API.` が発話の末尾に来ると綴り読みでなくなるため。
 * `endsWithAbbreviation` 参照）。
 * ⚠️ `!` `?` は対象にしない（エンジンが既に間を入れている可能性が高く、二重になる）。
 */
export function splitSentencesForPause(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  // ピリオド＋空白（改行含む）＋小文字/数字。空白は捨てる（断片は別発話なので繋がらない）
  const re = /\.\s+(?=[a-z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const piece = text.slice(start, m.index + 1); // ピリオドまでを1文にする
    if (endsWithAbbreviation(piece)) continue;    // 略語なら切らずに読み進める
    parts.push(piece);
    start = re.lastIndex;
  }
  parts.push(text.slice(start));
  // ⚠️ 各文は trim する（049：末尾の空白があると iOS が `API` を綴り読みしなくなる）
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

export interface SpeakOptions {
  /** 文字体系ごとの言語の上書き（設定から渡す。未指定は既定） */
  scriptLangs?: ScriptLangs;
  /**
   * 言語ごとに使う声（BCP-47 → `identifier`）。未指定の言語は端末の既定の声。
   * ⚠️ **端末に実在する identifier だけを渡すこと**（`filterKnownVoices`）。
   * 実在しない identifier を渡すと `expo-speech` が例外を投げる。
   */
  voices?: VoiceByLang;
  /** 日本語と混ざるときはラテン文字も同じ声で読む（読み分けが起きない） */
  noMixedSwitch?: boolean;
  rate: number;
  /** **最後の区間**を読み終えたときだけ呼ばれる。 */
  onDone?: () => void;
  /** `stopSpeech()` で打ち切られたときに呼ばれる（キューに残った区間の分も飛ぶ）。 */
  onStopped?: () => void;
}

/**
 * テキストを文字体系で割り、区間ごとに声を変えて順に読む。
 * 読む対象が空なら何もしない（呼び出し側で「読む文字が無いなら操作させない」判定に使える）。
 */
export function speakText(text: string, options: SpeakOptions): void {
  const segments = resolveSpeechSegments(text, options.scriptLangs ?? {}, {
    noMixedSwitch: options.noMixedSwitch,
  });
  if (segments.length === 0) return;
  // 区間をさらに文へ割る（間が入らないピリオドの位置だけ）。言語・声は区間のものを引き継ぐ。
  const utterances = segments.flatMap((seg) =>
    splitSentencesForPause(seg.text).map((text) => ({ text, language: seg.language })),
  );
  if (utterances.length === 0) return;
  Speech.stop();
  utterances.forEach((seg, i) => {
    const isLast = i === utterances.length - 1;
    const base = {
      language: seg.language,
      rate: options.rate,
      onDone: isLast ? options.onDone : undefined,
      onStopped: options.onStopped,
    };
    const voice = options.voices?.[seg.language];
    if (!voice) { Speech.speak(seg.text, base); return; }
    try {
      Speech.speak(seg.text, { ...base, voice });
    } catch {
      // ⚠️ 端末に無い identifier だと expo-speech が投げる（別端末から同期した設定など）。
      // 声を諦めて言語だけで読み直す＝**黙って無音になるのが一番まずい**ため。
      Speech.speak(seg.text, base);
    }
  });
}

/**
 * 試聴用のサンプル文（言語の接頭辞 → **その言語で書かれた文**）。
 *
 * ⚠️ **`locales` に置かない**。UI 言語に翻訳するものではなく、読み上げる声の言語で
 * 書かれていなければ試聴の意味が無いため（タイ語の声に日本語を読ませても評価できない）。
 * ⚠️ **表に無い言語は声の名前を読む**（`voiceSampleText`）。正しさを確信できない文を
 * 各国語で埋め込むより、名前を読むほうが害が無い。
 */
const VOICE_SAMPLE_TEXTS: Record<string, string> = {
  en: 'The quick brown fox jumps over the lazy dog.',   // pangram。`lazy` の /eɪ/ で豪州英語の母音を確かめられる
  ja: 'こんにちは。今日はいい天気ですね。',
  ko: '안녕하세요. 오늘 날씨가 좋네요.',
  zh: '你好，今天天气很好。',
  yue: '你好，今日天氣好好。',
  es: 'Hola, hoy hace buen tiempo.',
  fr: 'Bonjour, il fait beau aujourd\'hui.',
  de: 'Hallo, heute ist schönes Wetter.',
  it: 'Ciao, oggi è una bella giornata.',
  pt: 'Olá, hoje está um bom tempo.',
  nl: 'Hallo, het is mooi weer vandaag.',
  sv: 'Hej, det är fint väder idag.',
  da: 'Hej, det er godt vejr i dag.',
  nb: 'Hei, det er fint vær i dag.',
  no: 'Hei, det er fint vær i dag.',
  fi: 'Hei, tänään on kaunis sää.',
  pl: 'Cześć, dzisiaj jest ładna pogoda.',
  cs: 'Ahoj, dnes je hezké počasí.',
  sk: 'Ahoj, dnes je pekné počasie.',
  hu: 'Szia, ma szép idő van.',
  ro: 'Bună, astăzi este vreme frumoasă.',
  hr: 'Bok, danas je lijepo vrijeme.',
  ca: 'Hola, avui fa bon temps.',
  tr: 'Merhaba, bugün hava çok güzel.',
  id: 'Halo, cuaca hari ini bagus.',
  ms: 'Helo, cuaca hari ini baik.',
  vi: 'Xin chào, hôm nay trời đẹp.',
  th: 'สวัสดีครับ วันนี้อากาศดี',
  ru: 'Здравствуйте, сегодня хорошая погода.',
  uk: 'Привіт, сьогодні гарна погода.',
  el: 'Γεια σας, σήμερα ο καιρός είναι ωραίος.',
  he: 'שלום, מזג האוויר נעים היום.',
  ar: 'مرحبا، الطقس جميل اليوم.',
  hi: 'नमस्ते, आज मौसम अच्छा है।',
};

/** 試聴で読む文。表に無い言語は声の名前（`Karen` など）を読む。 */
export function voiceSampleText(language: string, voiceName: string): string {
  return VOICE_SAMPLE_TEXTS[language.split('-')[0].toLowerCase()] ?? voiceName;
}

/**
 * 声の試聴。**読み上げ本体と同じ速度**で鳴らす（実際の聞こえ方で判断できるように）。
 * ⚠️ 前の再生は必ず止める（連続タップで声が重なるため）。
 * ⚠️ 実在しない identifier は例外になるので、失敗したら声なしで読み直す。
 */
export function previewVoice(opts: { text: string; language: string; voice?: string; rate: number }): void {
  Speech.stop();
  const base = { language: opts.language, rate: opts.rate };
  try {
    Speech.speak(opts.text, opts.voice ? { ...base, voice: opts.voice } : base);
  } catch {
    Speech.speak(opts.text, base);
  }
}

/** 読み上げを止め、キューに残っている区間も破棄する。 */
export function stopSpeech(): void {
  Speech.stop();
}

// ---- 選択肢の一覧 ------------------------------------------------------------

/**
 * 端末が読める言語の一覧（BCP-47）を、その文字体系で使うものだけに絞って返す。
 *
 * **選択肢は端末から取る**（対応表をアプリ側に持たない＝OS が音声を増やせば自動で増える）。
 * 絞り込みだけは接頭辞で行う＝漢字の設定にフランス語が並んでも意味が無いため。
 */
export async function getSpeechLanguagesFor(script: SpeechScript): Promise<string[]> {
  try {
    return languagesForScript(await loadVoiceLanguages(), script);
  } catch {
    return [];
  }
}

/**
 * 設定を出す文字体系すべての選択肢を**音声一覧1回の取得**でまとめて返す。
 *
 * 設定画面が「**選択肢が2つ未満の行は出さない**」を判定するのに使う。端末に音声が1つしか
 * 無い文字体系（多くの端末でアラビア文字＝`ar-SA` のみ・デーヴァナーガリー＝`hi-IN` のみ）は
 * 選ばせる意味が無いため。⚠️ **アプリ側に「この文字体系は1つだけ」という表を持たない**＝
 * OS やユーザーが音声を足せば（設定 → アクセシビリティ → 読み上げコンテンツ → 声）
 * コードを変えずに行が現れる。
 */
export async function getConfigurableScriptLanguages(): Promise<Partial<Record<SpeechScript, string[]>>> {
  try {
    const all = await loadVoiceLanguages();
    const out: Partial<Record<SpeechScript, string[]>> = {};
    for (const script of CONFIGURABLE_SCRIPTS) out[script] = languagesForScript(all, script);
    return out;
  } catch {
    return {};
  }
}

/** 端末の音声1つぶん（ピッカーの行に出す情報）。 */
export interface SpeechVoice {
  identifier: string;
  name: string;
  language: string;
  /** 強化版・プレミアム版は 'Enhanced'。音質が高いぶんダウンロードが要る */
  quality: string;
}

/**
 * **奇抜な声**（macOS 由来のノベルティ音声）の identifier 末尾トークン。
 *
 * `Bad News` や `Zarvox` に単語を読ませる場面は学習アプリには無く、一覧が伸びるぶん邪魔になる
 * ので**ピッカーから外す**。⚠️ **`com.apple.speech.synthesis.voice.*` を接頭辞ごと弾かないこと**＝
 * 同じ場所に `Alex` のようなまっとうな高品質音声も入っているため、個別トークンで拒否する。
 * ⚠️ **表示名では弾かない**（端末の言語で訳されることがある。identifier は訳されない）。
 */
const NOVELTY_VOICE_TOKENS = new Set([
  'albert', 'badnews', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged',
  'goodnews', 'hysterical', 'jester', 'organ', 'superstar', 'trinoids', 'whisper',
  'wobble', 'zarvox',
]);

/** 奇抜な声か（ピッカーから外す判定）。⚠️ `Alex` のような同じ接頭辞のまともな声を巻き込まないこと。 */
export const isNoveltyVoice = (identifier: string) =>
  NOVELTY_VOICE_TOKENS.has(identifier.split('.').pop()?.toLowerCase() ?? '');

/**
 * 同時に走る `getAvailableVoicesAsync()` を1回にまとめる。
 *
 * 設定画面は表示中の言語ぶん（2〜5個）を `Promise.all` で並べて取るので、素直に書くと
 * ネイティブ呼び出しが言語の数だけ走る。**解決したら捨てる**ので次に呼べば取り直す
 * ＝OS で音声を足したときに古い結果を返し続けることはない。
 */
let voicesInFlight: Promise<Speech.Voice[]> | null = null;
function loadVoices(): Promise<Speech.Voice[]> {
  if (!voicesInFlight) {
    voicesInFlight = Speech.getAvailableVoicesAsync().finally(() => { voicesInFlight = null; });
  }
  return voicesInFlight;
}

/**
 * 直近に取得できた声の一覧（言語ごと）。**設定画面の初回描画に使うだけ**のキャッシュで、
 * 取得そのものは毎回やり直す＝OS で音声を増やせば次に開いたときに反映される（049/050 の規約）。
 * ⚠️ これが無いと、画面を開くたびに「声」の行が一拍おいて現れる（取得が非同期なため）。
 */
const lastVoicesByLang = new Map<string, SpeechVoice[]>();

/** 直近の取得結果のスナップショット（同期）。設定画面が state の初期値に使う。 */
export function getCachedVoicesByLanguage(): Record<string, SpeechVoice[]> {
  return Object.fromEntries(lastVoicesByLang);
}

/** その言語で使える声の一覧（ピッカー用）。名前順で返す。**奇抜な声は除く**。 */
export async function getVoicesForLanguage(language: string): Promise<SpeechVoice[]> {
  try {
    const voices = await loadVoices();
    const list = voices
      .filter((v) => v.language === language && !isNoveltyVoice(v.identifier))
      .map((v) => ({
        identifier: v.identifier,
        name: v.name || v.identifier,
        language: v.language,
        quality: String(v.quality ?? ''),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    lastVoicesByLang.set(language, list);
    return list;
  } catch {
    return [];
  }
}

/** 端末に実在する声の identifier 一式。`filterKnownVoices` に渡して検証に使う。 */
export async function getAvailableVoiceIds(): Promise<Set<string>> {
  try {
    const voices = await loadVoices();
    return new Set(voices.map((v) => v.identifier).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * **端末に実在する声だけを残す。**
 *
 * ⚠️ identifier は端末固有なので、iCloud 同期や JSON インポートで来た設定には
 * この端末に無いものが混ざりうる。実在しない identifier を `Speech.speak` に渡すと
 * `expo-speech` が例外を投げる（`InvalidVoiceException`）ので、**渡す前にここで落とす**。
 * ⚠️ `known` が空（取得前・取得失敗）のときは**何も渡さない**＝言語だけで読む安全側に倒す。
 */
export function filterKnownVoices(voices: VoiceByLang, known: Set<string>): VoiceByLang {
  const out: VoiceByLang = {};
  for (const [lang, id] of Object.entries(voices)) if (known.has(id)) out[lang] = id;
  return out;
}

async function loadVoiceLanguages(): Promise<string[]> {
  const voices = await loadVoices();
  return voices.map((v) => v.language).filter((l): l is string => !!l);
}

function languagesForScript(all: string[], script: SpeechScript): string[] {
  const allowed = SCRIPT_LANG_PREFIXES[script];
  const langs = new Set<string>();
  for (const lang of all) {
    const prefix = lang.split('-')[0].toLowerCase();
    // latin は「ラテン文字で書かれない言語」を除く形で絞る（対象言語が多すぎて列挙できない）。
    const ok = allowed ? allowed.includes(prefix) : !NON_LATIN_SCRIPT_PREFIXES.has(prefix);
    if (ok) langs.add(lang);
  }
  return [...langs].sort();
}

/** ラテン文字で書かれない言語（`latin` の選択肢から外す）。 */
const NON_LATIN_SCRIPT_PREFIXES = new Set([
  'ja', 'ko', 'zh', 'yue', 'ru', 'uk', 'bg', 'sr', 'mk', 'be', 'el', 'he', 'iw',
  'ar', 'fa', 'ur', 'hi', 'bn', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'pa', 'si',
  'th', 'lo', 'my', 'km', 'ka', 'hy', 'am', 'ne', 'yi',
]);

/**
 * 言語コード → その言語が使う文字体系。**049 の1つだけの設定から移行するため**に使う
 * （「非ラテンをこの言語で読む」という旧設定を、対応する文字体系の上書きへ移す）。
 */
export function scriptForLanguage(code: string): SpeechScript | undefined {
  const prefix = code.split('-')[0].toLowerCase();
  if (HAN_LANG_PREFIXES.includes(prefix)) return 'han'; // ja/zh/ko は漢字の設定へ寄せる
  for (const script of CONFIGURABLE_SCRIPTS) {
    if (SCRIPT_LANG_PREFIXES[script]?.includes(prefix)) return script;
  }
  const single: Record<string, SpeechScript> = {
    el: 'greek', he: 'hebrew', iw: 'hebrew', th: 'thai', lo: 'lao', my: 'myanmar',
    km: 'khmer', ka: 'georgian', hy: 'armenian', am: 'amharic', si: 'sinhala',
    bn: 'bengali', ta: 'tamil', te: 'telugu', kn: 'kannada', ml: 'malayalam',
    gu: 'gujarati', pa: 'gurmukhi',
  };
  return single[prefix];
}

/** 表示名の取得に使う（`useTranslation()` の `t` をそのまま渡す）。 */
type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** 地域サブタグ（`US` / `001`）を取り出す。`zh-Hans-CN` のような文字体系つきにも対応する。 */
function regionOf(code: string): string | undefined {
  return code
    .split('-')
    .slice(1)
    .find((part) => /^([A-Za-z]{2}|\d{3})$/.test(part))
    ?.toUpperCase();
}

/**
 * 言語コードを UI 言語の表示名にする（`en-AU` → 日本語 UI なら `英語（オーストラリア）`）。
 *
 * **地域を書くのは、同じ一覧に同じ言語が2つ以上並ぶときだけ**（`peers` を渡した場合）。
 * 端末に `cs-CZ` しか無ければ「チェコ語（チェコ）」と書いても区別する相手がおらず、
 * 名前が長くなって行からはみ出すだけ。`en-US`/`en-GB`/`en-AU` のように並ぶときだけ付ける。
 *
 * ⚠️ **「その言語の本国」の対応表は持たない**（`hanLangForLocale` と同じ方針）。表方式だと
 * pt→PT・ar→SA のような判断を抱えたうえ、**`pt-BR` しか無い端末でも「ポルトガル語（ブラジル）」
 * と出続ける**＝地域を書く意味が無い場面が残る。端末の一覧から決めれば OS が音声を増減した
 * ぶんだけ自動で切り替わる。
 * ⚠️ **`peers` を渡さない呼び出しは従来どおり地域つき**（並びの文脈が無い＝省略の判断ができない）。
 *
 * ⚠️ **表示名はアプリ側（`locales/*.json` の `speechLang` / `speechRegion`）に持つ**。
 * `Intl.DisplayNames` があれば OS から取れるが、**iOS の Hermes には入っていない**
 * （`DateTimeFormat`/`NumberFormat`/`Collator` はあるが `DisplayNames` は無いことを
 * `hermes.framework` の文字列で確認済み）。
 *
 * ⚠️ **表に無いコードはコードのまま返す**。選択肢は端末の音声一覧から作るので、
 * OS が新しい言語の音声を追加しても一覧には出続ける（ラベルが読めなくなるだけで壊れない）。
 */
export function speechLanguageLabel(code: string, t: Translate, peers?: readonly string[]): string {
  const lang = code.split('-')[0].toLowerCase();
  const langName = t(`speechLang.${lang}`, { defaultValue: '' });
  if (!langName) return code;
  const region = regionOf(code);
  if (!region || (peers !== undefined && !hasSameLanguagePeer(code, peers))) return langName;
  const regionName = t(`speechRegion.${region}`, { defaultValue: '' });
  return regionName ? t('settings.speechLangWithRegion', { language: langName, region: regionName }) : langName;
}

/**
 * `peers` の中に**同じ言語の別コード**があるか（＝地域を書かないと区別できないか）。
 *
 * ⚠️ **自分自身を必ず数に入れる**＝端末から消えた音声の言語が設定に残っていても
 * （`peers` に自分が居なくても）、同じ言語の別コードが並んでいれば地域を出す。
 */
function hasSameLanguagePeer(code: string, peers: readonly string[]): boolean {
  const lang = code.split('-')[0].toLowerCase();
  const same = new Set<string>();
  for (const p of [code, ...peers]) {
    const norm = p.toLowerCase();
    if (norm.split('-')[0] === lang) same.add(norm);
  }
  return same.size >= 2;
}

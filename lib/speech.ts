import { getLocales } from 'expo-localization';
import * as Speech from 'expo-speech';

/**
 * 049：カード本文の読み上げ（TTS）。iOS の音声合成（`AVSpeechSynthesizer`）を `expo-speech` 経由で使う。
 * オフライン・無料・API キー不要。
 *
 * ここが解いている問題は **1発話＝1つの声** という制約。`Speech.speak()` はテキストの中身を見て
 * 言語を切り替えたりしないので、「日本語の説明文に英語の技術用語が埋まっている」カード
 * （＝このアプリで最も多い形）を日本語の声だけで読ませると、`idempotent` が「イデンポテント」に
 * なってしまう。そこで**文字体系ごとに区間へ割り、区間ごとに声を変えて順に流す**
 * （`speak()` は連続で呼ぶとキューに積まれる）。実機実測の記録は `docs/049`。
 */

/** 速度。1.0 が標準（実測で自然だったので既定値） */
export const SPEECH_RATE_DEFAULT = 1.0;
export const SPEECH_RATES = [0.7, 0.85, 1.0, 1.2];

/** ラテン文字の区間を何語として読むかの既定。 */
export const SPEECH_LATIN_LANG_DEFAULT = 'en-US';

/**
 * この文字数以下のラテン片は非ラテン側へ倒す。
 *
 * **3 は実測で決めた値**。2 にすると `API`（3文字）が英語側に残り、
 * **英語の声が略語を綴り読みせず単語として発音して「アピ」になる**。
 * 3 なら日本語の声が「エーピーアイ」と正しく読む。
 * ⚠️ これ以上上げると `useEffect` のような本来英語で読ませたい語まで倒れるので上げない。
 * ⚠️ **実測したのは日本語の声だけ**なので、`speakText` は非ラテン側が日本語のときしか使わない。
 */
const SHORT_LATIN_MAX = 3;

export type SpeechScript = 'nonLatin' | 'latin';

export interface SpeechSegment {
  text: string;
  script: SpeechScript;
}

/**
 * ラテン文字**以外**の文字（＝もう一方の声で読む側）。
 *
 * ⚠️ **かな漢字だけを見てはいけない**。かつては `RE_JA` としてかな漢字・CJK 記号・全角形しか
 * 持っていなかったため、ハングル・キリル・タイ文字などは**どちらにも当たらず「中立」**になり、
 * 「直前の区間へ吸われる」規則によって**ラテン文字の後ろに続く韓国語が英語の声で読まれて**いた
 * （`hello 안녕` が丸ごとラテン区間）。文頭に来た場合だけ非ラテン区間として始まる、という
 * 位置依存の挙動になっていたのが実害。**能動的に判定する**ことでこれを解消する。
 *
 * ⚠️ **`LATIN_CHARS` と重ならないように切ってある**（U+1D00–U+1EFF＝音声記号拡張と
 * Latin Extended Additional を避けて 1CFF で止め、1F00 のギリシャ拡張から再開する）。
 * 重ねて「ラテン判定を先に評価するから大丈夫」にすると、**文字単位ではない判定**
 * （短ラテン寄せのガード＝テキスト全体に対する `test`）が誤爆する。実際にベトナム語の
 * `ứng` が「非ラテン文字を含む」と判定され、日本語側へ倒れた。**2つの集合は交わらせない。**
 */
const RE_NON_LATIN = new RegExp(
  '[' +
  '\\u0370-\\u1CFF' +   // ギリシャ・キリル・アルメニア・ヘブライ・アラビア・インド系・タイ・ラオ
                        // ・チベット・ミャンマー・ジョージア・ハングル字母・エチオピア・クメール
  '\\u1F00-\\u1FFF' +   // ギリシャ拡張（1E00–1EFF はラテン側なので飛ばす）
  '\\u2E80-\\uA4CF' +   // CJK 記号（、。「」）・かな・注音・ハングル互換字母・CJK 拡張A・漢字
  '\\uA960-\\uA97F' +   // ハングル字母拡張A
  '\\uAC00-\\uD7FF' +   // ハングル音節
  '\\uF900-\\uFAFF' +   // CJK 互換漢字
  '\\uFF00-\\uFFEF' +   // 半角・全角形（全角英数と半角カナ）
  ']'
);

/**
 * ラテン文字とみなす文字。**2つの正規表現の定義元**（片方だけ直すと閾値の数え方がずれる）。
 *
 * - `A-Za-z` … ASCII
 * - `À-ÖØ-öø-ɏ` … U+00C0〜U+024F（Latin-1 補助の文字・拡張A・**拡張B**）。
 *   スペイン語 `ñ`・フランス語 `é`・ポーランド語 `ż`・トルコ語 `ğ` に加え、
 *   **ベトナム語の `ơ ư`・ルーマニア語の `ș ț`・拼音の `ǎ`**（いずれも拡張B）まで入る。
 * - `Ḁ-ỿ` … U+1E00〜U+1EFF（Latin Extended Additional）。**ベトナム語の声調つき `ạ ế ộ ứ`**。
 *
 * ⚠️ **拡張B・拡張追加を外すとベトナム語が壊れる**：外れた文字は「中立」に落ちて直前の区間へ
 * 吸われるため、文の**先頭**に来ると非ラテン区間として始まり日本語の声で読まれる。さらに
 * `hasNonLatin` が立つので、`ứng` のような短い語が下の短ラテン寄せで丸ごと非ラテン側へ倒れる。
 */
const LATIN_CHARS = 'A-Za-zÀ-ÖØ-öø-ɏḀ-ỿ';
const RE_LATIN = new RegExp(`[${LATIN_CHARS}]`);
const RE_NOT_LATIN_G = new RegExp(`[^${LATIN_CHARS}]`, 'g');

/**
 * テキストを「ラテン文字の声で読む区間」と「それ以外の声で読む区間」に割る。
 *
 * ⚠️ **割れるのは文字体系であって言語ではない**。`Hola` と `Hello` はどちらもラテン文字なので
 * 区別できない（＝それぞれを何語として読むかは設定で決める。自動判別はしない・できない）。
 * 同じ理由で**非ラテン側も1つの声**なので、日本語と韓国語が同居するカードは分けられない。
 *
 * - 数字・記号・空白は**中立**として直前の区間へ吸わせる（単独で声を切り替えると間延びするため）
 * - `SHORT_LATIN_MAX` 文字以下のラテン片は非ラテン側へ倒す（「API を叩く」「OK です」対策）
 *
 * ⚠️ **短いラテン片の寄せは「非ラテン文字が実際に混ざっている文」にだけ適用する**。
 * 無条件に適用すると、表面が `GET` だけの単語カード（ラテン文字しか無い）まで
 * 日本語の声で「ゲット」と読まれる。単語カードでは致命的なので `hasNonLatin` で守る。
 * ⚠️ この判定は**区間ではなく元テキストの文字**で行う：先頭の数字・記号は中立のまま
 * 非ラテン区間を作るので、区間で数えると `1. GET` のような英語カードでもガードが素通りする。
 */
export function splitByScript(text: string, shortLatinMax: number = SHORT_LATIN_MAX): SpeechSegment[] {
  const runs: SpeechSegment[] = [];
  for (const ch of text) {
    const script: SpeechScript | null = RE_LATIN.test(ch) ? 'latin' : RE_NON_LATIN.test(ch) ? 'nonLatin' : null;
    const last = runs[runs.length - 1];
    if (script === null) {
      // 中立文字（数字・記号・空白）。先頭にあるときは非ラテン扱いで区間を始める。
      if (last) last.text += ch;
      else runs.push({ text: ch, script: 'nonLatin' });
      continue;
    }
    if (last && last.script === script) last.text += ch;
    else runs.push({ text: ch, script });
  }

  if (shortLatinMax > 0 && RE_NON_LATIN.test(text)) {
    for (const run of runs) {
      if (run.script !== 'latin') continue;
      if (run.text.replace(RE_NOT_LATIN_G, '').length <= shortLatinMax) run.script = 'nonLatin';
    }
  }

  // 倒した結果として隣り合った同種の区間をつなぎ直す（無駄な発話境界＝間を作らないため）。
  const merged: SpeechSegment[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.script === run.script) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged.filter((s) => s.text.trim() !== '');
}

export interface SpeakOptions {
  /** ラテン文字の区間を読む言語（BCP-47）。 */
  latinLang: string;
  /** ラテン文字**以外**の区間を読む言語（BCP-47）。かつては `ja-JP` 固定だった。 */
  nonLatinLang: string;
  rate: number;
  /** **最後の区間**を読み終えたときだけ呼ばれる。 */
  onDone?: () => void;
  /** `stopSpeech()` で打ち切られたときに呼ばれる（キューに残った区間の分も飛ぶ）。 */
  onStopped?: () => void;
}

/** `ja` / `ja-JP` のように日本語を指しているか。 */
const isJapanese = (lang: string) => lang.toLowerCase().startsWith('ja');

/**
 * テキストを文字体系で割り、区間ごとに声を変えて順に読む。
 * 読む対象が空なら何もしない（呼び出し側で「読む文字が無いなら操作させない」判定に使える）。
 *
 * ⚠️ **短いラテン片の寄せは非ラテン側が日本語のときだけ効かせる**。閾値3は
 * 「日本語の声なら `API` を『エーピーアイ』と正しく綴り読みする」という**実測**から決めた値で、
 * 他言語の声が同じように振る舞う保証がない（読み飛ばす声もありうる）。日本語以外を選んでいる
 * ときは倒さず、ラテン片はラテン側の声（既定は英語）に残すほうが確実。
 */
export function speakText(text: string, options: SpeakOptions): void {
  const segments = splitByScript(text, isJapanese(options.nonLatinLang) ? SHORT_LATIN_MAX : 0);
  if (segments.length === 0) return;
  Speech.stop();
  segments.forEach((seg, i) => {
    const isLast = i === segments.length - 1;
    Speech.speak(seg.text, {
      language: seg.script === 'nonLatin' ? options.nonLatinLang : options.latinLang,
      rate: options.rate,
      onDone: isLast ? options.onDone : undefined,
      onStopped: options.onStopped,
    });
  });
}

/** 読み上げを止め、キューに残っている区間も破棄する。 */
export function stopSpeech(): void {
  Speech.stop();
}

/**
 * 端末が読める言語の一覧（BCP-47）を、どちらの区間用かで絞って返す。
 *
 * **選択肢は端末から取る**（対応表をアプリ側に持たない＝OS が音声を増やせば自動で増える）。
 * 絞り込みだけは `NON_LATIN_SCRIPT_PREFIXES` で行う＝ラテン文字の区間に韓国語を、
 * 非ラテンの区間にフランス語を割り当てても意味が無いため。
 */
async function getSpeechLanguages(script: SpeechScript): Promise<string[]> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const langs = new Set<string>();
    for (const v of voices) {
      if (!v.language) continue;
      const isNonLatin = NON_LATIN_SCRIPT_PREFIXES.has(v.language.split('-')[0].toLowerCase());
      if (isNonLatin !== (script === 'nonLatin')) continue;
      langs.add(v.language);
    }
    return [...langs].sort();
  } catch {
    return [];
  }
}

/** ラテン文字の区間を読む言語の選択肢（＝ラテン文字を使う言語）。 */
export const getLatinSpeechLanguages = () => getSpeechLanguages('latin');
/** ラテン文字以外の区間を読む言語の選択肢（＝ラテン文字を使わない言語）。 */
export const getNonLatinSpeechLanguages = () => getSpeechLanguages('nonLatin');

/** ラテン文字で書かれない言語。2つの選択肢一覧を振り分ける唯一の基準。 */
const NON_LATIN_SCRIPT_PREFIXES = new Set([
  'ja', 'ko', 'zh', 'yue', 'ru', 'uk', 'bg', 'sr', 'mk', 'be', 'el', 'he', 'iw',
  'ar', 'fa', 'ur', 'hi', 'bn', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'pa', 'si',
  'th', 'lo', 'my', 'km', 'ka', 'hy', 'am', 'ne', 'yi',
]);

/**
 * ラテン文字以外の区間を読む言語の既定値。**端末の言語から決める**。
 *
 * 端末が非ラテン文字の言語（日本語・韓国語・中国語・ロシア語…）なら**その言語**、
 * ラテン文字の言語（英語など）なら `ja-JP`。後者を日本語にしておくのは、
 * ①この設定に用がある＝非ラテン文字のカードを持つ利用者で、UI 言語が英語の人は
 * 日本語学習者である可能性が高い ②**従来の固定値と同じ**なので既存利用者の挙動が変わらない、
 * の2つ（設定なので合わなければ変えられる）。
 *
 * ⚠️ 対応表は持たない。`languageCode` と `regionCode` を繋いで `ja-JP` / `ko-KR` /
 * `zh-CN` を作る（iOS の音声もこの形）。端末に無い組み合わせになっても iOS が近い声へ倒す。
 */
export function nonLatinLangForLocale(locale?: { languageCode?: string | null; regionCode?: string | null }): string {
  const code = locale?.languageCode?.toLowerCase();
  if (!code || !NON_LATIN_SCRIPT_PREFIXES.has(code)) return 'ja-JP';
  return locale?.regionCode ? `${code}-${locale.regionCode.toUpperCase()}` : code;
}

export const SPEECH_NON_LATIN_LANG_DEFAULT: string = (() => {
  try {
    return nonLatinLangForLocale(getLocales()[0]);
  } catch {
    return 'ja-JP';
  }
})();

/**
 * 言語コードの表示名。よく使うものだけ持ち、無いものはコードをそのまま出す
 * （選択肢は端末から取るので、ここに無い言語が並ぶのは正常）。
 */
export const SPEECH_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano',
  pt: 'Português', nl: 'Nederlands', sv: 'Svenska', da: 'Dansk', nb: 'Norsk',
  no: 'Norsk', fi: 'Suomi', pl: 'Polski', cs: 'Čeština', sk: 'Slovenčina',
  hu: 'Magyar', ro: 'Română', tr: 'Türkçe', id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu', vi: 'Tiếng Việt', ca: 'Català', hr: 'Hrvatski',
  // 非ラテン文字（＝もう一方の一覧に並ぶ言語）
  ja: '日本語', ko: '한국어', zh: '中文', yue: '粵語', ru: 'Русский',
  uk: 'Українська', bg: 'Български', sr: 'Српски', el: 'Ελληνικά',
  he: 'עברית', iw: 'עברית', ar: 'العربية', fa: 'فارسی', hi: 'हिन्दी',
  bn: 'বাংলা', ta: 'தமிழ்', te: 'తెలుగు', kn: 'ಕನ್ನಡ', ml: 'മലയാളം',
  mr: 'मराठी', gu: 'ગુજરાતી', th: 'ไทย', km: 'ភាសាខ្មែរ', ka: 'ქართული',
  hy: 'Հայերեն', my: 'မြန်မာ',
};

/** `en-US` → `English (en-US)` のような表示用ラベル。 */
export function speechLanguageLabel(code: string): string {
  const name = SPEECH_LANGUAGE_NAMES[code.split('-')[0].toLowerCase()];
  return name ? `${name} (${code})` : code;
}

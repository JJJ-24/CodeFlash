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

/** かな漢字の区間を読む言語。日本語固定（アプリの主な利用者が日本語話者のため）。 */
const JA_LANG = 'ja-JP';

/**
 * この文字数以下のラテン片は日本語側へ倒す。
 *
 * **3 は実測で決めた値**。2 にすると `API`（3文字）が英語側に残り、
 * **英語の声が略語を綴り読みせず単語として発音して「アピ」になる**。
 * 3 なら日本語の声が「エーピーアイ」と正しく読む。
 * ⚠️ これ以上上げると `useEffect` のような本来英語で読ませたい語まで倒れるので上げない。
 */
const SHORT_LATIN_MAX = 3;

export type SpeechScript = 'ja' | 'latin';

export interface SpeechSegment {
  text: string;
  script: SpeechScript;
}

// かな・カタカナ・漢字・CJK 記号（、。「」）・全角形。
const RE_JA = /[぀-ヿ㐀-䶿一-鿿　-〿＀-￯]/;
// ラテン文字。スペイン語の á/ñ・フランス語の é なども読ませたいので拡張ラテンまで含める。
const RE_LATIN = /[A-Za-zÀ-ÖØ-öø-ſ]/;
const RE_NOT_LATIN_G = /[^A-Za-zÀ-ÖØ-öø-ſ]/g;

/**
 * テキストを「日本語の声で読む区間」と「ラテン文字の声で読む区間」に割る。
 *
 * ⚠️ **割れるのは文字体系であって言語ではない**。`Hola` と `Hello` はどちらもラテン文字なので
 * 区別できない（＝ラテン文字を何語として読むかは設定で決める。自動判別はしない・できない）。
 *
 * - 数字・記号・空白は**中立**として直前の区間へ吸わせる（単独で声を切り替えると間延びするため）
 * - `SHORT_LATIN_MAX` 文字以下のラテン片は日本語側へ倒す（「API を叩く」「OK です」対策）
 *
 * ⚠️ **短いラテン片の日本語寄せは「日本語が混ざっている文」にだけ適用する**。
 * 無条件に適用すると、表面が `GET` だけの単語カード（ラテン文字しか無い）まで
 * 日本語の声で「ゲット」と読まれる。単語カードでは致命的なので `hasJa` で守る。
 */
export function splitByScript(text: string, shortLatinMax: number = SHORT_LATIN_MAX): SpeechSegment[] {
  const runs: SpeechSegment[] = [];
  for (const ch of text) {
    const script: SpeechScript | null = RE_LATIN.test(ch) ? 'latin' : RE_JA.test(ch) ? 'ja' : null;
    const last = runs[runs.length - 1];
    if (script === null) {
      // 中立文字（数字・記号・空白）。先頭にあるときは日本語扱いで区間を始める。
      if (last) last.text += ch;
      else runs.push({ text: ch, script: 'ja' });
      continue;
    }
    if (last && last.script === script) last.text += ch;
    else runs.push({ text: ch, script });
  }

  const hasJa = runs.some((r) => r.script === 'ja');
  if (shortLatinMax > 0 && hasJa) {
    for (const run of runs) {
      if (run.script !== 'latin') continue;
      if (run.text.replace(RE_NOT_LATIN_G, '').length <= shortLatinMax) run.script = 'ja';
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
  const segments = splitByScript(text);
  if (segments.length === 0) return;
  Speech.stop();
  segments.forEach((seg, i) => {
    const isLast = i === segments.length - 1;
    Speech.speak(seg.text, {
      language: seg.script === 'ja' ? JA_LANG : options.latinLang,
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
 * 端末が読める言語の一覧（BCP-47）を返す。**ラテン文字を使わない言語は除く**
 * （この一覧の用途が「ラテン文字の区間を何語として読むか」の選択肢だけのため）。
 */
export async function getLatinSpeechLanguages(): Promise<string[]> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const langs = new Set<string>();
    for (const v of voices) {
      if (!v.language) continue;
      if (NON_LATIN_SCRIPT_PREFIXES.has(v.language.split('-')[0].toLowerCase())) continue;
      langs.add(v.language);
    }
    return [...langs].sort();
  } catch {
    return [];
  }
}

/** ラテン文字で書かれない言語（この設定の選択肢から外す）。 */
const NON_LATIN_SCRIPT_PREFIXES = new Set([
  'ja', 'ko', 'zh', 'yue', 'ru', 'uk', 'bg', 'sr', 'mk', 'be', 'el', 'he', 'iw',
  'ar', 'fa', 'ur', 'hi', 'bn', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'pa', 'si',
  'th', 'lo', 'my', 'km', 'ka', 'hy', 'am', 'ne', 'yi',
]);

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
};

/** `en-US` → `English (en-US)` のような表示用ラベル。 */
export function speechLanguageLabel(code: string): string {
  const name = SPEECH_LANGUAGE_NAMES[code.split('-')[0].toLowerCase()];
  return name ? `${name} (${code})` : code;
}

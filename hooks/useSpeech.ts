import { useCallback, useEffect, useMemo, useState } from 'react';

import { filterKnownVoices, getAvailableVoiceIds, mergeScriptLangs, speakText, stopSpeech, type ScriptLangs } from '@/lib/speech';
import { useSettingsStore } from '@/store/settings';

/**
 * 049：読み上げの再生状態を持つフック。設定（速度・文字体系ごとの言語）はストアから取る。
 *
 * 050 Phase 2：`deckLangs`（デッキ単位の上書き）を渡すと**設定した文字体系だけ**アプリ設定に
 * 重なる。⚠️ 呼び出し側は**いま読むカードの所属デッキ**の値を渡すこと（タグ学習は1セッションに
 * 複数デッキが混ざるので、セッションのデッキで固定すると別デッキのカードに他所の設定が効く）。
 *
 * `speaking` は**ボタンの見た目（スピーカー ⇄ 停止）**に使う。区間分割で複数の発話を
 * キューに積むため、完了判定は**最後の区間の `onDone`** で行う（`lib/speech.ts` 側で付ける）。
 *
 * ⚠️ **止め忘れを避けるため、停止は呼び出し側で「表示が変わったら止める」形にすること**。
 * カード送り・表裏反転・メモ開閉・画面離脱のたびに個別に `stop()` を書くと必ずどれか漏れる
 * （前のカードの読み上げが次のカードに被る）。`useEffect` の依存に「今読んでいる対象を決める値」を
 * 並べて `stop()` を呼ぶのが確実。
 */
export function useSpeech(deckLangs?: ScriptLangs) {
  const [speaking, setSpeaking] = useState(false);
  const speechRate = useSettingsStore((s) => s.speechRate);
  const appScriptLangs = useSettingsStore((s) => s.speechScriptLangs);
  const speechVoices = useSettingsStore((s) => s.speechVoices);
  const speechNoMixedSwitch = useSettingsStore((s) => s.speechNoMixedSwitch);

  // ⚠️ **端末に実在する声だけを渡す**。identifier は端末固有で、iCloud 同期や JSON
  // インポートで来た設定には無いものが混ざる。存在しない identifier を渡すと
  // expo-speech が例外を投げるため、一覧を1回取って突き合わせる（取得前は声を渡さない）。
  const [knownVoiceIds, setKnownVoiceIds] = useState<Set<string> | null>(null);
  useEffect(() => { getAvailableVoiceIds().then(setKnownVoiceIds).catch(() => {}); }, []);
  const voices = useMemo(
    () => (knownVoiceIds ? filterKnownVoices(speechVoices, knownVoiceIds) : {}),
    [speechVoices, knownVoiceIds],
  );

  // デッキ → アプリ → 既定 の順で解決する（既定は `resolveSpeechSegments` 側が当てる）。
  const scriptLangs = useMemo(() => mergeScriptLangs(appScriptLangs, deckLangs), [appScriptLangs, deckLangs]);

  const stop = useCallback(() => {
    stopSpeech();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!text.trim()) return;
    speakText(text, {
      rate: speechRate,
      scriptLangs,
      voices,
      noMixedSwitch: speechNoMixedSwitch,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
    });
    setSpeaking(true);
  }, [speechRate, scriptLangs, voices, speechNoMixedSwitch]);

  /** 読み上げ中なら止める、そうでなければ読む（ボタン・キーの両方から使う）。 */
  const toggle = useCallback((text: string) => {
    if (speaking) stop();
    else speak(text);
  }, [speaking, speak, stop]);

  // アンマウント時は必ず止める（画面を離れたのに声だけ残るのを防ぐ）。
  useEffect(() => stop, [stop]);

  return { speaking, speak, stop, toggle };
}

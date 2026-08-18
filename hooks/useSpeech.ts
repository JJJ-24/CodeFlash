import { useCallback, useEffect, useState } from 'react';

import { speakText, stopSpeech } from '@/lib/speech';
import { useSettingsStore } from '@/store/settings';

/**
 * 049：読み上げの再生状態を持つフック。設定（速度・ラテン文字の言語）はストアから取る。
 *
 * `speaking` は**ボタンの見た目（スピーカー ⇄ 停止）**に使う。区間分割で複数の発話を
 * キューに積むため、完了判定は**最後の区間の `onDone`** で行う（`lib/speech.ts` 側で付ける）。
 *
 * ⚠️ **止め忘れを避けるため、停止は呼び出し側で「表示が変わったら止める」形にすること**。
 * カード送り・表裏反転・メモ開閉・画面離脱のたびに個別に `stop()` を書くと必ずどれか漏れる
 * （前のカードの読み上げが次のカードに被る）。`useEffect` の依存に「今読んでいる対象を決める値」を
 * 並べて `stop()` を呼ぶのが確実。
 */
export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const speechRate = useSettingsStore((s) => s.speechRate);
  const speechLatinLang = useSettingsStore((s) => s.speechLatinLang);

  const stop = useCallback(() => {
    stopSpeech();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!text.trim()) return;
    speakText(text, {
      rate: speechRate,
      latinLang: speechLatinLang,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
    });
    setSpeaking(true);
  }, [speechRate, speechLatinLang]);

  /** 読み上げ中なら止める、そうでなければ読む（ボタン・キーの両方から使う）。 */
  const toggle = useCallback((text: string) => {
    if (speaking) stop();
    else speak(text);
  }, [speaking, speak, stop]);

  // アンマウント時は必ず止める（画面を離れたのに声だけ残るのを防ぐ）。
  useEffect(() => stop, [stop]);

  return { speaking, speak, stop, toggle };
}

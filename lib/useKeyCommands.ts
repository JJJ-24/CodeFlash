import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import * as KeyCommand from 'react-native-key-command';

import { useSettingsStore } from '@/store/settings';

export type KeyCommandSpec = {
  /** 登録キー。文字は 'j' 等、特殊キーは KeyCommand.constants.keyInput*（Esc/矢印）。 */
  input: string;
  /** 修飾フラグ。既定 0。Cmd は KeyCommand.constants.keyModifierCommand。 */
  modifierFlags?: number;
  /** 発火時の処理。 */
  handler: () => void;
};

// 登録時の定数と、イベント payload の input（特殊キーは小文字の特殊文字列で返る）を
// 揺らぎなく突き合わせるため、両者を小文字文字列化して比較する。
const norm = (x: unknown) => String(x).toLowerCase();

/**
 * 034: ハードウェアキーボードのショートカットを、隠し TextInput を使わず
 * ネイティブ UIKeyCommand（react-native-key-command）で受ける共通フック。
 *
 * - 画面フォーカス中 **かつ** `keyboardShortcutsEnabled` のときだけ登録（focus 連動・無効時は何もしない）。
 * - 実 TextInput フォーカス中は OS がキーを入力欄へ渡すため、ショートカットは自然と発火しない（住み分け）。
 * - 引数 specs は毎レンダー変わってよい（ref 経由で最新を参照。登録/解除は focus/blur 単位）。
 */
export function useKeyCommands(specs: KeyCommandSpec[]) {
  const enabled = useSettingsStore((s) => s.keyboardShortcutsEnabled);
  const specsRef = useRef(specs);
  specsRef.current = specs;

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const cmds = specsRef.current.map((s) => ({
        input: s.input,
        modifierFlags: s.modifierFlags ?? 0,
      }));
      KeyCommand.registerKeyCommands(cmds);
      const sub = KeyCommand.eventEmitter.addListener('onKeyCommand', (p) => {
        const pin = norm(p.input);
        const pmod = p.modifierFlags ?? 0;
        const hit = specsRef.current.find(
          (s) => norm(s.input) === pin && (s.modifierFlags ?? 0) === pmod,
        );
        hit?.handler();
      });
      return () => {
        sub.remove();
        KeyCommand.unregisterKeyCommands(cmds);
      };
    }, [enabled]),
  );
}

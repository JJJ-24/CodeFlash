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
 * Backspace キー。iOS の UIKeyCommand では Mac/iPad キーボードの「delete」キー
 * （＝唯一の削除キー）は入力文字 '\b'（U+0008）として届く。矢印/Tab と違い
 * フォーカスエンジンに予約されていないため、優先フラグなしで安全に登録できる。
 */
export const KEY_DELETE = '\b';

/**
 * 前方削除（forward delete）キー＝フルサイズ外付けキーボードにある独立した「Delete」キー。
 * iPad/Mac ノートにはこのキーが無く、唯一の削除キーは Backspace。
 * UIKeyCommand に渡すべき入力文字が環境により異なる（DEL=U+007F か NSDeleteFunctionKey=U+F728）
 * ため両候補を登録して取りこぼさない。誤入力は入力欄非フォーカス時のみ発火するため無害。
 */
export const KEY_DELETE_FORWARD_CANDIDATES = ['\u007F', '\uF728'];

/**
 * 削除ハンドラを Backspace と前方 Delete（候補すべて）へ割り当てる spec を返す。
 * どのキーボードでも削除できるよう、削除系ショートカットはこれを spread して使う。
 */
export const deleteKeySpecs = (handler: () => void): KeyCommandSpec[] => [
  { input: KEY_DELETE, handler },
  ...KEY_DELETE_FORWARD_CANDIDATES.map((input) => ({ input, handler })),
];

/**
 * PageUp / PageDown キー（フルサイズ外付けキーボードのみ。iPad/Mac ノートには無い）。
 * iOS 公式の UIKeyInputPageUp / UIKeyInputPageDown 定数を使う（patches/ でライブラリの
 * ネイティブ定数に追加済み）。直接の文字推測（U+F72C/F72D 等）では発火しなかったため、
 * 矢印キーと同じく「本物の定数」を渡す方式に統一。定数未取得時のみ旧推測値へフォールバック（非空を保証）。
 */
export const KEY_PAGE_UP = (KeyCommand.constants?.keyInputPageUp as string) || '\uF72C';
export const KEY_PAGE_DOWN = (KeyCommand.constants?.keyInputPageDown as string) || '\uF72D';

/**
 * Home / End キー（フルサイズ外付けキーボードのみ）。最上部 / 最下部へ一気にスクロールする用途。
 * iOS 公式の UIKeyInputHome / UIKeyInputEnd 定数を使う（patches/ でネイティブ定数に追加済み）。
 * 定数未取得時のみ旧来の NSEvent 値（Home=U+F729 / End=U+F72B）へフォールバック（非空を保証）。
 */
export const KEY_HOME = (KeyCommand.constants?.keyInputHome as string) || '\uF729';
export const KEY_END = (KeyCommand.constants?.keyInputEnd as string) || '\uF72B';

/**
 * 034: ハードウェアキーボードのショートカットを、隠し TextInput を使わず
 * ネイティブ UIKeyCommand（react-native-key-command）で受ける共通フック。
 *
 * - 画面フォーカス中 **かつ** `keyboardShortcutsEnabled` のときだけ登録（focus 連動・無効時は何もしない）。
 * - 実 TextInput フォーカス中は OS がキーを入力欄へ渡すため、ショートカットは自然と発火しない（住み分け）。
 * - 引数 specs は毎レンダー変わってよい（ref 経由で最新を参照。登録/解除は focus/blur 単位）。
 *
 * 注意（iPad）: iPad は keyCommands をキャッシュするため、矢印/Tab を「優先付きで一度登録 → 後で
 * 動的に登録解除」しても、編集中にキャッシュが矢印/Tab を奪い続けカーソル移動/インデントが効かない。
 * そのため**編集が起きる画面（カードエディタ・学習画面）では矢印/Tab を最初から登録しない**運用にする。
 */
export function useKeyCommands(specs: KeyCommandSpec[], active: boolean = true) {
  const enabled = useSettingsStore((s) => s.keyboardShortcutsEnabled);
  const specsRef = useRef(specs);
  specsRef.current = specs;

  // `active`：同じ入力（j/k/Space 等）を複数の useKeyCommands が同時登録するのを防ぐゲート。
  // ネイティブ HardwareShortcut は isEqual/hash 未実装＝内容一致で重複保持されるため、常時マウントの
  // モーダル（ピッカー）と親画面が同じキーを登録すると 1 押下で複数回発火する（J/K が2つ進む・Space が
  // 偶数回トグルで相殺＝無反応 等）。表示側だけ active=true にして登録を一本化する。文字キー・iPhone
  // 矢印のみを出し入れする用途に限る（iPad の矢印/Tab は元々登録しない＝フリーズ回避）。
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !active) return;
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
    }, [enabled, active]),
  );
}

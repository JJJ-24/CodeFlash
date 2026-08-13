import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type { ScrollView } from 'react-native';
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
 * Esc キーと、その代替キー。iPad の Magic Keyboard など Esc キーが無いキーボードでも
 * 同等の操作（モーダル/シート/選択モードを閉じる・編集解除・戻る等）ができるよう、
 * 各画面の Esc spec を自動的に下記キーへも複製する（useKeyCommands 内で展開）。
 *
 * - バッククォート `` ` ``：iPad Magic Keyboard では Esc があった物理位置にこのキーがある。
 *   単独キーで直感的。ただし実 TextInput フォーカス中は文字 '`' が入力され発火しない（住み分け＝
 *   コード入力の邪魔をしない）。非入力時のダイアログ/モード解除/戻るに効く。
 * - Cmd + .（ピリオド）：iOS/macOS 標準の「キャンセル」。修飾付きのためテキスト編集中でも
 *   入力欄に消費されず発火する＝入力欄から抜ける用途も含め Esc の全機能を代替できる。
 */
const KEY_ESCAPE = (KeyCommand.constants?.keyInputEscape as string) ?? '';
const KEY_ENTER = (KeyCommand.constants?.keyInputEnter as string) ?? '';
const KEY_MOD_COMMAND = (KeyCommand.constants?.keyModifierCommand as number) ?? 0;
const KEY_MOD_SHIFT = (KeyCommand.constants?.keyModifierShift as number) ?? 0;
export const KEY_ESC_ALT_BACKTICK = '`';

/** Esc（修飾なし）の spec を、代替キー（バッククォート・Cmd+.）へも複製した配列を返す。 */
function expandEscapeAliases(specs: KeyCommandSpec[]): KeyCommandSpec[] {
  if (!KEY_ESCAPE) return specs;
  const escNorm = norm(KEY_ESCAPE);
  const out: KeyCommandSpec[] = [];
  for (const s of specs) {
    out.push(s);
    if (norm(s.input) === escNorm && (s.modifierFlags ?? 0) === 0) {
      out.push({ input: KEY_ESC_ALT_BACKTICK, handler: s.handler });
      if (KEY_MOD_COMMAND) {
        out.push({ input: '.', modifierFlags: KEY_MOD_COMMAND, handler: s.handler });
      }
    }
  }
  return out;
}

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
 * \u753B\u9762\u30B9\u30AF\u30ED\u30FC\u30EB\u306E\u5171\u901A\u30AD\u30FC spec\uFF08U/D\uFF1D\u6BB5\u968E\u3001PgUp/PgDn\uFF1D\u540C\u3001Home/End\uFF1D\u6700\u4E0A\u90E8/\u6700\u4E0B\u90E8\u3001
 * \u21E7U/\u21E7D\uFF1DHome/End \u306E\u7121\u3044\u30AD\u30FC\u30DC\u30FC\u30C9\u5411\u3051\u306E\u6700\u4E0A\u90E8/\u6700\u4E0B\u90E8\uFF09\u3002
 * \u30D5\u30A9\u30FC\u30E0\u7CFB\u30E2\u30FC\u30C0\u30EB\uFF08\u30C7\u30C3\u30AD/\u30BF\u30B0\u306E\u65B0\u898F\u30FB\u7DE8\u96C6\uFF09\u306E\u30E1\u30A4\u30F3 spec \u914D\u5217\u3078 spread \u3057\u3066\u4F7F\u3046\u3002
 * `guard` \u304C true \u3092\u8FD4\u3059\u9593\u306F\u7121\u8996\u3059\u308B\uFF08\u30B5\u30D6\u30E2\u30FC\u30C0\u30EB\u8868\u793A\u4E2D\u306E\u6291\u6B62\uFF09\u3002
 */
export function scrollKeySpecs(opts: {
  scrollRef: RefObject<ScrollView | null>;
  scrollYRef: RefObject<number>;
  step?: number;
  guard?: () => boolean;
}): KeyCommandSpec[] {
  const { scrollRef, scrollYRef, step = 240, guard } = opts;
  const blocked = () => guard?.() === true;
  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current + delta), animated: true });
  };
  const toTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });
  const toEnd = () => scrollRef.current?.scrollToEnd({ animated: true });
  return [
    { input: 'u', handler: () => { if (blocked()) return; scrollBy(-step); } },
    { input: 'd', handler: () => { if (blocked()) return; scrollBy(step); } },
    { input: KEY_PAGE_UP, handler: () => { if (blocked()) return; scrollBy(-step); } },
    { input: KEY_PAGE_DOWN, handler: () => { if (blocked()) return; scrollBy(step); } },
    { input: KEY_HOME, handler: () => { if (blocked()) return; toTop(); } },
    { input: KEY_END, handler: () => { if (blocked()) return; toEnd(); } },
    // Home/End \u306E\u7121\u3044\u30AD\u30FC\u30DC\u30FC\u30C9\u5411\u3051\uFF1AShift+U=\u6700\u4E0A\u90E8 / Shift+D=\u6700\u4E0B\u90E8\u3002
    { input: 'u', modifierFlags: KEY_MOD_SHIFT, handler: () => { if (blocked()) return; toTop(); } },
    { input: 'd', modifierFlags: KEY_MOD_SHIFT, handler: () => { if (blocked()) return; toEnd(); } },
  ];
}

/**
 * \u30B7\u30E7\u30FC\u30C8\u30AB\u30C3\u30C8\u4E00\u89A7\uFF08ShortcutsModal\uFF09\u306E\u958B\u9589\u30AD\u30FC\u3092\u4E00\u62EC\u767B\u9332\u3059\u308B\u5171\u901A\u30D5\u30C3\u30AF\u3002
 *
 * - \u975E\u8868\u793A\u4E2D\u306E\u307F\uFF1A?\uFF08Shift+/\uFF09= `open` \u3092\u767A\u706B\uFF08\u8868\u793A\u4E2D\u306F\u767B\u9332\u3092\u5916\u3059\uFF1D\u30E2\u30FC\u30C0\u30EB\u5074\u306E ? \u3068
 *   \u540C\u4E00\u5185\u5BB9\u30B3\u30DE\u30F3\u30C9\u304C\u5171\u5B58\u3057\u3066\u76F8\u4E92\u524A\u9664\u3055\u308C\u308B\u306E\u3092\u9632\u3050\u3002\u9589\u3058\u308B\u3068\u518D\u767B\u9332\u3055\u308C\u3001\u518D\u8868\u793A\u3067\u304D\u308B\uFF09\u3002
 * - \u8868\u793A\u4E2D\u306E\u307F\uFF1AEsc / Return = `close`\uFF08\u30E1\u30A4\u30F3 spec \u914D\u5217\u3092 active gate \u3067\u89E3\u9664\u3057\u3066\u3044\u308B\u9593\u306E
 *   \u5206\u3092\u88DC\u3046\u3002\u30E1\u30A4\u30F3\u5074\u3068\u306F\u6392\u4ED6\uFF09\u3002
 *
 * `open` \u306B\u306F\u5404\u753B\u9762\u306E\u30AC\u30FC\u30C9\uFF08subModalOpen \u7B49\uFF09\u3084 Keyboard.dismiss() \u3092\u542B\u3081\u305F\u9589\u5305\u3092\u6E21\u3059\u3002
 */
export function useShortcutsToggleKeys(visible: boolean, open: () => void, close: () => void) {
  useKeyCommands([
    { input: '/', modifierFlags: KEY_MOD_SHIFT, handler: open },
  ], !visible);
  useKeyCommands([
    { input: KEY_ESCAPE, handler: close },
    { input: KEY_ENTER, handler: close },
  ], visible);
}

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
/**
 * ネイティブ登録の参照カウント（キー＝input＋修飾）。**ライブラリ側に「誰が登録したか」が無い**ため
 * ここで面倒を見る。`HardwareShortcuts.m` の実装はこうなっている：
 * - `registerKeyCommand:` は毎回 `_commands` に**追加**する（同じキーでも重複して残る）
 *   → 重複したぶんだけイベントが発行され、**1押下でハンドラが複数回走る**
 *     （J/K がフォーカスを2つ進める・Space が偶数回トグルで相殺されて無反応、など）
 * - `unregisterKeyCommand:` は**入力が一致する全エントリを消す**
 *   → 片方のコンポーネントが閉じるとき、**別のコンポーネントが登録した同じキーまで巻き添えで消える**
 *     （アイコン選択を閉じた瞬間、親のデッキ編集画面の H/N/Esc が全部効かなくなる、など）
 *
 * そこで **JS 側で (input, modifier) ごとの利用者数を数え、0→1 のときだけ登録し、1→0 のときだけ解除する**。
 * これでネイティブの登録は常に1件＝二重発火せず、まだ使っている画面がある間は解除もされない。
 */
const nativeRefCounts = new Map<string, number>();
const refKey = (c: { input: string; modifierFlags: number }) => `${c.modifierFlags}::${c.input}`;

/** 参照カウントを増やし、初めて必要になったキーだけネイティブへ登録する。 */
function acquireKeyCommands(cmds: { input: string; modifierFlags: number }[]) {
  const toRegister = cmds.filter((c) => {
    const k = refKey(c);
    const next = (nativeRefCounts.get(k) ?? 0) + 1;
    nativeRefCounts.set(k, next);
    return next === 1;
  });
  if (toRegister.length > 0) KeyCommand.registerKeyCommands(toRegister);
}

/** 参照カウントを減らし、誰も使わなくなったキーだけネイティブから解除する。 */
function releaseKeyCommands(cmds: { input: string; modifierFlags: number }[]) {
  const toUnregister = cmds.filter((c) => {
    const k = refKey(c);
    const next = (nativeRefCounts.get(k) ?? 1) - 1;
    if (next <= 0) { nativeRefCounts.delete(k); return true; }
    nativeRefCounts.set(k, next);
    return false;
  });
  if (toUnregister.length > 0) KeyCommand.unregisterKeyCommands(toUnregister);
}

export function useKeyCommands(specs: KeyCommandSpec[], active: boolean = true) {
  const enabled = useSettingsStore((s) => s.keyboardShortcutsEnabled);
  // Esc spec を代替キー（バッククォート・Cmd+.）へ展開してから登録/マッチに使う。
  const specsRef = useRef<KeyCommandSpec[]>(specs);
  specsRef.current = expandEscapeAliases(specs);

  // `active`：**そのキーを今どのコンポーネントが担当するか**を決めるゲート。常時マウントされる
  // モーダル（RN Modal は visible=false でも children がマウントされる）は、非表示のあいだ false にして
  // 「見えている側だけがハンドラを持つ」状態にする。ハンドラ内の `if (visible)` だけでは、非表示の
  // コンポーネントもイベントを受けてしまい、担当が曖昧になる。
  // ネイティブ登録そのものの重複・巻き添え解除は `acquireKeyCommands`/`releaseKeyCommands` の
  // 参照カウントが吸収する（詳細はそちらのコメント）。
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !active) return;
      const cmds = specsRef.current.map((s) => ({
        input: s.input,
        modifierFlags: s.modifierFlags ?? 0,
      }));
      acquireKeyCommands(cmds);
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
        releaseKeyCommands(cmds);
      };
    }, [enabled, active]),
  );
}

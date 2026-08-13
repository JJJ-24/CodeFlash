import { useEffect, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isRemoteKeyboardEvent } from '@/lib/keyboardEvent';

/**
 * 「大きいソフトキーボード」と判定する高さの閾値。外部キーボード接続時に出る最小化バー
 * （「あ」/マイクの帯・約55pt）を拾わないための足切り。
 */
const SOFT_KEYBOARD_MIN_HEIGHT = 150;
/** キーボード上端とシートの間に置く余白。 */
const KEYBOARD_GAP = 8;
/** キーボードが無いときの持ち上げ量（デッキ編集画面の底部バー＝保存/削除ボタンの高さに合わせる）。 */
const SAVE_BUTTON_LIFT = 76;
/** シートの上に残す暗幕の高さ（閉じるためのタップ領域）。 */
const TOP_TAP_GAP = 96;

/**
 * デッキ編集から開くボトムシート（`DeckStagesModal` / `SqlInitModal`）の位置と高さ。
 *
 * - **キーボードが出ていないとき**：背後のデッキ編集画面の保存/削除ボタンのぶんだけ持ち上げる
 *   （シートが下端まで覆い切らない環境があるため。隙間は呼び出し側が同色で塗る）
 * - **大きいソフトキーボードが出ているとき**：キーボードのすぐ上まで持ち上げる。これをしないと
 *   シート内の入力欄（土台テキスト・土台の名前・043 の画像リネーム）がキーボードに隠れる
 *
 * ⚠️ **`KeyboardAvoidingView` は使わない**：最小化キーボードバーの高さを `behavior="padding"` が
 * 開く前後で違う量だけ拾い、シート位置が跳ねる（開くと上がりすぎ→タップで適正に戻る）。
 * 閾値で「大きいキーボードのときだけ」自前で持ち上げるほうが安定する。
 *
 * ⚠️ **`isRemoteKeyboardEvent` のガードは必須**：iPad の Split View では隣のアプリがキーボードを
 * 出しただけで通知が飛んでくる（CLAUDE.md の iPad マルチウィンドウの項）。無視しないと
 * 何も操作していないのにシートが跳ね上がる。
 */
export function useSheetKeyboardLift() {
  const insets = useSafeAreaInsets();
  const { height: winHeight } = useWindowDimensions();
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const onChange = (e: { endCoordinates?: { height?: number }; isEventFromThisApp?: boolean }) => {
      if (isRemoteKeyboardEvent(e)) return;
      const h = e.endCoordinates?.height ?? 0;
      setKbHeight(h > SOFT_KEYBOARD_MIN_HEIGHT ? h : 0);
    };
    const onHide = (e: { isEventFromThisApp?: boolean }) => {
      if (isRemoteKeyboardEvent(e)) return;
      setKbHeight(0);
    };
    const subShow = Keyboard.addListener('keyboardWillChangeFrame', onChange);
    const subHide = Keyboard.addListener('keyboardWillHide', onHide);
    return () => { subShow.remove(); subHide.remove(); };
  }, []);

  const sheetLift = kbHeight > 0 ? kbHeight + KEYBOARD_GAP : Math.max(insets.bottom, 16) + SAVE_BUTTON_LIFT;
  // 持ち上げた分シートが画面上端を超えないよう高さの上限を設ける（中身が縮んでも全体は見える）。
  const sheetMaxHeight = winHeight - sheetLift - insets.top - TOP_TAP_GAP;

  return { sheetLift, sheetMaxHeight, keyboardVisible: kbHeight > 0 };
}

import { useMemo, useRef } from 'react';
import type { GestureResponderEvent } from 'react-native';

/** 指の移動がこれ未満なら「タップ」＝スワイプ・スクロールの指では編集に入らない */
const TAP_SLOP = 8;

/**
 * カード編集のブロック（本文・初期化SQL・HTML 土台）を**タップで編集に入る**ためのタッチ props。
 * 包む View に `{...tapProps}` で渡す。
 *
 * ⚠️ gesture-handler の `Gesture.Tap()` に戻さない：gesture-handler 3（060）で、iPad のウィンドウ表示
 * （Split View・ステージマネージャ）のときだけ、タップで編集に入った後の**次の1回のタッチが入力欄のカーソルを
 * 外すだけで終わる**ようになった（保存・閉じる・タブ切替・入力欄の中のカーソル移動まで全部1回目が空振り。
 * Return で編集に入ったときは起きない＝タップの経路だけ）。RN のタッチイベントなら gesture-handler を通らない。
 * 判定は元の `maxDeltaX(8).maxDeltaY(8)` と同じ（スワイプで誤って編集に入らない＝`240df1f` の目的）。
 */
export function useTapToEdit(onTap: () => void) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  return useMemo(
    () => ({
      onTouchStart: (e: GestureResponderEvent) => {
        // 2本目の指が触れたらタップではない
        startRef.current = e.nativeEvent.touches.length > 1 ? null : { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      },
      onTouchMove: (e: GestureResponderEvent) => {
        const s = startRef.current;
        if (s && (Math.abs(e.nativeEvent.pageX - s.x) >= TAP_SLOP || Math.abs(e.nativeEvent.pageY - s.y) >= TAP_SLOP)) {
          startRef.current = null;
        }
      },
      onTouchEnd: (e: GestureResponderEvent) => {
        const s = startRef.current;
        startRef.current = null;
        if (!s) return;
        if (Math.abs(e.nativeEvent.pageX - s.x) < TAP_SLOP && Math.abs(e.nativeEvent.pageY - s.y) < TAP_SLOP) onTap();
      },
      // スクロールが始まると RN はタッチを取り消す＝編集に入らない
      onTouchCancel: () => { startRef.current = null; },
    }),
    [onTap],
  );
}

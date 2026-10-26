import { useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { Keyboard } from 'react-native';

/**
 * モーダル画面が閉じられる直前にキーボードを確実に閉じる。
 *
 * pageSheet モーダル（presentation: 'modal'）で autoFocus によりキーボードが開いたまま
 * シートを下スワイプで閉じると、iOS のキーボード「非表示」通知が RN に届かず、
 * グローバルなキーボード表示状態が「表示中」のまま固着する。その結果、
 * 他画面の ScrollView に余分な下部 inset が残って最下部で止まらない無限スクロールになったり、
 * ステータスバー（時刻・電池・WiFi）が消えたままになる。
 *
 * 画面離脱の直前（blur。スワイプ閉じでも発火する）にキーボードを閉じることで
 * 「非表示」通知を発火させ、状態をリセットする。unmount 時にも保険で閉じる。
 * （かつては beforeRemove も見ていたが Expo SDK 58 の expo-router で削除された。代わりの removed は
 * アンマウントの後に届く＝下の unmount 時の保険と同じタイミングなので足さない。）
 */
export function useDismissKeyboardOnLeave() {
  const navigation = useNavigation();
  useEffect(() => {
    const subBlur = navigation.addListener('blur', () => Keyboard.dismiss());
    return () => {
      subBlur();
      Keyboard.dismiss();
    };
  }, [navigation]);
}

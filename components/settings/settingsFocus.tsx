import { createContext, useCallback, useContext, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme';

import { settingsStyles } from './styles';

/**
 * 053：設定の詳細画面のキーボード操作。フォーカスできる1項目が受け取る操作。
 * 項目が持たない操作は渡さない（そのキーはその項目では何もしない）。
 */
export interface SettingsFocusHandlers {
  /** H・`,`・← */
  onLeft?: () => void;
  /** L・`.`・→ */
  onRight?: () => void;
  /** ⇧H・⇧`,`・⇧←（スライダーの大きい刻み）。渡さなければ何もしない */
  onLeftBig?: () => void;
  /** ⇧L・⇧`.`・⇧→ */
  onRightBig?: () => void;
  /** Return・Space（トグルの切替・一覧を開く・折りたたみ開閉） */
  onActivate?: () => void;
  /** 1〜9（0 始まりの番号で渡す）。選択肢型の直接選択 */
  onSelect?: (index: number) => void;
  /** S（試聴） */
  onPreview?: () => void;
  /** セクションの見出し＝⇧J/⇧K の行き先 */
  section?: boolean;
}

export interface SettingsFocusRegistry {
  /** ⚠️ 位置（setLayout）とは別に持つ＝onLayout は登録の effect より先に届くことがあるため。 */
  register: (id: string, handlers: { current: SettingsFocusHandlers }) => () => void;
  /** y は親（`SettingsFocusGroup`）の中の位置。スクロール位置は `getOffset() + y`。 */
  setLayout: (id: string, y: number, h: number, getOffset: () => number) => void;
  focusedId: string | null;
}

export const SettingsFocusContext = createContext<SettingsFocusRegistry | null>(null);

/** 親の、スクロールの中身から見た y を返す（`SettingsDetail` の直下＝0）。 */
const SettingsFocusOffsetContext = createContext<() => number>(() => 0);

/**
 * 子の項目に「自分の y」を渡す入れ物（カード・行のまとまり）。入れ子にできる。
 * ⚠️ 項目（`useSettingsFocusItem` の `onLayout` を当てる View）は、**いちばん近い
 * `SettingsFocusGroup`（無ければ `SettingsDetail`）の直接の子**に置く＝onLayout の y は親の中の位置なので、
 * 間に素の View を挟むと y がずれる。
 * 位置は onLayout でしか取らない（`measureLayout` は ScrollView の中身の座標とスクロール量の扱いが読みにくい）。
 */
export function SettingsFocusGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const parentOffset = useContext(SettingsFocusOffsetContext);
  const yRef = useRef(0);
  const getOffset = useCallback(() => parentOffset() + yRef.current, [parentOffset]);
  return (
    <View style={style} onLayout={(e) => { yRef.current = e.nativeEvent.layout.y; }}>
      <SettingsFocusOffsetContext.Provider value={getOffset}>
        {children}
      </SettingsFocusOffsetContext.Provider>
    </View>
  );
}

/**
 * 項目を登録し、フォーカス中かどうかと、位置を控える `onLayout` を返す。
 * `SettingsDetail` の外（キー操作に対応していない画面）では何もしない（focused は常に false）。
 */
export function useSettingsFocusItem(handlers: SettingsFocusHandlers) {
  const ctx = useContext(SettingsFocusContext);
  const getOffset = useContext(SettingsFocusOffsetContext);
  const id = useId();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const register = ctx?.register;
  useEffect(() => {
    if (!register) return;
    return register(id, handlersRef);
  }, [register, id]);
  const setLayout = ctx?.setLayout;
  const onLayout = (e: LayoutChangeEvent) => {
    setLayout?.(id, e.nativeEvent.layout.y, e.nativeEvent.layout.height, getOffset);
  };
  return { focused: ctx?.focusedId === id, onLayout };
}

/** フォーカス中の青枠。レイアウトを変えないよう絶対配置で重ねる（カードの角丸に合わせる）。 */
export function SettingsFocusRing({ visible }: { visible: boolean }) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: 12, borderWidth: 2, borderColor: theme.colors.primary }]}
    />
  );
}

/**
 * フォーカスできる設定カード（`settingsStyles.card` の見た目）。`onPress` を渡すとカード全体が押せる。
 * 中身は呼び出し側がそのまま書く＝既存のカードを包むだけで対応できる。
 */
export function SettingsFocusCard({ children, style, onPress, ...handlers }: SettingsFocusHandlers & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { focused, onLayout } = useSettingsFocusItem(handlers);
  const cardStyle = [settingsStyles.card, { backgroundColor: theme.colors.surface }, style];
  if (onPress) {
    return (
      <Pressable style={cardStyle} onPress={onPress} onLayout={onLayout}>
        {children}
        <SettingsFocusRing visible={focused} />
      </Pressable>
    );
  }
  return (
    <View style={cardStyle} onLayout={onLayout}>
      {children}
      <SettingsFocusRing visible={focused} />
    </View>
  );
}

/**
 * カードの**中の**1行をフォーカスできるようにする（学習設定など、カードに複数の設定が並ぶ画面）。
 * 中身をそのまま包むだけ（自身は素の View＝レイアウトは変えない）。青枠は行の外側へ少しはみ出して描く
 * （行はカードの内側の余白に接しているので、枠を行ぴったりにすると文字に触れて読みにくい）。
 */
export function SettingsFocusRow({ children, style, ...handlers }: SettingsFocusHandlers & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { focused, onLayout } = useSettingsFocusItem(handlers);
  return (
    <View style={style} onLayout={onLayout}>
      {children}
      {focused && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: -5, bottom: -5, left: -8, right: -8,
            borderRadius: 8, borderWidth: 2, borderColor: theme.colors.primary,
          }}
        />
      )}
    </View>
  );
}

/** 選択肢の左右：端で止める（循環しない＝053「選択肢の左右は端で止める」）。 */
export function stepOption<T>(options: readonly T[], value: T, dir: 1 | -1): T {
  const i = options.indexOf(value);
  if (i === -1) return options[0];
  return options[Math.min(options.length - 1, Math.max(0, i + dir))];
}

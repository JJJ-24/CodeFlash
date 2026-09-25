import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { GestureResponderEvent, LayoutChangeEvent, ScrollView, StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';

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
  /** Return＝**開く・入る**（一覧・スライダー・シートを開く・折りたたみ開閉） */
  onActivate?: () => void;
  /** Space＝**スイッチの ON/OFF**（Phase 3 で Return と分けた＝1行が「開く」と「スイッチ」を両方持てる） */
  onToggle?: () => void;
  /** Delete（Backspace）＝削除（確認は呼び出し側で出す） */
  onDelete?: () => void;
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
  /** 055：項目を青枠の対象にする（入力欄にカーソルが入ったとき＝キー以外の経路でその項目へ移ったとき） */
  claim: (id: string) => void;
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
export function useSettingsFocusItem(handlers: SettingsFocusHandlers, claim = false) {
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
  // 055：`claim` が true になったら、この項目を青枠の対象にする（入力欄にカーソルが入ったとき）。
  const claimFn = ctx?.claim;
  useEffect(() => {
    if (claim && claimFn) claimFn(id);
  }, [claim, claimFn, id]);
  const setLayout = ctx?.setLayout;
  const onLayout = (e: LayoutChangeEvent) => {
    setLayout?.(id, e.nativeEvent.layout.y, e.nativeEvent.layout.height, getOffset);
  };
  // 055：項目の中をタップしたら、その項目を青枠の対象にする（最後に触った場所からキー操作を続けられる）。
  // 中の部品（色の見本・スイッチ・入力欄など）のタップも拾えるよう、項目を包む View のタッチで判定する。
  // ⚠️ スクロールのために指を置いただけでは移さない＝ほとんど動かさずに離したとき（タップ）だけ。
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const tapToClaim = {
    onTouchStart: (e: GestureResponderEvent) => {
      touchStartRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    },
    onTouchEnd: (e: GestureResponderEvent) => {
      const s = touchStartRef.current;
      touchStartRef.current = null;
      if (!s || !claimFn) return;
      if (Math.abs(e.nativeEvent.pageX - s.x) < TAP_SLOP && Math.abs(e.nativeEvent.pageY - s.y) < TAP_SLOP) claimFn(id);
    },
    onTouchCancel: () => { touchStartRef.current = null; },
  };
  return { focused: ctx?.focusedId === id, onLayout, tapToClaim };
}

/** タップとみなす指の移動量の上限（pt）。これ以上動いたらスクロールとして扱い、青枠を移さない。 */
const TAP_SLOP = 10;

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
  const { focused, onLayout, tapToClaim } = useSettingsFocusItem(handlers);
  const cardStyle = [settingsStyles.card, { backgroundColor: theme.colors.surface }, style];
  if (onPress) {
    return (
      <Pressable style={cardStyle} onPress={onPress} onLayout={onLayout} {...tapToClaim}>
        {children}
        <SettingsFocusRing visible={focused} />
      </Pressable>
    );
  }
  return (
    <View style={cardStyle} onLayout={onLayout} {...tapToClaim}>
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
export function SettingsFocusRow({ children, style, variant = 'row', claim, ...handlers }: SettingsFocusHandlers & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `card`＝中身がカード1枚（通知のスケジュール行など）＝枠をカードの縁にぴったり重ねる */
  variant?: 'row' | 'card';
  /** 055：true になったらこの行を青枠の対象にする（中の入力欄にカーソルが入ったとき） */
  claim?: boolean;
}) {
  const theme = useTheme();
  const { focused, onLayout, tapToClaim } = useSettingsFocusItem(handlers, claim);
  return (
    <View style={style} onLayout={onLayout} {...tapToClaim}>
      {children}
      {focused && (
        <View
          pointerEvents="none"
          style={variant === 'card'
            ? { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 12, borderWidth: 2, borderColor: theme.colors.primary }
            : {
              position: 'absolute', top: -5, bottom: -5, left: -8, right: -8,
              borderRadius: 8, borderWidth: 2, borderColor: theme.colors.primary,
            }}
        />
      )}
    </View>
  );
}

/**
 * 055：J/K のフォーカス管理（053 の `SettingsDetail` から切り出し）。設定の詳細画面と、デッキ/タグの新規・編集画面で共用する。
 * 返り値の `registry` を `SettingsFocusContext.Provider` で子に渡し、ScrollView に `scrollRef`（呼び出し側の ref）・
 * `onLayout={onViewportLayout}`・`onScroll` で `scrollYRef` を更新させる。キーの割り当ては呼び出し側が行う
 * （画面ごとに使えるキーが違うため＝デッキ画面は H が「HTML/CSS 土台」）。
 */
export function useFocusRegistry(scrollRef: RefObject<ScrollView | null>, scrollYRef: RefObject<number>) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  focusedIdRef.current = focusedId;
  const handlersMap = useRef(new Map<string, { current: SettingsFocusHandlers }>());
  const layoutMap = useRef(new Map<string, { y: number; h: number; getOffset: () => number }>());
  const register = useCallback((id: string, handlers: { current: SettingsFocusHandlers }) => {
    handlersMap.current.set(id, handlers);
    return () => {
      handlersMap.current.delete(id);
      layoutMap.current.delete(id);
      if (focusedIdRef.current === id) setFocusedId(null);
    };
  }, []);
  const setLayout = useCallback((id: string, y: number, h: number, getOffset: () => number) => {
    layoutMap.current.set(id, { y, h, getOffset });
  }, []);
  /** スクロールの中身から見た位置（親の `SettingsFocusGroup` の位置を足す）。毎回計算し直す。 */
  const absLayout = (id: string) => {
    const l = layoutMap.current.get(id);
    return l ? { y: l.getOffset() + l.y, h: l.h } : undefined;
  };
  // 055：キー以外（入力欄にカーソル・タップ）で青枠を移すのは、キーボードショートカットが ON のときだけ
  //（OFF の人には青枠は意味が無く、タップのたびに枠が出ると邪魔になる）。
  const keyboardShortcutsEnabled = useSettingsStore((s) => s.keyboardShortcutsEnabled);
  const enabledRef = useRef(keyboardShortcutsEnabled);
  enabledRef.current = keyboardShortcutsEnabled;
  const claim = useCallback((id: string) => { if (enabledRef.current) setFocusedId(id); }, []);
  // ショートカットを OFF にしたら（表示画面のキーボードのトグルなど）残っている青枠を消す
  useEffect(() => { if (!keyboardShortcutsEnabled) setFocusedId(null); }, [keyboardShortcutsEnabled]);
  const registry = useMemo<SettingsFocusRegistry>(() => ({ register, setLayout, focusedId, claim }), [register, setLayout, focusedId, claim]);

  const viewportHRef = useRef(0);
  // 自動スクロール（設定タブと同じ：上下 8pt の余白を残して見える位置まで）。
  // ⚠️ 位置は毎回 layoutMap から読む＝文字サイズの変更などでレイアウトが動いても最新の値で測る。
  function scrollIntoView(id: string) {
    const l = absLayout(id);
    if (!l) return;
    const top = scrollYRef.current;
    const vh = viewportHRef.current;
    if (l.y < top + 8) scrollRef.current?.scrollTo({ y: Math.max(0, l.y - 8), animated: true });
    else if (l.y + l.h > top + vh - 8) scrollRef.current?.scrollTo({ y: l.y + l.h - vh + 8, animated: true });
  }
  // 並び＝画面上の縦位置の順（条件つきで出る行があっても順序が崩れない）。ヌルサイクル。
  function orderedIds() {
    return [...handlersMap.current.keys()]
      .map((id) => ({ id, l: absLayout(id) }))
      .filter((e): e is { id: string; l: { y: number; h: number } } => e.l !== undefined)
      .sort((a, b) => a.l.y - b.l.y)
      .map((e) => e.id);
  }
  function moveFocus(dir: 1 | -1) {
    const ids = orderedIds();
    if (ids.length === 0) return;
    const cur = focusedIdRef.current;
    const i = cur === null ? -1 : ids.indexOf(cur);
    let next: string | null;
    if (dir > 0) next = i === -1 ? (cur === null ? ids[0] : null) : i === ids.length - 1 ? null : ids[i + 1];
    else next = i === -1 ? (cur === null ? ids[ids.length - 1] : null) : i === 0 ? null : ids[i - 1];
    setFocusedId(next);
    if (next !== null) scrollIntoView(next);
  }
  // ⇧J/⇧K：前後のセクション見出しへ（学習設定など、見出しを持つ画面）。
  // 基準は「いまフォーカスしている行の位置」＝セクションの中の行からでも次の見出しへ跳べる。
  // フォーカスが無ければ ⇧J＝最初の見出し／⇧K＝最後の見出し。
  // **端では反対の端の見出しへ巡回する**（J/K と同じく巡回＝最下部から ⇧J 1回で最上部へ）。
  // ⚠️ J/K と違い「フォーカスなし」は挟まない＝見出しへ跳ぶキーで何も無い状態に着いても意味が無い
  //   （外したいときは Esc）。
  function moveSection(dir: 1 | -1) {
    const ids = orderedIds();
    const isSection = (id: string) => handlersMap.current.get(id)?.current.section === true;
    const sections = ids.filter(isSection);
    if (sections.length === 0) return;
    const cur = focusedIdRef.current;
    const i = cur === null ? -1 : ids.indexOf(cur);
    let next: string | undefined;
    if (i === -1) next = dir > 0 ? sections[0] : sections[sections.length - 1];
    else if (dir > 0) next = ids.slice(i + 1).find(isSection) ?? sections[0];
    else next = ids.slice(0, i).reverse().find(isSection) ?? sections[sections.length - 1];
    if (next === cur) return;
    setFocusedId(next);
    scrollIntoView(next);
  }
  const focused = () => (focusedIdRef.current ? handlersMap.current.get(focusedIdRef.current)?.current : undefined);


  const onViewportLayout = (e: LayoutChangeEvent) => { viewportHRef.current = e.nativeEvent.layout.height; };
  return { registry, focusedIdRef, setFocusedId, moveFocus, moveSection, focused, onViewportLayout };
}

/** 選択肢の左右：端で止める（循環しない＝053「選択肢の左右は端で止める」）。 */
export function stepOption<T>(options: readonly T[], value: T, dir: 1 | -1): T {
  const i = options.indexOf(value);
  if (i === -1) return options[0];
  return options[Math.min(options.length - 1, Math.max(0, i + dir))];
}

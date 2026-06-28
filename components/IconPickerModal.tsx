import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';
import { useTranslation } from 'react-i18next';

import { DECK_ICON_CATEGORIES, type DeckIconName } from '@/lib/deckIcons';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

interface Props {
  visible: boolean;
  selected: DeckIconName | null;
  /** ハイライト色（プレビューと合わせるためデッキ選択中カラーを渡す） */
  highlightColor: string;
  onSelect: (icon: DeckIconName | null) => void;
  onClose: () => void;
}

const CELL_SIZE = 56;

export function IconPickerModal({ visible, selected, highlightColor, onSelect, onClose }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();

  // 全アイコンを1次元化（先頭は「なし」= null）。J/K・矢印の巡回とフォーカス管理に使う。
  const flatIcons = useMemo<(DeckIconName | null)[]>(
    () => [null, ...DECK_ICON_CATEGORIES.flatMap((c) => c.icons)],
    [],
  );
  // 各カテゴリの開始インデックス（null が 0 を占めるので 1 始まり）。
  const sections = useMemo(() => {
    let idx = 1;
    return DECK_ICON_CATEGORIES.map((cat) => {
      const items = cat.icons.map((icon) => ({ icon, index: idx++ }));
      return { key: cat.key, items };
    });
  }, []);

  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const cellRefs = useRef<Map<number, View>>(new Map());
  // 各セルの content 基準の座標（縦移動 J/K で「真上・真下の行」を求めるのに使う）。
  const cellLayouts = useRef<Map<number, { x: number; y: number; w: number; h: number }>>(new Map());
  const scrollYRef = useRef(0);
  const viewportHRef = useRef(0);

  // 開いたら選択中アイコンにフォーカス（無ければ先頭）。閉じたら解除。
  useEffect(() => {
    if (visible) {
      const i = flatIcons.findIndex((ic) => ic === selected);
      setFocusedIndex(i >= 0 ? i : 0);
    } else {
      setFocusedIndex(null);
    }
    // selected は開いた瞬間の値を使えばよいので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // フォーカス中セルが見えるよう自動スクロール（measureLayout で content 基準の y を取得）。
  useEffect(() => {
    if (!visible || focusedIndex === null) return;
    const cell = cellRefs.current.get(focusedIndex);
    if (!cell || !contentRef.current) return;
    setTimeout(() => {
      cell.measureLayout(
        contentRef.current as any,
        (_x: number, y: number, _w: number, h: number) => {
          const cur = scrollYRef.current;
          const vh = viewportHRef.current;
          if (y < cur + 12) {
            scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
          } else if (y + h > cur + vh - 12) {
            scrollRef.current?.scrollTo({ y: y + h - vh + 12, animated: true });
          }
        },
        () => {},
      );
    }, 0);
  }, [focusedIndex, visible]);

  // 横移動：フラットな並び順で前後（行末で隣の行へ折り返し）。
  function move(delta: number) {
    setFocusedIndex((prev) => {
      const n = flatIcons.length;
      if (prev === null) return delta > 0 ? 0 : n - 1;
      return (prev + delta + n) % n;
    });
  }

  // 縦移動：実セルの座標から「真上／真下の行で x が最も近いセル」を選ぶ（カテゴリ境界を跨いでも自然）。
  function moveVertical(dir: number) {
    setFocusedIndex((prev) => {
      const n = flatIcons.length;
      if (prev === null) return dir > 0 ? 0 : n - 1;
      const cp = cellLayouts.current.get(prev);
      if (!cp) return (prev + dir + n) % n; // レイアウト未取得時は線形フォールバック
      const cx = cp.x + cp.w / 2;
      const cy = cp.y + cp.h / 2;
      let best: number | null = null;
      let bestScore = Infinity;
      cellLayouts.current.forEach((p, idx) => {
        if (idx === prev) return;
        const py = p.y + p.h / 2;
        if (dir > 0 ? py <= cy + cp.h * 0.4 : py >= cy - cp.h * 0.4) return; // 下/上の行のみ
        const px = p.x + p.w / 2;
        const score = Math.abs(py - cy) * 1000 + Math.abs(px - cx); // 近い行優先→近い列
        if (score < bestScore) { bestScore = score; best = idx; }
      });
      return best === null ? prev : best;
    });
  }

  function selectFocused() {
    if (focusedIndex === null) return;
    onSelect(flatIcons[focusedIndex]);
    onClose();
  }

  // モーダル表示中のみ処理（非表示でも親画面フォーカス中は登録されたままのため visible でガード）。
  useKeyCommands([
    // iPad は矢印が使えないため文字キーで全方向を賄う。左右は他画面と揃えて ,/. ＋ vim の H/L、
    // 上下は J/K（下/上）。
    { input: ',', handler: () => { if (visible) move(-1); } },
    { input: '.', handler: () => { if (visible) move(1); } },
    { input: 'h', handler: () => { if (visible) move(-1); } },
    { input: 'l', handler: () => { if (visible) move(1); } },
    { input: 'j', handler: () => { if (visible) moveVertical(1); } },
    { input: 'k', handler: () => { if (visible) moveVertical(-1); } },
    { input: KeyCommand.keyInputEnter, handler: () => { if (visible) selectFocused(); } },
    { input: KeyCommand.keyInputEscape, handler: () => { if (visible) onClose(); } },
    // 矢印は iPhone のみ（iPad はフォーカスエンジン予約＝動的登録でフリーズの恐れ。H/J/K/L を使う）。
    ...(((Platform as any).isPad ? [] : [
      { input: KeyCommand.keyInputUpArrow, handler: () => { if (visible) moveVertical(-1); } },
      { input: KeyCommand.keyInputDownArrow, handler: () => { if (visible) moveVertical(1); } },
      { input: KeyCommand.keyInputLeftArrow, handler: () => { if (visible) move(-1); } },
      { input: KeyCommand.keyInputRightArrow, handler: () => { if (visible) move(1); } },
    ]) as { input: string; handler: () => void }[]),
  ]);

  function renderCell(icon: DeckIconName | null, index: number) {
    const isSelected = selected === icon;
    const isFocused = focusedIndex === index;
    return (
      <Pressable
        key={icon ?? '__none__'}
        ref={(r) => {
          if (r) cellRefs.current.set(index, r as unknown as View);
          else cellRefs.current.delete(index);
        }}
        onLayout={() => {
          // content 基準の座標を測ってキャッシュ（縦移動の行判定に使う）。
          const c = cellRefs.current.get(index);
          if (c && contentRef.current) {
            c.measureLayout(
              contentRef.current as any,
              (x: number, y: number, w: number, h: number) => cellLayouts.current.set(index, { x, y, w, h }),
              () => {},
            );
          }
        }}
        onPress={() => {
          onSelect(icon);
          onClose();
        }}
        style={[
          styles.cell,
          {
            backgroundColor: isSelected ? highlightColor + '20' : theme.colors.background,
            borderColor: isFocused ? theme.colors.primary : isSelected ? highlightColor : theme.colors.border,
            borderWidth: isFocused ? 3 : 1.5,
          },
        ]}
      >
        <Ionicons
          name={(icon ?? 'close-circle-outline') as any}
          size={28}
          color={isSelected ? highlightColor : icon ? theme.colors.text : theme.colors.textSecondary}
        />
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.closeArea} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.header}>
            <Text
              style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t('deck.iconPickerTitle')}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={26} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            ref={scrollRef}
            onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
            onLayout={(e) => { viewportHRef.current = e.nativeEvent.layout.height; }}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 12 }}
          >
            <View ref={contentRef}>
              <Text
                style={[styles.categoryLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {t('deck.iconCategory.none')}
              </Text>
              <View style={styles.grid}>{renderCell(null, 0)}</View>
              {sections.map((sec) => (
                <View key={sec.key}>
                  <Text
                    style={[styles.categoryLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {t(`deck.iconCategory.${sec.key}`)}
                  </Text>
                  <View style={styles.grid}>{sec.items.map((it) => renderCell(it.icon, it.index))}</View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  closeArea: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    maxHeight: '75%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontWeight: '700',
  },
  categoryLabel: {
    fontWeight: '600',
    paddingHorizontal: 4,
    paddingTop: 16,
    paddingBottom: 6,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    margin: 4,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
